import { promises as fs } from "node:fs";
import type { TSpaceDocument } from "@kodyurd/scene-schema";
import { summarizeForPrompt, type AnalyzerReport } from "./analyzer.js";
import { AgentError, extractJsonObject, extractResultText, runAgent, type AgentId } from "./agents.js";
import type { ProjectRow } from "./jobs.js";
import { generationDraftPath, getOrCreateAnalysis, spacePath } from "./project-files.js";
import { buildAskPrompt } from "./prompt.js";
import {
  collectGuideEvidence, createSourceReader, guideEvidenceCovers, isDocumentationOnly, relatedGuideClaimSources, relatedGuideScenarios,
  resolveEvidencePath, verifiedSourceRef, type EvidenceExcerpt, type SourceReader
} from "./source-evidence.js";
import { isWorkspaceUnderMaintenance } from "./workspace-operation.js";

/** The in-scene guide: one short, awaited agent answer grounded in the open city and its sources. */

const askingProjects = new Set<string>();

export const hasActiveGuide = (projectId: string): boolean => askingProjects.has(projectId);

export interface AskArgs {
  dataDir: string;
  project: ProjectRow;
  question: string;
  language: string;
  agent: AgentId;
  model?: string;
  draftJobId?: string;
  focusRef?: string;
  scenarioId?: string;
  stepId?: string;
  stepIndex?: number;
  focusTitle?: string;
  focusSourcePath?: string;
  sourceStartLine?: number;
  sourceEndLine?: number;
}

export interface AskResult {
  answer: string;
  sources: string[];
  focusRef?: string;
  citations?: { path: string; startLine?: number; endLine?: number; focusRef?: string }[];
}

async function guideContext(args: AskArgs, report: AnalyzerReport, read: SourceReader): Promise<{ text?: string; refs: Set<string>; evidence: EvidenceExcerpt[] }> {
  const refs = new Set<string>();
  try {
    const file = args.draftJobId ? generationDraftPath(args.dataDir, args.project.id, args.draftJobId) : spacePath(args.dataDir, args.project.id);
    const { space } = JSON.parse(await fs.readFile(file, "utf8")) as { space: TSpaceDocument };
    for (const item of [...space.city.buildings, ...space.diagrams, ...space.flows]) refs.add(item.id);
    const readingPath = args.focusSourcePath?.replaceAll("\\", "/");
    const readingModule = readingPath && (report.docs.find(({ path }) => path === readingPath)?.module ?? report.modules
      .filter(({ name }) => readingPath.startsWith(`${name}/`) || (name === "(root)" && !readingPath.includes("/")))
      .sort((a, b) => b.name.length - a.name.length)[0]?.name);
    const readingBuilding = readingModule ? space.city.buildings.find(({ moduleRef }) => moduleRef === readingModule) : undefined;
    const readingDiagram = readingPath ? space.diagrams.find(({ source }) => source?.path === readingPath) : undefined;
    const ref = args.focusRef ?? readingDiagram?.id ?? readingBuilding?.id ??
      (!readingPath ? space.presentation?.start?.flow ?? space.presentation?.start?.building : undefined);
    const flow = space.flows.find((item) => item.id === ref);
    const diagram = space.diagrams.find((item) => item.id === ref);
    const building = space.city.buildings.find((item) => item.id === ref);
    const scenario = flow?.scenarios?.find((item) => item.id === args.scenarioId);
    const points = flow ? [...flow.path, ...(flow.branches ?? []).flatMap((branch) => branch.path)] : [];
    const matchingSteps = scenario?.steps.flatMap((id, index) => id === args.stepId ? [index] : []);
    const activeStepIndex = args.stepIndex === undefined
      ? matchingSteps?.length === 1 ? matchingSteps[0] : undefined
      : matchingSteps?.includes(args.stepIndex) ? args.stepIndex : undefined;
    const point = !scenario || activeStepIndex !== undefined ? points.find((item) => item.id && item.id === args.stepId) : undefined;
    const event = scenario?.events?.find((item) => item.stepIndex === activeStepIndex);
    const active = point && event ? { ...point, detail: event.detail ?? point.detail, state: event.state ?? point.state, source: event.source } : point;
    const targetSource = active?.source ?? (args.focusSourcePath && args.sourceStartLine
      ? { path: args.focusSourcePath, startLine: args.sourceStartLine, endLine: args.sourceEndLine }
      : flow?.source ?? diagram?.source ?? building?.source);
    const checked = targetSource ? await verifiedSourceRef(targetSource, read) : undefined;
    const related = flow ? relatedGuideScenarios(flow, args.question) : [];
    const anchors = checked ? [checked] : [];
    for (const index of [0, 1]) {
      for (const candidate of related) {
        const source = candidate.events[index]?.source;
        if (source) anchors.push(source);
      }
    }
    const owner = building ?? space.city.buildings.find((item) => flow?.scope === `module:${item.id}` || diagram?.owner === item.id)
      ?? readingBuilding;
    const linkedDiagrams = space.diagrams.filter((item) => item.id === diagram?.id || item.owner === owner?.id);
    anchors.push(...relatedGuideClaimSources(linkedDiagrams, args.question));
    const relevance = [args.focusTitle, active?.caption, active?.detail, scenario?.summary, flow?.title, diagram?.title].filter(Boolean).join(" ");
    const evidence = await collectGuideEvidence(report, args.question, relevance, owner?.moduleRef, anchors, read);
    const relatedScenarios = related.map((candidate) => ({ ...candidate, events: candidate.events.filter(({ source }) => guideEvidenceCovers(source, evidence)) }))
      .filter(({ events }) => events.length > 0);
    const trace = scenario ? { id: scenario.id, title: scenario.title, summary: scenario.summary, steps: scenario.steps } : undefined;
    const scene = flow ? { flow: flow.id, title: flow.title, active, activeStepIndex, scenario: trace, relatedScenarios, source: flow.source }
      : diagram ? { id: diagram.id, title: diagram.title, note: diagram.note, source: diagram.source }
        : building ?? { available: [...refs].slice(0, 20) };
    const readingScope = owner && isDocumentationOnly(report, owner.moduleRef) ? "Authored design scope" : undefined;
    return { text: JSON.stringify({ scene, readingScope, evidence }), refs, evidence };
  } catch {
    const evidence = await collectGuideEvidence(report, args.question, "", undefined, [], read);
    return { text: JSON.stringify({ evidence }), refs, evidence };
  }
}

/** Synchronous (awaited) guide Q&A — short agent run, no job row. */
export async function askGuide(args: AskArgs): Promise<AskResult> {
  if (isWorkspaceUnderMaintenance(args.project.id)) throw new AgentError("WORKSPACE_BUSY", "The workspace is being updated. Try again when maintenance finishes.");
  if (askingProjects.has(args.project.id)) {
    throw new AgentError("ASK_BUSY", "The guide is already answering a question for this project.");
  }
  askingProjects.add(args.project.id);
  try {
    const report = await getOrCreateAnalysis(args.dataDir, args.project);
    const agentCanReadFiles = args.agent !== "api" && process.env.KODYURD_WORKSPACE_DISCOVERY === "1";
    const read = createSourceReader(args.project.source_dir);
    const context = await guideContext(args, report, read);
    const prompt = buildAskPrompt({
      question: args.question,
      language: args.language,
      sourceDir: args.project.source_dir,
      analyzerSummary: summarizeForPrompt(report, 4000),
      agentCanReadFiles,
      focusTitle: args.focusTitle,
      focusSourcePath: args.focusSourcePath,
      sceneEvidence: context.text
    });
    const timeoutMs = Number(process.env.KODYURD_ASK_TIMEOUT_MS ?? 3 * 60_000);
    const raw = await runAgent(args.agent, {
      prompt,
      cwd: args.project.source_dir,
      packetOnly: !agentCanReadFiles,
      timeoutMs,
      dataDir: args.dataDir,
      model: args.model
    });
    const value = extractJsonObject(extractResultText(raw), "\"answer\"") as {
      answer?: unknown;
      sources?: unknown;
      focusRef?: unknown;
      citations?: unknown;
    };
    const answer = typeof value.answer === "string" ? value.answer.slice(0, 2000) : "";
    if (!answer) throw new AgentError("ASK_BAD_ANSWER", "The guide returned no usable answer.");
    const candidates = Array.isArray(value.sources) ? value.sources.filter((item): item is string => typeof item === "string").slice(0, 5) : [];
    const citations: NonNullable<AskResult["citations"]> = [];
    for (const item of (Array.isArray(value.citations) ? value.citations : []).slice(0, 5)) {
      if (!item || typeof item !== "object" || typeof item.path !== "string") continue;
      const startLine = item.startLine;
      const endLine = item.endLine;
      if (startLine !== undefined && (!Number.isInteger(startLine) || startLine < 1) || endLine !== undefined && (!Number.isInteger(endLine) || endLine < 1)) continue;
      const checked = await verifiedSourceRef({ path: item.path, startLine, endLine }, read);
      if (!checked) continue;
      if (!agentCanReadFiles && !guideEvidenceCovers(checked, context.evidence)) continue;
      citations.push({ ...checked, focusRef: typeof item.focusRef === "string" && context.refs.has(item.focusRef) ? item.focusRef : undefined });
    }
    const sources = [...new Set(citations.map((citation) => citation.path))];
    for (const candidate of agentCanReadFiles ? new Set(candidates.map((item) => item.replaceAll("\\", "/"))) : []) {
      if (!sources.includes(candidate) && sources.length < 5 && await resolveEvidencePath(args.project.source_dir, candidate)) sources.push(candidate);
    }
    const focusRef = typeof value.focusRef === "string" && context.refs.has(value.focusRef) ? value.focusRef : undefined;
    if (!sources.length) return { answer: "The guide could not verify a source for this answer. Try a question about a specific file or replay step.", sources: [] };
    return { answer, sources, focusRef, citations: citations.length ? citations : undefined };
  } finally {
    askingProjects.delete(args.project.id);
  }
}
