import * as THREE from 'three';
import type { Part } from '../model/types';
import { wood } from '../model/woods';
import { applyCut, hasCut, longestAxis, shortestAxis } from '../model/geometry';

/**
 * Box geometry centred at the origin with UVs in real millimetres, so the grain runs along the
 * board's length and keeps the same scale on every part. Group 0 = long grain / panel face,
 * group 1 = end grain / panel edge. Faces are subdivided along `bendAxis` so the part can be bent
 * to show sag.
 */
export const buildPartGeometry = (
  part: Part,
  tile: [[number, number], [number, number]],
  bendAxis: number | null,
  segs = 24,
): THREE.BufferGeometry => {
  if (part.shape === 'rod') return buildRod(part, tile, segs);
  const size = part.size;
  const grain = longestAxis(size);
  const thin = shortestAxis(size);
  const panel = wood(part.wood).kind === 'panel';
  const off = [part.seed * 7919, part.seed * 3571];

  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: [number[], number[]] = [[], []];

  for (let n = 0; n < 3; n++) {
    for (const s of [1, -1]) {
      const a = (n + 1) % 3;
      const b = (n + 2) % 3;
      let group: 0 | 1;
      let uAxis: number;
      let vAxis: number;
      if (panel) {
        if (n === thin) {
          group = 0;
          uAxis = grain === n ? a : grain;
          vAxis = 3 - n - uAxis;
        } else {
          group = 1;
          vAxis = thin;
          uAxis = 3 - n - thin;
        }
      } else if (n === grain) {
        group = 1;
        uAxis = a;
        vAxis = b;
      } else {
        group = 0;
        uAxis = grain;
        vAxis = 3 - n - grain;
      }
      const [tw, th] = tile[group];
      const na = a === bendAxis ? segs : 1;
      const nb = b === bendAxis ? segs : 1;
      const start = pos.length / 3;
      for (let j = 0; j <= nb; j++) {
        for (let i = 0; i <= na; i++) {
          const p = [0, 0, 0];
          p[n] = (s * size[n]) / 2;
          p[a] = -size[a] / 2 + (i / na) * size[a];
          p[b] = -size[b] / 2 + (j / nb) * size[b];
          pos.push(p[0], p[1], p[2]);
          const nn = [0, 0, 0];
          nn[n] = s;
          nor.push(nn[0], nn[1], nn[2]);
          uv.push((p[uAxis] + off[0] + size[uAxis] / 2) / tw, (p[vAxis] + off[1] + size[vAxis] / 2) / th);
        }
      }
      for (let j = 0; j < nb; j++) {
        for (let i = 0; i < na; i++) {
          const v00 = start + j * (na + 1) + i;
          const v10 = v00 + 1;
          const v01 = v00 + (na + 1);
          const v11 = v01 + 1;
          if (s > 0) idx[group].push(v00, v10, v11, v00, v11, v01);
          else idx[group].push(v00, v11, v10, v00, v01, v11);
        }
      }
    }
  }
  if (hasCut(part)) {
    const pt = [0, 0, 0];
    for (let i = 0; i < pos.length; i += 3) {
      pt[0] = pos[i];
      pt[1] = pos[i + 1];
      pt[2] = pos[i + 2];
      applyCut(pt, size, part.cut);
      pos[i] = pt[0];
      pos[i + 1] = pt[1];
      pos[i + 2] = pt[2];
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex([...idx[0], ...idx[1]]);
  g.addGroup(0, idx[0].length, 0);
  g.addGroup(idx[0].length, idx[1].length, 1);
  if (hasCut(part)) g.computeVertexNormals();
  return g;
};

const buildRod = (part: Part, tile: [[number, number], [number, number]], segs: number) => {
  const ax = longestAxis(part.size);
  const others = [0, 1, 2].filter((k) => k !== ax);
  const d = Math.min(part.size[others[0]], part.size[others[1]]);
  const L = part.size[ax];
  const g = new THREE.CylinderGeometry(d / 2, d / 2, L, 28, segs, false);
  // remap side UVs: u along the length (grain), v around the circumference
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const posA = g.getAttribute('position') as THREE.BufferAttribute;
  const circ = Math.PI * d;
  const groups = g.groups;
  const side = groups[0];
  const sideIdx = new Set<number>();
  const index = g.getIndex()!;
  for (let i = side.start; i < side.start + side.count; i++) sideIdx.add(index.getX(i));
  for (let i = 0; i < uv.count; i++) {
    if (sideIdx.has(i)) {
      const u0 = uv.getX(i);
      const y = posA.getY(i);
      uv.setXY(i, (y + L / 2 + part.seed * 7919) / tile[0][0], (u0 * circ) / tile[0][1]);
    } else {
      uv.setXY(i, (posA.getX(i) + d) / tile[1][0], (posA.getZ(i) + d) / tile[1][1]);
    }
  }
  // groups: side = 0, caps = 1
  g.clearGroups();
  g.addGroup(side.start, side.count, 0);
  g.addGroup(groups[1].start, groups[1].count + groups[2].count, 1);
  if (ax === 0) g.rotateZ(Math.PI / 2);
  else if (ax === 2) g.rotateX(Math.PI / 2);
  return g;
};
