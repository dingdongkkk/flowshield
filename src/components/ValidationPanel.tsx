import type { SimulationResult } from "../shared/simulation";
import { EVENT_2022 } from "../data/event-2022";
import { validateReplay } from "../app/insights";
import { formatDepth } from "../app/format";

/** Replay check: does the model flood near places reported flooded in Sep 2022? */
export function ValidationPanel({ result }: { readonly result: SimulationResult }) {
  const v = validateReplay(result);
  const hitRate = v.inside > 0 ? v.hits / v.inside : 0;
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Exploratory replay: September 2022 reports</h2>
        <span className="muted">Rain: {EVENT_2022.rainfallMethod}</span>
      </header>
      <p>
        <strong>{v.hits} of {v.inside}</strong> places reported flooded inside the model area have a critical cell within
        the surrounding 3 × 3 cell neighbourhood ({Math.round(hitRate * 100)}% of reported places).
        Across the whole grid, <strong>{Math.round(v.neighbourhoodCriticalShare * 100)}%</strong> of cell-centred neighbourhoods
        contain a critical cell. This is a descriptive comparison, not a statistical significance test or validated
        forecasting accuracy: reports are few, selectively located, and spatially overlapping.
      </p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Reported place</th><th>Model cell</th><th className="num">Peak in cell</th><th className="num">Peak in 3 × 3 neighbourhood</th><th>Result</th></tr></thead>
          <tbody>
            {v.places.map((p) => (
              <tr key={p.name}>
                <td>{p.name}</td>
                <td>{p.cellId ?? "outside area"}</td>
                <td className="num">{p.peakInCellM === null ? "—" : formatDepth(p.peakInCellM)}</td>
                <td className="num">{p.peakNearbyM === null ? "—" : formatDepth(p.peakNearbyM)}</td>
                <td className={p.cellId === null ? "" : p.hit ? "tone-good" : "tone-bad"}>{p.cellId === null ? "not modelled" : p.hit ? "flooded nearby" : "missed"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="footnote">
        Possible reasons for mismatch include omitted lake storage, overflow, and inflow from beyond the model edges.
        This comparison cannot identify which omission caused a particular miss. Rain timing is ERA5 rescaled to an
        illustrative 100 mm total, informed by reporting rather than a measured local hourly record. Sources: rainfall reporting and
        flooded places from{" "}
        <a href={EVENT_2022.news.url} target="_blank" rel="noreferrer">{EVENT_2022.news.publisher} ({EVENT_2022.news.published})</a>,
        citing IMD; hourly timing from ERA5 (Open-Meteo), whose own total was only {EVENT_2022.era5TotalMm} mm; places
        geocoded with OpenStreetMap Nominatim.
      </p>
    </section>
  );
}
