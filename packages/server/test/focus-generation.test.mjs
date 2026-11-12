import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { supportsSceneReference, runAgent } from "../dist/agents.js";
import { openDb } from "../dist/db.js";
import { readSavedSpace } from "../dist/export.js";
import { askGuide, generationDraftPath, getJob, projectDir, spacePath, startSpaceJob } from "../dist/jobs.js";
import { registerApi } from "../dist/routes.js";
import { loadSceneReference } from "../dist/scene-reference.js";
import { checkCommand } from "../dist/doctor.js";
import { localCommand } from "../dist/local-command.js";
import { focusIssues, newFocusDeliverables, requestedScenarioMinimum, requestedScenarioOutcomes, runFocusDeliverable, sourcedScenario } from "../dist/focus-generation.js";
import { collectGuideEvidence, requestedDecisionEvidence, verifyEvidence } from "../dist/source-evidence.js";
import { assembleSpace, BuildingPass, cityTitle, CityPlan, normalizeBuildingPass, normalizeCityPlan } from "../dist/space-pipeline.js";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hashFromImage = (image) => digest(Buffer.from(image.source.data, "base64"));

test("decision table normalization preserves a numerical result after the spatial label budget", () => {
  const label = "A delayed second retry begins at the actual dispatch time and calculates a due time of 4500 ms.";
  const raw = { diagrams: [{ id: "decision", owner: "b", kind: "matrix", title: "Retry policy",
    nodes: [{ id: "guard", label: "Late tick" }, { id: "result", label }],
    edges: [{ from: "guard", to: "result" }] }] };
  assert.equal(BuildingPass.parse(normalizeBuildingPass(raw)).diagrams[0].nodes[1].label, label);
});

test("a brief asks for separate architecture artifacts and Guide retrieves the matching late test span", async () => {
  assert.deepEqual(newFocusDeliverables("Komponent xəritəsi, çağırış ardıcıllığı, status diaqramı və qərar cədvəli").map(({ kind }) => kind),
    ["map", "scenario", "sequence", "state", "matrix"]);
  assert.deepEqual(newFocusDeliverables("Explain the worker").map(({ kind }) => kind), ["map", "scenario"]);
  assert.deepEqual(newFocusDeliverables("Follow the ordinary click sequence").map(({ kind }) => kind), ["map", "scenario"]);
  assert.deepEqual(newFocusDeliverables("Include a call sequence, lifecycle diagram, and rule table").map(({ kind }) => kind),
    ["map", "scenario", "sequence", "state", "matrix"]);
  assert.deepEqual(newFocusDeliverables("Architecture only, include a decision table").map(({ kind }) => kind), ["map", "matrix"]);
  assert.deepEqual(newFocusDeliverables("Yalnız arxitektura, replay olmadan").map(({ kind }) => kind), ["map"]);
  assert.equal(requestedScenarioMinimum("Generate two distinct replay scenarios"), 2);
  assert.equal(requestedScenarioMinimum("Show one ordinary scenario, up to two scenarios if useful"), 1);
  const file = "src/worker.test.mjs";
  const lines = Array.from({ length: 135 }, (_, index) => index === 126
    ? "assert.equal(retry.delay, 3000); // second 503" : "// unrelated test details");
  const report = { modules: [{ name: "src", topFiles: [], testFiles: [file] }], docs: [] };
  const result = await collectGuideEvidence(report, "What is the delay after the second 503?", "retry", "src",
    [{ path: file, startLine: 11 }], async (name) => name === file ? lines : null);
  const exact = result.find((excerpt) => excerpt.startLine <= 127 && excerpt.endLine >= 127);
  assert.ok(exact);
  assert.match(exact.text, /retry\.delay, 3000/);
  assert.ok(JSON.stringify(result).length <= 9_000);
});

test("a narrow map retry keeps the authored graph and names missing citations", async () => {
  const origin = { path: "docs/structure.md", startLine: 2, endLine: 2 };
  const diagram = { id: "diagram", owner: "b", title: "Components", kind: "graph", origin: "mermaid",
    source: { path: origin.path, startLine: 1, endLine: 4 },
    nodes: [{ id: "a", label: "A", source: origin }, { id: "b", label: "B", source: origin }],
    edges: [{ id: "ab", from: "a", to: "b", source: origin }] };
  const evidence = { code: [], docs: [
    { path: "docs/policy.md", kind: "mermaid", startLine: 1, endLine: 3, text: "```mermaid\nstateDiagram-v2\n```" },
    { path: "docs/structure.md", kind: "mermaid", startLine: 1, endLine: 4, text: "```mermaid\nflowchart LR\nA --> B\n```" }
  ] };
  let reason;
  const result = await runFocusDeliverable({ kind: "map", evidence,
    prompt: { building: { id: "b", title: "Building", moduleRef: "src/building" }, brief: "Focus this module", language: "en" },
    read: async (file) => file === origin.path ? ["```mermaid", "flowchart LR", "A --> B", "```"] : null,
    run: async (prompt, options, narrow) => {
      assert.equal(options.maxTokens, 4_096);
      assert.match(prompt, /flowchart LR/);
      assert.match(prompt, /"startLine":12,"endLine":14/);
      assert.doesNotMatch(prompt, /Mandatory thinking steps/);
      const edges = narrow ? diagram.edges : [{ ...diagram.edges[0], source: { ...origin, endLine: 99 } }];
      return JSON.stringify({ diagrams: [{ ...diagram, edges }] });
    }, onRetry: (message) => { reason = message; }
  });
  assert.match(reason, /Missing or invalid exact source ranges \(nodes 0, edges 1\)/);
  assert.equal(result.diagrams.length, 1);
  assert.equal(result.diagrams[0].origin, "mermaid");
  assert.deepEqual(result.diagrams[0].source, diagram.source);
});

test("scenario retries a provider output limit without forwarding partial content", async () => {
  const realFetch = globalThis.fetch;
  const realKey = process.env.ANTHROPIC_API_KEY;
  const source = { path: "src/worker.mjs", startLine: 1, endLine: 1 };
  const point = (id) => ({ id, ref: `step:${id}`, source });
  const flow = { id: "flow", title: "Work", scope: "module:b", path: [point("start"), point("end")],
    scenarios: [{ id: "success", title: "Success", steps: ["start", "end"] }] };
  let calls = 0;
  let retry;
  try {
    process.env.ANTHROPIC_API_KEY = "fixture-only";
    globalThis.fetch = async (url, request) => {
      assert.equal(url, "https://api.anthropic.com/v1/messages");
      assert.equal(JSON.parse(request.body).max_tokens, calls === 0 ? 16_384 : 24_576);
      calls++;
      return new Response(JSON.stringify(calls === 1 ? {
        stop_reason: "max_tokens", content: [{ type: "text", text: "discarded provider fragment" }]
      } : { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ flows: [flow] }) }] }));
    };
    const result = await runFocusDeliverable({ kind: "scenario", evidence: { docs: [], code: [
      { path: source.path, kind: "code", startLine: 1, endLine: 1, text: "export const work = true;" }
    ] },
      prompt: { building: { id: "b", title: "Worker", moduleRef: "src" }, brief: "Show the worker", language: "en" },
      read: async () => ["export const work = true;"],
      run: (prompt, options) => runAgent("api", { ...options, prompt, cwd: process.cwd(), timeoutMs: 1_000 }),
      onRetry: (reason) => { retry = reason; }
    });
    assert.equal(calls, 2);
    assert.match(retry, /AGENT_OUTPUT_LIMIT/);
    assert.doesNotMatch(retry, /discarded provider fragment/);
    assert.equal(result.flows.length, 1);
  } finally {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = realKey;
  }
});

test("Anthropic errors surface actionable status without raw provider text or automatic paid retries", async () => {
  const realFetch = globalThis.fetch;
  const realKey = process.env.ANTHROPIC_API_KEY;
  let calls = 0;
  try {
    process.env.ANTHROPIC_API_KEY = "fixture-only";
    globalThis.fetch = async () => {
      calls++;
      return new Response("Private provider payload: sk-placeholder", { status: 429 });
    };
    await assert.rejects(runAgent("api", { prompt: "fixture prompt", cwd: process.cwd(), timeoutMs: 1_000 }),
      ({ code, message }) => code === "AGENT_API_FAILED" && /429.*rate limit/.test(message) && !/sk-placeholder/.test(message));
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = realKey;
  }
});

test("linear replays accept one outcome and explicit counts require different evidenced behavior", () => {
  const source = { path: "round.js", startLine: 1, endLine: 1 };
  const state = [{ key: "value", value: "2" }];
  const points = ["input", "round", "output"].map((id) => ({ id, ref: `step:${id}`, source }));
  points[2].state = state;
  const run = { id: "regular", title: "Round 2.3", steps: points.map(({ id }) => id) };
  const flow = { id: "round", scope: "module:b", title: "Round a number", path: points, scenarios: [run] };
  const issues = (brief) => focusIssues({ flows: [flow], diagrams: [] }, "b", brief).filter((issue) => issue.includes("scenario"));
  assert.equal(sourcedScenario(flow), true);
  assert.deepEqual(issues("Show the calculation"), []);
  assert.equal(issues("Provide two distinct scenarios").length, 1);
  flow.scenarios.push({ ...run, id: "same-value", title: "Reworded example", events: [{ stepIndex: 2, source, state }] });
  assert.equal(issues("Provide two distinct scenarios").length, 1);
  flow.scenarios[1].events[0].state = [{ key: "value", value: "3" }];
  assert.deepEqual(issues("Provide two distinct scenarios"), []);
});

test("a complete trace demonstrates all authored alternate paths and rejoins", () => {
  const source = { path: "submit.js", startLine: 1 };
  const point = (id) => ({ id, ref: `step:${id}`, source });
  const flow = { id: "submit", scope: "module:b", title: "Submit input",
    path: ["entry", "check", "save"].map(point),
    branches: [
      { at: 1, from: "check", condition: "Missing input", path: [point("message")] },
      { at: 1, from: "check", join: "save", condition: "Input needs formatting", path: [point("format")] }
    ],
    scenarios: [
      { id: "save", title: "Save", steps: ["entry", "check", "save"] },
      { id: "missing", title: "Missing input", steps: ["entry", "check", "message"] }
    ] };
  assert.equal(sourcedScenario(flow), false);
  flow.scenarios.push({ id: "format", title: "Format and save", steps: ["entry", "check", "format", "save"] });
  assert.equal(sourcedScenario(flow), true);
});

test("a delivery path with a retry title must play the actual sourced retry before delivery", async () => {
  const path = "send.test.js";
  const lines = ['assert.equal(prepare().state, "queued");', 'assert.equal(tick().state, "retry-scheduled");', 'assert.equal(tick().state, "delivered");'];
  const source = (startLine) => ({ path, startLine, endLine: startLine });
  const step = (id, caption, line) => ({ id, ref: `step:${id}`, caption, source: source(line) });
  const brief = "Replay the retry then delivery to the local receiver.";
  assert.deepEqual(requestedScenarioOutcomes(brief), ["retry-recovery"]);
  assert.deepEqual(requestedScenarioOutcomes("Explain how the receiver works without retries."), []);
  let reason;
  const result = await runFocusDeliverable({ kind: "scenario",
    evidence: { docs: [], code: [{ path, kind: "code", startLine: 1, endLine: 3, text: lines.join("\n") }] },
    prompt: { building: { id: "b", title: "Receiver", moduleRef: "src" }, brief, language: "en", evidenceOnly: true },
    read: async (file) => file === path ? lines : null,
    run: async (prompt, _, narrow) => {
      assert.match(prompt, /retry-recovery/);
      const steps = [step("queued", "Queue the job", 1), ...(narrow ? [step("retry-scheduled", "Schedule retry", 2)] : []),
        step("delivered", "Delivered locally", 3)];
      return JSON.stringify({ flows: [{ id: "send", scope: "module:b", title: "Local delivery", path: steps,
        scenarios: [{ id: "retry", title: "Retry then delivery", steps: steps.map(({ id }) => id) }] }] });
    }, onRetry: (message) => { reason = message; }
  });
  assert.match(reason, /missing played outcomes.*retry-recovery/);
  assert.deepEqual(result.flows[0].scenarios[0].steps, ["queued", "retry-scheduled", "delivered"]);
});

test("a one-step reply is told what a playable flow needs, and a lone unscoped flow joins its building", async () => {
  const path = "identity/access.mjs";
  const lines = ["export function canManage(actor, booking) {", "  return actor.role === 'operator' || actor.id === booking.ownerId;", "}"];
  const step = (id, caption, line) => ({ id, ref: `step:${id}`, caption, source: { path, startLine: line, endLine: line } });
  let reason;
  const result = await runFocusDeliverable({ kind: "scenario",
    evidence: { docs: [], code: [{ path, kind: "code", startLine: 1, endLine: 3, text: lines.join("\n") }] },
    prompt: { building: { id: "identity", title: "Identity", moduleRef: "identity" }, brief: "Who may cancel a booking", language: "en", evidenceOnly: true },
    read: async (file) => file === path ? lines : null,
    run: async (prompt, _, narrow) => {
      assert.match(prompt, /a flow has at least two/);
      if (narrow) assert.match(prompt, /path of at least two steps/);
      const steps = narrow ? [step("call", "canManage is called", 1), step("result", "Owner or operator may manage", 2)] : [step("call", "canManage is called", 1)];
      // The smaller retry leaves the scope out; one flow for this deliverable can only be this building's.
      return JSON.stringify({ flows: [{ id: "manage", title: "Who may manage", scope: narrow ? undefined : "module:identity", path: steps,
        scenarios: [{ id: "owner", title: "Owner manages", steps: steps.map(({ id }) => id) }] }] });
    }, onRetry: (message) => { reason = message; }
  });
  assert.match(reason, /DELIVERABLE_INCOMPLETE · A playable flow needs an id, a title, scope "module:identity" and a path of at least two steps/);
  assert.equal(result.flows[0].scope, "module:identity");
  assert.deepEqual(result.flows[0].path.map(({ id }) => id), ["call", "result"]);
});

test("Explain fingerprints packet claims and only links the supported replay occurrence", async () => {
  const file = "reader.test.js";
  const lines = ["const request = read();", 'assert.equal(readAgain().state, "ready");', "// separate source outside the packet"];
  const src = (line) => ({ path: file, startLine: line, endLine: line });
  const claim = (id, line) => ({ id, target: { kind: "edge", id: "read" }, kind: "guard", text: "The result is ready.",
    evidence: [{ kind: "test", ...src(line), fingerprint: "0".repeat(64), stale: true }] });
  const raw = { diagrams: [{ id: "map", title: "Read a result", owner: "b", kind: "graph", nodes: [
    { id: "reader", label: "Reader", source: src(1) }, { id: "state", label: "Result", source: src(2) }
  ], edges: [{ id: "read", from: "reader", to: "state", source: src(2) }], claims: [claim("valid", 2), claim("outside", 3)] }] };
  const read = async (name) => name === file ? lines : null;
  const pass = await runFocusDeliverable({ kind: "map", evidence: { docs: [], code: [{ path: file, kind: "code", startLine: 1, endLine: 2, text: lines.slice(0, 2).join("\n") }] },
    prompt: { building: { id: "b", title: "Reader", moduleRef: "src" }, brief: "Explain the ready rule", language: "en", evidenceOnly: true },
    read, run: async () => JSON.stringify(raw), onRetry: () => assert.fail("valid Explain claim should pass without repair")
  });
  assert.deepEqual(pass.diagrams[0].claims.map(({ id }) => id), ["valid"]);
  const evidence = pass.diagrams[0].claims[0].evidence[0];
  assert.equal(evidence.fingerprint, digest(lines[1]));
  assert.equal(evidence.stale, undefined);
  const flow = { id: "read-replay", scope: "module:b", title: "Read", path: [
    { id: "input", ref: "step:input", source: src(1) }, { id: "result", ref: "step:result", source: src(2) }
  ], scenarios: [{ id: "valid", title: "Valid read", steps: ["input", "result"], events: [{ stepIndex: 1, source: src(2) }] }] };
  const space = { diagrams: pass.diagrams, flows: [flow], city: { buildings: [] }, tour: [], interiors: [], meta: { coverage: [] } };
  await verifyEvidence(space, { docs: [] }, read);
  assert.deepEqual(space.diagrams[0].claims[0].replay, { flow: flow.id, scenario: "valid", step: "result", stepIndex: 1 });
});

test("packet-only replays repair a real line outside the shown numbered evidence", async () => {
  const source = { path: "src/format.js", startLine: 4, endLine: 4 };
  const lines = ["// unrelated", "", "export function format(value) {", "  return value.toFixed(1);", "}"];
  const evidence = { docs: [], code: [{ path: source.path, kind: "code", startLine: 3, endLine: 5, text: lines.slice(2).join("\n") }] };
  const point = (id, startLine) => ({ id, ref: `step:${id}`, source: { path: source.path, startLine } });
  let reason;
  const pass = await runFocusDeliverable({ kind: "scenario", evidence,
    prompt: { building: { id: "b", title: "Format", moduleRef: "src" }, brief: "Show the ordinary function result", language: "en", evidenceOnly: true },
    read: async (file) => file === source.path ? lines : null,
    run: async (prompt, _, narrow) => {
      assert.match(prompt, /4 \|   return value\.toFixed\(1\)/);
      return JSON.stringify({ flows: [{ id: "format", scope: "module:b", title: "Format one decimal",
        path: [point("call", 3), point("result", narrow ? 4 : 1)], scenarios: [{ id: "regular", title: "Format a value", steps: ["call", "result"] }] }] });
    }, onRetry: (message) => { reason = message; }
  });
  assert.match(reason, /ranges shown in the numbered evidence packet/);
  assert.equal(pass.flows[0].path[1].source.startLine, 4);
});

test("fallback city titles humanize generated IDs without replacing authored titles", () => {
  assert.equal(cityTitle("bld-form", "bld-form", "b-", "frontend/form"), "Form");
  assert.equal(cityTitle("bld-form", "Profile form", "b-", "frontend/form"), "Profile form");
  assert.equal(cityTitle("district-integrations", "district-integrations", "d-"), "Integrations");
  const raw = { city: { districts: [{ id: "d-order-flow" }], buildings: [
    { id: "b-fulfillment", moduleRef: "src/fulfillment", district: "d-order-flow" },
    { id: "b-adapter", title: "Adapter boundary", moduleRef: "src/delivery", district: "d-order-flow" }
  ] } };
  const plan = CityPlan.parse(normalizeCityPlan(raw));
  assert.equal(plan.city.districts[0].title, "Order Flow");
  assert.equal(plan.city.buildings[0].title, "Fulfillment");
  plan.city.buildings[0].title = "b-fulfillment";
  const assembled = assembleSpace({ project: { name: "Test", source_dir: "test" }, language: "en", plan, passes: [] });
  assert.deepEqual(assembled.city.buildings.map(({ id, moduleRef, title }) => ({ id, moduleRef, title })), [
    { id: "b-fulfillment", moduleRef: "src/fulfillment", title: "Fulfillment" },
    { id: "b-adapter", moduleRef: "src/delivery", title: "Adapter boundary" }
  ]);
});

async function scratch() {
  const root = await fs.realpath(process.cwd());
  const dir = await fs.mkdtemp(path.join(root, "kodyurd-generation-test-"));
  return { dir, clean: async () => {
    const target = await fs.realpath(dir);
    assert(target.startsWith(path.join(root, "kodyurd-generation-test-")));
    await fs.rm(target, { recursive: true, force: true, maxRetries: 4, retryDelay: 40 });
  } };
}

test("a design-only job publishes an authored Explain map without inventing runtime replay", async () => {
  const { dir, clean } = await scratch();
  const realFetch = globalThis.fetch;
  const realKey = process.env.ANTHROPIC_API_KEY;
  const db = new DatabaseSync(":memory:");
  const dataDir = path.join(dir, "data");
  const sourceDir = path.join(dir, "workspace");
  const project = { id: "design-only", name: "Archive design", source_dir: sourceDir, scene_type: "exhibition", created_at: "" };
  const source = { path: "README.md", startLine: 4, endLine: 4 };
  const rationale = "Keep the manifest separate so reviewers can inspect pending imports.";
  const lines = ["# Archive design", "", "## Decision", rationale];
  const calls = [];
  const brief = "Explain why reviewers inspect pending imports.";
  assert.deepEqual(requestedDecisionEvidence(brief, [{ path: "README.md", kind: "section", title: "Decision",
    startLine: 1, endLine: 2, text: "A completely unrelated formatting choice." }]), []);
  try {
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(path.join(sourceDir, source.path), lines.join("\n"));
    db.exec("CREATE TABLE jobs (id TEXT, project_id TEXT, kind TEXT, status TEXT, log TEXT, created_at TEXT, updated_at TEXT)");
    process.env.ANTHROPIC_API_KEY = "fixture-only";
    globalThis.fetch = async (_, opts) => {
      const message = JSON.parse(opts.body).messages[0].content;
      const prompt = typeof message === "string" ? message : message.find(({ type }) => type === "text").text;
      const stage = prompt.includes("# Task P1") ? "plan" : "map";
      calls.push(stage);
      assert.match(prompt, /Leave flows empty/i);
      assert.match(prompt, /Keep the manifest separate/);
      if (stage === "map") assert.match(prompt, /matching authored Decision or Rationale section/);
      const data = stage === "plan" ? {
        city: { districts: [{ id: "d", title: "Design" }], buildings: [{ id: "b", title: "Archive", moduleRef: "(root)", district: "d",
          summary: "An authored design", source }] }, focusBuilding: "b"
      } : { diagrams: [{
        id: "archive-map", owner: "b", title: "Archive design", origin: "docs", source,
        nodes: [{ id: "review", label: "Review", source }, { id: "manifest", label: "Manifest", source }],
        edges: [{ id: "read", from: "review", to: "manifest", label: "Inspect pending imports", source }],
        claims: [
          ...(calls.length === 3 ? [{ id: "authored", target: { kind: "edge", id: "read" }, kind: "decision", text: rationale,
            evidence: [{ kind: "docs", ...source }] }] : []),
          { id: "invented", target: { kind: "node", id: "manifest" }, kind: "decision", text: "We chose this to reduce cloud spend.",
            evidence: [{ kind: "docs", ...source }] }
        ]
      }] };
      return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(data) }] }));
    };
    const { jobId, error } = startSpaceJob({ db, dataDir, project, agent: "api", language: "en", brief });
    assert.ok(jobId, error);
    let job;
    for (let i = 0; i < 300; i++) {
      job = getJob(db, jobId);
      if (job.status === "done" || job.status === "failed") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(job.status, "done", JSON.stringify(job.error));
    assert.equal(job.focusReady, true);
    assert.deepEqual(calls, ["plan", "map", "map"]);
    assert.equal(job.quality.playableFlowCount, 0);
    const current = await readSavedSpace(dataDir, project.id, sourceDir);
    assert.equal(current.space.flows.length, 0);
    assert.deepEqual(current.space.diagrams[0].claims.map(({ id }) => id), ["authored"]);
    assert.equal(current.space.diagrams[0].claims[0].evidence[0].stale, undefined);
    assert.equal(current.space.meta.coverage[0].placed, 1);
    await fs.writeFile(path.join(sourceDir, source.path), [...lines.slice(0, 3), "The design changed."].join("\n"));
    const reread = await readSavedSpace(dataDir, project.id, sourceDir);
    assert.equal(reread.space.diagrams[0].claims[0].evidence[0].stale, true);
    assert.equal(JSON.parse(await fs.readFile(spacePath(dataDir, project.id), "utf8")).space.diagrams[0].claims[0].evidence[0].stale, undefined);
  } finally {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = realKey;
    db.close();
    await clean();
  }
});

test("named code and design lessons share the primary city and retry by their own stable scope", async () => {
  const { dir, clean } = await scratch();
  const realFetch = globalThis.fetch;
  const realKey = process.env.ANTHROPIC_API_KEY;
  const db = new DatabaseSync(":memory:");
  const source_dir = path.join(dir, "workspace");
  const dataDir = path.join(dir, "data");
  const project = { id: "mixed-lessons", name: "Mixed lessons", source_dir, scene_type: "", created_at: "" };
  const decision = "An offer is an invitation, not a reservation or a hold.";
  const rationale = "Explicit acceptance preserves member choice and keeps confirmation inside the existing reservation transaction.";
  const policy = ["# ADR 002 · Offer a released slot without booking it automatically", "",
    "**Status** Proposed. No waitlist behavior from this decision exists in the current application.", "", "## Context", "",
    "A member's plans can change while waiting.", "", "## Decision", "",
    `Send an explicit offer after a slot is released. ${decision} Require a fresh acceptance before requesting a confirmed reservation and run the existing booking checks at that point.`,
    "", "## Rationale", "", `${rationale} A second member could take the slot between an offer and acceptance.`];
  const fixtures = {
    "catalog/index.mjs": ["export function listItems(items) {", "  return items.map((item) => item.name);", "}"],
    "catalog/README.md": ["# Catalog", "", "The catalog returns item names."],
    "formatting/label.mjs": ["export function displayLabel(n) {", "  return `Item ${n}`;", "}"],
    "formatting/label.test.mjs": ["import assert from 'node:assert/strict';", "import { displayLabel } from './label.mjs';", "assert.equal(displayLabel(7), 'Item 7');"],
    "policy-design/adr-002-offer-without-auto-booking.md": policy
  };
  const ref = (file, line) => ({ path: file, startLine: line, endLine: line });
  const code = ref("catalog/index.mjs", 2);
  const example = ref("formatting/label.test.mjs", 3);
  const design = ref("policy-design/adr-002-offer-without-auto-booking.md", 11);
  const calls = [];
  let deferCodeScenario = true;
  try {
    for (const [file, lines] of Object.entries(fixtures)) {
      const target = path.join(source_dir, file);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, lines.join("\n"));
    }
    db.exec("CREATE TABLE jobs (id TEXT, project_id TEXT, kind TEXT, status TEXT, log TEXT, created_at TEXT, updated_at TEXT)");
    process.env.ANTHROPIC_API_KEY = "fixture-only";
    const point = (id, caption, source) => ({ id, ref: `step:${id}`, caption, source });
    globalThis.fetch = async (_, opts) => {
      const message = JSON.parse(opts.body).messages[0].content;
      const prompt = typeof message === "string" ? message : message.find(({ type }) => type === "text").text;
      let data;
      if (prompt.includes("# Task P1")) {
        calls.push("plan");
        assert.match(prompt, /module resolved from the brief by the scanner, if any: "catalog"/);
        assert.match(prompt, /focused lessons: \["formatting","policy-design"\]/);
        const building = (id, moduleRef, source) => ({ id, moduleRef, title: moduleRef, district: "d", source });
        data = { city: { districts: [{ id: "d", title: "Product" }], buildings: [building("catalog", "catalog", code), building("design", "policy-design", design)] },
          focusBuilding: "design", flows: [{ id: "invented", scope: "system", title: "Invented execution", path: [
            { id: "a", ref: "catalog", caption: "Begin", source: code }, { id: "b", ref: "design", caption: "Execute", source: design }
          ] }] };
      } else {
        const [, owner, moduleRef] = /Assigned building id: "([^"]+)"\. Source module: "([^"]+)"\./.exec(prompt) ?? [];
        const kind = prompt.includes("# Task P2 — Focus map:") ? "map" : "scenario";
        calls.push(`${moduleRef}:${kind}`);
        assert.ok(owner && moduleRef);
        if (moduleRef === "formatting") {
          assert.match(prompt, /assert.equal\(displayLabel\(7\), 'Item 7'\)/);
          assert.doesNotMatch(prompt, /The catalog returns item names|Offer a released slot/);
        }
        let claim = {};
        if (moduleRef === "policy-design") {
          assert.equal(kind, "map");
          assert.match(prompt, /leave flows empty/i);
          assert.match(prompt, /matching authored Decision or Rationale section/);
          const quotes = JSON.parse(/Choices \(source data\): (\[[^\n]+\])/.exec(prompt)[1]);
          const quote = quotes.find(({ text }) => text === decision);
          assert.deepEqual(quote.evidence, { kind: "docs", ...design });
          assert.equal(quotes.find(({ text }) => text === rationale).evidence.startLine, 15);
          claim = { claims: [{ id: "policy", target: { kind: "edge", id: "rule" }, kind: "decision", quoteId: quote.id },
            { id: "unknown-target", target: { kind: "edge", id: "missing" }, kind: "decision", quoteId: quote.id },
            { id: "unknown-quote", target: { kind: "edge", id: "rule" }, kind: "decision", quoteId: "not-in-packet" }] };
        }
        const source = moduleRef === "catalog" ? code : moduleRef === "formatting" ? example : design;
        data = kind === "map" ? { diagrams: [{ id: "map", owner, title: `${moduleRef} map`, kind: "graph", source, origin: "code",
          nodes: [{ id: "input", label: "Input", source }, { id: "output", label: "Output", source }],
          edges: [{ id: "rule", from: "input", to: "output", label: "Transform", source }], ...claim }] }
          : moduleRef === "formatting" && deferCodeScenario ? { flows: [] } : { flows: [{ id: "example", title: `${moduleRef} example`,
            scope: `module:${owner}`, path: [point("input", "Read input", source), point("output", "Return result", source)],
            scenarios: [{ id: "normal", title: "Ordinary example", steps: ["input", "output"] }] }] };
      }
      return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(data) }] }));
    };
    const settings = { db, dataDir, project, agent: "api", language: "en", brief: "Teach catalog\nLesson modules: formatting, `policy-design`" };
    const waitForJob = async (args) => {
      const { jobId, error } = startSpaceJob(args);
      assert.ok(jobId, error);
      for (let i = 0; i < 300; i++) {
        const job = getJob(db, jobId);
        assert.notEqual(job.status, "failed", JSON.stringify(job.error));
        if (job.status === "done") return job;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.fail("The mixed-lesson fixture exceeded its budget.");
    };
    const partial = await waitForJob(settings);
    assert.deepEqual(partial.deliverables.map(({ kind, state }) => [kind, state]), [
      ["map", "ready"], ["scenario", "ready"], ["map", "ready"], ["scenario", "failed"], ["map", "ready"]
    ]);
    assert.notEqual(partial.focusReady, true);
    const ids = partial.deliverables.map(({ id }) => id);
    assert.equal(new Set(ids).size, 5);
    await assert.rejects(fs.stat(spacePath(dataDir, project.id)), { code: "ENOENT" });
    deferCodeScenario = false;
    const done = await waitForJob({ ...settings, resume: { jobId: partial.id, deliverableId: ids[3] } });
    assert.deepEqual(done.deliverables.map(({ id }) => id), ids);
    assert.ok(done.deliverables.every(({ state }) => state === "ready"));
    assert.deepEqual(calls, ["plan", "catalog:map", "catalog:scenario", "formatting:map", "formatting:scenario", "formatting:scenario", "policy-design:map", "formatting:scenario"]);
    assert.equal(done.focusReady, true);
    const { space } = JSON.parse(await fs.readFile(spacePath(dataDir, project.id), "utf8"));
    assert.deepEqual(space.city.buildings.map(({ moduleRef }) => moduleRef).sort(), ["catalog", "formatting", "policy-design"]);
    assert.equal(space.presentation.start.building, "catalog");
    assert.deepEqual(space.flows.map(({ scope }) => scope).sort(), ["module:catalog", "module:focus-formatting"]);
    const designMap = space.diagrams.find(({ owner }) => owner === "design");
    assert.equal(designMap.origin, "docs");
    assert.deepEqual(designMap.claims.map(({ id, text }) => [id, text]), [["policy", decision]]);
    assert.equal(designMap.claims[0].evidence[0].startLine, 11);
    assert.match(designMap.claims[0].evidence[0].fingerprint, /^[a-f0-9]{64}$/);
  } finally {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = realKey;
    db.close();
    await clean();
  }
});

test("Guide keeps the selected step and supplies exact comparison evidence from both named scenarios", async () => {
  const { dir, clean } = await scratch();
  const realFetch = globalThis.fetch;
  const realKey = process.env.ANTHROPIC_API_KEY;
  const sourceDir = path.join(dir, "workspace");
  const dataDir = path.join(dir, "data");
  const project = { id: "compare-fixture", name: "Measurement fixture", source_dir: sourceDir };
  const sourcePath = "readings.test.js";
  const ref = (startLine, endLine = startLine) => ({ path: sourcePath, startLine, endLine });
  const lines = Array.from({ length: 100 }, (_, index) => `// reserved line ${index + 1}`);
  lines[0] = 'import assert from "node:assert/strict";';
  lines[1] = "const first = 10;";
  lines[5] = "assert.equal(first, 10);";
  lines[39] = "const indoor = [first, 12];";
  lines[40] = "assert.equal(indoor[1], 12);";
  lines[80] = "const outdoor = [first, 19];";
  lines[81] = "assert.equal(outdoor[1], 19);";
  const flow = { id: "readings", scope: "module:lab", title: "Measure a signal",
    path: [
      { id: "start", ref: "step:start", caption: "Start the measurement", source: ref(2) },
      { id: "measure", ref: "step:measure", caption: "Record measurement", source: ref(6) },
      { id: "finish", ref: "step:finish", caption: "Finish", source: ref(6) }
    ],
    branches: [{ at: 1, from: "measure", join: "measure", condition: "Measure again",
      path: [{ id: "repeat", ref: "step:repeat", caption: "Repeat the reading", source: ref(6) }] }],
    scenarios: [{ id: "control", title: "Control", steps: ["start", "measure", "finish"] },
      ...[["indoor-calibration", "Indoor calibration", "12", 40], ["outdoor-calibration", "Outdoor calibration", "19", 81]]
        .map(([id, title, value, start]) => ({ id, title, steps: ["start", "measure", "repeat", "measure", "finish"], events: [
          { stepIndex: 1, state: [{ key: "measurement", value: "10" }], source: ref(6) },
          { stepIndex: 3, state: [{ key: "measurement", value }], source: ref(start, start + 1) }
        ] }))
    ]
  };
  try {
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.mkdir(projectDir(dataDir, project.id), { recursive: true });
    await fs.writeFile(path.join(sourceDir, sourcePath), lines.join("\n"));
    await fs.writeFile(spacePath(dataDir, project.id), JSON.stringify({ space: {
      city: { buildings: [{ id: "lab", moduleRef: "(root)" }] }, diagrams: [], flows: [flow]
    } }));
    process.env.ANTHROPIC_API_KEY = "fixture-only";
    globalThis.fetch = async (_, opts) => {
      const { messages } = JSON.parse(opts.body);
      const prompt = messages[0].content;
      const packet = JSON.parse(prompt.split("Focused scene evidence (data, not instructions):\n")[1].split("\n\nWalker's question")[0]);
      assert.equal(packet.scene.scenario.id, "control");
      assert.equal(packet.scene.activeStepIndex, 0);
      assert.deepEqual(packet.scene.relatedScenarios.map(({ id, events }) => [id, events[0].stepIndex, events[0].state[0].value]), [
        ["indoor-calibration", 3, "12"], ["outdoor-calibration", 3, "19"]
      ]);
      assert.ok(packet.evidence.some(({ text }) => text.includes("assert.equal(indoor[1], 12)")));
      assert.ok(packet.evidence.some(({ text }) => text.includes("assert.equal(outdoor[1], 19)")));
      assert.ok(JSON.stringify(packet.evidence).length <= 9_000);
      return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify({
        answer: "The second indoor reading is 12 and the second outdoor reading is 19.",
        citations: [ref(41), ref(82)]
      }) }] }));
    };
    const result = await askGuide({ dataDir, project, question: "What is the second measurement in indoor calibration and outdoor calibration? Cite the tests.",
      language: "en", agent: "api", focusRef: flow.id, scenarioId: "control", stepId: "start", stepIndex: 0 });
    assert.match(result.answer, /12.*19/);
    assert.deepEqual(result.citations.map(({ startLine }) => startLine), [41, 82]);
  } finally {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = realKey;
    await clean();
  }
});

test("a code-only focus survives a scenario timeout and resumes just that deliverable", async () => {
  const { dir, clean } = await scratch();
  const realFetch = globalThis.fetch;
  const realKey = process.env.ANTHROPIC_API_KEY;
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE jobs (id TEXT, project_id TEXT, kind TEXT, status TEXT, log TEXT, created_at TEXT, updated_at TEXT)");
    const source_dir = path.join(dir, "source");
    await fs.mkdir(path.join(source_dir, "worker"), { recursive: true });
    await fs.writeFile(path.join(source_dir, "entry.ts"), 'import { worker } from "./worker/worker.js";\nexport const entry = () => worker(true);\n');
    await fs.writeFile(path.join(source_dir, "worker", "worker.ts"),
      'import { retry } from "./retry.js";\nexport function worker(ok: boolean) {\n  if (!ok) return retry();\n  return "finished";\n}\n');
    await fs.writeFile(path.join(source_dir, "worker", "retry.ts"), 'export function retry() {\n  return "queued";\n}\n');
    const dataDir = path.join(dir, "data");
    const project = { id: "fixture", name: "Code-only worker", source_dir, scene_type: "", model_style: "minimal", created_at: "" };
    const source = { path: "worker/worker.ts", startLine: 2, endLine: 4 };
    const retrySource = { path: "worker/retry.ts", startLine: 1, endLine: 2 };
    const point = (id, caption, origin = source) => ({ id, ref: `step:${id}`, caption, source: origin });
    const answers = {
      city: { city: { districts: [{ id: "d", title: "Code" }], buildings: [{ id: "b", title: "Worker", moduleRef: "worker",
        district: "d", summary: "Dispatches work", metrics: { files: 2, loc: 8, docs: 0 }, source }] }, focusBuilding: "b" },
      map: { diagrams: [{ id: "graph", title: "Worker dependencies", owner: "b", kind: "graph",
        nodes: [{ id: "worker", label: "Worker", source }, { id: "retry", label: "Retry", hint: "queue", source: retrySource }],
        edges: [{ id: "edge", from: "worker", to: "retry", kind: "async", source }] }] },
      scenario: { flows: [{ id: "flow", title: "Worker result", scope: "module:b", path: [point("start", "Dispatch"), point("done", "Finished")],
        branches: [{ id: "retry", at: 0, from: "start", condition: "Failed", path: [point("queued", "Queued", retrySource)] }],
        scenarios: [{ id: "success", title: "Complete", steps: ["start", "done"] }, { id: "failed", title: "Retry", steps: ["start", "queued"] }] }],
        questions: [{ id: "what-fails", kind: "choice", prompt: "What happens on failure?", options: [{ id: "a", label: "Queued" }, { id: "b", label: "Finished" }],
          answer: ["a"], explanation: "The worker returns retry's queued result.", source, replay: { flow: "flow", scenario: "failed", step: "queued" } }] }
    };
    const reference = { city: await loadSceneReference("city"), lesson: await loadSceneReference("lesson") };
    const calls = [];
    let limitCity = true;
    let limitCompact = false;
    let stallScenario = true;
    process.env.ANTHROPIC_API_KEY = "fixture-only";
    globalThis.fetch = async (url, opts) => {
      assert.equal(url, "https://api.anthropic.com/v1/messages");
      const request = JSON.parse(opts.body);
      assert.equal(request.model, "fixture-model");
      const message = request.messages[0].content;
      const blocks = typeof message === "string" ? [{ type: "text", text: message }] : message;
      const prompt = blocks.find((part) => part.type === "text").text;
      const kind = prompt.includes("# Task P1") ? "city" : prompt.includes("# Task P2 — Focus map:") ? "map" : "scenario";
      const image = blocks.find((part) => part.type === "image");
      const compactCity = prompt.includes("single compact city retry");
      const narrow = prompt.includes("single smaller retry") || compactCity;
      const expectedReference = reference[kind === "city" ? "city" : "lesson"];
      if (narrow || !expectedReference) assert.equal(image, undefined);
      else assert.equal(hashFromImage(image), expectedReference.sha256);
      if (kind === "city") assert.match(prompt, /export const entry/);
      else assert.match(prompt, /function worker/);
      calls.push(compactCity ? "city-compact" : kind);
      if (kind === "city" && limitCity) {
        limitCity = false;
        return new Response(JSON.stringify({ stop_reason: "max_tokens", content: [{ type: "text", text: "{partial" }] }));
      }
      if (compactCity && limitCompact) return new Response(JSON.stringify({ stop_reason: "max_tokens", content: [] }));
      if (kind === "scenario" && stallScenario) {
        return new Promise((_, reject) => opts.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
      }
      return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(answers[kind]) }] }));
    };

    const settings = { db, dataDir, project, brief: "Worker retry behavior", language: "en", agent: "api", model: "fixture-model", timeoutMs: 45 };
    const waitForJob = async (args) => {
      const started = startSpaceJob(args);
      assert.ok(started.jobId, started.error);
      for (let i = 0; i < 400; i++) {
        const job = getJob(db, started.jobId);
        if (job.status === "done") return job;
        assert.notEqual(job.status, "failed", JSON.stringify(job.error));
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.fail("The local generation fixture exceeded its budget.");
    };

    const partial = await waitForJob(settings);
    assert(partial.stages.some(({ text }) => text.includes("smaller overview")));
    assert.deepEqual(partial.deliverables.map((item) => item.state), ["ready", "timed-out"]);
    assert.equal(partial.draftAvailable, true);
    await assert.rejects(fs.stat(spacePath(dataDir, project.id)), { code: "ENOENT" });
    const draft = JSON.parse(await fs.readFile(generationDraftPath(dataDir, project.id, partial.id), "utf8"));
    assert.equal(draft.space.diagrams.length, 1);
    assert.equal(draft.space.flows.length, 0);
    stallScenario = false;
    const done = await waitForJob({ ...settings, brief: "Ignored retry options", model: "wrong-model",
      resume: { jobId: partial.id, deliverableId: "focus-scenario" } });
    assert.deepEqual(done.deliverables.map((item) => item.state), ["ready", "ready"]);
    assert.equal(done.focusReady, true);
    assert.deepEqual(calls, ["city", "city-compact", "map", "scenario", "scenario", "scenario"]);
    const published = await fs.readFile(spacePath(dataDir, project.id), "utf8");
    const { space } = JSON.parse(published);
    assert.equal(space.presentation.start.building, "b");
    assert.equal(space.tour.length, 2);
    assert.equal(space.assessment.questions[0].replay.flow, space.presentation.start.flow);

    stallScenario = true;
    const failedRefresh = await waitForJob({ ...settings, fresh: true });
    assert.equal(failedRefresh.quality.keptPrevious, true);
    assert.equal(await fs.readFile(spacePath(dataDir, project.id), "utf8"), published);
    limitCity = limitCompact = true;
    const pendingPlan = await waitForJob({ ...settings, fresh: true });
    assert(pendingPlan.stages.some(({ text, state }) => text.includes("Source-linked city overview is pending") && state === "pending"));
    assert.equal(pendingPlan.quality.keptPrevious, true);
    assert.equal(await fs.readFile(spacePath(dataDir, project.id), "utf8"), published);

    limitCity = limitCompact = false;
    const architecture = await waitForJob({ ...settings, fresh: true, brief: "Architecture only" });
    assert.equal(architecture.focusReady, true);
    assert.deepEqual(architecture.deliverables.map(({ kind }) => kind), ["map"]);
    const architectureSpace = JSON.parse(await fs.readFile(spacePath(dataDir, project.id), "utf8")).space;
    assert.equal(architectureSpace.presentation.start.flow, undefined);
    assert.equal(architectureSpace.tour[0].ref, architectureSpace.presentation.start.diagram);
  } finally {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = realKey;
    db.close();
    await clean();
  }
});

test("CLI adapters pass one approved PNG and safely launch trusted Windows shims", async () => {
  const { dir, clean } = await scratch();
  const originalPath = process.env.PATH;
  try {
    const bin = path.join(dir, "local é & tools");
    await fs.mkdir(bin);
    const shim = path.join(bin, "fake-agent.mjs");
    await fs.writeFile(shim, `import fs from 'node:fs'; import crypto from 'node:crypto';
      const [agent,...args] = process.argv.slice(2);
      if (args.includes('--help')) { console.log(agent === 'claude' ? '--input-format stream-json' : '--image'); process.exit(0); }
      if (args.includes('--version')) { console.log(agent + ' fixture version'); process.exit(0); }
      const model = args[args.indexOf(agent === 'claude' ? '--model' : '-m') + 1];
      if (model === 'timeout') { fs.writeFileSync('agent.pid',String(process.pid)); setTimeout(()=>{},3000); }
      else {
      const input = fs.readFileSync(0,'utf8');
      let bytes, prompt;
      if (agent === 'claude') {
        const msg=JSON.parse(input); const blocks=msg.message.content;
        if(!args.includes('--input-format') || blocks.length!==2) process.exit(2);
        bytes=Buffer.from(blocks[1].source.data,'base64'); prompt=blocks[0].text;
      } else {
        const at=args.indexOf('--image'); if(at<0 || args.lastIndexOf('--image')!==at) process.exit(3);
        bytes=fs.readFileSync(args[at+1]); prompt=input;
      }
      const result=JSON.stringify({hash:crypto.createHash('sha256').update(bytes).digest('hex'),prompt,model, cwd: process.cwd(),
        seesWorkspace: fs.existsSync('workspace-only.txt'), args});
      console.log(agent === 'claude' ? JSON.stringify({type:'result',subtype:'success',result}) : result); }`);
    for (const name of ["claude", "codex"]) {
      if (process.platform === "win32") {
        await fs.writeFile(path.join(bin, `${name}.cmd`), `@echo off\r\n"${process.execPath}" "%~dp0fake-agent.mjs" ${name} %*\r\n`);
      } else {
        await fs.writeFile(path.join(bin, name), `#!/bin/sh\nexec '${process.execPath}' '${shim}' ${name} "$@"\n`, { mode: 0o700 });
      }
    }
    process.env.PATH = [bin, path.dirname(process.execPath)].join(path.delimiter);
    await fs.writeFile(path.join(dir, "workspace-only.txt"), "fixture-only workspace data");
    if (process.platform === "win32") {
      await fs.writeFile(path.join(dir, "codex.cmd"), "@echo workspace shadow\r\nexit /b 1\r\n");
      const native = localCommand("node", ["--version"]);
      assert.ok(native.file.endsWith(".exe"));
      assert.equal(native.windowsVerbatimArguments, undefined);
      assert.equal(spawnSync(native.file, native.args, { encoding: "utf8" }).stdout.trim(), process.version);
    }
    const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4ZkAAAAASUVORK5CYII=", "base64");
    const board = { id: "fixture", version: 1, bytes, sha256: digest(bytes) };
    const spaced = path.join(dir, "scene é & board.png");
    await fs.writeFile(spaced, board.bytes);
    const reference = { ...board, file: spaced };
    const model = "release/2026-11.test:beta";
    for (const agent of ["claude", "codex"]) {
      assert.equal(supportsSceneReference(agent, reference), true);
      assert.deepEqual(checkCommand(agent), { found: true, detail: `${agent} fixture version` });
      const settings = { prompt: "fixture prompt", cwd: dir, timeoutMs: 5_000, reference, model };
      const { cwd, seesWorkspace, args, ...result } = JSON.parse(await runAgent(agent, settings));
      assert.deepEqual(result, { hash: board.sha256, prompt: "fixture prompt", model });
      assert.equal(seesWorkspace, false);
      assert.notEqual(cwd, dir);
      await assert.rejects(fs.stat(cwd), { code: "ENOENT" });
      const discovery = JSON.parse(await runAgent(agent, { ...settings, packetOnly: false }));
      assert.equal(discovery.seesWorkspace, true);
      if (agent === "claude") {
        assert.equal(args[args.indexOf("--tools") + 1], "");
        assert.ok(args.includes("--restricted") && args.includes("--strict-mcp-config"));
        assert.equal(discovery.args[discovery.args.indexOf("--tools") + 1], "Read,Glob,Grep");
      } else {
        assert.ok(args.includes("--ignore-user-config") && args.includes("--ignore-rules"));
        assert.ok(args.includes("shell_tool") && args.includes("unified_exec"));
        assert.ok(!discovery.args.includes("shell_tool") && !discovery.args.includes("unified_exec"));
      }
      await assert.rejects(runAgent(agent, { prompt: "fixture prompt", cwd: dir, timeoutMs: 5_000, model: "bad&model" }),
        ({ code }) => code === "AGENT_MODEL_INVALID");
    }
    if (process.platform === "win32") assert.equal(supportsSceneReference("codex", { ...reference, file: path.join(dir, "scene %PATH%.png") }), false);
    await assert.rejects(runAgent("codex", { prompt: "fixture prompt", cwd: dir, timeoutMs: 1_000, model: "timeout", packetOnly: false }),
      ({ code }) => code === "AGENT_TIMEOUT");
    const pid = Number(await fs.readFile(path.join(dir, "agent.pid"), "utf8"));
    assert.ok(Number.isSafeInteger(pid) && pid > 0);
    const alive = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
    // Restricted Windows test sandboxes can deny taskkill. Outside them the
    // strict gate requires termination before the fixture's own 3 s exit.
    const checks = process.env.KODYURD_TEST_WINDOWS_TREE === "1" ? 50 : 160;
    for (let i = 0; i < checks && alive(); i++) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(alive(), false, "the timed-out CLI process should be stopped");
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    await clean();
  }
});

test("the studio API generates one English HTML form replay with tutorial, runbook, and reference evidence", async () => {
  const { dir, clean } = await scratch();
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.ANTHROPIC_API_KEY;
  const dataDir = path.join(dir, "data");
  const db = openDb(dataDir);
  const app = Fastify();
  registerApi(app, { db, dataDir, version: "fixture", uiDist: fileURLToPath(new URL("../../ui/dist/", import.meta.url)) });
  try {
    const sourceDir = path.join(dir, "frontend");
    await fs.mkdir(path.join(sourceDir, "src", "checkout"), { recursive: true });
    const sourcePath = "src/checkout/checkout.html";
    await fs.writeFile(path.join(sourceDir, sourcePath), [
      "<form onsubmit=\"submitCheckout(event)\"><button>Save order</button></form>",
      "<output id=\"status\"></output>",
      "<script>",
      "function submitCheckout(event) {",
      "  event.preventDefault();",
      "  document.getElementById('status').textContent = 'Order saved';",
      "}",
      "</script>"
    ].join("\n"));
    const docs = [
      ["checkout-tutorial.md", "# Checkout tutorial\n\n## Save an order\n\nPress Save order and read the confirmation."],
      ["checkout-runbook.md", "# Checkout runbook\n\n## Check the result\n\nInspect the status output if the confirmation is missing."],
      ["checkout-reference.md", "# Checkout reference\n\n## Form contract\n\n| Element | Behavior |\n| --- | --- |\n| status | Displays the confirmation |"]
    ];
    await Promise.all(docs.map(([file, body]) => fs.writeFile(path.join(sourceDir, "src", "checkout", file), body)));
    const src = (startLine) => ({ path: sourcePath, startLine });
    const point = (id, caption, line) => ({ id, ref: `step:${id}`, caption, source: src(line) });
    const content = {
      city: { city: { districts: [{ id: "d", title: "Web client" }], buildings: [{ id: "b", moduleRef: "src/checkout", district: "d",
        title: "Checkout", summary: "Saves an order", source: src(1), metrics: { files: 4, loc: 8, docs: 3 } }] }, focusBuilding: "b" },
      map: { diagrams: [{ id: "checkout-map", owner: "b", kind: "graph", title: "Checkout structure", origin: "docs",
        source: { path: "src/checkout/checkout-tutorial.md", startLine: 3, endLine: 5 }, nodes: [
        { id: "form", label: "Order form", hint: "ui", source: src(1) }, { id: "result", label: "Status output", hint: "ui", source: src(2) }
      ], edges: [{ from: "form", to: "result", label: "Write confirmation", source: src(6) }] }] },
      scenario: { flows: [{ id: "submit", scope: "module:b", title: "Save an order",
        source: { path: "src/checkout/checkout-runbook.md", startLine: 3, endLine: 5 },
        path: [point("submit", "Submit the form", 1), point("handle", "Handle the submit event", 5), point("result", "Show Order saved", 6)],
        scenarios: [{ id: "success", title: "Order saved", steps: ["submit", "handle", "result"] }] }] }
    };
    let guideFlowId;
    process.env.ANTHROPIC_API_KEY = "fixture-only";
    globalThis.fetch = async (url, opts) => {
      assert.equal(url, "https://api.anthropic.com/v1/messages");
      const message = JSON.parse(opts.body).messages[0].content;
      const prompt = typeof message === "string" ? message : message.find((block) => block.type === "text").text;
      let value;
      if (guideFlowId) {
        assert.match(prompt, /Show Order saved/);
        assert.match(prompt, /"startLine":6/);
        value = { answer: "The handler sets the status output to Order saved.", citations: [{ ...src(6), focusRef: guideFlowId }, src(99)] };
      } else if (prompt.includes("# Task P1")) value = content.city;
      else {
        assert.match(prompt, /Content language: en/);
        assert.match(prompt, /cite that exact[\s\S]*section as its top-level source/);
        assert.match(prompt, /6 \|   document\.getElementById\('status'\)\.textContent = 'Order saved'/);
        for (const [name] of docs) assert.ok(prompt.includes(name), name);
        assert.match(prompt, /\| status \| Displays the confirmation \|/);
        const map = prompt.includes("# Task P2 — Focus map:");
        if (!map) assert.match(prompt, /"map":"Checkout structure","components":\["Order form","Status output"\]/);
        value = map ? content.map : content.scenario;
      }
      return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(value) }] }));
    };
    const created = await app.inject({ method: "POST", url: "/api/projects", payload: { name: "Checkout fixture", sourceDir } });
    assert.equal(created.statusCode, 200, created.body);
    const project = created.json().project;
    const prefix = `/api/projects/${project.id}`;
    const started = await app.inject({ method: "POST", url: `${prefix}/space`, payload: { agent: "api", language: "en", brief: "Explain the Checkout form from click to confirmation" } });
    assert.equal(started.statusCode, 200, started.body);
    const { jobId } = started.json();
    let job;
    for (let i = 0; i < 400; i++) {
      ({ job } = (await app.inject(`/api/jobs/${jobId}`)).json());
      if (job.status === "done" || job.status === "failed") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(job.status, "done", JSON.stringify(job.error));
    assert.equal(job.focusReady, true, JSON.stringify(job.quality));
    const saved = await app.inject(`${prefix}/space`);
    assert.equal(saved.statusCode, 200, saved.body);
    const { space } = saved.json();
    assert.equal(space.meta.language, "en");
    const flow = space.flows.find((item) => item.id === space.presentation.start.flow);
    assert.equal(space.diagrams.find((item) => item.id === space.presentation.start.diagram).origin, "docs");
    assert.equal(space.meta.coverage.find(({ doc }) => doc.endsWith("checkout-tutorial.md")).placed, 1);
    assert.equal(space.meta.coverage.find(({ doc }) => doc.endsWith("checkout-runbook.md")).placed, 1);
    assert.equal(space.meta.coverage.find(({ doc }) => doc.endsWith("checkout-reference.md")).placed, 0);
    assert.equal(flow.scenarios.length, 1);
    assert.equal(flow.branches?.length ?? 0, 0);
    assert.deepEqual(space.assessment.questions.map(({ kind }) => kind), ["order"]);
    assert.deepEqual(space.assessment.questions[0].answer, ["submit", "handle", "result"]);
    guideFlowId = flow.id;
    const answer = await app.inject({ method: "POST", url: `${prefix}/ask`, payload: {
      question: "How does the confirmation appear?", focusRef: flow.id, scenarioId: "success", stepId: "result", draftJobId: jobId
    } });
    assert.equal(answer.statusCode, 200, answer.body);
    assert.deepEqual(answer.json().citations, [{ ...src(6), focusRef: flow.id }]);
    const doc = await app.inject(`${prefix}/doc?path=${encodeURIComponent(sourcePath)}&from=6&to=6`);
    assert.equal(doc.statusCode, 200, doc.body);
    assert.match(doc.json().text, /textContent = 'Order saved'/);
    const exported = await app.inject({ method: "POST", url: `${prefix}/export` });
    assert.equal(exported.statusCode, 200, exported.body);
    const offline = Fastify();
    try {
      await offline.register(fastifyStatic, { root: path.join(projectDir(dataDir, project.id), "export"), prefix: "/nested/lesson/" });
      const html = await offline.inject("/nested/lesson/index.html");
      const entry = /src="\.\/(assets\/export-[^"]+\.js)"/.exec(html.body)?.[1];
      assert.ok(entry);
      assert.equal((await offline.inject(`/nested/lesson/${entry}`)).statusCode, 200);
      const payload = (await offline.inject("/nested/lesson/space.json")).json();
      assert.equal(payload.space.meta.sourceDir, ".");
      assert.deepEqual(payload.space.assessment, space.assessment);
      assert.deepEqual(payload.space.tour, space.tour);
      assert.equal((await offline.inject("/api/projects")).statusCode, 404);
    } finally {
      await offline.close();
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
    await app.close();
    db.close();
    await clean();
  }
});
