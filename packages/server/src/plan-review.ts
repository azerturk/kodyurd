import { createHash } from "node:crypto";
import { z } from "zod";
import type { AnalyzerReport } from "./analyzer.js";
import { AgentError } from "./agents.js";
import type { FocusDeliverable } from "./focus-generation.js";
import type { SourceReader } from "./source-evidence.js";
import { isDocumentationOnly } from "./source-evidence.js";
import { LESSON_VIEWS, type LessonView, type TCityPlan } from "./space-pipeline.js";

export interface PlanReview {
  focusBuilding?: string;
  buildings: {
    id: string;
    moduleRef: string;
    title: string;
    required: boolean;
    documentationOnly: boolean;
    selected: boolean;
    views: LessonView[];
  }[];
}

const selections = z.array(z.object({
  building: z.string().min(1).max(64),
  views: z.array(z.enum(LESSON_VIEWS)).max(4).default([])
}).strict()).min(1).max(10);
export type PlanSelection = z.infer<typeof selections>;

/** Include discovery-supplied citations as well as the prepared planning packet. */
export function reviewEvidencePaths(plan: TCityPlan, supplied: string[]): string[] {
  const paths = new Set(supplied);
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { for (const item of value) visit(item); return; }
    const record = value as Record<string, unknown>;
    if (typeof record.path === "string") paths.add(record.path);
    for (const [key, child] of Object.entries(record)) {
      if (key !== "path" || typeof child !== "string") visit(child);
    }
  };
  visit(plan.city.buildings);
  visit(plan.flows);
  visit(plan.diagrams);
  if (paths.size > 256) throw new AgentError("PLAN_EVIDENCE_LIMIT", "This plan references too many evidence files to review at once. Narrow the brief and generate a new plan.");
  return [...paths];
}

export function buildPlanReview(plan: TCityPlan, report: AnalyzerReport,
  lessons: { building: { id: string }; optional: boolean; deliverables: FocusDeliverable[] }[], focusBuilding?: string): PlanReview {
  return { focusBuilding, buildings: plan.city.buildings.map((building) => {
    const lesson = lessons.find((item) => item.building.id === building.id);
    return { id: building.id, moduleRef: building.moduleRef, title: building.title,
      required: Boolean(lesson && !lesson.optional), documentationOnly: isDocumentationOnly(report, building.moduleRef),
      selected: Boolean(lesson), views: (lesson?.deliverables.map(({ kind }) => kind)
        .filter((kind): kind is LessonView => (LESSON_VIEWS as readonly string[]).includes(kind)) ?? []).slice(0, 4) };
  }) };
}

/** Validate the user's bounded lesson selection before another provider call can start. */
export function validatePlanSelection(input: unknown, review: PlanReview): PlanSelection {
  const parsed = selections.safeParse(input);
  if (!parsed.success) throw new AgentError("PLAN_SELECTION_INVALID", "Choose up to ten buildings and up to four additional views per building.");
  const chosen = new Set(parsed.data.map(({ building }) => building));
  if (chosen.size !== parsed.data.length || parsed.data.length < Math.min(2, review.buildings.length) ||
    parsed.data.some(({ building, views }) => !review.buildings.some(({ id }) => id === building) || new Set(views).size !== views.length) ||
    review.buildings.some(({ id, required }) => required && !chosen.has(id))) {
    throw new AgentError("PLAN_SELECTION_INVALID", "Keep the focus and pinned buildings, choose at least two buildings when available, and select each building once.");
  }
  // Required lessons retain their order, keeping the arrival and pinned scope stable.
  return review.buildings.filter(({ required }) => required).flatMap(({ id }) => parsed.data.filter(({ building }) => building === id))
    .concat(parsed.data.filter(({ building }) => !review.buildings.find(({ id }) => id === building)?.required));
}

/** Hash the exact evidence files used for the plan, rather than treating a timestamp as freshness. */
export async function planEvidenceHashes(paths: string[], read: SourceReader): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  for (const file of [...new Set(paths)].sort()) {
    const lines = await read(file);
    if (!lines) throw new AgentError("PLAN_SOURCE_CHANGED", "The evidence used for this plan is no longer available. Generate a new plan.");
    hashes[file] = createHash("sha256").update(lines.join("\n")).digest("hex");
  }
  return hashes;
}

export async function checkPlanEvidence(expected: Record<string, string> | undefined, read: SourceReader): Promise<void> {
  if (!expected || !Object.keys(expected).length) throw new AgentError("PLAN_SOURCE_CHANGED", "This plan has no evidence snapshot. Generate a new plan.");
  const actual = await planEvidenceHashes(Object.keys(expected), read);
  if (Object.keys(expected).some((file) => actual[file] !== expected[file])) {
    throw new AgentError("PLAN_SOURCE_CHANGED", "The evidence used for this plan has changed. Generate a new plan before building lessons.");
  }
}
