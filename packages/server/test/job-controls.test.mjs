import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { approveSpacePlan, getJob, spacePath, startSpaceJob, stopSpaceJob } from "../dist/jobs.js";
import { generationDir, projectDir } from "../dist/project-files.js";
import { reviewEvidencePaths } from "../dist/plan-review.js";

const delay = () => new Promise((resolve) => setTimeout(resolve, 10));
const terminal = new Set(["done", "failed", "stopped", "awaiting-review"]);

async function workshop(t, modules = ["orders", "billing", "shipping"]) {
  const directory = await fs.mkdtemp(path.join(tmpdir(), "kodyurd-job-controls-"));
  const source_dir = path.join(directory, "source");
  const dataDir = path.join(directory, "data");
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE jobs (id TEXT, project_id TEXT, kind TEXT, status TEXT, log TEXT, created_at TEXT, updated_at TEXT)");
  const project = { id: path.basename(directory), name: "Job controls", source_dir, scene_type: "", created_at: "" };
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.ANTHROPIC_API_KEY;
  const state = { calls: [], hold: new Set(), signals: new Map(), jobs: [], omitFocus: false };
  const source = (module) => ({ path: `${module}/index.mjs`, startLine: 2, endLine: 3 });
  for (const module of modules) {
    await fs.mkdir(path.join(source_dir, module), { recursive: true });
    await fs.writeFile(path.join(source_dir, module, "index.mjs"),
      `export function ${module.replaceAll("-", "_")}(input) {\n  const value = input;\n  return { value };\n}\n`);
  }
  process.env.ANTHROPIC_API_KEY = "fixture-only";
  globalThis.fetch = async (url, request) => {
    assert.equal(url, "https://api.anthropic.com/v1/messages", "only the mocked provider endpoint may be used");
    const message = JSON.parse(request.body).messages[0].content;
    const prompt = typeof message === "string" ? message : message.find(({ type }) => type === "text").text;
    let response;
    if (prompt.includes("# Task P1")) {
      state.calls.push("plan");
      response = { city: { districts: [{ id: "domain", title: "Domain" }], buildings: modules.map((module) => ({
        id: module, moduleRef: module, district: "domain", title: module, summary: "Processes input.", source: source(module)
      })) }, ...(state.omitFocus ? {} : { focusBuilding: "orders", lessons: modules.map((building) => ({ building })) }) };
    } else {
      const [, owner, module] = /Assigned building id: "([^"]+)"\. Source module: "([^"]+)"\./.exec(prompt) ?? [];
      const [, kind] = /# Task P2 — Focus ([a-z]+):/.exec(prompt) ?? [];
      assert.ok(owner && module && kind, "every lesson request identifies its exact scope");
      const key = `${module}:${kind}`;
      state.calls.push(key);
      state.signals.set(key, request.signal);
      if (state.hold.has(key)) {
        return new Promise((_, reject) => request.signal.addEventListener("abort", () => reject(request.signal.reason), { once: true }));
      }
      const origin = source(module);
      const point = (id, caption) => ({ id, ref: `step:${id}`, caption, source: origin });
      response = kind === "scenario" ? { flows: [{ id: "example", title: `${module} result`, scope: `module:${owner}`,
        source: origin, path: [point("read", "Read input"), point("return", "Return value")],
        scenarios: [{ id: "ordinary", title: "Ordinary input", steps: ["read", "return"] }] }] }
        : { diagrams: [{ id: "view", owner, title: `${module} ${kind}`, kind: kind === "map" || kind === "context" ? "graph" : kind,
          source: origin, origin: "code",
          nodes: [{ id: "input", label: "Input", source: origin }, { id: "result", label: "Result", source: origin }],
          edges: [{ id: "process", from: "input", to: "result", label: "processes", source: origin }] }] };
    }
    return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(response) }] }));
  };
  const settings = { db, dataDir, project, agent: "api", language: "en", brief: "Teach orders", focusModule: "orders", timeoutMs: 5_000 };
  const start = (extra = {}) => {
    const started = startSpaceJob({ ...settings, ...extra });
    assert.ok(started.jobId, started.error);
    state.jobs.push(started.jobId);
    return started.jobId;
  };
  const wait = async (id, predicate = (job) => terminal.has(job.status)) => {
    for (let tick = 0; tick < 600; tick++) {
      const job = getJob(db, id);
      assert.notEqual(job.status, "failed", JSON.stringify(job.error));
      if (predicate(job)) return job;
      await delay();
    }
    assert.fail(`Job ${id} exceeded the fixture budget: ${JSON.stringify(getJob(db, id))}`);
  };
  t.after(async () => {
    for (const id of state.jobs) stopSpaceJob(db, project.id, id);
    for (let tick = 0; tick < 200 && state.jobs.some((id) => !terminal.has(getJob(db, id).status)); tick++) await delay();
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
    db.close();
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 4, retryDelay: 40 });
  });
  return { directory, source_dir, dataDir, db, project, state, start, wait };
}

test("Stop keeps accepted work and the old city; resume skips the accepted map", async (t) => {
  const fixture = await workshop(t);
  const { db, dataDir, project, state, start, wait } = fixture;
  const old = JSON.stringify({ space: { version: "0.2", meta: { name: "Previous city", sourceDir: ".", createdAt: "2026-01-01" },
    city: { districts: [{ id: "old", title: "Old" }], buildings: [] } } });
  await fs.mkdir(projectDir(dataDir, project.id), { recursive: true });
  await fs.writeFile(spacePath(dataDir, project.id), old);
  state.hold.add("orders:scenario");
  const id = start({ lessonLimit: 2 });
  await wait(id, () => state.calls.includes("orders:scenario"));
  assert.equal(getJob(db, id).deliverables.find(({ id }) => id === "focus-map").state, "ready");
  assert.equal(stopSpaceJob(db, "other-workspace", id), false);
  assert.equal(stopSpaceJob(db, project.id, id), true);
  const stopped = await wait(id, ({ status }) => status === "stopped");
  assert.equal(state.signals.get("orders:scenario").aborted, true);
  assert.deepEqual(state.calls, ["plan", "orders:map", "orders:scenario"]);
  assert.equal(stopped.deliverables.find(({ id }) => id === "focus-scenario").state, "pending");
  assert.equal(stopped.resumeAvailable, true);
  assert.equal(stopped.error, undefined);
  assert.equal(await fs.readFile(spacePath(dataDir, project.id), "utf8"), old);
  assert.ok((await fs.readdir(path.join(projectDir(dataDir, project.id), "cache"))).some((file) => file.startsWith("lesson-")));
  const accepted = JSON.parse(await fs.readFile(path.join(generationDir(dataDir, project.id, id), "focus-map.json"), "utf8"));
  assert.equal(accepted.pass.diagrams.length, 1);

  state.hold.clear();
  const resumedId = start({ resume: { jobId: id }, brief: "Ignored replacement brief" });
  const resumed = await wait(resumedId, ({ status }) => status === "done");
  assert.equal(state.calls.filter((call) => call === "plan").length, 1);
  assert.equal(state.calls.filter((call) => call === "orders:map").length, 1);
  assert.equal(state.calls.filter((call) => call === "orders:scenario").length, 2);
  assert.ok(resumed.deliverables.every(({ state }) => state === "ready"));
  assert.equal(resumed.focusReady, true);
  assert.notEqual(await fs.readFile(spacePath(dataDir, project.id), "utf8"), old);
});

test("plan review pauses after P1, validates strict scope and builds the approved selection", async (t) => {
  const modules = ["orders", "billing", "shipping", ...Array.from({ length: 9 }, (_, index) => `extra-${index}`)];
  const { db, dataDir, project, state, start, wait } = await workshop(t, modules);
  const id = start({ reviewPlan: true, lessonLimit: 2, brief: "Teach orders\nLesson modules: billing" });
  const waiting = await wait(id, ({ status }) => status === "awaiting-review");
  assert.deepEqual(state.calls, ["plan"]);
  assert.equal(waiting.resumeAvailable, true);
  assert.equal(waiting.planReview.focusBuilding, "orders");
  assert.deepEqual(waiting.planReview.buildings.filter(({ required }) => required).map(({ id }) => id), ["orders", "billing"]);
  const invalid = [
    [{ building: "billing" }, { building: "shipping" }],
    [{ building: "orders" }, { building: "shipping" }],
    [{ building: "orders" }],
    [{ building: "orders" }, { building: "billing" }, { building: "missing" }],
    [{ building: "orders", views: ["deployment"] }, { building: "billing" }],
    [{ building: "orders", views: ["state", "state"] }, { building: "billing" }],
    [{ building: "orders", arbitrary: true }, { building: "billing" }],
    modules.slice(0, 11).map((building) => ({ building }))
  ];
  for (const input of invalid) {
    await assert.rejects(approveSpacePlan(dataDir, project, waiting, input), ({ code }) => code === "PLAN_SELECTION_INVALID");
  }
  assert.deepEqual(state.calls, ["plan"]);
  const selected = await approveSpacePlan(dataDir, project, waiting, [
    { building: "shipping", views: ["state"] }, { building: "billing" }, { building: "orders" }
  ]);
  assert.deepEqual(selected.map(({ building }) => building), ["orders", "billing", "shipping"]);
  const child = start({ resume: { jobId: id }, approvedLessons: selected });
  assert.equal(getJob(db, id).status, "reviewed", "approval claims its parent synchronously");
  const done = await wait(child, ({ status }) => status === "done");
  assert.equal(done.focusReady, true);
  assert.equal(state.calls.filter((call) => call === "plan").length, 1);
  assert.deepEqual([...new Set(done.deliverables.map(({ moduleRef }) => moduleRef))].sort(), ["billing", "orders", "shipping"]);
  assert.ok(done.deliverables.some(({ moduleRef, kind, state }) => moduleRef === "shipping" && kind === "state" && state === "ready"));
  assert.ok(!state.calls.some((call) => call.startsWith("extra-")));
  const callsBeforeReplay = [...state.calls];
  const jobsBeforeReplay = db.prepare("SELECT COUNT(*) AS count FROM jobs").get().count;
  const replayed = startSpaceJob({ db, dataDir, project, agent: "api", language: "en", brief: "",
    resume: { jobId: id }, approvedLessons: selected });
  assert.ok(replayed.error, "an already approved parent cannot start another child after completion");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM jobs").get().count, jobsBeforeReplay);
  await assert.rejects(approveSpacePlan(dataDir, project, getJob(db, id), selected), ({ code }) => code === "PLAN_NOT_WAITING");
  assert.deepEqual(state.calls, callsBeforeReplay);
});

test("review approval refuses evidence changed after the plan was accepted", async (t) => {
  const { dataDir, source_dir, project, state, start, wait } = await workshop(t);
  const id = start({ reviewPlan: true });
  const waiting = await wait(id, ({ status }) => status === "awaiting-review");
  const checkpoint = JSON.parse(await fs.readFile(path.join(generationDir(dataDir, project.id, id), "checkpoint.json"), "utf8"));
  const [file] = Object.keys(checkpoint.reviewSourceHashes);
  assert.ok(file, "the plan records a non-empty evidence snapshot");
  await fs.appendFile(path.join(source_dir, file), "\n// evidence changed after plan review\n");
  await assert.rejects(approveSpacePlan(dataDir, project, waiting, [{ building: "orders" }, { building: "billing" }]),
    ({ code }) => code === "PLAN_SOURCE_CHANGED");
  assert.deepEqual(state.calls, ["plan"]);
});

test("a stopped waiting plan resumes into review and never implicitly approves lessons", async (t) => {
  const { db, dataDir, project, state, start, wait } = await workshop(t);
  const id = start({ reviewPlan: true });
  await wait(id, ({ status }) => status === "awaiting-review");
  assert.equal(stopSpaceJob(db, project.id, id), true);
  assert.equal(getJob(db, id).status, "stopped");
  await assert.rejects(approveSpacePlan(dataDir, project, getJob(db, id), [{ building: "orders" }, { building: "billing" }]),
    ({ code }) => code === "PLAN_NOT_WAITING");
  const resumed = await wait(start({ resume: { jobId: id } }), ({ status }) => status === "awaiting-review");
  assert.ok(resumed.planReview);
  assert.ok(resumed.deliverables.every(({ state }) => state === "pending"));
  assert.deepEqual(state.calls, ["plan"]);
});

test("Stop during publication preparation cannot replace the last published city", async (t) => {
  const { db, dataDir, project, state, start, wait } = await workshop(t);
  const published = spacePath(dataDir, project.id);
  const previous = JSON.stringify({ space: { version: "0.2", meta: { name: "Keep this city", sourceDir: ".", createdAt: "2026-01-01" },
    city: { districts: [{ id: "old", title: "Old" }], buildings: [] } } });
  await fs.mkdir(projectDir(dataDir, project.id), { recursive: true });
  await fs.writeFile(published, previous);
  const write = fs.writeFile;
  let waiting = false;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  fs.writeFile = async (file, ...args) => {
    const result = await write(file, ...args);
    if (typeof file === "string" && file.startsWith(`${published}.`) && file.endsWith(".tmp")) {
      waiting = true;
      await gate;
    }
    return result;
  };
  try {
    const id = start({ lessonLimit: 2 });
    await wait(id, () => waiting);
    assert.equal(stopSpaceJob(db, project.id, id), true);
    release();
    await wait(id, ({ status }) => status === "stopped");
    assert.equal(await fs.readFile(published, "utf8"), previous);
    assert.deepEqual(state.calls, ["plan", "orders:map", "orders:scenario"]);
  } finally {
    release();
    fs.writeFile = write;
  }
});

test("Stop cancels both optional lessons in flight and starts no following scenario", async (t) => {
  const { db, dataDir, project, state, start, wait } = await workshop(t);
  state.hold.add("billing:map");
  state.hold.add("shipping:map");
  const id = start();
  await wait(id, () => state.calls.includes("billing:map") && state.calls.includes("shipping:map"));
  const focusedCity = await fs.readFile(spacePath(dataDir, project.id), "utf8");
  assert.equal(getJob(db, id).focusReady, true);
  assert.equal(stopSpaceJob(db, project.id, id), true);
  const stopped = await wait(id, ({ status }) => status === "stopped");
  assert.equal(state.signals.get("billing:map").aborted, true);
  assert.equal(state.signals.get("shipping:map").aborted, true);
  assert.deepEqual(state.calls.slice(0, 3), ["plan", "orders:map", "orders:scenario"]);
  assert.deepEqual(state.calls.slice(3).sort(), ["billing:map", "shipping:map"]);
  assert.ok(stopped.deliverables.filter(({ moduleRef }) => moduleRef !== "orders").every(({ state }) => state === "pending"));
  assert.equal(await fs.readFile(spacePath(dataDir, project.id), "utf8"), focusedCity);
});

test("plan review fingerprints packet files and every cited plan span within its finite bound", () => {
  const source = (path) => ({ path, startLine: 1, endLine: 1 });
  const plan = {
    city: { buildings: [{ source: source("module.mjs") }] },
    flows: [{ source: source("flow.mjs"), path: [{ source: source("step.mjs") }],
      branches: [{ path: [{ source: source("branch.mjs") }] }],
      scenarios: [{ events: [{ source: source("occurrence.test.mjs") }] }] }],
    diagrams: [{ source: source("diagram.md"),
      nodes: [{ source: source("node.mjs"), fields: [{ source: source("field.mjs") }] }],
      edges: [{ source: source("edge.mjs") }], claims: [{ evidence: [source("rationale.md")] }] }]
  };
  assert.deepEqual(new Set(reviewEvidencePaths(plan, ["packet.mjs", "module.mjs"])), new Set([
    "packet.mjs", "module.mjs", "flow.mjs", "step.mjs", "branch.mjs", "occurrence.test.mjs",
    "diagram.md", "node.mjs", "field.mjs", "edge.mjs", "rationale.md"
  ]));
  const empty = { city: { buildings: [] }, flows: [], diagrams: [] };
  const bound = Array.from({ length: 256 }, (_, index) => `file-${index}.mjs`);
  assert.equal(reviewEvidencePaths(empty, [...bound, bound[0]]).length, 256);
  assert.throws(() => reviewEvidencePaths(empty, [...bound, "one-too-many.mjs"]), ({ code }) => code === "PLAN_EVIDENCE_LIMIT");
});

test("an unfocused plan can be reviewed and uses the first approved building as its arrival", async (t) => {
  const { dataDir, project, state, start, wait } = await workshop(t);
  state.omitFocus = true;
  const id = start({ reviewPlan: true, focusModule: undefined, brief: "Explain this system" });
  const waiting = await wait(id, ({ status }) => status === "awaiting-review");
  assert.equal(waiting.planReview.focusBuilding, undefined);
  assert.ok(waiting.planReview.buildings.every(({ required, selected }) => !required && !selected));
  assert.deepEqual(waiting.deliverables, []);
  assert.equal(waiting.resumeAvailable, true);
  assert.deepEqual(state.calls, ["plan"]);
  const selected = await approveSpacePlan(dataDir, project, waiting, [{ building: "shipping" }, { building: "billing" }]);
  const done = await wait(start({ resume: { jobId: id }, approvedLessons: selected }), ({ status }) => status === "done");
  assert.equal(done.focusReady, true);
  assert.deepEqual(state.calls, ["plan", "shipping:map", "shipping:scenario", "billing:map", "billing:scenario"]);
  const published = JSON.parse(await fs.readFile(spacePath(dataDir, project.id), "utf8"));
  assert.equal(published.space.presentation.start.building, "shipping");
});

test("an approved child stopped before its checkpoint stays resumable without consuming the plan again", async (t) => {
  const { db, dataDir, project, state, start, wait } = await workshop(t);
  const parent = start({ reviewPlan: true });
  const waiting = await wait(parent, ({ status }) => status === "awaiting-review");
  const selected = await approveSpacePlan(dataDir, project, waiting, [{ building: "orders" }, { building: "billing" }]);
  const child = start({ resume: { jobId: parent }, approvedLessons: selected });
  assert.equal(stopSpaceJob(db, project.id, child), true);
  const stopped = await wait(child, ({ status }) => status === "stopped");
  assert.equal(stopped.resumeAvailable, true, "the durable approval link exists before the first asynchronous read");
  assert.equal(getJob(db, parent).status, "reviewed");
  await assert.rejects(fs.stat(path.join(generationDir(dataDir, project.id, child), "checkpoint.json")), { code: "ENOENT" });
  assert.deepEqual(state.calls, ["plan"]);

  // A second immediate stop keeps the same direct recovery link, rather than
  // making a chain of incomplete child checkpoints that cannot be reopened.
  const second = start({ resume: { jobId: child } });
  assert.equal(stopSpaceJob(db, project.id, second), true);
  assert.equal((await wait(second, ({ status }) => status === "stopped")).resumeAvailable, true);
  const finished = await wait(start({ resume: { jobId: second } }), ({ status }) => status === "done");
  assert.equal(finished.focusReady, true);
  assert.deepEqual(state.calls, ["plan", "orders:map", "orders:scenario", "billing:map", "billing:scenario"]);
  const published = JSON.parse(await fs.readFile(spacePath(dataDir, project.id), "utf8"));
  assert.equal(published.space.presentation.start.building, "orders");
});

test("Stop after the publication commit reports the city as ready while cleanup finishes", async (t) => {
  const { db, dataDir, project, state, start, wait } = await workshop(t);
  const published = spacePath(dataDir, project.id);
  const remove = fs.rm;
  let committed = false;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  fs.rm = async (file, ...args) => {
    if (typeof file === "string" && file.startsWith(`${published}.`) && file.endsWith(".tmp")) {
      committed = true;
      await gate;
    }
    return remove(file, ...args);
  };
  try {
    const id = start();
    await wait(id, () => committed);
    const cityAtStop = await fs.readFile(published, "utf8");
    assert.equal(JSON.parse(cityAtStop).space.presentation.start.building, "orders");
    assert.equal(stopSpaceJob(db, project.id, id), true);
    release();
    const stopped = await wait(id, ({ status }) => status === "stopped");
    assert.equal(stopped.focusReady, true, "a committed city remains ready even when later cleanup is stopped");
    assert.equal(await fs.readFile(published, "utf8"), cityAtStop);
    assert.deepEqual(state.calls, ["plan", "orders:map", "orders:scenario"]);
  } finally {
    release();
    fs.rm = remove;
  }
});
