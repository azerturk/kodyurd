import assert from "node:assert/strict";
import { test } from "node:test";
import { coarseBrowser, hasJobFailure, jobDiagnostics } from "../src/screens/job-diagnostics.ts";

const job = { id: "private-job", projectId: "private-project", kind: "space", status: "failed",
  createdAt: "2026-11-19T10:00:00Z", updatedAt: "2026-11-19T10:00:30Z",
  error: { code: "AGENT_TIMEOUT", message: "A provider message that must stay local" },
  stages: [{ at: "ignored", phase: "content", text: "Raw log never copied" }],
  deliverables: [{ id: "private-id", kind: "map", title: "Private module", state: "ready" },
    { id: "private-replay", kind: "scenario", title: "Private replay", state: "timed-out", error: "Secret detail" }] };

test("diagnostics contain only coarse browser, product version and allowlisted generation state", () => {
  const data = JSON.parse(jobDiagnostics(job, "0.6.0-dev", "Mozilla/5.0 Chrome/130.0.1 Safari/537.36 Edg/130.0.1"));
  assert.deepEqual(data, { app: "Kodyurd", version: "0.6.0-dev", browser: "Edge 130",
    job: { kind: "space", status: "failed", errorCode: "AGENT_TIMEOUT" }, phase: "content",
    deliverables: [{ kind: "map", state: "ready", count: 1 }, { kind: "scenario", state: "timed-out", count: 1 }] });
  assert.equal(coarseBrowser("Mozilla Firefox/133.0 private-device"), "Firefox 133");
  assert.equal(coarseBrowser("Version/18.1 Safari/605.1.15"), "Safari 18");
  assert.equal(coarseBrowser("private-name-and-device"), "Unknown");
});

test("paths, credentials, prompts and malicious enum values cannot enter diagnostics", () => {
  const secret = "sk-test-private-diagnostic-marker";
  const localPath = ["C:", "Users", "private-user", "workspace", "private.ts"].join("\\");
  const poisoned = { ...job, id: secret, projectId: localPath, name: secret, brief: `${secret} ${localPath}`, model: secret,
    error: { code: "ANTHROPIC_API_KEY", message: `${secret} ${localPath}` },
    stages: [{ at: localPath, phase: "plan", text: `${secret} ${localPath}`, building: secret, evidence: [localPath], reference: secret },
      { at: "ignored", phase: localPath, text: secret }],
    deliverables: [{ id: secret, kind: "map", title: localPath, state: "failed", error: secret, reference: localPath },
      { id: "evil", kind: secret, state: "failed" }, { id: "evil-state", kind: "map", state: localPath }] };
  const output = jobDiagnostics(poisoned, `0.6.0\n${secret}`, `Mozilla ${localPath} Firefox/133.0 ${secret}`);
  assert.doesNotMatch(output, /sk-test|private-user|private\.ts|ANTHROPIC_API_KEY|workspace|private-diagnostic-marker|reference|brief|projectId/);
  const parsed = JSON.parse(output);
  assert.equal(parsed.version, "unknown");
  assert.equal(parsed.job.errorCode, "OTHER_ERROR");
  assert.equal(parsed.phase, "plan");
  assert.deepEqual(parsed.deliverables, [{ kind: "map", state: "failed", count: 1 }]);
});

test("copy availability follows failure states and diagnostics never read raw error or stage text", () => {
  assert.equal(hasJobFailure(job), true);
  assert.equal(hasJobFailure({ ...job, status: "done", deliverables: [{ kind: "map", state: "ready" }] }), false);
  assert.equal(hasJobFailure({ ...job, status: "stopped", deliverables: [] }), false);
  assert.equal(hasJobFailure({ ...job, status: "done" }), true);
  const safe = { ...job, error: { code: "JOB_FAILED", get message() { throw new Error("message was read"); } },
    stages: [{ phase: "quality", get text() { throw new Error("log was read"); } }] };
  assert.doesNotThrow(() => jobDiagnostics(safe, "0.6.0", "Chrome/130.0"));
});
