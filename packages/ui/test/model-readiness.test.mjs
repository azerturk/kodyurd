import assert from "node:assert/strict";
import test from "node:test";
import { hasGlbDocument, isUnavailableModel, openingModelsState } from "../src/viewer/model-readiness.ts";

function glb(json) {
  const document = new TextEncoder().encode(json);
  const length = Math.ceil(document.length / 4) * 4;
  const bytes = new ArrayBuffer(20 + length);
  const view = new DataView(bytes);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.byteLength, true);
  view.setUint32(12, length, true);
  view.setUint32(16, 0x4e4f534a, true);
  const chunk = new Uint8Array(bytes, 20);
  chunk.fill(32);
  chunk.set(document);
  return bytes;
}

test("only a fitted first view can remove the opening cover", () => {
  assert.deepEqual(openingModelsState(2, false, false), { status: "loading", pending: 2 });
  assert.deepEqual(openingModelsState(1, false, true), { status: "failed", pending: 1 });
  assert.deepEqual(openingModelsState(1, true, false), { status: "failed", pending: 1 });
  assert.deepEqual(openingModelsState(0, false, true), { status: "ready", pending: 0 });
});

test("transport failures are distinct from unavailable model files", () => {
  for (const error of [404, 410, new SyntaxError("malformed"), "Invalid chunk length found in glb."]) {
    assert.equal(isUnavailableModel(error), true);
  }
  for (const error of [401, 429, 503, new TypeError("Failed to fetch"), "Network error"]) {
    assert.equal(isUnavailableModel(error), false);
  }
});

test("the GLB document check rejects malformed content before the async parser", () => {
  const valid = glb('{"asset":{"version":"2.0"}}');
  assert.equal(hasGlbDocument(valid), true);
  assert.equal(hasGlbDocument(new ArrayBuffer(19)), false);
  assert.equal(hasGlbDocument(valid.slice(0, -4)), false);
  assert.equal(hasGlbDocument(glb('{"asset":{"version":"2.0"')), false);
  assert.equal(hasGlbDocument(glb('{"asset":{"version":"1.0"}}')), false);
  assert.equal(hasGlbDocument(glb('{}')), false);
  new DataView(valid).setUint32(12, 0xffff, true);
  assert.equal(hasGlbDocument(valid), false);
});
