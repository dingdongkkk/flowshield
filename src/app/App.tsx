import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  SimulationConfig,
  SimulationFrame,
  SimulationResult,
  SimulationRun,
} from "../shared/simulation";
import { canonicalJson } from "./canonical";
import { deriveComparison, crossingTime } from "./comparison";
import { formatModelTime } from "./format";
import { ILLUSTRATIVE_CONFIG, ILLUSTRATIVE_RUN } from "./illustrativeFixture";
import { buildScenarioPair, DEFAULT_DRAFT, GRID, type ScenarioDraft } from "./scenarios";
import { BENGALURU_TERRAIN } from "../data/bengaluru-terrain";
import { SimulationClient, type RunOutcome } from "./simulationClient";
import { ComparisonPanel } from "../components/ComparisonPanel";
import { DiagnosticsPanel } from "../components/DiagnosticsPanel";
import { FloodMap, type MapMode } from "../components/FloodMap";
import { RegionDetail } from "../components/RegionDetail";
import { RiskTimeline } from "../components/RiskTimeline";
import { ScenarioForm } from "../components/ScenarioForm";
import { TimeControls } from "../components/TimeControls";
import { WarningTable } from "../components/WarningTable";
import { depthScaleMax } from "../components/colors";
import { FloodAtlas } from "../components/FloodAtlas";

const ENGINE_PRESENT = Object.keys(import.meta.glob("../simulation/index.ts")).length > 0;

type SlotName = "baseline" | "intervention";

type Slot =
  | { readonly phase: "idle" }
  | { readonly phase: "running"; readonly requestId: string; readonly config: SimulationConfig; readonly key: string }
  | { readonly phase: "done"; readonly requestId: string; readonly config: SimulationConfig; readonly key: string; readonly run: SimulationRun }
  | { readonly phase: "error"; readonly requestId: string; readonly config: SimulationConfig; readonly key: string; readonly message: string }
  | { readonly phase: "cancelled"; readonly config: SimulationConfig; readonly key: string };

type Slots = Readonly<Record<SlotName, Slot>>;

const IDLE: Slots = { baseline: { phase: "idle" }, intervention: { phase: "idle" } };

function settle(outcome: RunOutcome, config: SimulationConfig, key: string): Slot {
  switch (outcome.kind) {
    case "completed":
      return { phase: "done", requestId: outcome.requestId, config, key, run: outcome.run };
    case "app-error":
      return { phase: "error", requestId: outcome.requestId, config, key, message: outcome.message };
    case "cancelled":
      return { phase: "cancelled", config, key };
  }
}

function successOf(slot: Slot): { config: SimulationConfig; result: SimulationResult } | null {
  return slot.phase === "done" && slot.run.status === "success"
    ? { config: slot.config, result: slot.run.result }
    : null;
}

/** Last saved frame at or before the given time. */
function frameAt(result: SimulationResult, timeS: number): SimulationFrame {
  const frames = result.frames;
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frames[mid]!.timeS <= timeS) lo = mid;
    else hi = mid - 1;
  }
  return frames[lo]!;
}

function SlotProblem({ name, slot }: { name: string; slot: Slot }) {
  if (slot.phase === "error") {
    return (
      <div className="notice notice-error" role="alert">
        <strong>{name}: application error.</strong> {slot.message}
      </div>
    );
  }
  if (slot.phase === "cancelled") {
    return <div className="notice">{name}: run cancelled.</div>;
  }
  if (slot.phase !== "done") return null;
  const { run } = slot;
  if (run.status === "invalid-config") {
    return (
      <div className="notice notice-error" role="alert">
        <strong>{name}: the engine rejected this configuration.</strong>
        <ul className="issues">
          {run.issues.map((issue, i) => (
            <li key={`${issue.path}-${issue.code}-${i}`}>
              <code>{issue.path || "/"}</code> <span className="code">{issue.code}</span> {issue.message}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (run.status === "numerical-failure") {
    return (
      <div className="notice notice-error" role="alert">
        <strong>{name}: numerical failure ({run.error.code})</strong> at T+
        {formatModelTime(run.error.lastAcceptedTimeS)}. {run.error.message} No partial result is
        shown. Adjust the inputs (for example, a smaller max integration step) and run again.
      </div>
    );
  }
  return null;
}

export function App() {
  const [draft, setDraft] = useState<ScenarioDraft>(DEFAULT_DRAFT);
  const [slots, setSlots] = useState<Slots>(IDLE);
  const [fixtureMode, setFixtureMode] = useState(false);
  const [mapMode, setMapMode] = useState<MapMode>("depth");
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(2);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const clients = useRef<Record<SlotName, SimulationClient> | null>(null);

  useEffect(() => {
    const created = {
      baseline: new SimulationClient("baseline"),
      intervention: new SimulationClient("intervention"),
    };
    clients.current = created;
    return () => {
      created.baseline.dispose();
      created.intervention.dispose();
    };
  }, []);

  const pair = useMemo(() => buildScenarioPair(draft), [draft]);
  const currentKeys = useMemo(
    () => ({ baseline: canonicalJson(pair.baseline), intervention: canonicalJson(pair.intervention) }),
    [pair],
  );

  const running = slots.baseline.phase === "running" || slots.intervention.phase === "running";

  const runSlot = useCallback((name: SlotName, config: SimulationConfig) => {
    const client = clients.current?.[name];
    if (!client) return;
    const key = canonicalJson(config);
    const { requestId, outcome } = client.run(config);
    setSlots((s) => ({ ...s, [name]: { phase: "running", requestId, config, key } }));
    void outcome.then((o) => {
      setSlots((s) => {
        const current = s[name];
        if (current.phase !== "running" || current.requestId !== requestId) return s; // stale reply
        return { ...s, [name]: settle(o, config, key) };
      });
    });
  }, []);

  const runAll = () => {
    setFixtureMode(false);
    setPlaying(false);
    setFrameIndex(0);
    runSlot("baseline", pair.baseline);
    if (pair.noMitigation) {
      clients.current?.intervention.cancel();
      setSlots((s) => ({ ...s, intervention: { phase: "idle" } }));
    } else {
      runSlot("intervention", pair.intervention);
    }
  };

  const cancelAll = () => {
    clients.current?.baseline.cancel();
    clients.current?.intervention.cancel();
  };

  // ---- Displayed data (engine results, or the explicitly labelled fixture) ----
  const base = fixtureMode
    ? { config: ILLUSTRATIVE_CONFIG as SimulationConfig, result: ILLUSTRATIVE_RUN.result as SimulationResult }
    : successOf(slots.baseline);
  const resp = fixtureMode ? null : successOf(slots.intervention);
  const baseStale = !fixtureMode && slots.baseline.phase !== "idle" && "key" in slots.baseline && slots.baseline.key !== currentKeys.baseline;
  const respStale = !fixtureMode && slots.intervention.phase !== "idle" && "key" in slots.intervention && slots.intervention.key !== currentKeys.intervention;

  const comparison = useMemo(
    () => (base && resp ? deriveComparison(base.config, base.result, resp.config, resp.result) : null),
    [base?.result, resp?.result], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const times = base?.result.frames.map((f) => f.timeS) ?? [];
  const safeIndex = Math.min(frameIndex, Math.max(0, times.length - 1));
  const cursorTimeS = times[safeIndex] ?? 0;
  const baseFrame = base ? frameAt(base.result, cursorTimeS) : null;
  const respFrame = resp ? frameAt(resp.result, cursorTimeS) : null;

  // Pick the earliest-warning region once results arrive, if nothing is selected.
  useEffect(() => {
    if (!base) return;
    const ids = new Set(base.config.regions.map((r) => r.id));
    if (selectedId && ids.has(selectedId)) return;
    const earliest = [...base.result.summary.regions]
      .map((r) => ({ id: r.regionId, t: crossingTime(r.firstCritical) }))
      .filter((r): r is { id: string; t: number } => r.t !== null)
      .sort((a, b) => a.t - b.t)[0];
    setSelectedId(earliest?.id ?? base.config.regions[0]?.id ?? null);
  }, [base, selectedId]);

  const labels = useMemo(
    () => new Map((base?.config.regions ?? []).map((r) => [r.id, r.label])),
    [base?.config],
  );
  const selectedRegion = base?.config.regions.find((r) => r.id === selectedId) ?? null;
  const rainNow = base
    ? base.config.rainfall.find((r) => r.startTimeS <= cursorTimeS && cursorTimeS < r.endTimeS)?.intensityMmPerHour ??
      null
    : null;
  const thresholds = base?.result.riskThresholds ?? pair.baseline.riskThresholds;
  const runsForPanels = [
    ...(base ? [{ label: fixtureMode ? "Fixture" : "Baseline", result: base.result }] : []),
    ...(resp ? [{ label: "Response", result: resp.result }] : []),
  ];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true">≋</span>
          <div>
            <h1>FlowShield</h1>
            <p>Bengaluru · flood scenarios &amp; drainage atlas</p>
          </div>
        </div>
        <div className="badges">
          <span className="badge">Bengaluru terrain · {pair.baseline.regions.length} model cells</span>
          <span className="badge">Model linear-storage-v1</span>
          <span className={`badge ${ENGINE_PRESENT ? "badge-ok" : "badge-warn"}`}>
            {ENGINE_PRESENT ? "Engine linked" : "Engine not integrated"}
          </span>
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar">
          <ScenarioForm draft={draft} onChange={setDraft} disabled={running} />
          <div className="actions">
            {running ? (
              <button type="button" className="btn btn-danger" onClick={cancelAll}>Cancel run</button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={runAll}>
                {pair.noMitigation ? "Run simulation" : "Run baseline + response"}
              </button>
            )}
            {!ENGINE_PRESENT ? (
              <button type="button" className="btn btn-quiet" onClick={() => setFixtureMode(!fixtureMode)}>
                {fixtureMode ? "Hide illustrative fixture" : "Preview UI with illustrative fixture"}
              </button>
            ) : null}
          </div>
        </aside>

        <main className="content">
          <FloodAtlas
            config={base?.config ?? pair.baseline}
            baseline={base && baseFrame ? { result: base.result, frame: baseFrame } : null}
            response={resp && respFrame ? { result: resp.result, frame: respFrame } : null}
            thresholds={thresholds}
            selectedId={selectedId}
            onSelect={setSelectedId}
            cursorTimeS={cursorTimeS}
            rainNow={rainNow}
            running={running}
          />
          {base && baseFrame ? (
            <TimeControls
              times={times}
              index={safeIndex}
              onIndex={setFrameIndex}
              playing={playing}
              onPlaying={setPlaying}
              speed={speed}
              onSpeed={setSpeed}
              rainAtTime={rainNow}
            />
          ) : null}
          <div className="notice bengaluru-model-note">
            <strong>Real map, exploratory simulation.</strong> The model covers a 10.5 × 7.5 km Bellandur–Marathahalli area
            using 90 m <a href="https://open-meteo.com/en/docs/elevation-api" target="_blank" rel="noreferrer">Copernicus DEM / Open-Meteo</a> samples
            averaged into {GRID.cellM} m cells ({BENGALURU_TERRAIN.samplesPerCell} samples each). Rainfall, drain capacity,
            conductance, and blockages are assumptions you control. Published drain lines are geographic context, not a
            calibrated hydraulic network. Edges are open: water can leave toward lower ground outside the area, but
            inflow from beyond it is not simulated.
          </div>
          {fixtureMode ? (
            <div className="notice notice-warn" role="status">
              <strong>Illustrative contract fixture, not engine output.</strong> These are hand-written
              values for one sealed cell with no rain, used only to check the interface layout.
            </div>
          ) : null}
          {!ENGINE_PRESENT && !fixtureMode && slots.baseline.phase === "idle" ? (
            <div className="notice" role="status">
              The simulation engine (<code>src/simulation/index.ts</code>) hasn't been integrated yet.
              Running now will report that it's missing instead of showing results.
            </div>
          ) : null}
          {running ? <div className="notice" role="status"><span className="spinner" /> Simulating…</div> : null}
          {fixtureMode ? null : (
            <>
              <SlotProblem name="Baseline" slot={slots.baseline} />
              <SlotProblem name="Response" slot={slots.intervention} />
            </>
          )}
          {baseStale || respStale ? (
            <div className="notice notice-warn" role="status">
              Inputs have changed since these results were computed. Run again to update them.
            </div>
          ) : null}

          {base && baseFrame ? (
            <>
              <details className="schematic">
                <summary>Schematic grid view (side by side)</summary>
              <div className="map-toolbar">
                <div className="segmented" role="group" aria-label="Map colouring">
                  {(["depth", "risk", "terrain"] as const).map((m) => (
                    <button key={m} type="button" className={`chip${mapMode === m ? " is-on" : ""}`} onClick={() => setMapMode(m)}>
                      {m === "depth" ? "Water depth" : m === "risk" ? "Risk level" : "Terrain"}
                    </button>
                  ))}
                </div>
                <MapLegend mode={mapMode} scaleMax={depthScaleMax(thresholds)} warning={thresholds.warningDepthM} critical={thresholds.criticalDepthM} />
              </div>
              <div className={`maps${resp ? " maps-2" : ""}`}>
                <FloodMap
                  title={fixtureMode ? "Illustrative fixture" : "Baseline"}
                  subtitle={`${baseFrame.riskCounts.critical} critical · ${baseFrame.riskCounts.warning} warning`}
                  regions={base.config.regions}
                  outlets={base.config.boundaryOutlets}
                  frame={baseFrame}
                  thresholds={thresholds}
                  mode={mapMode}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  stale={baseStale}
                />
                {resp && respFrame ? (
                  <FloodMap
                    title="With response plan"
                    subtitle={`${respFrame.riskCounts.critical} critical · ${respFrame.riskCounts.warning} warning`}
                    regions={resp.config.regions}
                    outlets={resp.config.boundaryOutlets}
                    frame={respFrame}
                    thresholds={thresholds}
                    mode={mapMode}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    stale={respStale}
                  />
                ) : null}
              </div>
              </details>
              <RiskTimeline
                series={[
                  { label: fixtureMode ? "Fixture" : "Baseline", result: base.result, dashed: false },
                  ...(resp ? [{ label: "With response plan", result: resp.result, dashed: true }] : []),
                ]}
                rainfall={base.config.rainfall}
                cursorTimeS={cursorTimeS}
                onSeek={(t) => {
                  setPlaying(false);
                  const idx = times.findIndex((x) => x >= t);
                  setFrameIndex(idx < 0 ? times.length - 1 : idx);
                }}
              />
              <ComparisonPanel
                outcome={comparison}
                baseline={base.result}
                intervention={resp?.result ?? null}
                noMitigation={pair.noMitigation}
              />
              <div className="two-col">
                <WarningTable
                  labels={labels}
                  baseline={{ result: base.result, frame: baseFrame }}
                  intervention={resp && respFrame ? { result: resp.result, frame: respFrame } : null}
                  comparison={comparison?.ok ? comparison.comparison : null}
                  cursorTimeS={cursorTimeS}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                />
                <RegionDetail region={selectedRegion} runs={runsForPanels} cursorTimeS={cursorTimeS} />
              </div>
              <DiagnosticsPanel runs={runsForPanels} />
            </>
          ) : !running ? (
            <EmptyState />
          ) : null}
        </main>
      </div>
    </div>
  );
}

function MapLegend(props: { mode: MapMode; scaleMax: number; warning: number; critical: number }) {
  if (props.mode === "risk") {
    return (
      <div className="legend">
        {(["safe", "warning", "critical"] as const).map((r) => (
          <span key={r} className="legend-item">
            <span className={`swatch swatch-${r}`} />
            {r === "safe" ? `Safe < ${Math.round(props.warning * 100)} cm` : r === "warning" ? "Warning" : `Critical ≥ ${Math.round(props.critical * 100)} cm`}
          </span>
        ))}
      </div>
    );
  }
  if (props.mode === "terrain") {
    return (
      <div className="legend">
        <span className="legend-item"><span className="ramp ramp-terrain" /> low → high ground</span>
        <span className="legend-item">Sampled DEM elevations</span>
      </div>
    );
  }
  return (
    <div className="legend">
      <span className="legend-item">
        0 <span className="ramp ramp-water" /> {Math.round(props.scaleMax * 100)} cm+
      </span>
      <span className="legend-item"><span className="swatch outline-warning" /> Warning</span>
      <span className="legend-item"><span className="swatch outline-critical" /> Critical</span>
      <span className="legend-item"><span className="swatch swatch-pump">P</span> Pump</span>
      <span className="legend-item"><span className="swatch swatch-drain">×</span> Drain blocked</span>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="empty-state">
      <h2>Set up a storm, then run it</h2>
      <ol>
        <li>Choose the rainfall profile and intensity, and the condition of the district drains.</li>
        <li>Add a response plan: mobile pumps and drain clearing.</li>
        <li>Run it to simulate the baseline and the response side by side over the same storm.</li>
      </ol>
      <p className="muted">
        Rain adds a calculated volume to each model cell. Water moves from higher to lower water surfaces
        between connected blocks, drains and pumps remove tracked volume, and the warning is the
        first time a block crosses the critical depth.
      </p>
    </div>
  );
}
