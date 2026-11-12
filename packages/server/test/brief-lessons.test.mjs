import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { newFocusDeliverables, runFocusDeliverable } from "../dist/focus-generation.js";
import { getJob, LESSON_HARD_LIMIT, spacePath, startSpaceJob } from "../dist/jobs.js";
import { CityPlan, normalizeCityPlan } from "../dist/space-pipeline.js";

const modules = ["orders", "billing", "shipping", "audit"];
const ref = (module) => ({ path: `${module}/index.mjs`, startLine: 2, endLine: 2 });

/** A four-module workspace and an API agent that answers each prompt for the building it names. */
async function workshop(t, planLessons) {
  const dir = await fs.mkdtemp(path.join(tmpdir(), "kodyurd-brief-lessons-"));
  const source_dir = path.join(dir, "workspace");
  const realFetch = globalThis.fetch;
  const realKey = process.env.ANTHROPIC_API_KEY;
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE jobs (id TEXT, project_id TEXT, kind TEXT, status TEXT, log TEXT, created_at TEXT, updated_at TEXT)");
  const state = { calls: [], prompts: new Map(), failing: new Set() };
  for (const module of modules) {
    await fs.mkdir(path.join(source_dir, module), { recursive: true });
    const extra = module === "billing" ? ["", "export const currency = 'USD';", "export const rounding = 2;"] : [];
    await fs.writeFile(path.join(source_dir, module, "index.mjs"),
      [`export function ${module}(input) {`, `  return { step: '${module}', input };`, "}", ...extra].join("\n"));
  }
  process.env.ANTHROPIC_API_KEY = "fixture-only";
  globalThis.fetch = async (_, request) => {
    const message = JSON.parse(request.body).messages[0].content;
    const prompt = typeof message === "string" ? message : message.find(({ type }) => type === "text").text;
    let data;
    if (prompt.includes("# Task P1")) {
      state.calls.push("plan");
      data = {
        city: { districts: [{ id: "d", title: "Shop" }],
          buildings: modules.map((module) => ({ id: module, moduleRef: module, title: module, district: "d", source: ref(module) })) },
        focusBuilding: "orders", lessons: planLessons
      };
    } else {
      const [, owner, module] = /Assigned building id: "([^"]+)"\. Source module: "([^"]+)"\./.exec(prompt) ?? [];
      const kind = prompt.includes("# Task P2 — Focus map:") ? "map" : "scenario";
      state.calls.push(`${module}:${kind}`);
      state.prompts.set(`${module}:${kind}`, prompt);
      const source = ref(module);
      const point = (id, caption) => ({ id, ref: `step:${id}`, caption, source });
      data = kind === "map" ? { diagrams: [{ id: "map", owner, title: `${module} map`, kind: "graph", source, origin: "code",
        nodes: [{ id: "input", label: "Input", source }, { id: "output", label: "Output", source }],
        edges: [{ id: "rule", from: "input", to: "output", label: "Transform", source }] }] }
        : state.failing.has(module) ? { flows: [] } : { flows: [{ id: "example", title: `${module} example`, scope: `module:${owner}`,
          path: [point("input", "Read input"), point("output", "Return result")],
          scenarios: [{ id: "normal", title: "Ordinary example", steps: ["input", "output"] }] }] };
    }
    return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(data) }] }));
  };
  t.after(async () => {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = realKey;
    db.close();
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 4, retryDelay: 40 });
  });
  const project = { id: "brief-lessons", name: "Brief lessons", source_dir, scene_type: "", created_at: "" };
  const run = async (args) => {
    const { jobId, error } = startSpaceJob({ db, dataDir: path.join(dir, "data"), project, agent: "api", language: "en", ...args });
    assert.ok(jobId, error);
    for (let i = 0; i < 400; i++) {
      const job = getJob(db, jobId);
      assert.notEqual(job.status, "failed", JSON.stringify(job.error));
      if (job.status === "done") return job;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.fail("The brief-lessons fixture exceeded its budget.");
  };
  const saved = async () => JSON.parse(await fs.readFile(spacePath(path.join(dir, "data"), project.id), "utf8")).space;
  return { state, run, saved };
}

test("the plan's lesson list is bounded, unique and tied to planned buildings", () => {
  const plan = CityPlan.parse(normalizeCityPlan({
    city: { districts: [{ id: "d", title: "Shop" }], buildings: [
      { id: "orders", moduleRef: "orders", title: "Orders", district: "d" }, { id: "billing", moduleRef: "billing", title: "Billing", district: "d" }] },
    lessons: [{ building: "billing", goal: "Why a charge is declined", views: ["state", "poster", "state"] }, "orders",
      { building: "billing", goal: "duplicate" }, { building: "missing" }, { goal: "no building" }]
  }));
  assert.deepEqual(JSON.parse(JSON.stringify(plan.lessons)),
    [{ building: "billing", goal: "Why a charge is declined", views: ["state"] }, { building: "orders" }]);
  assert.deepEqual(CityPlan.parse(normalizeCityPlan({ city: plan.city })).lessons, []);
});

test("views read from the brief by the plan join the ones its wording names", () => {
  const kinds = (...args) => newFocusDeliverables(...args).map(({ kind }) => kind);
  assert.deepEqual(kinds("Explain booking", false, undefined, ["state", "matrix"]), ["map", "scenario", "state", "matrix"]);
  assert.deepEqual(kinds("Explain booking with a state machine", false, undefined, ["state", "map"]), ["map", "scenario", "state"]);
  assert.deepEqual(kinds("Explain booking"), ["map", "scenario"]);
});

test("a brief or the plan can ask for the data model, class, mind map and context views", async () => {
  const kinds = (...args) => newFocusDeliverables(...args).map(({ kind }) => kind);
  assert.deepEqual(kinds("Show a class diagram and a mind map of bookings"), ["map", "scenario", "class", "mindmap"]);
  assert.deepEqual(kinds("Explain the data model and its C4 context diagram"), ["map", "scenario", "erd", "context"]);
  assert.deepEqual(kinds("Explain booking", false, undefined, ["erd", "context", "scenario"]), ["map", "scenario", "erd", "context"]);
  // The plan placed the data model in another lesson, so the focus leaves it there.
  assert.deepEqual(kinds("Explain the data model and its C4 context diagram", false, undefined, ["context"], ["erd"]), ["map", "scenario", "context"]);
  assert.deepEqual(newFocusDeliverables("Explain billing", false, { moduleRef: "billing", title: "Billing" }, ["mindmap"]).map(({ title }) => title),
    ["Billing · Component map", "Billing · Playable scenario", "Billing · Mind map"]);
  const plan = CityPlan.parse(normalizeCityPlan({
    city: { districts: [{ id: "d", title: "Shop" }], buildings: [{ id: "orders", moduleRef: "orders", title: "Orders", district: "d" }] },
    lessons: [{ building: "orders", views: ["class", "erd", "mindmap", "context", "state", "deployment"] }]
  }));
  assert.deepEqual(plan.lessons[0].views, ["class", "erd", "mindmap", "context"]);

  // A mind map cites its topics; each branch takes the evidence of the topic it leads to.
  const lines = ["# Orders", "## Placing", "## Charging"];
  const at = (line) => ({ path: "orders/README.md", startLine: line, endLine: line });
  let prompt;
  const pass = await runFocusDeliverable({ kind: "mindmap", evidence: { code: [], docs: [
    { path: "orders/README.md", kind: "section", startLine: 1, endLine: 3, text: lines.join("\n") }] },
    prompt: { building: { id: "orders", title: "Orders", moduleRef: "orders" }, brief: "Outline orders as a mind map", language: "en" },
    read: async (file) => file === "orders/README.md" ? lines : null,
    run: async (text) => {
      prompt = text;
      return JSON.stringify({ diagrams: [{ id: "outline", owner: "orders", title: "Orders outline", kind: "mindmap",
        nodes: [{ id: "orders", label: "Orders", source: at(1) }, { id: "placing", label: "Placing", source: at(2) },
          { id: "charging", label: "Charging", source: at(3) }],
        edges: [{ from: "orders", to: "placing" }, { from: "orders", to: "charging" }] }], flows: [], questions: [] });
    },
    onRetry: (reason) => assert.fail(reason)
  });
  assert.match(prompt, /Return one mind map with kind mindmap/);
  assert.equal(pass.diagrams.length, 1);
  assert.match(pass.diagrams[0].id, /^kc-mindmap-/);
  assert.deepEqual(pass.diagrams[0].edges.map(({ source }) => source.startLine), [2, 3]);
});

test("the brief adds optional lessons after the focus, inside the limit, and a later job builds the rest", async (t) => {
  const { state, run, saved } = await workshop(t, [
    { building: "orders", goal: "How an order is placed" }, { building: "billing", goal: "How an order is charged" },
    { building: "shipping", goal: "How a paid order ships" }, { building: "audit" }
  ]);
  state.failing.add("shipping");
  const first = await run({ brief: "Teach how orders are placed, charged and shipped", lessonLimit: 3 });

  // The focus alone decides publication; a failed optional lesson is only reported.
  assert.equal(first.focusReady, true);
  assert.equal(first.quality.status, "ready");
  assert.equal(first.lessonsWaiting, 1);
  assert.deepEqual(state.calls.slice(0, 3), ["plan", "orders:map", "orders:scenario"]);
  assert.deepEqual(state.calls.slice(3).sort(), ["billing:map", "billing:scenario", "shipping:map", "shipping:scenario", "shipping:scenario"]);
  assert.deepEqual(first.deliverables.map(({ title, state: status }) => [title, status]), [
    ["Component map", "ready"], ["Playable scenario", "ready"],
    ["billing · Component map", "ready"], ["billing · Playable scenario", "ready"],
    ["shipping · Component map", "ready"], ["shipping · Playable scenario", "failed"]
  ]);
  assert.ok(first.quality.issues.some((issue) => issue.startsWith("shipping:")), JSON.stringify(first.quality.issues));
  assert.match(state.prompts.get("billing:map"), /The learner asked: How an order is charged/);
  assert.doesNotMatch(state.prompts.get("orders:map"), /The learner asked/);
  assert.ok(first.stages.some(({ text }) => text.includes("This brief covers 4 buildings. Building the first 3; the other 1 can be added afterwards.")));
  const partial = await saved();
  assert.deepEqual(partial.interiors.map(({ building }) => building).sort(), ["billing", "orders", "shipping"]);
  assert.deepEqual(partial.flows.map(({ scope }) => scope).sort(), ["module:billing", "module:orders"]);

  // Continuing reuses every accepted deliverable and generates only what is missing.
  state.failing.clear();
  const before = state.calls.length;
  const second = await run({ brief: "ignored on resume", resume: { jobId: first.id }, lessonLimit: LESSON_HARD_LIMIT });
  assert.deepEqual(state.calls.slice(before).sort(), ["audit:map", "audit:scenario", "shipping:scenario"]);
  assert.equal(second.lessonsWaiting, undefined);
  assert.ok(second.deliverables.every(({ state: status }) => status === "ready"));
  assert.deepEqual(second.quality.issues, []);
  const full = await saved();
  assert.deepEqual(full.interiors.map(({ building }) => building).sort(), modules.slice().sort());
  assert.deepEqual(full.flows.map(({ scope }) => scope).sort(), modules.map((module) => `module:${module}`).sort());
});

test("a brief about one module still opens a second building", async (t) => {
  const { state, run, saved } = await workshop(t, []);
  const job = await run({ brief: "Teach how orders are placed" });
  assert.equal(job.focusReady, true);
  assert.equal(job.lessonsWaiting, undefined);
  // With no flow to follow, the largest code module beside the focus is the neighbour.
  assert.deepEqual(state.calls, ["plan", "orders:map", "orders:scenario", "billing:map", "billing:scenario"]);
  assert.deepEqual((await saved()).interiors.map(({ building }) => building).sort(), ["billing", "orders"]);
});
