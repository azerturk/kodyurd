import assert from "node:assert/strict";
import test from "node:test";
import { clearBoom, walkPath } from "../src/viewer/walk-path.ts";
import { buildFlowReplay, selectReplayCursor } from "../src/viewer/flow-replay.ts";
import { spatialSequence } from "../src/viewer/spatial-graph.ts";

test("camera sweep retracts at walls but clears low objects at eye height", () => {
  const origin = { x: 0, z: 0, y: 1.6 };
  const goal = { x: 0, z: -7, y: 2.4 };
  const wall = { x: 0, z: -3, halfW: 2, halfD: 0.12, height: 4.2 };
  const distance = clearBoom(origin, goal, [wall], 0.15);
  assert.ok(distance > 0.37 && distance < 0.40);
  assert.equal(clearBoom(origin, goal, [{ ...wall, height: 0.9 }], 0.15), 1);
  assert.equal(clearBoom(origin, goal, [{ ...wall, x: 4 }], 0.15), 1);
  assert.equal(clearBoom(origin, goal, [{ ...wall, z: 2 }], 0.15), 1);
});

test("walking crosses the connected passage and rejects off-surface targets", () => {
  const wall = [
    { x: 5, z: -2.2, halfW: 0.12, halfD: 1.35 },
    { x: 5, z: 2.2, halfW: 0.12, halfD: 1.35 }
  ];
  const floor = (x, z) => x >= 0 && x <= 10 && Math.abs(z) <= 3.5;
  assert.deepEqual(walkPath({ x: 1, z: 0 }, { x: 9, z: 0 }, wall, floor), [{ x: 9, z: 0 }]);
  assert.ok(walkPath({ x: 1, z: 2 }, { x: 9, z: 2 }, wall, floor).length > 1);
  assert.equal(walkPath({ x: 1, z: 0 }, { x: 11, z: 0 }, wall, floor), null);
});

test("replay opens exact scenario and step without falling back to another path", () => {
  const point = (id) => ({ id, ref: `step:${id}`, caption: id, source: { path: "auth.ts", startLine: id === "retry" ? 30 : 10 } });
  const replay = buildFlowReplay({
    id: "auth", title: "Login", scope: "system", kind: "calls",
    path: ["entry", "decision", "success"].map(point),
    branches: [{ id: "failed", at: 1, from: "decision", join: "decision", condition: "Invalid", path: [point("retry")] }],
    scenarios: [
      { id: "valid", title: "Valid", steps: ["entry", "decision", "success"] },
      { id: "invalid", title: "Invalid then valid", steps: ["entry", "decision", "retry", "decision", "success"] }
    ]
  });
  const retry = selectReplayCursor(replay.traces, { scenarioId: "invalid", stepId: "retry" });
  assert.equal(retry.step, 2);
  assert.equal(retry.trace.steps[retry.step].point.source.startLine, 30);
  assert.ok(replay.edges.some((edge) => edge.from === "retry" && edge.to === "decision"));
  assert.equal(selectReplayCursor(replay.traces, { scenarioId: "valid", stepId: "retry" }), null);
  assert.equal(selectReplayCursor(replay.traces, { scenarioId: "absent" }), null);
});

test("sequence lanes preserve authored order, notation, and source anchors", () => {
  const diagram = {
    id: "seq", owner: "city", title: "Worker", kind: "sequence",
    nodes: [{ id: "web", label: "Browser" }, { id: "worker", label: "Worker" }],
    edges: [
      { id: "start", from: "web", to: "worker", kind: "async", label: "1a. Queue work", source: { path: "queue.ts", startLine: 18 } },
      { id: "end", from: "worker", to: "web", kind: "return", label: "Status", guard: "work completed", source: { path: "status.ts", startLine: 27 } }
    ]
  };
  const spatial = spatialSequence(diagram);
  assert.deepEqual(spatial.nodes.map((node) => node.id), ["web", "worker"]);
  assert.deepEqual(spatial.edges.map((edge) => edge.kind), ["async", "return"]);
  assert.equal(spatial.edges[0].label, "1a. Queue work");
  assert.equal(spatial.edges[1].label, "2. Status · work completed");
  assert.equal(spatial.edges[1].source.startLine, 27);
});
