import type {
  SimulationConfig,
  SimulationFrame,
  SimulationRun,
  WaterBalance,
} from "../shared/simulation";

/**
 * ILLUSTRATIVE CONTRACT FIXTURE — NOT ENGINE OUTPUT.
 * Copied from docs/agent-handoff.md solely to exercise the UI before Astra's
 * engine exists. Hand-specified values for a sealed, rainless one-cell case.
 * Remove from the UI once the engine is integrated; never present as a result.
 */
export const ILLUSTRATIVE_CONFIG = {
  contractVersion: "1.0",
  scenarioId: "shape-example-baseline",
  label: "Illustrative sealed-cell fixture",
  dataSource: "synthetic",
  regions: [{
    id: "r1", label: "Region 1", center: { xM: 5, yM: 5 },
    areaM2: 100, terrainElevationM: 10, initialWaterDepthM: 0.02,
    drainageCapacityM3PerS: 0, initialDrainOpenFraction: 1,
    initialPumpCapacityM3PerS: 0,
  }],
  connections: [],
  boundaryOutlets: [],
  rainfall: [{ startTimeS: 0, endTimeS: 60, intensityMmPerHour: 0 }],
  interventions: [],
  durationS: 60,
  outputIntervalS: 60,
  riskThresholds: { warningDepthM: 0.1, criticalDepthM: 0.3 },
  integration: {
    maxStepS: 60, transferSafetyFactor: 0.45, maxSteps: 1000,
    massBalanceAbsoluteToleranceM3: 0.000001,
    massBalanceRelativeTolerance: 0.000000001,
  },
} as const satisfies SimulationConfig;

const balance = {
  initialStorageM3: 2, rainfallInputM3: 0, drainedM3: 0,
  pumpedM3: 0, boundaryDischargeM3: 0, storageM3: 2,
  roundoffAddedM3: 0, physicalResidualM3: 0, numericalResidualM3: 0,
  allowedErrorM3: 0.000001002,
} as const satisfies WaterBalance;

const initialFrame = {
  timeS: 0,
  regions: [{
    regionId: "r1", waterDepthM: 0.02, waterSurfaceElevationM: 10.02,
    waterVolumeM3: 2, risk: "safe", drainOpenFraction: 1,
    pumpCapacityM3PerS: 0, drainageCapacityM3PerS: 0, surfaceOutflowFactor: 1,
  }],
  riskCounts: { safe: 1, warning: 0, critical: 0 },
  balance,
} as const satisfies SimulationFrame;

export const ILLUSTRATIVE_RUN = {
  status: "success",
  result: {
    contractVersion: "1.0", modelVersion: "linear-storage-v1",
    scenarioId: ILLUSTRATIVE_CONFIG.scenarioId, durationS: 60, outputIntervalS: 60,
    riskThresholds: ILLUSTRATIVE_CONFIG.riskThresholds,
    frames: [initialFrame, { ...initialFrame, timeS: 60 }],
    summary: {
      regions: [{
        regionId: "r1",
        firstCritical: { status: "not-reached-within-horizon", horizonS: 60 },
        peakWaterDepthM: 0.02, peakTimeS: 0, finalWaterDepthM: 0.02,
      }],
      everCriticalRegionCount: 0,
      peakCriticalRegionCount: 0, peakCriticalRegionCountTimeS: 0,
      peakWaterDepthM: 0.02,
      finalRiskCounts: { safe: 1, warning: 0, critical: 0 },
      finalBalance: balance,
    },
    diagnostics: {
      acceptedSteps: 1, smallestStepS: 60, largestStepS: 60,
      donorLimitedRegionSteps: 0,
      maxAbsolutePhysicalResidualM3: 0, maxAbsoluteNumericalResidualM3: 0,
    },
  },
} as const satisfies SimulationRun;
