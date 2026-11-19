import assert from "node:assert/strict";
import test from "node:test";
import { diagramNote } from "../src/viewer/diagram-note.ts";

test("only unsourced generation diagnostics move out of the lesson prose", () => {
  assert.deepEqual(diagramNote({ note: "The evidence packet omits the adapter.", origin: "code" }),
    { diagnostic: "The evidence packet omits the adapter." });
  const authored = "The evidence packet is the read-only input to the planner.";
  for (const origin of ["docs", "mermaid", "user"]) assert.deepEqual(diagramNote({ note: authored, origin }), { content: authored });
  assert.deepEqual(diagramNote({ note: authored, origin: "code", source: { path: "planner.ts", startLine: 4 } }), { content: authored });
  assert.deepEqual(diagramNote({ note: "Retries stop after three attempts.", origin: "code" }), { content: "Retries stop after three attempts." });
  assert.deepEqual(diagramNote(), {});
});
