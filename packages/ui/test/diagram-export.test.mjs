import assert from "node:assert/strict";
import { test } from "node:test";
import { parseMermaidText } from "../../server/dist/authored-diagrams.js";
import { parseDrawio } from "../../server/dist/drawio.js";
import { toDrawio, toMermaid } from "../src/viewer/diagram-export.ts";

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
  assert.deepEqual(back.nodes.map(({ label }) => label), ["API", "Store main"]);
  assert.deepEqual(back.edges.map(({ from, to, label, kind }) => [from, to, label, kind]), [["n1", "n2", "writes", "dashed"]]);
});
