import type { JobView } from "../api";

const JOB_KINDS = new Set(["space", "overlay", "scene"]);
const JOB_STATES = new Set(["queued", "running", "awaiting-review", "stopping", "stopped", "done", "failed", "interrupted", "timed-out"]);
const PHASES = new Set(["scan", "plan", "content", "layout", "quality"]);
const DELIVERABLE_KINDS = new Set(["map", "scenario", "sequence", "state", "matrix", "erd", "class", "mindmap", "context"]);
const DELIVERABLE_STATES = new Set(["pending", "running", "ready", "failed", "timed-out"]);
// Only product codes are copied. Provider, OS and unexpected codes may contain arbitrary data.
const ERROR_CODES = new Set([
  "AGENT_API_FAILED", "AGENT_CANCELLED", "AGENT_FAILED", "AGENT_IMAGE_UNSUPPORTED", "AGENT_MODEL_INVALID",
  "AGENT_NO_JSON", "AGENT_OUTPUT_LIMIT", "AGENT_SPAWN_FAILED", "AGENT_TIMEOUT", "AGENT_UNAVAILABLE",
  "BAD_GENERATION_ID", "DELIVERABLE_INCOMPLETE", "DELIVERABLE_INVALID", "DELIVERABLE_SOURCE_MISSING",
  "GENERATION_CHECKPOINT_MISSING", "GENERATION_FOCUS_MISSING", "GENERATION_STOPPED", "JOB_FAILED",
  "LESSON_MODULE_NOT_FOUND", "LESSON_SCOPE_LIMIT", "OVERLAY_FAILED", "PLAN_EVIDENCE_LIMIT", "PLAN_NOT_WAITING",
  "PLAN_SELECTION_INVALID", "PLAN_SOURCE_CHANGED", "SOURCE_EMPTY", "SPACE_INVALID", "SPACE_PLAN_INVALID",
  "WORKSPACE_BUSY", "WORKSPACE_PATH", "WORKSPACE_STORAGE"
]);

export function hasJobFailure(job: JobView): boolean {
  return job.status === "failed" || job.status === "timed-out" ||
    Boolean(job.deliverables?.some(({ state }) => state === "failed" || state === "timed-out"));
}

/** Reduce the browser to a family and major version; never return the user agent itself. */
export function coarseBrowser(userAgent: string): string {
  const families: [string, RegExp][] = [
    ["Edge", /\bEdg(?:A|iOS)?\/(\d{1,4})(?:\.|\b)/],
    ["Opera", /\bOPR\/(\d{1,4})(?:\.|\b)/],
    ["Firefox", /\b(?:Firefox|FxiOS)\/(\d{1,4})(?:\.|\b)/],
    ["Chrome", /\b(?:Chrome|CriOS)\/(\d{1,4})(?:\.|\b)/],
    ["Safari", /\bVersion\/(\d{1,4})(?:\.|\b)/]
  ];
  for (const [family, pattern] of families) {
    const major = pattern.exec(userAgent)?.[1];
    if (major && (family !== "Safari" || /\bSafari\//.test(userAgent))) return `${family} ${Number(major)}`;
  }
  return "Unknown";
}

/** Build from an explicit allowlist, never by redacting or serializing a job/log object. */
export function jobDiagnostics(job: JobView, version: unknown, userAgent: string): string {
  const safeVersion = typeof version === "string" && /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-(?:dev|alpha|beta|rc)(?:\.\d{1,4})?)?$/.test(version) ? version : "unknown";
  const phase = job.stages.slice(-500).reverse().find((stage) => stage.phase && PHASES.has(stage.phase))?.phase ?? "unknown";
  const counts = new Map<string, { kind: string; state: string; count: number }>();
  for (const item of (job.deliverables ?? []).slice(0, 1200)) {
    if (!DELIVERABLE_KINDS.has(item.kind) || !DELIVERABLE_STATES.has(item.state)) continue;
    const key = `${item.kind}:${item.state}`;
    const count = counts.get(key) ?? { kind: item.kind, state: item.state, count: 0 };
    count.count++;
    counts.set(key, count);
  }
  return JSON.stringify({
    app: "Kodyurd",
    version: safeVersion,
    browser: coarseBrowser(userAgent),
    job: {
      kind: JOB_KINDS.has(job.kind) ? job.kind : "unknown",
      status: JOB_STATES.has(job.status) ? job.status : "unknown",
      errorCode: job.error ? ERROR_CODES.has(job.error.code) ? job.error.code : "OTHER_ERROR" : "NONE"
    },
    phase,
    deliverables: [...counts.values()].sort((a, b) => `${a.kind}:${a.state}`.localeCompare(`${b.kind}:${b.state}`))
  }, null, 2);
}
