import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  SimulationConfig,
  SimulationFrame,
  SimulationResult,
  SimulationRun,
} from "../shared/simulation";
import { canonicalJson } from "./canonical";
import { deriveComparison, crossingTime } from "./comparison";
import { formatModelTime } from "./format";
import { buildScenarioPair, DEFAULT_DRAFT, GRID, type ScenarioDraft } from "./scenarios";
import { BENGALURU_TERRAIN } from "../data/bengaluru-terrain";
import { SimulationClient, type RunOutcome } from "./simulationClient";
import { AIPanel } from "../components/AIPanel";
import { ComparisonPanel } from "../components/ComparisonPanel";
import { DiagnosticsPanel } from "../components/DiagnosticsPanel";
import { FloodMap, type MapMode } from "../components/FloodMap";
import { HowItWorks } from "../components/HowItWorks";
import { PresetBar } from "../components/PresetBar";
import { RegionDetail } from "../components/RegionDetail";
import { RiskTimeline } from "../components/RiskTimeline";
import { ScenarioForm } from "../components/ScenarioForm";
import { SensitivityPanel, type SensitivityRow } from "../components/SensitivityPanel";
import { TimeControls } from "../components/TimeControls";
import { ValidationPanel } from "../components/ValidationPanel";
import { WarningTable } from "../components/WarningTable";
import { depthScaleMax } from "../components/colors";

// MapLibre is large; load the atlas separately so the controls appear at once.
const FloodAtlas = lazy(() => import("../components/FloodAtlas").then((m) => ({ default: m.FloodAtlas })));

type SlotName = "baseline" | "intervention";

interface RunInput {
  readonly requestId: string;
  readonly config: SimulationConfig;
  readonly draft: ScenarioDraft;
  readonly key: string;
}

type Slot =
  | { readonly phase: "idle" }
  | ({ readonly phase: "running" } & RunInput)
  | ({ readonly phase: "done"; readonly run: SimulationRun } & RunInput)
  | ({ readonly phase: "error"; readonly message: string } & RunInput)
  | ({ readonly phase: "cancelled" } & RunInput);

type Slots = Readonly<Record<SlotName, Slot>>;

const IDLE: Slots = { baseline: { phase: "idle" }, intervention: { phase: "idle" } };
const AUTO_RUN_DELAY_MS = 600;

const SENSITIVITY_VARIANTS: readonly { label: string; change: Partial<ScenarioDraft> | ((d: ScenarioDraft) => Partial<ScenarioDraft>) }[] = [
  { label: "As configured", change: {} },
  { label: "Conductance × 0.5", change: { conductanceScale: 0.5 } },
  { label: "Conductance × 2", change: { conductanceScale: 2 } },
  { label: "Drain capacity − 25%", change: (d) => ({ drainDesignMmPerHour: d.drainDesignMmPerHour * 0.75 }) },
  { label: "Drain capacity + 25%", change: (d) => ({ drainDesignMmPerHour: d.drainDesignMmPerHour * 1.25 }) },
];

function settle(outcome: RunOutcome, input: RunInput): Slot {
  switch (outcome.kind) {
    case "completed":
      return { phase: "done", ...input, run: outcome.run };
    case "app-error":
      return { phase: "error", ...input, message: outcome.message };
    case "cancelled":
      return { phase: "cancelled", ...input };
  }
}

function successOf(slot: Slot): { config: SimulationConfig; draft: ScenarioDraft; result: SimulationResult } | null {
  return slot.phase === "done" && slot.run.status === "success"
    ? { config: slot.config, draft: slot.draft, result: slot.run.result }
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
  const [presetId, setPresetId] = useState<string | null>("heavy");
  const [autoRun, setAutoRun] = useState(true);
  const [slots, setSlots] = useState<Slots>(IDLE);
  const [mapMode, setMapMode] = useState<MapMode>("depth");
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(2);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sensitivity, setSensitivity] = useState<{ key: string; rows: SensitivityRow[]; running: boolean }>({ key: "", rows: [], running: false });
  const clients = useRef<Record<SlotName | "sensitivity", SimulationClient> | null>(null);

  useEffect(() => {
    const created = {
      baseline: new SimulationClient("baseline"),
      intervention: new SimulationClient("intervention"),
      sensitivity: new SimulationClient("sensitivity"),
    };
    clients.current = created;
    return () => Object.values(created).forEach((c) => c.dispose());
  }, []);

  const pair = useMemo(() => buildScenarioPair(draft), [draft]);
  const currentKeys = useMemo(
    () => ({ baseline: canonicalJson(pair.baseline), intervention: canonicalJson(pair.intervention) }),
    [pair],
  );

  const running = slots.baseline.phase === "running" || slots.intervention.phase === "running";

  const runSlot = useCallback((name: SlotName, config: SimulationConfig, runDraft: ScenarioDraft) => {
    const client = clients.current?.[name];
    if (!client) return;
    const key = canonicalJson(config);
    const { requestId, outcome } = client.run(config);
    const input: RunInput = { requestId, config, draft: runDraft, key };
    setSlots((s) => ({ ...s, [name]: { phase: "running", ...input } }));
    void outcome.then((o) => {
      setSlots((s) => {
        const current = s[name];
        if (current.phase !== "running" || current.requestId !== requestId) return s; // stale reply
        return { ...s, [name]: settle(o, input) };
      });
    });
  }, []);

  const runAll = useCallback(() => {
    setPlaying(false);
    runSlot("baseline", pair.baseline, draft);
    if (pair.noMitigation) {
      clients.current?.intervention.cancel();
      setSlots((s) => ({ ...s, intervention: { phase: "idle" } }));
    } else {
      runSlot("intervention", pair.intervention, draft);
    }
  }, [pair, draft, runSlot]);

  // Auto-run: engine runs take about a second, so re-run shortly after edits settle.
  const lastAutoKey = useRef("");
  useEffect(() => {
    if (!autoRun || !clients.current) return;
    const key = currentKeys.baseline + currentKeys.intervention;
    if (key === lastAutoKey.current) return;
    const id = window.setTimeout(() => {
      lastAutoKey.current = key;
      runAll();
    }, lastAutoKey.current ? AUTO_RUN_DELAY_MS : 0);
    return () => window.clearTimeout(id);
  }, [autoRun, currentKeys, runAll]);

  const cancelAll = () => {
    clients.current?.baseline.cancel();
    clients.current?.intervention.cancel();
  };

  const runSensitivity = async () => {
    const client = clients.current?.sensitivity;
    if (!client) return;
    const key = currentKeys.baseline;
    const rows: SensitivityRow[] = SENSITIVITY_VARIANTS.map((v) => ({ label: v.label, result: null }));
    setSensitivity({ key, rows: [...rows], running: true });
    for (let i = 0; i < SENSITIVITY_VARIANTS.length; i += 1) {
      const v = SENSITIVITY_VARIANTS[i]!;
      const change = typeof v.change === "function" ? v.change(draft) : v.change;
      const outcome = await client.run(buildScenarioPair({ ...draft, ...change }).baseline).outcome;
      if (outcome.kind === "cancelled") return;
      rows[i] = outcome.kind === "completed" && outcome.run.status === "success"
        ? { label: v.label, result: outcome.run.result }
        : { label: v.label, result: null, error: outcome.kind === "completed" ? outcome.run.status : "failed" };
      setSensitivity({ key, rows: [...rows], running: i < SENSITIVITY_VARIANTS.length - 1 });
    }
  };

  // ---- Displayed data ----
  const base = successOf(slots.baseline);
  const resp = successOf(slots.intervention);
  const baseStale = slots.baseline.phase !== "idle" && slots.baseline.key !== currentKeys.baseline;
  const respStale = slots.intervention.phase !== "idle" && slots.intervention.key !== currentKeys.intervention;

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
    ? base.config.rainfall.find((r) => r.startTimeS <= cursorTimeS && cursorTimeS < r.endTimeS)?.intensityMmPerHour ?? null
    : null;
  const thresholds = base?.result.riskThresholds ?? pair.baseline.riskThresholds;
  const runsForPanels = [
    ...(base ? [{ label: "Baseline", result: base.result }] : []),
    ...(resp ? [{ label: "Response", result: resp.result }] : []),
  ];
  const isReplay = base?.draft.storm === "event-2022";
  const verified = resp && !respStale ? resp.result : null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true">≋</span>
          <div>
            <h1>FlowShield</h1>
            <p>Bengaluru flood simulation, early warning &amp; response planning</p>
          </div>
        </div>
        <div className="badges">
          <span className="badge">{pair.baseline.regions.length} cells · real terrain</span>
          <span className="badge">Mass-conserving engine</span>
          <span className="badge badge-ai">AI surrogate</span>
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar">
          <PresetBar
            activeId={presetId}
            onPick={(d, id) => {
              setDraft(d);
              setPresetId(id);
              setFrameIndex(0);
            }}
          />
          <ScenarioForm
            draft={draft}
            onChange={(d) => {
              setDraft(d);
              setPresetId(null);
            }}
            disabled={false}
          />
          <div className="actions">
            <label className="check">
              <input type="checkbox" checked={autoRun} onChange={(e) => setAutoRun(e.target.checked)} />
              <span>Re-run automatically when inputs change</span>
            </label>
            {running ? (
              <button type="button" className="btn btn-danger" onClick={cancelAll}>Cancel run</button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={runAll}>
                {pair.noMitigation ? "Run simulation" : "Run baseline + response"}
              </button>
            )}
          </div>
        </aside>

        <main className="content">
          <Suspense fallback={<div className="atlas atlas-loading">Loading map…</div>}>
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
              showReports={isReplay}
            />
          </Suspense>
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
            <strong>Real map, exploratory simulation.</strong> The model covers a 10.5 × 7.5 km Bellandur–Marathahalli area using 90 m{" "}
            <a href="https://open-meteo.com/en/docs/elevation-api" target="_blank" rel="noreferrer">Copernicus DEM / Open-Meteo</a> samples
            averaged into {GRID.cellM} m cells ({BENGALURU_TERRAIN.samplesPerCell} samples each). Rainfall, drain capacity,
            conductance, and blockages are assumptions you control. Published drain lines are geographic context, not a
            calibrated hydraulic network. Edges are open: water can leave toward lower ground outside the area, but
            inflow from beyond it is not simulated.
          </div>
          <SlotProblem name="Baseline" slot={slots.baseline} />
          <SlotProblem name="Response" slot={slots.intervention} />
          {(baseStale || respStale) && !running ? (
            <div className="notice notice-warn" role="status">
              Inputs have changed since these results were computed. Run again to update them.
            </div>
          ) : null}

          <AIPanel
            draft={draft}
            verified={verified}
            onApply={(d) => {
              setDraft(d);
              setPresetId(null);
              if (!autoRun) window.setTimeout(() => document.querySelector<HTMLButtonElement>(".actions .btn-primary")?.click(), 0);
            }}
          />

          {base && baseFrame ? (
            <>
              {isReplay ? <ValidationPanel result={base.result} /> : null}
              <ComparisonPanel
                outcome={comparison}
                baseline={base.result}
                intervention={resp?.result ?? null}
                noMitigation={pair.noMitigation}
              />
              <RiskTimeline
                series={[
                  { label: "Baseline", result: base.result, dashed: false },
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
              <SensitivityPanel
                rows={sensitivity.key === currentKeys.baseline ? sensitivity.rows : []}
                running={sensitivity.running}
                onRun={() => void runSensitivity()}
              />
              <HowItWorks />
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
                    title="Baseline"
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
              <DiagnosticsPanel runs={runsForPanels} />
            </>
          ) : !running ? (
            <HowItWorks />
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
        <span className="legend-item">Mean DEM elevation per cell</span>
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
