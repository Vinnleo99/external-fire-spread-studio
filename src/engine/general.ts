/**
 * General configuration factor from a planar polygon to a differential receiving element of any position
 * and orientation, by the contour integral (Stokes) form:
 *
 *   F = (1 / 2π) Σ_i  γ_i  (n · g_i),   g_i = (r_i × r_{i+1}) / |r_i × r_{i+1}|,   γ_i = angle between r_i and r_{i+1}
 *
 * where r_i are the polygon vertices relative to the receiving point and n is the unit normal of the receiving
 * element. Before the sum is taken the polygon is clipped to the receiver's front hemisphere (n · r ≥ 0), so
 * parts of the emitter that the receiving element cannot see contribute nothing. Emitters radiate from their
 * front face only: a receiving point on or behind the emitter plane receives nothing from it.
 */

export type Vec3 = [number, number, number];

const TWO_PI = 2 * Math.PI;
const CLIP = new Float64Array(3 * 32);

/** Signed contour sum for the polygon in CLIP[0..count) (relative to the receiver), projected on (nx, ny, nz). */
function contourSum(count: number, nx: number, ny: number, nz: number): number {
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const j = i + 1 === count ? 0 : i + 1;
    const ax = CLIP[3 * i], ay = CLIP[3 * i + 1], az = CLIP[3 * i + 2];
    const bx = CLIP[3 * j], by = CLIP[3 * j + 1], bz = CLIP[3 * j + 2];
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    const cn = Math.sqrt(cx * cx + cy * cy + cz * cz);
    if (cn < 1e-300) continue;
    const angle = Math.atan2(cn, ax * bx + ay * by + az * bz);
    sum += ((nx * cx + ny * cy + nz * cz) / cn) * angle;
  }
  return sum;
}

/**
 * Clip a polygon (world co-ordinates, flat array of `count` vertices) to the half-space n · (v − p) ≥ 0 and store
 * the result relative to p in CLIP. Returns the number of vertices kept.
 */
function clipToHemisphere(verts: ArrayLike<number>, count: number, px: number, py: number, pz: number,
                          nx: number, ny: number, nz: number): number {
  let m = 0;
  let qx = verts[3 * (count - 1)] - px, qy = verts[3 * (count - 1) + 1] - py, qz = verts[3 * (count - 1) + 2] - pz;
  let qd = nx * qx + ny * qy + nz * qz;
  for (let i = 0; i < count; i++) {
    const cx = verts[3 * i] - px, cy = verts[3 * i + 1] - py, cz = verts[3 * i + 2] - pz;
    const cd = nx * cx + ny * cy + nz * cz;
    if (cd >= 0) {
      if (qd < 0) {
        const t = qd / (qd - cd);
        CLIP[3 * m] = qx + t * (cx - qx); CLIP[3 * m + 1] = qy + t * (cy - qy); CLIP[3 * m + 2] = qz + t * (cz - qz); m++;
      }
      CLIP[3 * m] = cx; CLIP[3 * m + 1] = cy; CLIP[3 * m + 2] = cz; m++;
    } else if (qd >= 0) {
      const t = qd / (qd - cd);
      CLIP[3 * m] = qx + t * (cx - qx); CLIP[3 * m + 1] = qy + t * (cy - qy); CLIP[3 * m + 2] = qz + t * (cz - qz); m++;
    }
    qx = cx; qy = cy; qz = cz; qd = cd;
  }
  return m;
}

/**
 * Configuration factor from a planar emitter polygon to a receiving element at p with unit normal n.
 * `emitterNormal` is the outward (radiating) normal of the emitter; points on or behind its plane get zero.
 */
export function polygonFactor(verts: ArrayLike<number>, count: number, emitterNormal: ArrayLike<number>,
                              p: ArrayLike<number>, n: ArrayLike<number>): number {
  const px = p[0], py = p[1], pz = p[2];
  const front = (px - verts[0]) * emitterNormal[0] + (py - verts[1]) * emitterNormal[1] + (pz - verts[2]) * emitterNormal[2];
  if (front <= 1e-12) return 0;
  const m = clipToHemisphere(verts, count, px, py, pz, n[0], n[1], n[2]);
  if (m < 3) return 0;
  return Math.abs(contourSum(m, n[0], n[1], n[2])) / TWO_PI;
}

/**
 * Vector configuration factor of the part of the emitter in front of the plane with normal `clipNormal`
 * (or of the whole emitter when `clipNormal` is null). For a receiving element with normal m wholly facing that
 * part, the configuration factor is m · V. The vector points from the receiver towards the emitter.
 */
export function vectorFactor(verts: ArrayLike<number>, count: number, emitterNormal: ArrayLike<number>,
                             p: ArrayLike<number>, clipNormal: ArrayLike<number> | null, out: Vec3): Vec3 {
  out[0] = 0; out[1] = 0; out[2] = 0;
  const px = p[0], py = p[1], pz = p[2];
  const front = (px - verts[0]) * emitterNormal[0] + (py - verts[1]) * emitterNormal[1] + (pz - verts[2]) * emitterNormal[2];
  if (front <= 1e-12) return out;
  let m: number;
  if (clipNormal) {
    m = clipToHemisphere(verts, count, px, py, pz, clipNormal[0], clipNormal[1], clipNormal[2]);
  } else {
    for (let i = 0; i < count; i++) {
      CLIP[3 * i] = verts[3 * i] - px; CLIP[3 * i + 1] = verts[3 * i + 1] - py; CLIP[3 * i + 2] = verts[3 * i + 2] - pz;
    }
    m = count;
  }
  if (m < 3) return out;
  let vx = 0, vy = 0, vz = 0;
  for (let i = 0; i < m; i++) {
    const j = i + 1 === m ? 0 : i + 1;
    const ax = CLIP[3 * i], ay = CLIP[3 * i + 1], az = CLIP[3 * i + 2];
    const bx = CLIP[3 * j], by = CLIP[3 * j + 1], bz = CLIP[3 * j + 2];
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    const cn = Math.sqrt(cx * cx + cy * cy + cz * cz);
    if (cn < 1e-300) continue;
    const angle = Math.atan2(cn, ax * bx + ay * by + az * bz);
    vx += (cx / cn) * angle; vy += (cy / cn) * angle; vz += (cz / cn) * angle;
  }
  // Orient towards the emitter: the emitter's outward normal points at the receiver, so V · e must be negative.
  const s = vx * emitterNormal[0] + vy * emitterNormal[1] + vz * emitterNormal[2] > 0 ? -1 : 1;
  out[0] = (s * vx) / TWO_PI; out[1] = (s * vy) / TWO_PI; out[2] = (s * vz) / TWO_PI;
  return out;
}

/** Rectangle corners (counter-clockwise seen from the front) from an origin, two edge vectors. */
export function rectangle(origin: Vec3, u: Vec3, v: Vec3): Float64Array {
  return new Float64Array([
    origin[0], origin[1], origin[2],
    origin[0] + u[0], origin[1] + u[1], origin[2] + u[2],
    origin[0] + u[0] + v[0], origin[1] + u[1] + v[1], origin[2] + u[2] + v[2],
    origin[0] + v[0], origin[1] + v[1], origin[2] + v[2],
  ]);
}

/**
 * Reference value by direct numerical integration of cosθ_e cosθ_r / (π r²) over a planar parallelogram
 * (origin, edge vectors u and v), with Gauss–Legendre quadrature on an n × n grid of sub-cells. Used only in tests.
 */
export function numericalFactor(origin: Vec3, u: Vec3, v: Vec3, emitterNormal: Vec3, p: Vec3, n: Vec3,
                                cells = 24, order = 8): number {
  const [nodes, weights] = gaussLegendre(order);
  const area = norm(cross(u, v));
  let total = 0;
  for (let a = 0; a < cells; a++) for (let b = 0; b < cells; b++) {
    for (let i = 0; i < order; i++) for (let j = 0; j < order; j++) {
      const s = (a + (nodes[i] + 1) / 2) / cells, t = (b + (nodes[j] + 1) / 2) / cells;
      const q: Vec3 = [origin[0] + s * u[0] + t * v[0], origin[1] + s * u[1] + t * v[1], origin[2] + s * u[2] + t * v[2]];
      const d: Vec3 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
      const r2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
      const r = Math.sqrt(r2);
      const cosR = (n[0] * d[0] + n[1] * d[1] + n[2] * d[2]) / r;
      const cosE = -(emitterNormal[0] * d[0] + emitterNormal[1] * d[1] + emitterNormal[2] * d[2]) / r;
      if (cosR <= 0 || cosE <= 0) continue;
      total += (weights[i] * weights[j] / 4) * cosR * cosE / (Math.PI * r2);
    }
  }
  return total * area / (cells * cells);
}

function gaussLegendre(n: number): [number[], number[]] {
  const x: number[] = [], w: number[] = [];
  for (let i = 1; i <= n; i++) {
    let z = Math.cos(Math.PI * (i - 0.25) / (n + 0.5));
    let dp = 0;
    for (let it = 0; it < 100; it++) {
      let p0 = 1, p1 = z;
      for (let k = 2; k <= n; k++) { const p2 = ((2 * k - 1) * z * p1 - (k - 1) * p0) / k; p0 = p1; p1 = p2; }
      dp = (n * (z * p1 - p0)) / (z * z - 1);
      const dz = p1 / dp;
      z -= dz;
      if (Math.abs(dz) < 1e-15) break;
    }
    x.push(z); w.push(2 / ((1 - z * z) * dp * dp));
  }
  return [x, w];
}

export const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: ArrayLike<number>, b: ArrayLike<number>): Vec3 =>
  [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a: ArrayLike<number>) => Math.sqrt(dot(a, a));
export const normalise = (a: ArrayLike<number>): Vec3 => { const l = norm(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
