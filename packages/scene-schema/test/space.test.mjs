import assert from "node:assert/strict";
import { test } from "node:test";
import { AssessmentQuestion, parseSpace, SpaceFlow } from "../dist/index.js";

const step = (id) => ({ id, ref: `step:${id}` });

test("a replay follows a stable branch anchor and an explicit retry edge", () => {
  const flow = {
    id: "login",
    title: "Login",
    scope: "system",
    path: [step("start"), step("verify"), step("done")],
    branches: [{ at: 0, from: "verify", join: "verify", condition: "Try again", path: [step("retry")] }],
    scenarios: [{ id: "try-again", title: "Try again", steps: ["start", "verify", "retry", "verify", "done"] }]
  };

  assert.equal(SpaceFlow.safeParse(flow).success, true);
  const jumped = { ...flow, scenarios: [{ ...flow.scenarios[0], steps: ["start", "retry", "done"] }] };
  assert.equal(SpaceFlow.safeParse(jumped).success, false);
  const detached = { ...flow, branches: [{ ...flow.branches[0], join: "missing" }] };
  assert.equal(SpaceFlow.safeParse(detached).success, false);
});

test("a legacy document-only space still opens", () => {
  const result = parseSpace({
    version: "0.1",
    meta: { name: "Old space", sourceDir: ".", createdAt: "2026-11-07T00:00:00Z", sceneType: "exhibition" },
    zones: [{
      id: "hall",
      kind: "hall",
      title: "Hall",
      position: { x: 0, z: 0 },
      size: { w: 20, d: 20 },
      items: [{ id: "panel", kind: "panel", title: "Panel", position: { x: 0, z: 0 } }]
    }]
  });

  assert.equal(result.success, true);
  assert.equal(result.upgradedFrom, "0.1");
  assert.equal(result.data.city.districts[0].id, "hall");
});

test("an ordered assessment requires evidence and a complete permutation", () => {
  const question = {
    id: "worker-order", kind: "order", prompt: "Order the worker stages.",
    options: [{ id: "load", label: "Load" }, { id: "ack", label: "Acknowledge" }],
    answer: ["load", "ack"], explanation: "The worker loads before it acknowledges.",
    source: { path: "worker.ts", startLine: 10, endLine: 12 }
  };
  assert.equal(AssessmentQuestion.safeParse(question).success, true);
  assert.equal(AssessmentQuestion.safeParse({ ...question, answer: ["load", "load"] }).success, false);
  assert.equal(AssessmentQuestion.safeParse({ ...question, source: { path: "worker.ts" } }).success, false);
  assert.equal(AssessmentQuestion.safeParse({ ...question, kind: "target", answer: ["unknown"] }).success, false);
});

test("an assessment replay target resolves within its specified trace", () => {
  const doc = {
    version: "0.2",
    meta: { name: "Worker", sourceDir: ".", createdAt: "2026-11-07T00:00:00Z" },
    city: { districts: [{ id: "domain", title: "Domain" }], buildings: [] },
    flows: [{
      id: "worker", title: "Worker", scope: "system", path: [step("start"), step("run"), step("done")],
      branches: [{ at: 1, from: "run", condition: "Failed", path: [step("failed")] }],
      scenarios: [
        { id: "ok", title: "Success", steps: ["start", "run", "done"] },
        { id: "error", title: "Failure", steps: ["start", "run", "failed"] }
      ]
    }],
    assessment: { questions: [{
      id: "worker-error", kind: "choice", prompt: "Which event ends the failure path?",
      options: [{ id: "failed", label: "Failed" }, { id: "done", label: "Done" }],
      answer: ["failed"], explanation: "The error path ends with a failure.",
      source: { path: "worker.ts", startLine: 11 }, replay: { flow: "worker", scenario: "error", step: "failed" }
    }] }
  };
  assert.equal(parseSpace(doc).success, true);
  doc.assessment.questions[0].replay.scenario = "ok";
  assert.equal(parseSpace(doc).success, false);
});

test("indexed events and assessment links stay within the authored scenario", () => {
  const event = { stepIndex: 3, state: [{ key: "attempt", value: "2" }], source: { path: "worker.ts", startLine: 20 } };
  const scenario = { id: "with-retry", title: "Try again", steps: ["start", "attempt", "retry", "attempt", "done"], events: [event] };
  const flow = {
    id: "worker", title: "Worker", scope: "system", path: [step("start"), step("attempt"), step("done")],
    branches: [{ at: 1, join: "attempt", condition: "Temporary failure", path: [step("retry")] }], scenarios: [scenario]
  };
  const replay = { flow: flow.id, scenario: scenario.id, step: "attempt", stepIndex: 3 };
  const doc = {
    version: "0.2", meta: { name: "Worker", sourceDir: ".", createdAt: "2026-11-07T00:00:00Z" },
    city: { districts: [{ id: "domain", title: "Domain" }], buildings: [] }, flows: [flow],
    assessment: { questions: [{ id: "attempt", kind: "choice", prompt: "Which attempt is this?",
      options: [{ id: "1", label: "First" }, { id: "2", label: "Second" }], answer: ["2"],
      explanation: "The worker retries once.", source: event.source, replay }] }
  };
  assert.equal(parseSpace(doc).success, true);
  replay.stepIndex = 2;
  assert.equal(parseSpace(doc).success, false);
  delete replay.stepIndex;
  assert.equal(parseSpace(doc).success, true, "old ambiguous links still parse");
  scenario.events.push(event);
  assert.equal(parseSpace(doc).success, false, "one override per occurrence");
  scenario.events = [{ ...event, stepIndex: 9 }];
  assert.equal(parseSpace(doc).success, false, "event must address an existing position");
});

test("Explain claims address identified diagram items and exact replay occurrences", () => {
  const replay = { flow: "trace", scenario: "main", step: "end", stepIndex: 1 };
  const evidence = { kind: "code", path: "entry.ts", startLine: 4, endLine: 4 };
  const claim = { id: "input-rule", target: { kind: "edge", id: "process" }, kind: "guard", text: "A valid input reaches the result.", evidence: [evidence], replay };
  const doc = {
    version: "0.2", meta: { name: "Small project", sourceDir: ".", createdAt: "2026-11-07T00:00:00Z" },
    city: { districts: [{ id: "domain", title: "Domain" }], buildings: [] },
    flows: [{ id: "trace", title: "Process input", scope: "system", path: [step("start"), step("end")],
      scenarios: [{ id: "main", title: "Main path", steps: ["start", "end"] }] }],
    diagrams: [{ id: "map", owner: "city", title: "Process input", nodes: [{ id: "a", label: "Input" }, { id: "b", label: "Result" }],
      edges: [{ id: "process", from: "a", to: "b" }], claims: [claim] }]
  };
  assert.equal(parseSpace(doc).success, true);
  claim.target.id = "unknown";
  assert.equal(parseSpace(doc).success, false);
  claim.target.id = "process";
  replay.stepIndex = 0;
  assert.equal(parseSpace(doc).success, false);
  replay.stepIndex = 1;
  claim.kind = "decision";
  assert.equal(parseSpace(doc).success, false, "a rationale must be authored in documentation");
  claim.kind = "disagreement";
  claim.evidence.push({ kind: "docs", path: "README.md", startLine: 2, endLine: 3 });
  assert.equal(parseSpace(doc).success, true);
  evidence.endLine = 43;
  assert.equal(parseSpace(doc).success, true);
  evidence.endLine = 44;
  assert.equal(parseSpace(doc).success, false);
  delete doc.diagrams[0].claims;
  assert.equal(parseSpace(doc).success, true, "older diagrams still parse");
});
