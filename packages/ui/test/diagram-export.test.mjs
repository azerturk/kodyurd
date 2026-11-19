import assert from "node:assert/strict";
import { test } from "node:test";
import { parseMermaidText } from "../../server/dist/authored-diagrams.js";
import { parseDrawio } from "../../server/dist/drawio.js";
import { mermaidExportWarnings, toDrawio, toMermaid } from "../src/viewer/diagram-export.ts";

const read = (diagram) => parseMermaidText(toMermaid(diagram), "city", diagram.title);
const base = { id: "d", owner: "city", title: "Exported" };

test("exported Mermaid reads back as the same diagram", () => {
  const graph = read({ ...base, kind: "graph",
    nodes: [{ id: "api", label: "HTTP API", group: "Edge" }, { id: "svc", label: "Service: orders", group: "Core" }, { id: "db", label: "Store" }],
    edges: [{ from: "api", to: "svc", label: "create(order)" }, { from: "svc", to: "db", kind: "dashed", guard: "valid" }] });
  assert.deepEqual(graph.nodes.map(({ label, group }) => [label, group]), [["HTTP API", "Edge"], ["Service: orders", "Core"], ["Store", undefined]]);
  assert.deepEqual(graph.edges.map(({ label, kind }) => [label, kind]), [["create order", "solid"], ["valid", "dashed"]]);

  const sequence = read({ ...base, kind: "sequence", nodes: [{ id: "u", label: "Member", hint: "actor" }, { id: "s", label: "Service" }],
    edges: [{ from: "u", to: "s", label: "book" }, { from: "s", to: "u", label: "confirmed", kind: "return" }] });
  assert.deepEqual(sequence.edges.map(({ from, to, kind }) => [from === sequence.nodes[0].id, to === sequence.nodes[0].id, kind]),
    [[true, false, "solid"], [false, true, "dashed"]]);

  const state = read({ ...base, kind: "state", nodes: [{ id: "a", label: "Confirmed", hint: "initial" }, { id: "b", label: "Cancelled", hint: "terminal" }],
    edges: [{ from: "a", to: "b", label: "cancel" }] });
  assert.ok(state.nodes.some(({ label }) => label === "Confirmed"));
  assert.ok(state.edges.some(({ guard }) => guard === "cancel"), "the importer reads a transition's text as its guard");

  const erd = read({ ...base, kind: "erd",
    nodes: [{ id: "r", label: "reservations", fields: [{ name: "id", type: "TEXT", keys: ["PK"] }] }, { id: "o", label: "outbox", fields: [{ name: "reservation_id", type: "TEXT", keys: ["FK"] }] }],
    edges: [{ from: "r", to: "o", label: "queues", cardinality: { from: "1", to: "0..*" } }] });
  assert.deepEqual(erd.nodes.map(({ label, fields }) => [label, fields[0].name, fields[0].keys]), [["reservations", "id", ["PK"]], ["outbox", "reservation_id", ["FK"]]]);
  assert.deepEqual(erd.edges[0].cardinality, { from: "1", to: "0..*" });

  const classes = read({ ...base, kind: "class",
    nodes: [{ id: "p", label: "Problem", fields: [{ name: "status", type: "number" }] }, { id: "e", label: "Error" }],
    edges: [{ from: "p", to: "e", label: "extends" }] });
  assert.deepEqual(classes.edges.map(({ from, to, label }) => [from, to, label]), [["Problem", "Error", "extends"]]);

  const mindmap = read({ ...base, kind: "mindmap", nodes: [{ id: "r", label: "Reservations" }, { id: "a", label: "Creation" }, { id: "b", label: "Overlap check" }],
    edges: [{ from: "r", to: "a" }, { from: "a", to: "b" }] });
  assert.deepEqual(mindmap.nodes.map(({ label }) => label), ["Reservations", "Creation", "Overlap check"]);
  assert.equal(mindmap.edges.length, 2);
});

test("an exported diagrams.net file keeps items, groups and line styles", () => {
  const diagram = { ...base, kind: "graph",
    nodes: [{ id: "a", label: "API" }, { id: "b", label: "Store <main>", hint: "store" }],
    edges: [{ from: "a", to: "b", label: "writes", kind: "dashed" }] };
  const xml = toDrawio(diagram, [{ id: "a", x: 10, y: 20, w: 160, h: 60 }]);
  assert.match(xml, /x="10" y="20" width="160"/);
  const back = parseDrawio(xml, "city", "Exported");
  assert.deepEqual(back.nodes.map(({ label }) => label), ["API", "Store <main>"]);
  assert.deepEqual(back.edges.map(({ from, to, label, kind }) => [from, to, label, kind]), [["n1", "n2", "writes", "dashed"]]);
});

test("Mermaid entity and class identifiers never merge distinct names and class multiplicities keep their direction", () => {
  for (const kind of ["erd", "class"]) {
    const diagram = { ...base, kind, nodes: [{ id: "one", label: "Order item" }, { id: "two", label: "Order-item" }, { id: "three", label: "Order_item_2" }],
      edges: [{ from: "one", to: "two", label: "owns", cardinality: { from: "1", to: "0..*" } },
        { from: "two", to: "three", label: "extends", cardinality: { from: "0..1", to: "1" } }] };
    const parsed = read(diagram);
    assert.ok(parsed);
    assert.equal(parsed.nodes.length, 3);
    assert.equal(new Set(parsed.nodes.map(({ id }) => id)).size, 3);
    assert.equal(parsed.edges.length, 2);
    assert.deepEqual(parsed.edges.map(({ cardinality }) => cardinality), diagram.edges.map(({ cardinality }) => cardinality));
    assert.ok(mermaidExportWarnings(diagram).some((warning) => warning.includes("distinct identifiers")));
  }
});

test("a deep mind map keeps its full tree and a disconnected or cyclic mind map keeps every item as a flowchart", () => {
  const nodes = Array.from({ length: 12 }, (_, index) => ({ id: `n${index}`, label: `Topic ${index}` }));
  const edges = nodes.slice(1).map((node, index) => ({ from: nodes[index].id, to: node.id }));
  const tree = { ...base, kind: "mindmap", nodes, edges };
  const parsed = read(tree);
  assert.equal(parsed.nodes.length, 12);
  assert.equal(parsed.edges.length, 11);
  assert.equal(parsed.nodes.at(-1).label, "Topic 11");
  assert.deepEqual(mermaidExportWarnings(tree), []);
  for (const diagram of [{ ...tree, edges: edges.slice(1) }, { ...tree, edges: [{ from: "n0", to: "n1" }, { from: "n1", to: "n0" }] }]) {
    assert.match(toMermaid(diagram), /^flowchart LR/);
    assert.ok(mermaidExportWarnings(diagram).some((warning) => warning.includes("every item and link")));
    const back = read(diagram);
    assert.equal(back.nodes.length, nodes.length);
    assert.equal(back.edges.length, diagram.edges.length);
  }
});

test("diagrams.net round trip keeps groups, literal labels, self loops and inert markup", () => {
  const diagram = { ...base, kind: "graph", nodes: [
    { id: "a", label: 'API <main> "quoted" \\ path & value', group: "Core & API" },
    { id: "b", label: '<script>alert(1)</script>', group: "Core & API" },
    { id: "c", label: "Outside" }
  ], edges: [{ from: "a", to: "a", label: "retry <again>", kind: "dashed" }, { from: "a", to: "b", label: "send" }] };
  const text = toDrawio(diagram);
  assert.doesNotMatch(text, /<script>/);
  assert.match(text, /parent="g1"/);
  const parsed = parseDrawio(text, "city", "Exported");
  assert.deepEqual(parsed.nodes.map(({ label, group }) => [label, group]), diagram.nodes.map(({ label, group }) => [label, group]));
  assert.equal(parsed.edges[0].from, parsed.edges[0].to);
  assert.equal(parsed.edges[0].label, "retry <again>");
});
