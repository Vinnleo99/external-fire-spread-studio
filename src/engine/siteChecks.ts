/**
 * Site model checks added in version 2.1: overlapping openings, small unprotected areas (Approved Document B,
 * Volume 2, Diagram 13.5) and walls on or within 1 metre of a relevant boundary (paragraph 13.8).
 */
import { OPENING_TYPES, openingArea, openingOverlaps } from "./model";
import { Point2, SiteOpening, SiteProject, Wall, allWalls } from "./site";

type V3 = [number, number, number];

// ------------------------------------------------------------------------------------------------ overlaps
export interface OverlapInfo { wallId: string; a: string; b: string; area: number }

export function siteOverlaps(p: SiteProject): OverlapInfo[] {
  const byWall = new Map<string, SiteOpening[]>();
  for (const o of p.openings) { const l = byWall.get(o.wallId) ?? []; l.push(o); byWall.set(o.wallId, l); }
  const out: OverlapInfo[] = [];
  for (const [wallId, list] of byWall) for (const x of openingOverlaps(list)) out.push({ wallId, a: x.a.id, b: x.b.id, area: x.area });
  return out;
}

// ------------------------------------------------------------------------------------------------ geometry helpers
function corners(o: SiteOpening, w: Wall): V3[] {
  const x0 = Math.max(0, o.xMin), x1 = Math.min(w.length, o.xMax);
  const z0 = w.base + Math.max(0, o.zMin), z1 = Math.min(w.top, w.base + o.zMax);
  const at = (x: number, z: number): V3 => [w.start[0] + w.tangent[0] * x, w.start[1] + w.tangent[1] * x, z];
  return [at(x0, z0), at(x1, z0), at(x1, z1), at(x0, z1)];
}
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

function segSeg(p1: V3, q1: V3, p2: V3, q2: V3): number {
  const d1 = sub(q1, p1), d2 = sub(q2, p2), r = sub(p1, p2);
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  let s = 0, t = 0;
  if (a < 1e-15 && e < 1e-15) return Math.sqrt(dot(r, r));
  if (a < 1e-15) t = clamp01(f / e);
  else {
    const c = dot(d1, r);
    if (e < 1e-15) s = clamp01(-c / a);
    else {
      const b = dot(d1, d2), den = a * e - b * b;
      s = den > 1e-15 ? clamp01((b * f - c * e) / den) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp01(-c / a); } else if (t > 1) { t = 1; s = clamp01((b - c) / a); }
    }
  }
  const c1: V3 = [p1[0] + d1[0] * s, p1[1] + d1[1] * s, p1[2] + d1[2] * s];
  const c2: V3 = [p2[0] + d2[0] * t, p2[1] + d2[1] * t, p2[2] + d2[2] * t];
  const d = sub(c1, c2);
  return Math.sqrt(dot(d, d));
}

/** Distance from a point to a rectangle given by four corners in order (only the interior projection case). */
function pointRect(pt: V3, c: V3[]): number {
  const u = sub(c[1], c[0]), v = sub(c[3], c[0]), r = sub(pt, c[0]);
  const lu = dot(u, u), lv = dot(v, v);
  const s = lu > 0 ? dot(r, u) / lu : 0, t = lv > 0 ? dot(r, v) / lv : 0;
  if (s < 0 || s > 1 || t < 0 || t > 1) return Infinity;
  const proj: V3 = [c[0][0] + u[0] * s + v[0] * t, c[0][1] + u[1] * s + v[1] * t, c[0][2] + u[2] * s + v[2] * t];
  const d = sub(pt, proj);
  return Math.sqrt(dot(d, d));
}

/** Exact gap between two rectangles in space (zero when they touch or overlap). */
export function rectGap(a: V3[], b: V3[]): number {
  let best = Infinity;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) best = Math.min(best, segSeg(a[i], a[(i + 1) % 4], b[j], b[(j + 1) % 4]));
  for (const pt of a) best = Math.min(best, pointRect(pt, b));
  for (const pt of b) best = Math.min(best, pointRect(pt, a));
  // Coplanar overlap: an edge crossing gives zero above; one rectangle inside the other gives zero via pointRect.
  return best < 1e-9 ? 0 : best;
}

// ------------------------------------------------------------------------------------------------ small unprotected areas
/** Diagram 13.5 values read from Approved Document B, Volume 2 (2019 edition as amended). */
export const SMALL_AREA = { aMax: 1.0, aSide: 1.0, aSpacing: 4.0, bMax: 0.1, bSpacing: 1.5 };

export interface SmallAreaEntry { openingId: string; unit: number; kind: "a" | "b" | "large"; ignored: boolean; reason: string; nearest: number }

/**
 * Classifies every opening against Diagram 13.5 within its own compartment (same rules as facade.py):
 * only fully unprotected openings can be small; openings on one wall whose bounding box fits 1 × 1 metre with a total
 * of not more than 1 square metre form a type "a" unit; a single opening of not more than 0.1 square metres is type
 * "b". A type "a" unit may be ignored when at least 4 metres from every other type "a" unit and every large unprotected
 * area (engineering judgement for large areas) and 1.5 metres from type "b" areas; a type "b" area when at least 1.5
 * metres from every other unprotected area. Distances are measured in three dimensions, across walls of the same
 * compartment. The protected stair shaft shown in the diagram is not modelled.
 */
export function smallAreaReport(p: SiteProject): Map<string, SmallAreaEntry> {
  const walls = new Map(allWalls(p).map((w) => [w.id, w]));
  const result = new Map<string, SmallAreaEntry>();
  const byComp = new Map<string, { o: SiteOpening; w: Wall; c: V3[] }[]>();
  for (const o of p.openings) {
    const w = walls.get(o.wallId);
    if (!w || o.xMax <= o.xMin || o.zMax <= o.zMin) continue;
    const l = byComp.get(w.compartmentId) ?? []; l.push({ o, w, c: corners(o, w) }); byComp.set(w.compartmentId, l);
  }
  let unitBase = 0;
  for (const list of byComp.values()) {
    const units: number[][] = [];
    const order = list.map((_, i) => i).sort((i, j) => openingArea(list[i].o) - openingArea(list[j].o));
    for (const i of order) {
      const o = list[i].o;
      if (OPENING_TYPES[o.type].fraction < 1 || openingArea(o) > SMALL_AREA.aMax + 1e-9) continue;
      let placed = false;
      for (const u of units) {
        if (list[u[0]].w.id !== list[i].w.id) continue;
        const m = [...u.map((k) => list[k].o), o];
        const wd = Math.max(...m.map((q) => q.xMax)) - Math.min(...m.map((q) => q.xMin));
        const ht = Math.max(...m.map((q) => q.zMax)) - Math.min(...m.map((q) => q.zMin));
        if (wd <= SMALL_AREA.aSide + 1e-9 && ht <= SMALL_AREA.aSide + 1e-9 && m.reduce((s, q) => s + openingArea(q), 0) <= SMALL_AREA.aMax + 1e-9) {
          u.push(i); placed = true; break;
        }
      }
      if (!placed) units.push([i]);
    }
    const kinds: ("a" | "b" | "large")[] = units.map((u) => {
      const m = u.map((k) => list[k].o);
      const wd = Math.max(...m.map((q) => q.xMax)) - Math.min(...m.map((q) => q.xMin));
      const ht = Math.max(...m.map((q) => q.zMax)) - Math.min(...m.map((q) => q.zMin));
      if (u.length === 1 && openingArea(m[0]) <= SMALL_AREA.bMax + 1e-9) return "b";
      return wd <= SMALL_AREA.aSide + 1e-9 && ht <= SMALL_AREA.aSide + 1e-9 ? "a" : "large";
    });
    const inUnit = new Set(units.flat());
    list.forEach((_, i) => { if (!inUnit.has(i)) { units.push([i]); kinds.push("large"); } });
    const gap = (u: number, v: number) => {
      let g = Infinity;
      for (const a of units[u]) for (const b of units[v]) g = Math.min(g, rectGap(list[a].c, list[b].c));
      return g;
    };
    units.forEach((u, n) => {
      const kind = kinds[n];
      let ignored = false, reason = "Large unprotected area: counted.", nearest = Infinity;
      if (kind !== "large") {
        let worst: { short: number; g: number; need: number } | null = null;
        units.forEach((_, m) => {
          if (m === n) return;
          const need = kind === "b" || kinds[m] === "b" ? SMALL_AREA.bSpacing : SMALL_AREA.aSpacing;
          const g = gap(n, m);
          nearest = Math.min(nearest, g);
          if (g < need - 1e-9 && (!worst || g - need < worst.short)) worst = { short: g - need, g, need };
        });
        const w = worst as { short: number; g: number; need: number } | null;
        if (!w) { ignored = true; reason = `Type "${kind}" small unprotected area meeting the Diagram 13.5 spacing: may be ignored.`; }
        else reason = `Type "${kind}" size, but ${w.g.toFixed(2)} metres from another unprotected area in the same compartment (at least ${w.need.toFixed(1)} metres needed): counted.`;
      } else if (list[u[0]].o.type === "combustibleCladding") reason = "Combustible cladding is not a small unprotected area: counted.";
      for (const k of u) result.set(list[k].o.id, { openingId: list[k].o.id, unit: unitBase + n, kind, ignored, reason, nearest });
    });
    unitBase += units.length;
  }
  return result;
}

// ------------------------------------------------------------------------------------------------ walls within 1 metre
export interface NearWall { wallId: string; distance: number }

function segDist2(a: Point2, b: Point2, c: Point2, d: Point2): { dist: number; pa: Point2; pb: Point2 } {
  const A: V3 = [a[0], a[1], 0], B: V3 = [b[0], b[1], 0], C: V3 = [c[0], c[1], 0], D: V3 = [d[0], d[1], 0];
  const dist = segSeg(A, B, C, D);
  // closest point on the wall to the boundary segment, found by sampling the ends and the projection of the ends
  const proj = (p: Point2, s0: Point2, s1: Point2): Point2 => {
    const ex = s1[0] - s0[0], ey = s1[1] - s0[1], l2 = ex * ex + ey * ey || 1;
    const t = clamp01(((p[0] - s0[0]) * ex + (p[1] - s0[1]) * ey) / l2);
    return [s0[0] + ex * t, s0[1] + ey * t];
  };
  const cands: [Point2, Point2][] = [[a, proj(a, c, d)], [b, proj(b, c, d)], [proj(c, a, b), c], [proj(d, a, b), d]];
  let best = cands[0], bd = Infinity;
  for (const q of cands) { const dd = Math.hypot(q[0][0] - q[1][0], q[0][1] - q[1][1]); if (dd < bd) { bd = dd; best = q; } }
  return { dist, pa: best[0], pb: best[1] };
}

/**
 * Walls on, or within 1 metre of, a boundary line and facing it (paragraph 13.8). A wall faces the boundary when the
 * nearest boundary point lies on its outer side (or on the wall line itself).
 */
export function wallsWithinOneMetre(walls: Wall[], points: Point2[], limit = 1): NearWall[] {
  const out: NearWall[] = [];
  for (const w of walls) {
    let best = Infinity, facing = false;
    for (let k = 0; k + 1 < points.length; k++) {
      const r = segDist2(w.start, w.end, points[k], points[k + 1]);
      if (r.dist < best) {
        best = r.dist;
        const side = (r.pb[0] - r.pa[0]) * w.normal[0] + (r.pb[1] - r.pa[1]) * w.normal[1];
        facing = r.dist < 1e-6 || side > 0.5 * r.dist;
      }
    }
    if (best < limit - 1e-9 && facing) out.push({ wallId: w.id, distance: best });
  }
  return out;
}

/** Paragraph 13.8 text, quoted from Approved Document B, Volume 2 (2019 edition as amended). */
export const PARAGRAPH_13_8 = "Unprotected areas should meet the conditions in Diagram 13.5 and the rest of the wall should be fire resisting from both sides. External surface materials facing the boundary should be class B-s3, d2 or better.";
