import { useState } from "react";
import type { LessonView, PlanReview as PlanReviewData } from "../api";

export const LESSON_VIEW_LABELS: { value: LessonView; label: string }[] = [
  { value: "sequence", label: "Sequence diagram" }, { value: "state", label: "State machine" },
  { value: "matrix", label: "Decision table" }, { value: "erd", label: "Data model" },
  { value: "class", label: "Class diagram" }, { value: "mindmap", label: "Mind map" }, { value: "context", label: "System context" }
];

export function PlanReview({ plan, busy, approve }: {
  plan: PlanReviewData;
  busy: boolean;
  approve: (lessons: { building: string; views: LessonView[] }[]) => void;
}) {
  const [selection, setSelection] = useState(() => Object.fromEntries(plan.buildings.map((building) => [building.id, {
    selected: building.required || building.selected, views: building.views
  }])));
  const selected = plan.buildings.filter((building) => selection[building.id]?.selected);
  const minimum = Math.min(2, Math.max(1, plan.buildings.length));
  const valid = selected.length >= minimum && selected.length <= 10 && selected.every((building) => selection[building.id].views.length <= 4);
  return <section className="studio-panel studio-plan-review" aria-label="Review lesson plan">
    <div className="studio-section-title"><h2>Review lesson plan</h2><strong>{selected.length}/10 buildings</strong></div>
    <p className="studio-muted">Choose {minimum === 1 ? "one" : "at least two"} buildings, up to ten for this run. The focus and pinned lessons stay selected.</p>
    <fieldset disabled={busy} className="studio-plan-options">
      {plan.buildings.map((building) => {
        const item = selection[building.id];
        return <div className="studio-plan-building" key={building.id}>
          <label className="studio-checkbox">
            <input type="checkbox" checked={item.selected} disabled={building.required || !item.selected && selected.length >= 10}
              onChange={(event) => setSelection({ ...selection, [building.id]: { ...item, selected: event.target.checked } })} />
            <strong>{building.title}</strong>{building.required && <span className="studio-muted">Required</span>}
          </label>
          <p className="studio-muted">{building.moduleRef} · Component map{building.documentationOnly ? " · Documentation lesson" : " · Sourced replay where applicable"}</p>
          {item.selected && <details>
            <summary>Additional views · {item.views.length}/4</summary>
            <div className="studio-plan-views">
              {LESSON_VIEW_LABELS.map(({ value, label }) => <label className="studio-checkbox" key={value}>
                <input type="checkbox" checked={item.views.includes(value)} disabled={!item.views.includes(value) && item.views.length >= 4}
                  onChange={(event) => setSelection({ ...selection, [building.id]: { ...item,
                    views: event.target.checked ? [...item.views, value] : item.views.filter((view) => view !== value)
                  } })} />{label}
              </label>)}
            </div>
          </details>}
        </div>;
      })}
    </fieldset>
    {!valid && <p role="status" className="studio-alert">Choose {minimum}–10 buildings and at most four additional views per building.</p>}
    <div className="studio-actions"><button className="studio-button studio-primary" type="button" disabled={busy || !valid}
      onClick={() => approve(selected.map(({ id }) => ({ building: id, views: selection[id].views })))}>
      {busy ? "Starting lessons…" : "Build selected lessons"}
    </button></div>
  </section>;
}
