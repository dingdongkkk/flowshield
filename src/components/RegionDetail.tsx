import type { Region, SimulationResult } from "../shared/simulation";
import { formatDepth, formatModelTime } from "../app/format";
import { crossingText } from "./WarningTable";
import { BENGALURU_CELLS } from "../app/bengaluru";
import { BENGALURU_TERRAIN } from "../data/bengaluru-terrain";

interface Props {
  readonly region: Region | null;
  readonly runs: readonly { readonly label: string; readonly result: SimulationResult }[];
  readonly cursorTimeS: number;
}

const W = 320;
const H = 120;
const PAD = { left: 34, right: 8, top: 8, bottom: 18 };

export function RegionDetail({ region, runs, cursorTimeS }: Props) {
  if (!region) {
    return (
      <section className="panel">
        <header className="panel-head"><h2>Region detail</h2></header>
        <p className="empty">Select a block on the map or in the warning table.</p>
      </section>
    );
  }
  const series = runs.map((r) => ({
    label: r.label,
    thresholds: r.result.riskThresholds,
    duration: r.result.durationS,
    points: r.result.frames.map((f) => ({
      t: f.timeS,
      d: f.regions.find((x) => x.regionId === region.id)?.waterDepthM ?? 0,
    })),
    summary: r.result.summary.regions.find((x) => x.regionId === region.id),
  }));
  const first = series[0];
  const geography = BENGALURU_CELLS.get(region.id);
  const duration = first?.duration ?? 1;
  const critical = first?.thresholds.criticalDepthM ?? 0.3;
  const warning = first?.thresholds.warningDepthM ?? 0.1;
  const yMax = Math.max(critical * 1.2, ...series.flatMap((s) => s.points.map((p) => p.d)));
  const x = (t: number) => PAD.left + (t / duration) * (W - PAD.left - PAD.right);
  const y = (d: number) => PAD.top + (1 - d / yMax) * (H - PAD.top - PAD.bottom);

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>{region.label}</h2>
        <span className="muted num">terrain {region.terrainElevationM.toFixed(2)} m · {region.areaM2.toLocaleString()} m²</span>
      </header>
      {geography ? <p className="region-geography">
        {geography.latitude.toFixed(5)}° N, {geography.longitude.toFixed(5)}° E ·
        {" "}{(geography.mappedDrainLengthM / 1000).toFixed(2)} km of mapped drainage in this cell (approx.).
        Elevation is the mean of {BENGALURU_TERRAIN.samplesPerCell} DEM samples ({geography.elevationRangeM[0]}–{geography.elevationRangeM[1]} m);
        flow capacity is an assumption.
      </p> : null}
      {series.length > 0 ? (
        <svg viewBox={`0 0 ${W} ${H}`} className="sparkline" role="img" aria-label="Water depth over time">
          <rect x={PAD.left} y={y(yMax)} width={W - PAD.left - PAD.right} height={y(critical) - y(yMax)} className="band-critical" />
          <rect x={PAD.left} y={y(critical)} width={W - PAD.left - PAD.right} height={y(warning) - y(critical)} className="band-warning" />
          <text x={PAD.left - 4} y={y(critical) + 3} className="axis-label" textAnchor="end">{Math.round(critical * 100)}cm</text>
          <text x={PAD.left - 4} y={y(0) + 3} className="axis-label" textAnchor="end">0</text>
          {series.map((s, i) => (
            <path
              key={s.label}
              className={`depth-line series-${i}`}
              strokeDasharray={i > 0 ? "5 4" : undefined}
              d={s.points.map((p, j) => `${j === 0 ? "M" : "L"}${x(p.t).toFixed(1)},${y(p.d).toFixed(1)}`).join("")}
            />
          ))}
          <line x1={x(cursorTimeS)} x2={x(cursorTimeS)} y1={PAD.top} y2={H - PAD.bottom} className="cursor-line" />
          <text x={W - PAD.right} y={H - 4} className="axis-label" textAnchor="end">T+{formatModelTime(duration)}</text>
        </svg>
      ) : null}
      <dl className="detail-list">
        {series.map((s) =>
          s.summary ? (
            <div key={s.label}>
              <dt>{s.label}</dt>
              <dd>
                Peak {formatDepth(s.summary.peakWaterDepthM)} at T+{formatModelTime(s.summary.peakTimeS)} ·
                {" "}Critical: {crossingText(s.summary.firstCritical, cursorTimeS)}
              </dd>
            </div>
          ) : null,
        )}
      </dl>
    </section>
  );
}
