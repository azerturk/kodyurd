import assert from "node:assert/strict";
import test from "node:test";
import { mergeFocusPasses } from "../dist/focus-generation.js";
import { BuildingPass } from "../dist/space-pipeline.js";

const building = { id: "b-queue", title: "Queue", summary: "Dispatches ready work." };
const source = (startLine) => ({ path: "worker.mjs", startLine, endLine: startLine });
const point = (id, caption, line) => ({ id, ref: `step:${id}`, caption, source: source(line) });
const diagram = (id, kind, line) => ({
  id, kind, owner: building.id, title: id, source: source(line),
  nodes: [{ id: "one", label: "One", source: source(line) }, { id: "two", label: "Two", source: source(line + 1) }],
  edges: [{ from: "one", to: "two", source: source(line + 2) }]
});

const direct = { id: "direct", title: "Direct send", steps: ["receive", "send", "done"] };
const retry = { id: "retry", title: "Retry send", steps: ["receive", "send", "wait", "send", "done"],
  events: [{ stepIndex: 2, source: source(21), detail: "The worker schedules a wait." }] };
const flow = {
  id: "kc-flow-queue", title: "Send queued work", scope: "module:b-queue",
  path: [point("receive", "Receive order", 2), point("send", "Send", 7), point("done", "Record result", 8)],
  branches: [{ at: 1, from: "send", join: "send", condition: "Retry", path: [point("wait", "Wait until ready", 12)] }],
  scenarios: [direct, retry, { ...retry, id: "late", title: "Late tick" }]
};
const authored = {
  id: "q-wait", kind: "choice", prompt: "At stepIndex 2, what happens?", options: [
    { id: "a", label: "Wait" }, { id: "b", label: "Send immediately" }
  ], answer: ["a"], explanation: "The task waits.", building: building.id, source: source(21),
  replay: { flow: flow.id, scenario: retry.id, step: "wait", stepIndex: 2 }
};

test("accepted replay supplements an authored quiz with distinct, stable sourced order questions", () => {
  const part = BuildingPass.parse({ flows: [flow], questions: [authored] });
  const result = BuildingPass.parse(mergeFocusPasses(building, [part]));
  assert.deepEqual(result.questions.map(({ kind }) => kind), ["choice", "order", "order"]);
  assert.equal(result.questions[0].prompt, "At #3, what happens?");
  assert.deepEqual(result.questions[0].replay, authored.replay);
  assert.deepEqual(result.questions[1].answer, ["receive", "send", "done"]);
  assert.deepEqual(result.questions[2].answer, ["receive", "send", "wait", "done"]);
  assert.deepEqual(result.questions[2].source, source(8));
  assert.deepEqual(result.questions[2].replay, { flow: flow.id, scenario: "retry", step: "receive", stepIndex: 0 });
  const reordered = mergeFocusPasses(building, [BuildingPass.parse({ flows: [{ ...flow, scenarios: [retry, direct] }] })]);
  assert.deepEqual(reordered.questions.map(({ id }) => id).sort(), result.questions.slice(1).map(({ id }) => id).sort());
});

test("each sourced specialized diagram has one guided stop and dedicated sequence wins", () => {
  const parts = [
    BuildingPass.parse({ diagrams: [diagram("kc-map-queue", "graph", 1), diagram("kc-scenario-queue", "sequence", 10)] }),
    BuildingPass.parse({ diagrams: [
      diagram("kc-sequence-queue", "sequence", 20), diagram("kc-state-queue", "state", 30), diagram("kc-matrix-queue", "matrix", 40)
    ] })
  ];
  const result = BuildingPass.parse(mergeFocusPasses(building, parts));
  assert.deepEqual(result.tour.map(({ ref, source: anchor }) => [ref, anchor]), [
    ["kc-sequence-queue", source(20)], ["kc-state-queue", source(30)], ["kc-matrix-queue", source(40)]
  ]);
});
