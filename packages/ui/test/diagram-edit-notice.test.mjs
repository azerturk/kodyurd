import assert from "node:assert/strict";
import { test } from "node:test";

test("correction notices distinguish changed, unknown and missing bases and never promise a nonexistent restore", async () => {
  const [{ createServer }, { createElement }, { renderToStaticMarkup }] = await Promise.all([
    import("vite"), import("react"), import("react-dom/server")
  ]);
  const vite = await createServer({ configFile: false, appType: "custom", esbuild: { jsx: "automatic" },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  try {
    const { DiagramEditNotice } = await vite.ssrLoadModule("/packages/ui/src/viewer/DiagramEditNotice.tsx");
    const { DiagramEditor } = await vite.ssrLoadModule("/packages/ui/src/viewer/DiagramEditor.tsx");
    const changed = { id: "generated-map", state: "changed" };
    const payload = JSON.parse(JSON.stringify({ diagramEdits: [changed] }));
    const notice = renderToStaticMarkup(createElement(DiagramEditNotice, { status: payload.diagramEdits[0] }));
    assert.match(notice, /generated diagram changed.*correction is kept/);
    assert.equal(renderToStaticMarkup(createElement(DiagramEditNotice, {})), "");
    const unknown = renderToStaticMarkup(createElement(DiagramEditNotice, { status: { id: changed.id, state: "unknown", hasGenerated: false }, editable: true }));
    assert.match(unknown, /original generated version was not recorded/);
    assert.doesNotMatch(unknown, /generated diagram changed|Restore replaces/);
    const diagram = { id: changed.id, owner: "city", title: "My correction", kind: "graph", origin: "user",
      nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }], edges: [] };
    const props = { diagram, isNew: false, canRestore: true, buildings: [], save: async () => undefined,
      restore: async () => undefined, close: () => undefined };
    const editor = renderToStaticMarkup(createElement(DiagramEditor, { ...props, baseStatus: changed }));
    assert.match(editor, /Restore current generated diagram/);
    for (const status of [{ id: changed.id, state: "missing" }, { id: changed.id, state: "unknown", hasGenerated: false }]) {
      const missing = renderToStaticMarkup(createElement(DiagramEditor, { ...props, baseStatus: status }));
      assert.match(missing, /Remove saved diagram/);
      assert.doesNotMatch(missing, /Restore current generated diagram/);
    }
  } finally {
    await vite.close();
  }
});
