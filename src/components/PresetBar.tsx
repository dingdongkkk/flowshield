import { PRESETS, type ScenarioDraft } from "../app/scenarios";

export function PresetBar({ onPick, activeId }: { readonly onPick: (draft: ScenarioDraft, id: string) => void; readonly activeId: string | null }) {
  return (
    <div className="presets" role="group" aria-label="Scenario presets">
      <p className="presets-title">Quick scenarios</p>
      <div className="presets-grid">
        {PRESETS.map((p) => (
          <button key={p.id} type="button" title={p.hint} className={`preset${activeId === p.id ? " is-on" : ""}`} onClick={() => onPick(p.draft, p.id)}>
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
