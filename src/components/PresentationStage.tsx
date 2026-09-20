import { useCallback, useRef, useState } from "react";
import type { SimulationConfig, SimulationFrame, SimulationResult } from "../shared/simulation";
import { crossingTime } from "../app/comparison";
import { formatModelTime } from "../app/format";
import type { ScenarioDraft } from "../app/scenarios";
import { FloodAtlas, type AtlasCamera } from "./FloodAtlas";

interface Side { readonly result: SimulationResult; readonly frame: SimulationFrame }
interface Props {
  readonly config: SimulationConfig;
  readonly draft: ScenarioDraft;
  /** Both sides must belong to the current, comparable scenario pair. */
  readonly baseline: Side | null;
  readonly response: Side | null;
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
  readonly cursorTimeS: number;
  readonly rainNow: number | null;
  readonly running: boolean;
  readonly showReports: boolean;
  readonly noMitigation: boolean;
  readonly onSeek: (timeS: number) => void;
}

function crossingLabel(time: number | null): string {
  return time === null ? "Not reached" : time === 0 ? "Already critical" : `T+${formatModelTime(time)}`;
}

function delayLabel(seconds: number): string {
  const rounded = Math.round(Math.abs(seconds));
  return `${Math.floor(rounded / 60)} min ${rounded % 60} s`;
}

export function PresentationStage(props: Props) {
  const { config, baseline, response, selectedId, onSelect } = props;
  const [camera, setCamera] = useState<AtlasCamera | null>(null);
  const homeCamera = useRef<AtlasCamera | null>(null);
  const syncCamera = useCallback((next: AtlasCamera) => {
    homeCamera.current ??= { ...next, pitch: 0, bearing: 0 };
    setCamera(next);
  }, []);
  const [threeD, setThreeD] = useState(false);
  const [colouring, setColouring] = useState<"depth" | "risk">("depth");
  const ready = baseline !== null && response !== null;
  const b = baseline?.result.summary;
  const r = response?.result.summary;
  const selected = config.regions.find((region) => region.id === selectedId);
  const bc = b?.regions.find((region) => region.regionId === selectedId);
  const rc = r?.regions.find((region) => region.regionId === selectedId);
  const bt = bc ? crossingTime(bc.firstCritical) : null;
  const rt = rc ? crossingTime(rc.firstCritical) : null;
  const delay = bt !== null && rt !== null ? rt - bt : null;
  const peakChange = b && r ? (r.peakWaterDepthM - b.peakWaterDepthM) * 100 : 0;
  const criticalChange = b && r ? r.everCriticalRegionCount - b.everCriticalRegionCount : 0;
  const timingText = !ready || !bc || !rc ? "Select a cell after the run completes"
    : delay !== null ? delay === 0 ? "Same critical time" : `${delayLabel(delay)} ${delay > 0 ? "later" : "earlier"}`
    : bt !== null ? "Not reached with response within this run"
    : rt !== null ? "Newly critical with response"
    : "Neither reaches critical within this run";
  const timingTone = delay !== null ? delay > 0 ? "good" : delay < 0 ? "bad" : "neutral"
    : bt !== null ? "good" : rt !== null ? "bad" : "neutral";

  return (
    <section className="presentation-stage" aria-label="Presentation comparison">
      <div className="presentation-heading">
        <div><p className="presentation-kicker">Bellandur–Marathahalli · Bengaluru</p>
          <h2>Same storm. What changes with a response?</h2></div>
        <span className="badge">{Math.round(config.durationS / 60)} min scenario · {config.regions.length} cells</span>
      </div>
      <p className="presentation-plan">
        {props.draft.storm === "event-2022" ? "Illustrative 2022 replay" : `${props.draft.peakIntensityMmPerHour} mm/h peak rainfall`}
        {" · Response: "}{props.noMitigation ? "no additional actions" : <>
          drains {props.draft.drainUpgradeFactor}× · detention on {Math.round(props.draft.detentionShare * 100)}% of cells
          {props.draft.detentionShare > 0 ? ` (${props.draft.detentionHoldPct}% less surface outflow)` : ""}
          {` · ${props.draft.pumpCount} pumps`}
          {props.draft.clearDrainsAtMin !== null && props.draft.basinDrainCondition !== "working" &&
            (props.draft.basinDrainCondition !== "fails-mid-storm" || props.draft.clearDrainsAtMin > props.draft.drainFailureMin)
            ? ` · clear drains at ${props.draft.clearDrainsAtMin} min` : ""}
        </>}
      </p>
      <div className="presentation-metrics" aria-label="Full simulation results">
        <article>
          <span className="stat-label">Peak depth · anywhere in the full run</span>
          <strong>{ready ? <>{b!.peakWaterDepthM.toFixed(2)} <span>→</span> {r!.peakWaterDepthM.toFixed(2)} <small>m</small></> : "—"}</strong>
          <span className={`tone-${peakChange < 0 ? "good" : peakChange > 0 ? "bad" : "neutral"}`}>
            {ready ? peakChange === 0 ? "No change in peak depth" : `${Math.abs(peakChange).toFixed(1)} cm ${peakChange < 0 ? "lower" : "higher"}` : "Awaiting current comparison"}
          </span>
        </article>
        <article>
          <span className="stat-label">Cells ever critical · full run</span>
          <strong>{ready ? <>{b!.everCriticalRegionCount} <span>→</span> {r!.everCriticalRegionCount}</> : "—"}</strong>
          <span className={`tone-${criticalChange < 0 ? "good" : criticalChange > 0 ? "bad" : "neutral"}`}>
            {ready ? criticalChange === 0 ? "Same count; timing and severity can change" : `${Math.abs(criticalChange)} ${criticalChange < 0 ? "fewer" : "more"} cells critical` : "Awaiting current comparison"}
          </span>
        </article>
        <article>
          <label className="presentation-cell">Critical time · <select aria-label="Presentation region" value={selectedId ?? ""} onChange={(e) => onSelect(e.target.value)}>
            {!selectedId ? <option value="">Select a cell</option> : null}
            {config.regions.map((region) => <option key={region.id} value={region.id}>{region.label}</option>)}
          </select></label>
          <strong className="presentation-crossing">{ready && bc && rc ? <>{crossingLabel(bt)} <span>→</span> {crossingLabel(rt)}</> : "—"}</strong>
          <span className={`tone-${timingTone}`}>{timingText}</span>
        </article>
      </div>
      <div className="presentation-map-tools">
        <div className="segmented" role="group" aria-label="Presentation map colouring">
          {(["depth", "risk"] as const).map((mode) => <button type="button" className={`chip${colouring === mode ? " is-on" : ""}`} aria-pressed={colouring === mode} key={mode} onClick={() => setColouring(mode)}>{mode === "depth" ? "Water depth" : "Risk level"}</button>)}
        </div>
        <button type="button" className="chip" aria-pressed={threeD} onClick={() => {
          setThreeD(!threeD);
          setCamera((current) => current ? { ...current, pitch: threeD ? 0 : 55, bearing: threeD ? 0 : -18 } : current);
        }}>{threeD ? "Switch to 2D" : "Switch to 3D"}</button>
        <button type="button" className="chip" disabled={!ready || bt === null} onClick={() => bt !== null && props.onSeek(bt)}>Jump to critical time</button>
        <button type="button" className="chip" disabled={!camera} onClick={() => {
          setThreeD(false); setCamera(homeCamera.current);
        }}>Reset map view</button>
        <span className="muted">Linked camera &amp; time · baseline → response</span>
      </div>
      {!ready ? <p className="notice" role="status">{props.running ? "Computing both scenarios…" : "Run the current scenario to show a synchronized comparison."}</p> : null}
      <div className="presentation-maps">
        {(["baseline", "response"] as const).map((overlay) => {
          const side = overlay === "baseline" ? baseline : response;
          return <div className={`presentation-map presentation-${overlay}`} key={overlay}>
            <header><strong>{overlay === "baseline" ? "Baseline" : "With response plan"}</strong>
              <span>{side ? `${side.frame.riskCounts.critical} critical now · T+${formatModelTime(props.cursorTimeS)}` : "Awaiting results"}</span></header>
            <FloodAtlas config={config} baseline={baseline} response={response} thresholds={config.riskThresholds}
              selectedId={selectedId} onSelect={onSelect} cursorTimeS={props.cursorTimeS} rainNow={props.rainNow}
              running={props.running} showReports={props.showReports}
              presentation={{ overlay, camera, onCameraChange: syncCamera, threeD, colouring }} />
          </div>;
        })}
      </div>
      <div className="presentation-legend">
        {colouring === "depth" ? <span>Shared depth scale: 0 <i className="atlas-ramp-water" /> {(config.riskThresholds.criticalDepthM * 200).toFixed(0)}+ cm</span>
          : <span className="presentation-risk-key">
            <span><b style={{ background: "#34d399" }} />Safe &lt; {config.riskThresholds.warningDepthM * 100} cm</span>
            <span><b style={{ background: "#fbbf24" }} />Warning</span>
            <span><b style={{ background: "#f43f5e" }} />Critical ≥ {config.riskThresholds.criticalDepthM * 100} cm</span>
          </span>}
        <span>{selected ? `${selected.label} selected · ` : ""}Click either map to inspect a cell{threeD ? " · Heights exaggerated" : ""}</span>
      </div>
      {ready && props.noMitigation ? <p className="footnote">No response actions: both maps show the same simulation.</p> : null}
    </section>
  );
}
