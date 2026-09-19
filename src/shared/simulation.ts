/**
 * FLOWSHIELD contract 1.0. Types only: this file implements no simulator.
 * Normative semantics: docs/simulation-design.md and docs/agent-handoff.md.
 * All values must be finite, JSON-compatible data; readonly is not validation.
 */

export type RegionId = string;
export type RiskLevel = "safe" | "warning" | "critical";

export interface Region {
  readonly id: RegionId;
  readonly label: string;
  /** Local planar display coordinates; do not infer connections from proximity. */
  readonly center: { readonly xM: number; readonly yM: number };
  readonly areaM2: number;
  /** Relative to one shared, arbitrary vertical datum. Negative is allowed. */
  readonly terrainElevationM: number;
  readonly initialWaterDepthM: number;
  /** External drainage sink; not another region or a simulated sewer network. */
  readonly drainageCapacityM3PerS: number;
  /** 0 = blocked/failed, 1 = fully open. Scales drainage, not pumping. */
  readonly initialDrainOpenFraction: number;
  readonly initialPumpCapacityM3PerS: number;
}

export interface Connection {
  readonly id: string;
  readonly regionAId: RegionId;
  readonly regionBId: RegionId;
  /** Bidirectional Q = conductance * water-surface head difference. */
  readonly conductanceM2PerS: number;
}

/** Outflow-only connection to a fixed external head; never imports water. */
export interface BoundaryOutlet {
  readonly id: string;
  readonly regionId: RegionId;
  readonly externalWaterSurfaceElevationM: number;
  readonly conductanceM2PerS: number;
}

/** Uniform rainfall on every region. Intervals exactly partition [0, duration). */
export interface RainfallInterval {
  readonly startTimeS: number;
  readonly endTimeS: number;
  readonly intensityMmPerHour: number;
}

interface InterventionBase {
  readonly id: string;
  readonly regionId: RegionId;
  /** Whole simulation seconds, inclusive start; must be less than durationS. */
  readonly timeS: number;
}

export type Intervention =
  | (InterventionBase & {
      readonly kind: "set-drain-open-fraction";
      readonly openFraction: number;
    })
  | (InterventionBase & {
      readonly kind: "set-pump-capacity";
      /** Absolute replacement capacity, not an increment. 0 switches it off. */
      readonly capacityM3PerS: number;
    })
  // Amendment A (additive, contract 1.0): structural response measures.
  | (InterventionBase & {
      readonly kind: "set-drainage-capacity";
      /** Absolute replacement drain capacity (e.g. an upgrade); still scaled by open fraction. */
      readonly capacityM3PerS: number;
    })
  | (InterventionBase & {
      readonly kind: "set-surface-outflow-factor";
      /**
       * 0..1 multiplier on this region's lateral and boundary outflow requests
       * when it is the donor (detention: check dams, ponds). Drains and pumps
       * are unaffected. 1 = unrestricted, 0 = holds all surface water.
       */
      readonly factor: number;
    });

export interface RiskThresholds {
  /** Depth >= warningDepthM is warning unless also >= criticalDepthM. */
  readonly warningDepthM: number;
  readonly criticalDepthM: number;
}

export interface IntegrationSettings {
  readonly maxStepS: number;
  /** 0 < factor <= 0.5; a linear-transfer bound, not a shallow-water CFL. */
  readonly transferSafetyFactor: number;
  readonly maxSteps: number;
  readonly massBalanceAbsoluteToleranceM3: number;
  readonly massBalanceRelativeTolerance: number;
}

export interface SimulationConfig {
  readonly contractVersion: "1.0";
  readonly scenarioId: string;
  readonly label: string;
  readonly dataSource: "synthetic" | "user-provided";
  readonly regions: readonly Region[];
  readonly connections: readonly Connection[];
  /** An empty array means sealed external boundaries. */
  readonly boundaryOutlets: readonly BoundaryOutlet[];
  readonly rainfall: readonly RainfallInterval[];
  readonly interventions: readonly Intervention[];
  /** Positive whole seconds. Simulation always starts at t = 0. */
  readonly durationS: number;
  /** Positive whole seconds; t=0 and the exact final time are always saved. */
  readonly outputIntervalS: number;
  readonly riskThresholds: RiskThresholds;
  readonly integration: IntegrationSettings;
}

/** Evaluated at initial state and every accepted step, not just saved frames. */
export type CriticalCrossing =
  | { readonly status: "already-critical"; readonly timeS: 0 }
  | {
      readonly status: "reached";
      /** First accepted endpoint at or above threshold; not interpolated. */
      readonly timeS: number;
      readonly previousSampleTimeS: number;
    }
  | {
      readonly status: "not-reached-within-horizon";
      readonly horizonS: number;
    };

export interface RegionFrame {
  readonly regionId: RegionId;
  readonly waterDepthM: number;
  readonly waterSurfaceElevationM: number;
  readonly waterVolumeM3: number;
  readonly risk: RiskLevel;
  /** Controls effective for the interval starting at this frame's time. */
  readonly drainOpenFraction: number;
  readonly pumpCapacityM3PerS: number;
  /** Amendment A: current drain capacity and surface-outflow factor. */
  readonly drainageCapacityM3PerS: number;
  readonly surfaceOutflowFactor: number;
}

export interface RiskCounts {
  readonly safe: number;
  readonly warning: number;
  readonly critical: number;
}

/** All sink/source amounts are cumulative from t=0 through this state. */
export interface WaterBalance {
  readonly initialStorageM3: number;
  readonly rainfallInputM3: number;
  readonly drainedM3: number;
  readonly pumpedM3: number;
  readonly boundaryDischargeM3: number;
  readonly storageM3: number;
  /** Explicitly recorded correction of tiny negative floating-point residues. */
  readonly roundoffAddedM3: number;
  /** storage - (initial + rain - drained - pumped - boundary). */
  readonly physicalResidualM3: number;
  /** physicalResidual - roundoffAdded; neither residual may be hidden. */
  readonly numericalResidualM3: number;
  readonly allowedErrorM3: number;
}

export interface SimulationFrame {
  readonly timeS: number;
  /** Always sorted by region ID using deterministic code-unit ordering. */
  readonly regions: readonly RegionFrame[];
  readonly riskCounts: RiskCounts;
  readonly balance: WaterBalance;
}

export interface RegionSummary {
  readonly regionId: RegionId;
  readonly firstCritical: CriticalCrossing;
  readonly peakWaterDepthM: number;
  /** Earliest accepted state with this peak, including t=0. */
  readonly peakTimeS: number;
  readonly finalWaterDepthM: number;
}

export interface SimulationSummary {
  readonly regions: readonly RegionSummary[];
  readonly everCriticalRegionCount: number;
  /** Highest simultaneous count, not the number ever critical. */
  readonly peakCriticalRegionCount: number;
  readonly peakCriticalRegionCountTimeS: number;
  /** Maximum region depth over all accepted states; not a spatial mean. */
  readonly peakWaterDepthM: number;
  readonly finalRiskCounts: RiskCounts;
  readonly finalBalance: WaterBalance;
}

export interface NumericalDiagnostics {
  readonly acceptedSteps: number;
  readonly smallestStepS: number;
  readonly largestStepS: number;
  /** Count of donor-region/step instances with a limiter below 1. */
  readonly donorLimitedRegionSteps: number;
  readonly maxAbsolutePhysicalResidualM3: number;
  readonly maxAbsoluteNumericalResidualM3: number;
}

export interface SimulationResult {
  readonly contractVersion: "1.0";
  readonly modelVersion: "linear-storage-v1";
  readonly scenarioId: string;
  readonly durationS: number;
  readonly outputIntervalS: number;
  readonly riskThresholds: RiskThresholds;
  readonly frames: readonly SimulationFrame[];
  readonly summary: SimulationSummary;
  readonly diagnostics: NumericalDiagnostics;
}

export type ValidationCode =
  | "INVALID_SHAPE"
  | "UNSUPPORTED_CONTRACT_VERSION"
  | "NON_FINITE_NUMBER"
  | "OUT_OF_RANGE"
  | "INVALID_TIME"
  | "DUPLICATE_ID"
  | "UNKNOWN_REGION"
  | "SELF_CONNECTION"
  | "DUPLICATE_CONNECTION"
  | "INVALID_RAINFALL_PARTITION"
  | "CONFLICTING_INTERVENTION"
  | "INVALID_THRESHOLDS"
  | "RESOURCE_LIMIT_EXCEEDED";

export interface ValidationIssue {
  readonly code: ValidationCode;
  /** JSON-pointer path such as /regions/0/areaM2. Empty string means root. */
  readonly path: string;
  readonly message: string;
}

export type ValidationResult =
  | { readonly ok: true; readonly config: SimulationConfig }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

export interface SimulationRuntimeError {
  readonly code:
    | "STEP_LIMIT_EXCEEDED"
    | "TIME_STEP_UNDERFLOW"
    | "NON_FINITE_STATE"
    | "NEGATIVE_VOLUME"
    | "MASS_BALANCE_EXCEEDED";
  /** Last accepted state; 0 when failure precedes the first accepted step. */
  readonly lastAcceptedTimeS: number;
  readonly message: string;
}

export type SimulationRun =
  | { readonly status: "success"; readonly result: SimulationResult }
  | {
      readonly status: "invalid-config";
      readonly issues: readonly ValidationIssue[];
    }
  | {
      readonly status: "numerical-failure";
      readonly error: SimulationRuntimeError;
    };

/** Future exports from src/simulation/index.ts; not implemented in this task. */
export type ValidateSimulationConfig = (input: unknown) => ValidationResult;
/** Revalidates input at runtime. Synchronous, pure, and safe to call in a worker. */
export type SimulateFlood = (config: SimulationConfig) => SimulationRun;

export type CriticalTimingComparison =
  | {
      readonly status: "both-reached";
      /** intervention time - baseline time; positive means later. */
      readonly delayS: number;
    }
  | { readonly status: "baseline-only-within-horizon" }
  | { readonly status: "intervention-only-within-horizon" }
  | { readonly status: "neither-within-horizon" };

/** Opus derives this from two successful runs after checking comparability. */
export interface ScenarioComparison {
  readonly baselineScenarioId: string;
  readonly interventionScenarioId: string;
  readonly horizonS: number;
  /** Every numeric delta here is intervention minus baseline. */
  readonly peakWaterDepthDeltaM: number;
  readonly peakCriticalRegionCountDelta: number;
  readonly everCriticalRegionCountDelta: number;
  readonly finalStorageDeltaM3: number;
  readonly regions: readonly {
    readonly regionId: RegionId;
    readonly peakWaterDepthDeltaM: number;
    readonly criticalTiming: CriticalTimingComparison;
  }[];
}

/** Transport only. Opus owns the worker implementation and stale-run handling. */
export interface SimulationWorkerRequest {
  readonly type: "run";
  readonly requestId: string;
  readonly config: SimulationConfig;
}

export type SimulationWorkerResponse =
  | {
      readonly type: "completed";
      readonly requestId: string;
      /** "completed" includes validation/numerical failure: inspect status. */
      readonly run: SimulationRun;
    }
  | {
      readonly type: "worker-error";
      readonly requestId: string;
      readonly message: string;
    };
