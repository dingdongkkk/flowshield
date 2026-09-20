# FLOWSHIELD agent handoff

Contract: 1.0. Model: `linear-storage-v1`. Read
[simulation-design.md](simulation-design.md) and
[simulation.ts](../src/shared/simulation.ts) when modifying the implementation.

> **Amendment A (2026-09-19):** two intervention kinds (`set-drainage-capacity`,
> `set-surface-outflow-factor`) and two `RegionFrame` fields were added. See
> "Amendment A" in [simulation-design.md](simulation-design.md). Reviewed on 2026-09-20;
> analytical tests cover both controls. Fixtures must include the new frame fields.

## Current state and ownership

The engine, validator, worker, frontend, Bengaluru data pipeline, replay and AI
surrogate are implemented. `npm test` runs 21 engine and integration checks.
The prototype has no field-calibrated drainage capacities or validated forecasts.

| Owner | Files / responsibilities |
| --- | --- |
| Astra | `src/simulation/**`, `docs/simulation-design.md`, engine algorithm and numerical failures |
| Astra, coordinating changes | `src/shared/simulation.ts`, `docs/agent-handoff.md`; inform both other agents before changing the contract |
| Opus | App scaffolding, package/lock/tsconfig files, `src/app/**`, `src/components/**`, `src/workers/**`, entry points/styles, comparison derivation and integration |
| Sol | `tests/**`, `fixtures/**`, `docs/verification.md`, README/demo/submission documentation |

These responsibilities guide future coordination; the current user-authorized
review fixes span the app and engine tests. Use one package manager; Opus coordinates tooling
dependencies requested by Sol. Do not overwrite another agent's active changes.
There is no need for another agent to implement a competing simulation engine.

## Entry points and transport

The engine exports the following from `src/simulation/index.ts`:

```ts
import type {
  SimulateFlood,
  ValidateSimulationConfig,
} from "../shared/simulation";

// Signatures of the implemented exports (declarations shown for reference).
declare const validateSimulationConfig: ValidateSimulationConfig;
declare const simulateFlood: SimulateFlood;
export { validateSimulationConfig, simulateFlood };
```

Validation accepts unknown JSON/structured-clone data, returns a canonical copy
on success, and never mutates the source. `simulateFlood(config)` revalidates at
runtime and returns a `SimulationRun` discriminated union. Expected invalid data
and numerical problems return structured failures, not thrown exceptions. An
unexpected programming/worker failure is caught at the worker boundary and
reported as `worker-error`; never silently converted to a successful empty run.

The engine is synchronous, deterministic, and independent of DOM/React/network.
The worker receives `{type:"run", requestId, config}` and posts
`{type:"completed", requestId, run}`. All values use arrays, plain objects, and
finite numbers: no Map, Set, Date, typed array, function, or Infinity in messages.
Transport-envelope validation is Opus's responsibility. TypeScript alone is not
runtime validation.

Opus must inspect `run.status`; a completed message may be an invalid config or
numerical failure. Worker errors/crashes must surface as application errors.
Cancel by terminating the busy worker and creating another. A synchronous engine
cannot process a queued cancel message while running. Tag requests and ignore
stale replies after reset or a newer run. Use separate request IDs for comparison
sides; do not compare results belonging to different input revisions. No progress
streaming or partial-success result is promised in v1.

For each result, retain its input config and compare against the current form
state. Mark old results stale after edits. Import shared types with `import type`;
this module deliberately exports no functions or runtime enum objects. Do not
import `simulateFlood` until Astra supplies its module; temporary UI fixtures
must be explicitly identified and replaced during integration.

## Normative validation rules

All config properties in the TypeScript interfaces are required. No implicit
physical defaults. Reject null/incorrect types and non-finite numbers. IDs and
labels must be nonempty trimmed strings; do not silently change an ID. Unknown
object keys are rejected as INVALID_SHAPE to catch spelling mistakes. Arrays may
arrive in any order; validate first and sort a copy. Issues carry a JSON-pointer
path and stable code; human-readable message text is not an API identifier.

| Data | Required validation |
| --- | --- |
| contractVersion | Exactly `1.0` |
| dataSource | `synthetic` or `user-provided`; not a claim of validated accuracy |
| IDs | Unique within regions, connections, outlets, and interventions respectively; duplicates across these different namespaces are allowed |
| Regions | At least one; area > 0; depth, drain capacity, pump capacity >= 0; open fraction in [0,1]; finite terrain and x/y, which may be negative |
| Connections | Known, distinct endpoints; nonnegative finite conductance; at most one edge per unordered region pair, including zero-conductance edges |
| Outlets | Known region, finite external elevation, conductance >= 0; multiple named outlets per region are permitted and add their requested flows |
| Clock | Duration and output interval are positive safe integers in seconds; output interval may exceed duration |
| Rainfall | Nonempty; nonnegative intensity; start/end are nonnegative safe integers; end > start; sorted intervals exactly tile [0,duration) |
| Interventions | Known region and supported kind; nonnegative safe-integer time < duration; open fraction [0,1] or absolute pump capacity >= 0; reject duplicate (region,kind,time) |
| Thresholds | Finite 0 < warningDepthM < criticalDepthM |
| Integration | maxStepS > 0; 0 < transferSafetyFactor <= 0.5; maxSteps positive safe integer; absolute tolerance > 0; relative tolerance >= 0 |

V1 implementation guardrails (engineering limits, not brochure mandates):

- At most 400 regions, 1600 connections, 800 outlets, 1000 rainfall intervals,
  and 1000 interventions. Disconnected graphs and one-region fixtures are valid.
- Duration <= 86400 seconds; maxSteps <= 1000000.
- At most 200000 saved region states. Number of frames is
  `ceil(durationS/outputIntervalS) + 1`, including the exact final frame; multiply
  by region count. Reject RESOURCE_LIMIT_EXCEEDED before allocating output.
- Reject a config with RESOURCE_LIMIT_EXCEEDED if even
  `ceil(durationS/maxStepS) > maxSteps`. Conductance/events can require more steps;
  reaching that limit during execution is STEP_LIMIT_EXCEEDED.
- Guardrails bound storage and steps, not a wall-clock performance promise. Opus
  owns cancellation. Revisit limits together after measuring representative runs.

Validation produces at least one actionable issue for invalid input. Order issues
deterministically by path then code, using code-unit ordering. Shape errors should
prevent unsafe traversal, not trigger exceptions. Return canonical copies with
regions/outlets/connections sorted by ID, connection endpoints canonicalized by
region ID, rainfall sorted by start, and events by time then region, kind, ID.

No meaningful upper bound on physical inputs is invented. Finite but extreme
inputs may overflow derived calculations: report NON_FINITE_STATE rather than
NaN, a fabricated result, or an unreported numerical repair.

## Output semantics and failures

- Frames run from t=0 to duration, inclusive; regions and region summaries are
  sorted by code-unit ID. Every region appears exactly once in each frame.
- Risk counts sum to region count. Volume=area*depth and surface=terrain+depth.
- Frame controls are effective at that timestamp; an event changes future flows,
  not past storage. The last control persists in the final frame.
- Summary peaks and first crossings inspect all accepted endpoints, not only
  frames. Endpoint time is numerical resolution, not a precise physical forecast.
- `firstCritical.status` distinguishes already critical, reached, and not reached
  within horizon. Do not display a missing time as 0 or Infinity.
- For a reached crossing, previousSampleTimeS < timeS; all earlier accepted states
  were below threshold. Do not infer unresolved within-step behavior.
- Numerical failures carry the last accepted time and no partial successful
  result. Opus should offer input adjustment and rerun, not plot a full-horizon
  result using old or partial data.
- WaterBalance fields are cumulative. Both residuals and roundoff additions are
  visible; NumericalDiagnostics records their largest absolute values across
  all accepted states. Initial state is included in these maxima.
- `smallestStepS`/`largestStepS` summarize accepted steps; duration > 0 ensures
  successful runs have at least one. Initial-state summaries choose t=0 on ties.

## Small example input and illustrative output

The following TypeScript snippet is a contract fixture, **not engine output**.
Its hand-specified values describe a trivial sealed one-cell, no-rain case solely
to show the complete shape. No simulator has been run. Mark it illustrative in
any temporary UI; do not use it as a claimed flood prediction or demo result.

```ts
import type {
  SimulationConfig,
  SimulationRun,
  SimulationFrame,
  WaterBalance,
} from "../src/shared/simulation";

export const exampleInput = {
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

const illustrativeBalance = {
  initialStorageM3: 2, rainfallInputM3: 0, drainedM3: 0,
  pumpedM3: 0, boundaryDischargeM3: 0, storageM3: 2,
  roundoffAddedM3: 0, physicalResidualM3: 0, numericalResidualM3: 0,
  allowedErrorM3: 0.000001002,
} as const satisfies WaterBalance;

const illustrativeInitialFrame = {
  timeS: 0,
  regions: [{
    regionId: "r1", waterDepthM: 0.02, waterSurfaceElevationM: 10.02,
    waterVolumeM3: 2, risk: "safe", drainOpenFraction: 1,
    pumpCapacityM3PerS: 0,
  }],
  riskCounts: { safe: 1, warning: 0, critical: 0 },
  balance: illustrativeBalance,
} as const satisfies SimulationFrame;

export const illustrativeRun = {
  status: "success",
  result: {
    contractVersion: "1.0", modelVersion: "linear-storage-v1",
    scenarioId: exampleInput.scenarioId, durationS: 60, outputIntervalS: 60,
    riskThresholds: exampleInput.riskThresholds,
    frames: [illustrativeInitialFrame, { ...illustrativeInitialFrame, timeS: 60 }],
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
      finalBalance: illustrativeBalance,
    },
    diagnostics: {
      acceptedSteps: 1, smallestStepS: 60, largestStepS: 60,
      donorLimitedRegionSteps: 0,
      maxAbsolutePhysicalResidualM3: 0, maxAbsoluteNumericalResidualM3: 0,
    },
  },
} as const satisfies SimulationRun;

// A real comparison would run this config separately with the engine.
// It is intentionally not a compelling intervention demo: there is no rain.
export const exampleInterventionInput = {
  ...exampleInput,
  scenarioId: "shape-example-pump",
  label: "Illustrative pump configuration",
  interventions: [{
    id: "pump-on", kind: "set-pump-capacity", regionId: "r1",
    timeS: 30, capacityM3PerS: 0.001,
  }],
} as const satisfies SimulationConfig;
```

Example validation failure shape (also illustrative):

```json
{
  "status": "invalid-config",
  "issues": [{
    "code": "OUT_OF_RANGE",
    "path": "/regions/0/areaM2",
    "message": "Region area must be greater than zero."
  }]
}
```

## Integration and next steps (2026-09-20)

The app, request-ID handling, comparison derivation and engine are implemented.
Keep shared timestamps/scales and retain both configs for comparison. Respect
all critical-timing categories, including already-critical as a reached time of 0.

The review fixes include horizon normalization in `withScenarioHorizon`, unique
structural cell coverage in `responseFootprint`, surrogate range checks for both
estimates and searched plans, and descriptive replay reporting. The AI weights
were not retrained and the physical equations were not changed. Use engine
results to verify candidate plans; an AI range check does not establish accuracy.

`npm test` exercises 21 engine and integration cases, including analytical rain
conversion, equilibrium, shared scarce water, event timing, conservation,
convergence, critical crossing semantics, structured failures, default Bengaluru
comparison, horizon changes, AI limits, unique footprints, timed drainage
upgrades, detention/release and invalid intervention controls. `npm run build`
checks the full TypeScript application and produces the Vite build.

Independent field verification remains outstanding. Lake storage and upstream
inflows are the main next modelling extension; mapped geometry alone does not
supply storage curves, measured levels or discharge schedules. Do not invent
those quantities or label scenario assumptions as calibrated values.

Use the existing presets and read actual results and water-balance diagnostics
before interpreting improvements. The human team should be able to explain:
"Rain adds volume according to an explicit schedule; water moves down a
surface-height difference; outgoing requests share the water available; drains,
pumps and boundary exports are tracked; risk is a configurable threshold."

## Current verification

- `npm test`: 21 checks pass, including the new regression cases.
- `npm run build`: TypeScript and Vite pass. The lazy map bundle still produces
  a size warning; it is not a build failure.
- Browser checks cover shortening a horizon after late deployment, pump counts
  outside AI support, and the exploratory replay wording.
- These checks establish implementation behaviour, not real-world forecasting
  validity. The demo script and model notes describe the remaining limits.
