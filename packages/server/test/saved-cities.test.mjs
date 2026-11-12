import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { openSavedCity, readSavedCities, recordSavedCity, removeSavedCity, SAVED_CITY_LIMIT } from "../dist/saved-cities.js";

const jobId = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

async function workspace(t) {
  const dataDir = await fs.mkdtemp(path.join(tmpdir(), "kodyurd-saved-cities-"));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const project = "workspace";
  const dir = path.join(dataDir, "projects", project);
  const generate = async (n, brief, buildings = ["a"]) => {
    const folder = path.join(dir, "generation", jobId(n));
    await fs.mkdir(folder, { recursive: true });
    const payload = { space: { city: { buildings: buildings.map((id) => ({ id })) } }, layout: { n } };
    await fs.writeFile(path.join(folder, "draft.json"), JSON.stringify(payload));
    await fs.writeFile(path.join(folder, "checkpoint.json"), JSON.stringify({ plan: { offers: [
      { building: "a", class: "landmark" }, { building: "elsewhere", class: "landmark" }] } }));
    await fs.writeFile(path.join(dir, "space.json"), JSON.stringify(payload));
    await recordSavedCity(dataDir, project, { jobId: jobId(n), brief, language: "en", title: `City ${n}`,
      savedAt: new Date(Date.UTC(2026, 0, n)).toISOString(), buildings: buildings.length, lessons: 1, diagrams: 2, flows: 1 });
  };
  const read = async (name) => JSON.parse(await fs.readFile(path.join(dir, name), "utf8"));
  return { dataDir, project, dir, generate, read };
}

test("each brief keeps its latest city and an earlier city opens again", async (t) => {
  const { dataDir, project, dir, generate, read } = await workspace(t);
  await generate(1, "Explain orders", ["a", "b"]);
  await generate(2, "Explain billing");
  await generate(3, "  explain   ORDERS ", ["a", "b", "c"]);

  let saved = await readSavedCities(dataDir, project);
  assert.deepEqual(saved.cities.map((city) => city.jobId), [jobId(3), jobId(2)]);
  assert.equal(saved.current, jobId(3));

  const opened = await openSavedCity(dataDir, project, jobId(2));
  assert.equal(opened.brief, "Explain billing");
  assert.deepEqual((await read("space.json")).layout, { n: 2 });
  assert.deepEqual((await read("offers.json")).offers, [{ building: "a", class: "landmark" }]);
  saved = await readSavedCities(dataDir, project);
  assert.equal(saved.current, jobId(2));
  assert.equal(saved.cities.length, 2);

  // The open city stays listed; another one is forgotten with its files.
  assert.equal(await removeSavedCity(dataDir, project, jobId(2)), false);
  assert.equal(await removeSavedCity(dataDir, project, jobId(3)), true);
  await assert.rejects(fs.stat(path.join(dir, "generation", jobId(3))));
  assert.equal(await openSavedCity(dataDir, project, jobId(3)), undefined);
  assert.equal(await openSavedCity(dataDir, project, "not-a-job"), undefined);
  assert.deepEqual((await read("space.json")).layout, { n: 2 });
});

test("the list is bounded and unlisted generations are removed, except the most recent", async (t) => {
  const { dataDir, project, dir, generate } = await workspace(t);
  const total = SAVED_CITY_LIMIT + 7;
  for (let n = 1; n <= total; n++) await generate(n, `Brief ${n}`);
  const saved = await readSavedCities(dataDir, project);
  assert.equal(saved.cities.length, SAVED_CITY_LIMIT);
  assert.equal(saved.cities[0].jobId, jobId(total));
  const kept = await fs.readdir(path.join(dir, "generation"));
  assert.equal(kept.length, SAVED_CITY_LIMIT + 4);
  for (const { jobId: id } of saved.cities) assert.ok(kept.includes(id));

  // A damaged index reads as an empty list.
  await fs.writeFile(path.join(dir, "cities.json"), "{ not json");
  assert.deepEqual(await readSavedCities(dataDir, project), { current: undefined, cities: [] });
});
