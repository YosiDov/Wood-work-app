import * as THREE from 'three';
import type { WoodId } from '../model/types';
import { wood, type Wood } from '../model/woods';

/* Procedural, tileable wood textures painted on canvases. */

const hash = (x: number, y: number, s: number) => {
  let h = x * 374761393 + y * 668265263 + s * 2147483647;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967295;
};

/** periodic value noise: px, py are lattice periods so the result tiles */
const vnoise = (x: number, y: number, px: number, py: number, seed: number) => {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const m = (a: number, p: number) => ((a % p) + p) % p;
  const a = hash(m(xi, px), m(yi, py), seed);
  const b = hash(m(xi + 1, px), m(yi, py), seed);
  const c = hash(m(xi, px), m(yi + 1, py), seed);
  const d = hash(m(xi + 1, px), m(yi + 1, py), seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};

const fbm = (x: number, y: number, px: number, py: number, seed: number, oct = 4) => {
  let s = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < oct; i++) {
    s += amp * vnoise(x * f, y * f, px * f, py * f, seed + i * 17);
    amp *= 0.5;
    f *= 2;
  }
  return s;
};

const hex = (c: string): [number, number, number] => {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const mix = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

interface GrainStyle {
  rings: number; // ring count across the texture height
  contrast: number;
  warp: number;
  flecks: number; // medullary rays (oak/beech)
  pores: number;
}

const GRAIN: Partial<Record<WoodId, GrainStyle>> = {
  pine: { rings: 9, contrast: 0.85, warp: 0.9, flecks: 0, pores: 0.05 },
  oak: { rings: 14, contrast: 0.55, warp: 0.7, flecks: 0.5, pores: 0.4 },
  beech: { rings: 18, contrast: 0.3, warp: 0.5, flecks: 0.8, pores: 0.1 },
  walnut: { rings: 11, contrast: 0.6, warp: 1.1, flecks: 0, pores: 0.35 },
  maple: { rings: 16, contrast: 0.25, warp: 0.6, flecks: 0.1, pores: 0.05 },
  cherry: { rings: 13, contrast: 0.4, warp: 0.8, flecks: 0, pores: 0.15 },
  teak: { rings: 12, contrast: 0.5, warp: 0.8, flecks: 0, pores: 0.4 },
  meranti: { rings: 20, contrast: 0.3, warp: 0.4, flecks: 0, pores: 0.6 },
  plywood: { rings: 6, contrast: 0.35, warp: 1.6, flecks: 0, pores: 0.03 },
  blockboard: { rings: 7, contrast: 0.4, warp: 1.4, flecks: 0, pores: 0.05 },
};

const makeCanvas = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

const toTexture = (c: HTMLCanvasElement) => {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
};

/** long-grain face: u = along grain (1000 mm), v = across (250 mm) */
const paintLongGrain = (w: Wood, W = 1024, H = 256) => {
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  const st = GRAIN[w.id] ?? GRAIN.pine!;
  const base = hex(w.colors[0]);
  const dark = hex(w.colors[1]);
  const light = hex(w.colors[2]);
  const seed = w.id.length * 31 + w.id.charCodeAt(0);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const nx = (x / W) * 4;
      const ny = (y / H) * 4;
      const warp = fbm(nx, ny * 0.6, 4, 2.4, seed, 4) * st.warp * 2.2;
      const r = (y / H) * st.rings + warp + fbm(nx * 0.5, ny * 0.3, 2, 1.2, seed + 9, 2) * 1.5;
      const f = r - Math.floor(r);
      // late wood: sharp dark band
      const late = Math.pow(Math.max(0, 1 - Math.abs(f - 0.82) / 0.18), 2.2) * st.contrast;
      const streak = (fbm(x / W * 64, y / H * 2, 64, 2, seed + 3, 2) - 0.5) * 0.25;
      let col = mix(base, light, Math.max(0, 0.35 - late) + streak * 0.6);
      col = mix(col, dark, Math.min(1, late + Math.max(0, -streak) * 0.5));
      if (st.pores > 0) {
        const pore = hash(x, y, seed) > 1 - st.pores * 0.08 ? 0.35 : 0;
        col = mix(col, dark, pore);
      }
      if (st.flecks > 0) {
        const fl = vnoise((x / W) * 40, (y / H) * 30, 40, 30, seed + 5);
        if (fl > 1 - st.flecks * 0.12) col = mix(col, light, 0.35);
      }
      const i = (y * W + x) * 4;
      img.data[i] = col[0];
      img.data[i + 1] = col[1];
      img.data[i + 2] = col[2];
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
};

/** end grain: concentric growth rings around a pith far off-texture */
const paintEndGrain = (w: Wood, S = 256) => {
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  const st = GRAIN[w.id] ?? GRAIN.pine!;
  const base = mix(hex(w.colors[0]), hex(w.colors[1]), 0.25);
  const dark = hex(w.colors[1]);
  const seed = w.id.length * 13;
  const cx = S * 0.5;
  const cy = -S * 0.9;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const d = Math.hypot(x - cx, y - cy) / S;
      const r = d * st.rings * 1.4 + fbm(x / S * 4, y / S * 4, 4, 4, seed, 3) * 0.6;
      const f = r - Math.floor(r);
      const late = Math.pow(Math.max(0, 1 - Math.abs(f - 0.85) / 0.15), 2) * st.contrast;
      const speck = hash(x, y, seed) > 0.92 ? 0.15 : 0;
      const col = mix(base, dark, Math.min(1, late + speck));
      const i = (y * S + x) * 4;
      img.data[i] = col[0];
      img.data[i + 1] = col[1];
      img.data[i + 2] = col[2];
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
};

const paintNoise = (w: Wood, W: number, H: number, amount: number, scale: number) => {
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  const base = hex(w.colors[0]);
  const dark = hex(w.colors[1]);
  const light = hex(w.colors[2]);
  const seed = w.id.length * 7;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const nv = fbm((x / W) * scale, (y / H) * scale * (H / W), scale, scale * (H / W), seed, 3);
      const sp = (hash(x, y, seed) - 0.5) * amount;
      const t = (nv - 0.5) * amount * 2 + sp;
      const col = t > 0 ? mix(base, light, t) : mix(base, dark, -t);
      const i = (y * W + x) * 4;
      img.data[i] = col[0];
      img.data[i + 1] = col[1];
      img.data[i + 2] = col[2];
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
};

/** OSB: large oriented flakes */
const paintOSB = (w: Wood, S = 512) => {
  const c = paintNoise(w, S, S, 0.25, 8);
  const ctx = c.getContext('2d')!;
  const cols = w.colors;
  let s = 7;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  for (let i = 0; i < 900; i++) {
    ctx.save();
    ctx.translate(rnd() * S, rnd() * S);
    ctx.rotate((rnd() - 0.5) * 0.9);
    ctx.globalAlpha = 0.35 + rnd() * 0.4;
    ctx.fillStyle = cols[Math.floor(rnd() * 3)];
    const fw = 30 + rnd() * 60;
    const fh = 8 + rnd() * 18;
    ctx.fillRect(-fw / 2, -fh / 2, fw, fh);
    ctx.restore();
  }
  return c;
};

/** plywood / blockboard edge: stacked plies (v = thickness) */
const paintLayers = (w: Wood, layers: number, core: boolean) => {
  const W = 512;
  const H = 128;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d')!;
  const a = hex(w.colors[2]);
  const b = hex(w.colors[1]);
  const lh = H / layers;
  for (let i = 0; i < layers; i++) {
    const isCore = core && i > 0 && i < layers - 1;
    const t = i % 2 === 0 ? 0.1 : 0.55;
    const col = mix(a, b, isCore ? 0.3 : t);
    ctx.fillStyle = `rgb(${col[0] | 0},${col[1] | 0},${col[2] | 0})`;
    ctx.fillRect(0, i * lh, W, lh + 0.5);
    if (core && isCore) {
      // blocks of the core
      for (let x = 0; x < W; x += 48) {
        ctx.fillStyle = 'rgba(90,60,30,0.25)';
        ctx.fillRect(x, i * lh, 2, lh);
      }
    }
    ctx.fillStyle = 'rgba(60,40,20,0.35)';
    ctx.fillRect(0, i * lh, W, 1);
  }
  // glue lines / grain noise
  const img = ctx.getImageData(0, 0, W, H);
  for (let p = 0; p < img.data.length; p += 4) {
    const n = (Math.random() - 0.5) * 18;
    img.data[p] += n;
    img.data[p + 1] += n;
    img.data[p + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  return c;
};

export interface WoodMaterials {
  /** [long grain or panel face, end grain or panel edge] */
  mats: [THREE.MeshStandardMaterial, THREE.MeshStandardMaterial];
  /** physical size (mm) of one tile of each texture: [u, v] */
  tile: [[number, number], [number, number]];
  swatch: string;
}

const cache = new Map<WoodId, WoodMaterials>();

export const woodMaterials = (id: WoodId): WoodMaterials => {
  const hit = cache.get(id);
  if (hit) return hit;
  const w = wood(id);
  let face: HTMLCanvasElement;
  let edge: HTMLCanvasElement;
  let tile: WoodMaterials['tile'];
  let rough = 0.62;
  switch (w.style) {
    case 'grain':
      face = paintLongGrain(w);
      edge = paintEndGrain(w);
      tile = [[1000, 250], [220, 220]];
      break;
    case 'ply':
      face = paintLongGrain(w);
      edge = paintLayers(w, 13, false);
      tile = [[1200, 300], [400, 18]];
      break;
    case 'block':
      face = paintLongGrain(w);
      edge = paintLayers(w, 3, true);
      tile = [[1200, 300], [400, 18]];
      break;
    case 'mdf':
      face = paintNoise(w, 256, 256, 0.08, 6);
      edge = paintNoise({ ...w, colors: [w.colors[1], w.colors[1], w.colors[0]] }, 256, 64, 0.18, 12);
      tile = [[400, 400], [200, 18]];
      rough = 0.7;
      break;
    case 'melamine':
      face = paintNoise(w, 256, 256, 0.03, 4);
      edge = paintNoise(w, 256, 64, 0.04, 4);
      tile = [[400, 400], [200, 18]];
      rough = 0.42;
      break;
    case 'osb':
      face = paintOSB(w);
      edge = paintNoise(w, 256, 64, 0.3, 16);
      tile = [[600, 600], [200, 18]];
      rough = 0.78;
      break;
  }
  const mk = (c: HTMLCanvasElement) => {
    const map = toTexture(c);
    return new THREE.MeshStandardMaterial({ map, roughness: rough, metalness: 0, envMapIntensity: 0.6 });
  };
  const entry: WoodMaterials = { mats: [mk(face), mk(edge)], tile, swatch: face.toDataURL('image/jpeg', 0.8) };
  cache.set(id, entry);
  return entry;
};

/** small square preview of a wood for the UI */
const swatchCache = new Map<WoodId, string>();
export const woodSwatch = (id: WoodId): string => {
  const hit = swatchCache.get(id);
  if (hit) return hit;
  const src = woodMaterials(id).mats[0].map!.image as HTMLCanvasElement;
  const c = makeCanvas(96, 96);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(src, 0, 0, Math.min(src.width, 384), Math.min(src.height, 384), 0, 0, 96, 96);
  const url = c.toDataURL('image/jpeg', 0.85);
  swatchCache.set(id, url);
  return url;
};

/** self-healing cutting mat, 1 tile = 1000 × 1000 mm */
export const cuttingMatTexture = (): THREE.CanvasTexture => {
  const S = 1024;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, S, S);
  g.addColorStop(0, '#22604e');
  g.addColorStop(1, '#1d5646');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  // speckle
  const img = ctx.getImageData(0, 0, S, S);
  for (let p = 0; p < img.data.length; p += 4) {
    const n = (Math.random() - 0.5) * 8;
    img.data[p] += n;
    img.data[p + 1] += n;
    img.data[p + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  const px = S / 1000;
  for (let mm = 0; mm < 1000; mm += 10) {
    const major = mm % 100 === 0;
    const mid = mm % 50 === 0;
    ctx.strokeStyle = major ? 'rgba(214,236,222,0.55)' : mid ? 'rgba(190,225,205,0.28)' : 'rgba(170,215,190,0.12)';
    ctx.lineWidth = major ? 2 : 1;
    const p = mm * px + 0.5;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, S);
    ctx.moveTo(0, p);
    ctx.lineTo(S, p);
    ctx.stroke();
  }
  // 45° guide lines like a real mat
  ctx.strokeStyle = 'rgba(214,236,222,0.10)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(S, S);
  ctx.moveTo(S, 0);
  ctx.lineTo(0, S);
  ctx.stroke();
  // cm numbers along the major lines
  ctx.fillStyle = 'rgba(226,242,232,0.55)';
  ctx.font = '600 16px "IBM Plex Sans Hebrew", sans-serif';
  for (let mm = 100; mm < 1000; mm += 100) {
    ctx.fillText(String(mm / 10), mm * px + 4, 18);
  }
  const t = toTexture(c);
  t.anisotropy = 16;
  return t;
};
