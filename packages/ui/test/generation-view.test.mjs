import assert from "node:assert/strict";
import { test } from "node:test";
import { deliverableGroups, elapsedJob, isJobActive, isRunning, jobStatus } from "../src/screens/generation-view.ts";

const job = { id: "j", projectId: "p", kind: "space", status: "running", stages: [],
  createdAt: "2026-11-19T10:00:00.000Z", updatedAt: "2026-11-19T10:02:05.000Z" };

test("reviewing reserves the workspace while stopping keeps polling and terminal states stay honest after focus readiness", () => {
  for (const status of ["queued", "running", "stopping"]) {
    assert.equal(isRunning({ ...job, status }), true);
    assert.equal(isJobActive({ ...job, status }), true);
  }
  const review = { ...job, status: "awaiting-review" };
  assert.equal(isRunning(review), false);
  assert.equal(isJobActive(review), true);
  assert.equal(jobStatus(review), "Review the plan");
  for (const [status, label] of [["stopped", "Stopped"], ["interrupted", "Interrupted"], ["failed", "Failed"]]) {
    const terminal = { ...job, status, focusReady: true, quality: { status: "ready" } };
    assert.equal(isJobActive(terminal), false);
    assert.equal(jobStatus(terminal), label);
  }
});

test("elapsed time advances only while the request is active and invalid dates are omitted", () => {
  const later = Date.parse("2026-11-19T10:03:09.000Z");
  assert.equal(elapsedJob(job, later), "3:09");
  assert.equal(elapsedJob({ ...job, status: "stopped" }, later), "2:05");
  assert.equal(elapsedJob({ ...job, status: "awaiting-review" }, later), "2:05");
  assert.equal(elapsedJob({ ...job, createdAt: "invalid" }, later), undefined);
});

test("deliverables group by real ownership and recover old ownership from stages without losing items", () => {
  const first = { id: "focus-map", kind: "map", title: "Component map", state: "ready", building: "b-a", buildingTitle: "Main module" };
  const second = { id: "lesson-abc-scenario", kind: "scenario", title: "Main module · Playable scenario", state: "failed" };
  const other = { id: "lesson-def-map", kind: "map", title: "Queue · Component map", state: "pending" };
  const old = { ...job, stages: [{ at: job.updatedAt, text: "Reading", building: "b-a", deliverableId: second.id }], deliverables: [first, second, other] };
  const groups = deliverableGroups(old);
  assert.deepEqual(groups.map(({ id, title, items }) => [id, title, items.map(({ id }) => id)]), [
    ["b-a", "Main module", [first.id, second.id]], ["Queue", "Queue", [other.id]]
  ]);
  assert.equal(groups.flatMap(({ items }) => items).length, old.deliverables.length);
});
