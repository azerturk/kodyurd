import { useEffect, useState } from "react";
import { api } from "../api";
import type { GenerationDeliverable, JobStage, JobView, LessonView } from "../api";
import { deliverableGroups, elapsedJob, isJobActive, isRunning, jobStatus } from "./generation-view";
import { PlanReview } from "./PlanReview";
import { hasJobFailure, jobDiagnostics } from "./job-diagnostics";
import "./generation-panel.css";

const DELIVERABLE_LABELS: Record<GenerationDeliverable["state"], string> = {
  pending: "Pending", running: "Running", ready: "Ready", failed: "Failed", "timed-out": "Timed out"
};

const PHASES: { id: NonNullable<JobStage["phase"]>; label: string }[] = [
  { id: "scan", label: "Workspace scan" },
  { id: "plan", label: "City plan and focus" },
  { id: "content", label: "Evidence and content" },
  { id: "layout", label: "City layout" },
  { id: "quality", label: "Quality check" }
];

export { isJobActive, isRunning } from "./generation-view";

/** A building id such as `b-reservations` reads as its title when no title is known. */
export function focusTitle(title: string | undefined): string {
  if (!title) return "Workspace";
  if (!/^b-[a-z0-9]+(?:[-_.][a-z0-9]+)*$/.test(title)) return title;
  return title.slice(2).split(/[-_.]/).map((word) => word[0].toUpperCase() + word.slice(1)).join(" ");
}

/** Progress, selected evidence and outputs of one generation or personal-model job. */
export default function GenerationPanel({ job, busy, onRetry, onContinue, onPreview, onStop, onResume, onApprove }: {
  job: JobView;
  busy: boolean;
  onRetry: (deliverableId: string) => void;
  onContinue: () => void;
  onPreview: (artifact?: string) => void;
  onStop: () => void;
  onResume: () => void;
  onApprove: (lessons: { building: string; views: LessonView[] }[]) => void;
}) {
  const running = isRunning(job);
  const active = isJobActive(job);
  const [now, setNow] = useState(Date.now);
  const [copying, setCopying] = useState(false);
  const [copyNotice, setCopyNotice] = useState<string>();
  useEffect(() => { setCopyNotice(undefined); }, [job.id]);
  const copyDiagnostics = async (): Promise<void> => {
    if (copying) return;
    setCopying(true);
    setCopyNotice(undefined);
    const controller = new AbortController();
    const deadline = window.setTimeout(() => controller.abort(), 5000);
    try {
      const health = await api.health(controller.signal).catch(() => undefined);
      await navigator.clipboard.writeText(jobDiagnostics(job, health?.version, navigator.userAgent));
      setCopyNotice(health ? "Diagnostics copied." : "Diagnostics copied. App version was unavailable.");
    } catch {
      setCopyNotice("Could not copy diagnostics. Check clipboard access and try again.");
    } finally {
      window.clearTimeout(deadline);
      setCopying(false);
    }
  };
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running, job.id]);
  const focused = job.stages.filter((stage) => stage.focus);
  const focusBuilding = focused.at(-1)?.building ?? job.quality?.focusBuilding;
  const focusStages = focused.length ? focused : job.stages.filter((stage) => stage.building && stage.building === focusBuilding);
  const latestFirst = [...job.stages].reverse();
  const focusLatestFirst = [...focusStages].reverse();
  const evidence = focusLatestFirst.find((stage) => stage.evidence?.length)?.evidence ?? [];
  const outputs = focusLatestFirst.find((stage) => stage.outputs?.length)?.outputs ?? [];
  const lastPhase = latestFirst.find((stage) => stage.phase)?.phase;
  const deliverables = job.deliverables ?? [];
  const status = job.status === "done" ? job.quality?.status ?? "ready" : job.status;
  const elapsed = elapsedJob(job, now);
  const groups = deliverableGroups(job);
  return (
    <>
      {job.status === "awaiting-review" && job.planReview && <PlanReview key={job.id} plan={job.planReview} busy={busy} approve={onApprove} />}
      <div className="studio-grid studio-job-grid">
        <section className="studio-panel" aria-label="Generation progress">
          <div className="studio-section-title">
            <h2>{job.kind === "space" ? "Generation job" : "Personal model"}</h2>
            <span className={`studio-status studio-status-${status}`}>
              {jobStatus(job)}
            </span>
          </div>
          {elapsed && <p className="studio-muted">Elapsed · {elapsed}</p>}
          {job.kind === "space" && <div className="studio-actions">
            {(job.status === "queued" || job.status === "running") && <button type="button" className="studio-button" onClick={onStop} disabled={busy}>Stop generation</button>}
            {job.status === "awaiting-review" && <button type="button" className="studio-button" onClick={onStop} disabled={busy}>Stop this plan</button>}
            {job.status === "stopping" && <p role="status" className="studio-muted">Stopping the current request and keeping accepted work…</p>}
            {job.resumeAvailable && ["stopped", "interrupted", "failed"].includes(job.status) && <button type="button" className="studio-button studio-primary" onClick={onResume} disabled={busy}>Resume generation</button>}
          </div>}
          {job.kind === "space" && (
            <ol className="studio-steps">
              {PHASES.map(({ id, label }) => {
                const stage = latestFirst.find((entry) => entry.phase === id);
                const active = running && stage && lastPhase === id;
                const complete = stage?.state === "ready" || stage?.state === "cached"
                  || (stage && !active && job.status === "done" && stage.state !== "pending");
                const state = active ? "active" : complete ? "complete" : stage?.state === "pending" ? "pending" : "waiting";
                return (
                  <li key={id} data-state={state} aria-current={active ? "step" : undefined}>
                    <span className="studio-step-dot" aria-hidden="true">{complete ? "✓" : ""}</span>
                    <div>
                      <strong>{label}</strong>
                      {stage && <small>{stage.text}</small>}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          {job.status === "interrupted" && (
            <p className="studio-muted">The local app stopped during this run. {job.resumeAvailable ? "Resume to continue from accepted work." : "Generate again to continue with cached work."}</p>
          )}
          {job.status === "stopped" && <p className="studio-muted">Generation stopped. Accepted work and the saved city are kept.</p>}
          {job.status === "awaiting-review" && <p role="status" className="studio-muted">The city plan is ready. Review the lesson selection before any lesson requests start.</p>}
          {job.quality?.keptPrevious && <p className="studio-muted">Your previous city is still available while the new focus is incomplete.</p>}
          {job.focusReady && running && <p className="studio-ok">The focus is ready to open. More buildings from the brief are being added.</p>}
          {job.error && <p role="alert" className="studio-alert">{job.error.message}</p>}
          {hasJobFailure(job) && <div className="studio-actions">
            <button type="button" className="studio-button studio-small" onClick={() => { void copyDiagnostics(); }} disabled={copying}>
              {copying ? "Copying diagnostics…" : "Copy diagnostics"}
            </button>
            {copyNotice && <p role="status" className="studio-muted">{copyNotice}</p>}
          </div>}
        </section>
        <section className="studio-panel studio-job-focus" aria-label="Selected evidence">
          <p className="studio-eyebrow">Focus and evidence</p>
          <h2>{focusTitle(focusBuilding)}</h2>
          {job.focusReady && <p className="studio-job-ready"><span aria-hidden="true">✓</span> The focus lesson is available.</p>}
          {job.quality && (
            <div className="studio-quality" aria-label="Generation quality">
              <div><strong>{job.quality.sourceCount}</strong><small>Checked citations</small></div>
              <div><strong>{job.quality.playableFlowCount}</strong><small>Playable flows</small></div>
              <div><strong>{job.quality.droppedSourceCount}</strong><small>Invalid refs</small></div>
            </div>
          )}
          {deliverables.length > 0 && (
            <div className="studio-job-buildings">
              {groups.map((group) => <section className="studio-job-building" key={group.id} aria-label={`${group.title} lessons`}>
                <h3>{group.title}<small>{group.items.filter((item) => item.state === "ready").length}/{group.items.length} ready</small></h3>
                <ul className="studio-deliverables">
              {group.items.map((item) => {
                const interrupted = job.status === "interrupted" && item.state === "running";
                const retryable = !active && job.status !== "stopped" && item.state !== "ready" && (item.state !== "running" || interrupted);
                const artifact = latestFirst.find((stage) => stage.deliverableId === item.id && stage.outputs?.length)?.outputs
                  ?.find((output) => output.kind === (item.kind === "scenario" ? "flow" : "diagram"))?.ref;
                return (
                  <li key={item.id} data-state={interrupted ? "interrupted" : item.state}>
                    <div className="studio-deliverable-title">
                      <strong>{item.title.startsWith(`${group.title} · `) ? item.title.slice(group.title.length + 3) : item.title}</strong>
                      <span className={`studio-status studio-status-${interrupted ? "interrupted" : item.state}`}>
                        {interrupted ? "Interrupted" : DELIVERABLE_LABELS[item.state]}
                      </span>
                    </div>
                    {item.error && <p className="studio-muted">{item.error}</p>}
                    {item.state === "ready" && job.draftAvailable && artifact && <button className="studio-button studio-small" type="button"
                      onClick={() => onPreview(artifact)}>Open {item.title.toLowerCase()} ↗</button>}
                    {retryable && <button className="studio-button studio-small" type="button"
                      onClick={() => onRetry(item.id)} disabled={busy}>Retry {item.title.toLowerCase()}</button>}
                  </li>
                );
              })}
                </ul>
              </section>)}
            </div>
          )}
          {evidence.length > 0 && (
            <details className="studio-job-sources">
              <summary>Selected sources <span>{evidence.length}</span></summary>
              <ul className="studio-evidence">
                {evidence.map((source) => <li key={source} translate="no">{source}</li>)}
              </ul>
            </details>
          )}
          {deliverables.length === 0 && outputs.length > 0 && (
            <>
              <h3>Generated outputs</h3>
              <ul className="studio-outputs">
                {outputs.map((output, index) => (
                  <li key={output.ref ?? `${output.kind}:${index}`}>
                    <span className="studio-check" aria-hidden="true">✓</span>
                    <span>{output.title}</span>
                    <small>{output.kind === "diagram" ? "Diagram" : "Flow"}</small>
                  </li>
                ))}
              </ul>
            </>
          )}
          {evidence.length === 0 && outputs.length === 0 && deliverables.length === 0 && (
            <p className="studio-muted">{running ? "Selected sources and outputs appear as the agent works." : "No focus details were recorded for this run."}</p>
          )}
          {!!job.quality?.issues.length && (
            <ul className="studio-issues">{job.quality.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>
          )}
          {!!job.lessonsWaiting && job.focusReady && !active && job.status !== "stopped" && (
            <div className="studio-scan studio-notice" role="status">
              <p>This brief is broad: {job.lessonsWaiting} more {job.lessonsWaiting === 1 ? "building" : "buildings"} can still get a lesson.</p>
              <button className="studio-button studio-small" type="button" onClick={() => onContinue()} disabled={busy}>
                Build the remaining {job.lessonsWaiting}
              </button>
            </div>
          )}
          {job.draftAvailable && !job.focusReady && (
            <button className="studio-button studio-preview" type="button" onClick={() => onPreview()}>Preview draft</button>
          )}
        </section>
      </div>
      <details className="studio-panel studio-disclosure" open={lastPhase ? undefined : true}>
        <summary>Activity <span>{job.stages.length} updates</span></summary>
        <ol className="studio-log">
          {job.stages.map((stage, index) => (
            <li key={`${stage.at}:${index}`}>
              <time dateTime={stage.at}>{new Date(stage.at).toLocaleTimeString()}</time><span>{stage.text}</span>
            </li>
          ))}
        </ol>
      </details>
    </>
  );
}
