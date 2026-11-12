import assert from "node:assert/strict";
import test from "node:test";
import { parseSpace } from "@kodyurd/scene-schema";
import { readAuthoredDiagrams } from "../dist/authored-diagrams.js";
import { layoutDiagram } from "../dist/space-layout/diagram.js";

const fence = (...lines) => ["# Notes", "", "## Diagram", "", "```mermaid", ...lines, "```"].join("\n");
const first = 6; // The diagram type is on line 6, so its first statement is on line 7.

function city() {
  const result = parseSpace({
    version: "0.2",
    meta: { name: "Notations", sourceDir: "/never/read", createdAt: "2026-11-12",
      coverage: [{ doc: "docs/model.md", sections: 1, placed: 0, pending: 1 }] },
    city: { districts: [{ id: "d", title: "Local" }],
      buildings: [{ id: "b-docs", moduleRef: "docs", title: "Docs", district: "d", summary: "Design notes." }] }
  });
  assert.equal(result.success, true, JSON.stringify(result));
  return result.data;
}
const read = async (...lines) => readAuthoredDiagrams(city(), async () => fence(...lines).split("\n"));

test("a class diagram keeps members, direction of inheritance and multiplicity", async () => {
  const [diagram] = await read(
    "classDiagram",
    "    direction LR",
    "    class Reservation {",
    "        <<entity>>",
    "        +String id",
    "        -status: Status",
    "        +cancel(actor) Reservation",
    "        +isActive()",
    "    }",
    "    class Resource",
    "    Resource : +int capacity",
    "    Booking <|-- Reservation",
    "    Reservation \"0..*\" --> \"1\" Resource : reserves",
    "    Worker ..> Reservation",
    "    Desk *-- Drawer"
  );
  assert.equal(diagram.kind, "class");
  assert.equal(diagram.origin, "mermaid");
  assert.deepEqual(diagram.nodes.map(({ id }) => id), ["Reservation", "Resource", "Booking", "Worker", "Desk", "Drawer"]);
  assert.deepEqual(diagram.nodes[0].fields.map(({ name, type }) => [name, type]),
    [["id", "String"], ["status", "Status"], ["cancel(actor)", "Reservation"], ["isActive()", "method"]]);
  assert.deepEqual(diagram.nodes[0].fields[2].source, { path: "docs/model.md", startLine: first + 6, endLine: first + 6 });
  assert.deepEqual(diagram.nodes[1].fields.map(({ name, type }) => [name, type]), [["capacity", "int"]]);
  assert.deepEqual(diagram.edges.map(({ from, to, label, kind, cardinality }) => [from, to, label, kind, cardinality]), [
    ["Reservation", "Booking", "extends", "solid", undefined],
    ["Reservation", "Resource", "reserves", "solid", { from: "0..*", to: "1" }],
    ["Worker", "Reservation", "uses", "dashed", undefined],
    ["Desk", "Drawer", "owns", "solid", undefined]
  ]);
  // Classes alone are still a diagram; an unknown statement keeps the block as text.
  assert.equal((await read("classDiagram", "class Slot {", "  +int index", "}", "class Label"))[0].nodes.length, 2);
  assert.deepEqual(await read("classDiagram", "class Slot", "note for Slot \"free text\""), []);
});

test("C4 elements become a grouped component map with people, stores and external systems", async () => {
  const [diagram] = await read(
    "C4Container",
    "    title Harbor Desk containers",
    "    Person(member, \"Member\", \"Books a desk, or a room\")",
    "    System_Ext(mail, \"Mail provider\")",
    "    System_Boundary(desk, \"Harbor Desk\") {",
    "        Container(api, \"HTTP API\", \"Node.js\")",
    "        ContainerDb(db, \"SQLite store\", \"SQLite\")",
    "        ContainerQueue(outbox, \"Outbox\")",
    "    }",
    "    Rel(member, api, \"Books over HTTP\")",
    "    Rel_Back(db, api, \"Reads and writes\", \"SQL\")",
    "    BiRel(api, outbox, \"Queues\")",
    "    UpdateLayoutConfig($c4ShapeInRow=\"3\", $c4BoundaryInRow=\"1\")"
  );
  assert.equal(diagram.kind, "graph");
  assert.deepEqual(diagram.nodes.map(({ id, label, hint, group, icon }) => [id, label, hint, group, icon]), [
    ["member", "Member", "actor", undefined, "user"], ["mail", "Mail provider", "external", undefined, undefined],
    ["api", "HTTP API", undefined, "Harbor Desk", undefined], ["db", "SQLite store", "store", "Harbor Desk", "database"],
    ["outbox", "Outbox", "queue", "Harbor Desk", undefined]
  ]);
  assert.deepEqual(diagram.edges.map(({ from, to, label }) => [from, to, label]),
    [["member", "api", "Books over HTTP"], ["api", "db", "Reads and writes"], ["api", "outbox", "Queues"]]);
  assert.deepEqual(await read("C4Context", "Person(a, \"A\")", "Rel(a, missing, \"Uses\")"), []);
  assert.deepEqual(await read("C4Context", "System_Boundary(s, \"Open\") {", "System(a, \"A\")", "System(b, \"B\")", "Rel(a, b, \"Uses\")"), []);
});

test("gantt, journey and timeline blocks become ordered timelines with their sections", async () => {
  const [plan] = await read("gantt", "    title Release", "    dateFormat YYYY-MM-DD", "    section Build",
    "    Schema change :done, s1, 2031-06-01, 3d", "    API change :active, after s1, 5d", "    section Ship", "    Announce :milestone, 2031-06-12, 0d");
  assert.equal(plan.kind, "timeline");
  assert.deepEqual(plan.nodes.map(({ label, group }) => [label, group]), [["Schema change", "Build"], ["API change", "Build"], ["Announce", "Ship"]]);
  assert.deepEqual(plan.nodes[1].source, { path: "docs/model.md", startLine: first + 5, endLine: first + 5 });
  assert.deepEqual(plan.edges, []);

  const [trip] = await read("journey", "    title Booking", "    section Choose", "      Pick a room: 5: Member", "      Read the quote: 3: Member, Operator");
  assert.deepEqual(trip.nodes.map(({ label, group }) => [label, group]), [["Pick a room (5/5)", "Choose"], ["Read the quote (3/5)", "Choose"]]);

  const [history] = await read("timeline", "    title Outbox", "    2029 : Mailbox table", "         : First worker", "    2031 : Retry with backoff : Terminal failure");
  assert.deepEqual(history.nodes.map(({ label }) => label), ["2029: Mailbox table; First worker", "2031: Retry with backoff; Terminal failure"]);
  assert.deepEqual(await read("journey", "Pick a room: nine: Member", "Pay: 4: Member"), []);
});

test("a mindmap becomes one tree and lays out around its root without overlap", async () => {
  const [diagram] = await read(
    "mindmap",
    "  root((Harbor Desk))",
    "    Reservations",
    "      ::icon(fa fa-book)",
    "      Quotes",
    "      Conflicts",
    "    Notifications[Local mailbox]",
    "      Retry",
    "    Identity"
  );
  assert.equal(diagram.kind, "mindmap");
  const label = new Map(diagram.nodes.map(({ id, label }) => [id, label]));
  assert.deepEqual(diagram.edges.map(({ from, to }) => [label.get(from), label.get(to)]), [
    ["Harbor Desk", "Reservations"], ["Reservations", "Quotes"], ["Reservations", "Conflicts"],
    ["Harbor Desk", "Local mailbox"], ["Local mailbox", "Retry"], ["Harbor Desk", "Identity"]
  ]);
  const layout = layoutDiagram(diagram);
  const box = new Map(layout.nodes.map((node) => [label.get(node.id), node]));
  const root = box.get("Harbor Desk");
  for (const [name, node] of box) {
    assert.ok(node.x >= 0 && node.y >= 0 && node.x + node.w <= layout.width && node.y + node.h <= layout.height, name);
    for (const [other, peer] of box) {
      if (other === name) continue;
      const apart = node.x + node.w <= peer.x || peer.x + peer.w <= node.x || node.y + node.h <= peer.y || peer.y + peer.h <= node.y;
      assert.ok(apart, `${name} overlaps ${other}`);
    }
  }
  const centre = (node) => [node.x + node.w / 2, node.y + node.h / 2];
  const distance = (name) => Math.hypot(centre(box.get(name))[0] - centre(root)[0], centre(box.get(name))[1] - centre(root)[1]);
  assert.ok(distance("Quotes") > distance("Reservations"), "a deeper topic stands farther from the root");
  assert.deepEqual(await read("mindmap", "First root", "Second root"), []);
});
