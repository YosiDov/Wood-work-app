import type { WoodId } from './types';

export type TextureStyle = 'grain' | 'ply' | 'block' | 'mdf' | 'melamine' | 'osb';

export interface Wood {
  id: WoodId;
  name: string;
  /** latin / trade name shown small */
  latin: string;
  kind: 'solid' | 'panel';
  /** mean density, kg/m³ */
  density: number;
  /** mean modulus of elasticity in bending, MPa */
  E: number;
  /** characteristic bending strength f_m,k, MPa */
  fmk: number;
  /** characteristic compression strength parallel to grain f_c,0,k, MPa */
  fck: number;
  /** strength modification factor, long-term load (EN 1995 table 3.1, service class 1) */
  kmodLong: number;
  /** strength modification factor, short-term load */
  kmodShort: number;
  /** partial safety factor for the material γM */
  gammaM: number;
  /** creep factor k_def (EN 1995 table 3.2, service class 1) */
  kdef: number;
  /** estimated price, ₪ per m³ (editable) */
  price: number;
  style: TextureStyle;
  /** base, dark (late-wood / figure) and light tones */
  colors: [string, string, string];
  /** strength class label */
  grade: string;
}

/*
 * Values: EN 338 strength classes for solid timber (C24 for pine, D-classes for
 * hardwoods), EN 1995-1-1 k_mod / k_def / γM, EN 636 / EN 622-5 / EN 312 / EN 300
 * typical characteristic values for panels. Prices are rough Israeli retail
 * estimates and can be edited in the project panel.
 */
export const WOODS: Wood[] = [
  { id: 'pine', name: 'אורן', latin: 'Pine', kind: 'solid', density: 450, E: 11000, fmk: 24, fck: 21, kmodLong: 0.7, kmodShort: 0.9, gammaM: 1.3, kdef: 0.6, price: 3200, style: 'grain', colors: ['#e7c896', '#c4955a', '#f3dcb4'], grade: 'C24' },
  { id: 'oak', name: 'אלון', latin: 'Oak', kind: 'solid', density: 690, E: 11000, fmk: 30, fck: 24, kmodLong: 0.7, kmodShort: 0.9, gammaM: 1.3, kdef: 0.6, price: 14000, style: 'grain', colors: ['#bf9461', '#8d6438', '#d6b27f'], grade: 'D30' },
  { id: 'beech', name: 'בוק', latin: 'Beech', kind: 'solid', density: 720, E: 13000, fmk: 40, fck: 26, kmodLong: 0.7, kmodShort: 0.9, gammaM: 1.3, kdef: 0.6, price: 9000, style: 'grain', colors: ['#dcaa7c', '#bd8659', '#ebc39b'], grade: 'D40' },
  { id: 'walnut', name: 'אגוז', latin: 'Walnut', kind: 'solid', density: 640, E: 11500, fmk: 35, fck: 25, kmodLong: 0.7, kmodShort: 0.9, gammaM: 1.3, kdef: 0.6, price: 22000, style: 'grain', colors: ['#6f4a33', '#46291b', '#8a6247'], grade: 'D35' },
  { id: 'maple', name: 'מייפל', latin: 'Maple', kind: 'solid', density: 700, E: 12600, fmk: 40, fck: 27, kmodLong: 0.7, kmodShort: 0.9, gammaM: 1.3, kdef: 0.6, price: 13000, style: 'grain', colors: ['#ecd7b1', '#d2b385', '#f6e8cc'], grade: 'D40' },
  { id: 'cherry', name: 'דובדבן', latin: 'Cherry', kind: 'solid', density: 580, E: 10300, fmk: 30, fck: 24, kmodLong: 0.7, kmodShort: 0.9, gammaM: 1.3, kdef: 0.6, price: 16000, style: 'grain', colors: ['#b8734c', '#8f4f33', '#cf8f66'], grade: 'D30' },
  { id: 'teak', name: 'טיק', latin: 'Teak', kind: 'solid', density: 660, E: 12300, fmk: 40, fck: 26, kmodLong: 0.7, kmodShort: 0.9, gammaM: 1.3, kdef: 0.6, price: 30000, style: 'grain', colors: ['#aa7a42', '#7b5329', '#c2955c'], grade: 'D40' },
  { id: 'meranti', name: 'עץ אדום', latin: 'Meranti', kind: 'solid', density: 560, E: 10500, fmk: 30, fck: 23, kmodLong: 0.7, kmodShort: 0.9, gammaM: 1.3, kdef: 0.6, price: 6500, style: 'grain', colors: ['#a6573f', '#7c3a29', '#bd7259'], grade: 'D30' },
  { id: 'plywood', name: 'דיקט ליבנה', latin: 'Birch plywood', kind: 'panel', density: 680, E: 9000, fmk: 35, fck: 25, kmodLong: 0.7, kmodShort: 0.9, gammaM: 1.2, kdef: 0.8, price: 7500, style: 'ply', colors: ['#e9d4aa', '#cdb084', '#f4e6c8'], grade: 'EN 636' },
  { id: 'blockboard', name: 'סנדוויץ׳', latin: 'Blockboard', kind: 'panel', density: 500, E: 7000, fmk: 22, fck: 15, kmodLong: 0.7, kmodShort: 0.9, gammaM: 1.2, kdef: 0.8, price: 5500, style: 'block', colors: ['#dcc29a', '#b99a6c', '#ead6b5'], grade: 'EN 13353' },
  { id: 'mdf', name: 'MDF', latin: 'MDF', kind: 'panel', density: 740, E: 2800, fmk: 20, fck: 12, kmodLong: 0.4, kmodShort: 0.8, gammaM: 1.3, kdef: 2.25, price: 3000, style: 'mdf', colors: ['#b48c63', '#9c7650', '#c6a07a'], grade: 'EN 622-5' },
  { id: 'melamine', name: 'מלמין', latin: 'Melamine chipboard', kind: 'panel', density: 650, E: 3200, fmk: 14.2, fck: 12, kmodLong: 0.45, kmodShort: 0.85, gammaM: 1.3, kdef: 2.25, price: 2800, style: 'melamine', colors: ['#f1f0eb', '#d9d7cf', '#fbfaf6'], grade: 'P4' },
  { id: 'osb', name: 'OSB', latin: 'OSB/3', kind: 'panel', density: 620, E: 4930, fmk: 16.4, fck: 15.4, kmodLong: 0.5, kmodShort: 0.9, gammaM: 1.2, kdef: 1.5, price: 2200, style: 'osb', colors: ['#cfa66c', '#9c7440', '#e2c08c'], grade: 'OSB/3' },
];

export const WOOD_MAP: Record<WoodId, Wood> = Object.fromEntries(WOODS.map((w) => [w.id, w])) as Record<WoodId, Wood>;

export const wood = (id: WoodId): Wood => WOOD_MAP[id] ?? WOOD_MAP.pine;

export const SHEET_AREA_M2 = 2.44 * 1.22;
