import type { Group, LoadType, MatRole, ParamValue, Part, PartKind, Quat, Role, Shape, TemplateId, Vec3, WoodId } from './types';
import { bakeQuarter, fromQ, hashSeed, isIdentityQ, posFromCenter, rotateBoxY, toQ } from './geometry';
import { Quaternion, Vector3 } from 'three';

export interface ParamSpec {
  key: string;
  label: string;
  kind: 'num' | 'int' | 'bool';
  min?: number;
  max?: number;
  step?: number;
}

export interface GenPart {
  name: string;
  pos: Vec3;
  size: Vec3;
  matRole: MatRole;
  shape?: Shape;
  role?: Role;
  anchored?: boolean;
  load?: number | null;
  loadType?: LoadType;
  kind?: PartKind;
  /** own rotation about the part's centre */
  q?: Quat;
  cut?: [number, number];
}

export interface TemplateDef {
  id: TemplateId;
  name: string;
  params: ParamSpec[];
  /** material slots this template uses, with Hebrew labels */
  materials: Partial<Record<MatRole, string>>;
  defaults: Record<string, ParamValue>;
  startY?: number;
  build: (p: Record<string, ParamValue>) => GenPart[];
}

const n = (p: Record<string, ParamValue>, k: string) => Number(p[k]);
const b = (p: Record<string, ParamValue>, k: string) => Boolean(p[k]);

const box = (
  name: string,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  matRole: MatRole = 'wood',
  extra: Partial<GenPart> = {},
): GenPart => ({ name, pos: [x, y, z], size: [sx, sy, sz], matRole, ...extra });

const DIMS: ParamSpec[] = [
  { key: 'W', label: 'רוחב', kind: 'num', min: 150, max: 4000, step: 10 },
  { key: 'H', label: 'גובה', kind: 'num', min: 100, max: 2800, step: 10 },
  { key: 'D', label: 'עומק', kind: 'num', min: 150, max: 1500, step: 10 },
];

const T: ParamSpec = { key: 't', label: 'עובי לוח', kind: 'num', min: 6, max: 50, step: 1 };

/** Doors across the front, with handles near the meeting edge. */
const doors = (
  out: GenPart[],
  count: number,
  W: number,
  y: number,
  h: number,
  z: number,
  t: number,
  handleAt: 'mid' | 'bottom' = 'mid',
) => {
  const gap = 3;
  const dw = (W - gap * (count - 1)) / count;
  for (let i = 0; i < count; i++) {
    const x = i * (dw + gap);
    out.push(box(count > 1 ? `דלת ${i + 1}` : 'דלת', x, y, z, dw, h, t, 'frontWood', { role: 'front', kind: 'sheet' }));
    const hx = count === 1 ? x + dw - 50 : i % 2 === 0 ? x + dw - 50 : x + 38;
    const hh = Math.min(160, h * 0.3);
    const hy = handleAt === 'bottom' ? y + 40 : y + h / 2 - hh / 2;
    out.push(box('ידית', hx, hy, z + t, 12, hh, 24, 'rodWood', { role: 'front', kind: 'rod' }));
  }
};

export const TEMPLATES: TemplateDef[] = [
  {
    id: 'bookcase',
    name: 'כוננית',
    params: [
      ...DIMS,
      T,
      { key: 'shelves', label: 'מדפים', kind: 'int', min: 0, max: 12, step: 1 },
      { key: 'plinth', label: 'צוקל', kind: 'num', min: 0, max: 200, step: 5 },
      { key: 'back', label: 'גב', kind: 'bool' },
    ],
    materials: { wood: 'גוף', backWood: 'גב' },
    defaults: { W: 900, H: 1800, D: 320, t: 18, shelves: 4, plinth: 60, back: true, wood: 'pine', backWood: 'plywood' },
    build: (p) => {
      const W = n(p, 'W'), H = n(p, 'H'), D = n(p, 'D'), t = n(p, 't');
      const plinth = n(p, 'plinth');
      const bt = b(p, 'back') ? 6 : 0;
      const cd = D - bt;
      const out: GenPart[] = [
        box('דופן שמאל', 0, 0, bt, t, H, cd, 'wood', { kind: 'sheet' }),
        box('דופן ימין', W - t, 0, bt, t, H, cd, 'wood', { kind: 'sheet' }),
        box('תקרה', t, H - t, bt, W - 2 * t, t, cd, 'wood', { kind: 'sheet' }),
        box('תחתית', t, plinth, bt, W - 2 * t, t, cd, 'wood', { kind: 'sheet' }),
      ];
      if (plinth > 0) out.push(box('צוקל', t, 0, D - 20 - t, W - 2 * t, plinth, t, 'wood', { kind: 'board' }));
      const count = n(p, 'shelves');
      const y0 = plinth + t;
      const y1 = H - t;
      const gap = (y1 - y0 - count * t) / (count + 1);
      for (let i = 0; i < count; i++) {
        out.push(box(`מדף ${i + 1}`, t, y0 + gap * (i + 1) + t * i, bt, W - 2 * t, t, cd - 10, 'wood', { kind: 'sheet' }));
      }
      if (bt) out.push(box('גב', 0, 0, 0, W, H, bt, 'backWood', { kind: 'sheet' }));
      return out;
    },
  },
  {
    id: 'xshelf',
    name: 'מדף איקסים',
    params: [
      ...DIMS,
      { key: 'shelves', label: 'מדפים', kind: 'int', min: 2, max: 8, step: 1 },
      { key: 'st', label: 'עובי מדף', kind: 'num', min: 18, max: 60, step: 1 },
      { key: 'post', label: 'רוחב עמוד', kind: 'num', min: 38, max: 140, step: 1 },
      { key: 'inset', label: 'בליטת מדף מהעמוד', kind: 'num', min: 0, max: 250, step: 5 },
      { key: 'low', label: 'גובה מדף תחתון', kind: 'num', min: 0, max: 500, step: 5 },
      { key: 'top', label: 'עמוד מעל המדף', kind: 'num', min: 0, max: 400, step: 5 },
      { key: 'bw', label: 'רוחב איקס', kind: 'num', min: 30, max: 120, step: 1 },
      { key: 'braces', label: 'איקסים בצדדים', kind: 'bool' },
    ],
    materials: { wood: 'עמודים', topWood: 'מדפים', backWood: 'איקסים' },
    // 50"H × 48"W × 12"D barnwood shelf: 2×4 posts, 2×10 shelves, 1×3 braces
    defaults: { W: 1220, H: 1270, D: 310, shelves: 4, st: 38, post: 89, inset: 75, low: 150, top: 150, bw: 64, braces: true, wood: 'pine', topWood: 'pine', backWood: 'pine' },
    build: (p) => {
      const W = n(p, 'W'), H = n(p, 'H'), D = n(p, 'D');
      const count = Math.max(2, n(p, 'shelves'));
      const st = n(p, 'st'), pw = n(p, 'post'), inset = n(p, 'inset'), low = n(p, 'low'), top = n(p, 'top'), bw = n(p, 'bw');
      const pt = 38; // post thickness front to back (a 2×4 on edge)
      const sd = Math.max(60, D - 2 * pt);
      const out: GenPart[] = [];
      const xs = [inset, W - inset - pw];
      // posts sandwich the shelves: back posts behind, front posts in front
      out.push(box('עמוד אחורי שמאל', xs[0], 0, 0, pw, H, pt, 'wood', { kind: 'beam' }));
      out.push(box('עמוד אחורי ימין', xs[1], 0, 0, pw, H, pt, 'wood', { kind: 'beam' }));
      out.push(box('עמוד קדמי שמאל', xs[0], 0, pt + sd, pw, H, pt, 'wood', { kind: 'beam' }));
      out.push(box('עמוד קדמי ימין', xs[1], 0, pt + sd, pw, H, pt, 'wood', { kind: 'beam' }));
      const gap = (H - top - st - low) / (count - 1);
      const ys: number[] = [];
      for (let i = 0; i < count; i++) {
        const y = low + i * gap;
        ys.push(y);
        out.push(box(`מדף ${i + 1}`, 0, y, pt, W, st, sd, 'topWood', { kind: 'board' }));
      }
      if (b(p, 'braces')) {
        const bt = 19;
        for (let i = 0; i < count - 1; i++) {
          const y0 = ys[i] + st;
          const by = ys[i + 1] - y0;
          // brace angle from vertical so both ends sit flat in the corners of the bay:
          // tan φ = (depth − bw / cos φ) / height
          let phi = Math.atan2(sd, by);
          for (let k = 0; k < 30; k++) phi = Math.atan2(Math.max(1, sd - bw / Math.cos(phi)), by);
          if (sd - bw / Math.cos(phi) < 10) continue;
          const L = by / Math.cos(phi) + bw * Math.tan(phi);
          const deg = (phi * 180) / Math.PI;
          for (const [si, x] of [[0, xs[0]], [1, xs[1] + pw - bt]] as const) {
            const side = si === 0 ? 'שמאל' : 'ימין';
            for (const sgn of [1, -1]) {
              const q = fromQ(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), sgn * phi));
              const cy = y0 + by / 2;
              const cz = pt + sd / 2;
              out.push({
                name: `איקס ${side} ${i + 1}`,
                pos: [x, cy - L / 2, cz - bw / 2],
                size: [bt, L, bw],
                matRole: 'backWood',
                kind: 'board',
                q,
                cut: [sgn * deg, sgn * deg],
              });
            }
          }
        }
      }
      return out;
    },
  },
  {
    id: 'wardrobe',
    name: 'ארון בגדים',
    params: [
      ...DIMS,
      T,
      { key: 'shelves', label: 'מדפים', kind: 'int', min: 0, max: 6, step: 1 },
      { key: 'doors', label: 'דלתות', kind: 'int', min: 0, max: 4, step: 1 },
      { key: 'plinth', label: 'צוקל', kind: 'num', min: 0, max: 200, step: 5 },
      { key: 'rod', label: 'מוט תלייה', kind: 'bool' },
    ],
    materials: { wood: 'גוף', frontWood: 'דלתות', backWood: 'גב', rodWood: 'מוט' },
    defaults: { W: 800, H: 2000, D: 600, t: 18, shelves: 2, doors: 2, plinth: 80, rod: true, wood: 'blockboard', frontWood: 'melamine', backWood: 'mdf', rodWood: 'beech' },
    build: (p) => {
      const W = n(p, 'W'), H = n(p, 'H'), D = n(p, 'D'), t = n(p, 't');
      const plinth = n(p, 'plinth');
      const nd = n(p, 'doors');
      const bt = 6;
      const cd = D - bt - (nd > 0 ? t : 0);
      const out: GenPart[] = [
        box('דופן שמאל', 0, 0, bt, t, H, cd, 'wood', { kind: 'sheet' }),
        box('דופן ימין', W - t, 0, bt, t, H, cd, 'wood', { kind: 'sheet' }),
        box('תקרה', t, H - t, bt, W - 2 * t, t, cd, 'wood', { kind: 'sheet' }),
        box('תחתית', t, plinth, bt, W - 2 * t, t, cd, 'wood', { kind: 'sheet' }),
        box('גב', 0, 0, 0, W, H, bt, 'backWood', { kind: 'sheet' }),
      ];
      if (plinth > 0) out.push(box('צוקל', t, 0, bt + cd - 20 - t, W - 2 * t, plinth, t, 'wood', { kind: 'board' }));
      const count = n(p, 'shelves');
      let lowest = H - t;
      for (let i = 0; i < count; i++) {
        const y = H - t - 340 * (i + 1) - t * i;
        if (y < plinth + t + 300) break;
        // clothes: about 40 kg per m² of shelf
        const load = Math.round((40 * (W - 2 * t) * (cd - 10)) / 1e6);
        out.push(box(`מדף ${i + 1}`, t, y, bt, W - 2 * t, t, cd - 10, 'wood', { kind: 'sheet', load }));
        lowest = y;
      }
      if (b(p, 'rod')) {
        const d = 32;
        out.push(box('מוט תלייה', t, lowest - 60 - d, bt + (cd - d) / 2, W - 2 * t, d, d, 'rodWood', { shape: 'rod', kind: 'rod' }));
      }
      if (nd > 0) doors(out, nd, W, plinth, H - plinth, bt + cd, t);
      return out;
    },
  },
  {
    id: 'kitchenBase',
    name: 'מטבח תחתון',
    params: [
      ...DIMS,
      T,
      { key: 'doors', label: 'דלתות', kind: 'int', min: 0, max: 2, step: 1 },
      { key: 'drawers', label: 'מגירות', kind: 'int', min: 0, max: 4, step: 1 },
      { key: 'plinth', label: 'צוקל', kind: 'num', min: 0, max: 200, step: 5 },
      { key: 'top', label: 'עובי משטח', kind: 'num', min: 12, max: 80, step: 1 },
    ],
    materials: { wood: 'גוף', frontWood: 'חזיתות', topWood: 'משטח', backWood: 'גב' },
    defaults: { W: 600, H: 900, D: 600, t: 18, doors: 2, drawers: 0, plinth: 100, top: 40, wood: 'blockboard', frontWood: 'mdf', topWood: 'oak', backWood: 'mdf', rodWood: 'walnut' },
    build: (p) => {
      const W = n(p, 'W'), H = n(p, 'H'), D = n(p, 'D'), t = n(p, 't');
      const plinth = n(p, 'plinth');
      const top = n(p, 'top');
      const bt = 6;
      const cH = H - top;
      const cd = D - 20 - t - bt;
      const drawers = n(p, 'drawers');
      const out: GenPart[] = [
        box('דופן שמאל', 0, 0, bt, t, cH, cd, 'wood', { kind: 'sheet' }),
        box('דופן ימין', W - t, 0, bt, t, cH, cd, 'wood', { kind: 'sheet' }),
        box('תחתית', t, plinth, bt, W - 2 * t, t, cd, 'wood', { kind: 'sheet' }),
        box('סרגל קדמי', t, cH - t, bt + cd - 100, W - 2 * t, t, 100, 'wood', { kind: 'board', load: 0 }),
        box('סרגל אחורי', t, cH - t, bt, W - 2 * t, t, 100, 'wood', { kind: 'board', load: 0 }),
        box('גב', 0, plinth, 0, W, cH - plinth, bt, 'backWood', { kind: 'sheet' }),
        box('משטח', 0, cH, 0, W, top, D, 'topWood', { kind: 'sheet' }),
      ];
      if (plinth > 0) out.push(box('צוקל', t, 0, bt + cd - 40, W - 2 * t, plinth, t, 'wood', { kind: 'board' }));
      const frontZ = bt + cd;
      const frontH = cH - plinth - 3;
      if (drawers > 0) {
        const fh = (frontH - 3 * (drawers - 1)) / drawers;
        for (let i = 0; i < drawers; i++) {
          const y = plinth + i * (fh + 3);
          out.push(box(`חזית מגירה ${i + 1}`, 0, y, frontZ, W, fh, t, 'frontWood', { role: 'front', kind: 'sheet' }));
          out.push(box('ידית', W / 2 - 80, y + fh - 50, frontZ + t, 160, 12, 24, 'rodWood', { role: 'front', kind: 'rod' }));
          const bh = Math.max(60, fh - 50);
          const bx = t + 13;
          const bw = W - 2 * t - 26;
          const bd = cd - 40;
          const by = y + 20;
          const bz = frontZ - bd;
          out.push(box(`מגירה ${i + 1} דופן`, bx, by, bz, 12, bh, bd, 'wood', { role: 'front', kind: 'sheet' }));
          out.push(box(`מגירה ${i + 1} דופן`, bx + bw - 12, by, bz, 12, bh, bd, 'wood', { role: 'front', kind: 'sheet' }));
          out.push(box(`מגירה ${i + 1} גב`, bx + 12, by, bz, bw - 24, bh, 12, 'wood', { role: 'front', kind: 'sheet' }));
          out.push(box(`מגירה ${i + 1} קדמי`, bx + 12, by, frontZ - 12, bw - 24, bh, 12, 'wood', { role: 'front', kind: 'sheet' }));
          out.push(box(`מגירה ${i + 1} תחתית`, bx + 12, by, bz + 12, bw - 24, 8, bd - 24, 'backWood', { role: 'front', kind: 'sheet' }));
        }
      } else {
        out.push(box('מדף', t, plinth + t + (cH - plinth - 2 * t) / 2, bt, W - 2 * t, t, cd - 30, 'wood', { kind: 'sheet' }));
        const nd = n(p, 'doors');
        if (nd > 0) doors(out, nd, W, plinth, frontH, frontZ, t);
      }
      return out;
    },
  },
  {
    id: 'kitchenWall',
    name: 'מטבח עליון',
    params: [
      ...DIMS,
      T,
      { key: 'shelves', label: 'מדפים', kind: 'int', min: 0, max: 5, step: 1 },
      { key: 'doors', label: 'דלתות', kind: 'int', min: 0, max: 2, step: 1 },
    ],
    materials: { wood: 'גוף', frontWood: 'דלתות', backWood: 'גב' },
    defaults: { W: 600, H: 700, D: 330, t: 18, shelves: 2, doors: 2, wood: 'blockboard', frontWood: 'mdf', backWood: 'mdf', rodWood: 'walnut' },
    startY: 1450,
    build: (p) => {
      const W = n(p, 'W'), H = n(p, 'H'), D = n(p, 'D'), t = n(p, 't');
      const nd = n(p, 'doors');
      const bt = 6;
      const cd = D - bt - (nd > 0 ? t : 0);
      const out: GenPart[] = [
        box('גב (מעוגן לקיר)', 0, 0, 0, W, H, bt, 'backWood', { anchored: true, kind: 'sheet' }),
        box('דופן שמאל', 0, 0, bt, t, H, cd, 'wood', { kind: 'sheet' }),
        box('דופן ימין', W - t, 0, bt, t, H, cd, 'wood', { kind: 'sheet' }),
        box('תקרה', t, H - t, bt, W - 2 * t, t, cd, 'wood', { kind: 'sheet' }),
        box('תחתית', t, 0, bt, W - 2 * t, t, cd, 'wood', { kind: 'sheet' }),
      ];
      const count = n(p, 'shelves');
      const gap = (H - 2 * t - count * t) / (count + 1);
      for (let i = 0; i < count; i++) {
        out.push(box(`מדף ${i + 1}`, t, t + gap * (i + 1) + t * i, bt, W - 2 * t, t, cd - 10, 'wood', { kind: 'sheet' }));
      }
      if (nd > 0) doors(out, nd, W, 0, H, bt + cd, t, 'bottom');
      return out;
    },
  },
  {
    id: 'table',
    name: 'שולחן',
    params: [
      ...DIMS,
      { key: 'top', label: 'עובי פלטה', kind: 'num', min: 12, max: 80, step: 1 },
      { key: 'leg', label: 'עובי רגל', kind: 'num', min: 25, max: 150, step: 1 },
      { key: 'apron', label: 'גובה סינר', kind: 'num', min: 0, max: 200, step: 5 },
      { key: 'over', label: 'בליטה', kind: 'num', min: 0, max: 300, step: 5 },
    ],
    materials: { wood: 'רגליים', topWood: 'פלטה' },
    defaults: { W: 1400, H: 750, D: 800, top: 30, leg: 60, apron: 90, over: 30, wood: 'oak', topWood: 'oak' },
    build: (p) => {
      const W = n(p, 'W'), H = n(p, 'H'), D = n(p, 'D');
      const top = n(p, 'top'), leg = n(p, 'leg'), ah = n(p, 'apron'), ov = n(p, 'over');
      const at = 22;
      const lh = H - top;
      const out: GenPart[] = [
        box('פלטה', 0, lh, 0, W, top, D, 'topWood', { kind: 'sheet' }),
        box('רגל 1', ov, 0, ov, leg, lh, leg, 'wood', { kind: 'beam' }),
        box('רגל 2', W - ov - leg, 0, ov, leg, lh, leg, 'wood', { kind: 'beam' }),
        box('רגל 3', ov, 0, D - ov - leg, leg, lh, leg, 'wood', { kind: 'beam' }),
        box('רגל 4', W - ov - leg, 0, D - ov - leg, leg, lh, leg, 'wood', { kind: 'beam' }),
      ];
      if (ah > 0) {
        const inset = Math.max(0, Math.min(8, (leg - at) / 2));
        out.push(box('סינר אחורי', ov + leg, lh - ah, ov + inset, W - 2 * ov - 2 * leg, ah, at, 'wood', { kind: 'board' }));
        out.push(box('סינר קדמי', ov + leg, lh - ah, D - ov - inset - at, W - 2 * ov - 2 * leg, ah, at, 'wood', { kind: 'board' }));
        out.push(box('סינר שמאל', ov + inset, lh - ah, ov + leg, at, ah, D - 2 * ov - 2 * leg, 'wood', { kind: 'board' }));
        out.push(box('סינר ימין', W - ov - inset - at, lh - ah, ov + leg, at, ah, D - 2 * ov - 2 * leg, 'wood', { kind: 'board' }));
      }
      return out;
    },
  },
  {
    id: 'bench',
    name: 'ספסל',
    params: [
      ...DIMS,
      { key: 'top', label: 'עובי מושב', kind: 'num', min: 15, max: 80, step: 1 },
      { key: 'leg', label: 'עובי רגל', kind: 'num', min: 15, max: 80, step: 1 },
      { key: 'stretcher', label: 'חיזוק', kind: 'bool' },
    ],
    materials: { wood: 'רגליים', topWood: 'מושב' },
    defaults: { W: 1200, H: 450, D: 350, top: 35, leg: 35, stretcher: true, wood: 'oak', topWood: 'oak' },
    build: (p) => {
      const W = n(p, 'W'), H = n(p, 'H'), D = n(p, 'D');
      const top = n(p, 'top'), lt = n(p, 'leg');
      const inset = Math.min(100, W * 0.08);
      const out: GenPart[] = [
        box('מושב', 0, H - top, 0, W, top, D, 'topWood', { kind: 'board', load: Math.round((W / 600) * 100), loadType: 'udl' }),
        box('רגל שמאל', inset, 0, 20, lt, H - top, D - 40, 'wood', { kind: 'sheet' }),
        box('רגל ימין', W - inset - lt, 0, 20, lt, H - top, D - 40, 'wood', { kind: 'sheet' }),
      ];
      if (b(p, 'stretcher')) out.push(box('חיזוק', inset + lt, 120, D / 2 - 12, W - 2 * inset - 2 * lt, 80, 24, 'wood', { kind: 'board', load: 0 }));
      return out;
    },
  },
  {
    id: 'drawer',
    name: 'מגירה',
    params: [...DIMS, T, { key: 'bottom', label: 'עובי תחתית', kind: 'num', min: 3, max: 18, step: 1 }],
    materials: { wood: 'דפנות', backWood: 'תחתית' },
    defaults: { W: 500, H: 150, D: 450, t: 12, bottom: 6, wood: 'plywood', backWood: 'plywood' },
    build: (p) => {
      const W = n(p, 'W'), H = n(p, 'H'), D = n(p, 'D'), t = n(p, 't'), bt = n(p, 'bottom');
      return [
        box('גב', 0, 0, 0, W, H, t, 'wood', { kind: 'board' }),
        box('חזית', 0, 0, D - t, W, H, t, 'wood', { kind: 'board' }),
        box('דופן שמאל', 0, 0, t, t, H, D - 2 * t, 'wood', { kind: 'board' }),
        box('דופן ימין', W - t, 0, t, t, H, D - 2 * t, 'wood', { kind: 'board' }),
        box('תחתית', t, 10, t, W - 2 * t, bt, D - 2 * t, 'backWood', { kind: 'sheet' }),
      ];
    },
  },
  {
    id: 'box',
    name: 'ארגז',
    params: [...DIMS, T, { key: 'lid', label: 'מכסה', kind: 'bool' }],
    materials: { wood: 'גוף' },
    defaults: { W: 400, H: 260, D: 300, t: 15, lid: true, wood: 'pine' },
    build: (p) => {
      const W = n(p, 'W'), H = n(p, 'H'), D = n(p, 'D'), t = n(p, 't');
      const lid = b(p, 'lid');
      const wh = H - t - (lid ? t : 0);
      const out: GenPart[] = [
        box('תחתית', 0, 0, 0, W, t, D, 'wood', { kind: 'sheet' }),
        box('גב', 0, t, 0, W, wh, t, 'wood', { kind: 'board' }),
        box('חזית', 0, t, D - t, W, wh, t, 'wood', { kind: 'board' }),
        box('דופן שמאל', 0, t, t, t, wh, D - 2 * t, 'wood', { kind: 'board' }),
        box('דופן ימין', W - t, t, t, t, wh, D - 2 * t, 'wood', { kind: 'board' }),
      ];
      if (lid) out.push(box('מכסה', 0, H - t, 0, W, t, D, 'wood', { kind: 'sheet', load: 0 }));
      return out;
    },
  },
];

export const TEMPLATE_MAP = Object.fromEntries(TEMPLATES.map((t) => [t.id, t])) as Record<TemplateId, TemplateDef>;

/** Footprint of a template group before rotation */
export const groupExtents = (g: Group): Vec3 => [Number(g.params.W), Number(g.params.H), Number(g.params.D)];

export const buildGroupParts = (g: Group): Part[] => {
  if (!g.template) return [];
  const def = TEMPLATE_MAP[g.template];
  const p = { ...def.defaults, ...g.params };
  const gen = def.build(p);
  const W = Number(p.W);
  const D = Number(p.D);
  const C = groupCenter(g);
  const gq = isIdentityQ(g.q) ? null : toQ(g.q);
  const parts = gen
    .filter((gp) => gp.size.every((s) => s > 0.5))
    .map((gp, i) => {
      let r = rotateBoxY(gp.pos, gp.size, W, D, g.rot);
      let partQ: Quat | undefined;
      if (gp.q && !isIdentityQ(gp.q)) {
        // turned parts keep their own box size; the quarter turn joins their rotation
        const c: Vec3 = [r.pos[0] + r.size[0] / 2, r.pos[1] + r.size[1] / 2, r.pos[2] + r.size[2] / 2];
        const yaw = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), ((((g.rot % 4) + 4) % 4) * Math.PI) / 2);
        const baked = bakeQuarter(gp.size, fromQ(yaw.multiply(toQ(gp.q))));
        r = { pos: posFromCenter(c, baked.size), size: baked.size };
        partQ = baked.q;
      }
      const id = `${g.id}-${i}`;
      const woodId = (p[gp.matRole] ?? p.wood ?? 'pine') as WoodId;
      const part: Part = {
        id,
        name: gp.name,
        groupId: g.id,
        pos: [r.pos[0] + g.origin[0], r.pos[1] + g.origin[1], r.pos[2] + g.origin[2]],
        size: r.size,
        wood: woodId,
        shape: gp.shape ?? 'box',
        role: gp.role ?? 'structure',
        anchored: gp.anchored ?? false,
        load: gp.load ?? null,
        loadType: gp.loadType ?? 'udl',
        seed: hashSeed(id + gp.name),
        kind: gp.kind ?? 'board',
        matRole: gp.matRole,
        q: partQ,
        cut: gp.cut,
      };
      return part;
    });
  if (!gq) return parts;
  // turn the whole piece about its centre
  return parts.map((part) => {
    const c = new Vector3(part.pos[0] + part.size[0] / 2, part.pos[1] + part.size[1] / 2, part.pos[2] + part.size[2] / 2);
    c.sub(new Vector3(...C)).applyQuaternion(gq).add(new Vector3(...C));
    const q = fromQ(gq.clone().multiply(toQ(part.q)));
    return { ...part, pos: posFromCenter([c.x, c.y, c.z], part.size), q: isIdentityQ(q) ? undefined : q };
  });
};

/** extents of a template piece after its quarter turns (before the free rotation) */
export const groupRotExtents = (g: Group): Vec3 => {
  const e = groupExtents(g);
  return ((g.rot % 4) + 4) % 2 ? [e[2], e[1], e[0]] : e;
};

export const groupCenter = (g: Group): Vec3 => {
  const e = groupRotExtents(g);
  return [g.origin[0] + e[0] / 2, g.origin[1] + e[1] / 2, g.origin[2] + e[2] / 2];
};

/** which template parameter a world axis maps to, given the group's rotation */
export const axisParam = (rot: number, axis: number): 'W' | 'H' | 'D' => {
  if (axis === 1) return 'H';
  const odd = ((rot % 4) + 4) % 4 % 2 === 1;
  if (axis === 0) return odd ? 'D' : 'W';
  return odd ? 'W' : 'D';
};
