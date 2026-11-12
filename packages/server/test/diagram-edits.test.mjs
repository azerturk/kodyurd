import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { deflateRawSync } from "node:zlib";
import { parseMermaidText } from "../dist/authored-diagrams.js";
import { applyDiagramEdits, readDiagramEdits, removeDiagramEdit, saveDiagramEdit, USER_DIAGRAM_LIMIT, userDiagram } from "../dist/diagram-edits.js";
import { parseDrawio } from "../dist/drawio.js";

const at = (line) => ({ path: "orders/service.mjs", startLine: line, endLine: line });
const space = { city: { buildings: [{ id: "orders" }, { id: "billing" }] }, diagrams: [], navigation: { searchIndex: [] } };
const generated = {
  id: "kc-map-1", owner: "orders", title: "Order map", kind: "graph", origin: "code", source: at(1),
  nodes: [{ id: "api", label: "API", source: at(2) }, { id: "store", label: "Store", source: at(3) }, { id: "mail", label: "Mailer", source: at(4) }],
  edges: [{ id: "write", from: "api", to: "store", label: "writes", source: at(5) }, { from: "api", to: "mail", source: at(6) }],
  claims: [{ id: "c1", target: { kind: "node", id: "mail" }, kind: "responsibility", text: "Sends the receipt.",
    evidence: [{ kind: "code", path: "orders/service.mjs", startLine: 4, endLine: 4 }] },
  { id: "c2", target: { kind: "edge", id: "write" }, kind: "output", text: "Persists the order.",
    evidence: [{ kind: "code", path: "orders/service.mjs", startLine: 5, endLine: 5 }] }]
};

test("a corrected diagram keeps the citations of what stayed and cites nothing the user added", () => {
  const edited = userDiagram({
    owner: "orders", title: "Order map, corrected", kind: "graph", origin: "code",
    nodes: [{ id: "api", label: "HTTP API", source: at(99) }, { id: "store", label: "Store" }, { id: "queue", label: "Queue", source: at(50) }],
    edges: [{ id: "write", from: "api", to: "store", label: "saves" }, { from: "api", to: "queue", label: "enqueues", source: at(51) }],
    claims: [{ id: "forged", target: { kind: "node", id: "queue" }, kind: "responsibility", text: "Invented.", evidence: [] }]
  }, space, generated.id, generated);
  assert.equal(edited.origin, "user");
  assert.deepEqual(edited.source, at(1));
  assert.deepEqual(edited.nodes.map(({ label, source }) => [label, source?.startLine]), [["HTTP API", 2], ["Store", 3], ["Queue", undefined]]);
  assert.deepEqual(edited.edges.map(({ label, source }) => [label, source?.startLine]), [["saves", 5], ["enqueues", undefined]]);
  // The claim about the removed node goes with it; nothing the editor sent becomes a claim.
  assert.deepEqual(edited.claims.map(({ id }) => id), ["c2"]);

  assert.throws(() => userDiagram({ title: "One item", kind: "graph", nodes: [{ id: "a", label: "A" }] }, space, "user-1"), /at least two named items/);
  assert.equal(userDiagram({ owner: "elsewhere", title: "Mine", kind: "mindmap",
    nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }], edges: [{ from: "a", to: "b" }] }, space, "user-1").owner, "city");
});

test("user diagrams are stored beside the city, laid over it on read and bounded", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(tmpdir(), "kodyurd-diagram-edits-"));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const corrected = userDiagram({ ...generated, title: "Corrected" }, space, generated.id, generated);
  const drawn = userDiagram({ owner: "billing", title: "Charges", kind: "state",
    nodes: [{ id: "new", label: "New", hint: "initial" }, { id: "paid", label: "Paid", hint: "terminal" }],
    edges: [{ from: "new", to: "paid", label: "charge" }] }, space, "user-abc");
  await saveDiagramEdit(dataDir, "workspace", corrected);
  await saveDiagramEdit(dataDir, "workspace", drawn);
  await saveDiagramEdit(dataDir, "workspace", { ...corrected, title: "Corrected twice" });
  const edits = await readDiagramEdits(dataDir, "workspace");
  assert.deepEqual(edits.map(({ id, title }) => [id, title]), [[generated.id, "Corrected twice"], ["user-abc", "Charges"]]);

  const base = { space: { ...space, diagrams: [generated] }, layout: { diagrams: { [generated.id]: { id: generated.id, nodes: [] } } } };
  const shown = applyDiagramEdits(base, edits);
  assert.deepEqual(shown.space.diagrams.map(({ id, title, origin }) => [id, title, origin]),
    [[generated.id, "Corrected twice", "user"], ["user-abc", "Charges", "user"]]);
  assert.equal(shown.layout.diagrams[generated.id].nodes.length, 3);
  assert.equal(shown.layout.diagrams["user-abc"].nodes.length, 2);
  assert.equal(shown.space.navigation.searchIndex[0].ref, "user-abc");
  assert.equal(base.space.diagrams[0].title, "Order map", "the generated city is left as it was");

  assert.equal(await removeDiagramEdit(dataDir, "workspace", generated.id), true);
  assert.equal(await removeDiagramEdit(dataDir, "workspace", generated.id), false);
  for (let n = 0; n < USER_DIAGRAM_LIMIT - 1; n++) await saveDiagramEdit(dataDir, "workspace", { ...drawn, id: `user-${n}` });
  await assert.rejects(saveDiagramEdit(dataDir, "workspace", { ...drawn, id: "user-over" }), /keeps up to/);
});

test("pasted Mermaid and diagrams.net files become unsaved diagrams without sources", () => {
  const pasted = parseMermaidText("```mermaid\nflowchart LR\n  A[Client] -->|books| B[Service]\n  B -.-> C[(Store)]\n```", "city", "Booking");
  assert.equal(pasted.origin, "user");
  assert.equal(pasted.source, undefined);
  assert.deepEqual(pasted.nodes.map(({ label, source }) => [label, source]), [["Client", undefined], ["Service", undefined], ["Store", undefined]]);
  assert.equal(pasted.edges.length, 2);
  assert.equal(parseMermaidText("pie title Pets\n  \"Dogs\" : 3", "city", "Pie"), undefined);

  const model = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>
    <mxCell id="box" value="Platform" style="swimlane;" vertex="1" parent="1"><mxGeometry as="geometry"/></mxCell>
    <mxCell id="a" value="&lt;b&gt;API&lt;/b&gt;&lt;br&gt;gateway" style="rounded=1;" vertex="1" parent="box"/>
    <object label="Order &amp;amp; billing" id="b"><mxCell style="rounded=1;" vertex="1" parent="box"/></object>
    <mxCell id="c" value="Mail" vertex="1" parent="1"/>
    <mxCell id="e1" value="calls" edge="1" parent="1" source="a" target="b"/>
    <mxCell id="e2" style="dashed=1;endArrow=block;" edge="1" parent="1" source="b" target="c"/>
    <mxCell id="e2l" value="notifies" style="edgeLabel;" vertex="1" connectable="0" parent="e2"/>
    <mxCell id="e3" edge="1" parent="1" source="c"/>
  </root></mxGraphModel>`;
  const file = `<mxfile host="app.diagrams.net"><diagram name="Page-1">${model}</diagram></mxfile>`;
  for (const xml of [file, `<mxfile><diagram name="Page-1">${deflateRawSync(encodeURIComponent(model)).toString("base64")}</diagram></mxfile>`]) {
    const diagram = parseDrawio(xml, "orders", "Platform");
    assert.equal(diagram.kind, "graph");
    assert.deepEqual(diagram.nodes.map(({ label, group }) => [label, group]),
      [["API gateway", "Platform"], ["Order & billing", "Platform"], ["Mail", undefined]]);
    assert.deepEqual(diagram.edges.map(({ from, to, label, kind }) => [from, to, label, kind]),
      [["n1", "n2", "calls", undefined], ["n2", "n3", "notifies", "dashed"]]);
  }
  assert.equal(parseDrawio("<mxfile><diagram>not a diagram</diagram></mxfile>", "city", "Empty"), undefined);
});
