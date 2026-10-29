/** Site model: storey blocks with plan footprints, walls generated from them, openings on walls, boundary lines. */
import { FireLoadCategory, Opening, mergeOpenings, sourceIntensity } from "./model";
import { smallAreaReport } from "./siteChecks";
import { Vec3 } from "./general";

export type Point2 = [number, number];

export interface Compartment { id: string; name: string; fireLoad: FireLoadCategory }

export interface Block {
  id: string;
  name: string;
  /** Plan footprint polygon in metres (x east, y north). Either winding is accepted. */
  footprint: Point2[];
  /** Level of the bottom of the block above ground, metres. */
  base: number;
  storeys: number;
  /** Floor-to-floor height, metres. */
  storeyHeight: number;
  compartmentId: string;
}

/** An opening on a wall. x runs along the wall from left to right as seen from outside; z is above the block base. */
export interface SiteOpening extends Opening { wallId: string }

export interface BoundaryLine {
  id: string;
  name: string;
  kind: "relevant" | "notional";
  points: Point2[];
}

export type Approach = "mirror" | "boundary";
export type ReceiverOrientation = "mirrorFace" | "boundaryNormal" | "mostOnerous";

export interface SiteSettings {
  approach: Approach;
  orientation: ReceiverOrientation;
  stationSpacing: number;
  heightSpacing: number;
  shielding: "ignore" | "approximate";
  sprinklered: boolean;
  sprinklerOption: "halveDistance" | "doubleArea";
  snap: number;
  /** Ignore small unprotected areas meeting Diagram 13.5 (paragraph 13.11). Off by default: the allowance is optional. */
  smallAreas?: boolean;
}

export interface SiteProject {
  format: "external-fire-spread-studio-site";
  version: 2;
  name: string;
  engineer?: string;
  compartments: Compartment[];
  blocks: Block[];
  openings: SiteOpening[];
  boundaries: BoundaryLine[];
  settings: SiteSettings;
  activeBlockId?: string;
  activeWallId?: string;
  activeBoundaryId?: string;
}

export const DEFAULT_SETTINGS: SiteSettings = {
  approach: "mirror", orientation: "mirrorFace", stationSpacing: 0.5, heightSpacing: 0.5,
  shielding: "ignore", sprinklered: false, sprinklerOption: "halveDistance", snap: 0.5,
  smallAreas: false,
};

export interface Wall {
  id: string;
  blockId: string;
  edge: number;
  /** Left and right ends of the wall as seen from outside. */
  start: Point2;
  end: Point2;
  length: number;
  /** Unit vector from start to end. */
  tangent: Point2;
  /** Unit outward normal (horizontal). */
  normal: Point2;
  base: number;
  top: number;
  compartmentId: string;
}

export function blockTop(b: Block): number { return b.base + b.storeys * b.storeyHeight; }

export function signedArea(poly: Point2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % poly.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

export function wallId(blockId: string, edge: number): string { return `${blockId}:${edge}`; }

export function wallsOfBlock(b: Block): Wall[] {
  const n = b.footprint.length;
  if (n < 3) return [];
  const ccw = signedArea(b.footprint) > 0;
  const walls: Wall[] = [];
  for (let i = 0; i < n; i++) {
    const a = b.footprint[i], c = b.footprint[(i + 1) % n];
    const dx = c[0] - a[0], dy = c[1] - a[1];
    const length = Math.hypot(dx, dy);
    if (length < 1e-9) continue;
    // Seen from outside, x runs left to right: for an anticlockwise footprint that is from vertex i to i + 1.
    const start = ccw ? a : c, end = ccw ? c : a;
    const tangent: Point2 = [(end[0] - start[0]) / length, (end[1] - start[1]) / length];
    const normal: Point2 = [tangent[1], -tangent[0]];
    walls.push({ id: wallId(b.id, i), blockId: b.id, edge: i, start, end, length, tangent, normal,
      base: b.base, top: blockTop(b), compartmentId: b.compartmentId });
  }
  return walls;
}

export function allWalls(p: SiteProject): Wall[] { return p.blocks.flatMap(wallsOfBlock); }

export interface Emitter {
  openingId: string;
  wallId: string;
  blockId: string;
  compartmentId: string;
  type: string;
  /** Source intensity × unprotected fraction, kilowatts per square metre. */
  weight: number;
  area: number;
  verts: Float64Array;
  normal: Vec3;
  centre: Vec3;
  /** Width and height of the emitter and its in-plane unit vectors, for sub-division when shielding is modelled. */
  width: number;
  height: number;
  u: Vec3;
  /** Offset from the emitter plane forward to the wall face (the set-back), metres. */
  setback: number;
}

export function emitterFor(o: Opening, wall: Wall, weight: number, compartmentId: string): Emitter {
  const x0 = Math.max(0, o.xMin), x1 = Math.min(wall.length, o.xMax);
  const z0 = wall.base + Math.max(0, o.zMin), z1 = Math.min(wall.top, wall.base + o.zMax);
  const sb = o.setback ?? 0;
  const ox = wall.start[0] + wall.tangent[0] * x0 - wall.normal[0] * sb;
  const oy = wall.start[1] + wall.tangent[1] * x0 - wall.normal[1] * sb;
  const w = x1 - x0, h = z1 - z0;
  const tx = wall.tangent[0] * w, ty = wall.tangent[1] * w;
  const verts = new Float64Array([ox, oy, z0, ox + tx, oy + ty, z0, ox + tx, oy + ty, z1, ox, oy, z1]);
  return {
    openingId: o.id, wallId: wall.id, blockId: wall.blockId, compartmentId, type: o.type, weight,
    area: Math.max(0, w) * Math.max(0, h), verts, normal: [wall.normal[0], wall.normal[1], 0],
    centre: [ox + tx / 2, oy + ty / 2, (z0 + z1) / 2], width: w, height: h,
    u: [wall.tangent[0], wall.tangent[1], 0], setback: sb,
  };
}

/**
 * Emitters for every opening. Overlapping openings on a wall are merged first so that no area counts twice
 * (mergeOpenings); with `settings.smallAreas`, openings that Diagram 13.5 allows to be ignored are left out.
 */
export function buildEmitters(p: SiteProject): Emitter[] {
  const walls = new Map(allWalls(p).map((w) => [w.id, w]));
  const compartments = new Map(p.compartments.map((c) => [c.id, c]));
  const ignored = p.settings?.smallAreas ? smallAreaReport(p) : null;
  const byWall = new Map<string, SiteOpening[]>();
  for (const o of p.openings) {
    if (o.xMax - o.xMin <= 0 || o.zMax - o.zMin <= 0) continue;
    if (ignored?.get(o.id)?.ignored) continue;
    const l = byWall.get(o.wallId) ?? []; l.push(o); byWall.set(o.wallId, l);
  }
  const out: Emitter[] = [];
  for (const [wid, list] of byWall) {
    const wall = walls.get(wid);
    if (!wall) continue;
    const comp = compartments.get(wall.compartmentId);
    if (!comp) continue;
    for (const r of mergeOpenings(list)) {
      const o: Opening = { id: r.id, type: r.type, xMin: r.xMin, xMax: r.xMax, zMin: r.zMin, zMax: r.zMax, setback: r.setback };
      const e = emitterFor(o, wall, sourceIntensity(comp.fireLoad) * r.fraction, comp.id);
      if (e.area > 0) out.push(e);
    }
  }
  return out;
}

export function siteKey(p: SiteProject): string {
  return JSON.stringify([p.compartments, p.blocks, p.openings, p.boundaries, p.settings]);
}
