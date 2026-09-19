import type {
  BoundaryOutlet,
  Connection,
  Intervention,
  RainfallInterval,
  Region,
  SimulationConfig,
} from "../shared/simulation";
import { BENGALURU_CELLS, BENGALURU_EDGE_OUTLETS, BENGALURU_GRID } from "./bengaluru";

/**
 * Bengaluru model domain: real GLO-90 elevation samples on a coarse grid.
 * Rainfall, hydraulic conductance, capacity, and blockages remain scenario
 * assumptions. Published drain geometry is a map layer, not a sewer solver.
 */

export type StormProfile = "steady" | "heavy" | "cloudburst";
export type DrainCondition = "working" | "partly-blocked" | "blocked" | "fails-mid-storm";

export interface ScenarioDraft {
  readonly storm: StormProfile;
  /** Peak rainfall intensity of the storm profile, mm/hour. */
  readonly peakIntensityMmPerHour: number;
  readonly stormDurationMin: number;
  readonly durationMin: number;
  /** Drain design rate expressed as rainfall depth it can remove, mm/hour. */
  readonly drainDesignMmPerHour: number;
  readonly basinDrainCondition: DrainCondition;
  readonly drainFailureMin: number;
  readonly pumpCount: number;
  readonly pumpCapacityM3PerS: number;
  readonly pumpDeployMin: number;
  readonly clearDrainsAtMin: number | null;
  /** Share of the highest cells fitted with detention (0 = none). */
  readonly detentionShare: number;
  /** Percentage of surface outflow those cells hold back (0-95). */
  readonly detentionHoldPct: number;
  /** Multiplier on the low-lying district's drain capacity (1 = no upgrade). */
  readonly drainUpgradeFactor: number;
  readonly warningDepthM: number;
  readonly criticalDepthM: number;
  readonly maxStepS: number;
}

export const DEFAULT_DRAFT: ScenarioDraft = {
  storm: "heavy",
  peakIntensityMmPerHour: 90,
  stormDurationMin: 120,
  durationMin: 180,
  drainDesignMmPerHour: 20,
  basinDrainCondition: "working",
  drainFailureMin: 45,
  pumpCount: 3,
  pumpCapacityM3PerS: 0.4,
  pumpDeployMin: 30,
  clearDrainsAtMin: null,
  detentionShare: 0.6,
  detentionHoldPct: 85,
  drainUpgradeFactor: 3,
  warningDepthM: 0.1,
  criticalDepthM: 0.3,
  maxStepS: 1,
};

export const GRID = BENGALURU_GRID;
// m²/s, uncalibrated scenario assumption. For square cells the width/length
// ratio of every interface is 1, so the same value applies at any cell size.
const CONNECTION_CONDUCTANCE = 40;
const OUTPUT_INTERVAL_S = 60;
/** Lowest-lying 15% of cells by mean DEM elevation: the scenario "district". */
export const LOW_LYING_FRACTION = 0.15;
const LOW_LYING_IDS = new Set([...BENGALURU_CELLS.values()]
  .sort((a, b) => a.elevationM - b.elevationM || (a.id < b.id ? -1 : 1))
  .slice(0, Math.round(BENGALURU_CELLS.size * LOW_LYING_FRACTION)).map((c) => c.id as string));

/** Relative storm shapes; each block is an equal share of the storm duration. */
const STORM_SHAPES: Record<StormProfile, readonly number[]> = {
  steady: [1, 1, 1, 1, 1, 1, 1, 1],
  heavy: [0.2, 0.4, 0.7, 1, 0.8, 0.5, 0.3, 0.1],
  cloudburst: [0.1, 0.25, 1, 0.9, 0.35, 0.15, 0.1, 0.05],
};

export const STORM_LABELS: Record<StormProfile, string> = {
  steady: "Steady (normal rain)",
  heavy: "Heavy storm (peaked)",
  cloudburst: "Cloudburst (short, intense)",
};

export const DRAIN_LABELS: Record<DrainCondition, string> = {
  working: "Working",
  "partly-blocked": "Partly blocked (30% open)",
  blocked: "Fully blocked",
  "fails-mid-storm": "Fail mid-storm",
};

const ROW_NAMES = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function regionId(row: number, col: number): string {
  return `r${String(row).padStart(2, "0")}-${String(col).padStart(2, "0")}`;
}

export function terrainAt(row: number, col: number): number {
  const cell = BENGALURU_CELLS.get(regionId(row, col));
  if (!cell) throw new Error("Missing Bengaluru DEM sample.");
  return cell.elevationM;
}

export function isBasinCell(row: number, col: number): boolean {
  return LOW_LYING_IDS.has(regionId(row, col));
}

interface Cell {
  readonly row: number;
  readonly col: number;
  readonly id: string;
  readonly terrain: number;
}

function cells(): Cell[] {
  const out: Cell[] = [];
  for (let row = 0; row < GRID.rows; row += 1) {
    for (let col = 0; col < GRID.cols; col += 1) {
      out.push({ row, col, id: regionId(row, col), terrain: terrainAt(row, col) });
    }
  }
  return out;
}

function rainfall(draft: ScenarioDraft, durationS: number): RainfallInterval[] {
  const shape = STORM_SHAPES[draft.storm];
  const stormS = Math.min(Math.round(draft.stormDurationMin * 60), durationS);
  const intervals: RainfallInterval[] = [];
  let start = 0;
  shape.forEach((factor, index) => {
    const end = Math.round((stormS * (index + 1)) / shape.length);
    if (end > start) {
      intervals.push({
        startTimeS: start,
        endTimeS: end,
        intensityMmPerHour: Math.round(draft.peakIntensityMmPerHour * factor * 10) / 10,
      });
      start = end;
    }
  });
  if (start < durationS) {
    intervals.push({ startTimeS: start, endTimeS: durationS, intensityMmPerHour: 0 });
  }
  return intervals;
}

/** Detention sites: the highest cells by mean elevation, ties broken by ID. */
export function detentionSites(share: number): string[] {
  const all = cells();
  return all
    .sort((a, b) => b.terrain - a.terrain || (a.id < b.id ? -1 : 1))
    .slice(0, Math.round(all.length * Math.max(0, Math.min(1, share))))
    .map((c) => c.id);
}

/** Pump sites: the lowest-terrain cells of the low-lying district, ties broken by ID. */
export function pumpSites(count: number): string[] {
  return cells()
    .filter((c) => isBasinCell(c.row, c.col))
    .sort((a, b) => a.terrain - b.terrain || (a.id < b.id ? -1 : 1))
    .slice(0, Math.max(0, count))
    .map((c) => c.id);
}

export interface ScenarioPair {
  readonly baseline: SimulationConfig;
  readonly intervention: SimulationConfig;
  /** True when the intervention list equals the baseline list. */
  readonly noMitigation: boolean;
}

export function buildScenarioPair(draft: ScenarioDraft): ScenarioPair {
  const durationS = Math.round(draft.durationMin * 60);
  const all = cells();
  const area = GRID.cellM * GRID.cellM;
  const drainCapacity = (area * draft.drainDesignMmPerHour) / 3_600_000;
  const basinOpen =
    draft.basinDrainCondition === "partly-blocked" ? 0.3 : draft.basinDrainCondition === "blocked" ? 0 : 1;

  const regions: Region[] = all.map((c) => ({
    id: c.id,
    label: `Block ${ROW_NAMES[c.row] ?? "?"}${c.col + 1}`,
    center: { xM: (c.col + 0.5) * GRID.cellM, yM: (c.row + 0.5) * GRID.cellM },
    areaM2: area,
    terrainElevationM: c.terrain,
    initialWaterDepthM: 0,
    drainageCapacityM3PerS: Math.round(drainCapacity * 1e6) / 1e6,
    initialDrainOpenFraction: isBasinCell(c.row, c.col) ? basinOpen : 1,
    initialPumpCapacityM3PerS: 0,
  }));

  const connections: Connection[] = [];
  for (const c of all) {
    if (c.col + 1 < GRID.cols) {
      connections.push({
        id: `e-${c.id}-E`, regionAId: c.id, regionBId: regionId(c.row, c.col + 1),
        conductanceM2PerS: CONNECTION_CONDUCTANCE,
      });
    }
    if (c.row + 1 < GRID.rows) {
      connections.push({
        id: `e-${c.id}-S`, regionAId: c.id, regionBId: regionId(c.row + 1, c.col),
        conductanceM2PerS: CONNECTION_CONDUCTANCE,
      });
    }
  }

  // Open, outflow-only boundary: each edge cell can discharge toward the mean
  // DEM ground level of a virtual cell just outside the domain. Water leaves
  // only where the outside ground is lower than the water surface; inflow from
  // beyond the model area is not simulated.
  const boundaryOutlets: BoundaryOutlet[] = BENGALURU_EDGE_OUTLETS.map((o) => ({
    id: o.id, regionId: o.cellId,
    externalWaterSurfaceElevationM: o.externalElevationM, conductanceM2PerS: CONNECTION_CONDUCTANCE,
  }));

  const basinIds = all.filter((c) => isBasinCell(c.row, c.col)).map((c) => c.id);
  const hazardEvents: Intervention[] =
    draft.basinDrainCondition === "fails-mid-storm"
      ? basinIds.map((id) => ({
          id: `fail-${id}`, kind: "set-drain-open-fraction", regionId: id,
          timeS: Math.round(draft.drainFailureMin * 60), openFraction: 0,
        }))
      : [];

  // Structural measures are in place from the start of the storm (t = 0).
  const mitigation: Intervention[] = [];
  if (draft.detentionHoldPct > 0) {
    for (const id of detentionSites(draft.detentionShare)) {
      mitigation.push({
        id: `detain-${id}`, kind: "set-surface-outflow-factor", regionId: id,
        timeS: 0, factor: Math.round((1 - draft.detentionHoldPct / 100) * 1000) / 1000,
      });
    }
  }
  if (draft.drainUpgradeFactor !== 1) {
    for (const id of basinIds) {
      mitigation.push({
        id: `upgrade-${id}`, kind: "set-drainage-capacity", regionId: id,
        timeS: 0, capacityM3PerS: Math.round(drainCapacity * draft.drainUpgradeFactor * 1e6) / 1e6,
      });
    }
  }
  for (const id of pumpSites(draft.pumpCount)) {
    mitigation.push({
      id: `pump-${id}`, kind: "set-pump-capacity", regionId: id,
      timeS: Math.round(draft.pumpDeployMin * 60), capacityM3PerS: draft.pumpCapacityM3PerS,
    });
  }
  if (draft.clearDrainsAtMin !== null && draft.basinDrainCondition !== "working") {
    for (const id of basinIds) {
      mitigation.push({
        id: `clear-${id}`, kind: "set-drain-open-fraction", regionId: id,
        timeS: Math.round(draft.clearDrainsAtMin * 60), openFraction: 1,
      });
    }
  }

  const baseline: SimulationConfig = {
    contractVersion: "1.0",
    scenarioId: "baseline",
    label: "Bengaluru baseline (no response)",
    dataSource: "user-provided",
    regions,
    connections,
    boundaryOutlets,
    rainfall: rainfall(draft, durationS),
    interventions: hazardEvents,
    durationS,
    outputIntervalS: OUTPUT_INTERVAL_S,
    riskThresholds: { warningDepthM: draft.warningDepthM, criticalDepthM: draft.criticalDepthM },
    integration: {
      maxStepS: draft.maxStepS,
      transferSafetyFactor: 0.45,
      maxSteps: 1_000_000,
      massBalanceAbsoluteToleranceM3: 1e-6,
      massBalanceRelativeTolerance: 1e-9,
    },
  };

  return {
    baseline,
    intervention: {
      ...baseline,
      scenarioId: "intervention",
      label: "Bengaluru with response plan",
      interventions: [...hazardEvents, ...mitigation],
    },
    noMitigation: mitigation.length === 0,
  };
}

export const BASIN_REGION_IDS: ReadonlySet<string> = new Set(
  cells().filter((c) => isBasinCell(c.row, c.col)).map((c) => c.id),
);
