import { useState } from "react";
import { replayDifferences, type ReplayNode, type ReplayTrace } from "./flow-replay";

function ComparisonPath({ trace, step, action }: { trace: ReplayTrace; step: number; action: () => void }) {
  const event: ReplayNode | undefined = trace.steps[step];
  return <section>
    <h4>{trace.title}</h4>
    <p>{event ? event.point.caption ?? event.point.actor ?? event.point.ref : "This path has already ended."}</p>
    {!!event?.point.state?.length && <dl className="kd-example-state">
      {event.point.state.map(({ key, value }, index) => <div key={`${key}:${index}`}><dt>{key}</dt><dd>{value}</dd></div>)}
    </dl>}
    <button type="button" className="kd-learn-action" onClick={action}>{event ? `Go to step ${step + 1}` : "Go to final step"}</button>
  </section>;
}

export function ReplayComparison({ current, alternatives, openAt }: {
  current: ReplayTrace;
  alternatives: ReplayTrace[];
  openAt: (scenarioId: string, stepIndex: number) => void;
}) {
  const [comparisonId, setComparisonId] = useState<string>();
  const other = alternatives.find(({ id }) => id === comparisonId) ?? alternatives[0];
  if (!other) return null;
  const { pathSplit, stateDifference } = replayDifferences(current, other);
  const difference = pathSplit ?? stateDifference;
  return <details className="kd-diagram-directory kd-replay-comparison">
    <summary>Compare paths</summary>
    <label className="kd-scenario-picker">Compare with
      <select value={other.id} title={other.title} onChange={(event) => setComparisonId(event.target.value)}>
        {alternatives.map(({ id, title }) => <option value={id} key={id}>{title}</option>)}
      </select>
    </label>
    {difference === undefined ? <p>These paths share the same steps and recorded state.</p> : <>
      <p>{pathSplit === undefined ? "Same path, different recorded state" : "First path split"} · Step {difference + 1}</p>
      {pathSplit !== undefined && stateDifference !== undefined &&
        <p className="kd-lesson-muted">Recorded data already differs on shared step {stateDifference + 1}.</p>}
      <div className="kd-replay-comparison-paths">
        {[current, other].map((trace) => <ComparisonPath key={trace.id} trace={trace} step={difference}
          action={() => {
            if (trace.id !== current.id) setComparisonId(current.id);
            openAt(trace.id, Math.min(difference, trace.steps.length - 1));
          }} />)}
      </div>
    </>}
  </details>;
}
