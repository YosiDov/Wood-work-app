import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { Part, Project, Vec3, ViewMode } from '../model/types';
import { markCustom, selectedPartIds, useStore } from '../model/store';
import { analyze, type PartResult, type Segment } from '../model/analysis';
import { boxCenter, boxOfParts, boxSize, type Box3 } from '../model/geometry';
import { axisParam } from '../model/templates';
import { buildPartGeometry } from './boardGeometry';
import { cuttingMatTexture, woodMaterials } from './textures';

const TAPE = 0xf3c623;
const INK = 0x1d2823;
const EXAGGERATE = 10;

interface PartObj {
  part: Part;
  key: string;
  holder: THREE.Group;
  mesh: THREE.Mesh;
  edges: THREE.LineSegments;
  baseMesh: Float32Array;
  baseEdges: Float32Array;
  deformed: boolean;
  outline: LineSegments2 | null;
  matKey: string;
}

interface Handle {
  mesh: THREE.Mesh;
  axis: number;
  sign: 1 | -1;
  base: THREE.Vector3;
}

const beamAxis = (p: Part): number | null => {
  const horiz = Math.max(p.size[0], p.size[2]);
  if (horiz < p.size[1]) return null;
  return p.size[0] >= p.size[2] ? 0 : 2;
};

const geomKey = (p: Part) => `${p.size.join(',')}|${p.shape}|${p.wood}|${p.seed}`;

const fmt = (v: number) => {
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
};

const heatColor = (U: number): THREE.Color => {
  const stops: [number, string][] = [
    [0, '#2c8f57'],
    [0.45, '#5fae4a'],
    [0.7, '#c9b22a'],
    [0.85, '#e3a21a'],
    [1, '#e0702a'],
    [1.0001, '#d64533'],
    [3, '#a3261b'],
  ];
  const u = Math.max(0, Math.min(3, U));
  for (let i = 1; i < stops.length; i++) {
    if (u <= stops[i][0]) {
      const [a, ca] = stops[i - 1];
      const [b, cb] = stops[i];
      const t = (u - a) / (b - a || 1);
      return new THREE.Color(ca).lerp(new THREE.Color(cb), t);
    }
  }
  return new THREE.Color('#a3261b');
};

const shapeAt = (s: number, segs: Segment[]): number => {
  for (const g of segs) {
    if (s < g.a - 0.01 || s > g.b + 0.01) continue;
    const L = g.b - g.a;
    const vis = Math.min(g.dFin * EXAGGERATE, 0.12 * L);
    if (g.kind === 'span') {
      const x = (s - g.a) / L;
      return vis * 3.2 * (x - 2 * x ** 3 + x ** 4);
    }
    const x = g.fixed === 'b' ? (g.b - s) / L : (s - g.a) / L;
    return (vis * (6 * x * x - 4 * x ** 3 + x ** 4)) / 3;
  }
  return 0;
};

export class Viewport {
  readonly renderer: THREE.WebGLRenderer;
  private el: HTMLElement;
  private scene = new THREE.Scene();
  private persp: THREE.PerspectiveCamera;
  private ortho: THREE.OrthographicCamera;
  private camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  private controls: OrbitControls;
  private css: CSS2DRenderer;
  private tc: TransformControls;
  private pivot = new THREE.Object3D();
  private partsRoot = new THREE.Group();
  private overlay = new THREE.Group();
  private objs = new Map<string, PartObj>();
  private sun: THREE.DirectionalLight;
  private mat: THREE.Mesh;
  private edgeMat = new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.3 });
  private hoverEdgeMat = new THREE.LineBasicMaterial({ color: 0x1f5a49, transparent: true, opacity: 0.95 });
  private selMat: LineMaterial;
  private ghostMat = new THREE.MeshStandardMaterial({ color: '#e4e9e4', transparent: true, opacity: 0.22, depthWrite: false, roughness: 0.8 });
  private neutralMat = new THREE.MeshStandardMaterial({ color: '#d4ddd6', roughness: 0.8 });
  private wallMat = new THREE.MeshStandardMaterial({ color: '#9fb4c4', roughness: 0.8 });
  private heatMats = new Map<string, THREE.MeshStandardMaterial>();
  private handleMat = new THREE.MeshBasicMaterial({ color: TAPE, depthTest: false });
  private handleRing = new THREE.MeshBasicMaterial({ color: INK, depthTest: false, side: THREE.BackSide });
  private handles: Handle[] = [];
  private labels: CSS2DObject[] = [];
  private dirty = true;
  private raf = 0;
  private ro: ResizeObserver;
  private unsub: () => void;
  private hoverId: string | null = null;
  private orthoHalf = 1200;
  private viewDir = new THREE.Vector3(0.62, 0.5, 1).normalize();
  private anim: { p0: THREE.Vector3; p1: THREE.Vector3; t0v: THREE.Vector3; t1v: THREE.Vector3; start: number; dur: number } | null = null;
  private moveDrag: { start: Map<string, Vec3>; origin: Vec3 | null; pivot0: THREE.Vector3; box: Box3; ids: Set<string> } | null = null;
  private resizeDrag: {
    h: Handle;
    plane: THREE.Plane;
    grab: number;
    part?: Part;
    groupId?: string;
    box: Box3;
    pointerId: number;
  } | null = null;
  private down: { x: number; y: number; t: number; gizmo: boolean } | null = null;
  private lastClick: { id: string; t: number } | null = null;
  private justDragged = 0;
  private raycaster = new THREE.Raycaster();

  constructor(el: HTMLElement) {
    this.el = el;
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.toneMapping = THREE.NeutralToneMapping;
    r.toneMappingExposure = 1.05;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.setClearColor(0x000000, 0);
    this.renderer = r;
    el.appendChild(r.domElement);
    r.domElement.classList.add('gl');

    this.css = new CSS2DRenderer();
    this.css.domElement.className = 'labels';
    el.appendChild(this.css.domElement);

    this.persp = new THREE.PerspectiveCamera(38, 1, 5, 120000);
    this.ortho = new THREE.OrthographicCamera(-1000, 1000, 1000, -1000, -50000, 50000);
    this.camera = this.persp;
    this.persp.position.set(2600, 2000, 3800);

    this.controls = new OrbitControls(this.persp, r.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.minDistance = 120;
    this.controls.maxDistance = 30000;
    this.controls.zoomToCursor = true;
    this.controls.addEventListener('change', () => (this.dirty = true));

    // scene
    const pmrem = new THREE.PMREMGenerator(r);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x4b6656, 1.15));
    this.sun = new THREE.DirectionalLight(0xfff2df, 2.3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 1.5;
    this.sun.shadow.radius = 4;
    this.scene.add(this.sun, this.sun.target);

    const matTex = cuttingMatTexture();
    matTex.repeat.set(10, 10);
    const fade = document.createElement('canvas');
    fade.width = fade.height = 256;
    const fctx = fade.getContext('2d')!;
    const grd = fctx.createRadialGradient(128, 128, 40, 128, 128, 128);
    grd.addColorStop(0, '#fff');
    grd.addColorStop(0.62, '#fff');
    grd.addColorStop(1, '#000');
    fctx.fillStyle = grd;
    fctx.fillRect(0, 0, 256, 256);
    const alphaMap = new THREE.CanvasTexture(fade);
    this.mat = new THREE.Mesh(
      new THREE.PlaneGeometry(10000, 10000),
      new THREE.MeshStandardMaterial({ map: matTex, alphaMap, transparent: true, roughness: 0.92, metalness: 0, depthWrite: false }),
    );
    this.mat.rotation.x = -Math.PI / 2;
    this.mat.position.y = -0.6;
    this.mat.receiveShadow = true;
    this.mat.renderOrder = -1;
    this.scene.add(this.mat);

    this.scene.add(this.partsRoot, this.overlay, this.pivot);

    this.selMat = new LineMaterial({ color: TAPE, linewidth: 3.2, worldUnits: false, depthTest: false, transparent: true, opacity: 0.95 });

    // move gizmo
    this.tc = new TransformControls(this.persp, r.domElement);
    this.tc.setMode('translate');
    this.tc.setSpace('world');
    this.tc.setSize(matchMedia('(pointer: coarse)').matches ? 1.35 : 1);
    this.tc.setColors(new THREE.Color('#d9534f'), new THREE.Color('#3f9e5a'), new THREE.Color('#3a78c2'), new THREE.Color(TAPE));
    const helper = this.tc.getHelper();
    helper.renderOrder = 1000;
    this.scene.add(helper);
    this.tc.addEventListener('change', () => (this.dirty = true));
    this.tc.addEventListener('dragging-changed', (e) => {
      this.controls.enabled = !(e as unknown as { value: boolean }).value;
    });
    this.tc.addEventListener('mouseDown', () => this.startMove());
    this.tc.addEventListener('objectChange', () => this.applyMove());
    this.tc.addEventListener('mouseUp', () => {
      this.moveDrag = null;
      this.justDragged = performance.now();
      this.sync();
    });

    // pointer input (registered after TransformControls so its hover state is fresh)
    const dom = r.domElement;
    dom.addEventListener('pointerdown', this.onDownCapture, true);
    dom.addEventListener('pointerdown', this.onDown);
    dom.addEventListener('pointermove', this.onMove);
    dom.addEventListener('pointerup', this.onUp);
    dom.addEventListener('pointercancel', this.onUp);
    dom.addEventListener('pointerleave', () => this.setHover(null));
    dom.addEventListener('contextmenu', (e) => e.preventDefault());

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(el);
    this.resize();

    this.unsub = useStore.subscribe((s, prev) => {
      if (s.view !== prev.view) this.setView(s.view);
      if (s.frameTick !== prev.frameTick) {
        this.sync();
        this.frame(true);
        return;
      }
      if (
        s.project !== prev.project ||
        s.selection !== prev.selection ||
        s.strength !== prev.strength ||
        s.explode !== prev.explode ||
        s.tool !== prev.tool ||
        s.dims !== prev.dims ||
        s.view !== prev.view
      ) {
        this.sync();
      }
    });
    this.sync();
    this.frame(false);
    this.loop();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.unsub();
    this.ro.disconnect();
    this.tc.dispose();
    this.controls.dispose();
    this.renderer.dispose();
    this.el.innerHTML = '';
  }

  // ───────────────────────────────────────────── render loop

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    if (this.anim) {
      const k = Math.min(1, (performance.now() - this.anim.start) / this.anim.dur);
      const e = 1 - Math.pow(1 - k, 3);
      this.camera.position.lerpVectors(this.anim.p0, this.anim.p1, e);
      this.controls.target.lerpVectors(this.anim.t0v, this.anim.t1v, e);
      if (k >= 1) this.anim = null;
      this.dirty = true;
    }
    if (this.controls.update()) this.dirty = true;
    if (!this.dirty) return;
    this.dirty = false;
    this.placeHandles();
    this.renderer.render(this.scene, this.camera);
    this.css.render(this.scene, this.camera);
  };

  private resize() {
    const w = Math.max(1, this.el.clientWidth);
    const h = Math.max(1, this.el.clientHeight);
    this.renderer.setSize(w, h, false);
    this.css.setSize(w, h);
    this.persp.aspect = w / h;
    this.persp.updateProjectionMatrix();
    this.updateOrtho();
    this.selMat.resolution.set(w, h);
    this.dirty = true;
  }

  private updateOrtho() {
    const w = Math.max(1, this.el.clientWidth);
    const h = Math.max(1, this.el.clientHeight);
    const a = w / h;
    this.ortho.left = -this.orthoHalf * a;
    this.ortho.right = this.orthoHalf * a;
    this.ortho.top = this.orthoHalf;
    this.ortho.bottom = -this.orthoHalf;
    this.ortho.updateProjectionMatrix();
  }

  /** world units per screen pixel at a point */
  private pxSize(at: THREE.Vector3) {
    const h = Math.max(1, this.el.clientHeight);
    if (this.camera instanceof THREE.OrthographicCamera) return (this.ortho.top - this.ortho.bottom) / this.ortho.zoom / h;
    const d = this.camera.position.distanceTo(at);
    return (2 * d * Math.tan(THREE.MathUtils.degToRad(this.persp.fov / 2))) / h;
  }

  // ───────────────────────────────────────────── scene sync

  sync() {
    const st = useStore.getState();
    const project = st.project;
    const analysis = st.strength ? analyze(project) : null;
    const seen = new Set<string>();

    for (const part of project.parts) {
      seen.add(part.id);
      let o = this.objs.get(part.id);
      if (!o) {
        o = this.createObj(part);
        this.objs.set(part.id, o);
      } else if (o.part !== part) {
        if (o.key !== geomKey(part)) this.rebuild(o, part);
        o.part = part;
      }
    }
    for (const [id, o] of this.objs) {
      if (!seen.has(id)) {
        this.partsRoot.remove(o.holder);
        o.mesh.geometry.dispose();
        o.edges.geometry.dispose();
        o.outline?.geometry.dispose();
        this.objs.delete(id);
      }
    }

    // explode offsets
    const centers = new Map<string, THREE.Vector3>();
    const all = boxOfParts(project.parts);
    const overall = all ? new THREE.Vector3(...boxCenter(all)) : new THREE.Vector3();
    if (st.explode > 0) {
      for (const g of project.groups) {
        const bb = boxOfParts(project.parts.filter((p) => p.groupId === g.id));
        if (bb) centers.set(g.id, new THREE.Vector3(...boxCenter(bb)));
      }
    }

    const selIds = new Set(selectedPartIds(st));
    for (const o of this.objs.values()) {
      const p = o.part;
      const c = new THREE.Vector3(p.pos[0] + p.size[0] / 2, p.pos[1] + p.size[1] / 2, p.pos[2] + p.size[2] / 2);
      if (st.explode > 0) {
        const gc = (p.groupId && centers.get(p.groupId)) || overall;
        const off = c.clone().sub(gc).multiplyScalar(st.explode * 0.9);
        off.y = Math.max(off.y, -c.y + p.size[1] / 2);
        o.holder.position.copy(c).add(off);
      } else {
        o.holder.position.copy(c);
      }
      const res = analysis?.parts.get(p.id);
      this.applyMaterial(o, res, !!analysis);
      this.applyDeform(o, analysis ? res : undefined);
      this.applyOutline(o, selIds.has(p.id) && st.selection.kind !== 'group');
      o.edges.material = this.hoverId === p.id ? this.hoverEdgeMat : this.edgeMat;
    }

    this.fitShadow(all);
    this.updateGizmo(st, selIds);
    this.buildOverlay(st, analysis);
    this.dirty = true;
  }

  private createObj(part: Part): PartObj {
    const holder = new THREE.Group();
    const wm = woodMaterials(part.wood);
    const geo = buildPartGeometry(part, wm.tile, beamAxis(part));
    const mesh = new THREE.Mesh(geo, wm.mats);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.partId = part.id;
    const eg = new THREE.EdgesGeometry(geo, 25);
    const edges = new THREE.LineSegments(eg, this.edgeMat);
    edges.raycast = () => {};
    holder.add(mesh, edges);
    this.partsRoot.add(holder);
    return {
      part,
      key: geomKey(part),
      holder,
      mesh,
      edges,
      baseMesh: (geo.getAttribute('position').array as Float32Array).slice(),
      baseEdges: (eg.getAttribute('position').array as Float32Array).slice(),
      deformed: false,
      outline: null,
      matKey: '',
    };
  }

  private rebuild(o: PartObj, part: Part) {
    const wm = woodMaterials(part.wood);
    o.mesh.geometry.dispose();
    o.edges.geometry.dispose();
    const geo = buildPartGeometry(part, wm.tile, beamAxis(part));
    o.mesh.geometry = geo;
    const eg = new THREE.EdgesGeometry(geo, 25);
    o.edges.geometry = eg;
    o.baseMesh = (geo.getAttribute('position').array as Float32Array).slice();
    o.baseEdges = (eg.getAttribute('position').array as Float32Array).slice();
    o.deformed = false;
    o.key = geomKey(part);
    o.matKey = '';
    if (o.outline) {
      o.holder.remove(o.outline);
      o.outline.geometry.dispose();
      o.outline = null;
    }
  }

  private heatMat(U: number) {
    const key = (Math.round(Math.min(U, 3) * 40) / 40).toFixed(3);
    let m = this.heatMats.get(key);
    if (!m) {
      const c = heatColor(U);
      m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, emissive: c, emissiveIntensity: 0.12 });
      this.heatMats.set(key, m);
    }
    return m;
  }

  private applyMaterial(o: PartObj, res: PartResult | undefined, strength: boolean) {
    let key: string;
    let mat: THREE.Material | THREE.Material[];
    if (!strength) {
      key = `w:${o.part.wood}`;
      mat = woodMaterials(o.part.wood).mats;
    } else if (!res || res.status === 'front') {
      key = 'ghost';
      mat = this.ghostMat;
    } else if (res.status === 'anchored') {
      key = 'wall';
      mat = this.wallMat;
    } else if (res.status === 'supported' || res.status === 'attached') {
      key = res.member === 'column' ? `h:${res.U.toFixed(3)}` : 'neutral';
      mat = res.member === 'column' ? this.heatMat(res.U) : this.neutralMat;
    } else if (res.status === 'floating') {
      key = 'float';
      mat = this.heatMat(3);
    } else {
      key = `h:${res.U.toFixed(3)}`;
      mat = this.heatMat(res.U);
    }
    if (key === o.matKey) return;
    o.matKey = key;
    o.mesh.material = mat;
    o.mesh.castShadow = key !== 'ghost';
  }

  private applyDeform(o: PartObj, res: PartResult | undefined) {
    const want = !!res && res.segments.length > 0 && res.axis !== undefined && beamAxis(o.part) === res.axis;
    if (!want && !o.deformed) return;
    const mp = o.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const ep = o.edges.geometry.getAttribute('position') as THREE.BufferAttribute;
    if (!want) {
      (mp.array as Float32Array).set(o.baseMesh);
      (ep.array as Float32Array).set(o.baseEdges);
      mp.needsUpdate = ep.needsUpdate = true;
      o.mesh.geometry.computeVertexNormals();
      o.deformed = false;
      return;
    }
    const a = res!.axis!;
    const c = o.part.pos[a] + o.part.size[a] / 2;
    const apply = (attr: THREE.BufferAttribute, base: Float32Array) => {
      const arr = attr.array as Float32Array;
      for (let i = 0; i < arr.length; i += 3) {
        const s = base[i + a] + c;
        arr[i] = base[i];
        arr[i + 1] = base[i + 1] - shapeAt(s, res!.segments);
        arr[i + 2] = base[i + 2];
      }
      attr.needsUpdate = true;
    };
    apply(mp, o.baseMesh);
    apply(ep, o.baseEdges);
    o.mesh.geometry.computeVertexNormals();
    o.mesh.geometry.computeBoundingSphere();
    o.deformed = true;
  }

  private applyOutline(o: PartObj, on: boolean) {
    if (on && !o.outline) {
      const g = new LineSegmentsGeometry();
      g.setPositions(o.edges.geometry.getAttribute('position').array as Float32Array);
      o.outline = new LineSegments2(g, this.selMat);
      o.outline.renderOrder = 900;
      o.outline.raycast = () => {};
      o.holder.add(o.outline);
    } else if (!on && o.outline) {
      o.holder.remove(o.outline);
      o.outline.geometry.dispose();
      o.outline = null;
    }
  }

  private fitShadow(bb: Box3 | null) {
    const c = bb ? new THREE.Vector3(...boxCenter(bb)) : new THREE.Vector3();
    const s = bb ? boxSize(bb) : [1000, 1000, 1000];
    const R = Math.max(1200, Math.hypot(s[0], s[1], s[2]) * 0.75);
    this.sun.position.copy(c).add(new THREE.Vector3(0.45, 1, 0.6).normalize().multiplyScalar(R * 3));
    this.sun.target.position.copy(c);
    const cam = this.sun.shadow.camera;
    cam.left = -R;
    cam.right = R;
    cam.top = R;
    cam.bottom = -R;
    cam.near = R * 0.5;
    cam.far = R * 6;
    cam.updateProjectionMatrix();
  }

  // ───────────────────────────────────────────── gizmo + handles + labels

  private selectionBox(ids: Set<string>): Box3 | null {
    return boxOfParts(useStore.getState().project.parts.filter((p) => ids.has(p.id)));
  }

  private updateGizmo(st: ReturnType<typeof useStore.getState>, ids: Set<string>) {
    if (this.moveDrag) return;
    const show = st.tool === 'move' && ids.size > 0 && st.explode === 0;
    if (!show) {
      if (this.tc.object) this.tc.detach();
      return;
    }
    const bb = this.selectionBox(ids)!;
    // at the base, front edge: clear of the parts you click to select
    this.pivot.position.set((bb.min[0] + bb.max[0]) / 2, bb.min[1], bb.max[2]);
    this.pivot.updateMatrixWorld();
    if (this.tc.object !== this.pivot) this.tc.attach(this.pivot);
  }

  private resizeTarget(st: ReturnType<typeof useStore.getState>): { part?: Part; groupId?: string } | null {
    const sel = st.selection;
    if (sel.kind === 'parts' && sel.ids.length === 1) {
      const part = st.project.parts.find((p) => p.id === sel.ids[0]);
      return part ? { part } : null;
    }
    if (sel.kind === 'group') {
      const g = st.project.groups.find((x) => x.id === sel.id);
      if (g && g.template && !g.custom) return { groupId: g.id };
    }
    return null;
  }

  private buildOverlay(st: ReturnType<typeof useStore.getState>, analysis: ReturnType<typeof analyze> | null) {
    // clear
    for (const l of this.labels) {
      l.removeFromParent();
      l.element.remove();
    }
    this.labels = [];
    this.overlay.clear();
    this.handles = [];
    if (this.resizeDrag) {
      // keep the active handle alive while dragging
      this.overlay.add(this.resizeDrag.h.mesh);
      this.handles.push(this.resizeDrag.h);
    }

    const ids = new Set(selectedPartIds(st));
    const bb = ids.size ? this.selectionBox(ids) : null;

    // resize handles
    if (!this.resizeDrag && st.tool === 'resize' && st.explode === 0 && bb) {
      const tgt = this.resizeTarget(st);
      if (tgt) {
        const sphere = new THREE.SphereGeometry(1, 20, 14);
        const c = boxCenter(bb);
        const hidden = st.view === 'front' ? 2 : st.view === 'side' ? 0 : st.view === 'top' ? 1 : -1;
        for (let k = 0; k < 3; k++) {
          if (k === hidden) continue;
          if (tgt.part?.shape === 'rod') {
            const s = tgt.part.size;
            const len = s[0] >= s[1] && s[0] >= s[2] ? 0 : s[2] >= s[1] ? 2 : 1;
            if (k !== len) continue;
          }
          for (const sign of [1, -1] as const) {
            const base = new THREE.Vector3(...c);
            base.setComponent(k, sign > 0 ? bb.max[k] : bb.min[k]);
            const mesh = new THREE.Mesh(sphere, this.handleMat);
            const ring = new THREE.Mesh(sphere, this.handleRing);
            ring.scale.setScalar(1.28);
            ring.raycast = () => {};
            mesh.add(ring);
            mesh.renderOrder = 1001;
            ring.renderOrder = 1000;
            mesh.userData.handle = true;
            this.overlay.add(mesh);
            this.handles.push({ mesh, axis: k, sign, base });
          }
        }
      }
    }

    // a whole furniture piece is outlined by its bounding box
    if (bb && st.selection.kind === 'group') {
      const [x0, y0, z0] = bb.min.map((v) => v - 3);
      const [x1, y1, z1] = bb.max.map((v) => v + 3);
      const c = [
        [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1],
        [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1],
      ];
      const e = [0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7];
      const g = new LineSegmentsGeometry();
      g.setPositions(e.flatMap((i) => c[i]));
      const box = new LineSegments2(g, this.selMat);
      box.renderOrder = 900;
      box.raycast = () => {};
      if (st.explode === 0) this.overlay.add(box);
    }

    // dimensions (tape measures)
    if (st.dims && bb && st.explode === 0) this.buildDims(st, bb);

    // strength labels
    if (analysis) {
      const show: PartResult[] = [];
      analysis.parts.forEach((r) => {
        const checked = r.member === 'beam' && r.segments.length > 0 && ['ok', 'warn', 'bad'].includes(r.status);
        if ((checked && (r.live > 0 || r.status !== 'ok')) || r.status === 'floating') show.push(r);
      });
      const crowded = show.length > 36;
      for (const r of show) {
        if (crowded && r.status === 'ok') continue;
        const o = this.objs.get(r.id);
        if (!o) continue;
        const el = document.createElement('button');
        el.type = 'button';
        el.className = `load-pill s-${r.status}`;
        if (r.status === 'floating') el.innerHTML = '<i></i>לא מחובר';
        else el.innerHTML = `<i></i>${fmtKg(r.maxLive)}`;
        el.title = o.part.name;
        el.addEventListener('pointerdown', (e) => e.stopPropagation());
        el.addEventListener('click', () => useStore.getState().select({ kind: 'parts', ids: [r.id] }));
        const lab = new CSS2DObject(el);
        lab.position.set(0, o.part.size[1] / 2 + 6, 0);
        lab.center.set(0.5, 1);
        o.holder.add(lab);
        this.labels.push(lab);
      }
    }
  }

  private buildDims(st: ReturnType<typeof useStore.getState>, bb: Box3) {
    const size = boxSize(bb);
    const off = THREE.MathUtils.clamp(Math.max(...size) * 0.07, 35, 140);
    const tick = off * 0.35;
    const pts: number[] = [];
    const seg = (a: THREE.Vector3, b: THREE.Vector3) => pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
    const tgt = this.resizeTarget(st);
    const g = tgt?.groupId ? st.project.groups.find((x) => x.id === tgt.groupId) : null;
    const editable = !!tgt;
    const y0 = bb.min[1];
    // X: along the front bottom edge
    const xa = new THREE.Vector3(bb.min[0], y0, bb.max[2] + off);
    const xb = new THREE.Vector3(bb.max[0], y0, bb.max[2] + off);
    seg(xa, xb);
    seg(xa.clone().setZ(bb.max[2] + off - tick), xa.clone().setZ(bb.max[2] + off + tick));
    seg(xb.clone().setZ(bb.max[2] + off - tick), xb.clone().setZ(bb.max[2] + off + tick));
    // Y: vertical at the front right edge
    const ya = new THREE.Vector3(bb.max[0] + off, bb.min[1], bb.max[2]);
    const yb = new THREE.Vector3(bb.max[0] + off, bb.max[1], bb.max[2]);
    seg(ya, yb);
    seg(ya.clone().setX(bb.max[0] + off - tick), ya.clone().setX(bb.max[0] + off + tick));
    seg(yb.clone().setX(bb.max[0] + off - tick), yb.clone().setX(bb.max[0] + off + tick));
    // Z: along the right bottom edge
    const za = new THREE.Vector3(bb.max[0] + off, y0, bb.min[2]);
    const zb = new THREE.Vector3(bb.max[0] + off, y0, bb.max[2]);
    seg(za, zb);
    seg(za.clone().setX(bb.max[0] + off - tick), za.clone().setX(bb.max[0] + off + tick));
    seg(zb.clone().setX(bb.max[0] + off - tick), zb.clone().setX(bb.max[0] + off + tick));
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.7, depthTest: false }));
    lines.renderOrder = 800;
    lines.raycast = () => {};
    this.overlay.add(lines);

    const mids = [xa.clone().lerp(xb, 0.5), ya.clone().lerp(yb, 0.5), za.clone().lerp(zb, 0.5)];
    const names = ['רוחב', 'גובה', 'עומק'];
    const hidden = st.view === 'front' ? 2 : st.view === 'side' ? 0 : st.view === 'top' ? 1 : -1;
    for (let k = 0; k < 3; k++) {
      if (k === hidden) continue;
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'tape' + (editable ? ' editable' : '');
      el.setAttribute('aria-label', `${names[k]} ${fmt(size[k])} מ״מ`);
      el.innerHTML = `<span>${fmt(size[k])}</span>`;
      el.addEventListener('pointerdown', (e) => e.stopPropagation());
      if (editable) {
        el.addEventListener('click', () => this.editDim(el, k, size[k], tgt!, g?.rot ?? 0));
      }
      const lab = new CSS2DObject(el);
      lab.position.copy(mids[k]);
      this.overlay.add(lab);
      this.labels.push(lab);
    }
  }

  private editDim(el: HTMLElement, axis: number, value: number, tgt: { part?: Part; groupId?: string }, rot: number) {
    if (el.querySelector('input')) return;
    el.innerHTML = '';
    const input = document.createElement('input');
    input.value = fmt(value);
    input.inputMode = 'decimal';
    input.className = 'tape-input';
    el.appendChild(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (apply: boolean) => {
      if (done) return;
      done = true;
      const v = parseFloat(input.value.replace(',', '.'));
      if (apply && Number.isFinite(v) && v >= 1 && Math.abs(v - value) > 0.01) {
        const st = useStore.getState();
        if (tgt.part) {
          const size = [...tgt.part.size] as Vec3;
          if (tgt.part.shape === 'rod' && axis !== beamAxisOrLen(tgt.part)) {
            for (let k = 0; k < 3; k++) if (k !== beamAxisOrLen(tgt.part)) size[k] = v;
          } else size[axis] = v;
          st.updatePart(tgt.part.id, { size });
        } else if (tgt.groupId) {
          st.setGroupParam(tgt.groupId, axisParam(rot, axis), Math.round(v));
        }
      } else {
        this.sync();
      }
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
  }

  private placeHandles() {
    for (const h of this.handles) {
      const px = this.pxSize(h.base);
      h.mesh.scale.setScalar(px * 8);
      const dir = new THREE.Vector3();
      dir.setComponent(h.axis, h.sign);
      h.mesh.position.copy(h.base).addScaledVector(dir, px * 22);
    }
  }

  // ───────────────────────────────────────────── move

  private snapThreshold() {
    return THREE.MathUtils.clamp(this.pxSize(this.controls.target) * 10, 3, 60);
  }

  private startMove() {
    const st = useStore.getState();
    const ids = new Set(selectedPartIds(st));
    if (!ids.size) return;
    st.beginTransient();
    const start = new Map<string, Vec3>();
    for (const p of st.project.parts) if (ids.has(p.id)) start.set(p.id, [...p.pos] as Vec3);
    const sel = st.selection;
    const origin = sel.kind === 'group' ? ([...st.project.groups.find((g) => g.id === sel.id)!.origin] as Vec3) : null;
    this.moveDrag = { start, origin, pivot0: this.pivot.position.clone(), box: this.selectionBox(ids)!, ids };
  }

  private applyMove() {
    const d = this.moveDrag;
    if (!d) return;
    const raw = this.pivot.position.clone().sub(d.pivot0);
    const delta = this.snapMove([raw.x, raw.y, raw.z], d.box, d.ids);
    const st = useStore.getState();
    const sel = st.selection;
    st.transient((p: Project) => {
      const parts = p.parts.map((x) => {
        const s = d.start.get(x.id);
        return s ? { ...x, pos: [r1(s[0] + delta[0]), r1(s[1] + delta[1]), r1(s[2] + delta[2])] as Vec3 } : x;
      });
      let next: Project = { ...p, parts };
      if (sel.kind === 'group' && d.origin) {
        next.groups = p.groups.map((g) =>
          g.id === sel.id ? { ...g, origin: [r1(d.origin![0] + delta[0]), r1(d.origin![1] + delta[1]), r1(d.origin![2] + delta[2])] as Vec3 } : g,
        );
      } else {
        next = markCustom(next, [...d.ids]);
      }
      return next;
    });
  }

  private snapMove(delta: number[], box: Box3, exclude: Set<string>): number[] {
    const thr = this.snapThreshold();
    const out = [...delta];
    const others = useStore
      .getState()
      .project.parts.filter((p) => !exclude.has(p.id))
      .map((p) => ({ min: p.pos, max: [p.pos[0] + p.size[0], p.pos[1] + p.size[1], p.pos[2] + p.size[2]] }));
    const collides = (o: number[]) =>
      others.some((q) => [0, 1, 2].every((j) => Math.min(q.max[j], box.max[j] + o[j]) - Math.max(q.min[j], box.min[j] + o[j]) > 1));
    for (let k = 0; k < 3; k++) {
      if (Math.abs(delta[k]) < 1e-6) continue;
      const lo = box.min[k] + out[k];
      const hi = box.max[k] + out[k];
      const cands: number[] = [];
      if (k === 1) cands.push(-lo);
      for (const o of others) {
        let near = true;
        for (let j = 0; j < 3; j++) {
          if (j === k) continue;
          const gap = Math.max(o.min[j] - (box.max[j] + out[j]), box.min[j] + out[j] - o.max[j]);
          if (gap > 250) near = false;
        }
        if (!near) continue;
        cands.push(o.max[k] - lo, o.min[k] - hi, o.min[k] - lo, o.max[k] - hi);
      }
      cands.sort((a, b) => Math.abs(a) - Math.abs(b));
      let snapped = false;
      for (const d of cands) {
        if (Math.abs(d) > thr) break;
        const trial = [...out];
        trial[k] += d;
        // never snap one part into another
        if (collides(trial)) continue;
        out[k] = trial[k];
        snapped = true;
        break;
      }
      if (!snapped) out[k] = Math.round(out[k] / 5) * 5;
    }
    if (box.min[1] + out[1] < 0) out[1] = -box.min[1];
    return out;
  }

  private snapScalar(v: number, axis: number, exclude: Set<string>): number {
    const thr = this.snapThreshold();
    let best = Infinity;
    if (axis === 1 && Math.abs(v) < Math.abs(best)) best = -v;
    for (const p of useStore.getState().project.parts) {
      if (exclude.has(p.id)) continue;
      for (const t of [p.pos[axis], p.pos[axis] + p.size[axis]]) {
        if (Math.abs(t - v) < Math.abs(best)) best = t - v;
      }
    }
    if (Math.abs(best) <= thr) return v + best;
    return Math.round(v);
  }

  // ───────────────────────────────────────────── pointer

  private ndc(e: PointerEvent) {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  private pick(e: PointerEvent): string | null {
    this.raycaster.setFromCamera(this.ndc(e), this.camera);
    const meshes = [...this.objs.values()].map((o) => o.mesh);
    const hits = this.raycaster.intersectObjects(meshes, false);
    const strength = useStore.getState().strength;
    for (const h of hits) {
      const id = h.object.userData.partId as string;
      // in strength view, click through ghosted doors
      if (strength && this.objs.get(id)?.matKey === 'ghost') continue;
      return id;
    }
    return null;
  }

  private pickHandle(e: PointerEvent): Handle | null {
    if (!this.handles.length) return null;
    this.raycaster.setFromCamera(this.ndc(e), this.camera);
    const hits = this.raycaster.intersectObjects(
      this.handles.map((h) => h.mesh),
      false,
    );
    if (!hits.length) return null;
    return this.handles.find((h) => h.mesh === hits[0].object) ?? null;
  }

  /** capture phase: resize handles win over orbiting */
  private onDownCapture = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const h = this.pickHandle(e);
    if (h) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.down = null;
      this.startResize(h, e);
    }
  };

  private onDown = (e: PointerEvent) => {
    const gizmo = this.tc.object !== undefined && (this.tc as unknown as { axis: string | null }).axis !== null;
    this.down = { x: e.clientX, y: e.clientY, t: performance.now(), gizmo };
  };

  private onMove = (e: PointerEvent) => {
    if (this.resizeDrag && e.pointerId === this.resizeDrag.pointerId) {
      this.dragResize(e);
      return;
    }
    if (e.pointerType === 'mouse' && e.buttons === 0) {
      const h = this.pickHandle(e);
      const id = h ? null : this.pick(e);
      this.renderer.domElement.style.cursor = h ? 'grab' : id ? 'pointer' : '';
      this.setHover(id);
    }
  };

  private onUp = (e: PointerEvent) => {
    if (this.resizeDrag && e.pointerId === this.resizeDrag.pointerId) {
      this.renderer.domElement.releasePointerCapture?.(e.pointerId);
      this.resizeDrag = null;
      this.controls.enabled = true;
      this.justDragged = performance.now();
      this.sync();
      return;
    }
    const d = this.down;
    this.down = null;
    if (!d || d.gizmo || e.button !== 0) return;
    if (performance.now() - this.justDragged < 250) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return;
    this.click(e);
  };

  private setHover(id: string | null) {
    if (id === this.hoverId) return;
    const prev = this.hoverId ? this.objs.get(this.hoverId) : null;
    if (prev) prev.edges.material = this.edgeMat;
    this.hoverId = id;
    const o = id ? this.objs.get(id) : null;
    if (o) o.edges.material = this.hoverEdgeMat;
    this.dirty = true;
  }

  private click(e: PointerEvent) {
    const st = useStore.getState();
    const id = this.pick(e);
    if (!id) {
      st.select({ kind: 'none' });
      return;
    }
    const part = st.project.parts.find((p) => p.id === id)!;
    const sel = st.selection;
    const now = performance.now();
    const dbl = this.lastClick && this.lastClick.id === id && now - this.lastClick.t < 380;
    this.lastClick = { id, t: now };
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      const cur = sel.kind === 'parts' ? sel.ids : sel.kind === 'group' ? selectedPartIds(st) : [];
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      st.select(next.length ? { kind: 'parts', ids: next } : { kind: 'none' });
      return;
    }
    if (part.groupId && !dbl) {
      const inGroup =
        (sel.kind === 'group' && sel.id === part.groupId) ||
        (sel.kind === 'parts' && sel.ids.some((x) => st.project.parts.find((p) => p.id === x)?.groupId === part.groupId));
      st.select(inGroup ? { kind: 'parts', ids: [id] } : { kind: 'group', id: part.groupId });
      return;
    }
    st.select({ kind: 'parts', ids: [id] });
  }

  // ───────────────────────────────────────────── resize drag

  private startResize(h: Handle, e: PointerEvent) {
    const st = useStore.getState();
    const tgt = this.resizeTarget(st);
    if (!tgt) return;
    const ids = new Set(selectedPartIds(st));
    const box = this.selectionBox(ids)!;
    const axis = new THREE.Vector3();
    axis.setComponent(h.axis, 1);
    const camDir = new THREE.Vector3();
    this.camera.getWorldDirection(camDir);
    const n = camDir.clone().sub(axis.clone().multiplyScalar(camDir.dot(axis)));
    if (n.lengthSq() < 1e-6) n.set(h.axis === 1 ? 0 : 0, h.axis === 1 ? 0 : 1, h.axis === 1 ? 1 : 0);
    n.normalize();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, h.base);
    this.raycaster.setFromCamera(this.ndc(e), this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(plane, hit)) return;
    const face = h.sign > 0 ? box.max[h.axis] : box.min[h.axis];
    st.beginTransient();
    this.controls.enabled = false;
    this.renderer.domElement.setPointerCapture?.(e.pointerId);
    this.resizeDrag = { h, plane, grab: hit.getComponent(h.axis) - face, part: tgt.part, groupId: tgt.groupId, box, pointerId: e.pointerId };
  }

  private dragResize(e: PointerEvent) {
    const d = this.resizeDrag!;
    this.raycaster.setFromCamera(this.ndc(e), this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(d.plane, hit)) return;
    const k = d.h.axis;
    const st = useStore.getState();
    const exclude = new Set(selectedPartIds(st));
    let face = this.snapScalar(hit.getComponent(k) - d.grab, k, exclude);
    if (d.part) {
      const p = d.part;
      const size = [...p.size] as Vec3;
      const pos = [...p.pos] as Vec3;
      if (d.h.sign > 0) size[k] = Math.max(3, face - p.pos[k]);
      else {
        face = Math.min(face, p.pos[k] + p.size[k] - 3);
        if (k === 1) face = Math.max(0, face);
        size[k] = p.pos[k] + p.size[k] - face;
        pos[k] = face;
      }
      if (p.shape === 'rod' && k !== beamAxisOrLen(p)) return;
      st.transient((pr) => markCustom({ ...pr, parts: pr.parts.map((x) => (x.id === p.id ? { ...x, size: size.map(r1) as Vec3, pos: pos.map(r1) as Vec3 } : x)) }, [p.id]));
    } else if (d.groupId) {
      const size = d.h.sign > 0 ? face - d.box.min[k] : d.box.max[k] - face;
      st.resizeGroupAxis(d.groupId, k, Math.max(120, size), d.h.sign < 0);
    }
    // move the grabbed handle with the face
    const nb = this.selectionBox(exclude);
    if (nb) {
      const c = boxCenter(nb);
      d.h.base.set(c[0], c[1], c[2]).setComponent(k, d.h.sign > 0 ? nb.max[k] : nb.min[k]);
    }
    this.dirty = true;
  }

  // ───────────────────────────────────────────── camera

  private contentBox(selectionOnly: boolean): Box3 | null {
    const st = useStore.getState();
    if (selectionOnly) {
      const ids = new Set(selectedPartIds(st));
      if (ids.size) return this.selectionBox(ids);
    }
    return boxOfParts(st.project.parts);
  }

  frame(animate = true, selectionOnly = true) {
    const bb = this.contentBox(selectionOnly) ?? { min: [-500, 0, -300], max: [500, 1000, 300] };
    const c = new THREE.Vector3(...boxCenter(bb));
    const s = boxSize(bb);
    const radius = Math.max(250, Math.hypot(s[0], s[1], s[2]) / 2);
    if (this.camera === this.persp) {
      const dir = this.camera.position.clone().sub(this.controls.target).normalize();
      if (dir.lengthSq() < 0.5) dir.copy(this.viewDir);
      const dist = (radius / Math.sin(THREE.MathUtils.degToRad(this.persp.fov / 2))) * 1.25;
      const to = c.clone().addScaledVector(dir, dist);
      this.animateTo(to, c, animate);
    } else {
      const view = useStore.getState().view;
      this.orthoFit(bb, view);
    }
  }

  private animateTo(pos: THREE.Vector3, target: THREE.Vector3, animate: boolean) {
    if (!animate || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.controls.update();
      this.dirty = true;
      return;
    }
    this.anim = { p0: this.camera.position.clone(), p1: pos, t0v: this.controls.target.clone(), t1v: target.clone(), start: performance.now(), dur: 520 };
  }

  private orthoFit(bb: Box3, view: ViewMode) {
    const c = new THREE.Vector3(...boxCenter(bb));
    const s = boxSize(bb);
    const w = Math.max(1, this.el.clientWidth);
    const h = Math.max(1, this.el.clientHeight);
    const a = w / h;
    let sw: number;
    let sh: number;
    if (view === 'front') [sw, sh] = [s[0], s[1]];
    else if (view === 'side') [sw, sh] = [s[2], s[1]];
    else [sw, sh] = [s[0], s[2]];
    this.orthoHalf = Math.max(300, Math.max(sh, sw / a) * 0.68);
    this.ortho.zoom = 1;
    this.updateOrtho();
    const dir = view === 'front' ? new THREE.Vector3(0, 0, 1) : view === 'side' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0.0001);
    this.ortho.position.copy(c).addScaledVector(dir, 20000);
    this.controls.target.copy(c);
    this.ortho.lookAt(c);
    this.controls.update();
    this.dirty = true;
  }

  setView(view: ViewMode) {
    const bb = this.contentBox(false) ?? { min: [-500, 0, -300], max: [500, 1000, 300] };
    if (view === 'persp') {
      this.camera = this.persp;
      this.controls.object = this.persp;
      this.tc.camera = this.persp;
      this.controls.enableRotate = true;
      this.controls.maxPolarAngle = Math.PI * 0.495;
      const c = new THREE.Vector3(...boxCenter(bb));
      const s = boxSize(bb);
      const radius = Math.max(250, Math.hypot(s[0], s[1], s[2]) / 2);
      const dist = (radius / Math.sin(THREE.MathUtils.degToRad(this.persp.fov / 2))) * 1.25;
      this.animateTo(c.clone().addScaledVector(this.viewDir, dist), c, true);
    } else {
      if (this.camera === this.persp) this.viewDir.copy(this.persp.position.clone().sub(this.controls.target).normalize());
      this.anim = null;
      this.camera = this.ortho;
      this.controls.object = this.ortho;
      this.tc.camera = this.ortho;
      this.controls.enableRotate = false;
      this.controls.maxPolarAngle = Math.PI;
      this.orthoFit(bb, view);
    }
    this.sync();
  }

  zoomBy(f: number) {
    if (this.camera === this.ortho) {
      this.ortho.zoom = THREE.MathUtils.clamp(this.ortho.zoom * f, 0.05, 40);
      this.ortho.updateProjectionMatrix();
    } else {
      const t = this.controls.target;
      const p = this.persp.position.clone().sub(t).multiplyScalar(1 / f);
      this.animateTo(t.clone().add(p), t.clone(), true);
    }
    this.dirty = true;
  }

  /** PNG data URL of the current view on the workshop background */
  snapshot(): string {
    const helper = this.tc.getHelper();
    const hv = helper.visible;
    helper.visible = false;
    this.overlay.visible = false;
    const outlines = [...this.objs.values()].map((o) => o.outline).filter(Boolean) as LineSegments2[];
    outlines.forEach((l) => (l.visible = false));
    this.renderer.render(this.scene, this.camera);
    const src = this.renderer.domElement;
    const c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    const ctx = c.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 0, c.height);
    g.addColorStop(0, '#dfe8e2');
    g.addColorStop(1, '#f4f7f2');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(src, 0, 0);
    helper.visible = hv;
    this.overlay.visible = true;
    outlines.forEach((l) => (l.visible = true));
    this.dirty = true;
    return c.toDataURL('image/png');
  }
}

const r1 = (v: number) => Math.round(v * 10) / 10;

const fmtKg = (v: number) => {
  if (!Number.isFinite(v)) return '∞';
  if (v >= 1000) return `${(v / 1000).toFixed(1)}<small>טון</small>`;
  return `${Math.floor(v)}<small>ק״ג</small>`;
};

const beamAxisOrLen = (p: Part) => (p.size[0] >= p.size[1] && p.size[0] >= p.size[2] ? 0 : p.size[2] >= p.size[1] ? 2 : 1);
