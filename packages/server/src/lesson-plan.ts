import { createHash } from "node:crypto";
import type { AnalyzerReport } from "./analyzer.js";
import { AgentError } from "./agents.js";
import type { FocusDeliverable } from "./focus-generation.js";
import { CityPlan, type TCityPlan } from "./space-pipeline.js";

/**
 * Which buildings one generation teaches: the focus, the modules the brief pins, and the
 * other buildings the plan read out of the brief, inside bounds that keep a job finite.
 */

export const blockWeight = (d: { blocks: { mermaid: number; tables: number; decisions: number; ascii: number } }) =>
  d.blocks.mermaid * 3 + d.blocks.tables + d.blocks.decisions + d.blocks.ascii;

// The brief decides how many buildings get a lesson; these bounds keep one job finite.
const LESSON_FLOOR = 2;      // never leave the focus as the only building to enter
export const LESSON_CEILING = 10;   // built in one job unless the user asks for the rest
export const LESSON_HARD_LIMIT = 40;
export const LESSON_POOL = 2;       // optional lessons generated at the same time
const PINNED_LESSON_LIMIT = LESSON_CEILING - 1;

export type PlannedBuilding = TCityPlan["city"]["buildings"][number];
export interface Lesson {
  building: PlannedBuilding;
  brief: string;
  companionLesson: boolean;
  documentationOnly: boolean;
  /** Added from the brief: built after the required lessons and never blocks the city. */
  optional: boolean;
  deliverables: FocusDeliverable[];
}

export const lessonLimit = (value: number | undefined): number =>
  Math.min(LESSON_HARD_LIMIT, Math.max(1, Math.floor(Number.isFinite(value) ? value as number : LESSON_CEILING)));

/** Other buildings the plan read out of the brief, in its order, then a neighbour to reach the floor. */
export function briefLessons(plan: TCityPlan, required: PlannedBuilding[], documentationOnly: (building: PlannedBuilding) => boolean): PlannedBuilding[] {
  if (!required.length) return [];
  const taken = new Set(required.map(({ id }) => id));
  const chosen: PlannedBuilding[] = [];
  const add = (id: string | undefined): void => {
    const building = plan.city.buildings.find((item) => item.id === id);
    if (!building || taken.has(building.id) || chosen.length >= LESSON_HARD_LIMIT) return;
    taken.add(building.id);
    chosen.push(building);
  };
  for (const lesson of plan.lessons) add(lesson.building);
  const short = (): boolean => required.length + chosen.length < LESSON_FLOOR;
  // A building next to the focus on a system flow explains it best.
  for (const flow of plan.flows) {
    if (!short()) break;
    const refs = flow.path.map(({ ref }) => ref);
    const at = refs.indexOf(required[0].id);
    if (at >= 0) add(refs[at + 1] ?? refs[at - 1]);
  }
  const rest = plan.city.buildings.filter(({ id }) => !taken.has(id)).sort((a, b) =>
    Number(documentationOnly(a)) - Number(documentationOnly(b)) || (b.metrics?.loc ?? 0) - (a.metrics?.loc ?? 0));
  for (const building of rest) {
    if (!short()) break;
    add(building.id);
  }
  return chosen;
}

export function moduleMention(brief: string, modules: AnalyzerReport["modules"]): string | undefined {
  const words = brief.normalize("NFKC").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const matches = modules.filter((module) => {
    const name = module.name.split("/").at(-1)!.toLowerCase();
    return name.length >= 4 && (words.includes(name) || brief.toLowerCase().includes(module.name.toLowerCase()) && module.name.includes("/"));
  });
  return matches.length === 1 ? matches[0].name : undefined;
}

export function lessonBrief(brief: string): { primary: string; companions: string[] } {
  const primary: string[] = [];
  const companions = new Set<string>();
  for (const line of brief.split(/\r?\n/)) {
    const directive = /^\s*Lesson modules\s*:\s*(.*)$/i.exec(line);
    if (!directive) {
      primary.push(line);
      continue;
    }
    for (const key of directive[1].split(",")) {
      const module = key.trim().replace(/^`([^`]+)`$/, "$1");
      if (module) companions.add(module);
    }
  }
  if (companions.size > PINNED_LESSON_LIMIT) throw new AgentError("LESSON_SCOPE_LIMIT", `Pin up to ${PINNED_LESSON_LIMIT} additional lesson modules.`);
  return { primary: primary.join("\n").trim(), companions: [...companions] };
}

export function checkLessonModules(report: AnalyzerReport, modules: string[]): void {
  if (modules.some((key) => !report.modules.some(({ name }) => name === key))) {
    throw new AgentError("LESSON_MODULE_NOT_FOUND", "An additional lesson module is absent from the scan. Choose an exact module key from the source inventory.");
  }
}

export function focusedBuilding(plan: TCityPlan, report: AnalyzerReport, module: string | undefined, hasBrief: boolean): string | undefined {
  const named = plan.city.buildings.find((building) => building.moduleRef === module);
  const chosen = plan.city.buildings.find((building) => building.id === plan.focusBuilding);
  if (named) return named.id;
  if (!module) return chosen?.id ?? (hasBrief ? undefined : (plan.city.buildings.find((building) => building.archetype === "landmark") ?? plan.city.buildings[0])?.id);
  const source = report.modules.find((candidate) => candidate.name === module);
  const district = plan.city.districts.find((item) => item.kind === "domain") ?? plan.city.districts[0];
  if (!source || !district) return chosen?.id;
  const title = module.split("/").at(-1)!;
  const stem = `focus-${title.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 40)}`;
  const id = plan.city.buildings.some((building) => building.id === stem) ? `${stem}-${createHash("sha256").update(module).digest("hex").slice(0, 8)}` : stem;
  const path = source.entryFiles?.[0] ?? source.topFiles[0]?.path;
  plan.city.buildings.unshift({
    id, moduleRef: module, title, district: district.id,
    metrics: { files: source.files, loc: source.loc, docs: report.docs.filter((doc) => doc.matches.includes(module)).length },
    archetype: "landmark", summary: "", source: path ? { path } : undefined
  });
  plan.city.buildings = plan.city.buildings.slice(0, 120);
  return id;
}

export function inventoryCity(report: AnalyzerReport, title: string, focusModule?: string): TCityPlan {
  const modules = [...report.modules].sort((a, b) => Number(b.name === focusModule) - Number(a.name === focusModule)).slice(0, 40);
  return CityPlan.parse({ city: {
    districts: [{ id: "workspace", title, kind: "domain" }],
    buildings: modules.map((module) => ({
      id: `module-${createHash("sha256").update(module.name).digest("hex").slice(0, 14)}`,
      moduleRef: module.name, title: module.name.split("/").at(-1), district: "workspace",
      metrics: { files: module.files, loc: module.loc, docs: report.docs.filter((doc) => doc.matches.includes(module.name)).length },
      archetype: module.name === focusModule ? "landmark" : "low", summary: "",
      source: module.entryFiles?.[0] ? { path: module.entryFiles[0] } : undefined
    }))
  } });
}
