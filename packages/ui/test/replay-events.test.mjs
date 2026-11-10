import assert from "node:assert/strict";
import { test } from "node:test";
import { buildFlowReplay, selectReplayCursor } from "../src/viewer/flow-replay.ts";

test("the second retry link opens step nine with its own state and exact source", () => {
  const point = (id) => ({ id, ref: `step:${id}`, caption: id });
  const events = [
    { stepIndex: 4, state: [{ key: "dueAtMs", value: "1000" }], source: { path: "worker.test.mjs", startLine: 25 } },
    { stepIndex: 8, state: [{ key: "dueAtMs", value: "3000" }], source: { path: "worker.test.mjs", startLine: 48 } }
  ];
  const flow = {
    id: "worker", title: "Worker", kind: "calls", scope: "system",
    path: ["submit", "tick", "attempt", "deliver", "done"].map(point),
    branches: [
      { at: 3, condition: "Try again", path: [point("retry"), point("wait")], join: "attempt" },
      { at: 3, condition: "Limit reached", path: [point("dead")] }
    ],
    scenarios: [{ id: "dead-letter", title: "Dead letter", events,
      steps: ["submit", "tick", "attempt", "deliver", "retry", "wait", "attempt", "deliver", "retry", "wait", "attempt", "deliver", "dead"] }]
  };
  const { traces, nodes } = buildFlowReplay(flow);
  const target = { scenarioId: "dead-letter", stepId: "retry" };
  assert.equal(selectReplayCursor(traces, target), null);
  assert.equal(selectReplayCursor(traces, { ...target, stepIndex: 9 }), null);
  assert.equal(selectReplayCursor(traces, { ...target, scenarioId: undefined, stepIndex: 8 }), null);
  assert.equal(selectReplayCursor(traces, { scenarioId: "dead-letter" }).step, 0);
  const first = selectReplayCursor(traces, { ...target, stepIndex: 4 });
  const second = selectReplayCursor(traces, { ...target, stepIndex: 8 });
  assert.equal(second.step, 8);
  assert.deepEqual(first.trace.steps[first.step].point.state, events[0].state);
  assert.deepEqual(second.trace.steps[second.step].point.state, events[1].state);
  assert.deepEqual(second.trace.steps[second.step].point.source, events[1].source);
  assert.equal(nodes.find((node) => node.id === "retry").point.state, undefined);
});
