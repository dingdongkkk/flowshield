import type { RainfallInterval, SimulationResult } from "../shared/simulation";
import { formatDuration } from "../app/format";

interface Series {
  readonly label: string;
  readonly result: SimulationResult;
  readonly dashed: boolean;
}

interface Props {
  readonly series: readonly Series[];
  readonly rainfall: readonly RainfallInterval[];
  readonly cursorTimeS: number;
  readonly onSeek: (timeS: number) => void;
}

const W = 720;
const H = 220;
const PAD = { left: 44, right: 12, top: 64, bottom: 28 };
const RAIN_H = 44;

export function RiskTimeline({ series, rainfall, cursorTimeS, onSeek }: Props) {
  const first = series[0]?.result;
  if (!first) return null;
  const duration = first.durationS;
  const regionCount = first.frames[0]?.regions.length ?? 1;
  const maxRain = Math.max(1, ...rainfall.map((r) => r.intensityMmPerHour));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (t: number) => PAD.left + (t / duration) * plotW;
  const yMax = Math.max(1, ...series.flatMap((s) => s.result.frames.map((f) => f.riskCounts.critical + f.riskCounts.warning)));
  const y = (count: number) => PAD.top + plotH - (count / yMax) * plotH;

  const line = (result: SimulationResult, pick: (c: { warning: number; critical: number }) => number) =>
    result.frames.map((f, i) => `${i === 0 ? "M" : "L"}${x(f.timeS).toFixed(1)},${y(pick(f.riskCounts)).toFixed(1)}`).join("");

  const hourTicks: number[] = [];
  const step = duration > 4 * 3600 ? 3600 : 1800;
  for (let t = 0; t <= duration; t += step) hourTicks.push(t);

  return (
    <figure className="chart-card">
      <figcaption>
        <span className="map-title">Flood progression</span>
        <span className="map-subtitle">
          Regions at warning or worse (thin) and critical (bold), of {regionCount}. Bars: rainfall input.
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="timeline"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * W;
          const t = ((px - PAD.left) / plotW) * duration;
          onSeek(Math.max(0, Math.min(duration, t)));
        }}
      >
        {rainfall.map((r) => (
          <rect
            key={r.startTimeS}
            x={x(r.startTimeS)}
            y={8}
            width={Math.max(0.5, x(r.endTimeS) - x(r.startTimeS) - 1)}
            height={(r.intensityMmPerHour / maxRain) * RAIN_H}
            className="rain-bar"
          />
        ))}
        <text x={PAD.left - 6} y={16} className="axis-label" textAnchor="end">{maxRain} mm/h</text>
        {[...new Set([0, Math.round(yMax / 2), yMax])].map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} className="grid-line" />
            <text x={PAD.left - 6} y={y(v) + 4} className="axis-label" textAnchor="end">{v}</text>
          </g>
        ))}
        {hourTicks.map((t) => (
          <text key={t} x={x(t)} y={H - 8} className="axis-label" textAnchor="middle">
            {t === 0 ? "0" : formatDuration(t)}
          </text>
        ))}
        {series.map((s, i) => (
          <g key={s.label} className={`series series-${i}`}>
            <path d={line(s.result, (c) => c.warning + c.critical)} className="line-warning" strokeDasharray={s.dashed ? "5 4" : undefined} />
            <path d={line(s.result, (c) => c.critical)} className="line-critical" strokeDasharray={s.dashed ? "5 4" : undefined} />
          </g>
        ))}
        <line x1={x(cursorTimeS)} x2={x(cursorTimeS)} y1={4} y2={H - PAD.bottom} className="cursor-line" />
      </svg>
      <div className="legend">
        {series.map((s, i) => (
          <span key={s.label} className={`legend-item series-${i}`}>
            <svg width="26" height="8" aria-hidden="true">
              <line x1="0" x2="26" y1="4" y2="4" strokeDasharray={s.dashed ? "5 4" : undefined} />
            </svg>
            {s.label}
          </span>
        ))}
      </div>
    </figure>
  );
}
