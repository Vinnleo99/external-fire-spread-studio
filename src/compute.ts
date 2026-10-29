/** Everything the interface shows for one façade. Runs inside the web worker. */
import { ACCEPTANCE_LIMIT, Facade, TableEntry, enclosingRectangle, sourceIntensity, tableLookup } from "./engine/model";
import {
  BoundaryDistanceResult, IntensityGrid, boundaryDistanceProfile, enclosingRectangleBoundaryDistance,
  enclosingRectanglePermittedPercentage, intensityGrid, minimumBoundaryDistance, permittedUnprotectedScaling,
  sprinkleredBoundaryDistance,
} from "./engine/radiation";

export interface FacadeResults {
  facadeId: string;
  key: string;
  empty: boolean;
  load: number;
  boundaryDistance: number;
  sprinklered: boolean;
  sprinklerOption: "halveDistance" | "doubleArea";
  enclosing: { xMin: number; xMax: number; zMin: number; zMax: number; width: number; height: number; unprotectedArea: number; percentage: number } | null;
  enclosingExact: number;
  enclosingTable: number | null;
  enclosingTableColumn: number | null;
  individual: BoundaryDistanceResult | null;
  /** Requirement after the sprinkler allowance (if any). */
  requiredDistance: number;
  enclosingRequiredDistance: number;
  atEntered: { peakIntensity: number; peakX: number; peakZ: number; scalingFactor: number; permittedPercentage: number;
    permittedArea: number; enclosingPermittedPercentage: number; passes: boolean };
  grid: IntensityGrid;
  profile: { x: number[]; distance: number[] };
}

export function facadeKey(facade: Facade): string {
  return JSON.stringify([facade.openings, facade.fireLoad, facade.boundaryDistance, facade.sprinklered, facade.sprinklerOption]);
}

export function computeFacade(facade: Facade, table: TableEntry[]): FacadeResults {
  const load = sourceIntensity(facade.fireLoad);
  const d = Math.max(0.05, facade.boundaryDistance ?? 1);
  const sprinklered = !!facade.sprinklered;
  const option = facade.sprinklerOption ?? "halveDistance";
  const box = enclosingRectangle(facade);
  const base = { facadeId: facade.id, key: facadeKey(facade), load, boundaryDistance: d, sprinklered, sprinklerOption: option };
  if (!box || box.unprotectedArea <= 0) {
    return { ...base, empty: true, enclosing: null, enclosingExact: 0, enclosingTable: null, enclosingTableColumn: null,
      individual: null, requiredDistance: 0, enclosingRequiredDistance: 0,
      atEntered: { peakIntensity: 0, peakX: 0, peakZ: 0, scalingFactor: Infinity, permittedPercentage: 100, permittedArea: 0,
        enclosingPermittedPercentage: 100, passes: true },
      grid: { x: [0, 1], z: [0, 1], intensity: [[0, 0], [0, 0]], peak: 0, peakX: 0, peakZ: 0 }, profile: { x: [], distance: [] } };
  }
  const pct = Math.min(100, box.percentage);
  const enclosingExact = enclosingRectangleBoundaryDistance(box.width, box.height, pct, load);
  const enclosingTable = tableLookup(table, box.width, box.height, pct, load, true);
  const enclosingTableColumn = tableLookup(table, box.width, box.height, pct, load, false);
  const individual = minimumBoundaryDistance(facade, load);
  const halve = sprinklered && option === "halveDistance";
  const double = sprinklered && option === "doubleArea";
  // Option (b), doubling the unprotected area, is equivalent in this model to allowing twice the received intensity.
  const requiredDistance = halve ? sprinkleredBoundaryDistance(individual.boundaryDistance)
    : double ? minimumBoundaryDistance(facade, load, 2 * ACCEPTANCE_LIMIT).boundaryDistance : individual.boundaryDistance;
  const enclosingRequiredDistance = halve ? sprinkleredBoundaryDistance(enclosingExact)
    : double ? enclosingRectangleBoundaryDistance(box.width, box.height, pct / 2, load) : enclosingExact;
  const inverse = permittedUnprotectedScaling(facade, d, load);
  const factor = double ? 2 : 1;
  const scaling = inverse.scalingFactor * factor;
  const atEntered = {
    peakIntensity: inverse.peakIntensity, peakX: inverse.peakX, peakZ: inverse.peakZ, scalingFactor: scaling,
    permittedPercentage: Math.min(100, scaling * box.percentage), permittedArea: scaling * box.unprotectedArea,
    enclosingPermittedPercentage: Math.min(100, factor * enclosingRectanglePermittedPercentage(box.width, box.height, d, load)),
    passes: halve ? d >= requiredDistance - 1e-9 : scaling >= 1,
  };
  const span = box.xMax - box.xMin;
  const spacing = Math.max(0.08, (span + 8) / 220);
  const grid = intensityGrid(facade, 2 * d, load, spacing, 4);
  const xs = Array.from({ length: 121 }, (_, i) => box.xMin - 6 + ((span + 12) * i) / 120);
  const profile = { x: xs, distance: boundaryDistanceProfile(facade, xs, load, 41) };
  return { ...base, empty: false, enclosing: box, enclosingExact, enclosingTable, enclosingTableColumn, individual,
    requiredDistance, enclosingRequiredDistance, atEntered, grid, profile };
}
