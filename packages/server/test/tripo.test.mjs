import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { generateOverlayModel, tripoCacheGlb } from "../dist/tripo.js";

const prompt = "A small stylized test lantern for an offline fixture";
const modelId = createHash("sha256")
  .update(JSON.stringify({ v: 1, provider: "tripo-rest", type: "text_to_model", prompt }))
  .digest("hex").slice(0, 32);
const taskId = "fixture-task";
const modelUrl = "https://cdn.tripo3d.ai/fixtures/model.glb?signature=fixture";
const json = (data, status = 200) => Response.json(data, { status });
const task = () => json({ code: 0, data: { task_id: taskId, status: "success", output: { model_url: modelUrl } } });

function glb() {
  const content = JSON.stringify({ asset: { version: "2.0" }, extras: { label: "x".repeat(1024) } });
  const padding = (4 - Buffer.byteLength(content) % 4) % 4;
  const chunk = Buffer.from(content + " ".repeat(padding));
  const header = Buffer.alloc(20);
  header.write("glTF", 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(header.length + chunk.length, 8);
  header.writeUInt32LE(chunk.length, 12);
  header.write("JSON", 16);
  return Buffer.concat([header, chunk]);
}

async function fixture(t) {
  const root = await realpath(process.cwd());
  const dataDir = await mkdtemp(path.join(root, "kodyurd-tripo-test-"));
  t.after(async () => {
    const target = await realpath(dataDir);
    assert.equal(path.dirname(target), root);
    assert.match(path.basename(target), /^kodyurd-tripo-test-/);
    await rm(target, { recursive: true, force: true });
  });
  const previous = process.env.TRIPO_API_KEY;
  process.env.TRIPO_API_KEY = "fixture-only";
  t.after(() => {
    if (previous === undefined) delete process.env.TRIPO_API_KEY;
    else process.env.TRIPO_API_KEY = previous;
  });
  const dir = path.join(dataDir, "tripo-cache");
  await mkdir(dir);
  const receiptFile = path.join(dir, `${modelId}.json`);
  return {
    dir,
    file: tripoCacheGlb(dataDir, modelId),
    generate: () => generateOverlayModel(dataDir, prompt, () => {}),
    readReceipt: async () => JSON.parse(await readFile(receiptFile, "utf8")),
    writeReceipt: (value) => writeFile(receiptFile, typeof value === "string" ? value : JSON.stringify({
      updatedAt: "2026-11-10T00:00:00Z", prompt, ...value
    }))
  };
}

test("concurrent same-prompt requests persist a claim and receipt before exactly one POST", async (t) => {
  const f = await fixture(t);
  const posted = Promise.withResolvers();
  const releasePost = Promise.withResolvers();
  let submits = 0;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.ok(init.signal instanceof AbortSignal);
    assert.equal(init.redirect, "error");
    if (url.endsWith("/generation/text-to-model")) {
      submits++;
      assert.equal(init.method, "POST");
      assert.deepEqual(JSON.parse(init.body), { prompt, model: "P2-20260801", face_limit: 12_000 });
      const receipt = await f.readReceipt();
      assert.equal(receipt.state, "submitting");
      assert.equal(receipt.attempt, 1);
      assert.ok((await readdir(f.dir)).includes(`${modelId}.1.claim`));
      posted.resolve();
      await releasePost.promise;
      return json({ code: 0, data: { task_id: taskId } });
    }
    if (url.endsWith(`/tasks/${taskId}`)) return task();
    assert.equal(url, modelUrl);
    assert.equal(init.headers, undefined);
    return new Response(glb());
  });
  const first = f.generate();
  await Promise.race([posted.promise, first]);
  try {
    await assert.rejects(f.generate(), { code: "TRIPO_SUBMIT_UNKNOWN" });
  } finally {
    releasePost.resolve();
  }
  assert.equal(await first, modelId);
  assert.equal(await f.generate(), modelId);
  assert.equal(submits, 1);
  assert.deepEqual(await readFile(f.file), glb());
  assert.equal((await f.readReceipt()).state, "ready");
});

test("ambiguous creation responses persist unknown state and block another POST", async (t) => {
  for (const [description, reply] of [
    ["successful non-JSON response", () => new Response("secret response")],
    ["missing task ID", () => json({ code: 0, data: {} })],
    ["server failure", () => json({ code: 1000 }, 500)],
    ["unrecognized HTTP rejection", () => json({ code: 42 }, 400)],
    ["network failure", () => { throw new Error("sensitive network details"); }]
  ]) {
    await t.test(description, async (subtest) => {
      const f = await fixture(subtest);
      let submits = 0;
      subtest.mock.method(globalThis, "fetch", () => { submits++; return reply(); });
      const check = (error) => error.code === "TRIPO_SUBMIT_UNKNOWN" && !/secret|sensitive/.test(error.message);
      await assert.rejects(f.generate(), check);
      assert.equal((await f.readReceipt()).state, "unknown");
      await assert.rejects(f.generate(), check);
      assert.equal(submits, 1);
    });
  }
});

test("legacy ambiguous receipts, invalid receipts and orphaned claims fail closed", async (t) => {
  for (const [description, initialize, code] of [
    ["submitting receipt", (f) => f.writeReceipt({ state: "submitting" }), "TRIPO_SUBMIT_UNKNOWN"],
    ["legacy failed receipt without task ID", (f) => f.writeReceipt({ state: "failed" }), "TRIPO_SUBMIT_UNKNOWN"],
    ["invalid JSON receipt", (f) => f.writeReceipt("{"), "TRIPO_RECEIPT"],
    ["claim without receipt", (f) => writeFile(path.join(f.dir, `${modelId}.1.claim`), ""), "TRIPO_SUBMIT_CLAIMED"],
    ["incomplete model without task ID", (f) => writeFile(f.file, Buffer.from("glTF")), "TRIPO_CACHE"]
  ]) {
    await t.test(description, async (subtest) => {
      const f = await fixture(subtest);
      const fetch = subtest.mock.method(globalThis, "fetch", () => assert.fail("Unexpected external request"));
      await initialize(f);
      await assert.rejects(f.generate(), { code });
      assert.equal(fetch.mock.callCount(), 0);
    });
  }
});

test("a documented rejection allows only one new claim on a later click", async (t) => {
  const f = await fixture(t);
  let submits = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    if (url.endsWith("/generation/text-to-model")) {
      submits++;
      if (submits === 1) return json({ code: 1007, message: "hidden vendor response" }, 429);
      assert.equal((await f.readReceipt()).attempt, 2);
      return json({ code: 0, data: { task_id: taskId } });
    }
    if (url.endsWith(`/tasks/${taskId}`)) return task();
    assert.equal(url, modelUrl);
    return new Response(glb());
  });
  await assert.rejects(f.generate(), (error) => error.code === "TRIPO_REJECTED" && !error.message.includes("hidden vendor response"));
  assert.equal(submits, 1);
  assert.equal((await f.readReceipt()).state, "rejected");
  const retry = await Promise.allSettled([f.generate(), f.generate()]);
  assert.ok(retry.some(({ status, value }) => status === "fulfilled" && value === modelId));
  assert.equal(submits, 2);
  assert.equal(await f.generate(), modelId);
});

test("a known legacy task resumes without a POST and publishes only a complete download", async (t) => {
  const f = await fixture(t);
  await f.writeReceipt({ state: "failed", taskId });
  await writeFile(f.file, Buffer.from("glTF"));
  let downloads = 0;
  t.mock.method(globalThis, "fetch", (url, init) => {
    if (url.endsWith(`/tasks/${taskId}`)) {
      assert.equal(init.method, "GET");
      return task();
    }
    assert.equal(url, modelUrl);
    downloads++;
    const bytes = glb();
    return new Response(downloads === 1 ? bytes.subarray(0, -1) : bytes);
  });
  await assert.rejects(f.generate(), { code: "TRIPO_GLB_INVALID" });
  assert.equal((await f.readReceipt()).taskId, taskId);
  assert.deepEqual(await readFile(f.file), Buffer.from("glTF"));
  assert.equal(await f.generate(), modelId);
  assert.deepEqual(await readFile(f.file), glb());
  assert.equal(await f.generate(), modelId);
  assert.equal(downloads, 2);
  assert.ok((await readdir(f.dir)).every((name) => !name.endsWith(".tmp")));
});

test("a task ID in an error response is recorded and reconciled by polling", async (t) => {
  const f = await fixture(t);
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    requests.push([url, init.method ?? "GET"]);
    if (url.endsWith("/generation/text-to-model")) {
      return json({ code: 1000, data: { task_id: taskId } }, 500);
    }
    if (url.endsWith(`/tasks/${taskId}`)) {
      assert.equal((await f.readReceipt()).taskId, taskId);
      return task();
    }
    assert.equal(url, modelUrl);
    return new Response(glb());
  });
  assert.equal(await f.generate(), modelId);
  assert.deepEqual(requests.map(([, method]) => method), ["POST", "GET", "GET"]);
});
