import type { SimulationResult } from "../shared/simulation";
import { EVENT_2022 } from "../data/event-2022";
import { validateReplay } from "../app/insights";
import { formatDepth } from "../app/format";

/** Replay check: does the model flood near places reported flooded in Sep 2022? */
export function ValidationPanel({ result }: { readonly result: SimulationResult }) {
  const v = validateReplay(result);
  const hitRate = v.inside > 0 ? v.hits / v.inside : 0;
  const better = hitRate > v.chanceRate + 0.15;
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Reality check: the September 2022 flood</h2>
        <span className="muted">Rain: {EVENT_2022.rainfallMethod}</span>
      </header>
      <p>
        <strong>{v.hits} of {v.inside}</strong> places reported flooded inside the model area have a critical cell within
        about 750 m. By chance you would expect <strong>{Math.round(v.chanceRate * 100)}%</strong>, because that share of all
        neighbourhoods contains a critical cell. {better
          ? "The model does better than chance here."
          : "That is no better than chance, so this replay does not yet show the model can predict where flooding happens."}
      </p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Reported place</th><th>Model cell</th><th className="num">Peak in cell</th><th className="num">Peak within ~750 m</th><th>Result</th></tr></thead>
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
        Why places are missed: in 2022, Bellandur flooded when its lake overflowed with water from a catchment that is mostly
        outside this area. The model has no lakes as storage and no inflow from beyond its edges. Sources: rainfall total and
        flooded places from{" "}
        <a href={EVENT_2022.news.url} target="_blank" rel="noreferrer">{EVENT_2022.news.publisher} ({EVENT_2022.news.published})</a>,
        citing IMD; hourly timing from ERA5 (Open-Meteo), whose own total was only {EVENT_2022.era5TotalMm} mm; places
        geocoded with OpenStreetMap Nominatim.
      </p>
    </section>
  );
}
