import type { SimulationFrame, SimulationResult } from "../shared/simulation";
import { BENGALURU_EXPOSURE } from "../data/bengaluru-exposure";
import { EVENT_2022 } from "../data/event-2022";
import { crossingTime } from "./comparison";
import { GRID, regionId } from "./scenarios";

const BUILDINGS: Readonly<Record<string, number>> = BENGALURU_EXPOSURE.buildingsByCell;
export const TOTAL_BUILDINGS = BENGALURU_EXPOSURE.totalBuildings;

export function buildingsIn(id: string): number {
  return BUILDINGS[id] ?? 0;
}

/** Mapped buildings in cells that are critical in this frame. */
export function buildingsCriticalNow(frame: SimulationFrame): number {
  return frame.regions.reduce((sum, r) => sum + (r.risk === "critical" ? buildingsIn(r.regionId) : 0), 0);
}

/** Mapped buildings in cells that were ever critical during the run. */
export function buildingsEverCritical(result: SimulationResult): number {
  return result.summary.regions.reduce(
    (sum, r) => sum + (r.firstCritical.status === "not-reached-within-horizon" ? 0 : buildingsIn(r.regionId)), 0);
}

export type LeadTime =
  | { readonly kind: "lead"; readonly warningS: number; readonly criticalS: number; readonly leadS: number }
  | { readonly kind: "within-frame"; readonly criticalS: number; readonly frameS: number }
  | { readonly kind: "warning-only"; readonly warningS: number }
  | { readonly kind: "none" };

/**
 * Early-warning lead time per region: first saved frame at or above the warning
 * depth, to the engine's first critical crossing (step-resolved). The warning
 * time is frame-resolved, so lead times are accurate to one output interval.
 */
export function leadTimes(result: SimulationResult): Map<string, LeadTime> {
  const warn = result.riskThresholds.warningDepthM;
  const firstWarning = new Map<string, number>();
  for (const frame of result.frames) {
    for (const r of frame.regions) {
      if (r.waterDepthM >= warn && !firstWarning.has(r.regionId)) firstWarning.set(r.regionId, frame.timeS);
    }
  }
  const out = new Map<string, LeadTime>();
  for (const r of result.summary.regions) {
    const criticalS = crossingTime(r.firstCritical);
    const warningS = firstWarning.get(r.regionId);
    if (criticalS === null) out.set(r.regionId, warningS === undefined ? { kind: "none" } : { kind: "warning-only", warningS });
    else if (warningS === undefined || warningS >= criticalS) out.set(r.regionId, { kind: "within-frame", criticalS, frameS: result.outputIntervalS });
    else out.set(r.regionId, { kind: "lead", warningS, criticalS, leadS: criticalS - warningS });
  }
  return out;
}

export interface PlaceCheck {
  readonly name: string;
  readonly cellId: string | null;
  readonly peakInCellM: number | null;
  readonly peakNearbyM: number | null;
  readonly hit: boolean;
}

export interface Validation {
  readonly places: readonly PlaceCheck[];
  readonly inside: number;
  readonly hits: number;
  /** Share of all 3x3 neighbourhoods containing a critical cell: the hit rate expected by chance. */
  readonly chanceRate: number;
}

function cellAt(lat: number, lng: number): string | null {
  const col = Math.floor(((lng - GRID.westLng) * GRID.metersPerDegreeLng) / GRID.cellM);
  const row = Math.floor(((GRID.northLat - lat) * GRID.metersPerDegreeLat) / GRID.cellM);
  return row >= 0 && row < GRID.rows && col >= 0 && col < GRID.cols ? regionId(row, col) : null;
}

/**
 * Compare a replay run with places reported flooded. A place counts as a hit when
 * any cell within one cell (about 750 m) reached critical depth, which allows for
 * point geocodes and 500 m cells. The chance rate uses the same neighbourhood test
 * on every cell, so a model that floods at random scores about the chance rate.
 */
export function validateReplay(result: SimulationResult): Validation {
  const critical = result.riskThresholds.criticalDepthM;
  const peak = new Map(result.summary.regions.map((r) => [r.regionId, r.peakWaterDepthM]));
  const nearbyMax = (row: number, col: number) => {
    let best = 0;
    for (let dr = -1; dr <= 1; dr += 1) for (let dc = -1; dc <= 1; dc += 1) best = Math.max(best, peak.get(regionId(row + dr, col + dc)) ?? 0);
    return best;
  };
  const places = EVENT_2022.reportedFloodedPlaces.map((p): PlaceCheck => {
    const id = cellAt(p.lat, p.lng);
    if (!id) return { name: p.name, cellId: null, peakInCellM: null, peakNearbyM: null, hit: false };
    const [row, col] = id.slice(1).split("-").map(Number) as [number, number];
    const nearby = nearbyMax(row, col);
    return { name: p.name, cellId: id, peakInCellM: peak.get(id) ?? 0, peakNearbyM: nearby, hit: nearby >= critical };
  });
  let critHoods = 0;
  for (let row = 0; row < GRID.rows; row += 1) for (let col = 0; col < GRID.cols; col += 1) if (nearbyMax(row, col) >= critical) critHoods += 1;
  const inside = places.filter((p) => p.cellId !== null);
  return { places, inside: inside.length, hits: inside.filter((p) => p.hit).length, chanceRate: critHoods / (GRID.rows * GRID.cols) };
}
