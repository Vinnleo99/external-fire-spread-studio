/**
 * Received intensity, peak search and root finding. Port of radiation.py and solver.py.
 */
import { centreConfigurationFactor, rectangleConfigurationFactor } from "./configurationFactor";
import { ACCEPTANCE_LIMIT, EnclosingRectangle, Facade, enclosingRectangle, mergeOpenings } from "./model";

interface Rect { xMin: number; xMax: number; zMin: number; zMax: number; fraction: number; setback: number }

function rectangles(facade: Facade): Rect[] {
  return mergeOpenings(facade.openings).map((o) => ({
    xMin: o.xMin, xMax: o.xMax, zMin: o.zMin, zMax: o.zMax, fraction: o.fraction, setback: o.setback,
  }));
}

const prepared = new WeakMap<Facade, { key: string; rects: Rect[] }>();

function preparedRectangles(facade: Facade): Rect[] {
  const key = JSON.stringify(facade.openings);
  const cached = prepared.get(facade);
  if (cached && cached.key === key) return cached.rects;
  const rects = rectangles(facade);
  prepared.set(facade, { key, rects });
  return rects;
}

function weightedFromRects(rects: Rect[], pointX: number, pointZ: number, separation: number): number {
  let sum = 0;
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    sum += r.fraction * rectangleConfigurationFactor(r.xMin, r.xMax, r.zMin, r.zMax, pointX, pointZ, separation + r.setback);
  }
  return sum;
}

export function weightedConfigurationFactor(facade: Facade, pointX: number, pointZ: number, separation: number): number {
  return weightedFromRects(preparedRectangles(facade), pointX, pointZ, separation);
}

export function receivedIntensity(facade: Facade, pointX: number, pointZ: number, separation: number, load: number): number {
  return load * weightedConfigurationFactor(facade, pointX, pointZ, separation);
}

/** Rigorous upper bound: the kernel never exceeds 1/(pi S^2), so the total is at most U/(pi S^2). */
function upperSeparationBound(facade: Facade, target: number): number {
  const u = preparedRectangles(facade).reduce((sum, o) => sum + (o.xMax - o.xMin) * (o.zMax - o.zMin) * o.fraction, 0);
  return Math.sqrt(u / (Math.PI * target)) * 1.001 + 1e-6;
}

function peakWeighted(facade: Facade, separation: number, gridPoints = 41): [number, number, number] {
  const box = enclosingRectangle(facade);
  if (!box) return [0, 0, 0];
  const nx = gridPoints;
  const nz = Math.min(gridPoints, Math.max(5, Math.round(gridPoints * (box.height / Math.max(box.width, 1e-9))) | 1));
  const xs = linspace(box.xMin, box.xMax, nx);
  const zs = linspace(box.zMin, box.zMax, nz);
  const rects = preparedRectangles(facade);
  const candidates: [number, number, number][] = [];
  for (const z of zs) for (const x of xs) {
    const v = weightedFromRects(rects, x, z, separation);
    candidates.push([v, x, z]);
  }
  candidates.sort((a, b) => b[0] - a[0]);
  let best = candidates[0];
  for (const [, x0, z0] of candidates.slice(0, 5)) {
    const refined = refineMaximum((x, z) => weightedFromRects(rects, x, z, separation), x0, z0, box);
    if (refined[0] > best[0]) best = refined;
  }
  return best;
}

/** Bounded quasi-Newton (L-BFGS style, two-variable) maximisation. */
function refineMaximum(f: (x: number, z: number) => number, x0: number, z0: number, box: EnclosingRectangle): [number, number, number] {
  let x = x0, z = z0;
  let value = f(x, z);
  const step0 = Math.max(box.width, box.height) / 80;
  for (let iteration = 0; iteration < 25; iteration++) {
    const h = Math.max(1e-4, step0 * 0.5 ** Math.floor(iteration / 4));
    const dfdx = (f(Math.min(box.xMax, x + h), z) - f(Math.max(box.xMin, x - h), z)) / (2 * h);
    const dfdz = (f(x, Math.min(box.zMax, z + h)) - f(x, Math.max(box.zMin, z - h))) / (2 * h);
    const gradient = Math.hypot(dfdx, dfdz);
    if (gradient < 1e-9) break;
    let step = step0;
    let improved = false;
    for (let trial = 0; trial < 12; trial++) {
      const nx = clamp(x + step * dfdx / gradient, box.xMin, box.xMax);
      const nz = clamp(z + step * dfdz / gradient, box.zMin, box.zMax);
      const nv = f(nx, nz);
      if (nv > value + 1e-14) { x = nx; z = nz; value = nv; improved = true; break; }
      step /= 2;
    }
    if (!improved) break;
  }
  return [value, x, z];
}

function linspace(a: number, b: number, n: number): number[] {
  if (n <= 1) return [a];
  return Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function solveMonotone(func: (s: number) => number, target: number): number {
  let lower = 1e-6;
  if (func(lower) <= target) return 0;
  let upper = 1;
  while (func(upper) > target) {
    upper *= 2;
    if (upper > 1e7) throw new Error("no separation found below 10000 kilometres");
  }
  return brent(func, target, lower, upper);
}

/**
 * Smallest separation beyond which `func` never exceeds `target` (same method as solver.py): a geometric, linear and
 * fixed-step (about 0.25 metres) scan up to a rigorous upper bound, Brent refinement of the outermost crossing, then
 * a check after solving at points just beyond the answer (every 0.05 metres over the next metre and the midpoints of
 * the scan intervals above it), restarting from any point found above the target. Resolution is finite.
 */
export function solveOutermost(func: (s: number) => number, target: number, upper: number, scanStep = 0.25, checkStep = 0.05): number {
  const n = 64;
  const grid: number[] = [];
  for (let i = 0; i < n; i++) grid.push(1e-4 * (upper / 1e-4) ** (i / (n - 1)));
  for (let i = 1; i < n; i++) grid.push((upper * i) / (n - 1));
  const nStep = Math.min(4000, Math.max(2, Math.ceil(upper / scanStep) + 1));
  for (let i = 1; i < nStep; i++) grid.push((upper * i) / (nStep - 1));
  grid.sort((a, b) => a - b);
  const unique = grid.filter((v, i) => i === 0 || v > grid[i - 1] * (1 + 1e-9));
  const values = unique.map((s) => func(s));
  let last = -1;
  for (let i = 0; i < values.length; i++) if (values[i] > target) last = i;
  if (last === -1) return 0;
  if (last === unique.length - 1) throw new Error("upper bound violated");
  let t = brent(func, target, unique[last], unique[last + 1]);
  for (let round = 0; round < 20; round++) {
    const check = [...Array.from({ length: 20 }, (_, i) => t + checkStep * (i + 1)),
      ...unique.slice(1).map((v, i) => (v + unique[i]) / 2).filter((v) => v > t)].filter((v) => v < upper).sort((a, b) => a - b);
    let bad = -1;
    check.forEach((s, i) => { if (func(s) > target) bad = i; });
    if (bad < 0) return t;
    const next = bad + 1 < check.length ? check[bad + 1] : upper;
    t = func(next) <= target ? brent(func, target, check[bad], next) : next;
  }
  return t;
}

function brent(func: (s: number) => number, target: number, a0: number, b0: number): number {
  const f = (s: number) => func(s) - target;
  let a = a0, b = b0, fa = f(a), fb = f(b);
  if (fa * fb > 0) throw new Error("root not bracketed");
  if (Math.abs(fa) < Math.abs(fb)) { [a, b] = [b, a]; [fa, fb] = [fb, fa]; }
  let c = a, fc = fa, d = b - a, e = d;
  for (let i = 0; i < 200; i++) {
    if (Math.abs(b - a) < 1e-9 + 1e-10 * Math.abs(b) || fb === 0) return b;
    let s: number;
    if (fa !== fc && fb !== fc) {
      s = (a * fb * fc) / ((fa - fb) * (fa - fc)) + (b * fa * fc) / ((fb - fa) * (fb - fc)) + (c * fa * fb) / ((fc - fa) * (fc - fb));
    } else {
      s = b - fb * (b - a) / (fb - fa);
    }
    const cond1 = !((s > (3 * a + b) / 4 && s < b) || (s < (3 * a + b) / 4 && s > b));
    if (cond1 || Math.abs(s - b) >= Math.abs(e) / 2) s = (a + b) / 2;
    const fs = f(s);
    c = b; fc = fb; e = d;
    if (fa * fs < 0) { b = s; fb = fs; } else { a = s; fa = fs; }
    d = b - a;
    if (Math.abs(fa) < Math.abs(fb)) { [a, b] = [b, a]; [fa, fb] = [fb, fa]; }
  }
  return b;
}

export interface BoundaryDistanceResult {
  separationDistance: number;
  boundaryDistance: number;
  sprinkleredBoundaryDistance: number;
  peakX: number;
  peakZ: number;
  peakIntensity: number;
}

export function sprinkleredBoundaryDistance(distance: number): number {
  return Math.min(distance, Math.max(distance / 2, 1));
}

export function minimumBoundaryDistance(facade: Facade, load: number, limit = ACCEPTANCE_LIMIT): BoundaryDistanceResult {
  const target = limit / load;
  if (!preparedRectangles(facade).length) return { separationDistance: 0, boundaryDistance: 0, sprinkleredBoundaryDistance: 0, peakX: NaN, peakZ: NaN, peakIntensity: 0 };
  const separation = solveOutermost((s) => peakWeighted(facade, s)[0], target, upperSeparationBound(facade, target));
  const [value, x, z] = peakWeighted(facade, separation > 0 ? separation : 1e-6);
  const boundary = separation / 2;
  return { separationDistance: separation, boundaryDistance: boundary,
    sprinkleredBoundaryDistance: sprinkleredBoundaryDistance(boundary), peakX: x, peakZ: z, peakIntensity: load * value };
}

export function enclosingRectangleBoundaryDistance(width: number, height: number, percentage: number,
                                                   load: number, limit = ACCEPTANCE_LIMIT): number {
  const intensity = load * percentage / 100;
  const required = limit / intensity;
  if (required >= 1) return 0;
  const separation = solveMonotone((s) => centreConfigurationFactor(width, height, s), required);
  return separation / 2;
}

export function enclosingRectanglePermittedPercentage(width: number, height: number, boundaryDistance: number,
                                                      load: number, limit = ACCEPTANCE_LIMIT): number {
  const phi = centreConfigurationFactor(width, height, 2 * boundaryDistance);
  return Math.min(100, (100 * limit) / (load * phi));
}

export interface InverseResult {
  scalingFactor: number;
  peakIntensity: number;
  peakX: number;
  peakZ: number;
  permittedPercentage: number;
  passes: boolean;
}

export function permittedUnprotectedScaling(facade: Facade, boundaryDistance: number, load: number,
                                            limit = ACCEPTANCE_LIMIT): InverseResult {
  const box = enclosingRectangle(facade);
  const [peak, x, z] = peakWeighted(facade, 2 * boundaryDistance);
  const peakIntensity = load * peak;
  const k = limit / peakIntensity;
  return { scalingFactor: k, peakIntensity, peakX: x, peakZ: z,
    permittedPercentage: box && box.unprotectedArea > 0 ? Math.min(100, k * box.percentage) : 100, passes: k >= 1 };
}

export function boundaryDistanceProfile(facade: Facade, positions: number[], load: number, zPoints = 61,
                                        limit = ACCEPTANCE_LIMIT): number[] {
  const box = enclosingRectangle(facade);
  if (!box) return positions.map(() => 0);
  const zs = linspace(box.zMin, box.zMax, zPoints);
  const target = limit / load;
  const upper = upperSeparationBound(facade, target);
  const rects = rectangles(facade);
  return positions.map((x) => {
    const func = (s: number) => {
      let best = -Infinity;
      for (let i = 0; i < zs.length; i++) {
        const v = weightedFromRects(rects, x, zs[i], s);
        if (v > best) best = v;
      }
      return best;
    };
    return solveOutermost(func, target, upper) / 2;
  });
}

export interface IntensityGrid { x: number[]; z: number[]; intensity: number[][]; peak: number; peakX: number; peakZ: number }

export function intensityGrid(facade: Facade, separation: number, load: number, spacing = 0.25, margin?: number): IntensityGrid {
  const box = enclosingRectangle(facade);
  if (!box) return { x: [0], z: [0], intensity: [[0]], peak: 0, peakX: 0, peakZ: 0 };
  const m = margin ?? 0.5 * separation;
  const xRange: [number, number] = [box.xMin - m, box.xMax + m];
  const zRange: [number, number] = [box.zMin, box.zMax];
  const x = linspace(xRange[0], xRange[1], Math.max(2, Math.ceil((xRange[1] - xRange[0]) / spacing) + 1));
  const z = linspace(zRange[0], zRange[1], Math.max(2, Math.ceil((zRange[1] - zRange[0]) / spacing) + 1));
  let peak = -Infinity, peakX = 0, peakZ = 0;
  const intensity = z.map((zz) => x.map((xx) => {
    const v = receivedIntensity(facade, xx, zz, separation, load);
    if (v > peak) { peak = v; peakX = xx; peakZ = zz; }
    return v;
  }));
  return { x, z, intensity, peak, peakX, peakZ };
}
