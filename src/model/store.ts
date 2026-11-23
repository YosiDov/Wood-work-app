import { create } from 'zustand';
import type { Group, MatRole, ParamValue, Part, PartKind, Project, Selection, TemplateId, Tool, Vec3, ViewMode, WoodId } from './types';
import { boxCenter, boxOfParts, boxSize, hashSeed, uid } from './geometry';
import { TEMPLATE_MAP, axisParam, buildGroupParts, groupExtents } from './templates';

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
  rotateSelection: (axis: 0 | 1 | 2) => void;
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
    const ext = groupExtents(g);
    const rotExt: Vec3 = g.rot % 2 ? [ext[2], ext[1], ext[0]] : ext;
    const delta = size - rotExt[axis];
    const origin: Vec3 = [...g.origin];
    if (fromMin) origin[axis] -= delta;
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

  rotateSelection: (axis) => {
    const st = get();
    const sel = st.selection;
    if (sel.kind === 'none') return;
    const ids = selectedPartIds(st);
    const sp = st.project.parts.filter((x) => ids.includes(x.id));
    const bb = boxOfParts(sp);
    if (!bb) return;
    const c = boxCenter(bb);
    if (sel.kind === 'group' && axis === 1) {
      const g = st.project.groups.find((x) => x.id === sel.id)!;
      if (g.template && !g.custom) {
        const ext = groupExtents(g);
        const rot = (g.rot + 1) % 4;
        const nExt: Vec3 = rot % 2 ? [ext[2], ext[1], ext[0]] : ext;
        const ng: Group = { ...g, rot, origin: [Math.round(c[0] - nExt[0] / 2), g.origin[1], Math.round(c[2] - nExt[2] / 2)] };
        get().commit((p) => withGroupParts(p, ng));
        return;
      }
    }
    // rotate every part box 90° about the selection centre
    const [a, b] = axis === 1 ? [0, 2] : axis === 0 ? [1, 2] : [0, 1];
    const rotated = new Map<string, Part>();
    for (const x of sp) {
      const size: Vec3 = [...x.size];
      size[a] = x.size[b];
      size[b] = x.size[a];
      const pc: Vec3 = [x.pos[0] + x.size[0] / 2, x.pos[1] + x.size[1] / 2, x.pos[2] + x.size[2] / 2];
      const rel = [pc[a] - c[a], pc[b] - c[b]];
      const nc: Vec3 = [...pc];
      nc[a] = c[a] - rel[1];
      nc[b] = c[b] + rel[0];
      const pos: Vec3 = [nc[0] - size[0] / 2, nc[1] - size[1] / 2, nc[2] - size[2] / 2];
      rotated.set(x.id, { ...x, size, pos: pos.map((v) => Math.round(v * 10) / 10) as Vec3 });
    }
    // keep resting on the same floor level
    const nb = boxOfParts([...rotated.values()])!;
    const dy = bb.min[1] - nb.min[1];
    get().commit((p) =>
      markCustom(
        { ...p, parts: p.parts.map((x) => (rotated.has(x.id) ? { ...rotated.get(x.id)!, pos: [rotated.get(x.id)!.pos[0], rotated.get(x.id)!.pos[1] + dy, rotated.get(x.id)!.pos[2]] as Vec3 } : x)) },
        sel.kind === 'parts' ? ids : [],
      ),
    );
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
