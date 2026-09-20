import type { ScenarioDraft } from "./scenarios";

/**
 * AI surrogate: a small neural network (multilayer perceptron) trained on
 * FlowShield engine runs (scripts/train-surrogate.mjs). It predicts scenario
 * outcomes in microseconds, so the UI can preview slider changes live and search
 * thousands of response plans. The engine remains the source of truth: every
 * surrogate number is labelled as an estimate and can be checked with a real run.
 */

export const OUTPUTS = [
  { key: "peakDepthM", label: "Peak depth", unit: "m" },
  { key: "criticalShare", label: "Share of cells ever critical", unit: "" },
  { key: "earliestCriticalShare", label: "Earliest critical time / horizon", unit: "" },
  { key: "storedShare", label: "Rain still stored at the end", unit: "" },
  { key: "buildingsCriticalShare", label: "Share of mapped buildings in critical cells", unit: "" },
] as const;

export type OutputKey = (typeof OUTPUTS)[number]["key"];
export type Prediction = Record<OutputKey, number>;

export interface SurrogateModel {
  readonly version: 1;
  readonly trainedAt: string;
  readonly samples: { readonly train: number; readonly test: number };
  readonly featureNames: readonly string[];
  readonly featureMean: readonly number[];
  readonly featureStd: readonly number[];
  readonly targetMean: readonly number[];
  readonly targetStd: readonly number[];
  /** Layers as [weights (out x in, row-major), bias]; tanh hidden, linear output. */
  readonly layers: readonly { readonly w: readonly number[]; readonly b: readonly number[]; readonly in: number; readonly out: number }[];
  readonly metrics: Readonly<Record<OutputKey, { readonly mae: number; readonly r2: number }>>;
  readonly validity: string;
}

const STORMS = ["steady", "heavy", "cloudburst"] as const;
const CONDITIONS = ["working", "partly-blocked", "blocked", "fails-mid-storm"] as const;

/** Bounds of the generator used for the shipped model; see sampleDraft in
 * scripts/train-surrogate.mjs. These are a support check, not evidence that
 * every combination was observed or that real-world predictions are accurate.
 */
export function inTrainingRange(d: ScenarioDraft): { ok: boolean; reason?: string } {
  if (d.storm === "event-2022") return { ok: false, reason: "The 2022 replay is not in the training set." };
  if (d.warningDepthM !== 0.1 || d.criticalDepthM !== 0.3) return { ok: false, reason: "Trained for 10 cm / 30 cm thresholds only." };
  if (d.conductanceScale !== 1) return { ok: false, reason: "Trained with default conductance only." };
  if (d.maxStepS !== 1) return { ok: false, reason: "Trained with a one-second maximum integration step only." };
  if (!STORMS.some((s) => s === d.storm) || !CONDITIONS.some((c) => c === d.basinDrainCondition)) {
    return { ok: false, reason: "Unsupported storm or drain condition." };
  }
  if (![60, 120, 180, 240, 360].includes(d.durationMin)) {
    return { ok: false, reason: "Trained for horizons of 1, 2, 3, 4 or 6 hours only." };
  }
  const bounds: readonly [string, number, number, number][] = [
    ["Rain intensity (mm/h)", d.peakIntensityMmPerHour, 5, 200],
    ["Storm length (min)", d.stormDurationMin, 15, Math.min(240, d.durationMin)],
    ["Drain capacity (mm/h)", d.drainDesignMmPerHour, 0, 60],
    ["Pump count", d.pumpCount, 0, 10],
    ["Pump capacity (m³/s)", d.pumpCapacityM3PerS, 0.05, 1.5],
    ["Detention share", d.detentionShare, 0, 0.7],
    ["Runoff held back (%)", d.detentionHoldPct, 10, 95],
    ["Drain upgrade factor", d.drainUpgradeFactor, 1, 4],
  ];
  const times: [string, number, number, number][] = [];
  if (d.pumpCount > 0) boundsForTime("Pump deployment", d.pumpDeployMin);
  if (d.basinDrainCondition === "fails-mid-storm") boundsForTime("Drain failure", d.drainFailureMin);
  if (d.basinDrainCondition !== "working" && d.clearDrainsAtMin !== null) {
    times.push(["Drain clearing (min)", d.clearDrainsAtMin, 5, d.durationMin - 10]);
  }
  function boundsForTime(label: string, time: number) {
    times.push([`${label} (min)`, time, 0, d.durationMin - 10]);
  }
  function unsupported([label, value, min, max]: readonly [string, number, number, number]) {
    return !Number.isFinite(value) || value < min || value > max
      ? `${label} is outside the training range (${min}–${max}).` : null;
  }
  const issue = [...bounds, ...times].map(unsupported).find((reason) => reason !== null);
  if (issue) return { ok: false, reason: issue };
  if (!Number.isInteger(d.pumpCount)) return { ok: false, reason: "Pump count must be a whole number." };
  return { ok: true };
}

export function features(d: ScenarioDraft): number[] {
  const horizon = d.durationMin;
  const stormMin = Math.min(d.stormDurationMin, horizon);
  const failing = d.basinDrainCondition === "fails-mid-storm";
  const clearing = d.clearDrainsAtMin !== null && d.basinDrainCondition !== "working";
  const pumps = d.pumpCount > 0 && d.pumpCapacityM3PerS > 0;
  const detention = d.detentionShare > 0 && d.detentionHoldPct > 0;
  return [
    ...STORMS.map((s) => (d.storm === s ? 1 : 0)),
    d.peakIntensityMmPerHour / 100,
    stormMin / 120,
    horizon / 180,
    stormMin / horizon,
    (d.peakIntensityMmPerHour * stormMin) / 12000, // proxy for total rain depth
    d.drainDesignMmPerHour / 30,
    ...CONDITIONS.map((c) => (d.basinDrainCondition === c ? 1 : 0)),
    failing ? d.drainFailureMin / horizon : 1,
    pumps ? (d.pumpCount * d.pumpCapacityM3PerS) / 4 : 0,
    pumps ? d.pumpDeployMin / horizon : 1,
    clearing ? d.clearDrainsAtMin! / horizon : 1,
    detention ? d.detentionShare : 0,
    detention ? d.detentionHoldPct / 100 : 0,
    detention ? d.detentionShare * (d.detentionHoldPct / 100) : 0,
    d.drainUpgradeFactor - 1,
  ];
}

export function predict(model: SurrogateModel, d: ScenarioDraft): Prediction {
  let x = features(d).map((v, i) => (v - model.featureMean[i]!) / model.featureStd[i]!);
  model.layers.forEach((layer, li) => {
    const y = new Array<number>(layer.out);
    for (let o = 0; o < layer.out; o += 1) {
      let s = layer.b[o]!;
      for (let i = 0; i < layer.in; i += 1) s += layer.w[o * layer.in + i]! * x[i]!;
      y[o] = li < model.layers.length - 1 ? Math.tanh(s) : s;
    }
    x = y;
  });
  const out = {} as Prediction;
  OUTPUTS.forEach((o, i) => {
    const raw = x[i]! * model.targetStd[i]! + model.targetMean[i]!;
    out[o.key] = o.key === "peakDepthM" ? Math.max(0, raw) : Math.min(1, Math.max(0, raw));
  });
  return out;
}

/** Response actions removed: the matching baseline draft. */
export function withoutResponse(d: ScenarioDraft): ScenarioDraft {
  return { ...d, pumpCount: 0, clearDrainsAtMin: null, detentionShare: 0, drainUpgradeFactor: 1 };
}
