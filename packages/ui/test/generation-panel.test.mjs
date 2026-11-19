import assert from "node:assert/strict";
import { test } from "node:test";

test("plan review stays actionable before lessons and stopped jobs expose resume without internal references", async () => {
  const [{ createServer }, { createElement }, { renderToStaticMarkup }] = await Promise.all([
    import("vite"), import("react"), import("react-dom/server")
  ]);
  const vite = await createServer({ configFile: false, appType: "custom", esbuild: { jsx: "automatic" },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  try {
    const { default: GenerationPanel } = await vite.ssrLoadModule("/packages/ui/src/screens/GenerationPanel.tsx");
    const callbacks = { onRetry: () => undefined, onContinue: () => undefined, onPreview: () => undefined,
      onStop: () => undefined, onResume: () => undefined, onApprove: () => undefined };
    const job = { id: "j", projectId: "p", kind: "space", status: "awaiting-review", stages: [],
      createdAt: "2026-11-19T10:00:00Z", updatedAt: "2026-11-19T10:00:30Z",
      planReview: { focusBuilding: "a", buildings: [
        { id: "a", title: "API", moduleRef: "api", required: true, selected: true, documentationOnly: false, views: [] },
        { id: "b", title: "Store", moduleRef: "store", required: false, selected: true, documentationOnly: false, views: ["erd"] },
        { id: "c", title: "Docs", moduleRef: "docs", required: false, selected: false, documentationOnly: true, views: [] }
      ] }, deliverables: [{ id: "focus-map", kind: "map", title: "Component map", state: "pending", reference: "internal-reference-09" }] };
    const review = renderToStaticMarkup(createElement(GenerationPanel, { ...callbacks, job, busy: false }));
    assert.match(review, /Review lesson plan/);
    assert.match(review, /2\/10 buildings/);
    assert.match(review, /Build selected lessons/);
    assert.match(review, /Stop this plan/);
    assert.doesNotMatch(review, /internal-reference-09|Visual reference/);
    const stopped = renderToStaticMarkup(createElement(GenerationPanel, { ...callbacks,
      job: { ...job, status: "stopped", planReview: undefined, resumeAvailable: true, focusReady: true }, busy: false }));
    assert.match(stopped, />Stopped</);
    assert.match(stopped, /Resume generation/);
    assert.doesNotMatch(stopped, /Stop generation|Stop this plan/);
    assert.doesNotMatch(stopped, /Copy diagnostics/);
    const done = renderToStaticMarkup(createElement(GenerationPanel, { ...callbacks,
      job: { ...job, status: "done", planReview: undefined, resumeAvailable: true, focusReady: true }, busy: false }));
    assert.doesNotMatch(done, /Resume generation|Stop generation|Stop this plan/);
    assert.doesNotMatch(done, /Copy diagnostics/);
    const failed = renderToStaticMarkup(createElement(GenerationPanel, { ...callbacks,
      job: { ...job, status: "failed", planReview: undefined }, busy: false }));
    assert.match(failed, /Copy diagnostics/);
  } finally {
    await vite.close();
  }
});
