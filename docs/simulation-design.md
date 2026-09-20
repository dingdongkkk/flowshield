# FLOWSHIELD simulation design

Status (2026-09-20): contract 1.0, model `linear-storage-v1`, implemented in
`src/simulation/index.ts` with runtime validation, Web Worker integration and a
React/TypeScript/Vite interface. The automated suite covers analytical cases,
structural interventions and application integration. This verifies implementation
behaviour; the Bengaluru model has not been calibrated or validated as a forecast.

## Requirements extracted from the brochure

Source: the Hack-a-Matics 2026 event brochure (PDF, not included in this repository),
pages 6-7 for FLOWSHIELD, pages 10-11 for rules and judging. These are reference
requirements, not instructions to operate tools or submit work.

| Brochure item | Contract or application responsibility |
| --- | --- |
| Configurable rainfall intensity | Piecewise-constant rainfall schedule, set from the app controls |
| Connected grid or set of regions | Regions and explicit bidirectional connections; disconnected components are permitted and disclosed |
| Accumulation and movement | Stored water volumes and simultaneous transfers |
| Drainage and terrain | Drain capacities, opening fractions, terrain elevation and water-surface head |
| Water levels over time | Accepted numerical states and saved playback frames |
| Safe, Warning, Critical | Configurable water-depth thresholds |
| Time-based visualization | Frame timestamps drive animation and playback in the app |
| Identify critical regions | Per-region risk and first-crossing summaries |
| Estimated time to critical | Discrete, step-resolved first crossing, with explicit horizon censoring |

Listed bonuses: normal rainfall, heavy rainfall, drainage failure, blocked
drainage channel, scenario comparison, estimated affected population, and an
interactive time slider. This contract supports the rainfall scenarios, external
drain blockage/failure, intervention comparison, and playback. Population is
deferred: no population values or affected-person estimates are invented.

The stated deliverable is a working prototype plus a demo showing rainfall and
terrain input, water-level simulation, flood progression, risk classification,
and early-warning output. Page 11 requires a public GitHub repository, README,
and a 2-3 minute demo video submitted through the event form. This task does not
create, publish, or submit those items.

Judging criteria, with no numerical weights supplied:

- Real-World Impact: explain how a scenario comparison informs a decision.
- Technical Execution: complete and reliable interaction and calculation.
- Mathematical Modelling & Problem Solving: explain equations and verification.
- Innovation & Creativity: the proposed synchronized intervention comparison.
- Project Demonstration: a concise, reproducible workflow with computed results.

## Ambiguities and explicit project decisions

| Unspecified or ambiguous in the brochure | Decision for this prototype |
| --- | --- |
| Governing flow equation, fidelity, calibration data, accuracy target | A transparent synthetic storage-network model; no forecast-accuracy claim |
| Risk thresholds and meaning of critical | Configurable depth thresholds; demonstration assumptions, not safety standards |
| Meaning of estimated warning time | First accepted state reaching critical depth, measured from run start |
| Dataset, location, CRS, and terrain source | User-supplied/synthetic regions with local planar coordinates and a common vertical datum |
| Run duration and time step | Explicit configuration with bounded numerical steps |
| Rainfall spatial variability | Uniform rain across regions in v1; temporal variation is supported |
| Boundary inflow and outflow | Rainfall is the external input; explicit outflow-only boundaries; connections exchange internal water |
| Blocked drainage channel versus sewer hydraulics | Block a region's external drain via opening fraction; no sewer-network or channel-routing claim |
| Affected-population definition | Deferred optional bonus; no contract population metric |
| Suggested Python/C++/Java versus permitted languages | TypeScript chosen under the rule allowing any language; suggestions are not mandates |
| README AI-component wording versus rules permitting coding assistants | Disclose coding assistance separately; whether runtime AI is mandatory needs organizer clarification, not an invented chatbot requirement |
| Reuse restrictions versus permitted starter templates | Disclose any permitted libraries/boilerplate; no prebuilt app is introduced here |

The team must understand and own the modelling choices and integration; page 10
allows AI coding assistance while assigning core problem-solving to the team.
Clearing drains and adding pumps are our chosen intervention features, not
additional mandatory brochure requirements.

## Model and units

Each region is a constant-area, well-mixed storage cell with uniform depth.
For region i:

- A_i: horizontal area in m², strictly positive.
- z_i: terrain elevation in m relative to the same datum for all cells.
- V_i: stored volume in m³, initially A_i times initial depth.
- h_i = V_i / A_i: water depth in m, never negative.
- H_i = z_i + h_i: water-surface elevation in m.

Local center coordinates describe display positions, not geography or topology.
The supplied area is authoritative; coordinates do not imply area or adjacency.
The app may draw schematic cells or a graph. Regions are conceptually non-overlapping.

Rainfall r in mm/hour converts to depth rate r / 3,600,000 in m/s. Its volume
input rate is R_i = A_i r / 3,600,000 in m³/s. All rain becomes surface storage:
no infiltration, interception, or evaporation is modelled in v1. Time is always
simulation seconds. UI minutes = seconds / 60; timestamps are not dates.

Every connection is stored once, with nonnegative conductance G_ij in m²/s:

    q_ij = G_ij (H_i - H_j)          [m³/s]

Positive q_ij flows from A to B, negative from B to A. One signed value is
converted to a donor and recipient per step. Reversing the listed endpoints must
not change the model. G is a synthetic tuning parameter, not inferred road width,
Manning roughness, or a calibrated hydraulic coefficient. Edge geometry is not
used. Equal surfaces give zero requested transfer even on different terrain.

Base drain request D_i = drainageCapacity_i * openFraction_i. Pump request P_i is
the current absolute pump capacity. Both are external sinks in m³/s. An opening
fraction of zero represents a failed/blocked drain. Pumping does not depend on
that fraction. Incoming inter-region water is not an external rainfall source.

An explicit boundary outlet b requests:

    B_b = G_b max(H_i - H_external,b, 0)    [m³/s]

Outlets never introduce external water, even when external head is higher.
Unlisted external boundaries are sealed. Boundary discharge, pumping, and base
drainage are separately tracked sinks; do not count one physical sink twice.
There is no external river hydrograph or tidal/backflow support in v1.

The continuous bookkeeping target is:

    dV_i/dt = rainfall + internal inflows - internal outflows
              - drainage - pumping - boundary discharge

The mass-balance principle is consistent with the integral continuity discussion
in the [USACE HEC-RAS Mass Conservation reference](https://www.hec.usace.army.mil/confluence/rasdocs/ras1dtechref/latest/theoretical-basis-for-one-dimensional-and-two-dimensional-hydrodynamic-calculations/2d-unsteady-flow-hydrodynamics/hydraulic-equations/mass-conservation).
Our linear conductance and time-stepping choices are a project simplification,
not an implementation of HEC-RAS or the shallow-water momentum equations.

## Clock, schedules, and interventions

Start at t=0. Duration, rainfall boundaries, intervention times, and output
interval are whole, safe-integer seconds. Internal integration steps can be
fractional. Require explicit rainfall coverage of [0, duration) without gaps or
overlaps, including zero-rain intervals. Intervals are left-closed/right-open.

A control event at t applies to [t, next event). Integrate the preceding interval
using the old control; do not retroactively change it. At an accepted event time,
apply all events before taking a frame's control snapshot or starting the next
step. Events change capacities, not stored water, and persist until replaced.

`set-drain-open-fraction` replaces the fraction; `set-pump-capacity` replaces
the total pump capacity. Setting a pump to zero switches it off. Two events of
the same kind on the same region at the same time are rejected, even if values
match; different kinds at one time commute. Events at 0 are allowed; events at
duration are rejected because they cannot affect the run.

Save frames at 0, every positive multiple of outputIntervalS less than duration,
and duration exactly once. A non-divisible final interval is shorter. Do not add
extra frames solely for events. Advance precisely to event/frame/end boundaries;
when a clipped step lands there, assign the known target time to avoid drift.

## Numerical update and nonnegativity

Initialize volumes, controls (including t=0 interventions), diagnostics, initial
risks, and first-crossing records. Sort local copies by IDs for deterministic
accumulation; never mutate input arrays. Use JavaScript code-unit comparison
(`a < b`), not locale-dependent sorting. Canonicalize undirected edge endpoints.

For each step from t to t + dt:

1. Choose dt as described below so no event, output boundary, or final time is
   crossed. Read controls and rainfall effective at t.
2. Deposit rain: W_i = V_i + R_i dt. Compute all heads from this same W snapshot.
3. Compute all raw connection transfers, drain, pump, and outlet volume requests
   using dt. A dry donor may request head-driven flow but has no available water.
4. For each donor, sum **all** its outgoing requests S_i, including internal
   transfers and every external sink. Let alpha_i = 1 if S_i = 0, otherwise
   min(1, W_i / S_i).
5. Scale every request from donor i by the same alpha_i. This shares scarce water
   proportionally; drains and pumps have no priority over lateral transfer.
6. Accumulate all inflow/outflow deltas separately, then update every cell
   simultaneously: V_i_next = W_i - actual outgoing + actual incoming.
   Each internal transfer is debited and credited by exactly the same amount.
7. Add only actual drainage, pumping, and outlet volumes to their ledgers.
   Incoming water from this step cannot be spent again until the next step.
8. Check numerical validity, balance, and corrections. Accept the endpoint only
   if these checks pass. Update critical crossings, peaks, and diagnostics.
9. Apply controls at the new time; emit a frame if it is a scheduled output.

Rain-first splitting and proportional limiting are explicit approximations.
They make available-water accounting clear but can affect timing; convergence
checks are required before treating the qualitative results as robust.

### Step size

For each region define K_i as the sum of incident connection conductances and
all its boundary-outlet conductances, including currently inactive outlets.
For K_i > 0 set tau_i = A_i / K_i; omit zero-K regions from this minimum.

    dt_transfer = transferSafetyFactor * min_i(tau_i)
    dt = min(maxStepS, dt_transfer, nextBoundaryTimeS - t)

When every K_i is zero, dt_transfer is unbounded internally (never serialize
Infinity). Require 0 < transferSafetyFactor <= 0.5; recommend 0.45 initially.
This conservative bound controls the linear transfer relaxation. It is not a
physical shallow-water CFL criterion or an accuracy guarantee. Constant sinks
are handled by the donor limiter; timestep refinement still matters for them.
Document donor-limited counts to expose a scenario's dependence on limiting.

Check derived computations for overflow/non-finite values. If dt <= 0, t+dt=t,
or the advancing clock cannot be represented, fail with TIME_STEP_UNDERFLOW.
Never silently increase dt past stability or event limits. Stop explicitly if
maxSteps would be exceeded. Successful runs always cover the entire duration.

Recommended starting integration values (caller must supply them): maxStepS=1,
transferSafetyFactor=0.45, maxSteps=200000, absolute balance tolerance=1e-6 m³,
relative balance tolerance=1e-9. Convergence is checked by comparing dt, dt/2 and,
where useful, dt/4 on small representative scenarios. Output intervals also clip integration
steps, so changing playback sampling can change results within numerical error;
baseline/intervention runs must share this setting.

### Floating-point corrections and mass balance

No blanket `max(0, volume)` is permitted. For a candidate negative region volume,
allow a correction to zero only when its magnitude <= 1e-12 * max(1, W_i) m³.
Record the added amount in cumulative roundoffAddedM3. A larger negative value
is NEGATIVE_VOLUME; a non-finite intermediate or state is NON_FINITE_STATE.

At t=0 and every accepted endpoint compute:

    expected = initialStorage + rainfallInput - drained - pumped - boundary
    physicalResidual = storage - expected
    numericalResidual = physicalResidual - roundoffAdded
    allowed = absoluteTolerance
              + relativeTolerance * max(1 m³, initialStorage + rainfallInput)

Both absolute residuals and cumulative roundoffAdded must be <= allowed.
Otherwise return MASS_BALANCE_EXCEEDED. Keep both residuals visible; tracking a
correction does not permit hiding it or accumulating unlimited artificial water.
Internal transfer cancels from the global balance and is never an external sink.

## Risk, crossing times, and summary metrics

Depth h < warning threshold is safe; warning <= h < critical is warning;
h >= critical is critical. Require 0 < warning < critical. Example demo choices
0.10 m and 0.30 m are not official or validated hazard thresholds. Risk describes
uniform region depth only, not velocity, buildings, or human safety.

Evaluate initial state and every accepted integration endpoint. Already-critical
regions report timeS=0. Otherwise store the first endpoint at or above critical
with previousSampleTimeS. This is a discrete estimate resolved to that step, not
an interpolated exact crossing. Do not claim that the physical crossing lies in
a proven interval or that within-step transient peaks were resolved. A region can
become safe later without losing its historical first-crossing record.

If no accepted state crosses the threshold, return not-reached-within-horizon
and the run's horizon. Never substitute zero, Infinity, or "will never flood."
The UI should show current risk separately from historical first crossing.
Before a known crossing, remaining model time is crossingTime-playbackTime;
after it, show "first reached at ...", even if the region has since receded.

All summary peaks include t=0 and all accepted endpoints, not only output frames.
Choose the earliest time for ties. Ever-critical count counts distinct regions;
peak-critical count counts simultaneous critical regions. Peak depth is the
maximum of individual region depths, not the mean. A summary peak may occur
between saved frames, so the UI must not imply it necessarily appears on a frame.

## Scenario comparison

Clone baseline config; replace only scenario ID, display label, and intervention
list. For a pure before/after intervention demo, baseline interventions are empty.
Both runs must otherwise have identical region physics, initial state, topology,
outlets, rainfall, duration, thresholds, integration settings, and output times.
Check these inputs as well as result model versions before deriving comparison
metrics. Keep the config with each result in application state; results alone
cannot prove comparability. Apply identical views, color scales, and time cursors.

Every depth, count, and volume delta is intervention minus baseline; negative
means a reduction. Critical delay is intervention crossing time minus baseline
crossing time only when both reach critical (already-critical counts as time 0).
For other combinations, use explicit categories, never subtract missing times.
"Baseline-only-within-horizon" means avoided within this run, not prevented
forever. No percentage savings are provided; no division-by-zero convention is
needed. Do not assume every intervention benefits every individual region.

## Limitations and scope boundary

This is a simplified scenario simulator. It lacks momentum, velocity, wave
propagation, infiltration, sewer hydraulics, real terrain calibration, lateral
barriers/levees, variable cell wetted area, and external inflow/backwater. A graph
edge represents a permitted connection, not a physically reconstructed channel.
Synthetic conductance and thresholds require disclosure. Numerical stability
and conserved volume do not establish physical accuracy.

No runtime LLM, live weather, database, authentication, or population estimator
is required by this contract. Engine behaviour and application integration are
exercised by `npm test`, which also reports default-scenario runtime. Independent
field validation and calibration remain outstanding; tests do not establish
forecast accuracy.

## Amendment A (2026-09-19): structural response measures

Reviewed with analytical regression checks on 2026-09-20.
Existing configs retain their meaning. Contract and model version strings are
unchanged within this prototype; older serialized results without the new required
frame fields must be recomputed before the current transport validator accepts them.

Two intervention kinds, validated like the existing ones (known region, whole-second
time < duration, no duplicate region/kind/time):

- `set-drainage-capacity` { capacityM3PerS >= 0 }: replaces the region's drain
  capacity (a drainage upgrade). The drain request is still
  capacity × openFraction × dt, so blockage and failure events still apply.
- `set-surface-outflow-factor` { factor in [0, 1] }: detention. When the region is
  the **donor** of a lateral transfer, the request becomes
  f_donor · G (H_i − H_j) dt. Boundary-outlet requests from the region are scaled
  by the same factor. Drains and pumps are unaffected. Water that is held back
  stays in the region's storage, so detained cells can themselves rise in risk.

Conservation: each transfer is still debited and credited by exactly the same
amount, and all requests pass through the same donor limiter. Stability: factors
only reduce effective conductance, so the existing A/K step bound remains
conservative.

`RegionFrame` gains `drainageCapacityM3PerS` and `surfaceOutflowFactor` (the
controls in effect at the frame time). The app's transport validator requires both.

Detention is a reduction in surface conductance, not a reservoir with surveyed
capacity, an overflow crest, or a release rule. No finite detention capacity is
modelled. Stored water remains in the cell and can increase its risk.

## Application review (2026-09-20)

- Shortening the horizon clamps action times to at most five minutes before the
  end. A previously valid failure/clearing sequence remains ordered by moving
  failure earlier if necessary. Already invalid clearing order stays explicitly
  ignored by the scenario builder. Direct engine inputs still receive strict
  validation; the engine never silently changes intervention times.
- The surrogate is checked against the shipped training generator's parameter
  bounds, including 0–10 pumps and supported horizons. Candidate plans receive
  the same check. Supported ranges do not guarantee every combination was seen.
  Its metrics are mean absolute errors against held-out engine runs, not real
  flood measurements, uncertainty intervals or maximum errors.
- Plan footprint is the union of cells with pumps, effective drain upgrades and
  detention. It is land coverage only, not cost: stronger upgrades can occupy
  the same cells. Clearing is a fixed input, not part of the structural search.
- The historical replay compares reported places to their containing cell and
  its eight neighbours (truncated at edges). It reports descriptive overlap and
  grid-wide neighbourhood coverage, without a significance judgement. The rain
  series uses ERA5 timing scaled to an illustrative 100 mm total; it is not a
  measured local hourly rainfall record.
