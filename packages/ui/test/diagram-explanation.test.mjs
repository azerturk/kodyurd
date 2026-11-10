import assert from "node:assert/strict";
import { test } from "node:test";
import { claimsForItem, connectionsForNode, diagramItems } from "../src/viewer/diagram-explanation.ts";
import { diagramForDocumentFence, indexReadingEvidence, relatedReadingEvidence } from "../src/viewer/document-navigation.ts";
import { buildFlowReplay, replayDifferences } from "../src/viewer/flow-replay.ts";
import { worldHudPanel } from "../src/viewer/viewer-overlays.ts";

const diagram = {
  id: "booking", owner: "reservations", title: "Reservation rule", kind: "graph",
  nodes: [{ id: "api", label: "Booking endpoint" }, { id: "policy", label: "Overlap policy", group: "Reservations" }],
  edges: [{ id: "lookup", from: "api", to: "policy", label: "Check date range", guard: "Existing booking overlaps" },
    { from: "policy", to: "api", kind: "return" }],
  claims: [
    { id: "claim-1", target: { kind: "edge", id: "lookup" }, kind: "guard", text: "The policy rejects overlapping ranges.",
      evidence: [{ kind: "code", path: "policy.ts", startLine: 17, endLine: 21 },
        { kind: "docs", path: "docs/policy.md", startLine: 5, endLine: 8, stale: true }],
      replay: { flow: "reserve", scenario: "conflict", step: "reject", stepIndex: 3 } },
    { id: "claim-2", target: { kind: "node", id: "policy" }, kind: "decision", text: "Reservations use a shared policy.",
      evidence: [{ kind: "docs", path: "docs/policy.md", startLine: 9, endLine: 12 }] }
  ]
};

test("explanation shares exact engine graph references and preserves directed relationships", () => {
  const items = diagramItems(diagram);
  const rule = items.find(({ ref }) => ref === "stage:diagram:booking:edge:lookup");
  assert.deepEqual(claimsForItem(diagram, rule).map(({ id }) => id), ["claim-1"]);
  const policy = items.find(({ ref }) => ref === "stage:diagram:booking:node:policy");
  assert.deepEqual(claimsForItem(diagram, policy).map(({ id }) => id), ["claim-2"]);
  const incomingAndOutgoing = connectionsForNode(items, "policy");
  assert.deepEqual(incomingAndOutgoing.map(({ from, to }) => [from, to]), [["api", "policy"], ["policy", "api"]]);
  assert.equal(incomingAndOutgoing[1].ref, "stage:diagram:booking:edge:1");
  assert.deepEqual(claimsForItem(diagram, incomingAndOutgoing[1]), []);
});

test("current claim citations open a document's exact Explain target, stale citations do not", () => {
  const index = indexReadingEvidence([diagram], []);
  assert.deepEqual(index.get("docs/policy.md").map(({ itemRef }) => itemRef), ["stage:diagram:booking:node:policy"]);
  assert.equal(relatedReadingEvidence(index.get("policy.ts"), 17, 21)[0].itemRef, "stage:diagram:booking:edge:lookup");
});

test("comparison finds the exact repeated event whose recorded state changes", () => {
  const flow = { id: "send", title: "Notify", scope: "module:reservations", kind: "next",
    path: [{ id: "start", ref: "step:start" }, { id: "send", ref: "step:send" }, { id: "stop", ref: "step:stop" }],
    branches: [{ at: 1, id: "retry", condition: "Retry", path: [{ id: "wait", ref: "step:wait" }], join: "send" }],
    scenarios: ["ordinary", "late"].map((id) => ({
      id, title: id, steps: ["start", "send", "wait", "send", "stop"],
      events: [{ stepIndex: 3, state: [{ key: "result", value: id }, { key: "attempt", value: "2" }],
        source: { path: "notifier.ts", startLine: 12 } }]
    }))
  };
  const [ordinary, late] = buildFlowReplay(flow).traces;
  assert.deepEqual(replayDifferences(ordinary, late), { pathSplit: undefined, stateDifference: 3 });
  assert.deepEqual(replayDifferences(ordinary, ordinary), { pathSplit: undefined, stateDifference: undefined });
  assert.deepEqual(replayDifferences(ordinary, { ...ordinary, steps: ordinary.steps.slice(0, 4) }),
    { pathSplit: 4, stateDifference: undefined });
});

const compareTrace = (id, title, result) => ({
  id, title,
  steps: ["request", "authenticate", "check", result].map((step) => ({
    id: step, point: { ref: `step:${step}`, caption: step,
      state: step === "request" ? [{ key: "example", value: id }] : undefined }
  }))
});
const activeTitle = "The operator submits a reservation with an occupied date and receives an overlap conflict";
const conflict = compareTrace("conflict", activeTitle, "reject");
const confirmed = compareTrace("confirmed", "The owner confirms a reservation", "confirm");

test("comparison distinguishes the shared input difference from the later actual path split", () => {
  assert.deepEqual(replayDifferences(conflict, confirmed), { pathSplit: 3, stateDifference: 0 });
});

test("the lobby renders one contextual panel even beside an actionable exhibit", () => {
  assert.equal(worldHudPanel(true, false, false, false), "directory");
  assert.equal(worldHudPanel(true, true, false, false), "directory");
  assert.equal(worldHudPanel(true, true, true, false), "nearby");
  assert.equal(worldHudPanel(true, true, true, true), "directory");
  assert.equal(worldHudPanel(false, true, true, true), "nearby");
  assert.equal(worldHudPanel(false, false, false, false), undefined);
});

test("Explain renders direction, exact evidence and a stale marker without replay transport", async () => {
  const [{ createServer }, { createElement }, { renderToStaticMarkup }] = await Promise.all([
    import("vite"), import("react"), import("react-dom/server")
  ]);
  const vite = await createServer({ configFile: false, appType: "custom", esbuild: { jsx: "automatic" },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  try {
    const { DiagramExplanation } = await vite.ssrLoadModule("/packages/ui/src/viewer/DiagramExplanation.tsx");
    const props = { diagram, owner: "Reservations", selectedRef: "stage:diagram:booking:edge:lookup",
      select: () => undefined, close: () => undefined, fit: () => undefined, openSource: () => undefined,
      openReplay: () => true, showInspect: () => undefined, relatedReplays: [] };
    const html = renderToStaticMarkup(createElement(DiagramExplanation, props));
    assert.match(html, /aria-label="Diagram explanation"/);
    assert.match(html, /<dt>From<\/dt>.*Booking endpoint/);
    assert.match(html, /<dt>To<\/dt>.*Overlap policy/);
    assert.match(html, /policy\.ts:17–21/);
    assert.match(html, /Documentation · Changed since generation/);
    assert.match(html, /Replay saved example/);
    assert.doesNotMatch(html, /Scenario controls|Playback progress/);
    const legacy = renderToStaticMarkup(createElement(DiagramExplanation, { ...props, diagram: { ...diagram, claims: [] } }));
    assert.match(legacy, /No authored explanation was saved/);
    assert.match(legacy, /Existing booking overlaps/);
    assert.doesNotMatch(legacy, /Evidence trail/);

    const source = { path: "docs/data.md", startLine: 12, endLine: 15 };
    const erd = { id: "data", owner: "city", title: "Account model", kind: "erd", source,
      nodes: [{ id: "account", label: "Account", fields: [{ name: "owner_id", type: "integer", keys: ["PK", "FK"],
        source: { path: "docs/data.md", startLine: 14 } }] }, { id: "profile", label: "Profile" }],
      edges: [{ id: "e-1", from: "account", to: "profile", kind: "dashed", cardinality: { from: "1", to: "0..1" } }] };
    assert.equal(diagramForDocumentFence([{ ...diagram, source }, erd], "docs/data.md", 12, 15, ["erDiagram"])?.id, "data");
    const entity = renderToStaticMarkup(createElement(DiagramExplanation, { ...props, diagram: erd, selectedRef: "stage:diagram:data:node:account" }));
    assert.match(entity, /Entity fields/);
    assert.match(entity, /owner_id source docs\/data\.md:14/);
    assert.match(entity, /PK, FK/);
    const relation = renderToStaticMarkup(createElement(DiagramExplanation, { ...props, diagram: erd, selectedRef: "stage:diagram:data:edge:e-1" }));
    assert.match(relation, /Exactly one \(1\)/);
    assert.match(relation, /Zero or one \(0\.\.1\)/);
    assert.match(relation, /Non-identifying/);
  } finally {
    await vite.close();
  }
});

test("Replay shows the full active scenario name and leads comparison with the path split", async () => {
  const [{ createServer }, { createElement }, { renderToStaticMarkup }] = await Promise.all([
    import("vite"), import("react"), import("react-dom/server")
  ]);
  const vite = await createServer({ configFile: false, appType: "custom", esbuild: { jsx: "automatic" },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  try {
    const { ReplayPanels } = await vite.ssrLoadModule("/packages/ui/src/viewer/LearningPanels.tsx");
    const html = renderToStaticMarkup(createElement(ReplayPanels, {
      replay: { flowId: "reserve", title: "Reserve", scenarioId: "conflict", scenarios: [conflict, confirmed],
        playing: false, step: 0, steps: 4, timeline: [], finished: false },
      openSource: () => undefined, traces: [conflict, confirmed]
    }));
    const title = /class="kd-replay-active-scenario" id="([^"]+)"[^>]*>.*?<strong>([^<]+)<\/strong>/.exec(html);
    assert.equal(title?.[2], activeTitle);
    assert.ok(html.includes(`aria-describedby="${title[1]}"`));
    assert.ok(html.includes(`title="${activeTitle}"`));
    assert.match(html, /First path split · Step 4/);
    assert.match(html, /Recorded data already differs on shared step 1/);
    const { ReplayComparison } = await vite.ssrLoadModule("/packages/ui/src/viewer/ReplayComparison.tsx");
    const stateOnly = renderToStaticMarkup(createElement(ReplayComparison, {
      current: conflict, alternatives: [compareTrace("similar", "Another overlap", "reject")], openAt: () => undefined
    }));
    assert.match(stateOnly, /Same path, different recorded state · Step 1/);
    assert.doesNotMatch(stateOnly, /First path split/);
  } finally {
    await vite.close();
  }
});
