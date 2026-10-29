/**
 * Site assessment: radiation from each fire compartment's openings to receiving points generated along the
 * actual boundary lines, using the general configuration factor (general.ts).
 *
 * Receiver construction for a boundary station B with unit normal n pointing into the site (towards the building)
 * and a receiving height z:
 *   1. A horizontal ray from B along n at height z finds the first wall of the building at that height
 *      (point Q, boundary distance δ = |Q − B|).
 *   2. Mirror-image approach (default): the receiver is the mirror image of Q in the local boundary line, R = Q − 2δn,
 *      that is, a point on the face of an identical building at the same distance on the far side.
 *      Receiver-on-boundary approach: the receiver is B itself.
 *   3. With sprinklers and the "halve the boundary distance" option, δ is replaced by 2δ where δ ≥ 1 metre.
 * At convex corners of a boundary, a fan of local boundary directions is added so that no part of the building is
 * missed between the perpendiculars of adjacent segments.
 */
import { PARAGRAPH_13_8, smallAreaReport, siteOverlaps, wallsWithinOneMetre } from "./siteChecks";
import { ACCEPTANCE_LIMIT, OPENING_TYPES, sourceIntensity } from "./model";
import { Vec3, polygonFactor, vectorFactor } from "./general";
import {
  Block, BoundaryLine, Emitter, Point2, SiteProject, SiteSettings, Wall, blockTop, buildEmitters, siteKey, wallsOfBlock,
} from "./site";

// ---------------------------------------------------------------------------------------------- prepared geometry
export interface PreparedBlock { block: Block; walls: Wall[]; poly: Point2[]; base: number; top: number }
export interface PreparedCompartment { id: string; name: string; intensity: number; index: number }

export interface Geometry {
  blocks: PreparedBlock[];
  walls: Map<string, Wall>;
  emitters: Emitter[];
  emitterCompartment: Int32Array;
  compartments: PreparedCompartment[];
  zMin: number;
  zMax: number;
  settings: SiteSettings;
  cells: Map<Emitter, Cell[]>;
}

interface Cell { verts: Float64Array; tests: Vec3[] }

export function prepareGeometry(p: SiteProject, emitters?: Emitter[]): Geometry {
  const blocks = p.blocks.filter((b) => b.footprint.length >= 3 && b.storeys > 0 && b.storeyHeight > 0)
    .map((b) => ({ block: b, walls: wallsOfBlock(b), poly: b.footprint, base: b.base, top: blockTop(b) }));
  const walls = new Map(blocks.flatMap((b) => b.walls).map((w) => [w.id, w]));
  const compartments = p.compartments.map((c, index) => ({ id: c.id, name: c.name, intensity: sourceIntensity(c.fireLoad), index }));
  const cIndex = new Map(compartments.map((c) => [c.id, c.index]));
  const em = (emitters ?? buildEmitters(p)).filter((e) => cIndex.has(e.compartmentId));
  return {
    blocks, walls, emitters: em,
    emitterCompartment: Int32Array.from(em.map((e) => cIndex.get(e.compartmentId)!)),
    compartments,
    zMin: blocks.length ? Math.min(...blocks.map((b) => b.base)) : 0,
    zMax: blocks.length ? Math.max(...blocks.map((b) => b.top)) : 0,
    settings: p.settings, cells: new Map(),
  };
}

// ---------------------------------------------------------------------------------------------- ray casting
interface Hit { t: number; wall: Wall }

export function castRay(g: Geometry, bx: number, by: number, dx: number, dy: number, z: number): Hit | null {
  let best: Hit | null = null;
  for (const b of g.blocks) {
    if (z < b.base - 1e-9 || z > b.top + 1e-9) continue;
    for (const w of b.walls) {
      if (w.normal[0] * dx + w.normal[1] * dy >= -1e-12) continue; // only walls facing the ray
      const ex = w.end[0] - w.start[0], ey = w.end[1] - w.start[1];
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-14) continue;
      const wx = w.start[0] - bx, wy = w.start[1] - by;
      const t = (wx * ey - wy * ex) / den;
      const u = (wx * dy - wy * dx) / den;
      if (t > 1e-9 && u >= -1e-9 && u <= 1 + 1e-9 && (!best || t < best.t)) best = { t, wall: w };
    }
  }
  return best;
}

function pointInPolygon(x: number, y: number, poly: Point2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function segmentsCross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const d1x = bx - ax, d1y = by - ay, d2x = dx - cx, d2y = dy - cy;
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-14) return false;
  const t = ((cx - ax) * d2y - (cy - ay) * d2x) / den;
  const u = ((cx - ax) * d1y - (cy - ay) * d1x) / den;
  return t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9;
}

/** True if the straight line from p0 to p1 passes through the solid of any block. */
export function lineBlocked(g: Geometry, p0: Vec3, p1: Vec3): boolean {
  const dz = p1[2] - p0[2];
  for (const b of g.blocks) {
    let ta = 0, tb = 1;
    if (Math.abs(dz) < 1e-12) {
      if (p0[2] <= b.base + 1e-9 || p0[2] >= b.top - 1e-9) continue;
    } else {
      let t0 = (b.base - p0[2]) / dz, t1 = (b.top - p0[2]) / dz;
      if (t0 > t1) [t0, t1] = [t1, t0];
      ta = Math.max(0, t0); tb = Math.min(1, t1);
      if (tb - ta < 1e-9) continue;
    }
    const ax = p0[0] + (p1[0] - p0[0]) * ta, ay = p0[1] + (p1[1] - p0[1]) * ta;
    const bx = p0[0] + (p1[0] - p0[0]) * tb, by = p0[1] + (p1[1] - p0[1]) * tb;
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    if (pointInPolygon(mx, my, b.poly)) return true;
    for (let i = 0; i < b.poly.length; i++) {
      const c = b.poly[i], d = b.poly[(i + 1) % b.poly.length];
      if (segmentsCross(ax, ay, bx, by, c[0], c[1], d[0], d[1])) return true;
    }
  }
  return false;
}

function cellsOf(g: Geometry, e: Emitter): Cell[] {
  let cells = g.cells.get(e);
  if (cells) return cells;
  const nu = Math.min(8, Math.max(1, Math.ceil(e.width / 1.0)));
  const nv = Math.min(8, Math.max(1, Math.ceil(e.height / 1.0)));
  cells = [];
  const ox = e.verts[0], oy = e.verts[1], oz = e.verts[2];
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const s0 = (e.width * i) / nu, s1 = (e.width * (i + 1)) / nu, z0 = (e.height * j) / nv, z1 = (e.height * (j + 1)) / nv;
    const p = (s: number, z: number) => [ox + e.u[0] * s, oy + e.u[1] * s, oz + z];
    const verts = new Float64Array([...p(s0, z0), ...p(s1, z0), ...p(s1, z1), ...p(s0, z1)]);
    const c = p((s0 + s1) / 2, (z0 + z1) / 2);
    // Visibility is tested from the wall face (the set-back reveal is not modelled), 10 millimetres proud of it.
    const out = e.setback + 0.01;
    // A cell counts as visible when any of five points (centre and four corners inset by a quarter) is visible.
    const off = (q: number[]): Vec3 => [q[0] + e.normal[0] * out, q[1] + e.normal[1] * out, q[2]];
    const si = (a: number, b: number) => a + (b - a) * 0.25, so = (a: number, b: number) => a + (b - a) * 0.75;
    const tests = [c, p(si(s0, s1), si(z0, z1)), p(so(s0, s1), si(z0, z1)), p(so(s0, s1), so(z0, z1)), p(si(s0, s1), so(z0, z1))].map(off);
    cells.push({ verts, tests });
  }
  g.cells.set(e, cells);
  return cells;
}

/** Visible parts of an emitter from a receiving point: the whole emitter or the visible sub-cells. */
function visibleParts(g: Geometry, e: Emitter, r: Vec3): Float64Array[] {
  if (g.settings.shielding !== "approximate") return [e.verts];
  const cells = cellsOf(g, e);
  const visible = cells.filter((c) => c.tests.some((t) => !lineBlocked(g, r, t)));
  if (visible.length === cells.length) return [e.verts];
  return visible.map((c) => c.verts);
}

// ---------------------------------------------------------------------------------------------- boundary geometry
interface Piece {
  kind: "segment" | "fan";
  u0: number;
  len: number;
  chainage0: number;
  a: Point2;
  dir: Point2;
  inward: Point2;
  /** Fan only: start angle of the inward normal and signed sweep, radians. */
  angle0?: number;
  sweep?: number;
}

export interface BoundaryGeometry { line: BoundaryLine; points: Point2[]; sides: number[]; pieces: Piece[]; totalU: number; length: number }

export interface Station { x: number; y: number; nx: number; ny: number; chainage: number; u: number; fan: boolean }

const FAN_STEP = (5 * Math.PI) / 180;

/** Side of each segment on which the building lies: +1 left of the direction of travel, −1 right. */
export function buildingSides(g: Geometry, points: Point2[]): number[] {
  const sides: number[] = [];
  for (let k = 0; k + 1 < points.length; k++) {
    const a = points[k], b = points[k + 1];
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    let best = Infinity, side = 1;
    for (const bl of g.blocks) for (let i = 0; i < bl.poly.length; i++) {
      const c = bl.poly[i], d = bl.poly[(i + 1) % bl.poly.length];
      const ex = d[0] - c[0], ey = d[1] - c[1];
      const l2 = ex * ex + ey * ey || 1;
      const t = Math.max(0, Math.min(1, ((mx - c[0]) * ex + (my - c[1]) * ey) / l2));
      const px = c[0] + t * ex, py = c[1] + t * ey;
      const dist = Math.hypot(px - mx, py - my);
      if (dist < best) {
        best = dist;
        const cr = (b[0] - a[0]) * (py - my) - (b[1] - a[1]) * (px - mx);
        side = cr >= 0 ? 1 : -1;
      }
    }
    sides.push(side);
  }
  return sides;
}

export function boundaryGeometry(line: BoundaryLine, points: Point2[], sides: number[]): BoundaryGeometry {
  const pieces: Piece[] = [];
  let u = 0, chainage = 0;
  const segs = [];
  for (let k = 0; k + 1 < points.length; k++) {
    const a = points[k], b = points[k + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const dir: Point2 = len > 0 ? [(b[0] - a[0]) / len, (b[1] - a[1]) / len] : [1, 0];
    const s = sides[k] ?? 1;
    const inward: Point2 = [-dir[1] * s, dir[0] * s];
    segs.push({ a, b, len, dir, inward });
  }
  for (let k = 0; k < segs.length; k++) {
    const s = segs[k];
    if (s.len < 1e-9) continue;
    pieces.push({ kind: "segment", u0: u, len: s.len, chainage0: chainage, a: s.a, dir: s.dir, inward: s.inward });
    u += s.len; chainage += s.len;
    const nxt = segs[k + 1];
    if (!nxt || nxt.len < 1e-9) continue;
    const n0 = s.inward, n1 = nxt.inward;
    const sweep = Math.atan2(n0[0] * n1[1] - n0[1] * n1[0], n0[0] * n1[0] + n0[1] * n1[1]);
    if (Math.abs(sweep) < 1e-6) continue;
    // A gap between perpendiculars exists at a convex corner: the bisector leans past the end of the first segment
    // and before the start of the next.
    const bx = n0[0] + n1[0], by = n0[1] + n1[1];
    const convex = bx * s.dir[0] + by * s.dir[1] > 1e-12 && bx * nxt.dir[0] + by * nxt.dir[1] < -1e-12;
    if (!convex) continue;
    const len = Math.abs(sweep); // pseudo-length: one metre of parameter per radian
    pieces.push({ kind: "fan", u0: u, len, chainage0: chainage, a: s.b, dir: s.dir, inward: n0,
      angle0: Math.atan2(n0[1], n0[0]), sweep });
    u += len;
  }
  return { line, points, sides, pieces, totalU: u, length: chainage };
}

export function stationAt(bg: BoundaryGeometry, u: number): Station {
  const pieces = bg.pieces;
  let p = pieces[pieces.length - 1];
  for (const q of pieces) if (u <= q.u0 + q.len) { p = q; break; }
  const local = Math.max(0, Math.min(p.len, u - p.u0));
  if (p.kind === "segment") {
    return { x: p.a[0] + p.dir[0] * local, y: p.a[1] + p.dir[1] * local, nx: p.inward[0], ny: p.inward[1],
      chainage: p.chainage0 + local, u, fan: false };
  }
  const ang = p.angle0! + Math.sign(p.sweep!) * local;
  return { x: p.a[0], y: p.a[1], nx: Math.cos(ang), ny: Math.sin(ang), chainage: p.chainage0, u, fan: true };
}

export function sampleStations(bg: BoundaryGeometry, spacing: number): Station[] {
  const out: Station[] = [];
  bg.pieces.forEach((p, index) => {
    const n = p.kind === "segment" ? Math.max(1, Math.ceil(p.len / spacing - 1e-9)) : Math.max(1, Math.ceil(p.len / FAN_STEP));
    for (let i = index === 0 ? 0 : 1; i <= n; i++) out.push(stationAt(bg, p.u0 + (p.len * i) / n));
  });
  return out;
}

/** Offset every segment of a polyline away from the building by t (mitred corners). */
export function offsetPolyline(points: Point2[], sides: number[], t: number): Point2[] {
  if (t === 0) return points.map((q) => [q[0], q[1]] as Point2);
  const segs = [];
  for (let k = 0; k + 1 < points.length; k++) {
    const a = points[k], b = points[k + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const dir: Point2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const s = sides[k] ?? 1;
    const out: Point2 = [dir[1] * s, -dir[0] * s]; // away from the building
    segs.push({ a: [a[0] + out[0] * t, a[1] + out[1] * t] as Point2, b: [b[0] + out[0] * t, b[1] + out[1] * t] as Point2, dir });
  }
  const res: Point2[] = [segs[0].a];
  for (let k = 1; k < segs.length; k++) {
    const s0 = segs[k - 1], s1 = segs[k];
    const den = s0.dir[0] * s1.dir[1] - s0.dir[1] * s1.dir[0];
    if (Math.abs(den) < 1e-9) { res.push([(s0.b[0] + s1.a[0]) / 2, (s0.b[1] + s1.a[1]) / 2]); continue; }
    const wx = s1.a[0] - s0.a[0], wy = s1.a[1] - s0.a[1];
    const tt = (wx * s1.dir[1] - wy * s1.dir[0]) / den;
    res.push([s0.a[0] + s0.dir[0] * tt, s0.a[1] + s0.dir[1] * tt]);
  }
  res.push(segs[segs.length - 1].b);
  return res;
}

// ---------------------------------------------------------------------------------------------- receivers
export interface Receiver { p: Vec3; n: Vec3; delta: number; wallId: string | null; onBoundary: Vec3 }

export function receiverAt(g: Geometry, st: Station, z: number): Receiver | null {
  const s = g.settings;
  const hit = castRay(g, st.x, st.y, st.nx, st.ny, z);
  const halving = s.sprinklered && s.sprinklerOption === "halveDistance";
  const b: Vec3 = [st.x, st.y, z];
  let p: Vec3, delta = NaN;
  if (s.approach === "mirror") {
    if (!hit) return null;
    delta = hit.t;
    const de = halving && delta >= 1 ? 2 * delta : delta;
    const qx = st.x + st.nx * delta, qy = st.y + st.ny * delta;
    p = [qx - st.nx * 2 * de, qy - st.ny * 2 * de, z];
  } else {
    if (hit) {
      delta = hit.t;
      const de = halving && delta >= 1 ? 2 * delta : delta;
      const qx = st.x + st.nx * delta, qy = st.y + st.ny * delta;
      p = [qx - st.nx * de, qy - st.ny * de, z];
    } else p = b;
  }
  let n: Vec3 = [st.nx, st.ny, 0];
  if (s.orientation === "mirrorFace" && hit) {
    const w = hit.wall.normal;
    const d = w[0] * st.nx + w[1] * st.ny;
    n = [w[0] - 2 * d * st.nx, w[1] - 2 * d * st.ny, 0];
  }
  return { p, n, delta, wallId: hit?.wall.id ?? null, onBoundary: b };
}

// ---------------------------------------------------------------------------------------------- intensities
const VEC: Vec3 = [0, 0, 0];

/**
 * Received intensity at a receiver for each compartment burning on its own. `perEmitter`, when given, receives
 * each emitter's contribution (kilowatts per square metre). `normals` receives the orientation used per compartment.
 */
export function receiverIntensities(g: Geometry, r: Receiver, out: Float64Array, perEmitter?: Float64Array, normals?: Vec3[]) {
  out.fill(0);
  const ems = g.emitters, ec = g.emitterCompartment;
  if (g.settings.orientation !== "mostOnerous") {
    for (let i = 0; i < ems.length; i++) {
      const e = ems[i];
      let f = 0;
      for (const part of visibleParts(g, e, r.p)) f += polygonFactor(part, 4, e.normal, r.p, r.n);
      const v = e.weight * f;
      out[ec[i]] += v;
      if (perEmitter) perEmitter[i] = v;
    }
    if (normals) for (let c = 0; c < out.length; c++) normals[c] = r.n;
    return;
  }
  // Most onerous orientation, found per compartment: start from the direction of the summed vector factor
  // and iterate with the hemisphere clipping applied until the received intensity stops increasing.
  for (let c = 0; c < out.length; c++) {
    const list: number[] = [];
    for (let i = 0; i < ems.length; i++) if (ec[i] === c) list.push(i);
    if (!list.length) continue;
    const partsOf = list.map((i) => visibleParts(g, ems[i], r.p));
    const total = (n: Vec3 | null): Vec3 => {
      const a: Vec3 = [0, 0, 0];
      list.forEach((i, k) => {
        for (const part of partsOf[k]) {
          vectorFactor(part, 4, ems[i].normal, r.p, n, VEC);
          a[0] += ems[i].weight * VEC[0]; a[1] += ems[i].weight * VEC[1]; a[2] += ems[i].weight * VEC[2];
        }
      });
      return a;
    };
    const value = (n: Vec3) => {
      let s = 0;
      list.forEach((i, k) => { for (const part of partsOf[k]) s += ems[i].weight * polygonFactor(part, 4, ems[i].normal, r.p, n); });
      return s;
    };
    let a = total(null);
    let len = Math.hypot(a[0], a[1], a[2]);
    if (len < 1e-300) continue;
    let best: Vec3 = [a[0] / len, a[1] / len, a[2] / len];
    let bestValue = value(best);
    for (let it = 0; it < 6; it++) {
      a = total(best);
      len = Math.hypot(a[0], a[1], a[2]);
      if (len < 1e-300) break;
      const n: Vec3 = [a[0] / len, a[1] / len, a[2] / len];
      const v = value(n);
      if (v <= bestValue * (1 + 1e-12)) break;
      best = n; bestValue = v;
    }
    out[c] = bestValue;
    if (normals) normals[c] = best;
    if (perEmitter) list.forEach((i, k) => {
      let f = 0;
      for (const part of partsOf[k]) f += polygonFactor(part, 4, ems[i].normal, r.p, best);
      perEmitter[i] = ems[i].weight * f;
    });
  }
}

// ---------------------------------------------------------------------------------------------- peak search
interface PeakLocation { value: number; u: number; z: number }

function nelderMead(f: (u: number, z: number) => number, u0: number, z0: number, du: number, dz: number,
                    uMax: number, zMin: number, zMax: number): PeakLocation {
  const clampU = (u: number) => Math.min(uMax, Math.max(0, u));
  const clampZ = (z: number) => Math.min(zMax, Math.max(zMin, z));
  type P = { u: number; z: number; v: number };
  const mk = (u: number, z: number): P => { const cu = clampU(u), cz = clampZ(z); return { u: cu, z: cz, v: -f(cu, cz) }; };
  let s: P[] = [mk(u0, z0), mk(u0 + du, z0), mk(u0, z0 + dz)];
  for (let it = 0; it < 200; it++) {
    s.sort((a, b) => a.v - b.v);
    const size = Math.max(Math.abs(s[1].u - s[0].u), Math.abs(s[2].u - s[0].u), Math.abs(s[1].z - s[0].z), Math.abs(s[2].z - s[0].z));
    if (size < 1e-7 && Math.abs(s[2].v - s[0].v) <= 1e-13 * Math.max(1, Math.abs(s[0].v))) break;
    const cu = (s[0].u + s[1].u) / 2, cz = (s[0].z + s[1].z) / 2;
    const r = mk(cu + (cu - s[2].u), cz + (cz - s[2].z));
    if (r.v < s[0].v) {
      const e = mk(cu + 2 * (cu - s[2].u), cz + 2 * (cz - s[2].z));
      s[2] = e.v < r.v ? e : r;
    } else if (r.v < s[1].v) {
      s[2] = r;
    } else {
      const c = r.v < s[2].v ? mk(cu + 0.5 * (r.u - cu), cz + 0.5 * (r.z - cz)) : mk(cu + 0.5 * (s[2].u - cu), cz + 0.5 * (s[2].z - cz));
      if (c.v < Math.min(r.v, s[2].v)) s[2] = c;
      else s = [s[0], mk((s[0].u + s[1].u) / 2, (s[0].z + s[1].z) / 2), mk((s[0].u + s[2].u) / 2, (s[0].z + s[2].z) / 2)];
    }
  }
  s.sort((a, b) => a.v - b.v);
  return { value: -s[0].v, u: s[0].u, z: s[0].z };
}

interface GridResult {
  stations: Station[];
  heights: number[];
  /** Per compartment, intensity at each station × height (NaN where there is no receiver). */
  values: Float32Array[];
  /** Per emitter, peak of its wall's contribution, collected per wall below. */
  wallPeaks: Map<string, number>[];
  delta: Float32Array;
  best: { c: number; value: number; u: number; z: number }[];
}

function heightsFor(g: Geometry, spacing: number): number[] {
  const n = Math.max(1, Math.ceil((g.zMax - g.zMin) / spacing - 1e-9));
  return Array.from({ length: n + 1 }, (_, k) => g.zMin + ((g.zMax - g.zMin) * k) / n);
}

function evaluateGrid(g: Geometry, bg: BoundaryGeometry, spacing: number, hSpacing: number, collectWalls: boolean): GridResult {
  const stations = sampleStations(bg, spacing);
  const heights = heightsFor(g, hSpacing);
  const nc = g.compartments.length, nz = heights.length;
  const values = Array.from({ length: nc }, () => new Float32Array(stations.length * nz).fill(NaN));
  const delta = new Float32Array(stations.length).fill(NaN);
  const out = new Float64Array(nc);
  const perEmitter = collectWalls ? new Float64Array(g.emitters.length) : undefined;
  const wallPeaks = Array.from({ length: nc }, () => new Map<string, number>());
  const candidates: { c: number; value: number; u: number; z: number }[][] = Array.from({ length: nc }, () => []);
  const wallSum = new Map<string, number>();
  stations.forEach((st, si) => {
    heights.forEach((z, k) => {
      const r = receiverAt(g, st, z);
      if (!r) return;
      if (Number.isFinite(r.delta) && (Number.isNaN(delta[si]) || r.delta < delta[si])) delta[si] = r.delta;
      receiverIntensities(g, r, out, perEmitter);
      for (let c = 0; c < nc; c++) {
        values[c][si * nz + k] = out[c];
        const list = candidates[c];
        list.push({ c, value: out[c], u: st.u, z });
        if (list.length > 64) { list.sort((a, b) => b.value - a.value); list.length = 16; }
      }
      if (perEmitter) {
        wallSum.clear();
        g.emitters.forEach((e, i) => wallSum.set(`${g.emitterCompartment[i]}|${e.wallId}`, (wallSum.get(`${g.emitterCompartment[i]}|${e.wallId}`) ?? 0) + perEmitter[i]));
        for (const [key, v] of wallSum) {
          const [c, w] = key.split("|");
          const m = wallPeaks[+c];
          if (v > (m.get(w) ?? 0)) m.set(w, v);
        }
      }
    });
  });
  // Keep up to three well-separated candidates per compartment for local refinement.
  const best: GridResult["best"] = [];
  candidates.forEach((list) => {
    list.sort((a, b) => b.value - a.value);
    const kept: typeof list = [];
    for (const cand of list) {
      if (cand.value <= 0) break;
      if (kept.every((k) => Math.abs(k.u - cand.u) > 2 * spacing || Math.abs(k.z - cand.z) > 2 * hSpacing)) kept.push(cand);
      if (kept.length >= 3) break;
    }
    best.push(...kept);
  });
  return { stations, heights, values, wallPeaks, delta, best };
}

function refinePeaks(g: Geometry, bg: BoundaryGeometry, grid: GridResult, spacing: number, hSpacing: number): (PeakLocation | null)[] {
  const nc = g.compartments.length;
  const out = new Float64Array(nc);
  const res: (PeakLocation | null)[] = Array(nc).fill(null);
  for (const cand of grid.best) {
    const f = (u: number, z: number) => {
      const r = receiverAt(g, stationAt(bg, u), z);
      if (!r) return 0;
      receiverIntensities(g, r, out);
      return out[cand.c];
    };
    const loc = nelderMead(f, cand.u, cand.z, spacing / 2, hSpacing / 2, bg.totalU, g.zMin, g.zMax);
    const better = loc.value >= cand.value ? loc : { value: cand.value, u: cand.u, z: cand.z };
    if (!res[cand.c] || better.value > res[cand.c]!.value) res[cand.c] = better;
  }
  return res;
}

// ---------------------------------------------------------------------------------------------- results
export interface FaceResult {
  wallId: string;
  label: string;
  faceArea: number;
  unprotectedArea: number;
  peakAlone: number;
  scalingAlone: number;
  permittedUniform: number;
  /** Set when the wall is on or within 1 metre of a relevant boundary: assessed under paragraph 13.8, not by calculation. */
  withinOneMetre?: { boundaryId: string; distance: number };
}

export interface WithinOneMetre {
  boundaryId: string; wallId: string; label: string; distance: number;
  /** True when every opening on the wall is a small unprotected area that Diagram 13.5 allows and there is no cladding. */
  diagram135: boolean; issues: string[]; text: string;
}

export interface KinkCheck { chainage: number; x: number; y: number; turn: number; mirrorPeak: number; boundaryPeak: number; passes: boolean }

export interface CompartmentResult {
  id: string;
  name: string;
  sourceIntensity: number;
  unprotectedArea: number;
  peak: number;
  location: { boundaryId: string; chainage: number; x: number; y: number; z: number; receiver: Vec3 } | null;
  scaling: number;
  permittedArea: number;
  passes: boolean;
  faces: FaceResult[];
}

export interface Contribution { openingId: string; wallId: string; label: string; type: string; intensity: number; share: number }

export interface BoundaryResult {
  id: string;
  name: string;
  kind: "relevant" | "notional";
  stations: { x: number; y: number; nx: number; ny: number; chainage: number; fan: boolean }[];
  heights: number[];
  /** Worst compartment intensity per station × height; −1 where no receiver exists. */
  grid: number[];
  stationPeak: number[];
  stationPeakByCompartment: Record<string, number[]>;
  stationDelta: number[];
  peak: number;
  passes: boolean;
  requiredOffset: { offset: number; status: "found" | "belowRange" | "notSolved" | "noOpenings" };
  withinOneMetre: WithinOneMetre[];
  kinks: KinkCheck[];
}

export interface SiteResults {
  key: string;
  limit: number;
  approach: SiteSettings["approach"];
  orientation: SiteSettings["orientation"];
  boundaries: BoundaryResult[];
  compartments: CompartmentResult[];
  worst: {
    peak: number; compartmentId: string | null; boundaryId: string | null; chainage: number; z: number;
    receiver: Vec3 | null; boundaryPoint: Vec3 | null; normal: Vec3 | null; contributions: Contribution[];
  };
  passes: boolean;
  withinOneMetre: WithinOneMetre[];
  overlaps: { wallId: string; a: string; b: string; area: number }[];
  smallAreas: { openingId: string; kind: string; ignored: boolean; reason: string }[];
  /** Shielding check status: "unverified" unless the approximation has been validated (see review/check_shielding.py). */
  shieldingStatus: string;
  warnings: string[];
  milliseconds: number;
}

export function acceptanceLimit(s: SiteSettings): number {
  return s.sprinklered && s.sprinklerOption === "doubleArea" ? 2 * ACCEPTANCE_LIMIT : ACCEPTANCE_LIMIT;
}

function wallLabel(p: SiteProject, w: Wall): string {
  const b = p.blocks.find((x) => x.id === w.blockId);
  const bearing = (Math.atan2(w.normal[0], w.normal[1]) * 180) / Math.PI;
  const names = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
  const facing = names[Math.round(((bearing + 360) % 360) / 45) % 8];
  return `${b?.name ?? "Block"}, wall ${w.edge + 1} (faces ${facing})`;
}

export function wallDescription(p: SiteProject, w: Wall): string { return wallLabel(p, w); }

/** Peak over all compartments for a boundary moved outwards by t; coarse grid, optionally refined. */
export function peakAtOffset(g: Geometry, line: BoundaryLine, sides: number[], t: number, refine: boolean): number {
  const bg = boundaryGeometry(line, offsetPolyline(line.points, sides, t), sides);
  if (!bg.pieces.length) return 0;
  const sp = Math.max(1, g.settings.stationSpacing), hs = Math.max(1, g.settings.heightSpacing);
  const grid = evaluateGrid(g, bg, sp, hs, false);
  let peak = 0;
  for (const v of grid.values) for (const x of v) if (x > peak) peak = x;
  if (refine) for (const loc of refinePeaks(g, bg, grid, sp, hs)) if (loc && loc.value > peak) peak = loc.value;
  return peak;
}

function brent(f: (x: number) => number, a: number, b: number, fa: number, fb: number, tol = 1e-7): number {
  let c = a, fc = fa, d = b - a, e = d;
  for (let it = 0; it < 100; it++) {
    if (fb * fc > 0) { c = a; fc = fa; d = b - a; e = d; }
    if (Math.abs(fc) < Math.abs(fb)) { a = b; b = c; c = a; fa = fb; fb = fc; fc = fa; }
    const tol1 = 2e-16 * Math.abs(b) + tol / 2, xm = (c - b) / 2;
    if (Math.abs(xm) <= tol1 || fb === 0) return b;
    if (Math.abs(e) >= tol1 && Math.abs(fa) > Math.abs(fb)) {
      const s = fb / fa;
      let p: number, q: number;
      if (a === c) { p = 2 * xm * s; q = 1 - s; } else {
        const qq = fa / fc, r = fb / fc;
        p = s * (2 * xm * qq * (qq - r) - (b - a) * (r - 1)); q = (qq - 1) * (r - 1) * (s - 1);
      }
      if (p > 0) q = -q; else p = -p;
      if (2 * p < Math.min(3 * xm * q - Math.abs(tol1 * q), Math.abs(e * q))) { e = d; d = p / q; } else { d = xm; e = d; }
    } else { d = xm; e = d; }
    a = b; fa = fb;
    b += Math.abs(d) > tol1 ? d : (xm > 0 ? tol1 : -tol1);
    fb = f(b);
  }
  return b;
}

/**
 * Outermost crossing of f(t) = 0 on [lo, hi] where f > 0 means "fails". A uniform scan with a step of about
 * 0.25 metres (24 to 160 intervals) is followed by Brent's method in the last failing interval, then a check after
 * solving: f is evaluated at the interval midpoints above the root and at t* + h and t* + 2h; any failure found
 * restarts the search above it (up to 20 times). Exported for testing.
 */
export function outermostCrossing(f0: (t: number) => number, lo: number, hi: number, coarse0: (t: number) => number = f0, margin = Infinity):
  { t: number; status: "found" | "belowRange" } {
  // Values are cached, and in the check after solving the refined function is evaluated only where the cheap grid value is
  // within `margin` of the limit (local refinement raises the grid peak by much less than the margin used by solveOffset).
  const memo = (g: (t: number) => number) => { const m = new Map<number, number>(); return (t: number) => { let v = m.get(t); if (v === undefined) { v = g(t); m.set(t, v); } return v; }; };
  const f = memo(f0), coarse = coarse0 === f0 ? f : memo(coarse0);
  const fCheck = (t: number) => (coarse(t) > -margin ? f(t) : coarse(t));
  const n = Math.max(24, Math.min(160, Math.ceil((hi - lo) / 0.25)));
  const h = (hi - lo) / n;
  const ts = Array.from({ length: n + 1 }, (_, i) => lo + h * i);
  const gs = ts.map((t) => coarse(t));
  let idx = -1;
  for (let i = n; i >= 0; i--) if (gs[i] > 0) { idx = i; break; }
  if (idx < 0) {
    if (f(lo) <= 0) {
      // check after solving: midpoints of the whole scan
      let bad = -1;
      for (let i = n - 1; i >= 0; i--) if (fCheck(ts[i] + h / 2) > 0) { bad = i; break; }
      if (bad < 0) return { t: lo, status: "belowRange" };
      idx = bad;
    } else idx = 0;
  }
  let a = ts[idx], b = Math.min(hi, a + h);
  let fa = f(a), fb = f(b);
  let guard = 0;
  while (fb > 0 && guard++ < 40) { a = b; fa = fb; b = b + h; fb = f(b); }
  if (fa <= 0) {
    guard = 0;
    while (fa <= 0 && a > lo && guard++ < 40) { b = a; fb = fa; a = Math.max(lo, a - h); fa = f(a); }
    if (fa <= 0) return { t: lo, status: "belowRange" };
  }
  let t = brent(f, a, b, fa, fb, 1e-7);
  for (let restart = 0; restart < 20; restart++) {
    const probes = [t + h, t + 2 * h];
    for (let i = 0; i < n; i++) { const m = ts[i] + h / 2; if (m > t + 1e-6) probes.push(m); }
    let bad = -Infinity;
    for (const q of probes) if (q > bad && fCheck(q) > 0) bad = q;
    if (bad === -Infinity) break;
    a = bad; fa = f(a); b = a + h / 2; fb = f(b);
    guard = 0;
    while (fb > 0 && guard++ < 40) { a = b; fa = fb; b += h / 2; fb = f(b); }
    t = brent(f, a, b, fa, fb, 1e-7);
  }
  return { t, status: "found" };
}

/** Uniform outward offset of a boundary at which the peak just reaches the limit (outermost crossing). */
function solveOffset(g: Geometry, line: BoundaryLine, sides: number[], minDelta: number, limit: number): BoundaryResult["requiredOffset"] {
  if (!g.emitters.length) return { offset: 0, status: "noOpenings" };
  if (!Number.isFinite(minDelta)) return { offset: 0, status: "notSolved" };
  const tLow = -0.98 * minDelta;
  let totalWeight = 0;
  for (let c = 0; c < g.compartments.length; c++) {
    let u = 0;
    g.emitters.forEach((e, i) => { if (g.emitterCompartment[i] === c) u += e.weight * e.area; });
    totalWeight = Math.max(totalWeight, u);
  }
  let tUp = Math.max(1, Math.sqrt(totalWeight / (Math.PI * limit)));
  for (let k = 0; k < 8 && peakAtOffset(g, line, sides, tUp, false) >= limit; k++) tUp *= 2;
  const r = outermostCrossing((t) => peakAtOffset(g, line, sides, t, true) - limit, tLow, tUp,
    (t) => peakAtOffset(g, line, sides, t, false) - limit, 0.25 * limit);
  return { offset: r.t, status: r.status };
}

/** Sub-polyline of points within [c0, c1] of chainage. */
function window(points: Point2[], c0: number, c1: number): Point2[] {
  const out: Point2[] = [];
  let ch = 0;
  for (let k = 0; k + 1 < points.length; k++) {
    const a = points[k], b = points[k + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const lo = Math.max(c0, ch), hi = Math.min(c1, ch + L);
    if (hi > lo && L > 0) {
      const at = (c: number): Point2 => [a[0] + ((b[0] - a[0]) * (c - ch)) / L, a[1] + ((b[1] - a[1]) * (c - ch)) / L];
      if (!out.length) out.push(at(lo));
      out.push(at(hi));
    }
    ch += L;
  }
  return out;
}

/**
 * At each kink of a boundary (interior vertex turning more than 1 degree) the mirror-image receiver is ambiguous,
 * so the receiver-on-boundary peak is computed over a window of chainage around the vertex for comparison. This is a
 * judgement point and does not change the verdict.
 */
function kinkChecks(g: Geometry, line: BoundaryLine, sides: number[], stations: Station[], stationPeak: number[], delta: Float32Array, limit: number): KinkCheck[] {
  if (g.settings.approach !== "mirror" || line.points.length < 3 || !g.emitters.length) return [];
  const out: KinkCheck[] = [];
  const gb: Geometry = { ...g, settings: { ...g.settings, approach: "boundary" }, cells: g.cells };
  let ch = 0;
  for (let k = 1; k + 1 < line.points.length; k++) {
    const a = line.points[k - 1], v = line.points[k], b = line.points[k + 1];
    ch += Math.hypot(v[0] - a[0], v[1] - a[1]);
    const t1 = Math.atan2(v[1] - a[1], v[0] - a[0]), t2 = Math.atan2(b[1] - v[1], b[0] - v[0]);
    let turn = ((t2 - t1) * 180) / Math.PI;
    turn = ((turn + 540) % 360) - 180;
    if (Math.abs(turn) <= 1) continue;
    let near = Infinity;
    stations.forEach((st, i) => { if (Math.hypot(st.x - v[0], st.y - v[1]) < 0.75 && Number.isFinite(delta[i])) near = Math.min(near, delta[i]); });
    if (!Number.isFinite(near)) delta.forEach((d) => { if (Number.isFinite(d)) near = Math.min(near, d); });
    const R = Math.max(2, 2 * (Number.isFinite(near) ? near : 1));
    let mirrorPeak = 0;
    stations.forEach((st, i) => { if (Math.abs(st.chainage - ch) <= R) mirrorPeak = Math.max(mirrorPeak, stationPeak[i]); });
    const pts = window(line.points, ch - R, ch + R);
    let boundaryPeak = 0;
    if (pts.length >= 2) {
      const sub = { ...line, points: pts };
      const subSides = buildingSides(gb, pts);
      const bg = boundaryGeometry(sub, pts, subSides);
      if (bg.pieces.length) {
        const grid = evaluateGrid(gb, bg, g.settings.stationSpacing, g.settings.heightSpacing, false);
        for (const vals of grid.values) for (const x of vals) if (x > boundaryPeak) boundaryPeak = x;
        for (const loc of refinePeaks(gb, bg, grid, g.settings.stationSpacing, g.settings.heightSpacing)) if (loc && loc.value > boundaryPeak) boundaryPeak = loc.value;
      }
    }
    out.push({ chainage: ch, x: v[0], y: v[1], turn, mirrorPeak, boundaryPeak, passes: boundaryPeak <= limit + 1e-9 });
  }
  return out;
}

export interface AssessOptions { solveOffsets?: boolean }

export function assessSite(p: SiteProject, options: AssessOptions = {}, emitters?: Emitter[]): SiteResults {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const g = prepareGeometry(p, emitters);
  const s = p.settings;
  const limit = acceptanceLimit(s);
  const nc = g.compartments.length;
  const warnings: string[] = [];
  const boundaries: BoundaryResult[] = [];
  const compPeak: (PeakLocation & { boundary: BoundaryGeometry; geometry: Geometry } | null)[] = Array(nc).fill(null);
  const wallPeaks = Array.from({ length: nc }, () => new Map<string, number>());

  const allWithin: WithinOneMetre[] = [];
  const sa = smallAreaReport(p);
  const wallList = [...g.walls.values()];
  for (const line0 of p.boundaries) {
    if (line0.points.length < 2) continue;
    const line = line0;
    // Walls on or within 1 metre of a relevant boundary are assessed under paragraph 13.8, not by calculation.
    const near = line.kind === "relevant" ? wallsWithinOneMetre(wallList, line.points) : [];
    const nearIds = new Set(near.map((n) => n.wallId));
    const withinOneMetre: WithinOneMetre[] = near.map((n) => {
      const w = g.walls.get(n.wallId)!;
      const issues: string[] = [];
      for (const o of p.openings.filter((x) => x.wallId === n.wallId)) {
        const e = sa.get(o.id);
        if (o.type === "combustibleCladding") issues.push("Combustible cladding faces the boundary.");
        else if (!e || !e.ignored) issues.push(`Opening ${o.id}: ${e?.reason ?? "not a small unprotected area."}`);
      }
      return { boundaryId: line.id, wallId: n.wallId, label: wallLabel(p, w), distance: n.distance, diagram135: issues.length === 0, issues, text: PARAGRAPH_13_8 };
    });
    allWithin.push(...withinOneMetre);
    const gl = nearIds.size ? (() => {
      const em = g.emitters.filter((e) => !nearIds.has(e.wallId));
      const cIdx = new Map(g.compartments.map((c) => [c.id, c.index]));
      return { ...g, emitters: em, emitterCompartment: Int32Array.from(em.map((e) => cIdx.get(e.compartmentId)!)), cells: g.cells };
    })() : g;
    const sides = buildingSides(gl, line.points);
    const bg = boundaryGeometry(line, line.points, sides);
    if (!bg.pieces.length) continue;
    const grid = evaluateGrid(gl, bg, s.stationSpacing, s.heightSpacing, true);
    grid.wallPeaks.forEach((m, c) => m.forEach((v, w) => { if (v > (wallPeaks[c].get(w) ?? 0)) wallPeaks[c].set(w, v); }));
    const refined = refinePeaks(gl, bg, grid, s.stationSpacing, s.heightSpacing);
    refined.forEach((loc, c) => { if (loc && (!compPeak[c] || loc.value > compPeak[c]!.value)) compPeak[c] = { ...loc, boundary: bg, geometry: gl }; });
    const nz = grid.heights.length;
    const worstGrid: number[] = new Array(grid.stations.length * nz).fill(-1);
    const stationPeak: number[] = new Array(grid.stations.length).fill(0);
    const byComp: Record<string, number[]> = {};
    g.compartments.forEach((c) => { byComp[c.id] = new Array(grid.stations.length).fill(0); });
    for (let si = 0; si < grid.stations.length; si++) for (let k = 0; k < nz; k++) {
      let worst = -1;
      for (let c = 0; c < nc; c++) {
        const v = grid.values[c][si * nz + k];
        if (Number.isNaN(v)) continue;
        if (v > worst) worst = v;
        if (v > byComp[g.compartments[c].id][si]) byComp[g.compartments[c].id][si] = v;
      }
      worstGrid[si * nz + k] = worst;
      if (worst > stationPeak[si]) stationPeak[si] = worst;
    }
    let peak = Math.max(0, ...stationPeak);
    refined.forEach((loc) => { if (loc && loc.value > peak) peak = loc.value; });
    let minDelta = Infinity;
    grid.delta.forEach((d) => { if (Number.isFinite(d) && d < minDelta) minDelta = d; });
    for (const w of withinOneMetre) warnings.push(`${line.name}: ${w.label} is within 1 metre of the boundary and is assessed under paragraph 13.8 and Diagram 13.5, not by calculation.`);
    if (grid.stations.every((_, si) => Number.isNaN(grid.delta[si]))) warnings.push(`${line.name}: no part of the building is opposite this boundary, so it receives nothing under the mirror-image approach.`);
    const requiredOffset = options.solveOffsets === false ? { offset: 0, status: "notSolved" as const } : solveOffset(gl, line, sides, minDelta, limit);
    boundaries.push({
      id: line.id, name: line.name, kind: line.kind,
      stations: grid.stations.map((st) => ({ x: st.x, y: st.y, nx: st.nx, ny: st.ny, chainage: st.chainage, fan: st.fan })),
      heights: grid.heights, grid: worstGrid.map((v) => (v < 0 ? -1 : Math.round(v * 1000) / 1000)),
      stationPeak, stationPeakByCompartment: byComp,
      stationDelta: Array.from(grid.delta, (d) => (Number.isNaN(d) ? -1 : d)),
      peak, passes: peak <= limit + 1e-9, requiredOffset, withinOneMetre,
      kinks: options.solveOffsets === false ? [] : kinkChecks(gl, line, sides, grid.stations, stationPeak, grid.delta, limit),
    });
  }

  // Compartment summaries.
  const compartments: CompartmentResult[] = g.compartments.map((c) => {
    const loc = compPeak[c.index];
    let receiver: Receiver | null = null, st: Station | null = null;
    if (loc) { st = stationAt(loc.boundary, loc.u); receiver = receiverAt(loc.geometry, st, loc.z); }
    const unprotected = g.emitters.reduce((a, e, i) => a + (g.emitterCompartment[i] === c.index ? e.area * (e.weight / c.intensity) : 0), 0);
    const peak = loc?.value ?? 0;
    const scaling = peak > 0 ? limit / peak : Infinity;
    const wallIds = [...new Set(g.emitters.filter((_, i) => g.emitterCompartment[i] === c.index).map((e) => e.wallId))];
    const faces: FaceResult[] = wallIds.map((wid) => {
      const w = g.walls.get(wid)!;
      const ua = g.emitters.reduce((a, e, i) => a + (e.wallId === wid && g.emitterCompartment[i] === c.index ? e.area * (e.weight / c.intensity) : 0), 0);
      const pa = wallPeaks[c.index].get(wid) ?? 0;
      return { wallId: wid, label: wallLabel(p, w), faceArea: w.length * (w.top - w.base), unprotectedArea: ua,
        peakAlone: pa, scalingAlone: pa > 0 ? limit / pa : Infinity, permittedUniform: ua * scaling,
        ...(allWithin.find((x) => x.wallId === wid) ? { withinOneMetre: { boundaryId: allWithin.find((x) => x.wallId === wid)!.boundaryId, distance: allWithin.find((x) => x.wallId === wid)!.distance } } : {}) };
    });
    return {
      id: c.id, name: c.name, sourceIntensity: c.intensity, unprotectedArea: unprotected, peak,
      location: loc && st && receiver ? { boundaryId: loc.boundary.line.id, chainage: st.chainage, x: st.x, y: st.y, z: loc.z, receiver: receiver.p } : null,
      scaling, permittedArea: unprotected * scaling, passes: peak <= limit + 1e-9, faces,
    };
  });

  // Governing case and the openings that contribute to it.
  let worstIndex = -1;
  compPeak.forEach((loc, c) => { if (loc && (worstIndex < 0 || loc.value > compPeak[worstIndex]!.value)) worstIndex = c; });
  const worst: SiteResults["worst"] = { peak: 0, compartmentId: null, boundaryId: null, chainage: 0, z: 0, receiver: null, boundaryPoint: null, normal: null, contributions: [] };
  if (worstIndex >= 0) {
    const loc = compPeak[worstIndex]!;
    const st = stationAt(loc.boundary, loc.u);
    const gw = loc.geometry;
    const r = receiverAt(gw, st, loc.z);
    if (r) {
      const out = new Float64Array(nc), per = new Float64Array(gw.emitters.length);
      const normals: Vec3[] = [];
      receiverIntensities(gw, r, out, per, normals);
      const total = out[worstIndex] || 1;
      const contributions: Contribution[] = gw.emitters.map((e, i) => ({ e, i, v: per[i] }))
        .filter((x) => gw.emitterCompartment[x.i] === worstIndex && x.v > 0)
        .sort((a, b) => b.v - a.v)
        .map((x) => ({ openingId: x.e.openingId, wallId: x.e.wallId, label: wallLabel(p, g.walls.get(x.e.wallId)!),
          type: OPENING_TYPES[x.e.type as keyof typeof OPENING_TYPES]?.label ?? x.e.type, intensity: x.v, share: x.v / total }));
      Object.assign(worst, { peak: loc.value, compartmentId: g.compartments[worstIndex].id, boundaryId: loc.boundary.line.id,
        chainage: st.chainage, z: loc.z, receiver: r.p, boundaryPoint: r.onBoundary, normal: normals[worstIndex] ?? r.n, contributions });
    }
  }

  // Model checks.
  for (const b of p.blocks) {
    if (b.footprint.length < 3) warnings.push(`${b.name}: the footprint needs at least three points.`);
  }
  const walls = new Map([...g.walls]);
  for (const o of p.openings) {
    const w = walls.get(o.wallId);
    if (!w) { warnings.push(`An opening refers to a wall that no longer exists and has been ignored.`); continue; }
    if (o.xMin < -1e-9 || o.xMax > w.length + 1e-9 || o.zMin < -1e-9 || o.zMax > w.top - w.base + 1e-9)
      warnings.push(`${wallLabel(p, w)}: an opening extends beyond the wall and has been trimmed to it.`);
  }
  if (!p.boundaries.some((b) => b.points.length >= 2)) warnings.push("Draw at least one boundary line to assess.");

  const overlaps = siteOverlaps(p);
  for (const o of overlaps) warnings.push(`${wallLabel(p, g.walls.get(o.wallId) ?? wallList[0])}: openings ${o.a} and ${o.b} overlap by ${o.area.toFixed(2)} square metres; the overlap is counted once.`);
  const smallAreas = [...sa.values()].filter((x) => x.kind !== "large").map((x) => ({ openingId: x.openingId, kind: x.kind, ignored: !!s.smallAreas && x.ignored, reason: x.reason }));
  const passes = boundaries.every((b) => b.passes) && compartments.every((c) => c.passes) && allWithin.every((w) => w.diagram135);
  const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
  return { key: siteKey(p), limit, approach: s.approach, orientation: s.orientation, boundaries, compartments, worst, passes,
    withinOneMetre: allWithin, overlaps, smallAreas, shieldingStatus: SHIELDING_STATUS,
    warnings: [...new Set(warnings)], milliseconds: t1 - t0 };
}

/** Set from the Monte Carlo comparison in review/check_shielding.py (see docs/method.md). */
export const SHIELDING_STATUS = "unverified, may be unconservative";
