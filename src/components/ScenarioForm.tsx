import type { ReactNode } from "react";
import {
  BASIN_REGION_IDS,
  DRAIN_LABELS,
  STORM_LABELS,
  withScenarioHorizon,
  type DrainCondition,
  type ScenarioDraft,
  type StormProfile,
} from "../app/scenarios";
import { EVENT_2022 } from "../data/event-2022";

interface Props {
  readonly draft: ScenarioDraft;
  readonly onChange: (draft: ScenarioDraft) => void;
  readonly disabled: boolean;
}

function Field(props: { label: string; value?: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span className="field-head">
        <span>{props.label}</span>
        {props.value ? <span className="field-value num">{props.value}</span> : null}
      </span>
      {props.children}
      {props.hint ? <span className="field-hint">{props.hint}</span> : null}
    </label>
  );
}

export function ScenarioForm({ draft, onChange, disabled }: Props) {
  const set = <K extends keyof ScenarioDraft>(key: K, value: ScenarioDraft[K]) =>
    onChange({ ...draft, [key]: value });
  const drainIssue = draft.basinDrainCondition !== "working";

  return (
    <form className="scenario-form" onSubmit={(e) => e.preventDefault()}>
      <fieldset disabled={disabled}>
        <legend>Rainfall</legend>
        <Field label="Storm profile">
          <select
            value={draft.storm}
            onChange={(e) => {
              const storm = e.target.value as StormProfile;
              const duration = storm === "event-2022" ? EVENT_2022.hourlyMm.length * 60
                : draft.storm === "event-2022" ? 180 : draft.durationMin;
              onChange(withScenarioHorizon({ ...draft, storm }, duration));
            }}
          >
            {(Object.keys(STORM_LABELS) as StormProfile[]).map((k) => (
              <option key={k} value={k}>{STORM_LABELS[k]}</option>
            ))}
          </select>
        </Field>
        {draft.storm === "event-2022" ? (
          <p className="field-hint">
            {EVENT_2022.scaledTotalMm} mm over the night of 4–5 Sep 2022 (peak {Math.max(...EVENT_2022.hourlyMm)} mm/h),
            simulated for {EVENT_2022.hourlyMm.length} h. ERA5 timing scaled to an illustrative 100 mm total,
            informed by reporting from {EVENT_2022.news.publisher}; not a measured local hyetograph.
          </p>
        ) : (<>
        <Field label="Peak intensity" value={`${draft.peakIntensityMmPerHour} mm/h`}>
          <input
            type="range" min={5} max={200} step={5}
            value={draft.peakIntensityMmPerHour}
            onChange={(e) => set("peakIntensityMmPerHour", Number(e.target.value))}
          />
        </Field>
        <Field label="Storm length" value={`${draft.stormDurationMin} min`}>
          <input
            type="range" min={15} max={Math.min(240, draft.durationMin)} step={15}
            value={Math.min(draft.stormDurationMin, draft.durationMin)}
            onChange={(e) => set("stormDurationMin", Number(e.target.value))}
          />
        </Field>
        <Field label="Simulated horizon" hint="Shortening the horizon moves later actions to before the end and preserves failure-before-clearing order.">
          <select
            value={draft.durationMin}
            onChange={(e) => {
              const durationMin = Number(e.target.value);
              onChange(withScenarioHorizon(draft, durationMin));
            }}
          >
            {[60, 120, 180, 240, 360].map((m) => <option key={m} value={m}>{m / 60} h</option>)}
          </select>
        </Field>
        </>)}
      </fieldset>

      <fieldset disabled={disabled}>
        <legend>Drainage</legend>
        <Field label="Assumed drain capacity" value={`${draft.drainDesignMmPerHour} mm/h`} hint="Scenario assumption; not a measured capacity from the drainage map">
          <input
            type="range" min={0} max={60} step={5}
            value={draft.drainDesignMmPerHour}
            onChange={(e) => set("drainDesignMmPerHour", Number(e.target.value))}
          />
        </Field>
        <Field label={`Lowest-lying ${BASIN_REGION_IDS.size} cells: drain condition`}>
          <select
            value={draft.basinDrainCondition}
            onChange={(e) => set("basinDrainCondition", e.target.value as DrainCondition)}
          >
            {(Object.keys(DRAIN_LABELS) as DrainCondition[]).map((k) => (
              <option key={k} value={k}>{DRAIN_LABELS[k]}</option>
            ))}
          </select>
        </Field>
        {draft.basinDrainCondition === "fails-mid-storm" ? (
          <Field label="Drains fail at" value={`T+${draft.drainFailureMin} min`}>
            <input
              type="range" min={0} max={draft.durationMin - 5} step={5}
              value={draft.drainFailureMin}
              onChange={(e) => set("drainFailureMin", Number(e.target.value))}
            />
          </Field>
        ) : null}
      </fieldset>

      <fieldset disabled={disabled}>
        <legend>Response plan</legend>
        <Field label="Mobile pumps" value={String(draft.pumpCount)} hint="Placed in the lowest-lying cells">
          <input
            type="range" min={0} max={BASIN_REGION_IDS.size} step={1}
            value={draft.pumpCount}
            onChange={(e) => set("pumpCount", Number(e.target.value))}
          />
        </Field>
        {draft.pumpCount > 0 ? (
          <>
            <Field label="Capacity per pump" value={`${draft.pumpCapacityM3PerS.toFixed(2)} m³/s`}>
              <input
                type="range" min={0.05} max={1.5} step={0.05}
                value={draft.pumpCapacityM3PerS}
                onChange={(e) => set("pumpCapacityM3PerS", Number(e.target.value))}
              />
            </Field>
            <Field label="Deploy at" value={`T+${draft.pumpDeployMin} min`}>
              <input
                type="range" min={0} max={draft.durationMin - 5} step={5}
                value={draft.pumpDeployMin}
                onChange={(e) => set("pumpDeployMin", Number(e.target.value))}
              />
            </Field>
          </>
        ) : null}
        <Field
          label="Drain upgrade (low-lying cells)"
          value={draft.drainUpgradeFactor === 1 ? "None" : `${draft.drainUpgradeFactor}× capacity`}
          hint="Larger drains in the low-lying district, in place before the storm"
        >
          <input
            type="range" min={1} max={4} step={0.5}
            value={draft.drainUpgradeFactor}
            onChange={(e) => set("drainUpgradeFactor", Number(e.target.value))}
          />
        </Field>
        <Field
          label="Upstream detention"
          value={draft.detentionShare === 0 ? "None" : `Highest ${Math.round(draft.detentionShare * 100)}% of cells`}
          hint="Check dams, ponds and green space that hold runoff on higher ground"
        >
          <input
            type="range" min={0} max={0.7} step={0.1}
            value={draft.detentionShare}
            onChange={(e) => set("detentionShare", Number(e.target.value))}
          />
        </Field>
        {draft.detentionShare > 0 ? (
          <Field label="Runoff held back" value={`${draft.detentionHoldPct}%`}>
            <input
              type="range" min={10} max={95} step={5}
              value={draft.detentionHoldPct}
              onChange={(e) => set("detentionHoldPct", Number(e.target.value))}
            />
          </Field>
        ) : null}
        <label className="check">
          <input
            type="checkbox"
            checked={draft.clearDrainsAtMin !== null}
            disabled={!drainIssue}
            onChange={(e) => set("clearDrainsAtMin", e.target.checked ? Math.min(60, draft.durationMin - 5) : null)}
          />
          <span>Clear district drains{drainIssue ? "" : " (drains are working)"}</span>
        </label>
        {draft.clearDrainsAtMin !== null && drainIssue ? (
          <Field
            label="Cleared at"
            value={`T+${draft.clearDrainsAtMin} min`}
            {...(draft.basinDrainCondition === "fails-mid-storm" && draft.clearDrainsAtMin <= draft.drainFailureMin
              ? { hint: "Clearing must come after the failure, so it is ignored" }
              : {})}
          >
            <input
              type="range" min={0} max={draft.durationMin - 5} step={5}
              value={draft.clearDrainsAtMin}
              onChange={(e) => set("clearDrainsAtMin", Number(e.target.value))}
            />
          </Field>
        ) : null}
      </fieldset>

      <details className="advanced">
        <summary>Thresholds &amp; numerics</summary>
        <fieldset disabled={disabled}>
          <Field label="Warning depth" value={`${Math.round(draft.warningDepthM * 100)} cm`}>
            <input
              type="range" min={0.02} max={0.5} step={0.01}
              value={draft.warningDepthM}
              onChange={(e) => set("warningDepthM", Number(e.target.value))}
            />
          </Field>
          <Field label="Critical depth" value={`${Math.round(draft.criticalDepthM * 100)} cm`}>
            <input
              type="range" min={0.05} max={1.5} step={0.01}
              value={draft.criticalDepthM}
              onChange={(e) => set("criticalDepthM", Number(e.target.value))}
            />
          </Field>
          <Field label="Max integration step" hint="Halve it to check the results converge">
            <select value={draft.maxStepS} onChange={(e) => set("maxStepS", Number(e.target.value))}>
              {[4, 2, 1, 0.5, 0.25].map((s) => <option key={s} value={s}>{s} s</option>)}
            </select>
          </Field>
          <p className="field-hint">
            The thresholds are demo assumptions, not official hazard standards. The engine rejects
            a warning depth that isn't below the critical depth.
          </p>
        </fieldset>
      </details>
    </form>
  );
}
