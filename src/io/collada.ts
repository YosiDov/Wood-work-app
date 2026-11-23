import * as THREE from 'three';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import type { Part, Project, Quat, Vec3, WoodId } from '../model/types';
import { WOODS, wood } from '../model/woods';
import { applyCut, bakeQuarter, fromQ, hashSeed, hasCut, isIdentityQ, longestAxis, posFromCenter, rotatedBox, uid } from '../model/geometry';

/*
 * Collada 1.4.1 writer. Every part becomes a node with its own mesh, grouped under a node per
 * assembly, in millimetres with Y up. The full editable project is embedded in the root <extra>
 * element, so files saved here reopen with materials, templates and loads intact, while any other
 * 3D program (Blender, SketchUp, FreeCAD…) sees ordinary geometry.
 */

const PROFILE = 'MUSHKI_WOODWORKS';

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const rgb = (hex: string) => {
  const c = new THREE.Color(hex);
  return `${c.r.toFixed(4)} ${c.g.toFixed(4)} ${c.b.toFixed(4)} 1`;
};

const f = (v: number) => (Math.round(v * 1000) / 1000).toString();

const boxMesh = (size: Vec3, cut?: [number, number]) => {
  const [x, y, z] = size.map((s) => s / 2);
  const pos = [
    [-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z],
    [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z],
  ];
  if (cut) pos.forEach((pt) => applyCut(pt, size, cut));
  const nrm: number[][] = [[0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0]];
  if (cut) {
    // end faces are no longer square to the board: recompute each face normal
    const faces = [[0, 3, 2], [4, 5, 6], [0, 4, 7], [1, 2, 6], [0, 1, 5], [3, 7, 6]];
    faces.forEach(([a, b, c], i) => {
      const u = [0, 1, 2].map((k) => pos[b][k] - pos[a][k]);
      const v = [0, 1, 2].map((k) => pos[c][k] - pos[a][k]);
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const l = Math.hypot(n[0], n[1], n[2]) || 1;
      nrm[i] = n.map((x) => x / l);
    });
  }
  // quads (counter-clockwise from outside) → normal index
  const quads: [number[], number][] = [
    [[0, 3, 2, 1], 0],
    [[4, 5, 6, 7], 1],
    [[0, 4, 7, 3], 2],
    [[1, 2, 6, 5], 3],
    [[0, 1, 5, 4], 4],
    [[3, 7, 6, 2], 5],
  ];
  const p: number[] = [];
  for (const [q, n] of quads) p.push(q[0], n, q[1], n, q[2], n, q[0], n, q[2], n, q[3], n);
  return { pos, nrm, p, tris: 12 };
};

const rodMesh = (size: Vec3, seg = 24) => {
  const ax = longestAxis(size);
  const others = [0, 1, 2].filter((k) => k !== ax);
  const d = Math.min(size[others[0]], size[others[1]]);
  const r = d / 2;
  const h = size[ax] / 2;
  const [u, v] = others;
  const pos: number[][] = [];
  const nrm: number[][] = [];
  for (const end of [-1, 1]) {
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const pt = [0, 0, 0];
      pt[ax] = end * h;
      pt[u] = Math.cos(a) * r;
      pt[v] = Math.sin(a) * r;
      pos.push(pt);
    }
  }
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const n = [0, 0, 0];
    n[u] = Math.cos(a);
    n[v] = Math.sin(a);
    nrm.push(n);
  }
  const capLo = [0, 0, 0];
  capLo[ax] = -1;
  const capHi = [0, 0, 0];
  capHi[ax] = 1;
  nrm.push(capLo, capHi);
  // orientation: (u, v, ax) right-handed?
  const rh = (u + 1) % 3 === v;
  const p: number[] = [];
  let tris = 0;
  const tri = (a: number, na: number, b: number, nb: number, c: number, nc: number) => {
    if (rh) p.push(a, na, b, nb, c, nc);
    else p.push(a, na, c, nc, b, nb);
    tris++;
  };
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    tri(i, i, j, j, seg + j, j);
    tri(i, i, seg + j, j, seg + i, i);
  }
  for (let i = 1; i < seg - 1; i++) {
    tri(0, seg, i + 1, seg, i, seg);
    tri(seg, seg + 1, seg + i, seg + 1, seg + i + 1, seg + 1);
  }
  return { pos, nrm, p, tris };
};

export const exportCollada = (project: Project): string => {
  const now = new Date().toISOString();
  const used = [...new Set(project.parts.map((p) => p.wood))];
  const effects = used
    .map((id) => {
      const w = wood(id);
      return `    <effect id="fx-${id}"><profile_COMMON><technique sid="common"><lambert><diffuse><color sid="diffuse">${rgb(w.colors[0])}</color></diffuse></lambert></technique></profile_COMMON></effect>`;
    })
    .join('\n');
  const materials = used.map((id) => `    <material id="mat-${id}" name="${xml(wood(id).name)} ${xml(wood(id).latin)}"><instance_effect url="#fx-${id}"/></material>`).join('\n');

  const geoms: string[] = [];
  const nodeOf = (p: Part, i: number) => {
    const gid = `g${i}`;
    const m = p.shape === 'rod' ? rodMesh(p.size) : boxMesh(p.size, hasCut(p) ? p.cut : undefined);
    const posArr = m.pos.flat().map(f).join(' ');
    const nrmArr = m.nrm.flat().map(f).join(' ');
    geoms.push(
      `    <geometry id="${gid}" name="${xml(p.name)}"><mesh>` +
        `<source id="${gid}-pos"><float_array id="${gid}-pos-a" count="${m.pos.length * 3}">${posArr}</float_array><technique_common><accessor source="#${gid}-pos-a" count="${m.pos.length}" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>` +
        `<source id="${gid}-nrm"><float_array id="${gid}-nrm-a" count="${m.nrm.length * 3}">${nrmArr}</float_array><technique_common><accessor source="#${gid}-nrm-a" count="${m.nrm.length}" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>` +
        `<vertices id="${gid}-vtx"><input semantic="POSITION" source="#${gid}-pos"/></vertices>` +
        `<triangles material="wood" count="${m.tris}"><input semantic="VERTEX" source="#${gid}-vtx" offset="0"/><input semantic="NORMAL" source="#${gid}-nrm" offset="1"/><p>${m.p.join(' ')}</p></triangles>` +
        `</mesh></geometry>`,
    );
    const c = [p.pos[0] + p.size[0] / 2, p.pos[1] + p.size[1] / 2, p.pos[2] + p.size[2] / 2];
    let rotate = '';
    if (!isIdentityQ(p.q)) {
      const [x, y, z, w] = p.q!;
      const ang = 2 * Math.acos(Math.min(1, Math.max(-1, w)));
      const sn = Math.sqrt(Math.max(1e-12, 1 - w * w));
      rotate = `<rotate sid="rotate">${f(x / sn)} ${f(y / sn)} ${f(z / sn)} ${f((ang * 180) / Math.PI)}</rotate>`;
    }
    return `<node id="n${i}" name="${xml(p.name)}" type="NODE"><translate sid="location">${c.map(f).join(' ')}</translate>${rotate}<instance_geometry url="#${gid}" name="${xml(p.name)}"><bind_material><technique_common><instance_material symbol="wood" target="#mat-${p.wood}"/></technique_common></bind_material></instance_geometry></node>`;
  };

  const index = new Map(project.parts.map((p, i) => [p.id, i]));
  const groupNodes = project.groups
    .map((g, gi) => {
      const kids = project.parts.filter((p) => p.groupId === g.id).map((p) => '        ' + nodeOf(p, index.get(p.id)!));
      if (!kids.length) return '';
      return `      <node id="grp${gi}" name="${xml(g.name)}" type="NODE">\n${kids.join('\n')}\n      </node>`;
    })
    .filter(Boolean);
  const loose = project.parts.filter((p) => !p.groupId || !project.groups.some((g) => g.id === p.groupId)).map((p) => '      ' + nodeOf(p, index.get(p.id)!));

  const json = JSON.stringify(project).replace(/]]>/g, ']]]]><![CDATA[>');

  return `<?xml version="1.0" encoding="utf-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
  <asset>
    <contributor><author>Mushki</author><authoring_tool>עבודות עץ של מושקי</authoring_tool></contributor>
    <created>${now}</created>
    <modified>${now}</modified>
    <title>${xml(project.name)}</title>
    <unit name="millimeter" meter="0.001"/>
    <up_axis>Y_UP</up_axis>
  </asset>
  <library_effects>
${effects}
  </library_effects>
  <library_materials>
${materials}
  </library_materials>
  <library_geometries>
${geoms.join('\n')}
  </library_geometries>
  <library_visual_scenes>
    <visual_scene id="scene" name="${xml(project.name)}">
${[...groupNodes, ...loose].join('\n')}
    </visual_scene>
  </library_visual_scenes>
  <scene>
    <instance_visual_scene url="#scene"/>
  </scene>
  <extra>
    <technique profile="${PROFILE}">
      <project><![CDATA[${json}]]></project>
    </technique>
  </extra>
</COLLADA>
`;
};

const WOOD_IDS = new Set(WOODS.map((w) => w.id));

/** make any parsed project safe to use */
export const sanitizeProject = (raw: unknown): Project => {
  const r = raw as Partial<Project>;
  if (!r || !Array.isArray(r.parts)) throw new Error('bad project');
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const vec = (v: unknown, d: Vec3): Vec3 => (Array.isArray(v) && v.length === 3 ? (v.map((x, i) => num(x, d[i])) as Vec3) : d);
  const quat = (v: unknown): Quat | undefined => {
    if (!Array.isArray(v) || v.length !== 4 || !v.every((x) => typeof x === 'number' && Number.isFinite(x))) return undefined;
    const q = fromQ(new THREE.Quaternion(v[0], v[1], v[2], v[3]));
    return isIdentityQ(q) ? undefined : q;
  };
  const parts: Part[] = r.parts.map((p: Partial<Part>) => ({
    id: typeof p.id === 'string' ? p.id : uid(),
    name: typeof p.name === 'string' ? p.name : 'חלק',
    groupId: typeof p.groupId === 'string' ? p.groupId : null,
    pos: vec(p.pos, [0, 0, 0]),
    size: vec(p.size, [100, 18, 100]).map((s) => Math.max(1, s)) as Vec3,
    wood: WOOD_IDS.has(p.wood as WoodId) ? (p.wood as WoodId) : 'pine',
    shape: p.shape === 'rod' ? 'rod' : 'box',
    role: p.role === 'front' ? 'front' : 'structure',
    anchored: !!p.anchored,
    load: typeof p.load === 'number' ? p.load : null,
    loadType: p.loadType === 'point' ? 'point' : 'udl',
    seed: num(p.seed, Math.random()),
    kind: p.kind ?? 'board',
    matRole: p.matRole,
    q: quat(p.q),
    cut:
      Array.isArray(p.cut) && p.cut.length === 2 && p.cut.every((x) => typeof x === 'number' && Number.isFinite(x))
        ? ([Math.max(-75, Math.min(75, p.cut[0])), Math.max(-75, Math.min(75, p.cut[1]))] as [number, number])
        : undefined,
  }));
  const groups = Array.isArray(r.groups) ? r.groups.filter((g) => g && typeof g.id === 'string') : [];
  return {
    version: 1,
    name: typeof r.name === 'string' ? r.name : 'פרויקט',
    parts,
    groups: groups.map((g) => ({ ...g, origin: vec(g.origin, [0, 0, 0]), rot: num(g.rot, 0), q: quat(g.q), params: g.params ?? {}, custom: !!g.custom, template: g.template ?? null })),
    designLoad: num(r.designLoad, 100),
    prices: r.prices ?? {},
  };
};

/** Parse a .dae: our own files restore fully, others become editable boards (one per object). */
export const importCollada = (text: string, fileName: string): { project: Project; native: boolean } => {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('xml');
  const techniques = Array.from(doc.getElementsByTagName('technique'));
  const ours = techniques.find((t) => t.getAttribute('profile') === PROFILE);
  const payload = ours?.getElementsByTagName('project')[0]?.textContent;
  if (payload) return { project: sanitizeProject(JSON.parse(payload)), native: true };

  const loader = new ColladaLoader();
  const res = loader.parse(text, '');
  if (!res?.scene) throw new Error('empty');
  const scene = res.scene;
  scene.updateMatrixWorld(true);
  // each object keeps its own orientation: size from its local box, centre and rotation from the scene
  const raw: { name: string; c: Vec3; size: Vec3; q?: Quat }[] = [];
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || raw.length >= 400) return;
    m.geometry.computeBoundingBox();
    const gb = m.geometry.boundingBox;
    if (!gb || gb.isEmpty()) return;
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    m.matrixWorld.decompose(pos, quat, scl);
    const sz = gb.getSize(new THREE.Vector3());
    const size: Vec3 = [sz.x * Math.abs(scl.x) * 1000, sz.y * Math.abs(scl.y) * 1000, sz.z * Math.abs(scl.z) * 1000].map((v) => Math.max(1, Math.round(v * 10) / 10)) as Vec3;
    const c = gb.getCenter(new THREE.Vector3()).applyMatrix4(m.matrixWorld).multiplyScalar(1000);
    const baked = bakeQuarter(size, fromQ(quat));
    raw.push({ name: o.name || o.parent?.name || 'חלק', c: [c.x, c.y, c.z], size: baked.size, q: baked.q });
  });
  if (!raw.length) throw new Error('empty');
  const all = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const r of raw) {
    const b = rotatedBox(r.c, r.size, r.q);
    for (let k = 0; k < 3; k++) {
      all.min[k] = Math.min(all.min[k], b.min[k]);
      all.max[k] = Math.max(all.max[k], b.max[k]);
    }
  }
  const shift: Vec3 = [-(all.min[0] + all.max[0]) / 2, -all.min[1], -(all.min[2] + all.max[2]) / 2];
  const groupId = uid();
  const parts: Part[] = raw.map((r, i) => {
    const id = uid() + i;
    const c: Vec3 = [r.c[0] + shift[0], r.c[1] + shift[1], r.c[2] + shift[2]];
    return {
      id,
      name: r.name.replace(/[-_]/g, ' ').slice(0, 40),
      groupId,
      pos: posFromCenter(c, r.size).map((v) => Math.round(v * 10) / 10) as Vec3,
      size: r.size,
      wood: 'pine',
      shape: 'box',
      role: 'structure',
      anchored: false,
      load: null,
      loadType: 'udl',
      seed: hashSeed(id),
      kind: 'board',
      q: r.q,
    };
  });
  const base = fileName.replace(/\.[^.]+$/, '');
  return {
    native: false,
    project: {
      version: 1,
      name: base || 'ייבוא',
      parts,
      groups: [{ id: groupId, name: base || 'ייבוא', template: null, params: {}, origin: [0, 0, 0], rot: 0, custom: false }],
      designLoad: 100,
      prices: {},
    },
  };
};
