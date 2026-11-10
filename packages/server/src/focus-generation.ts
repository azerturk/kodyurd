import { createHash } from "node:crypto";
import { replayTargetIssue, type TSpaceDocument } from "@kodyurd/scene-schema";
import { AgentError, extractJsonObject, extractResultText, type AgentRunOptions } from "./agents.js";
import type { EvidenceExcerpt, SourceReader } from "./source-evidence.js";
import { acceptDiagramClaims, authoredDecisionQuotes, compactLessonEvidence, guideEvidenceCovers, requestedDecisionEvidence, verifiedSourceRef, type AuthoredDecisionQuote } from "./source-evidence.js";
import { BuildingPass, buildBuildingPrompt, focusedEvidenceRows, normalizeBuildingPass, type BuildingPromptInput, type TBuildingPass } from "./space-pipeline.js";
import type { SceneReference } from "./scene-reference.js";

export const focusKinds = ["map", "scenario", "sequence", "state", "matrix"] as const;
export type FocusKind = typeof focusKinds[number];
export type FocusDeliverableId = `focus-${FocusKind}` | `lesson-${string}-${FocusKind}`;

export interface FocusDeliverable {
  id: FocusDeliverableId;
  kind: FocusKind;
  title: string;
  state: "pending" | "running" | "ready" | "failed" | "timed-out";
  error?: string;
  reference?: string;
}

export const focusId = (kind: FocusKind): FocusDeliverableId => `focus-${kind}`;

const deliverableTitle: Record<FocusKind, string> = {
  map: "Component map", scenario: "Playable scenario", sequence: "Sequence diagram", state: "State machine", matrix: "Decision table"
};

export function newFocusDeliverables(brief = "", documentationOnly = false, companion?: { moduleRef: string; title: string }): FocusDeliverable[] {
  const requested: FocusKind[] = documentationOnly || wantsDiagramLesson(brief) ? ["map"] : ["map", "scenario"];
  const text = brief.normalize("NFKC").toLowerCase();
  if (/\b(?:sequence diagrams?|message sequences?|call sequences?|interaction diagrams?)\b|ardıcıllı|secuencia|последовательност/.test(text)) requested.push("sequence");
  if (/\b(?:state (?:machines?|diagrams?)|(?:status|lifecycle) diagrams?)\b|status diaqram|vəziyyət (?:maşın|diaqram)|máquina de estados|машин[ауы] состояни/.test(text)) requested.push("state");
  if (/\b(?:decision (?:tables?|matri(?:x|ces))|(?:condition|rule) tables?)\b|qərar cədvəl|tabla de decisi|таблиц[ауы] решени/.test(text)) requested.push("matrix");
  const scope = companion && createHash("sha256").update(companion.moduleRef).digest("hex").slice(0, 12);
  return requested.map((kind) => ({
    id: scope ? `lesson-${scope}-${kind}` : focusId(kind), kind,
    title: companion ? `${companion.title} · ${deliverableTitle[kind]}` : deliverableTitle[kind], state: "pending"
  }));
}

/** A diagram lesson can be complete with independently explorable architecture. */
function wantsDiagramLesson(brief: string): boolean {
  const text = brief.normalize("NFKC").toLowerCase();
  return /\b(?:architecture only|diagrams? only|only (?:the )?(?:architecture|diagrams?)|without (?:a )?replay|no replay)\b|yalnız arxitektura|replay olmadan|replaysiz/u.test(text);
}

type Flow = TSpaceDocument["flows"][number];

/** The same path can demonstrate a distinct case when its occurrence state differs. */
function distinctScenarios(flow: Flow): number {
  const points = new Map([...flow.path, ...(flow.branches ?? []).flatMap(({ path }) => path)].map((point) => [point.id, point]));
  const normalizeState = (state: NonNullable<Flow["path"][number]["state"]>) => [...state]
    .sort((a, b) => a.key.localeCompare(b.key) || a.value.localeCompare(b.value));
  return new Set((flow.scenarios ?? []).map(({ steps, events }) => {
    const states = new Map((events ?? []).map(({ stepIndex, state }) => [stepIndex, state]));
    return JSON.stringify(steps.map((id, index) => [id, normalizeState(states.get(index) ?? points.get(id)?.state ?? [])]));
  })).size;
}

function missingScenarioTransitions(flow: Flow): number {
  const transition = (from: string, to: string): string => `${from}\u0000${to}`;
  const visited = new Set((flow.scenarios ?? []).flatMap(({ steps }) =>
    steps.slice(1).map((to, index) => transition(steps[index], to))));
  const required = new Set<string>();
  let unresolved = 0;
  const add = (from?: string, to?: string) => {
    if (from && to) required.add(transition(from, to));
    else unresolved++;
  };
  const addPath = (path: Flow["path"]) => path.slice(1).forEach(({ id }, index) => add(path[index].id, id));
  addPath(flow.path);
  for (const branch of flow.branches ?? []) {
    add(branch.from ?? flow.path[branch.at]?.id, branch.path[0]?.id);
    addPath(branch.path);
    if (branch.join) add(branch.path.at(-1)?.id, branch.join);
  }
  return unresolved + [...required].filter((edge) => !visited.has(edge)).length;
}

export function sourcedScenario(flow: Flow): boolean {
  if (!flow.scenarios?.length || missingScenarioTransitions(flow)) return false;
  const branches = flow.branches ?? [];
  const points = new Map([...flow.path, ...branches.flatMap((branch) => branch.path)].map((point) => [point.id, point]));
  const ends = new Set([flow.path.at(-1)?.id, ...branches.filter((branch) => !branch.join).map((branch) => branch.path.at(-1)?.id)]);
  if (branches.length && distinctScenarios(flow) < 2) return false;
  return flow.scenarios.every((scenario) => ends.has(scenario.steps.at(-1)) && scenario.steps.every((step) => points.get(step)?.source?.startLine !== undefined));
}

/** Count only an explicit, bounded request in the brief, not inferred domain words. */
export function requestedScenarioMinimum(brief: string): number {
  const counts = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 } as const;
  const matches = brief.normalize("NFKC").toLowerCase()
    .matchAll(/\b(?:(?:show|include|create|generate|provide|compare|want|need)\s+(?:at least\s+)?|at least\s+)([2-8]|two|three|four|five|six|seven|eight)\s+(?:(?:distinct|named|playable|alternative|replay)\s+){0,3}(?:scenarios|traces)\b/g);
  return Math.max(1, ...[...matches].map((match) => counts[match[1] as keyof typeof counts] ?? Number(match[1])));
}

const outcomePatterns = {
  success: /\b(?:success(?:ful|fully)?|happy path|confirmed|delivered|accepted|completed|saved|returned 2\d\d|2\d\d)\b/i,
  conflict: /\b(?:conflicts?|overlap(?:ping)?|duplicate|409)\b/i,
  denial: /\b(?:denied|denial|forbidden|unauthori[sz]ed|permission rejected|401|403)\b/i,
  retry: /\b(?:retr(?:y|ies)(?:[_ -]?(?:scheduled|wait|due|pending))|schedul(?:e|ed|es|ing) (?:a |the )?retr(?:y|ies)|requeue(?:d|s)?|backoff)\b/i
} as const;
type ScenarioOutcome = keyof typeof outcomePatterns | "retry-recovery";

/** Recognize explicit replay requests without making ordinary explanations require artificial branches. */
export function requestedScenarioOutcomes(brief: string): ScenarioOutcome[] {
  const clauses = brief.split(/[.!?\n]+/).filter((clause) =>
    /\b(?:compare|replay|trace|simulate|walk through|demonstrate|(?:show|include).*(?:scenario|path|outcome|then))\b/i.test(clause));
  const results = new Set<ScenarioOutcome>();
  for (const clause of clauses) {
    for (const kind of ["success", "conflict", "denial"] as const) {
      if (outcomePatterns[kind].test(clause)) results.add(kind);
    }
    if (/\bretr(?:y|ies|ied)\b/i.test(clause)) results.add(
      /\bretr(?:y|ies|ied)\b.{0,45}\b(?:then|before)\b.{0,55}\b(?:deliver\w*|recover\w*|succeed\w*|complete\w*)\b/i.test(clause) ? "retry-recovery" : "retry"
    );
  }
  return [...results];
}

function scenarioActions(flow: Flow) {
  const points = new Map([...flow.path, ...(flow.branches ?? []).flatMap(({ path }) => path)].map((point) => [point.id, point]));
  return (flow.scenarios ?? []).map((scenario) => {
    const events = new Map((scenario.events ?? []).map((event) => [event.stepIndex, event]));
    return scenario.steps.map((id, stepIndex) => {
      const point = points.get(id);
      const event = events.get(stepIndex);
      const state = event?.state ?? point?.state ?? [];
      const text = [id, point?.caption, event?.detail ?? point?.detail, ...state.flatMap(({ key, value }) => [key, value])].filter(Boolean).join(" ");
      return { text, source: event?.source ?? point?.source };
    });
  });
}

function missingScenarioOutcomes(flow: Flow, brief: string): ScenarioOutcome[] {
  const actions = scenarioActions(flow);
  const evidenced = new Set<ScenarioOutcome>();
  for (const path of actions) {
    const final = path.at(-1)?.text ?? "";
    const retry = path.some(({ text }) => outcomePatterns.retry.test(text));
    if (retry) {
      evidenced.add("retry");
      if (outcomePatterns.success.test(final) && path.slice(0, -1).some(({ text }) => outcomePatterns.retry.test(text))) evidenced.add("retry-recovery");
    } else {
      for (const kind of ["conflict", "denial", "success"] as const) {
        if (outcomePatterns[kind].test(final)) {
          evidenced.add(kind);
          break;
        }
      }
    }
  }
  return requestedScenarioOutcomes(brief).filter((outcome) => !evidenced.has(outcome));
}

function expectsExplanation(brief: string): boolean {
  return /\bexplain (?:view|claims)\b|\bexplain\b[^.!?\n]{0,180}\b(?:rules?|invariants?|rationale|design decisions?)\b/i.test(brief);
}

export function focusIssues(pass: Pick<TBuildingPass, "flows" | "diagrams">, building: string, brief = "", documentationOnly = false): string[] {
  const minimum = requestedScenarioMinimum(brief);
  const flow = pass.flows.find((item) => item.scope === `module:${building}` && sourcedScenario(item) && distinctScenarios(item) >= minimum);
  const missing = flow ? missingScenarioOutcomes(flow, brief) : [];
  const map = pass.diagrams.find((item) => (item.owner === building || item.owner.startsWith(`${building}:`)) && item.kind === "graph" && item.edges.length > 0 &&
    [...item.nodes, ...item.edges].every((element) => element.source?.startLine !== undefined));
  const needsClaims = map && expectsExplanation(brief) && !map.claims?.some(({ kind }) =>
    kind === "guard" || kind === "invariant" || kind === "decision" || kind === "disagreement");
  const scenarioIssue = documentationOnly || wantsDiagramLesson(brief) ? undefined : !flow
    ? minimum > 1 ? `The brief requires ${minimum} distinct sourced scenario traces.` : "A complete sourced scenario is pending."
    : missing.length ? `The scenario is missing played outcomes requested in the brief: ${missing.join(", ")}.` : undefined;
  return [...(!map ? ["A sourced component map is pending."] : []), ...(needsClaims ? ["The component map needs a verified rule or design claim for the brief."] : []),
    ...(scenarioIssue ? [scenarioIssue] : [])];
}

export async function passSourceHash(pass: TBuildingPass, read: SourceReader): Promise<string | undefined> {
  const points = pass.flows.flatMap((flow) => [flow, ...flow.path, ...(flow.branches ?? []).flatMap((branch) => branch.path),
    ...(flow.scenarios ?? []).flatMap((scenario) => scenario.events ?? [])]);
  const diagrams = pass.diagrams.flatMap((diagram) => [diagram, ...diagram.nodes, ...diagram.edges]);
  const items = [...points, ...diagrams, ...pass.tour, ...pass.questions, ...(pass.interior?.floors ?? [])];
  const claimPaths = pass.diagrams.flatMap((diagram) => (diagram.claims ?? []).flatMap((claim) => claim.evidence.map(({ path }) => path)));
  const paths = [...new Set([...items.flatMap((item) => item.source ? [item.source.path] : []), ...claimPaths].map((path) => path.replaceAll("\\", "/")))].sort();
  if (paths.length > 96) return undefined;
  const hash = createHash("sha256");
  for (const file of paths) {
    const lines = await read(file);
    if (!lines) return undefined;
    hash.update(JSON.stringify([file, lines.join("\n")]));
  }
  return hash.digest("hex");
}

async function acceptFocusPass(
  pass: TBuildingPass, kind: FocusKind, building: string, moduleRef: string, brief: string, read: SourceReader,
  shown: EvidenceExcerpt[], evidenceOnly: boolean, documentationOnly: boolean, companionLesson: boolean
): Promise<TBuildingPass> {
  const normalized = { ...pass, interior: undefined, coverage: [], tour: [], searchIndex: [] };
  const scope = `module:${building}`;
  normalized.flows = kind === "scenario" ? pass.flows.filter((flow) => flow.scope === scope).slice(0, 1) : [];
  const matchesKind = (diagram: TBuildingPass["diagrams"][number]): boolean =>
    kind === "map" ? diagram.kind === "graph" : kind === "scenario" ? diagram.kind === "state" || diagram.kind === "sequence" : diagram.kind === kind;
  normalized.diagrams = pass.diagrams.filter((diagram) => diagram.owner === building && matchesKind(diagram)).slice(0, 1);
  const points = normalized.flows.flatMap((flow) => [flow, ...flow.path, ...(flow.branches ?? []).flatMap((branch) => branch.path)]);
  const diagrams = normalized.diagrams.flatMap((diagram) => [diagram, ...diagram.nodes, ...diagram.edges]);
  let omitted = 0;
  const verify = async (source: NonNullable<Flow["source"]>) => {
    const checked = await verifiedSourceRef(source, read);
    if (checked && evidenceOnly && !guideEvidenceCovers(checked, shown)) {
      omitted++;
      return null;
    }
    return checked;
  };
  for (const item of [...points, ...diagrams]) {
    if (item.source) item.source = await verify(item.source) ?? undefined;
  }
  for (const diagram of normalized.diagrams) {
    if (documentationOnly && diagram.origin !== "mermaid") diagram.origin = "docs";
    diagram.claims = await acceptDiagramClaims(diagram.claims, shown, read);
  }
  const decisionEvidence = kind === "map" ? requestedDecisionEvidence(brief, shown, documentationOnly && companionLesson) : [];
  if (decisionEvidence.length && !normalized.diagrams[0]?.claims?.some((claim) => claim.kind === "decision" &&
    claim.evidence.some((source) => source.kind === "docs" && guideEvidenceCovers(source, decisionEvidence)))) {
    throw new AgentError("DELIVERABLE_INCOMPLETE", "The brief asks why. Quote the relevant authored Decision or Rationale sentence with its exact shown lines.");
  }
  let invalidEvents = 0;
  for (const flow of normalized.flows) for (const scenario of flow.scenarios ?? []) {
    if (!scenario.events) continue;
    const verified: typeof scenario.events = [];
    for (const event of scenario.events) {
      const source = await verify(event.source);
      if (source?.startLine) verified.push({ ...event, source: { ...source, startLine: source.startLine } });
      else invalidEvents++;
    }
    scenario.events = verified;
  }
  normalized.questions = [];
  if (kind === "scenario") {
    const flow = normalized.flows[0];
    for (const question of pass.questions) {
      if (question.replay && (!flow || question.replay.flow !== flow.id || replayTargetIssue(flow, question.replay))) continue;
      const source = await verify(question.source);
      if (source?.startLine && (!question.building || question.building === building)) normalized.questions.push({ ...question, building, source: { ...source, startLine: source.startLine } });
    }
  }
  const packetNote = omitted ? " Cite only exact ranges shown in the numbered evidence packet." : "";
  if (kind !== "map" && kind !== "scenario") {
    const diagram = normalized.diagrams[0];
    if (!diagram?.edges.length || [...diagram.nodes, ...diagram.edges].some((item) => !item.source?.startLine)) {
      throw new AgentError("DELIVERABLE_INCOMPLETE", `${deliverableTitle[kind]} needs its own scoped diagram with sourced nodes and relationships.${packetNote}`);
    }
  }
  const problems = focusIssues(normalized, building, brief, documentationOnly);
  const expected = kind === "map" ? problems.find((problem) => problem.includes("map"))
    : kind === "scenario" ? problems.find((problem) => problem.includes("scenario")) : undefined;
  if (expected || invalidEvents) {
    if (kind === "map") {
      const map = normalized.diagrams[0];
      if (expected?.includes("verified rule")) {
        throw new AgentError("DELIVERABLE_INCOMPLETE", "The component map needs a verified rule or design claim for the brief. Use an identified node or edge and exact packet evidence. Quote any authored rationale exactly.");
      }
      throw new AgentError("DELIVERABLE_INCOMPLETE", `Component map counts (parsed diagrams ${pass.diagrams.length}, scoped graphs ${normalized.diagrams.length}, nodes ${map?.nodes.length ?? 0}, edges ${map?.edges.length ?? 0}). Missing or invalid exact source ranges (nodes ${map?.nodes.filter((node) => !node.source?.startLine).length ?? 0}, edges ${map?.edges.filter((edge) => !edge.source?.startLine).length ?? 0}).${packetNote}`);
    }
    const flow = normalized.flows[0];
    const steps = [...(flow?.path ?? []), ...(flow?.branches ?? []).flatMap((branch) => branch.path)];
    const distinct = flow ? distinctScenarios(flow) : 0;
    const missing = flow ? missingScenarioTransitions(flow) : 0;
    throw new AgentError("DELIVERABLE_INCOMPLETE", `${expected ?? "Scenario occurrence evidence is incomplete."}${packetNote} Found ${distinct} distinct traces, ${missing} unplayed transitions, ${steps.filter((step) => !step.source?.startLine).length} unsourced steps and ${invalidEvents} unsourced occurrence events.`);
  }
  const playback = normalized.flows[0];
  if (kind === "scenario" && playback && requestedScenarioOutcomes(brief).some((outcome) => outcome === "retry" || outcome === "retry-recovery")) {
    const retrySources = scenarioActions(playback).flatMap((actions) => actions.flatMap(({ text, source }) =>
      source?.startLine && outcomePatterns.retry.test(text) ? [source] : []));
    let verifiedRetry = false;
    for (const source of retrySources) {
      const lines = await read(source.path);
      const text = lines?.slice(source.startLine! - 1, source.endLine ?? source.startLine).join("\n") ?? "";
      if (/\b(?:retr(?:y|ies|ied)|backoff|requeue\w*|dueAt\w*|nextAttempt\w*)\b/i.test(text)) { verifiedRetry = true; break; }
    }
    if (!verifiedRetry) throw new AgentError("DELIVERABLE_INCOMPLETE", "A requested retry needs its scheduled state or delay assertion from an exact source span, before any successful delivery.");
  }
  const key = createHash("sha256").update(moduleRef).digest("hex").slice(0, 16);
  const flow = normalized.flows[0];
  if (flow) {
    const original = flow.id;
    flow.id = `kc-flow-${key}`;
    for (const question of normalized.questions) {
      if (question.replay?.flow === original) question.replay.flow = flow.id;
    }
  }
  const diagram = normalized.diagrams[0];
  if (diagram) {
    if (kind === "scenario" && [...diagram.nodes, ...diagram.edges].some((item) => !item.source?.startLine)) normalized.diagrams = [];
    else diagram.id = `kc-${kind}-${key}`;
  }
  return normalized;
}

interface FocusGenerationOptions {
  kind: FocusKind;
  prompt: BuildingPromptInput;
  evidence: { docs: EvidenceExcerpt[]; code: EvidenceExcerpt[] };
  read: SourceReader;
  reference?: SceneReference;
  run: (prompt: string, options: Pick<AgentRunOptions, "reference" | "packetOnly" | "maxTokens">, narrow: boolean) => Promise<string>;
  onRetry: (reason: string) => void;
}

/** Expand an explicit agent-selected quote before the normalizer validates the graph target. */
function bindDecisionQuotes(diagrams: unknown, quotes: AuthoredDecisionQuote[]): void {
  if (!quotes.length || !Array.isArray(diagrams)) return;
  for (const diagram of diagrams.slice(0, 24)) {
    if (!diagram || typeof diagram !== "object" || !Array.isArray(diagram.claims)) continue;
    for (const claim of diagram.claims.slice(0, 48)) {
      if (!claim || typeof claim !== "object" || claim.kind !== "decision") continue;
      const quote = quotes.find(({ id }) => id === claim.quoteId);
      if (quote) Object.assign(claim, { text: quote.text, evidence: [quote.evidence] });
    }
  }
}

export async function runFocusDeliverable(options: FocusGenerationOptions): Promise<TBuildingPass> {
  const maxTokens = options.kind === "scenario" ? 12_288 : options.kind === "map" ? 4_096 : 8_192;
  let issue: string | undefined;
  let last: unknown;
  for (const narrow of [false, true]) {
    const packet = compactLessonEvidence(options.evidence, options.kind, narrow);
    const prompt = await buildBuildingPrompt({ ...options.prompt, docs: packet.docs, codeSignals: packet.code,
      deliverable: options.kind, narrower: narrow, repairIssue: issue, scenarioMinimum: requestedScenarioMinimum(options.prompt.brief),
      scenarioOutcomes: requestedScenarioOutcomes(options.prompt.brief) });
    try {
      const raw = await options.run(prompt, { reference: narrow ? undefined : options.reference, packetOnly: narrow, maxTokens }, narrow);
      const field = options.kind === "scenario" ? "flows" : "diagrams";
      const data = extractJsonObject(extractResultText(raw), JSON.stringify(field));
      if (!data || typeof data !== "object" || !Array.isArray((data as Record<string, unknown>)[field])) {
        throw new AgentError("DELIVERABLE_INVALID", `Response needs a top-level ${field} array in a complete JSON object.`);
      }
      const shown = [...focusedEvidenceRows(packet.docs), ...focusedEvidenceRows(packet.code)];
      if (options.kind === "map") bindDecisionQuotes((data as Record<string, unknown>).diagrams,
        authoredDecisionQuotes(options.prompt.brief, shown, Boolean(options.prompt.documentationOnly && options.prompt.companionLesson)));
      const parsed = BuildingPass.safeParse(normalizeBuildingPass(data));
      if (!parsed.success) {
        const allowed = new Set(["diagrams", "flows", "questions", "path", "branches", "scenarios", "steps", "events",
          "stepIndex", "source", "from", "to", "join", "id", "nodes", "edges", "replay"]);
        const details = parsed.error.issues.slice(0, 5).map((issue) => {
          const location = issue.path.filter((part) => typeof part === "number" || allowed.has(String(part))).join(".");
          return `${location || "output"} (${issue.code})`;
        });
        throw new AgentError("DELIVERABLE_INVALID", `Response schema rejected ${details.join(", ")}.`);
      }
      return await acceptFocusPass(parsed.data, options.kind, options.prompt.building.id, options.prompt.building.moduleRef, options.prompt.brief,
        options.read, shown, Boolean(narrow || options.prompt.evidenceOnly), Boolean(options.prompt.documentationOnly), Boolean(options.prompt.companionLesson));
    } catch (error) {
      last = error;
      if (!(error instanceof AgentError) || !["AGENT_TIMEOUT", "AGENT_NO_JSON", "AGENT_IMAGE_UNSUPPORTED", "AGENT_OUTPUT_LIMIT", "DELIVERABLE_INVALID", "DELIVERABLE_INCOMPLETE"].includes(error.code)) throw error;
      if (!narrow) {
        issue = error.message;
        options.onRetry(`${error.code} · ${error.message.slice(0, 260)}`);
      }
    }
  }
  throw last;
}

export function mergeFocusPasses(building: TSpaceDocument["city"]["buildings"][number], parts: TBuildingPass[]): TBuildingPass {
  const pass = BuildingPass.parse({});
  for (const item of parts) {
    pass.flows.push(...item.flows);
    pass.diagrams.push(...item.diagrams);
    for (const question of item.questions) {
      const stepIndex = question.replay?.stepIndex;
      if (stepIndex === undefined) pass.questions.push(question);
      else {
        const internalIndex = new RegExp(`\\bstepIndex\\s*(?:[:=]\\s*)?${stepIndex}\\b`, "gi");
        const visibleIndex = `#${stepIndex + 1}`;
        pass.questions.push({ ...question, title: question.title?.replace(internalIndex, visibleIndex),
          prompt: question.prompt.replace(internalIndex, visibleIndex), explanation: question.explanation.replace(internalIndex, visibleIndex) });
      }
    }
  }
  const primaryMap = pass.diagrams.find((diagram) => diagram.kind === "graph");
  const components = primaryMap?.nodes.slice(0, 8).map(({ label, icon }) => ({ label, icon })) ?? [];
  for (const kind of ["sequence", "state", "matrix"] as const) {
    const candidates = pass.diagrams.filter((diagram) => diagram.kind === kind);
    const diagram = candidates.find((item) => item.id.startsWith(`kc-${kind}-`)) ?? candidates[0];
    if (!diagram) continue;
    const source = [diagram, ...diagram.nodes, ...diagram.edges].find((item) => item.source?.startLine !== undefined)?.source;
    if (source) pass.tour.push({ ref: diagram.id, narration: diagram.note || diagram.title, source });
  }
  const authored = pass.questions.length;
  const orderSignature = (labels: string[]): string => JSON.stringify(labels.map((label) => label.trim().normalize("NFKC").toLowerCase()));
  const sequences = new Set(pass.questions.filter((question) => question.kind === "order").map((question) =>
    orderSignature(question.answer.map((id) => question.options.find((option) => option.id === id)?.label ?? id))));
  for (const flow of pass.flows.filter(sourcedScenario)) {
    const points = new Map([...flow.path, ...(flow.branches ?? []).flatMap((branch) => branch.path)].map((point) => [point.id, point]));
    for (const scenario of flow.scenarios ?? []) {
      if (pass.questions.length >= Math.min(8, authored + 2)) break;
      const events = new Map((scenario.events ?? []).map((event) => [event.stepIndex, event]));
      const steps: { id: string; label: string; stepIndex: number; source: TBuildingPass["questions"][number]["source"] }[] = [];
      const seen = new Set<string>();
      for (const [stepIndex, id] of scenario.steps.entries()) {
        const point = points.get(id);
        const label = point?.caption?.trim().slice(0, 120);
        const source = events.get(stepIndex)?.source ?? point?.source;
        if (!label || !source?.startLine) continue;
        const key = orderSignature([label]);
        if (seen.has(key) || steps.some((item) => item.id === id)) continue;
        seen.add(key);
        steps.push({ id, label, stepIndex, source });
      }
      const selected = steps.length > 5 ? [...steps.slice(0, 3), ...steps.slice(-2)] : steps;
      const signature = orderSignature(selected.map(({ label }) => label));
      if (selected.length < 2 || sequences.has(signature)) continue;
      const answer = selected.map(({ id }) => id);
      const id = `kc-order-${createHash("sha256").update(JSON.stringify([flow.id, answer])).digest("hex").slice(0, 18)}`;
      if (pass.questions.some((question) => question.id === id)) continue;
      sequences.add(signature);
      pass.questions.push({
        id, title: scenario.title.slice(0, 80), kind: "order",
        prompt: `${flow.title} · ${scenario.title}`.slice(0, 280),
        options: selected.map(({ id, label }) => ({ id, label })), answer,
        explanation: selected.map(({ label }) => label).join(" → ").slice(0, 480),
        source: selected.at(-1)!.source, building: building.id,
        replay: { flow: flow.id, scenario: scenario.id, step: selected[0].id, stepIndex: selected[0].stepIndex }
      });
    }
  }
  if (parts.length) pass.interior = {
    building: building.id,
    lobby: { summary: building.summary, catalogRefs: pass.flows.map((flow) => flow.id), coverageRefs: [] },
    floors: [{ id: "focus-lesson", title: primaryMap?.title.slice(0, 80) ?? building.title, components,
      diagrams: pass.diagrams.map((diagram) => diagram.id), corridors: pass.flows.map((flow) => flow.id), source: primaryMap?.source ?? primaryMap?.nodes[0]?.source }]
  };
  return pass;
}
