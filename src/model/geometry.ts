import type { Part, Vec3 } from './types';

export interface Box3 {
  min: Vec3;
  max: Vec3;
}

export const uid = (): string => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);

export const partBox = (p: Part): Box3 => ({
  min: [p.pos[0], p.pos[1], p.pos[2]],
  max: [p.pos[0] + p.size[0], p.pos[1] + p.size[1], p.pos[2] + p.size[2]],
});

export const boxOfParts = (parts: Part[]): Box3 | null => {
  if (!parts.length) return null;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], p.pos[k]);
      max[k] = Math.max(max[k], p.pos[k] + p.size[k]);
    }
  }
  return { min, max };
};

export const boxSize = (b: Box3): Vec3 => [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
export const boxCenter = (b: Box3): Vec3 => [(b.max[0] + b.min[0]) / 2, (b.max[1] + b.min[1]) / 2, (b.max[2] + b.min[2]) / 2];

/** volume in m³ */
export const partVolume = (p: Part): number => {
  if (p.shape === 'rod') {
    const ax = longestAxis(p.size);
    const others = [0, 1, 2].filter((k) => k !== ax).map((k) => p.size[k]);
    const d = Math.min(...others);
    return (Math.PI * d * d * 0.25 * p.size[ax]) / 1e9;
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
