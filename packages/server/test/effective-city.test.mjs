import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { parseSpace } from "@kodyurd/scene-schema";
import { analyzeSource } from "../dist/analyzer.js";
import { saveDiagramEdit, userDiagram } from "../dist/diagram-edits.js";
import { readSavedSpace, readSavedSpaceFile } from "../dist/export.js";
import { guideContext } from "../dist/guide.js";
import { generationDraftPath, projectDir, spacePath } from "../dist/project-files.js";
import { createSourceReader } from "../dist/source-evidence.js";

const at = (startLine) => ({ path: "orders/service.mjs", startLine, endLine: startLine });

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(tmpdir(), "kodyurd-effective-city-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dataDir = path.join(root, "data");
  const sourceDir = path.join(root, "workspace");
  const project = { id: "fixture", name: "Orders", source_dir: sourceDir, scene_type: "codewalk", model_style: "minimal", created_at: "" };
  const sourceLines = ["export function save() {", "  return 'saved';", "}"];
  await fs.mkdir(path.join(sourceDir, "orders"), { recursive: true });
  await fs.mkdir(projectDir(dataDir, project.id), { recursive: true });
  await fs.writeFile(path.join(sourceDir, "orders/service.mjs"), sourceLines.join("\n"));
  await fs.writeFile(path.join(sourceDir, "orders/design.md"), ["# Order design", "```mermaid", "flowchart LR",
    "Client[Client] -->|submits| Handler[Handler]", "```"].join("\n"));
  const diagram = { id: "order-map", owner: "orders", title: "Order map", kind: "graph", origin: "code", source: at(1),
    nodes: [{ id: "api", label: "API", source: at(1) }, { id: "store", label: "Store", source: at(2) }],
    edges: [{ id: "write", from: "api", to: "store", label: "saves", source: at(2) }],
    claims: [{ id: "saved", target: { kind: "edge", id: "write" }, kind: "output", text: "Returns saved.",
      evidence: [{ ...at(2), kind: "code", fingerprint: createHash("sha256").update(sourceLines[1]).digest("hex") }] }] };
  const parsed = parseSpace({ version: "0.2", meta: { name: "Orders", sourceDir, createdAt: "2026-11-19",
    coverage: [{ doc: "orders/design.md", sections: 1, placed: 0, pending: 1 }] },
    city: { districts: [{ id: "d", title: "Orders" }],
      buildings: [{ id: "orders", moduleRef: "orders", title: "Orders", district: "d", summary: "Stores orders." }] },
    diagrams: [diagram], navigation: { menu: [], searchIndex: [{ label: diagram.title, kind: "diagram", ref: diagram.id, keywords: [] }] } });
  assert.equal(parsed.success, true, JSON.stringify(parsed));
  const space = parsed.data;
  await fs.writeFile(spacePath(dataDir, project.id), JSON.stringify({ space }));
  return { dataDir, sourceDir, project, space, diagram: space.diagrams[0] };
}

test("effective reads recheck edited claim fingerprints after composition without rewriting saved data", async (t) => {
  const { dataDir, sourceDir, project, space, diagram } = await fixture(t);
  const edit = userDiagram({ ...diagram, title: "My order map" }, space, diagram.id, diagram);
  await saveDiagramEdit(dataDir, project.id, edit);
  let current = await readSavedSpace(dataDir, project.id, sourceDir);
  assert.equal(current.space.diagrams[0].claims[0].evidence[0].stale, undefined);
  assert.equal(current.space.navigation.searchIndex.find(({ ref }) => ref === diagram.id).label, "My order map");

  await fs.writeFile(path.join(sourceDir, "orders/service.mjs"), "export function save() {\n  return 'changed';\n}");
  current = await readSavedSpace(dataDir, project.id, sourceDir);
  assert.equal(current.space.diagrams[0].origin, "user");
  assert.equal(current.space.diagrams[0].claims[0].evidence[0].stale, true);
  const persisted = JSON.parse(await fs.readFile(path.join(projectDir(dataDir, project.id), "diagram-edits.json"), "utf8"));
  assert.equal(persisted.diagrams[0].claims[0].evidence[0].stale, undefined);
  const generated = JSON.parse(await fs.readFile(spacePath(dataDir, project.id), "utf8"));
  assert.equal(generated.space.diagrams[0].title, "Order map");
  assert.equal(generated.space.diagrams[0].claims[0].evidence[0].stale, undefined);
});

test("Guide sees authored imports and user corrections while draft context stays independent", async (t) => {
  const { dataDir, sourceDir, project, space, diagram } = await fixture(t);
  const edit = userDiagram({ ...diagram, title: "Corrected order map", nodes: diagram.nodes.map((node) =>
    node.id === "api" ? { ...node, label: "My request handler" } : node) }, space, diagram.id, diagram);
  await saveDiagramEdit(dataDir, project.id, edit);
  const report = await analyzeSource(sourceDir);
  const args = { dataDir, project, agent: "api", language: "en", question: "Explain the order handler", focusRef: diagram.id };
  const corrected = await guideContext(args, report, createSourceReader(sourceDir));
  const correctedScene = JSON.parse(corrected.text).scene;
  assert(corrected.refs.has(diagram.id));
  assert.equal(correctedScene.title, "Corrected order map");
  assert.equal(correctedScene.origin, "user");
  assert.equal(correctedScene.nodes[0].label, "My request handler");
  assert.equal(correctedScene.nodes[0].source, undefined);
  assert.match(correctedScene.provenance, /only the numbered source excerpts/);

  const published = await readSavedSpace(dataDir, project.id, sourceDir);
  const authored = published.space.diagrams.find(({ origin }) => origin === "mermaid");
  assert(authored);
  const imported = await guideContext({ ...args, focusRef: authored.id }, report, createSourceReader(sourceDir));
  const importedScene = JSON.parse(imported.text).scene;
  assert(imported.refs.has(authored.id));
  assert.equal(importedScene.origin, "mermaid");
  assert.equal(importedScene.nodes[0].label, "Client");
  assert.equal(importedScene.source.path, "orders/design.md");

  const jobId = "00000000-0000-4000-8000-000000000001";
  const draftFile = generationDraftPath(dataDir, project.id, jobId);
  await fs.mkdir(path.dirname(draftFile), { recursive: true });
  await fs.writeFile(draftFile, JSON.stringify({ space }));
  const draft = await readSavedSpaceFile(draftFile, sourceDir);
  assert.equal(draft.space.diagrams[0].title, "Order map");
  const draftContext = await guideContext({ ...args, draftJobId: jobId }, report, createSourceReader(sourceDir));
  assert.equal(JSON.parse(draftContext.text).scene.nodes[0].label, "API");
  assert.equal(JSON.parse(draftContext.text).scene.origin, "code");
});

test("published payloads carry correction base hints across regeneration without adding them to drafts or scene schema", async (t) => {
  const { dataDir, sourceDir, project, space, diagram } = await fixture(t);
  const edit = userDiagram({ ...diagram, title: "My saved correction" }, space, diagram.id, diagram);
  await saveDiagramEdit(dataDir, project.id, edit, diagram);
  assert.deepEqual((await readSavedSpace(dataDir, project.id, sourceDir)).diagramEdits, []);
  const next = { ...space, diagrams: [{ ...diagram, title: "Regenerated title" }] };
  await fs.writeFile(spacePath(dataDir, project.id), JSON.stringify({ space: next }));
  const published = await readSavedSpace(dataDir, project.id, sourceDir);
  assert.equal(published.space.diagrams.find(({ id }) => id === diagram.id).title, "My saved correction");
  assert.deepEqual(published.diagramEdits, [{ id: diagram.id, state: "changed" }]);
  assert.equal(Object.hasOwn(published.space, "diagramEdits"), false);
  assert.deepEqual(JSON.parse(JSON.stringify(published)).diagramEdits, published.diagramEdits);
  const draft = await readSavedSpaceFile(spacePath(dataDir, project.id), sourceDir);
  assert.equal(draft.diagramEdits, undefined);
  assert.equal(draft.space.diagrams.find(({ id }) => id === diagram.id).title, "Regenerated title");
});
