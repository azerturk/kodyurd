import assert from "node:assert/strict";
import { test } from "node:test";
import { cityRelationships } from "../src/viewer/city-relations.ts";

test("city relationships follow the named module or a unique code owner rather than a documentation folder", () => {
  const source = (path, startLine = 3) => ({ path, startLine });
  const ref = (id) => ({ ref: id });
  const city = { buildings: [
    { id: "b-checkout", title: "Checkout", moduleRef: "checkout" },
    { id: "b-worker", title: "Worker", moduleRef: "worker" },
    { id: "b-delivery", title: "Delivery", moduleRef: "worker/delivery" },
    { id: "b-docs", title: "Docs", moduleRef: "docs" },
    { id: "b-root", title: "Composition", moduleRef: "(root)" }
  ] };
  const docs = source("docs/architecture.md");
  const diagrams = [
    { id: "city", owner: "city", kind: "graph", title: "Context",
      nodes: [{ id: "a", label: "Checkout", source: docs }, { id: "b", label: "Worker", source: docs }],
      edges: [{ from: "a", to: "b", label: "enqueue", source: docs }] },
    { id: "worker", owner: "b-worker", kind: "graph", title: "Worker map", nodes: [
      { id: "service", label: "Dispatch", source: source("worker/dispatch.js") },
      { id: "client", label: "Transport", source: source("worker/delivery/transport.js") },
      { id: "unknown", label: "Unverified", source: docs },
      { id: "import", label: "Checkout import", source: source("app.mjs") }
    ], edges: [{ from: "service", to: "client", kind: "async", source: source("worker/dispatch.js", 7) },
      { from: "service", to: "unknown", source: docs }, { from: "service", to: "import", source: source("app.mjs") }] }
  ];
  const flows = [{ id: "unproven", scope: "system", path: [ref("b-checkout"), ref("step:guard"), ref("b-docs")], source: docs }];
  assert.deepEqual(cityRelationships({ city, flows, diagrams }).map(({ from, to, kind, title }) => ({ from, to, kind, title })), [
    { from: "b-checkout", to: "b-worker", kind: "call", title: "enqueue" },
    { from: "b-worker", to: "b-delivery", kind: "message", title: "Worker → Delivery" }
  ]);
});
