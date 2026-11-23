export type Vec3 = [number, number, number];

/** rotation as a unit quaternion [x, y, z, w] */
export type Quat = [number, number, number, number];

export type WoodId =
  | 'pine'
  | 'oak'
  | 'beech'
  | 'walnut'
  | 'maple'
  | 'cherry'
  | 'teak'
  | 'meranti'
  | 'plywood'
  | 'blockboard'
  | 'mdf'
  | 'melamine'
  | 'osb';

export type Shape = 'box' | 'rod';

/** structure = carries load and is checked; front = doors, drawer fronts, handles (not checked) */
export type Role = 'structure' | 'front';

export type LoadType = 'udl' | 'point';

export type PartKind = 'board' | 'sheet' | 'beam' | 'rod';

/** Which template material slot a generated part belongs to */
export type MatRole = 'wood' | 'frontWood' | 'backWood' | 'topWood' | 'rodWood';

export interface Part {
  id: string;
  name: string;
  groupId: string | null;
  /** min corner, mm (Y up, floor at y = 0) */
  pos: Vec3;
  /** extents along X, Y, Z in mm */
  size: Vec3;
  wood: WoodId;
  shape: Shape;
  role: Role;
  anchored: boolean;
  /** live load in kg; null = automatic (design load × area) */
  load: number | null;
  loadType: LoadType;
  seed: number;
  kind: PartKind;
  matRole?: MatRole;
  /** rotation about the part's centre (centre = pos + size / 2); absent = not rotated */
  q?: Quat;
  /**
   * angled end cuts in degrees [start end, far end], turning each end face about the board's
   * thickness. Equal values give parallel ends; 0 = square. The length is long point to long point.
   */
  cut?: [number, number];
}

export type ParamValue = number | boolean | string;

export interface Group {
  id: string;
  name: string;
  template: TemplateId | null;
  params: Record<string, ParamValue>;
  /** min corner of the template's bounding box */
  origin: Vec3;
  /** quarter turns about Y */
  rot: number;
  /** free rotation of the whole piece about its centre, applied after `rot` */
  q?: Quat;
  /** true when a part was edited by hand after generation */
  custom: boolean;
}

export type TemplateId =
  | 'bookcase'
  | 'xshelf'
  | 'wardrobe'
  | 'kitchenBase'
  | 'kitchenWall'
  | 'table'
  | 'bench'
  | 'drawer'
  | 'box';

export interface Project {
  version: 1;
  name: string;
  parts: Part[];
  groups: Group[];
  /** kg per m² used for automatic shelf loads */
  designLoad: number;
  /** ₪ per m³ overrides */
  prices: Partial<Record<WoodId, number>>;
}

export type Selection =
  | { kind: 'none' }
  | { kind: 'group'; id: string }
  | { kind: 'parts'; ids: string[] };

export type ViewMode = 'persp' | 'front' | 'side' | 'top';
export type Tool = 'move' | 'rotate' | 'resize';
