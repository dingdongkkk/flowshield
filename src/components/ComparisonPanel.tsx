import type { ScenarioComparison, SimulationResult } from "../shared/simulation";
import type { ComparisonOutcome } from "../app/comparison";
import { formatDepth, formatSigned, formatVolume } from "../app/format";

interface Props {
  readonly outcome: ComparisonOutcome | null;
  readonly baseline: SimulationResult | null;
  readonly intervention: SimulationResult | null;
  readonly noMitigation: boolean;
}

function Stat(props: { label: string; baseline: string; response: string; delta: string; tone: "good" | "bad" | "neutral" }) {
  return (
    <div className="stat">
      <span className="stat-label">{props.label}</span>
      <span className="stat-values">
        <span className="num">{props.baseline}</span>
        <span className="arrow" aria-hidden="true">→</span>
        <span className="num">{props.response}</span>
      </span>
      <span className={`stat-delta tone-${props.tone}`}>{props.delta}</span>
    </div>
  );
}

function tone(delta: number): "good" | "bad" | "neutral" {
  return delta < 0 ? "good" : delta > 0 ? "bad" : "neutral";
}

function counts(comparison: ScenarioComparison) {
  const c = { later: 0, earlier: 0, same: 0, avoided: 0, newly: 0 };
  for (const r of comparison.regions) {
    const t = r.criticalTiming;
    if (t.status === "both-reached") {
      if (t.delayS > 0) c.later += 1;
      else if (t.delayS < 0) c.earlier += 1;
      else c.same += 1;
    } else if (t.status === "baseline-only-within-horizon") c.avoided += 1;
    else if (t.status === "intervention-only-within-horizon") c.newly += 1;
  }
  return c;
}

export function ComparisonPanel({ outcome, baseline, intervention, noMitigation }: Props) {
  if (!outcome || !baseline || !intervention) return null;
  if (!outcome.ok) {
    return (
      <section className="panel">
        <header className="panel-head"><h2>Response comparison</h2></header>
        <div className="notice notice-warn">
          <strong>Not comparable.</strong>
          <ul>{outcome.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        </div>
      </section>
    );
  }
  const c = outcome.comparison;
  const n = counts(c);
  const b = baseline.summary;
  const i = intervention.summary;
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Response comparison</h2>
        <span className="muted">Response minus baseline; negative means less water</span>
      </header>
      {noMitigation ? (
        <p className="notice">No response actions are set, so both runs use the same inputs.</p>
      ) : null}
      <div className="stats">
        <Stat
          label="Peak depth (any region)"
          baseline={formatDepth(b.peakWaterDepthM)}
          response={formatDepth(i.peakWaterDepthM)}
          delta={formatSigned(c.peakWaterDepthDeltaM * 100, "cm", 1)}
          tone={tone(c.peakWaterDepthDeltaM)}
        />
        <Stat
          label="Regions ever critical"
          baseline={String(b.everCriticalRegionCount)}
          response={String(i.everCriticalRegionCount)}
          delta={formatSigned(c.everCriticalRegionCountDelta, "", 0)}
          tone={tone(c.everCriticalRegionCountDelta)}
        />
        <Stat
          label="Most critical at once"
          baseline={String(b.peakCriticalRegionCount)}
          response={String(i.peakCriticalRegionCount)}
          delta={formatSigned(c.peakCriticalRegionCountDelta, "", 0)}
          tone={tone(c.peakCriticalRegionCountDelta)}
        />
        <Stat
          label="Water left at end"
          baseline={formatVolume(b.finalBalance.storageM3)}
          response={formatVolume(i.finalBalance.storageM3)}
          delta={`${c.finalStorageDeltaM3 > 0 ? "+" : c.finalStorageDeltaM3 < 0 ? "−" : ""}${formatVolume(Math.abs(c.finalStorageDeltaM3))}`}
          tone={tone(c.finalStorageDeltaM3)}
        />
      </div>
      <ul className="timing-counts">
        <li><span className="num tone-good">{n.avoided}</span> avoided critical within this run</li>
        <li><span className="num tone-good">{n.later}</span> reached critical later</li>
        <li><span className="num">{n.same}</span> reached at the same time</li>
        <li><span className="num tone-bad">{n.earlier}</span> reached earlier</li>
        <li><span className="num tone-bad">{n.newly}</span> newly critical</li>
      </ul>
      <p className="footnote">
        "Avoided" means not critical before the {Math.round(c.horizonS / 60)}-minute horizon, not prevented forever.
      </p>
    </section>
  );
}
