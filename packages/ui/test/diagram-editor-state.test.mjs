import assert from "node:assert/strict";
import { test } from "node:test";
import { diagramChanges, editorProblem, editorSnapshot, editorValue, recordEditor, redoEditor, undoEditor } from "../src/viewer/diagram-editor-state.ts";

const source = { path: "model.ts", startLine: 7, endLine: 12 };
const base = { id: "d", owner: "city", title: "Model", kind: "class", source,
  nodes: [{ id: "a", label: "Account", hint: "service", fields: [
    { name: "id", type: "string", note: "Stable identifier", source },
    { name: "close()", type: "void", note: "Ends the session", source }
  ], source }, { id: "b", label: "Profile" }],
  edges: [{ id: "self", from: "a", to: "a", label: "retry", guard: "pending", kind: "dashed", cardinality: { from: "1", to: "0..*" }, source }],
  claims: [{ id: "claim", target: { kind: "edge", id: "self" }, kind: "guard", text: "Retry pending work", evidence: [{ kind: "code", ...source }] }] };

test("an untouched editor preserves self links, class cardinality, field notes and evidence", () => {
  const snapshot = editorSnapshot(base);
  assert.deepEqual(editorValue(snapshot), base);
  assert.deepEqual(diagramChanges(base, editorValue(snapshot)), []);
  assert.equal(editorProblem(editorValue(snapshot)), undefined);
  for (const kind of ["state", "sequence", "timeline", "stack", "matrix", "graph", "mindmap", "erd"]) {
    const diagram = { ...base, kind };
    assert.deepEqual(editorValue(editorSnapshot(diagram)), diagram);
  }
});

test("editing one field keeps untouched metadata and reports duplicate fields instead of dropping them", () => {
  const snapshot = editorSnapshot(base);
  const next = editorValue({ ...snapshot, fieldText: { ...snapshot.fieldText, a: "id: string\nclose(): boolean" } });
  assert.deepEqual(next.nodes[0].fields[0], base.nodes[0].fields[0]);
  assert.deepEqual(next.nodes[0].fields[1], { name: "close()", type: "boolean", keys: undefined });
  assert.equal(next.edges[0], base.edges[0]);
  const invalid = editorValue({ ...snapshot, fieldText: { ...snapshot.fieldText, a: "id: string\nid: string" } });
  assert.match(editorProblem(invalid), /repeated field names/);
});

test("undo restores deleted graph structure and field text, redo restores it, and a new edit clears redo", () => {
  const original = editorSnapshot(base);
  let history = { past: [], present: original, future: [] };
  const edited = { ...original, diagram: { ...base, nodes: base.nodes.slice(1), edges: [] }, fieldText: { ...original.fieldText, a: "id: number" } };
  history = recordEditor(history, edited);
  assert.deepEqual(diagramChanges(base, editorValue(history.present)), ["1 item removed", "1 link removed"]);
  history = undoEditor(history);
  assert.deepEqual(history.present, original);
  history = redoEditor(history);
  assert.deepEqual(history.present, edited);
  history = recordEditor(undoEditor(history), { ...original, diagram: { ...base, title: "Another title" } });
  assert.deepEqual(history.future, []);
  assert.deepEqual(diagramChanges(base, editorValue(history.present)), ["Title changed"]);
});

test("history has a fixed bound and blank items cannot be silently discarded on save", () => {
  let history = { past: [], present: editorSnapshot(base), future: [] };
  for (let i = 0; i < 75; i++) history = recordEditor(history, editorSnapshot({ ...base, title: `Version ${i}` }));
  assert.equal(history.past.length, 60);
  const blank = { ...base, nodes: [{ ...base.nodes[0], label: " " }, base.nodes[1]] };
  assert.match(editorProblem(editorValue(editorSnapshot(blank))), /Name every item/);
  assert.equal(editorValue(editorSnapshot(blank)).nodes.length, 2);
});
