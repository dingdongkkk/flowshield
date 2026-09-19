import type { SimulationResult, WaterBalance } from "../shared/simulation";
import { formatSci, formatVolume } from "../app/format";

interface Props {
  readonly runs: readonly { readonly label: string; readonly result: SimulationResult }[];
}

const ROWS: readonly [keyof WaterBalance, string][] = [
  ["initialStorageM3", "Initial storage"],
  ["rainfallInputM3", "+ Rainfall"],
  ["drainedM3", "− Drained"],
  ["pumpedM3", "− Pumped"],
  ["boundaryDischargeM3", "− To river"],
  ["storageM3", "= Stored now"],
];

export function DiagnosticsPanel({ runs }: Props) {
  if (runs.length === 0) return null;
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Water balance &amp; numerics</h2>
        <span className="muted">Final state; every cubic metre is accounted for</span>
      </header>
      <div className="table-wrap">
        <table className="balance-table">
          <thead>
            <tr>
              <th />
              {runs.map((r) => <th key={r.label} className="num">{r.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {ROWS.map(([key, label]) => (
              <tr key={key}>
                <td>{label}</td>
                {runs.map((r) => (
                  <td key={r.label} className="num">{formatVolume(r.result.summary.finalBalance[key])}</td>
                ))}
              </tr>
            ))}
            <tr className="sep">
              <td>Numerical residual (max)</td>
              {runs.map((r) => (
                <td key={r.label} className="num">{formatSci(r.result.diagnostics.maxAbsoluteNumericalResidualM3)} m³</td>
              ))}
            </tr>
            <tr>
              <td>Allowed error</td>
              {runs.map((r) => (
                <td key={r.label} className="num">{formatSci(r.result.summary.finalBalance.allowedErrorM3)} m³</td>
              ))}
            </tr>
            <tr>
              <td>Round-off added</td>
              {runs.map((r) => (
                <td key={r.label} className="num">{formatSci(r.result.summary.finalBalance.roundoffAddedM3)} m³</td>
              ))}
            </tr>
            <tr>
              <td>Accepted steps</td>
              {runs.map((r) => (
                <td key={r.label} className="num">{r.result.diagnostics.acceptedSteps.toLocaleString()}</td>
              ))}
            </tr>
            <tr>
              <td>Step size (min – max)</td>
              {runs.map((r) => (
                <td key={r.label} className="num">
                  {r.result.diagnostics.smallestStepS.toPrecision(3)} – {r.result.diagnostics.largestStepS.toPrecision(3)} s
                </td>
              ))}
            </tr>
            <tr>
              <td>Donor-limited region-steps</td>
              {runs.map((r) => (
                <td key={r.label} className="num">{r.result.diagnostics.donorLimitedRegionSteps.toLocaleString()}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="footnote">
        Donor-limited steps are where a region was asked to give more water than it held and every
        outflow was scaled down together. A high count means timings depend on that limiter, so rerun
        with a smaller max step to check they converge.
      </p>
    </section>
  );
}
