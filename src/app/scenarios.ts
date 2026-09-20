import type {
  BoundaryOutlet,
  Connection,
  Intervention,
  RainfallInterval,
  Region,
  SimulationConfig,
} from "../shared/simulation";
import { BENGALURU_CELLS, BENGALURU_EDGE_OUTLETS, BENGALURU_GRID } from "./bengaluru";
import { EVENT_2022 } from "../data/event-2022";

/**
 * Bengaluru model domain: real GLO-90 elevation samples on a coarse grid.
 * Rainfall, hydraulic conductance, capacity, and blockages remain scenario
 * assumptions. Published drain geometry is a map layer, not a sewer solver.
 */

export type StormProfile = "steady" | "heavy" | "cloudburst" | "event-2022";
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
  /** Multiplier on the (uncalibrated) inter-cell conductance; 1 = default. */
  readonly conductanceScale: number;
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
  conductanceScale: 1,
};

/** UI horizon changes keep scheduled actions inside the run (five-minute controls).
 * Preserve a valid failure → clearing sequence when both times need moving.
 * The engine still rejects invalid times supplied directly through its contract.
 */
export function withScenarioHorizon(draft: ScenarioDraft, durationMin: number): ScenarioDraft {
  const latest = Math.max(0, durationMin - 5);
  const clamp = (time: number) => Math.max(0, Math.min(time, latest));
  const clearDrainsAtMin = draft.clearDrainsAtMin === null ? null : clamp(draft.clearDrainsAtMin);
  let drainFailureMin = clamp(draft.drainFailureMin);
  if (draft.basinDrainCondition === "fails-mid-storm" && clearDrainsAtMin !== null &&
      draft.clearDrainsAtMin! > draft.drainFailureMin && drainFailureMin >= clearDrainsAtMin) {
    drainFailureMin = Math.max(0, clearDrainsAtMin - 5);
  }
  return { ...draft, durationMin, stormDurationMin: Math.min(draft.stormDurationMin, durationMin),
    pumpDeployMin: clamp(draft.pumpDeployMin), drainFailureMin, clearDrainsAtMin };
}

/** One-click demo scenarios. Each sets every field it relies on. */
export const PRESETS: readonly { readonly id: string; readonly label: string; readonly hint: string; readonly draft: ScenarioDraft }[] = [
  {
    id: "normal", label: "Normal rain", hint: "Steady 15 mm/h for 2 h: the drains cope",
    draft: { ...DEFAULT_DRAFT, storm: "steady", peakIntensityMmPerHour: 15, pumpCount: 0, detentionShare: 0, drainUpgradeFactor: 1 },
  },
  {
    id: "heavy", label: "Heavy storm", hint: "90 mm/h peaked storm with the default response plan",
    draft: DEFAULT_DRAFT,
  },
  {
    id: "drain-failure", label: "Drain failure", hint: "Low-lying drains fail at T+45 min; crews clear them at T+75",
    draft: { ...DEFAULT_DRAFT, basinDrainCondition: "fails-mid-storm", drainFailureMin: 45, clearDrainsAtMin: 75, detentionShare: 0, drainUpgradeFactor: 1 },
  },
  {
    id: "replay-2022", label: "Replay Sep 2022", hint: "The 4–5 Sep 2022 storm (100 mm overnight) over 18 h",
    draft: { ...DEFAULT_DRAFT, storm: "event-2022", durationMin: EVENT_2022.hourlyMm.length * 60, pumpCount: 0, detentionShare: 0, drainUpgradeFactor: 1 },
  },
];

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
  "event-2022": [],
};

export const STORM_LABELS: Record<StormProfile, string> = {
  steady: "Steady (normal rain)",
  heavy: "Heavy storm (peaked)",
  cloudburst: "Cloudburst (short, intense)",
  "event-2022": "Replay: 4–5 Sep 2022 (100 mm)",
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
  if (draft.storm === "event-2022") {
    // Hourly depths (mm) are hourly intensities (mm/h) for one-hour intervals.
    const hours: RainfallInterval[] = EVENT_2022.hourlyMm
      .map((mm, h) => ({ startTimeS: h * 3600, endTimeS: (h + 1) * 3600, intensityMmPerHour: mm }))
      .filter((r) => r.startTimeS < durationS)
      .map((r) => ({ ...r, endTimeS: Math.min(r.endTimeS, durationS) }));
    const end = hours[hours.length - 1]?.endTimeS ?? 0;
    if (end < durationS) hours.push({ startTimeS: end, endTimeS: durationS, intensityMmPerHour: 0 });
    return hours;
  }
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

/** Saved frames × regions must stay within the engine's 200,000-state guardrail. */
export function outputIntervalFor(durationS: number, regionCount: number): number {
  const minimum = Math.ceil((durationS * regionCount) / 190_000);
  return Math.max(OUTPUT_INTERVAL_S, Math.ceil(minimum / 60) * 60);
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

/** Unique cells receiving structural measures; an area footprint, not a cost. */
export function responseFootprint(draft: ScenarioDraft): number {
  const changed = new Set<string>();
  if (draft.drainUpgradeFactor > 1 && draft.drainDesignMmPerHour > 0) {
    for (const id of LOW_LYING_IDS) changed.add(id);
  }
  if (draft.detentionHoldPct > 0) {
    for (const id of detentionSites(draft.detentionShare)) changed.add(id);
  }
  if (draft.pumpCapacityM3PerS > 0) {
    for (const id of pumpSites(draft.pumpCount)) changed.add(id);
  }
  return changed.size;
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
        conductanceM2PerS: CONNECTION_CONDUCTANCE * draft.conductanceScale,
      });
    }
    if (c.row + 1 < GRID.rows) {
      connections.push({
        id: `e-${c.id}-S`, regionAId: c.id, regionBId: regionId(c.row + 1, c.col),
        conductanceM2PerS: CONNECTION_CONDUCTANCE * draft.conductanceScale,
      });
    }
  }

  // Open, outflow-only boundary: each edge cell can discharge toward the mean
  // DEM ground level of a virtual cell just outside the domain. Water leaves
  // only where the outside ground is lower than the water surface; inflow from
  // beyond the model area is not simulated.
  const boundaryOutlets: BoundaryOutlet[] = BENGALURU_EDGE_OUTLETS.map((o) => ({
    id: o.id, regionId: o.cellId,
    externalWaterSurfaceElevationM: o.externalElevationM, conductanceM2PerS: CONNECTION_CONDUCTANCE * draft.conductanceScale,
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
  // Clearing only makes sense after a mid-storm failure; at the same instant it
  // would also conflict with the failure event.
  const clearingValid = draft.basinDrainCondition !== "fails-mid-storm" || (draft.clearDrainsAtMin ?? 0) > draft.drainFailureMin;
  if (draft.clearDrainsAtMin !== null && draft.basinDrainCondition !== "working" && clearingValid) {
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
    outputIntervalS: outputIntervalFor(durationS, regions.length),
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
