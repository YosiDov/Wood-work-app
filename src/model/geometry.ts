import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import type { Part, Quat, Vec3 } from './types';

export interface Box3 {
  min: Vec3;
  max: Vec3;
}

export const uid = (): string => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);

// ───────────── rotation helpers

export const IDQ: Quat = [0, 0, 0, 1];

export const toQ = (q?: Quat) => (q ? new Quaternion(q[0], q[1], q[2], q[3]) : new Quaternion());
export const fromQ = (q: Quaternion): Quat => {
  const n = q.clone().normalize();
  return [n.x, n.y, n.z, n.w];
};

export const isIdentityQ = (q?: Quat) => !q || 1 - Math.abs(q[3]) < 1e-9;

export const partCenter = (p: Part): Vec3 => [p.pos[0] + p.size[0] / 2, p.pos[1] + p.size[1] / 2, p.pos[2] + p.size[2] / 2];

/** min corner for a box of `size` centred at `c` */
export const posFromCenter = (c: Vec3, size: Vec3): Vec3 => [c[0] - size[0] / 2, c[1] - size[1] / 2, c[2] - size[2] / 2];

/** world-axis bounding box of a box of `size` centred at `c`, rotated by `q` */
export const rotatedBox = (c: Vec3, size: Vec3, q?: Quat): Box3 => {
  if (isIdentityQ(q)) return { min: posFromCenter(c, size), max: [c[0] + size[0] / 2, c[1] + size[1] / 2, c[2] + size[2] / 2] };
  const m = new Matrix4().makeRotationFromQuaternion(toQ(q)).elements;
  // half-extent along world axis i = Σ_j |R_ij| · h_j   (column-major elements)
  const h = size.map((s) => s / 2);
  const ext = [0, 1, 2].map((i) => Math.abs(m[i]) * h[0] + Math.abs(m[4 + i]) * h[1] + Math.abs(m[8 + i]) * h[2]);
  return { min: [c[0] - ext[0], c[1] - ext[1], c[2] - ext[2]], max: [c[0] + ext[0], c[1] + ext[1], c[2] + ext[2]] };
};

export const partBox = (p: Part): Box3 => rotatedBox(partCenter(p), p.size, p.q);

export const boxOfParts = (parts: Part[]): Box3 | null => {
  if (!parts.length) return null;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) {
    const b = partBox(p);
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], b.min[k]);
      max[k] = Math.max(max[k], b.max[k]);
    }
  }
  return { min, max };
};

/**
 * If `q` only swaps axes (every 90° combination), fold it into the box size so the part stays a
 * plain axis-aligned board, which the strength check handles exactly.
 */
export const bakeQuarter = (size: Vec3, q?: Quat): { size: Vec3; q?: Quat } => {
  if (isIdentityQ(q)) return { size };
  const m = new Matrix4().makeRotationFromQuaternion(toQ(q)).elements;
  const out: Vec3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    let found = -1;
    for (let j = 0; j < 3; j++) {
      const v = Math.abs(m[j * 4 + i]);
      if (v > 1 - 1e-6) found = j;
      else if (v > 1e-6) return { size, q };
    }
    if (found < 0) return { size, q };
    out[i] = size[found];
  }
  return { size: out };
};

/**
 * For a part with one local axis pointing straight up: the yaw angle (reduced to [0°, 90°)) and the
 * box size in that yawed frame. Null when the part is tilted.
 */
export const levelFrame = (size: Vec3, q?: Quat): { theta: number; size: Vec3 } | null => {
  if (isIdentityQ(q)) return { theta: 0, size };
  const qq = toQ(q);
  const axes = [0, 1, 2].map((i) => new Vector3(i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0).applyQuaternion(qq));
  const v = axes.findIndex((a) => Math.abs(a.y) > 1 - 1e-6);
  if (v < 0) return null;
  const hs = [0, 1, 2].filter((i) => i !== v);
  // which local horizontal axis is closest to world X, and its yaw
  const a = axes[hs[0]];
  let theta = Math.atan2(-a.z, a.x);
  const Q = Math.PI / 2;
  let k = Math.floor(theta / Q);
  theta -= k * Q;
  if (theta > Q - 1e-6) {
    theta = 0;
    k += 1;
  }
  const sx = size[hs[0]];
  const sz = size[hs[1]];
  const swap = ((k % 2) + 2) % 2 === 1;
  return { theta: theta < 1e-6 ? 0 : theta, size: swap ? [sz, size[v], sx] : [sx, size[v], sz] };
};

/** yaw (about Y), then tilt forward (about X), then tilt sideways (about Z), in degrees */
export const quatToAngles = (q?: Quat): Vec3 => {
  const e = new Euler().setFromQuaternion(toQ(q), 'YXZ');
  const d = (r: number) => {
    const v = Math.round(((r * 180) / Math.PI) * 10) / 10;
    return Object.is(v, -0) ? 0 : v;
  };
  return [d(e.y), d(e.x), d(e.z)];
};

export const anglesToQuat = (a: Vec3): Quat | undefined => {
  const r = (deg: number) => (deg * Math.PI) / 180;
  const q = new Quaternion().setFromEuler(new Euler(r(a[1]), r(a[0]), r(a[2]), 'YXZ'));
  const out = fromQ(q);
  return isIdentityQ(out) ? undefined : out;
};

export const boxSize = (b: Box3): Vec3 => [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
export const boxCenter = (b: Box3): Vec3 => [(b.max[0] + b.min[0]) / 2, (b.max[1] + b.min[1]) / 2, (b.max[2] + b.min[2]) / 2];

/** length axis and width axis of a board (the end cuts turn about the remaining, thinnest axis) */
export const cutAxes = (s: Vec3): { len: number; wid: number } => {
  const o = [0, 1, 2].sort((a, b) => s[b] - s[a]);
  return { len: o[0], wid: o[1] };
};

export const hasCut = (p: { shape: Part['shape']; cut?: [number, number] }) => p.shape === 'box' && !!p.cut && (Math.abs(p.cut[0]) > 0.05 || Math.abs(p.cut[1]) > 0.05);

const tanD = (deg: number) => Math.tan((Math.max(-75, Math.min(75, deg)) * Math.PI) / 180);

/**
 * Move a point of the plain box (local, centred) onto the board with angled ends. The whole
 * length is remapped between the two cut faces so subdivided faces never fold.
 */
export const applyCut = (pt: number[], size: Vec3, cut?: [number, number]) => {
  if (!cut) return;
  const { len, wid } = cutAxes(size);
  const L = size[len] / 2;
  const w = size[wid] / 2;
  const u = pt[wid];
  const ta = tanD(cut[0]);
  const tb = tanD(cut[1]);
  const start = -L + w * Math.abs(ta) + u * ta;
  const end = L - w * Math.abs(tb) + u * tb;
  const s = (pt[len] + L) / (2 * L);
  pt[len] = start + s * (end - start);
};

/** volume in m³ */
export const partVolume = (p: Part): number => {
  if (p.shape === 'rod') {
    const ax = longestAxis(p.size);
    const others = [0, 1, 2].filter((k) => k !== ax).map((k) => p.size[k]);
    const d = Math.min(...others);
    return (Math.PI * d * d * 0.25 * p.size[ax]) / 1e9;
  }
  if (hasCut(p)) {
    const { len, wid } = cutAxes(p.size);
    const w = p.size[wid];
    const avg = p.size[len] - (w / 2) * (Math.abs(tanD(p.cut![0])) + Math.abs(tanD(p.cut![1])));
    return (Math.max(0, avg) * w * p.size[3 - len - wid]) / 1e9;
  }
  return (p.size[0] * p.size[1] * p.size[2]) / 1e9;
};

export const longestAxis = (s: Vec3): 0 | 1 | 2 => {
  if (s[0] >= s[1] && s[0] >= s[2]) return 0;
  if (s[2] >= s[1]) return 2;
  return 1;
};

export const shortestAxis = (s: Vec3): 0 | 1 | 2 => {
  if (s[1] <= s[0] && s[1] <= s[2]) return 1;
  if (s[2] <= s[0]) return 2;
  return 0;
};

/** board dimensions sorted: length ≥ width ≥ thickness */
export const sortedDims = (s: Vec3): [number, number, number] => {
  const a = [...s].sort((x, y) => y - x);
  return [a[0], a[1], a[2]];
};

/** Rotate a local box by quarter turns about Y inside a W×D footprint. */
export const rotateBoxY = (pos: Vec3, size: Vec3, W: number, D: number, rot: number): { pos: Vec3; size: Vec3 } => {
  const r = ((rot % 4) + 4) % 4;
  const [x0, y0, z0] = pos;
  const [sx, sy, sz] = size;
  switch (r) {
    case 1:
      return { pos: [z0, y0, W - (x0 + sx)], size: [sz, sy, sx] };
    case 2:
      return { pos: [W - x0 - sx, y0, D - z0 - sz], size: [sx, sy, sz] };
    case 3:
      return { pos: [D - z0 - sz, y0, x0], size: [sz, sy, sx] };
    default:
      return { pos: [x0, y0, z0], size: [sx, sy, sz] };
  }
};

export const hashSeed = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
};

export const round1 = (v: number) => Math.round(v * 10) / 10;

/** Evaluate simple arithmetic typed into a number field: "900-2*18" */
export const evalNumber = (text: string): number | null => {
  const t = text.replace(/,/g, '.').replace(/[×x]/g, '*').replace(/÷/g, '/').trim();
  if (!t) return null;
  if (!/^[0-9+\-*/().\s]+$/.test(t)) return null;
  const src = t.replace(/\s+/g, '');
  let i = 0;
  const peek = () => src[i];
  const num = (): number => {
    if (peek() === '(') {
      i++;
      const v = expr();
      if (peek() !== ')') throw new Error('paren');
      i++;
      return v;
    }
    if (peek() === '-') {
      i++;
      return -num();
    }
    const m = /^[0-9]*\.?[0-9]+/.exec(src.slice(i));
    if (!m) throw new Error('num');
    i += m[0].length;
    return parseFloat(m[0]);
  };
  const term = (): number => {
    let v = num();
    while (peek() === '*' || peek() === '/') {
      const op = src[i++];
      const r = num();
      v = op === '*' ? v * r : v / r;
    }
    return v;
  };
  const expr = (): number => {
    let v = term();
    while (peek() === '+' || peek() === '-') {
      const op = src[i++];
      const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };
  try {
    const v = expr();
    if (i !== src.length) return null;
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
};
