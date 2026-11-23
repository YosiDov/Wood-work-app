import { create } from 'zustand';
import type { Group, MatRole, ParamValue, Part, PartKind, Project, Selection, TemplateId, Tool, Vec3, ViewMode, WoodId } from './types';
import { Quaternion, Vector3 } from 'three';
import { anglesToQuat, bakeQuarter, boxCenter, boxOfParts, boxSize, fromQ, hashSeed, isIdentityQ, partCenter, posFromCenter, toQ, uid } from './geometry';
import { TEMPLATE_MAP, axisParam, buildGroupParts, groupCenter, groupRotExtents } from './templates';

export type Panel = null | 'templates' | 'cutlist' | 'help' | 'file';

export interface Toast {
  id: number;
  text: string;
  kind: 'ok' | 'warn' | 'bad';
  action?: { label: string; run: () => void };
}

interface State {
  project: Project;
  past: Project[];
  future: Project[];
  selection: Selection;
  hover: string | null;
  tool: Tool;
  view: ViewMode;
  explode: number;
  strength: boolean;
  dims: boolean;
  panel: Panel;
  toast: Toast | null;
  defaultWood: WoodId;
  /** bump to ask the viewport to frame the current selection / scene */
  frameTick: number;
  hosted: boolean;
}

interface Actions {
  set: (p: Partial<State>) => void;
  commit: (fn: (p: Project) => Project) => void;
  beginTransient: () => void;
  transient: (fn: (p: Project) => Project) => void;
  undo: () => void;
  redo: () => void;
  select: (s: Selection) => void;
  toastMsg: (text: string, kind?: Toast['kind'], action?: Toast['action']) => void;
  addPart: (kind: PartKind) => void;
  addTemplate: (id: TemplateId) => void;
  updatePart: (id: string, patch: Partial<Part>) => void;
  setPartWood: (id: string, wood: WoodId) => void;
  setGroupParam: (groupId: string, key: string, value: ParamValue, live?: boolean) => void;
  setGroupWood: (groupId: string, role: MatRole, wood: WoodId) => void;
  renameGroup: (groupId: string, name: string) => void;
  resizeGroupAxis: (groupId: string, axis: number, size: number, fromMin: boolean) => void;
  deleteSelection: () => void;
  duplicateSelection: () => void;
  rotateSelection: (axis: 0 | 1 | 2, deg?: number) => void;
  /** set the absolute angles (yaw, tilt X, tilt Z in degrees) of the selected part or piece */
  setRotation: (angles: Vec3) => void;
  selectAll: () => void;
  nudgeSelection: (d: Vec3) => void;
  groupSelection: () => void;
  ungroup: (groupId: string) => void;
  anchorGroup: (groupId: string, on: boolean) => void;
  newProject: () => void;
  loadProject: (p: Project, name?: string) => void;
}

export const selectedPartIds = (s: Pick<State, 'selection' | 'project'>): string[] => {
  const sel = s.selection;
  if (sel.kind === 'group') return s.project.parts.filter((p) => p.groupId === sel.id).map((p) => p.id);
  if (sel.kind === 'parts') return sel.ids;
  return [];
};

const PART_DEFAULTS: Record<PartKind, { name: string; size: Vec3; wood: WoodId; shape: Part['shape'] }> = {
  board: { name: 'קרש', size: [800, 20, 150], wood: 'pine', shape: 'box' },
  sheet: { name: 'לוח', size: [600, 18, 400], wood: 'plywood', shape: 'box' },
  beam: { name: 'קורה', size: [45, 720, 45], wood: 'pine', shape: 'box' },
  rod: { name: 'מוט', size: [800, 28, 28], wood: 'beech', shape: 'rod' },
};

const makeGroup = (template: TemplateId, origin: Vec3, overrides: Record<string, ParamValue> = {}): Group => {
  const def = TEMPLATE_MAP[template];
  return {
    id: uid(),
    name: def.name,
    template,
    params: { ...def.defaults, ...overrides },
    origin,
    rot: 0,
    custom: false,
  };
};

const withGroupParts = (p: Project, g: Group): Project => ({
  ...p,
  groups: p.groups.some((x) => x.id === g.id) ? p.groups.map((x) => (x.id === g.id ? g : x)) : [...p.groups, g],
  parts: [...p.parts.filter((x) => x.groupId !== g.id), ...buildGroupParts(g)],
});

export const sampleProject = (): Project => {
  let p: Project = { version: 1, name: 'הסלון של מושקי', parts: [], groups: [], designLoad: 100, prices: {} };
  const shelf = makeGroup('bookcase', [-1050, 0, -320], { W: 900 });
  const table = makeGroup('table', [150, 0, -400], { W: 1200, D: 700 });
  p = withGroupParts(p, shelf);
  p = withGroupParts(p, table);
  return p;
};

const emptyProject = (): Project => ({ version: 1, name: 'פרויקט חדש', parts: [], groups: [], designLoad: 100, prices: {} });

const STORAGE_KEY = 'mushki-woodworks:v1';

const loadSaved = (): Project | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Project;
    if (p && p.version === 1 && Array.isArray(p.parts)) return p;
  } catch {
    /* storage unavailable */
  }
  return null;
};

/** find a free spot on the floor to the right of everything */
const freeSpot = (p: Project, size: Vec3): Vec3 => {
  const bb = boxOfParts(p.parts);
  if (!bb) return [-size[0] / 2, 0, -size[2] / 2];
  return [Math.round(bb.max[0] + 150), 0, Math.round(bb.min[2])];
};

export const markCustom = (p: Project, partIds: string[]): Project => {
  const gids = new Set(p.parts.filter((x) => partIds.includes(x.id) && x.groupId).map((x) => x.groupId!));
  if (!gids.size) return p;
  return { ...p, groups: p.groups.map((g) => (gids.has(g.id) && g.template ? { ...g, custom: true } : g)) };
};

let toastId = 0;

/** the whole rotation of a template piece: its quarter turns, then its free rotation */
export const groupTotalQ = (g: Group): Quaternion =>
  toQ(g.q).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), ((((g.rot % 4) + 4) % 4) * Math.PI) / 2));

/** centre to turn the selection about, and the floor level it rests on */
export const rotationPivot = (p: Project, sel: Selection): { pivot: Vec3; floor: number } | null => {
  const ids = selectedPartIds({ selection: sel, project: p });
  const bb = boxOfParts(p.parts.filter((x) => ids.includes(x.id)));
  if (!bb) return null;
  if (sel.kind === 'group') {
    const g = p.groups.find((x) => x.id === sel.id);
    if (g?.template && !g.custom) return { pivot: groupCenter(g), floor: bb.min[1] };
  }
  return { pivot: boxCenter(bb), floor: bb.min[1] };
};

const r1 = (v: number) => Math.round(v * 10) / 10;

/** pure yaw of a whole number of quarter turns → that number, else null */
const quarterYaw = (q: Quaternion): number | null => {
  if (Math.abs(q.x) > 1e-6 || Math.abs(q.z) > 1e-6) return null;
  const a = 2 * Math.atan2(q.y, q.w);
  const n = Math.round(a / (Math.PI / 2));
  return Math.abs(a - (n * Math.PI) / 2) < 1e-6 ? n : null;
};

/**
 * Turn the selection by `dq` about `pivot`, keeping its lowest point at `floor`. Turns that land on
 * whole 90° steps are folded back into plain axis-aligned boards.
 */
export const rotateProject = (p: Project, sel: Selection, dq: Quaternion, pivot: Vec3, floor: number | null): Project => {
  const P = new Vector3(...pivot);
  if (sel.kind === 'group') {
    const g = p.groups.find((x) => x.id === sel.id);
    // hand-edited pieces turn part by part so the edits survive
    if (g?.template && !g.custom) {
      let q = dq.clone().multiply(toQ(g.q)).normalize();
      let rot = g.rot;
      const n = quarterYaw(q);
      if (n !== null) {
        rot = (((rot + n) % 4) + 4) % 4;
        q = new Quaternion();
      }
      const c = new Vector3(...groupCenter(g)).sub(P).applyQuaternion(dq).add(P);
      let ng: Group = { ...g, rot, q: isIdentityQ(fromQ(q)) ? undefined : fromQ(q) };
      ng.origin = posFromCenter([c.x, c.y, c.z], groupRotExtents(ng)).map(r1) as Vec3;
      if (floor !== null) {
        const bb = boxOfParts(buildGroupParts(ng));
        if (bb) ng = { ...ng, origin: [ng.origin[0], r1(ng.origin[1] + floor - bb.min[1]), ng.origin[2]] };
      }
      return withGroupParts(p, ng);
    }
  }
  const ids = new Set(selectedPartIds({ selection: sel, project: p }));
  const moved = new Map<string, Part>();
  for (const x of p.parts) {
    if (!ids.has(x.id)) continue;
    const c = new Vector3(...partCenter(x)).sub(P).applyQuaternion(dq).add(P);
    const q = fromQ(dq.clone().multiply(toQ(x.q)));
    const baked = bakeQuarter(x.size, q);
    moved.set(x.id, { ...x, size: baked.size, q: baked.q, pos: posFromCenter([c.x, c.y, c.z], baked.size) });
  }
  let dy = 0;
  if (floor !== null) {
    const bb = boxOfParts([...moved.values()]);
    if (bb) dy = floor - bb.min[1];
  }
  const parts = p.parts.map((x) => {
    const m = moved.get(x.id);
    return m ? { ...m, pos: [r1(m.pos[0]), r1(m.pos[1] + dy), r1(m.pos[2])] as Vec3 } : x;
  });
  const next = { ...p, parts };
  return sel.kind === 'parts' ? markCustom(next, [...ids]) : next;
};

export const useStore = create<State & Actions>((set, get) => ({
  project: loadSaved() ?? sampleProject(),
  past: [],
  future: [],
  selection: { kind: 'none' },
  hover: null,
  tool: 'move',
  view: 'persp',
  explode: 0,
  strength: false,
  dims: true,
  panel: null,
  toast: null,
  defaultWood: 'pine',
  frameTick: 0,
  hosted: typeof window !== 'undefined' && !!(window as unknown as { claude?: { use?: unknown } }).claude?.use,

  set: (p) => set(p),

  commit: (fn) => {
    const { project, past } = get();
    const next = fn(project);
    if (next === project) return;
    set({ project: next, past: [...past.slice(-80), project], future: [] });
  },

  beginTransient: () => {
    const { project, past } = get();
    set({ past: [...past.slice(-80), project], future: [] });
  },

  transient: (fn) => set({ project: fn(get().project) }),

  undo: () => {
    const { past, project, future } = get();
    if (!past.length) return;
    const prev = past[past.length - 1];
    set({ project: prev, past: past.slice(0, -1), future: [project, ...future] });
    get().select(validSel(get().selection, prev));
  },

  redo: () => {
    const { past, project, future } = get();
    if (!future.length) return;
    const next = future[0];
    set({ project: next, past: [...past, project], future: future.slice(1) });
    get().select(validSel(get().selection, next));
  },

  select: (s) => set({ selection: s }),

  toastMsg: (text, kind = 'ok', action) => {
    const id = ++toastId;
    set({ toast: { id, text, kind, action } });
    setTimeout(() => {
      if (get().toast?.id === id) set({ toast: null });
    }, action ? 5000 : 2600);
  },

  addPart: (kind) => {
    const d = PART_DEFAULTS[kind];
    const st = get();
    const selIds = selectedPartIds(st);
    let pos: Vec3;
    if (selIds.length) {
      const bb = boxOfParts(st.project.parts.filter((x) => selIds.includes(x.id)))!;
      const c = boxCenter(bb);
      pos = [Math.round(c[0] - d.size[0] / 2), Math.round(bb.max[1]), Math.round(c[2] - d.size[2] / 2)];
    } else {
      pos = freeSpot(st.project, d.size);
    }
    const id = uid();
    const count = st.project.parts.filter((x) => x.kind === kind && !x.groupId).length + 1;
    const part: Part = {
      id,
      name: `${d.name} ${count}`,
      groupId: null,
      pos,
      size: [...d.size] as Vec3,
      wood: kind === 'sheet' || kind === 'rod' ? d.wood : st.defaultWood,
      shape: d.shape,
      role: 'structure',
      anchored: false,
      load: null,
      loadType: 'udl',
      seed: hashSeed(id),
      kind,
    };
    get().commit((p) => ({ ...p, parts: [...p.parts, part] }));
    set({ selection: { kind: 'parts', ids: [id] }, frameTick: get().frameTick + 1 });
  },

  addTemplate: (tid) => {
    const def = TEMPLATE_MAP[tid];
    const st = get();
    const W = Number(def.defaults.W);
    const D = Number(def.defaults.D);
    const spot = freeSpot(st.project, [W, 0, D]);
    const g = makeGroup(tid, [spot[0], def.startY ?? 0, spot[2]]);
    const same = st.project.groups.filter((x) => x.template === tid).length;
    if (same) g.name = `${def.name} ${same + 1}`;
    get().commit((p) => withGroupParts(p, g));
    set({ selection: { kind: 'group', id: g.id }, panel: null, frameTick: get().frameTick + 1 });
  },

  updatePart: (id, patch) => {
    get().commit((p) => {
      const next = { ...p, parts: p.parts.map((x) => (x.id === id ? { ...x, ...patch } : x)) };
      const geo = 'pos' in patch || 'size' in patch || 'shape' in patch;
      return geo ? markCustom(next, [id]) : next;
    });
  },

  setPartWood: (id, w) => {
    const st = get();
    const part = st.project.parts.find((x) => x.id === id);
    if (!part) return;
    const g = part.groupId ? st.project.groups.find((x) => x.id === part.groupId) : null;
    if (g && g.template && part.matRole) {
      get().setGroupWood(g.id, part.matRole, w);
      return;
    }
    get().updatePart(id, { wood: w });
  },

  setGroupParam: (gid, key, value, live) => {
    const fn = (p: Project) => {
      const g = p.groups.find((x) => x.id === gid);
      if (!g || !g.template) return p;
      return withGroupParts(p, { ...g, params: { ...g.params, [key]: value }, custom: false });
    };
    if (live) get().transient(fn);
    else get().commit(fn);
  },

  setGroupWood: (gid, role, w) => {
    get().commit((p) => {
      const g = p.groups.find((x) => x.id === gid);
      if (!g) return p;
      if (!g.template) {
        return { ...p, parts: p.parts.map((x) => (x.groupId === gid ? { ...x, wood: w } : x)) };
      }
      const ng = { ...g, params: { ...g.params, [role]: w } };
      return {
        ...p,
        groups: p.groups.map((x) => (x.id === gid ? ng : x)),
        parts: p.parts.map((x) => (x.groupId === gid && (x.matRole ?? 'wood') === role ? { ...x, wood: w } : x)),
      };
    });
  },

  renameGroup: (gid, name) => get().commit((p) => ({ ...p, groups: p.groups.map((g) => (g.id === gid ? { ...g, name } : g)) })),

  resizeGroupAxis: (gid, axis, size, fromMin) => {
    const st = get();
    const g = st.project.groups.find((x) => x.id === gid);
    if (!g || !g.template) return;
    const key = axisParam(g.rot, axis);
    const rotExt = groupRotExtents(g);
    const delta = size - rotExt[axis];
    // the opposite face stays put: move the centre half the change along the piece's own axis
    const shift = new Vector3();
    shift.setComponent(axis, ((fromMin ? -1 : 1) * delta) / 2);
    shift.applyQuaternion(toQ(g.q));
    const c = groupCenter(g);
    const nRot = [...rotExt] as Vec3;
    nRot[axis] = size;
    const origin = posFromCenter([c[0] + shift.x, c[1] + shift.y, c[2] + shift.z], nRot);
    const ng: Group = { ...g, origin, params: { ...g.params, [key]: Math.round(size) }, custom: false };
    st.transient((p) => withGroupParts(p, ng));
  },

  deleteSelection: () => {
    const st = get();
    const sel = st.selection;
    if (sel.kind === 'none') return;
    get().commit((p) => {
      if (sel.kind === 'group') return { ...p, groups: p.groups.filter((g) => g.id !== sel.id), parts: p.parts.filter((x) => x.groupId !== sel.id) };
      const ids = new Set(sel.ids);
      const next = { ...p, parts: p.parts.filter((x) => !ids.has(x.id)) };
      const marked = markCustom(p, sel.ids);
      return { ...next, groups: marked.groups.filter((g) => next.parts.some((x) => x.groupId === g.id)) };
    });
    set({ selection: { kind: 'none' } });
  },

  duplicateSelection: () => {
    const st = get();
    const sel = st.selection;
    if (sel.kind === 'none') return;
    const ids = selectedPartIds(st);
    const bb = boxOfParts(st.project.parts.filter((x) => ids.includes(x.id)));
    if (!bb) return;
    const dx = Math.round(boxSize(bb)[0] + (sel.kind === 'group' ? 100 : 40));
    if (sel.kind === 'group') {
      const g = st.project.groups.find((x) => x.id === sel.id)!;
      const ng: Group = { ...g, id: uid(), name: `${g.name} (עותק)`, origin: [g.origin[0] + dx, g.origin[1], g.origin[2]] };
      const parts = st.project.parts
        .filter((x) => x.groupId === g.id)
        .map((x, i) => ({ ...x, id: g.template && !g.custom ? `${ng.id}-${i}` : uid(), groupId: ng.id, pos: [x.pos[0] + dx, x.pos[1], x.pos[2]] as Vec3 }));
      get().commit((p) => ({ ...p, groups: [...p.groups, ng], parts: [...p.parts, ...parts] }));
      set({ selection: { kind: 'group', id: ng.id } });
    } else {
      const copies = st.project.parts
        .filter((x) => ids.includes(x.id))
        .map((x) => ({ ...x, id: uid(), groupId: null, name: x.name, pos: [x.pos[0] + dx, x.pos[1], x.pos[2]] as Vec3, matRole: undefined }));
      get().commit((p) => ({ ...p, parts: [...p.parts, ...copies] }));
      set({ selection: { kind: 'parts', ids: copies.map((c) => c.id) } });
    }
  },

  rotateSelection: (axis, deg = 90) => {
    const st = get();
    if (st.selection.kind === 'none') return;
    const dq = new Quaternion().setFromAxisAngle(new Vector3(axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0), (deg * Math.PI) / 180);
    const piv = rotationPivot(st.project, st.selection);
    if (!piv) return;
    get().commit((p) => rotateProject(p, st.selection, dq, piv.pivot, piv.floor));
  },

  setRotation: (angles) => {
    const st = get();
    const sel = st.selection;
    const target = toQ(anglesToQuat(angles));
    let current: Quaternion;
    if (sel.kind === 'group') {
      const g = st.project.groups.find((x) => x.id === sel.id);
      if (!g) return;
      current = groupTotalQ(g);
    } else if (sel.kind === 'parts' && sel.ids.length === 1) {
      const part = st.project.parts.find((x) => x.id === sel.ids[0]);
      if (!part) return;
      current = toQ(part.q);
    } else return;
    const dq = target.multiply(current.invert());
    const piv = rotationPivot(st.project, sel);
    if (!piv) return;
    get().commit((p) => rotateProject(p, sel, dq, piv.pivot, piv.floor));
  },

  selectAll: () => {
    const st = get();
    const ids = st.project.parts.map((p) => p.id);
    set({ selection: ids.length ? { kind: 'parts', ids } : { kind: 'none' } });
  },

  nudgeSelection: (d) => {
    const st = get();
    const sel = st.selection;
    if (sel.kind === 'none') return;
    const ids = new Set(selectedPartIds(st));
    get().commit((p) => {
      const parts = p.parts.map((x) => (ids.has(x.id) ? { ...x, pos: [x.pos[0] + d[0], Math.max(0, x.pos[1] + d[1]), x.pos[2] + d[2]] as Vec3 } : x));
      if (sel.kind === 'group') {
        return { ...p, parts, groups: p.groups.map((g) => (g.id === sel.id ? { ...g, origin: [g.origin[0] + d[0], g.origin[1] + d[1], g.origin[2] + d[2]] as Vec3 } : g)) };
      }
      return markCustom({ ...p, parts }, [...ids]);
    });
  },

  groupSelection: () => {
    const st = get();
    const sel = st.selection;
    if (sel.kind !== 'parts' || sel.ids.length < 2) return;
    const g: Group = { id: uid(), name: `קבוצה ${st.project.groups.length + 1}`, template: null, params: {}, origin: [0, 0, 0], rot: 0, custom: false };
    get().commit((p) => {
      const oldGroups = new Set(p.parts.filter((x) => sel.ids.includes(x.id) && x.groupId).map((x) => x.groupId));
      const parts = p.parts.map((x) => (sel.ids.includes(x.id) ? { ...x, groupId: g.id, matRole: undefined } : x));
      const groups = [...p.groups.map((x) => (oldGroups.has(x.id) ? { ...x, custom: true } : x)), g].filter((x) => parts.some((pp) => pp.groupId === x.id));
      return { ...p, parts, groups };
    });
    set({ selection: { kind: 'group', id: g.id } });
  },

  ungroup: (gid) => {
    get().commit((p) => ({
      ...p,
      groups: p.groups.filter((g) => g.id !== gid),
      parts: p.parts.map((x) => (x.groupId === gid ? { ...x, groupId: null, matRole: undefined } : x)),
    }));
    set({ selection: { kind: 'none' } });
  },

  anchorGroup: (gid, on) => {
    get().commit((p) => {
      const gp = p.parts.filter((x) => x.groupId === gid && x.role === 'structure');
      if (!gp.length) return p;
      const minZ = Math.min(...gp.map((x) => x.pos[2]));
      const back = new Set(gp.filter((x) => Math.abs(x.pos[2] - minZ) < 1).map((x) => x.id));
      return { ...p, parts: p.parts.map((x) => (back.has(x.id) ? { ...x, anchored: on } : x)) };
    });
  },

  newProject: () => {
    get().commit(() => emptyProject());
    set({ selection: { kind: 'none' }, frameTick: get().frameTick + 1 });
  },

  loadProject: (proj, name) => {
    get().commit(() => ({ ...proj, name: name ?? proj.name }));
    set({ selection: { kind: 'none' }, frameTick: get().frameTick + 1 });
  },
}));

const validSel = (s: Selection, p: Project): Selection => {
  if (s.kind === 'group') return p.groups.some((g) => g.id === s.id) ? s : { kind: 'none' };
  if (s.kind === 'parts') {
    const ids = s.ids.filter((id) => p.parts.some((x) => x.id === id));
    return ids.length ? { kind: 'parts', ids } : { kind: 'none' };
  }
  return s;
};

// autosave
let saveTimer: ReturnType<typeof setTimeout> | null = null;
useStore.subscribe((s, prev) => {
  if (s.project === prev.project) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(useStore.getState().project));
    } catch {
      /* storage unavailable */
    }
  }, 400);
});
