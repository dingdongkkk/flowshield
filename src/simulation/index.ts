import type {
  CriticalCrossing,
  RiskCounts,
  RiskLevel,
  SimulateFlood,
  SimulationConfig,
  SimulationFrame,
  SimulationResult,
  SimulationRuntimeError,
  WaterBalance,
} from "../shared/simulation";
import { validateSimulationConfig } from "./validation";

export { validateSimulationConfig } from "./validation";

class NumericalFault extends Error {
  constructor(readonly code: SimulationRuntimeError["code"], message: string) {
    super(message);
  }
}

function finite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new NumericalFault("NON_FINITE_STATE", `${name} is not finite; reduce extreme input magnitudes.`);
  return value;
}

/** Compensated source/sink accumulation keeps long-run water balance observable. */
class Ledger {
  value = 0;
  private correction = 0;
  add(amount: number): void {
    finite(amount, "Ledger addition");
    const corrected = amount - this.correction;
    const next = finite(this.value + corrected, "Cumulative ledger");
    this.correction = (next - this.value) - corrected;
    this.value = next;
  }
}

function sum(values: ArrayLike<number>): number {
  const total = new Ledger();
  for (let i = 0; i < values.length; i += 1) total.add(values[i]!);
  return total.value;
}

function risk(depth: number, config: SimulationConfig): RiskLevel {
  return depth >= config.riskThresholds.criticalDepthM ? "critical"
    : depth >= config.riskThresholds.warningDepthM ? "warning" : "safe";
}

export const simulateFlood: SimulateFlood = (input) => {
  const validation = validateSimulationConfig(input);
  if (!validation.ok) return { status: "invalid-config", issues: validation.issues };
  const config = validation.config;
  let timeS = 0;
  try {
    const n = config.regions.length;
    const index = new Map(config.regions.map((r, i) => [r.id, i]));
    const edges = config.connections.map((e) => ({
      a: index.get(e.regionAId)!, b: index.get(e.regionBId)!, g: e.conductanceM2PerS,
    }));
    const outlets = config.boundaryOutlets.map((b) => ({
      i: index.get(b.regionId)!, g: b.conductanceM2PerS, head: b.externalWaterSurfaceElevationM,
    }));
    const area = config.regions.map((r) => r.areaM2);
    let volumes = Float64Array.from(config.regions, (r) => finite(r.areaM2 * r.initialWaterDepthM, "Initial volume"));
    const openings = config.regions.map((r) => r.initialDrainOpenFraction);
    const pumps = config.regions.map((r) => r.initialPumpCapacityM3PerS);
    const drainCapacity = config.regions.map((r) => r.drainageCapacityM3PerS);
    const outflowFactor = config.regions.map(() => 1);
    const conductance = new Float64Array(n);
    for (const e of edges) {
      conductance[e.a] = finite(conductance[e.a]! + e.g, "Incident conductance");
      conductance[e.b] = finite(conductance[e.b]! + e.g, "Incident conductance");
    }
    for (const b of outlets) conductance[b.i] = finite(conductance[b.i]! + b.g, "Outlet conductance");
    let transferStepS = Infinity; // Internal sentinel only; never returned.
    for (let i = 0; i < n; i += 1) {
      if (conductance[i]! > 0) {
        transferStepS = Math.min(transferStepS, config.integration.transferSafetyFactor * (area[i]! / conductance[i]!));
      }
    }
    const initialStorageM3 = sum(volumes);
    const rainLedger = new Ledger();
    const drainLedger = new Ledger();
    const pumpLedger = new Ledger();
    const boundaryLedger = new Ledger();
    const roundoffLedger = new Ledger();
    let acceptedSteps = 0;
    let smallestStepS = Infinity;
    let largestStepS = 0;
    let donorLimitedRegionSteps = 0;
    let maxAbsolutePhysicalResidualM3 = 0;
    let maxAbsoluteNumericalResidualM3 = 0;
    let eventIndex = 0;
    let rainIndex = 0;
    let nextOutputS = Math.min(config.outputIntervalS, config.durationS);
    const frames: SimulationFrame[] = [];
    const initialDepths = config.regions.map((_, i) => finite(volumes[i]! / area[i]!, "Initial depth"));
    const peaks = [...initialDepths];
    const peakTimes = new Array<number>(n).fill(0);
    const crossings: CriticalCrossing[] = initialDepths.map((depth) => depth >= config.riskThresholds.criticalDepthM
      ? { status: "already-critical", timeS: 0 }
      : { status: "not-reached-within-horizon", horizonS: config.durationS });
    let peakCriticalCount = 0;
    let peakCriticalTimeS = 0;

    function applyEvents(): void {
      while (eventIndex < config.interventions.length && config.interventions[eventIndex]!.timeS === timeS) {
        const event = config.interventions[eventIndex++]!;
        const i = index.get(event.regionId)!;
        switch (event.kind) {
          case "set-drain-open-fraction": openings[i] = event.openFraction; break;
          case "set-pump-capacity": pumps[i] = event.capacityM3PerS; break;
          case "set-drainage-capacity": drainCapacity[i] = event.capacityM3PerS; break;
          case "set-surface-outflow-factor": outflowFactor[i] = event.factor; break;
        }
      }
    }

    function balance(storage: Float64Array): WaterBalance {
      const storageM3 = sum(storage);
      const inputM3 = finite(initialStorageM3 + rainLedger.value, "Total input volume");
      const expectedM3 = inputM3 - drainLedger.value - pumpLedger.value - boundaryLedger.value;
      const physicalResidualM3 = finite(storageM3 - expectedM3, "Physical mass residual");
      const numericalResidualM3 = finite(physicalResidualM3 - roundoffLedger.value, "Numerical mass residual");
      const allowedErrorM3 = finite(config.integration.massBalanceAbsoluteToleranceM3
        + config.integration.massBalanceRelativeTolerance * Math.max(1, inputM3), "Balance tolerance");
      if (Math.abs(physicalResidualM3) > allowedErrorM3 || Math.abs(numericalResidualM3) > allowedErrorM3
        || roundoffLedger.value > allowedErrorM3) {
        throw new NumericalFault("MASS_BALANCE_EXCEEDED", `Water-balance error exceeds ${allowedErrorM3} m³ (physical residual ${physicalResidualM3} m³).`);
      }
      maxAbsolutePhysicalResidualM3 = Math.max(maxAbsolutePhysicalResidualM3, Math.abs(physicalResidualM3));
      maxAbsoluteNumericalResidualM3 = Math.max(maxAbsoluteNumericalResidualM3, Math.abs(numericalResidualM3));
      return {
        initialStorageM3, rainfallInputM3: rainLedger.value, drainedM3: drainLedger.value,
        pumpedM3: pumpLedger.value, boundaryDischargeM3: boundaryLedger.value,
        storageM3, roundoffAddedM3: roundoffLedger.value, physicalResidualM3, numericalResidualM3, allowedErrorM3,
      };
    }

    function sample(previousTimeS: number): RiskCounts {
      const counts = { safe: 0, warning: 0, critical: 0 };
      for (let i = 0; i < n; i += 1) {
        const depth = finite(volumes[i]! / area[i]!, "Water depth");
        finite(config.regions[i]!.terrainElevationM + depth, "Water-surface elevation");
        const level = risk(depth, config);
        counts[level] += 1;
        if (depth > peaks[i]!) { peaks[i] = depth; peakTimes[i] = timeS; }
        if (level === "critical" && crossings[i]!.status === "not-reached-within-horizon") {
          crossings[i] = timeS === 0 ? { status: "already-critical", timeS: 0 }
            : { status: "reached", timeS, previousSampleTimeS: previousTimeS };
        }
      }
      if (counts.critical > peakCriticalCount) { peakCriticalCount = counts.critical; peakCriticalTimeS = timeS; }
      return counts;
    }

    function frame(counts: RiskCounts, waterBalance: WaterBalance): SimulationFrame {
      return {
        timeS,
        regions: config.regions.map((r, i) => ({
          regionId: r.id, waterDepthM: volumes[i]! / area[i]!,
          waterSurfaceElevationM: r.terrainElevationM + volumes[i]! / area[i]!,
          waterVolumeM3: volumes[i]!, risk: risk(volumes[i]! / area[i]!, config),
          drainOpenFraction: openings[i]!, pumpCapacityM3PerS: pumps[i]!,
          drainageCapacityM3PerS: drainCapacity[i]!, surfaceOutflowFactor: outflowFactor[i]!,
        })),
        riskCounts: counts, balance: waterBalance,
      };
    }

    applyEvents();
    let counts = sample(0);
    let currentBalance = balance(volumes);
    frames.push(frame(counts, currentBalance));
    const available = new Float64Array(n);
    const heads = new Float64Array(n);
    const requestedOut = new Float64Array(n);
    const incoming = new Float64Array(n);
    const actualOut = new Float64Array(n);
    const alpha = new Float64Array(n);
    const drainRequests = new Float64Array(n);
    const pumpRequests = new Float64Array(n);
    const edgeRequests = new Float64Array(edges.length);
    const boundaryRequests = new Float64Array(outlets.length);

    while (timeS < config.durationS) {
      if (acceptedSteps >= config.integration.maxSteps) throw new NumericalFault("STEP_LIMIT_EXCEEDED", "Step budget exhausted before the end; increase maxSteps or simplify the scenario.");
      while (config.rainfall[rainIndex]!.endTimeS <= timeS) rainIndex += 1;
      const rain = config.rainfall[rainIndex]!;
      const nextEventS = config.interventions[eventIndex]?.timeS ?? config.durationS;
      const boundaryTimeS = Math.min(rain.endTimeS, nextEventS, nextOutputS, config.durationS);
      const stepLimitS = Math.min(config.integration.maxStepS, transferStepS);
      const toBoundaryS = boundaryTimeS - timeS;
      const clipsBoundary = toBoundaryS <= stepLimitS;
      const endTimeS = clipsBoundary ? boundaryTimeS : Math.min(boundaryTimeS, timeS + stepLimitS);
      const dt = endTimeS - timeS;
      if (!(dt > 0) || !Number.isFinite(dt)) throw new NumericalFault("TIME_STEP_UNDERFLOW", "Integration step cannot advance the simulation clock.");
      requestedOut.fill(0); incoming.fill(0); actualOut.fill(0);
      for (let i = 0; i < n; i += 1) {
        const rainVolume = finite(area[i]! * (rain.intensityMmPerHour / 3_600_000) * dt, "Rainfall volume");
        rainLedger.add(rainVolume);
        available[i] = finite(volumes[i]! + rainVolume, "Available volume");
        heads[i] = finite(config.regions[i]!.terrainElevationM + available[i]! / area[i]!, "Transfer head");
        drainRequests[i] = finite(drainCapacity[i]! * openings[i]! * dt, "Drain request");
        pumpRequests[i] = finite(pumps[i]! * dt, "Pump request");
        requestedOut[i] = finite(drainRequests[i]! + pumpRequests[i]!, "Sink requests");
      }
      for (let e = 0; e < edges.length; e += 1) {
        const edge = edges[e]!;
        const raw = edge.g === 0 ? 0 : finite(edge.g * finite(heads[edge.a]! - heads[edge.b]!, "Head difference") * dt, "Transfer request");
        const donor = raw >= 0 ? edge.a : edge.b;
        // Detention throttles only the donor side; the transfer stays antisymmetric.
        const requested = raw * outflowFactor[donor]!;
        edgeRequests[e] = requested;
        requestedOut[donor] = finite(requestedOut[donor]! + Math.abs(requested), "Combined outflow request");
      }
      for (let b = 0; b < outlets.length; b += 1) {
        const outlet = outlets[b]!;
        const requested = outlet.g === 0 ? 0 : finite(outlet.g * outflowFactor[outlet.i]! * Math.max(finite(heads[outlet.i]! - outlet.head, "Boundary head difference"), 0) * dt, "Boundary request");
        boundaryRequests[b] = requested;
        requestedOut[outlet.i] = finite(requestedOut[outlet.i]! + requested, "Combined boundary request");
      }
      for (let i = 0; i < n; i += 1) {
        alpha[i] = requestedOut[i] === 0 ? 1 : Math.min(1, available[i]! / requestedOut[i]!);
        if (alpha[i]! < 1) donorLimitedRegionSteps += 1;
        const drained = drainRequests[i]! * alpha[i]!;
        const pumped = pumpRequests[i]! * alpha[i]!;
        actualOut[i] = drained + pumped;
        drainLedger.add(drained); pumpLedger.add(pumped);
      }
      for (let e = 0; e < edges.length; e += 1) {
        const edge = edges[e]!;
        const requested = edgeRequests[e]!;
        const donor = requested >= 0 ? edge.a : edge.b;
        const recipient = requested >= 0 ? edge.b : edge.a;
        const actual = Math.abs(requested) * alpha[donor]!;
        actualOut[donor] = finite(actualOut[donor]! + actual, "Actual outgoing volume");
        incoming[recipient] = finite(incoming[recipient]! + actual, "Actual incoming volume");
      }
      for (let b = 0; b < outlets.length; b += 1) {
        const i = outlets[b]!.i;
        const actual = boundaryRequests[b]! * alpha[i]!;
        actualOut[i] = finite(actualOut[i]! + actual, "Actual boundary discharge");
        boundaryLedger.add(actual);
      }
      const next = new Float64Array(n);
      for (let i = 0; i < n; i += 1) {
        let value = finite(available[i]! - actualOut[i]! + incoming[i]!, "Next water volume");
        if (value < 0) {
          if (-value > 1e-12 * Math.max(1, available[i]!)) throw new NumericalFault("NEGATIVE_VOLUME", `Negative water volume in region ${config.regions[i]!.id}.`);
          roundoffLedger.add(-value);
          value = 0;
        }
        // Validate derived values before advancing lastAcceptedTimeS.
        finite(value / area[i]!, "Next depth");
        finite(config.regions[i]!.terrainElevationM + value / area[i]!, "Next surface elevation");
        next[i] = value;
      }
      currentBalance = balance(next);
      const previousTimeS = timeS;
      timeS = endTimeS;
      volumes = next;
      acceptedSteps += 1;
      smallestStepS = Math.min(smallestStepS, dt);
      largestStepS = Math.max(largestStepS, dt);
      counts = sample(previousTimeS);
      applyEvents();
      if (timeS === nextOutputS) {
        frames.push(frame(counts, currentBalance));
        nextOutputS = Math.min(config.durationS, nextOutputS + config.outputIntervalS);
      }
    }

    const result: SimulationResult = {
      contractVersion: "1.0", modelVersion: "linear-storage-v1", scenarioId: config.scenarioId,
      durationS: config.durationS, outputIntervalS: config.outputIntervalS,
      riskThresholds: { ...config.riskThresholds }, frames,
      summary: {
        regions: config.regions.map((r, i) => ({
          regionId: r.id, firstCritical: crossings[i]!, peakWaterDepthM: peaks[i]!,
          peakTimeS: peakTimes[i]!, finalWaterDepthM: volumes[i]! / area[i]!,
        })),
        everCriticalRegionCount: crossings.filter((c) => c.status !== "not-reached-within-horizon").length,
        peakCriticalRegionCount: peakCriticalCount, peakCriticalRegionCountTimeS: peakCriticalTimeS,
        peakWaterDepthM: Math.max(...peaks), finalRiskCounts: counts, finalBalance: currentBalance,
      },
      diagnostics: {
        acceptedSteps, smallestStepS, largestStepS, donorLimitedRegionSteps,
        maxAbsolutePhysicalResidualM3, maxAbsoluteNumericalResidualM3,
      },
    };
    return { status: "success", result };
  } catch (error) {
    if (!(error instanceof NumericalFault)) throw error;
    return { status: "numerical-failure", error: { code: error.code, lastAcceptedTimeS: timeS, message: error.message } };
  }
};
