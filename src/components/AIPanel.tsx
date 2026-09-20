import { useMemo } from "react";
import type { SimulationResult } from "../shared/simulation";
import surrogateJson from "../data/surrogate-model.json";
import { inTrainingRange, predict, withoutResponse, type Prediction, type SurrogateModel } from "../app/surrogate";
import { GRID, responseFootprint, type ScenarioDraft } from "../app/scenarios";
import { TOTAL_BUILDINGS, buildingsEverCritical } from "../app/insights";
import { formatDepth, formatDuration } from "../app/format";

const MODEL = surrogateJson as unknown as SurrogateModel;
const CELLS = GRID.rows * GRID.cols;

interface Plan {
  readonly draft: ScenarioDraft;
  readonly footprint: number;
  readonly prediction: Prediction;
  readonly summary: string;
}

function describe(d: ScenarioDraft): string {
  const parts = [];
  if (d.drainUpgradeFactor > 1) parts.push(`drains ${d.drainUpgradeFactor}×`);
  if (d.detentionShare > 0) parts.push(`detention ${Math.round(d.detentionShare * 100)}% of cells, ${d.detentionHoldPct}% held`);
  if (d.pumpCount > 0) parts.push(`${d.pumpCount} pumps`);
  return parts.length ? parts.join(" · ") : "no structural measures";
}

/** Search structural plans with the surrogate; keep the Pareto front of footprint vs outcome. */
function searchPlans(base: ScenarioDraft): { front: Plan[]; evaluated: number } {
  const plans: Plan[] = [];
  for (const up of [1, 1.5, 2, 2.5, 3, 3.5, 4]) {
    for (const share of [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7]) {
      for (const hold of share === 0 ? [base.detentionHoldPct] : [50, 70, 85, 95]) {
        for (const pumps of [0, 3, 6]) {
          const draft = { ...base, drainUpgradeFactor: up, detentionShare: share, detentionHoldPct: hold, pumpCount: pumps };
          if (inTrainingRange(draft).ok) {
            plans.push({ draft, footprint: responseFootprint(draft), prediction: predict(MODEL, draft), summary: describe(draft) });
          }
        }
      }
    }
  }
  // Rank on the numbers the table shows: whole critical cells first, then peak
  // depth to the nearest 5 cm (below the surrogate's ~6 cm error, differences are noise).
  const cells = (p: Plan) => Math.round(p.prediction.criticalShare * CELLS);
  const depth = (p: Plan) => Math.round(p.prediction.peakDepthM * 20) / 20;
  const better = (p: Plan, q: Plan) => cells(p) < cells(q) || (cells(p) === cells(q) && depth(p) < depth(q));
  const sorted = [...plans].sort((a, b) => a.footprint - b.footprint || cells(a) - cells(b) || a.prediction.peakDepthM - b.prediction.peakDepthM);
  const front: Plan[] = [];
  for (const p of sorted) {
    if (front.every((q) => better(p, q))) front.push(p);
  }
  return { front, evaluated: plans.length };
}

function Estimate({ label, p, horizonMin }: { label: string; p: Prediction; horizonMin: number }) {
  const earliest = p.earliestCriticalShare >= 0.98 ? "near end or not reached; verify" : `≈ T+${formatDuration(p.earliestCriticalShare * horizonMin * 60)}`;
  return (
    <div className="ai-est">
      <span className="stat-label">{label}</span>
      <dl>
        <div><dt>Peak depth</dt><dd>{formatDepth(p.peakDepthM)}</dd></div>
        <div><dt>Cells critical</dt><dd>{Math.round(p.criticalShare * CELLS)}</dd></div>
        <div><dt>First critical</dt><dd>{earliest}</dd></div>
        <div><dt>Buildings in critical cells</dt><dd>{Math.round(p.buildingsCriticalShare * TOTAL_BUILDINGS).toLocaleString()}</dd></div>
      </dl>
    </div>
  );
}

export function AIPanel({ draft, onApply, verified }: {
  readonly draft: ScenarioDraft;
  readonly onApply: (draft: ScenarioDraft) => void;
  /** Engine result for exactly the current response draft, if one exists. */
  readonly verified: SimulationResult | null;
}) {
  const range = inTrainingRange(draft);
  const response = useMemo(() => (range.ok ? predict(MODEL, draft) : null), [draft, range.ok]);
  const baseline = useMemo(() => (range.ok ? predict(MODEL, withoutResponse(draft)) : null), [draft, range.ok]);
  const search = useMemo(() => (range.ok ? searchPlans(draft) : { front: [], evaluated: 0 }), [draft, range.ok]);
  const plans = search.front;
  const m = MODEL.metrics;

  return (
    <section className="panel ai-panel">
      <header className="panel-head">
        <h2><span className="ai-badge">AI</span> Instant estimate &amp; plan search</h2>
        <span className="muted">
          Neural network: {MODEL.samples.train.toLocaleString()} training runs; {MODEL.samples.test} held-out engine runs
        </span>
      </header>
      {!range.ok ? (
        <p className="notice">{range.reason} Estimates are hidden. Use the engine results below.</p>
      ) : (
        <>
          <div className="ai-grid">
            {baseline ? <Estimate label="Baseline (estimate)" p={baseline} horizonMin={draft.durationMin} /> : null}
            {response ? <Estimate label="With response plan (estimate)" p={response} horizonMin={draft.durationMin} /> : null}
          </div>
          {verified && response ? (
            <p className="ai-check">
              <strong>Check against the engine:</strong> estimated peak {formatDepth(response.peakDepthM)} vs engine{" "}
              {formatDepth(verified.summary.peakWaterDepthM)}; estimated {Math.round(response.criticalShare * CELLS)} critical cells
              vs engine {verified.summary.everCriticalRegionCount}; estimated{" "}
              {Math.round(response.buildingsCriticalShare * TOTAL_BUILDINGS).toLocaleString()} buildings vs engine{" "}
              {buildingsEverCritical(verified).toLocaleString()}.
            </p>
          ) : null}
          <h3 className="ai-sub">Candidate plans by unique cell footprint (AI estimates)</h3>
          <p className="footnote">
            Each cell is counted once, even when measures overlap. This measures land coverage, not cost or
            feasibility: stronger upgrades can have the same footprint. Rankings compare only the sampled plans
            and require engine verification. Drain clearing follows your current schedule and is not searched.
          </p>
          <div className="table-wrap">
            <table className="plan-table">
              <thead>
                <tr><th>Plan</th><th className="num">Unique cells</th><th className="num">Critical cells</th><th className="num">Peak depth</th><th /></tr>
              </thead>
              <tbody>
                {plans.slice(0, 7).map((p) => (
                  <tr key={p.summary}>
                    <td>{p.summary}</td>
                    <td className="num">{p.footprint}</td>
                    <td className="num">{Math.round(p.prediction.criticalShare * CELLS)}</td>
                    <td className="num">{formatDepth(p.prediction.peakDepthM)}</td>
                    <td><button type="button" className="btn btn-small" onClick={() => onApply(p.draft)}>Apply &amp; verify</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="footnote">
            The surrogate scored {search.evaluated} candidate plans instantly. "Apply &amp; verify" loads a plan
            and runs the simulation engine. Agreement with {MODEL.samples.test} held-out engine runs:
            peak depth mean absolute error {(m.peakDepthM.mae * 100).toFixed(1)} cm (R² {m.peakDepthM.r2.toFixed(3)}), critical cells
            mean absolute error {(m.criticalShare.mae * CELLS).toFixed(1)} (R² {m.criticalShare.r2.toFixed(3)}), first-critical time
            R² {m.earliestCriticalShare.r2.toFixed(2)}. Valid for: {MODEL.validity}
            These are average simulation errors, not confidence intervals or accuracy against observed floods.
          </p>
        </>
      )}
    </section>
  );
}
