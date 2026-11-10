import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { openDb } from "../dist/db.js";
import { registerApi } from "../dist/routes.js";
import { tryAcquireWorkspaceOperation } from "../dist/workspace-operation.js";

test("a personal model can be hidden and restored without losing its cache identity", async () => {
  const root = await mkdtemp(fileURLToPath(new URL("./.overlay-visibility-", import.meta.url)));
  const id = "demo-project";
  const model = "a123456789abcdef";
  const directory = path.join(root, "projects", id);
  const file = path.join(directory, "overlays.json");
  const spaceFile = path.join(directory, "space.json");
  const db = openDb(root);
  const app = Fastify();
  try {
    registerApi(app, { db, dataDir: root, version: "test" });
    db.prepare("INSERT INTO projects (id, name, source_dir, created_at) VALUES (?, ?, ?, ?)").run(id, "Demo", root, new Date().toISOString());
    await mkdir(directory, { recursive: true });
    const matches = { building: "b-reservations", moduleRef: "reservations", class: "centerpiece", prompt: "A centered tablet with a flat base.", id: model };
    const otherSlot = { ...matches, building: "b-catalog", moduleRef: "catalog" };
    await writeFile(file, JSON.stringify({ items: [matches, otherSlot] }));

    const endpoint = `/api/projects/${id}/overlays`;
    const patch = (hidden) => app.inject({ method: "PATCH", url: `${endpoint}/${model}`,
      payload: { building: matches.building, class: matches.class, hidden } });
    const release = tryAcquireWorkspaceOperation(id);
    assert.ok(release);
    try { assert.equal((await patch(true)).statusCode, 409); }
    finally { release(); }
    assert.deepEqual((await patch(true)).json(), { ok: true, hidden: true });
    assert.deepEqual((await app.inject(endpoint)).json().items.map(({ building }) => building), [otherSlot.building]);
    const all = (await app.inject(`${endpoint}?includeHidden=1`)).json().items;
    assert.equal(all[0].id, model);
    assert.equal(all[0].hidden, true);
    assert.equal(all[0].prompt, matches.prompt);
    const renamed = "bld-reservations";
    await writeFile(spaceFile, JSON.stringify({ space: { city: { buildings: [
      { id: renamed, moduleRef: "reservations" }, { id: otherSlot.building, moduleRef: "catalog" }
    ] } } }));
    const restored = await app.inject({ method: "PATCH", url: `${endpoint}/${model}`,
      payload: { building: renamed, class: matches.class, hidden: false } });
    assert.deepEqual(restored.json(), { ok: true, hidden: false });
    assert.deepEqual((await app.inject(endpoint)).json().items.map(({ building }) => building), [renamed, otherSlot.building]);
    assert.equal(JSON.parse(await readFile(file, "utf8")).items[0].id, model);
  } finally {
    await app.close();
    db.close();
    await unlink(file).catch(() => undefined);
    await unlink(spaceFile).catch(() => undefined);
    await rmdir(directory).catch(() => undefined);
    await rmdir(path.dirname(directory)).catch(() => undefined);
    await unlink(path.join(root, "kodyurd.db"));
    await rmdir(root);
  }
});
