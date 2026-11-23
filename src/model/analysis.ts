import type { Part, Project, Vec3 } from './types';
import { wood } from './woods';
import { boxOfParts, levelFrame, partCenter, partVolume } from './geometry';

/*
 * Structural check, simplified Eurocode 5 (EN 1995-1-1) approach:
 *  - every structural part is a beam (longest side horizontal) or a column (longest side vertical)
 *  - supports are found from touching faces: a beam rests on parts below it, or is fixed between
 *    parts at its ends; a column stands on parts below it, the floor, or a wall-anchored part
 *  - loads flow top-down from each part to its supports (tributary lengths)
 *  - beams: each span checked as simply supported, each overhang as a cantilever
 *      ULS  σ = (1.35·M_G + 1.5·M_Q) / W  ≤  k_mod · f_m,k / γ_M
 *      SLS  δ_fin = δ_G·(1+k_def) + δ_Q·(1+ψ2·k_def)  ≤  L/300 (span), L/150 (cantilever)
 *    distributed loads are long-term (ψ2 = 1, k_mod long-term), point loads short-term (ψ2 = 0)
 *  - columns: EN 1995 6.3.2 buckling factor k_c with effective length between bracing points
 */

export type Status = 'ok' | 'warn' | 'bad' | 'floating' | 'attached' | 'supported' | 'anchored' | 'front' | 'angled';
export type Govern = 'sag' | 'stress' | 'buckle';

export interface Segment {
  kind: 'span' | 'cant';
  /** start/end coordinate along the beam axis (mm, world) */
  a: number;
  b: number;
  /** for cantilevers: which end is fixed */
  fixed?: 'a' | 'b';
  /** final deflection at the design load, mm */
  dFin: number;
  limit: number;
  U: number;
}

export interface PartResult {
  id: string;
  member: 'beam' | 'column' | 'none';
  status: Status;
  U: number;
  /** beam: largest safe live load (kg, total UDL or point); column: axial capacity kg */
  maxLive: number;
  live: number;
  liveAuto: boolean;
  received: number;
  selfKg: number;
  govern?: Govern;
  axis?: 0 | 2;
  segments: Segment[];
  sag?: number;
  sagLimit?: number;
  stress?: number;
  stressAllow?: number;
  E: number;
  I?: number;
  W?: number;
  span?: number;
  N?: number;
  Lef?: number;
  kc?: number;
  supports: string[];
  overlaps: string[];
  /** yaw of the frame the segments are measured in (radians) */
  frameYaw: number;
}

export interface Analysis {
  parts: Map<string, PartResult>;
  weight: number;
  cost: number;
  volume: number;
  bad: string[];
  warn: string[];
  floating: string[];
  overlaps: [string, string][];
  tipping: string[];
}

const G = 9.81;
const TOL = 0.75;
const FLOOR = 'floor';

interface Info {
  p: Part;
  /** box in the part's own level frame (turned by `theta` about Y) */
  min: number[];
  max: number[];
  size: Vec3;
  member: 'beam' | 'column' | 'none';
  axis: 0 | 2;
  theta: number;
  /** parts touch only when they share a frame; null = tilted */
  cls: number | null;
}

interface Support {
  id: string;
  lo: number;
  hi: number;
}

export const autoLoad = (p: Part, designLoad: number): number => {
  if (p.role !== 'structure' || p.anchored) return 0;
  const fr = levelFrame(p.size, p.q);
  if (!fr) return 0;
  const [sx, sy, sz] = fr.size;
  if (p.shape === 'rod') {
    if (sy >= Math.max(sx, sz)) return 0;
    return Math.round(25 * (Math.max(sx, sz) / 1000));
  }
  if (sy <= sx && sy <= sz) return Math.round((designLoad * sx * sz) / 1e6);
  return 0;
};

/** bending stiffness E·I about the horizontal axis, N·mm² */
const stiffness = (I: Info): number => {
  const p = I.p;
  const other = I.axis === 0 ? 2 : 0;
  const E = wood(p.wood).E;
  if (p.shape === 'rod') {
    const d = Math.min(I.size[1], I.size[other]);
    return (E * Math.PI * d ** 4) / 64;
  }
  return (E * I.size[other] * I.size[1] ** 3) / 12;
};

const overlap1 = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) - Math.max(a0, b0);

const cache = new WeakMap<Project, Analysis>();

export const analyze = (project: Project): Analysis => {
  const hit = cache.get(project);
  if (hit) return hit;
  const res = runAnalysis(project);
  cache.set(project, res);
  return res;
};

const runAnalysis = (project: Project): Analysis => {
  const parts = project.parts;
  const infos: Info[] = parts.map((p) => {
    const fr = levelFrame(p.size, p.q);
    const size = fr ? fr.size : p.size;
    const theta = fr ? fr.theta : 0;
    const c = partCenter(p);
    const cs = Math.cos(theta);
    const sn = Math.sin(theta);
    const fc = [cs * c[0] - sn * c[2], c[1], sn * c[0] + cs * c[2]];
    const min = [fc[0] - size[0] / 2, fc[1] - size[1] / 2, fc[2] - size[2] / 2];
    const max = [fc[0] + size[0] / 2, fc[1] + size[1] / 2, fc[2] + size[2] / 2];
    const horiz = Math.max(size[0], size[2]);
    const member = p.role === 'front' || !fr ? 'none' : horiz >= size[1] ? 'beam' : 'column';
    return { p, min, max, size, member, axis: size[0] >= size[2] ? 0 : 2, theta, cls: fr ? Math.round(theta * 1e4) : null };
  });
  const byId = new Map(infos.map((i) => [i.p.id, i]));
  const n = infos.length;

  // contacts
  type Touch = { j: number; k: number; side: 1 | -1 };
  const touches: Touch[][] = infos.map(() => []);
  const overlapsMap = new Map<string, string[]>();
  const overlapPairs: [string, string][] = [];
  for (let i = 0; i < n; i++) {
    const A = infos[i];
    for (let j = i + 1; j < n; j++) {
      const B = infos[j];
      if (A.cls === null || A.cls !== B.cls) continue;
      const ov = [0, 1, 2].map((k) => overlap1(A.min[k], A.max[k], B.min[k], B.max[k]));
      if (ov.every((o) => o > 1)) {
        if (A.p.role === 'structure' && B.p.role === 'structure' && ov.every((o) => o > 2)) {
          overlapPairs.push([A.p.id, B.p.id]);
          overlapsMap.set(A.p.id, [...(overlapsMap.get(A.p.id) ?? []), B.p.id]);
          overlapsMap.set(B.p.id, [...(overlapsMap.get(B.p.id) ?? []), A.p.id]);
        }
        continue;
      }
      for (let k = 0; k < 3; k++) {
        const o1 = (k + 1) % 3;
        const o2 = (k + 2) % 3;
        if (ov[o1] <= TOL || ov[o2] <= TOL) continue;
        if (Math.abs(A.max[k] - B.min[k]) <= TOL) {
          touches[i].push({ j, k, side: 1 });
          touches[j].push({ j: i, k, side: -1 });
        } else if (Math.abs(A.min[k] - B.max[k]) <= TOL) {
          touches[i].push({ j, k, side: -1 });
          touches[j].push({ j: i, k, side: 1 });
        }
      }
    }
  }

  // supports
  const supports: Support[][] = infos.map(() => []);
  const results = new Map<string, PartResult>();
  const selfN: number[] = infos.map((i) => wood(i.p.wood).density * partVolume(i.p) * G);
  const liveKg: number[] = infos.map((i) => (i.p.load ?? autoLoad(i.p, project.designLoad)));

  infos.forEach((I, i) => {
    const p = I.p;
    const sup = supports[i];
    if (I.member === 'none' || p.anchored) return;
    if (I.member === 'beam') {
      const a = I.axis;
      if (I.min[1] <= TOL) sup.push({ id: FLOOR, lo: I.min[a], hi: I.max[a] });
      for (const t of touches[i]) {
        const S = infos[t.j];
        if (S.member === 'none') continue;
        if (t.k === 1 && t.side === -1) {
          // a stiffer board lying on a weaker parallel one spans over it instead of loading it
          if (S.member === 'beam' && S.axis === a && !S.p.anchored && stiffness(S) < stiffness(I)) continue;
          const lo = Math.max(I.min[a], S.min[a]);
          const hi = Math.min(I.max[a], S.max[a]);
          sup.push({ id: S.p.id, lo, hi });
        } else if (t.k === a) {
          const ok = S.member === 'column' || S.p.anchored || (S.member === 'beam' && S.axis !== a);
          if (!ok) continue;
          const at = t.side === -1 ? I.min[a] : I.max[a];
          sup.push({ id: S.p.id, lo: at, hi: at });
        } else if (t.k !== 1) {
          // a post screwed to the board's front or back edge holds it at that spot
          // (wide panels such as a back are left out: they are nailed on, not load-bearing)
          const postLike = (S.member === 'column' || S.p.anchored) && S.size[a] <= 0.25 * (I.max[a] - I.min[a]);
          if (!postLike) continue;
          sup.push({ id: S.p.id, lo: Math.max(I.min[a], S.min[a]), hi: Math.min(I.max[a], S.max[a]) });
        }
      }
    } else {
      if (I.min[1] <= TOL) sup.push({ id: FLOOR, lo: 0, hi: 0 });
      for (const t of touches[i]) {
        const S = infos[t.j];
        if (S.member === 'none') continue;
        if (t.k === 1 && t.side === -1) sup.push({ id: S.p.id, lo: 0, hi: 0 });
        else if (S.p.anchored) sup.push({ id: S.p.id, lo: 0, hi: 0 });
      }
    }
  });

  // load path: Kahn order, parts carrying nothing first
  const indeg = new Array(n).fill(0);
  supports.forEach((sup) => {
    for (const s of sup) {
      const j = s.id === FLOOR ? -1 : infos.findIndex((x) => x.p.id === s.id);
      if (j >= 0) indeg[j]++;
    }
  });
  const indexOf = new Map(infos.map((x, i) => [x.p.id, i]));
  const received = new Array(n).fill(0);
  const done = new Array(n).fill(false);
  const queue: number[] = [];
  for (let i = 0; i < n; i++) if (indeg[i] === 0) queue.push(i);
  const order: number[] = [];
  const process = (i: number) => {
    done[i] = true;
    order.push(i);
    const I = infos[i];
    const total = selfN[i] + liveKg[i] * G + received[i];
    const sup = supports[i];
    if (!sup.length) return;
    const shares: { id: string; f: number }[] = [];
    if (I.member === 'beam') {
      const a = I.axis;
      const L = I.max[a] - I.min[a];
      const centers = [...new Set(sup.map((s) => Math.round((s.lo + s.hi) / 2)))].sort((x, y) => x - y);
      centers.forEach((c, ci) => {
        const lo = ci === 0 ? I.min[a] : (centers[ci - 1] + c) / 2;
        const hi = ci === centers.length - 1 ? I.max[a] : (centers[ci + 1] + c) / 2;
        const at = sup.filter((s) => Math.round((s.lo + s.hi) / 2) === c);
        const f = L > 0 ? (hi - lo) / L : 1 / centers.length;
        at.forEach((s) => shares.push({ id: s.id, f: f / at.length }));
      });
    } else {
      sup.forEach((s) => shares.push({ id: s.id, f: 1 / sup.length }));
    }
    for (const s of shares) {
      const j = indexOf.get(s.id);
      if (j === undefined) continue;
      received[j] += total * s.f;
      indeg[j]--;
      if (indeg[j] === 0 && !done[j]) queue.push(j);
    }
  };
  while (order.length < n) {
    while (queue.length) {
      const i = queue.shift()!;
      if (!done[i]) process(i);
    }
    if (order.length < n) {
      // cycle: take the highest remaining part
      let best = -1;
      for (let i = 0; i < n; i++) if (!done[i] && (best < 0 || infos[i].max[1] > infos[best].max[1])) best = i;
      if (best < 0) break;
      process(best);
    }
  }

  // checks
  infos.forEach((I, i) => {
    const p = I.p;
    const W = wood(p.wood);
    const base: PartResult = {
      id: p.id,
      member: I.member,
      status: 'ok',
      U: 0,
      maxLive: Infinity,
      live: liveKg[i],
      liveAuto: p.load == null,
      received: received[i] / G,
      selfKg: selfN[i] / G,
      segments: [],
      E: W.E,
      supports: [...new Set(supports[i].map((s) => s.id))],
      overlaps: overlapsMap.get(p.id) ?? [],
      frameYaw: I.theta,
    };
    if (I.member === 'none') {
      results.set(p.id, { ...base, status: I.cls === null && p.role === 'structure' ? 'angled' : 'front' });
      return;
    }
    if (p.anchored) {
      results.set(p.id, { ...base, status: 'anchored' });
      return;
    }
    const sup = supports[i];
    if (!sup.length) {
      const connected = touches[i].some((t) => infos[t.j].member !== 'none' || infos[t.j].p.anchored);
      results.set(p.id, { ...base, status: connected ? 'attached' : 'floating' });
      return;
    }
    if (I.member === 'beam') results.set(p.id, checkBeam(I, sup, base, selfN[i], received[i], liveKg[i]));
    else results.set(p.id, checkColumn(I, touches[i].map((t) => ({ S: infos[t.j], k: t.k })), base, selfN[i], received[i], liveKg[i]));
  });

  // stability of tall free-standing groups
  const tipping: string[] = [];
  for (const g of project.groups) {
    const gp = parts.filter((p) => p.groupId === g.id);
    if (!gp.length || gp.some((p) => p.anchored)) continue;
    const bb = boxOfParts(gp)!;
    if (bb.min[1] > TOL) continue;
    const h = bb.max[1] - bb.min[1];
    const base = Math.min(bb.max[0] - bb.min[0], bb.max[2] - bb.min[2]);
    if (h > 1000 && h / base > 3) tipping.push(g.id);
  }

  let weight = 0;
  let cost = 0;
  let volume = 0;
  for (const p of parts) {
    const v = partVolume(p);
    const w = wood(p.wood);
    volume += v;
    weight += v * w.density;
    cost += v * (project.prices[p.wood] ?? w.price);
  }

  const bad: string[] = [];
  const warn: string[] = [];
  const floating: string[] = [];
  results.forEach((r) => {
    if (r.status === 'bad') bad.push(r.id);
    else if (r.status === 'warn') warn.push(r.id);
    else if (r.status === 'floating') floating.push(r.id);
  });
  void byId;
  return { parts: results, weight, cost, volume, bad, warn, floating, overlaps: overlapPairs, tipping };
};

const statusOf = (U: number): Status => (U > 1 ? 'bad' : U > 0.7 ? 'warn' : 'ok');

const checkBeam = (I: Info, sup: Support[], base: PartResult, selfN: number, recN: number, live: number): PartResult => {
  const p = I.p;
  const W = wood(p.wood);
  const a = I.axis;
  const L0 = I.max[a] - I.min[a];
  const other = a === 0 ? 2 : 0;
  let Iy: number;
  let Wel: number;
  if (p.shape === 'rod') {
    const d = Math.min(I.size[1], I.size[other]);
    Iy = (Math.PI * d ** 4) / 64;
    Wel = (Math.PI * d ** 3) / 32;
  } else {
    const bw = I.size[other];
    const h = I.size[1];
    Iy = (bw * h ** 3) / 12;
    Wel = (bw * h ** 2) / 6;
  }
  // merge support intervals
  const iv = sup.map((s) => [s.lo, s.hi] as [number, number]).sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  for (const [lo, hi] of iv) {
    const last = merged[merged.length - 1];
    if (last && lo <= last[1] + 1) last[1] = Math.max(last[1], hi);
    else merged.push([lo, hi]);
  }
  const segs: { kind: 'span' | 'cant'; a: number; b: number; fixed?: 'a' | 'b' }[] = [];
  if (merged[0][0] - I.min[a] > 2) segs.push({ kind: 'cant', a: I.min[a], b: merged[0][0], fixed: 'b' });
  for (let k = 0; k < merged.length - 1; k++) {
    if (merged[k + 1][0] - merged[k][1] > 2) segs.push({ kind: 'span', a: merged[k][1], b: merged[k + 1][0] });
  }
  const lastHi = merged[merged.length - 1][1];
  if (I.max[a] - lastHi > 2) segs.push({ kind: 'cant', a: lastHi, b: I.max[a], fixed: 'a' });
  // overhangs shorter than ~4× the depth of the section behave as fully supported
  const depth = p.shape === 'rod' ? Math.min(I.size[1], I.size[other]) : I.size[1];
  for (let k = segs.length - 1; k >= 0; k--) {
    if (segs[k].kind === 'cant' && segs[k].b - segs[k].a < Math.max(40, 4 * depth)) segs.splice(k, 1);
  }

  if (!segs.length) return { ...base, status: 'supported', I: Iy, W: Wel, axis: a };

  const point = p.loadType === 'point';
  const kmod = point ? W.kmodShort : W.kmodLong;
  const fmd = (kmod * W.fmk) / W.gammaM;
  const wG = (selfN + recN) / L0; // N/mm permanent
  const E = W.E;
  const creepQ = point ? 1 : 1 + W.kdef;

  let U = 0;
  let maxLive = Infinity;
  let govern: Govern = 'sag';
  let worst: { dFin: number; limit: number; sigma: number; L: number } | null = null;
  const segments: Segment[] = [];
  for (const s of segs) {
    const L = s.b - s.a;
    let mG: number, dG: number, mQ: number, dQ: number;
    const wQ = (G / L0); // N/mm per kg of total live load
    const P = G; // N per kg point load
    if (s.kind === 'span') {
      mG = (wG * L * L) / 8;
      dG = (5 * wG * L ** 4) / (384 * E * Iy);
      if (point) {
        mQ = (P * L) / 4;
        dQ = (P * L ** 3) / (48 * E * Iy);
      } else {
        mQ = (wQ * L * L) / 8;
        dQ = (5 * wQ * L ** 4) / (384 * E * Iy);
      }
    } else {
      mG = (wG * L * L) / 2;
      dG = (wG * L ** 4) / (8 * E * Iy);
      if (point) {
        mQ = P * L;
        dQ = (P * L ** 3) / (3 * E * Iy);
      } else {
        mQ = (wQ * L * L) / 2;
        dQ = (wQ * L ** 4) / (8 * E * Iy);
      }
    }
    const limit = s.kind === 'span' ? L / 300 : L / 150;
    // utilisation = a + b·live, for stress and for sag
    const aS = (1.35 * mG) / Wel / fmd;
    const bS = (1.5 * mQ) / Wel / fmd;
    const aD = (dG * (1 + W.kdef)) / limit;
    const bD = (dQ * creepQ) / limit;
    const uS = aS + bS * live;
    const uD = aD + bD * live;
    const u = Math.max(uS, uD);
    const ml = Math.max(0, Math.min(aS >= 1 ? 0 : (1 - aS) / bS, aD >= 1 ? 0 : (1 - aD) / bD));
    const dFin = dG * (1 + W.kdef) + dQ * creepQ * live;
    const sigma = (1.35 * mG + 1.5 * mQ * live) / Wel;
    segments.push({ ...s, dFin, limit, U: u });
    if (u >= U) {
      U = u;
      govern = uS > uD ? 'stress' : 'sag';
      worst = { dFin, limit, sigma, L };
    }
    maxLive = Math.min(maxLive, ml);
  }
  return {
    ...base,
    status: statusOf(U),
    U,
    maxLive,
    govern,
    axis: a,
    segments,
    sag: worst?.dFin,
    sagLimit: worst?.limit,
    stress: worst?.sigma,
    stressAllow: fmd,
    I: Iy,
    W: Wel,
    span: worst?.L,
  };
};

const checkColumn = (
  I: Info,
  touching: { S: Info; k: number }[],
  base: PartResult,
  selfN: number,
  recN: number,
  live: number,
): PartResult => {
  const p = I.p;
  const W = wood(p.wood);
  let A: number;
  let i: number;
  if (p.shape === 'rod') {
    const d = Math.min(I.size[0], I.size[2]);
    A = (Math.PI * d * d) / 4;
    i = d / 4;
  } else {
    const t = Math.min(I.size[0], I.size[2]);
    const w = Math.max(I.size[0], I.size[2]);
    A = t * w;
    i = t / Math.sqrt(12);
  }
  // bracing points along the height: ends + beams fixed to the faces
  const pts = [I.min[1], I.max[1]];
  for (const { S, k } of touching) {
    if (k === 1 || S.member !== 'beam') continue;
    pts.push((Math.max(S.min[1], I.min[1]) + Math.min(S.max[1], I.max[1])) / 2);
  }
  pts.sort((x, y) => x - y);
  let Lef = 0;
  for (let k = 1; k < pts.length; k++) Lef = Math.max(Lef, pts[k] - pts[k - 1]);
  const E05 = 0.67 * W.E;
  const lam = Lef / i;
  const lamRel = (lam / Math.PI) * Math.sqrt(W.fck / E05);
  const kk = 0.5 * (1 + 0.2 * (lamRel - 0.3) + lamRel * lamRel);
  const kc = lamRel <= 0.3 ? 1 : 1 / (kk + Math.sqrt(kk * kk - lamRel * lamRel));
  const fcd = (W.kmodLong * W.fck) / W.gammaM;
  const NRd = kc * fcd * A;
  const N = selfN + recN + live * G;
  const U = (1.4 * N) / NRd;
  return {
    ...base,
    status: statusOf(U),
    U,
    maxLive: NRd / 1.4 / G,
    govern: 'buckle',
    N: N / G,
    Lef,
    kc,
    stress: N / A,
    stressAllow: kc * fcd,
  };
};

export const STATUS_LABEL: Record<Status, string> = {
  ok: 'חזק',
  warn: 'גבולי',
  bad: 'חלש',
  floating: 'לא מחובר',
  attached: 'מחובר',
  supported: 'נשען לכל אורכו',
  anchored: 'מעוגן לקיר',
  front: 'חזית',
  angled: 'בזווית',
};
