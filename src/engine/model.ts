/**
 * Project model: façades, openings and the published table lookup.
 */

export const FULLY_UNPROTECTED = 1;
/** Combustible cladding more than 1 millimetre thick counts as half its area. */
export const COMBUSTIBLE_CLADDING = 0.5;
export const ACCEPTANCE_LIMIT = 12.6;

export type FireLoadCategory = "residential" | "office" | "assembly" | "shop" | "industrial" | "storage";

export const FIRE_LOADS: Record<FireLoadCategory, number> = {
  residential: 84, office: 84, assembly: 84, shop: 168, industrial: 168, storage: 168,
};

export const FIRE_LOAD_LABELS: Record<FireLoadCategory, string> = {
  residential: "Residential (84 kilowatts per square metre)",
  office: "Office (84 kilowatts per square metre)",
  assembly: "Assembly and recreation (84 kilowatts per square metre)",
  shop: "Shop and commercial (168 kilowatts per square metre)",
  industrial: "Industrial (168 kilowatts per square metre)",
  storage: "Storage and other non-residential (168 kilowatts per square metre)",
};

export type OpeningType = "window" | "door" | "nonFireResistingWall" | "combustibleCladding";

export const OPENING_TYPES: Record<OpeningType, { label: string; fraction: number }> = {
  window: { label: "Window", fraction: 1 },
  door: { label: "Door", fraction: 1 },
  nonFireResistingWall: { label: "Non-fire-resisting wall", fraction: 1 },
  combustibleCladding: { label: "Combustible cladding", fraction: COMBUSTIBLE_CLADDING },
};

export interface Opening {
  id: string;
  type: OpeningType;
  xMin: number;
  xMax: number;
  zMin: number;
  zMax: number;
  /** Distance the opening sits behind the plane of reference, metres. */
  setback: number;
}

export type SprinklerOption = "halveDistance" | "doubleArea";

export interface Facade {
  id: string;
  name: string;
  width: number;
  height: number;
  compartment: string;
  fireLoad: FireLoadCategory;
  openings: Opening[];
  /** Distance from the plane of reference to the relevant boundary, metres. */
  boundaryDistance?: number;
  sprinklered?: boolean;
  sprinklerOption?: SprinklerOption;
}

export interface Project {
  format: "external-fire-spread-studio-project";
  version: 1;
  name: string;
  engineer: string;
  activeFacadeId: string;
  facades: Facade[];
}

export function sourceIntensity(fireLoad: FireLoadCategory): number {
  return FIRE_LOADS[fireLoad];
}

export function openingFraction(opening: Opening): number {
  return OPENING_TYPES[opening.type].fraction;
}

export function openingArea(opening: Opening): number {
  return Math.max(0, opening.xMax - opening.xMin) * Math.max(0, opening.zMax - opening.zMin);
}

/** A rectangle with its unprotected fraction, after overlapping openings have been merged. */
export interface MergedRect { id: string; type: OpeningType; xMin: number; xMax: number; zMin: number; zMax: number; fraction: number; setback: number }

/** Pairs of overlapping openings with the overlap area (square metres). */
export function openingOverlaps<T extends Opening>(openings: T[]): { a: T; b: T; area: number }[] {
  const out: { a: T; b: T; area: number }[] = [];
  for (let i = 0; i < openings.length; i++) for (let j = i + 1; j < openings.length; j++) {
    const a = openings[i], b = openings[j];
    const w = Math.min(a.xMax, b.xMax) - Math.max(a.xMin, b.xMin), h = Math.min(a.zMax, b.zMax) - Math.max(a.zMin, b.zMin);
    if (w > 1e-9 && h > 1e-9) out.push({ a, b, area: w * h });
  }
  return out;
}

/**
 * Openings with overlaps removed so that no area counts twice (the union of the areas). Where openings overlap, the
 * plane is cut on every opening edge into cells; each covered cell goes to the covering opening with the highest
 * unprotected fraction (ties to the smallest setback, the more onerous choice) and neighbouring cells in a row with
 * the same owner are joined again. Without overlaps the openings are returned unchanged. Same rule as facade.py.
 */
export function mergeOpenings(openings: Opening[]): MergedRect[] {
  const plain = openings.filter((o) => o.xMax > o.xMin && o.zMax > o.zMin);
  const asRect = (o: Opening, x0 = o.xMin, x1 = o.xMax, z0 = o.zMin, z1 = o.zMax): MergedRect =>
    ({ id: o.id, type: o.type, xMin: x0, xMax: x1, zMin: z0, zMax: z1, fraction: openingFraction(o), setback: o.setback ?? 0 });
  if (!openingOverlaps(plain).length) return plain.map((o) => asRect(o));
  const xs = [...new Set(plain.flatMap((o) => [o.xMin, o.xMax]))].sort((a, b) => a - b);
  const zs = [...new Set(plain.flatMap((o) => [o.zMin, o.zMax]))].sort((a, b) => a - b);
  const out: MergedRect[] = [];
  for (let k = 0; k + 1 < zs.length; k++) {
    const zc = (zs[k] + zs[k + 1]) / 2;
    let runOwner = -1, runStart = 0;
    for (let m = 0; m < xs.length; m++) {
      let owner = -1;
      if (m + 1 < xs.length) {
        const xc = (xs[m] + xs[m + 1]) / 2;
        plain.forEach((o, i) => {
          if (!(o.xMin < xc && xc < o.xMax && o.zMin < zc && zc < o.zMax)) return;
          if (owner < 0) { owner = i; return; }
          const q = plain[owner], fo = openingFraction(o), fq = openingFraction(q);
          if (fo > fq || (fo === fq && (o.setback ?? 0) < (q.setback ?? 0))) owner = i;
        });
      }
      if (owner !== runOwner) {
        if (runOwner >= 0) out.push(asRect(plain[runOwner], xs[runStart], xs[m], zs[k], zs[k + 1]));
        runOwner = owner; runStart = m;
      }
    }
  }
  return out;
}

export interface EnclosingRectangle {
  xMin: number; xMax: number; zMin: number; zMax: number;
  width: number; height: number;
  unprotectedArea: number;
  percentage: number;
}

export function enclosingRectangle(facade: Facade): EnclosingRectangle | null {
  if (facade.openings.length === 0) return null;
  const xMin = Math.min(...facade.openings.map((o) => o.xMin));
  const xMax = Math.max(...facade.openings.map((o) => o.xMax));
  const zMin = Math.min(...facade.openings.map((o) => o.zMin));
  const zMax = Math.max(...facade.openings.map((o) => o.zMax));
  const unprotectedArea = mergeOpenings(facade.openings).reduce((sum, r) => sum + (r.xMax - r.xMin) * (r.zMax - r.zMin) * r.fraction, 0);
  const area = (xMax - xMin) * (zMax - zMin);
  return { xMin, xMax, zMin, zMax, width: xMax - xMin, height: zMax - zMin, unprotectedArea,
    percentage: area > 0 ? (100 * unprotectedArea) / area : 0 };
}

export interface TableEntry { h: number; w: number | "no limit"; p: number; i: number; d: number }

const PERCENTAGES = [20, 30, 40, 50, 60, 70, 80, 90, 100];

/** BR 187 (1991) Table 1 lookup: round up to the next listed rectangle; interpolate percentages. */
export function tableLookup(table: TableEntry[], width: number, height: number, percentage: number,
                            load: number, interpolate = true): number | null {
  const heights = [...new Set(table.filter((v) => v.i === load).map((v) => v.h))].sort((a, b) => a - b);
  const h = heights.find((x) => x >= height - 1e-9);
  if (h === undefined) return null;
  const widths = [...new Set(table.filter((v) => v.i === load && v.h === h).map((v) => v.w === "no limit" ? Infinity : v.w))].sort((a, b) => a - b);
  const w = widths.find((x) => x >= width - 1e-9);
  if (w === undefined) return null;
  const column = new Map<number, number>();
  for (const v of table) {
    const vw = v.w === "no limit" ? Infinity : v.w;
    if (v.i === load && v.h === h && vw === w) column.set(v.p, v.d);
  }
  const pct = Math.max(percentage, 20);
  if (pct > 100) throw new Error("percentage above 100");
  const upper = PERCENTAGES.find((p) => p >= pct - 1e-9)!;
  if (!interpolate || upper === 20 || Math.abs(upper - pct) < 1e-9) return column.get(upper)!;
  const lower = upper - 10;
  const t = (pct - lower) / 10;
  return column.get(lower)! + t * (column.get(upper)! - column.get(lower)!);
}

/** Round UP to a multiple of `step` (required distances: rounding never reduces them). */
export function ceilTo(value: number, step = 0.01): number {
  if (!Number.isFinite(value)) return value;
  return (Math.ceil(value / step - 1e-9) * step);
}

/** Round DOWN to a multiple of `step` (permitted areas and percentages: rounding never increases them). */
export function floorTo(value: number, step = 0.01): number {
  if (!Number.isFinite(value)) return value;
  return (Math.floor(value / step + 1e-9) * step);
}

/** Text for a required distance, rounded up. */
export function fmtUp(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "not found";
  return ceilTo(value, 10 ** -digits).toFixed(digits);
}

/** Text for a permitted area or percentage, rounded down. */
export function fmtDown(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "no limit";
  return floorTo(value, 10 ** -digits).toFixed(digits);
}
