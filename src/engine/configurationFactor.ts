/**
 * Configuration factor of rectangular emitters onto a parallel receiving element.
 * Port of external_fire_spread/configuration_factor.py.
 */

const TWO_PI = 2 * Math.PI;

export function cornerConfigurationFactor(width: number, height: number, separation: number): number {
  if (!(separation > 0)) throw new Error("separation must be strictly positive");
  if (width <= 0 || height <= 0) return 0;
  const x = height / separation;
  const y = width / separation;
  const rootX = Math.sqrt(1 + x * x);
  const rootY = Math.sqrt(1 + y * y);
  const ratioX = Number.isFinite(x) ? x / rootX : 1;
  const ratioY = Number.isFinite(y) ? y / rootY : 1;
  const termX = ratioX * Math.atan(Number.isFinite(x) ? y / rootX : 0);
  const termY = ratioY * Math.atan(Number.isFinite(y) ? x / rootY : 0);
  return (termX + termY) / TWO_PI;
}

function signedCorner(dx: number, dz: number, separation: number): number {
  return Math.sign(dx) * Math.sign(dz) * cornerConfigurationFactor(Math.abs(dx), Math.abs(dz), separation);
}

/** Configuration factor of the rectangle [xMin, xMax] x [zMin, zMax] at a receiving point anywhere. */
export function rectangleConfigurationFactor(
  xMin: number, xMax: number, zMin: number, zMax: number,
  pointX: number, pointZ: number, separation: number,
): number {
  const ax0 = xMin - pointX, ax1 = xMax - pointX, az0 = zMin - pointZ, az1 = zMax - pointZ;
  return (signedCorner(ax1, az1, separation) - signedCorner(ax0, az1, separation)
    - signedCorner(ax1, az0, separation) + signedCorner(ax0, az0, separation));
}

export function centreConfigurationFactor(width: number, height: number, separation: number): number {
  return 4 * cornerConfigurationFactor(width / 2, height / 2, separation);
}
