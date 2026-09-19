import type { SimulationResult } from "../shared/simulation";
import { crossingTime } from "../app/comparison";
import { formatDepth, formatDuration } from "../app/format";

export interface SensitivityRow {
  readonly label: string;
  readonly result: SimulationResult | null;
  readonly error?: string;
}

function earliest(result: SimulationResult): number | null {
  const times = result.summary.regions.map((r) => crossingTime(r.firstCritical)).filter((t): t is number => t !== null);
  return times.length ? Math.min(...times) : null;
}

/** Re-runs the baseline with the uncalibrated parameters pushed up and down. */
export function SensitivityPanel({ rows, running, onRun }: {
  readonly rows: readonly SensitivityRow[];
  readonly running: boolean;
  readonly onRun: () => void;
}) {
  const done = rows.filter((r): r is SensitivityRow & { result: SimulationResult } => r.result !== null);
  const range = (values: number[]) => (values.length ? [Math.min(...values), Math.max(...values)] as const : null);
  const crit = range(done.map((r) => r.result.summary.everCriticalRegionCount));
  const peak = range(done.map((r) => r.result.summary.peakWaterDepthM));
  const first = range(done.map((r) => earliest(r.result)).filter((t): t is number => t !== null));
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>How sure are we? Sensitivity check</h2>
        <button type="button" className="btn btn-small" onClick={onRun} disabled={running}>
          {running ? "Running…" : rows.length ? "Run again" : "Run 5 engine variants"}
        </button>
      </header>
      <p className="muted">
        Flow conductance and drain capacity are uncalibrated assumptions. This reruns the baseline with each one halved or
        doubled (conductance) and ±25% (drain capacity), then reports the spread.
      </p>
      {done.length > 1 && crit && peak ? (
        <div className="stats">
          <div className="stat"><span className="stat-label">Cells ever critical</span><span className="stat-values num">{crit[0]}–{crit[1]}</span></div>
          <div className="stat"><span className="stat-label">Peak depth</span><span className="stat-values num">{formatDepth(peak[0])}–{formatDepth(peak[1])}</span></div>
          <div className="stat"><span className="stat-label">First critical</span><span className="stat-values num">{first ? `T+${formatDuration(first[0])} – T+${formatDuration(first[1])}` : "not reached"}</span></div>
        </div>
      ) : null}
      {rows.length ? (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Variant</th><th className="num">Critical cells</th><th className="num">Peak depth</th><th className="num">First critical</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const t = r.result ? earliest(r.result) : null;
                return (
                  <tr key={r.label}>
                    <td>{r.label}</td>
                    <td className="num">{r.result ? r.result.summary.everCriticalRegionCount : r.error ?? "…"}</td>
                    <td className="num">{r.result ? formatDepth(r.result.summary.peakWaterDepthM) : ""}</td>
                    <td className="num">{r.result ? (t === null ? "not reached" : `T+${formatDuration(t)}`) : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
