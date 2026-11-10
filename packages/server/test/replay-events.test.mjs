import assert from "node:assert/strict";
import { test } from "node:test";
import { BuildingPass, finalizeSpace, normalizeBuildingPass } from "../dist/space-pipeline.js";
import { verifyEvidence } from "../dist/source-evidence.js";

test("generation verifies occurrence evidence and preserves exact question links", async () => {
  const point = (id) => ({ id, ref: `step:${id}` });
  const source = (startLine) => ({ path: "worker.test.mjs", startLine });
  const good = { stepIndex: 3, state: [{ key: "attempt", value: "2" }], source: source(3) };
  const replay = { flow: "worker", scenario: "retry", step: "attempt", stepIndex: 3 };
  const pass = BuildingPass.parse(normalizeBuildingPass({
    flows: [{ id: "worker", title: "Worker", scope: "system", path: [point("start"), point("attempt"), point("done")],
      branches: [{ at: 1, join: "attempt", condition: "Retry", path: [point("wait")] }],
      scenarios: [{ id: "retry", title: "Retry", steps: ["start", "attempt", "wait", "attempt", "done"],
        events: [good, { ...good, source: source(1) }, { stepIndex: 1, source: source(90) }, { stepIndex: 9, source: source(2) }] }] }],
    questions: [{ id: "what-attempt", kind: "choice", prompt: "Which attempt is this?",
      options: [{ id: "first", label: "First" }, { id: "second", label: "Second" }],
      answer: ["second"], explanation: "The worker retries.", source: source(3), replay }]
  }));
  assert.deepEqual(pass.flows[0].scenarios[0].events.map(({ stepIndex }) => stepIndex), [3, 1]);
  const result = finalizeSpace({
    version: "0.2", meta: { name: "Worker", sourceDir: ".", createdAt: "2026-11-07T00:00:00Z" },
    city: { districts: [{ id: "workers", title: "Workers" }], buildings: [] },
    flows: pass.flows, assessment: { questions: pass.questions }
  });
  assert.equal(result.success, true, result.issues);
  const summary = await verifyEvidence(result.data, { docs: [] }, async (file) => file === "worker.test.mjs" ? ["one", "two", "three"] : null);
  assert.deepEqual(summary, { sourceCount: 2, droppedSourceCount: 1 });
  const [event] = result.data.flows[0].scenarios[0].events;
  assert.deepEqual(event.source, good.source);
  assert.deepEqual(event.state, good.state);
  assert.deepEqual(result.data.assessment.questions[0].replay, replay);

  const stale = structuredClone(result.data);
  stale.assessment.questions[0].replay.stepIndex = 2;
  const repaired = finalizeSpace(stale);
  assert.equal(repaired.success, true);
  assert.equal(repaired.data.assessment.questions[0].replay, undefined);
});
