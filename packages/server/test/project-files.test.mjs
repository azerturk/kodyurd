import assert from "node:assert/strict";
import fsNative, { promises as fs, readFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { atomicJson, atomicJsonPair } from "../dist/project-files.js";

async function files(t) {
  const directory = await fs.mkdtemp(path.join(tmpdir(), "kodyurd-publication-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const offers = path.join(directory, "offers.json");
  const city = path.join(directory, "space.json");
  await fs.writeFile(offers, JSON.stringify({ revision: "old offers" }));
  await fs.writeFile(city, JSON.stringify({ revision: "old city" }));
  const read = (file) => JSON.parse(readFileSync(file, "utf8"));
  return { directory, offers, city, read };
}

test("guarded publication commits before a queued Stop can enter an asynchronous rename", async (t) => {
  const { directory, city, read } = await files(t);
  const controller = new AbortController();
  const rename = fs.rename;
  let asynchronousRenames = 0;
  let atStop;
  // Before this fix, the guarded path entered this pending rename, then Stop ran before commit.
  fs.rename = async (...args) => {
    asynchronousRenames++;
    await Promise.resolve();
    return rename(...args);
  };
  try {
    await atomicJson(city, { revision: "new city" }, () => {
      controller.signal.throwIfAborted();
      queueMicrotask(() => { controller.abort(); atStop = read(city); });
    });
  } finally {
    fs.rename = rename;
  }
  assert.equal(asynchronousRenames, 0);
  assert.deepEqual(atStop, { revision: "new city" }, "the commit has completed when Stop runs");
  assert.deepEqual(await fs.readdir(directory), ["offers.json", "space.json"]);
});

test("a Stop during pair preparation leaves both previously published files intact", async (t) => {
  const { directory, offers, city, read } = await files(t);
  const controller = new AbortController();
  const write = fs.writeFile;
  fs.writeFile = async (file, ...args) => {
    const result = await write(file, ...args);
    if (typeof file === "string" && file.startsWith(`${city}.`) && file.endsWith(".tmp")) controller.abort();
    return result;
  };
  try {
    await assert.rejects(atomicJsonPair([{ file: offers, value: { revision: "new offers" } },
      { file: city, value: { revision: "new city" } }], () => controller.signal.throwIfAborted()), { name: "AbortError" });
  } finally {
    fs.writeFile = write;
  }
  assert.deepEqual(read(offers), { revision: "old offers" });
  assert.deepEqual(read(city), { revision: "old city" });
  assert.deepEqual(await fs.readdir(directory), ["offers.json", "space.json"]);
});

test("offers and city commit in the same turn before a Stop event can observe a mixed revision", async (t) => {
  const { offers, city, read } = await files(t);
  let atStop;
  const rename = fs.rename;
  let asynchronousRenames = 0;
  fs.rename = async (...args) => { asynchronousRenames++; await Promise.resolve(); return rename(...args); };
  try {
    await atomicJsonPair([{ file: offers, value: { revision: "new offers" } }, { file: city, value: { revision: "new city" } }], () => {
      queueMicrotask(() => { atStop = [read(offers), read(city)]; });
    });
  } finally {
    fs.rename = rename;
  }
  assert.equal(asynchronousRenames, 0);
  assert.deepEqual(atStop, [{ revision: "new offers" }, { revision: "new city" }]);
});

test("a failed city replacement rolls offers back to their previous revision", async (t) => {
  const { directory, offers, city, read } = await files(t);
  const rename = fsNative.renameSync;
  fsNative.renameSync = (from, to) => {
    if (to === city) throw Object.assign(new Error("The city is busy."), { code: "EBUSY" });
    return rename(from, to);
  };
  syncBuiltinESMExports();
  try {
    await assert.rejects(atomicJsonPair([{ file: offers, value: { revision: "new offers" } },
      { file: city, value: { revision: "new city" } }], () => undefined), { code: "EBUSY" });
  } finally {
    fsNative.renameSync = rename;
    syncBuiltinESMExports();
  }
  assert.deepEqual(read(offers), { revision: "old offers" });
  assert.deepEqual(read(city), { revision: "old city" });
  assert.deepEqual(await fs.readdir(directory), ["offers.json", "space.json"]);
});
