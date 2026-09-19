import { useState } from "react";
import type {
  CriticalCrossing,
  CriticalTimingComparison,
  RegionFrame,
  ScenarioComparison,
  SimulationFrame,
  SimulationResult,
} from "../shared/simulation";
import { crossingTime } from "../app/comparison";
import { formatDepth, formatDuration, formatModelTime } from "../app/format";

interface Side {
  readonly result: SimulationResult;
  readonly frame: SimulationFrame;
}

interface Props {
  readonly labels: ReadonlyMap<string, string>;
  readonly baseline: Side;
  readonly intervention: Side | null;
  readonly comparison: ScenarioComparison | null;
  readonly cursorTimeS: number;
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
}

/** Remaining time before a known crossing; historical record after it. */
export function crossingText(crossing: CriticalCrossing, cursorTimeS: number): string {
  switch (crossing.status) {
    case "already-critical":
      return "Critical at start";
    case "reached":
      return cursorTimeS < crossing.timeS
        ? `in ${formatDuration(crossing.timeS - cursorTimeS)} (T+${formatModelTime(crossing.timeS)})`
        : `first reached T+${formatModelTime(crossing.timeS)}`;
    case "not-reached-within-horizon":
      return `not within ${formatDuration(crossing.horizonS)}`;
  }
}

export function timingText(timing: CriticalTimingComparison): { text: string; tone: "good" | "bad" | "neutral" } {
  switch (timing.status) {
    case "both-reached":
      if (timing.delayS === 0) return { text: "same time", tone: "neutral" };
      return timing.delayS > 0
        ? { text: `${formatDuration(timing.delayS)} later`, tone: "good" }
        : { text: `${formatDuration(-timing.delayS)} earlier`, tone: "bad" };
    case "baseline-only-within-horizon":
      return { text: "avoided within this run", tone: "good" };
    case "intervention-only-within-horizon":
      return { text: "newly critical", tone: "bad" };
    case "neither-within-horizon":
      return { text: "—", tone: "neutral" };
  }
}

function RiskNow({ state }: { state: RegionFrame | undefined }) {
  if (!state) return <span>—</span>;
  return (
    <span className="risk-now">
      <span className={`pill pill-${state.risk}`}>{state.risk}</span>
      <span className="num">{formatDepth(state.waterDepthM)}</span>
    </span>
  );
}

export function WarningTable(props: Props) {
  const { labels, baseline, intervention, comparison, cursorTimeS, selectedId, onSelect } = props;
  const [showAll, setShowAll] = useState(false);

  const bSummary = new Map(baseline.result.summary.regions.map((r) => [r.regionId, r]));
  const iSummary = new Map((intervention?.result.summary.regions ?? []).map((r) => [r.regionId, r]));
  const bNow = new Map(baseline.frame.regions.map((r) => [r.regionId, r]));
  const iNow = new Map((intervention?.frame.regions ?? []).map((r) => [r.regionId, r]));
  const timing = new Map((comparison?.regions ?? []).map((r) => [r.regionId, r.criticalTiming]));

  const rank = (id: string): number => {
    const b = bSummary.get(id);
    const i = iSummary.get(id);
    const times = [b && crossingTime(b.firstCritical), i && crossingTime(i.firstCritical)].filter(
      (t): t is number => typeof t === "number",
    );
    return times.length > 0 ? Math.min(...times) : Number.POSITIVE_INFINITY;
  };
  const flagged = baseline.result.summary.regions
    .map((r) => r.regionId)
    .filter((id) => Number.isFinite(rank(id)))
    .sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : 1));
  const rows = showAll ? flagged : flagged.slice(0, 12);
  const threshold = baseline.result.riskThresholds.criticalDepthM;

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Early warnings</h2>
        <span className="muted">
          {flagged.length} region{flagged.length === 1 ? "" : "s"} reach critical depth ({formatDepth(threshold)}) within the run
        </span>
      </header>
      {flagged.length === 0 ? (
        <p className="empty">No region reaches the critical threshold within this run's horizon.</p>
      ) : (
        <div className="table-wrap">
          <table className="warning-table">
            <thead>
              <tr>
                <th>Region</th>
                <th>Now{intervention ? " (baseline)" : ""}</th>
                <th>Critical{intervention ? " (baseline)" : ""}</th>
                {intervention ? (
                  <>
                    <th>Now (response)</th>
                    <th>Critical (response)</th>
                    <th>Effect</th>
                  </>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((id) => {
                const b = bSummary.get(id);
                const i = iSummary.get(id);
                const t = timing.get(id);
                const effect = t ? timingText(t) : null;
                return (
                  <tr
                    key={id}
                    className={id === selectedId ? "is-selected" : undefined}
                    onClick={() => onSelect(id)}
                  >
                    <td>{labels.get(id) ?? id}</td>
                    <td><RiskNow state={bNow.get(id)} /></td>
                    <td className="num">{b ? crossingText(b.firstCritical, cursorTimeS) : "—"}</td>
                    {intervention ? (
                      <>
                        <td><RiskNow state={iNow.get(id)} /></td>
                        <td className="num">{i ? crossingText(i.firstCritical, cursorTimeS) : "—"}</td>
                        <td className={effect ? `tone-${effect.tone}` : undefined}>{effect?.text ?? "—"}</td>
                      </>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {flagged.length > 12 ? (
        <button type="button" className="btn btn-quiet" onClick={() => setShowAll(!showAll)}>
          {showAll ? "Show fewer" : `Show all ${flagged.length}`}
        </button>
      ) : null}
      <p className="footnote">
        Warning time = first accepted integration step at or above the critical depth, from the start
        of the run. It is resolved to one step, not interpolated, and it is not a validated forecast.
      </p>
    </section>
  );
}
