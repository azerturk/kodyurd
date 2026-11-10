import assert from "node:assert/strict";
import { test } from "node:test";
import { buildFlowReplay, selectReplayCursor } from "../src/viewer/flow-replay.ts";
import {
  diagramForDocumentFence, documentLink, documentSection, evidenceViaSourceLinks, indexReadingEvidence, relatedReadingEvidence
} from "../src/viewer/document-navigation.ts";

test("reader resolves document headings and exact source ranges inside the workspace", () => {
  assert.deepEqual(documentLink("docs/start.md", "#review-order"), { path: "docs/start.md", anchor: "review-order" });
  assert.deepEqual(documentLink("docs/start.md", "<guides/Place%20Order.md#first-order>"), {
    path: "docs/guides/Place Order.md", anchor: "first-order"
  });
  assert.deepEqual(documentLink("docs/start.md", "../src/validate.ts#L5-L12"), { path: "src/validate.ts", from: 5, to: 12 });
  for (const target of ["https://example.org/test", "javascript:alert(1)", "//example.org/file", "/src/a.js",
    "C%3a/Windows/a.js", "..%5c..%5coutside.js", "../../outside.js", "../.git/config", "a.js#L8-L3", "a%00.js"]) {
    assert.equal(documentLink("docs/start.md", target), null, target);
  }
});

test("section navigation handles formatting, Unicode and repeated headings", () => {
  const sections = [
    { title: "Review `order`", startLine: 5, endLine: 8 },
    { title: "Review order", startLine: 9, endLine: 18 },
    { title: "Ödəniş və təsdiq", startLine: 19, endLine: 30 }
  ];
  assert.equal(documentSection(sections, "review-order")?.startLine, 5);
  assert.equal(documentSection(sections, "review-order-1")?.startLine, 9);
  assert.equal(documentSection(sections, "ödəniş-və-təsdiq")?.startLine, 19);
  assert.equal(documentSection(sections, "missing"), undefined);
});

test("an authored sequence fence opens the generated sequence through an exact message source", () => {
  const path = "docs/reservations.md";
  const cited = { path, startLine: 22, endLine: 22 };
  const sequence = { id: "booking-sequence", kind: "sequence", nodes: [], edges: [{ source: cited }],
    source: { path: "reservations/service.mjs", startLine: 12, endLine: 23 } };
  const state = { ...sequence, id: "reservation-state", kind: "state" };
  const diagrams = [state, sequence];
  assert.equal(diagramForDocumentFence(diagrams, path, 7, 44, ["%% notes", "sequenceDiagram"])?.id, sequence.id);
  assert.equal(diagramForDocumentFence(diagrams, path, 60, 69, ["sequenceDiagram"]), undefined);
  assert.equal(diagramForDocumentFence(diagrams, "docs/another.md", 7, 44, ["sequenceDiagram"]), undefined);
});

test("a document citation opens the exact repeat in a replay and a code citation selects its diagram node", () => {
  const document = "docs/start.md";
  const nodeSource = { path: "src/validate.ts", startLine: 8 };
  const flow = {
    id: "form", title: "Submit form", kind: "calls", scope: "module:web",
    path: [
      { id: "submit", ref: "step:submit", caption: "Submit", source: { path: document, startLine: 10 } },
      { id: "valid", ref: "step:valid", caption: "Validate", source: nodeSource },
      { id: "show", ref: "step:show", caption: "Show result", source: { path: document, startLine: 16 } }
    ],
    branches: [{ id: "fix", at: 1, condition: "Invalid input", path: [{ id: "edit", ref: "step:edit", caption: "Correct a field" }], join: "valid" }],
    scenarios: [{
      id: "correct", title: "Correct the form",
      steps: ["submit", "valid", "edit", "valid", "show"],
      events: [{ stepIndex: 3, source: { path: document, startLine: 41, endLine: 42 } }]
    }]
  };
  const diagrams = [{
    id: "validation", owner: "web", title: "Form validation", kind: "graph", nodes: [
      { id: "check", label: "Check fields", source: nodeSource },
      { id: "confirm", label: "Show confirmation" }
    ], edges: [{ id: "accept", from: "check", to: "confirm", label: "Accept form", source: { path: document, startLine: 42 } }]
  }];
  const { traces } = buildFlowReplay(flow);
  const index = indexReadingEvidence(diagrams, [{ flow, traces }]);
  const related = relatedReadingEvidence(index.get(document), 40, 44);
  const replay = related.find((item) => item.kind === "replay");
  assert.deepEqual(replay.target, { flow: "form", scenario: "correct", step: "valid", stepIndex: 3 });
  assert.equal(selectReplayCursor(traces, { scenarioId: replay.target.scenario, stepId: replay.target.step, stepIndex: replay.target.stepIndex })?.step, 3);
  assert.equal(related.find((item) => item.kind === "diagram").itemRef, "stage:diagram:validation:edge:accept");
  assert.equal(index.get("src/validate.ts")[0].itemRef, "stage:diagram:validation:node:check");
});

test("the evidence library supports a plain, linear function with no Markdown or authored scenarios", () => {
  const path = "src/total.ts";
  const flow = {
    id: "total", title: "Compute total", kind: "next", scope: "module:pricing", path: [
      { ref: "step:read", caption: "Read amounts", source: { path, startLine: 1 } },
      { ref: "step:sum", caption: "Return total", source: { path, startLine: 3 } }
    ]
  };
  const { traces } = buildFlowReplay(flow);
  const index = indexReadingEvidence([], [{ flow, traces }]);
  assert.deepEqual([...index.keys()], [path]);
  assert.deepEqual(relatedReadingEvidence(index.get(path), 3, 3)[0].target,
    { flow: "total", scenario: "main", step: "main:1", stepIndex: 1 });
  assert.equal(selectReplayCursor(traces, { scenarioId: "main", stepId: "main:1", stepIndex: 1 })?.step, 1);
});

test("a contract's explicit source link shows evidence from that range only", () => {
  const path = "form/submit.test.mjs";
  const flow = {
    id: "submit", title: "Submit", kind: "next", scope: "module:form", path: [
      { id: "read", ref: "step:read", caption: "Read fields", source: { path, startLine: 2 } },
      { id: "check", ref: "step:check", caption: "Check input", source: { path, startLine: 5, endLine: 6 } },
      { id: "show", ref: "step:show", caption: "Show outcome", source: { path, startLine: 23 } }
    ]
  };
  const { traces } = buildFlowReplay(flow);
  const index = indexReadingEvidence([], [{ flow, traces }]);
  const target = documentLink("docs/contract.md", "../form/submit.test.mjs#L5-L8");
  const [match] = evidenceViaSourceLinks(index, [target], []);
  assert.equal(match.label, "Check input");
  assert.deepEqual(match.target, { flow: "submit", scenario: "main", step: "check", stepIndex: 1 });
  assert.deepEqual(evidenceViaSourceLinks(index, [target, target], []), [match]);
  assert.deepEqual(evidenceViaSourceLinks(index, [target], [match]), []);
  assert.deepEqual(evidenceViaSourceLinks(index, [{ path, from: 12, to: 18 }], []), []);
});

test("document rendering keeps code, remote images and HTML inert while exposing real local links", async () => {
  const [{ createServer }, { createElement }, { renderToStaticMarkup }] = await Promise.all([
    import("vite"), import("react"), import("react-dom/server")
  ]);
  const vite = await createServer({
    configFile: false,
    appType: "custom",
    esbuild: { jsx: "automatic" },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null }
  });
  try {
    const { DocumentReader } = await vite.ssrLoadModule("/packages/ui/src/viewer/DocumentReader.tsx");
    const lines = [
      "# Form contract",
      "> Keep the result **visible**.",
      "",
      "4. Send a request",
      "- Open the [test](../form/submit.test.mjs#L5-L8)",
      "",
      "| Example | Expected |",
      "| --- | --- |",
      "| Empty | Validation message |",
      "",
      "~~~~mermaid",
      "flowchart TD",
      "~~~",
      "[fenced link](../secret.txt)",
      "~~~~",
      "",
      "![external image](https://example.org/image.png)",
      "<script>alert('markup')</script>"
    ];
    let links = [];
    const html = renderToStaticMarkup(createElement(DocumentReader, {
      excerpt: { path: "docs/contract.md", from: 1, to: lines.length, totalLines: lines.length, text: lines.join("\n") },
      diagrams: [], linkedEvidence: (targets) => { links = targets; return null; },
      openRange: () => undefined, openPath: () => undefined, openDiagram: () => undefined
    }));
    assert.deepEqual(links, [{ path: "form/submit.test.mjs", from: 5, to: 8 }]);
    assert.match(html, /<blockquote>Keep the result <strong>visible<\/strong>\.<\/blockquote>/);
    assert.match(html, /<ol start="4"><li>Send a request<\/li><\/ol><ul>/);
    assert.match(html, /<th scope="col">Expected<\/th>/);
    assert.match(html, /Diagram definition/);
    assert.match(html, /\[fenced link\]\(\.\.\/secret\.txt\)/);
    assert.match(html, /&lt;script&gt;/);
    assert.doesNotMatch(html, /<script|<img|https:\/\/example\.org/);
  } finally {
    await vite.close();
  }
});
