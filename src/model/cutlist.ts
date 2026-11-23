import type { Project, WoodId } from './types';
import { hasCut, partVolume, sortedDims } from './geometry';
import { SHEET_AREA_M2, wood } from './woods';

export interface CutRow {
  key: string;
  names: string[];
  qty: number;
  L: number;
  W: number;
  T: number;
  round: boolean;
  /** end cut angles, or null for square ends */
  angles: [number, number] | null;
  wood: WoodId;
  volume: number;
  weight: number;
  cost: number;
  ids: string[];
}

export interface WoodTotal {
  wood: WoodId;
  volume: number;
  weight: number;
  cost: number;
  area: number;
  sheets: number;
  pieces: number;
}

export const cutList = (project: Project) => {
  const rows = new Map<string, CutRow>();
  for (const p of project.parts) {
    const [L, W, T] = sortedDims(p.size);
    const round = p.shape === 'rod';
    const angles: [number, number] | null = hasCut(p) ? (p.cut!.map((a) => Math.round(Math.abs(a) * 10) / 10).sort((a, b) => a - b) as [number, number]) : null;
    const key = `${p.wood}|${round ? 'r' : 'b'}|${L.toFixed(1)}|${W.toFixed(1)}|${T.toFixed(1)}|${angles ? angles.join('/') : ''}`;
    const v = partVolume(p);
    const w = wood(p.wood);
    const price = project.prices[p.wood] ?? w.price;
    const r = rows.get(key);
    if (r) {
      r.qty++;
      if (!r.names.includes(p.name)) r.names.push(p.name);
      r.volume += v;
      r.weight += v * w.density;
      r.cost += v * price;
      r.ids.push(p.id);
    } else {
      rows.set(key, { key, names: [p.name], qty: 1, L, W, T, round, angles, wood: p.wood, volume: v, weight: v * w.density, cost: v * price, ids: [p.id] });
    }
  }
  const list = [...rows.values()].sort((a, b) => (a.wood === b.wood ? b.T - a.T || b.L - a.L : a.wood.localeCompare(b.wood)));
  const totals = new Map<WoodId, WoodTotal>();
  for (const r of list) {
    const t = totals.get(r.wood) ?? { wood: r.wood, volume: 0, weight: 0, cost: 0, area: 0, sheets: 0, pieces: 0 };
    t.volume += r.volume;
    t.weight += r.weight;
    t.cost += r.cost;
    t.pieces += r.qty;
    t.area += (r.L * r.W * r.qty) / 1e6;
    totals.set(r.wood, t);
  }
  for (const t of totals.values()) {
    if (wood(t.wood).kind === 'panel') t.sheets = Math.ceil((t.area * 1.15) / SHEET_AREA_M2);
  }
  return { rows: list, totals: [...totals.values()] };
};

/** "32°" for both ends alike, "32° / 45°" otherwise, "" for square ends */
export const cutLabel = (a: [number, number] | null) => (!a ? '' : a[0] === a[1] ? `${a[0]}°` : `${a[0]}° / ${a[1]}°`);

export const cutListCSV = (project: Project): string => {
  const { rows } = cutList(project);
  const head = ['כמות', 'שם', 'אורך (מ״מ)', 'רוחב (מ״מ)', 'עובי (מ״מ)', 'צורה', 'זווית חיתוך בקצוות', 'חומר', 'משקל (ק״ג)', 'עלות משוערת (₪)'];
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [head.map(esc).join(',')];
  for (const r of rows) {
    lines.push(
      [r.qty, r.names.join(' / '), r.L.toFixed(1), r.round ? `Ø${r.W.toFixed(1)}` : r.W.toFixed(1), r.round ? '' : r.T.toFixed(1), r.round ? 'עגול' : 'מלבני', cutLabel(r.angles), wood(r.wood).name, r.weight.toFixed(2), Math.round(r.cost)]
        .map(esc)
        .join(','),
    );
  }
  return '﻿' + lines.join('\r\n');
};
