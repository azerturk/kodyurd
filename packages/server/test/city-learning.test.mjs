import assert from "node:assert/strict";
import test from "node:test";
import { parseSpace } from "@kodyurd/scene-schema";
import { applyScanFacts } from "../dist/city-facts.js";
import { assembledQuestionId } from "../dist/learning-selection.js";
import { assembleSpace, BuildingPass, CityPlan, finalizeSpace, normalizeBuildingPass } from "../dist/space-pipeline.js";

const source = { path: "orders/service.ts", startLine: 2, endLine: 3 };
const project = { id: "fixture", name: "Workspace", source_dir: ".", scene_type: "", created_at: "" };
const building = (id, moduleRef = id) => ({ id, moduleRef, district: "domain", title: id, summary: "" });
const cityPlan = (buildings) => CityPlan.parse({ city: { districts: [{ id: "domain", title: "Domain" }], buildings } });
const question = (id, owner) => ({
  id, building: owner, kind: "choice", prompt: `What does ${owner} do?`,
  options: [{ id: "yes", label: "Processes input" }, { id: "no", label: "Ignores input" }],
  answer: ["yes"], explanation: "It processes the input.", source
});
const pass = (owner, count = 1, stops = 0) => BuildingPass.parse({
  questions: Array.from({ length: count }, (_, index) => question(`q${index + 1}`, owner)),
  tour: Array.from({ length: stops }, (_, index) => ({ ref: owner, narration: `Stop ${index + 1}`, source })),
  interior: { building: owner, lobby: { summary: "" } }
});
const assemble = (plan, passes, extra = {}) => assembleSpace({ project, language: "en", plan, passes, ...extra });

test("scan facts replace provider estimates without changing source or mutating the plan", () => {
  const plan = cityPlan([
    { ...building("orders"), metrics: { files: 999, loc: 999, docs: 999 } }, building("docs")
  ]);
  const report = {
    modules: [{ name: "orders", files: 7, loc: 81 }, { name: "docs", files: 2, loc: 20 }],
    docs: [
      { module: "orders", matches: ["orders"] },
      { module: null, matches: ["orders", "docs"] },
      { module: "docs", matches: [] }
    ]
  };
  const updated = applyScanFacts(plan, report);
  assert.deepEqual(updated.city.buildings.map(({ metrics }) => metrics), [
    { files: 7, loc: 81, docs: 2 }, { files: 2, loc: 20, docs: 2 }
  ]);
  assert.equal(plan.city.buildings[0].metrics.files, 999);
  assert.equal(updated.city.buildings[0].moduleRef, "orders");
});

test("two lessons keep the same local question ID with stable bounded assembly identities", () => {
  const plan = cityPlan([building("orders", "src/orders"), building("billing", "src/billing")]);
  const parts = [pass("orders"), pass("billing")];
  const result = finalizeSpace(assemble(plan, parts));
  assert.equal(result.success, true, result.issues);
  const questions = result.data.assessment.questions;
  assert.equal(questions.length, 2);
  assert.equal(new Set(questions.map(({ id }) => id)).size, 2);
  assert.ok(questions.every(({ id }) => id.length <= 64));
  assert.equal(parts[0].questions[0].id, "q1", "cached provider passes are not rewritten");
  const byOwner = (items) => Object.fromEntries(items.map(({ building: owner, id }) => [owner, id]));
  assert.deepEqual(byOwner(assemble(plan, parts.slice().reverse()).assessment.questions), byOwner(questions));
  const renamed = assemble(cityPlan([building("renamed", "src/orders")]), [pass("renamed")]);
  assert.equal(renamed.assessment.questions[0].id, byOwner(questions).orders,
    "a provider's building alias does not change canonical module question identity");
  assert.notEqual(assembledQuestionId("orders", "scenario:one", "q1"), assembledQuestionId("orders", "scenario:two", "q1"));
});

test("city-wide limits distribute questions and stops across lessons and report omissions", () => {
  const owners = Array.from({ length: 10 }, (_, index) => `module-${index}`);
  const plan = cityPlan(owners.map((owner) => building(owner)));
  const parts = owners.map((owner) => pass(owner, 8, 6));
  let omitted;
  const result = assemble(plan, parts, { onLearningLimit: (value) => { omitted = value; } });
  assert.equal(result.assessment.questions.length, 64);
  assert.equal(result.tour.length, 40);
  assert.deepEqual(omitted, { questions: 16, tourStops: 20 });
  const counts = (items, ownerOf) => owners.map((owner) => items.filter((item) => ownerOf(item) === owner).length);
  const questionCounts = counts(result.assessment.questions, ({ building: owner }) => owner);
  assert.ok(Math.min(...questionCounts) >= 6);
  assert.ok(Math.max(...questionCounts) <= 7);
  assert.deepEqual(counts(result.tour, ({ ref }) => ref), owners.map(() => 4));
  assert.deepEqual(assemble(plan, parts.slice().reverse()).assessment, result.assessment);
  assert.equal(finalizeSpace(result).success, true);
});

test("different questions with a repeated local ID in one lesson are not silently overwritten", () => {
  const plan = cityPlan([building("orders")]);
  const part = pass("orders");
  part.questions.push({ ...part.questions[0], prompt: "What follows processing?", answer: ["no"] });
  const first = assemble(plan, [part]).assessment.questions;
  const second = assemble(plan, [{ ...part, questions: [...part.questions].reverse() }]).assessment.questions;
  assert.equal(first.length, 2);
  assert.equal(new Set(first.map(({ id }) => id)).size, 2);
  assert.ok(first.every(({ id }) => id.length <= 64));
  assert.deepEqual(second, first);
});

test("new assembly changes only question identity and keeps exact replay links", () => {
  const plan = cityPlan([building("orders")]);
  const part = pass("orders");
  part.flows.push({ id: "kc-flow-orders", title: "Order", scope: "module:orders", kind: "calls",
    path: [{ id: "read", ref: "orders" }, { id: "save", ref: "orders" }],
    scenarios: [{ id: "ordinary", title: "Ordinary", steps: ["read", "save"] }] });
  const replay = { flow: "kc-flow-orders", scenario: "ordinary", step: "save", stepIndex: 1 };
  part.questions[0].replay = replay;
  const result = finalizeSpace(assemble(plan, [part]));
  assert.equal(result.success, true, result.issues);
  assert.deepEqual(result.data.assessment.questions[0].replay, replay);
  const saved = structuredClone(result.data);
  saved.assessment.questions[0].id = "q1";
  const parsed = parseSpace(saved);
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.assessment.questions[0].id, "q1", "old saved scenes are not migrated on read");
});

test("diagram normalization retains class multiplicity, member details and self-loops", () => {
  const diagram = { id: "types", owner: "city", title: "Types", kind: "class",
    nodes: [
      { id: "order", label: "Order", fields: [{ name: "total(tax: Money)", type: "Money", note: "Includes tax.", source }] },
      { id: "line", label: "Line" }
    ],
    edges: [
      { id: "contains", from: "order", to: "line", label: "has", cardinality: { from: "1", to: "0..*" }, source },
      { id: "retry", from: "order", to: "order", label: "recalculate", source }
    ]
  };
  const result = BuildingPass.parse(normalizeBuildingPass({ diagrams: [diagram] })).diagrams[0];
  assert.deepEqual(result.edges[0].cardinality, diagram.edges[0].cardinality);
  assert.deepEqual(result.nodes[0].fields[0], diagram.nodes[0].fields[0]);
  assert.equal(result.edges[1].from, result.edges[1].to);
  assert.deepEqual(result.edges[1].source, source);
});
