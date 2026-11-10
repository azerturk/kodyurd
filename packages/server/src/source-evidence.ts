import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createWorkspaceIgnoreCheck, isPrivateWorkspaceFile, type AnalyzerReport, type DocInfo, type DocSection, type ModuleSummary } from "./analyzer.js";
import type { TClaimEvidence, TDiagramClaim, TSpaceDocument } from "@kodyurd/scene-schema";
import type { FocusKind } from "./focus-generation.js";

const MAX_SOURCE_BYTES = 1024 * 1024;

function allowedEvidencePath(relative: string): boolean {
  return Boolean(relative) && relative.length <= 500 && !path.isAbsolute(relative) && !path.win32.isAbsolute(relative) &&
    !relative.split(/[\\/]/).some((part) => !part || part.startsWith(".") || /[:\u0000-\u001f]/.test(part)) &&
    !isPrivateWorkspaceFile(relative);
}

/** Resolve a project-relative evidence path, using the same link policy as the scan. */
export async function resolveEvidencePath(
  sourceDir: string, relative: string, isIgnored = createWorkspaceIgnoreCheck(sourceDir)
): Promise<string | null> {
  if (!allowedEvidencePath(relative)) return null;
  const parts = relative.split(/[\\/]/);
  try {
    const root = await fs.realpath(sourceDir);
    const requested = path.join(root, ...parts);
    const file = await fs.realpath(requested);
    if (path.relative(requested, file) !== "" || !allowedEvidencePath(path.relative(root, file)) || await isIgnored(parts.join("/"))) return null;
    return file;
  } catch {
    return null;
  }
}

export type SourceReader = (relative: string) => Promise<string[] | null>;

export function createSourceReader(sourceDir: string): SourceReader {
  const cache = new Map<string, Promise<string[] | null>>();
  const isIgnored = createWorkspaceIgnoreCheck(sourceDir);
  const read = async (relative: string): Promise<string[] | null> => {
    const file = await resolveEvidencePath(sourceDir, relative, isIgnored);
    if (!file) return null;
    try {
      const stat = await fs.stat(file);
      if (!stat.isFile() || stat.size > MAX_SOURCE_BYTES) return null;
      const text = await fs.readFile(file, "utf8");
      return text.includes("\u0000") ? null : text.split(/\r?\n/);
    } catch {
      return null;
    }
  };
  return (relative) => {
    const key = relative.replaceAll("\\", "/");
    const previous = cache.get(key);
    if (previous) return previous;
    const pending = read(key);
    if (cache.size >= 128) cache.delete(cache.keys().next().value!);
    cache.set(key, pending);
    return pending;
  };
}

export interface EvidenceExcerpt {
  path: string;
  title?: string;
  kind: DocSection["kind"] | "code";
  startLine: number;
  endLine: number;
  text: string;
  id?: string;
}

const documentationExtension = /^(?:\.(?:md|mdx|rst|adoc|txt|json|ya?ml|toml|svg|png|jpe?g|webp|gif|pdf)|\(none\))$/i;

function ownsFile(report: AnalyzerReport, moduleRef: string, file: string): boolean {
  if (!file.includes("/")) return moduleRef === "(root)";
  return file.startsWith(`${moduleRef}/`) &&
    !report.modules.some(({ name }) => name !== moduleRef && name.startsWith(`${moduleRef}/`) && file.startsWith(`${name}/`));
}

export function isDocumentationOnly(report: AnalyzerReport, moduleRef?: string): boolean {
  if (!report.docs.length || report.truncated) return false;
  if (Object.entries(report.languages).every(([extension, info]) => info.files === 0 || documentationExtension.test(extension))) return true;
  if (!moduleRef) return false;
  const module = report.modules.find(({ name }) => name === moduleRef);
  const docs = report.docs.filter(({ path }) => ownsFile(report, moduleRef, path));
  if (!module || !docs.length) return false;
  const observed = new Set([...docs.map(({ path }) => path), ...module.topFiles.map(({ path }) => path), ...(module.entryFiles ?? []), ...(module.testFiles ?? [])]);
  // In a mixed repo, require the scan to account for every file in the module.
  return observed.size === module.files && [...observed].every((file) => documentationExtension.test(path.posix.extname(file) || "(none)"));
}

function termsOf(value: string): string[] {
  const compact = value.normalize("NFKC").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()
    .replace(/\btwo[ -]factor(?:[ -](?:auth|authentication))?\b/g, "$& 2fa");
  return [...new Set(compact.split(/[^\p{L}\p{N}]+/u).filter((part) => part.length >= 3))];
}

function matchScore(text: string, terms: string[]): number {
  const words = new Set(termsOf(text));
  return terms.filter((term) => words.has(term)).length;
}

const singularTerm = (word: string): string =>
  word.length > 4 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word;

function sourceCandidates(module?: ModuleSummary): string[] {
  return [...new Set([...(module?.entryFiles ?? []), ...(module?.sourceFiles ?? []),
    ...(module?.topFiles.map(({ path }) => path) ?? [])])];
}

function focusedSourceLine(lines: string[], terms: string[], openingLine: number): number {
  if (terms.length < 2) return openingLine;
  let best = openingLine;
  let score = 1;
  for (let index = 0; index < Math.min(lines.length, 12_000); index++) {
    const match = matchScore(lines[index].slice(0, 360), terms);
    if (match <= score) continue;
    score = match;
    best = index + 1;
  }
  return best >= openingLine + 100 ? Math.max(1, best - 12) : openingLine;
}

function makeExcerpt(path: string, lines: string[], section: DocSection | (Omit<DocSection, "kind"> & { kind: "code" }), maxChars = 8_000): EvidenceExcerpt | null {
  const selected: string[] = [];
  let length = 0;
  for (const line of lines.slice(section.startLine - 1, Math.min(section.endLine, section.startLine + 139))) {
    if (length + line.length > maxChars) break;
    selected.push(line);
    length += line.length + 1;
  }
  if (selected.length === 0) return null;
  const text = selected.join("\n");
  const endLine = section.startLine + selected.length - 1;
  const id = createHash("sha256").update(JSON.stringify([path, section.startLine, endLine, text])).digest("hex").slice(0, 16);
  return { ...section, path, endLine, text, id };
}

export async function collectBuildingEvidence(
  report: AnalyzerReport,
  moduleRef: string,
  brief: string,
  focused: boolean,
  read: SourceReader,
  scoped = false
): Promise<{ docs: EvidenceExcerpt[]; code: EvidenceExcerpt[] }> {
  const explicitTopics = Array.from(brief.matchAll(/\(([^()]{2,160})\)/g), (match) => match[1]);
  const terms = termsOf(explicitTopics.length > 0 ? explicitTopics.join(" ") : brief);
  const workspaceDesign = isDocumentationOnly(report);
  const designOnly = isDocumentationOnly(report, moduleRef);
  const weights = { section: 2, mermaid: 8, table: 3, decisions: 4, ascii: 3 };
  const score = (doc: DocInfo): number => {
    if ((scoped || designOnly && !workspaceDesign) && !ownsFile(report, moduleRef, doc.path)) return 0;
    const linked = doc.module === moduleRef ? 7 : doc.matches.includes(moduleRef) ? 4 : 0;
    const named = matchScore(doc.path, terms) * 2 + matchScore(doc.title ?? "", terms);
    const sectionMatch = Math.max(0, ...(doc.sections ?? []).map((section) => matchScore(section.title ?? "", terms)));
    if (!linked && !designOnly && (!focused || named < 1 && sectionMatch < 2)) return 0;
    const guidePenalty = /(?:^|\/)(?:AGENTS|CLAUDE)\.md$/i.test(doc.path) ? 12 : 0;
    const canonical = /(?:^|\/)(?:main|architecture)\//i.test(doc.path) ? 4 : 0;
    return linked + named * 5 + sectionMatch * 4 + Math.min(5, doc.blocks.mermaid * 2) + canonical - guidePenalty + (designOnly ? 2 : 0);
  };
  const docs = report.docs.map((doc) => ({ doc, score: score(doc) }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.doc.path.localeCompare(b.doc.path));
  const sections = docs.slice(0, focused ? 14 : 6).flatMap(({ doc, score }) =>
    (doc.sections ?? [{ kind: "section" as const, startLine: 1, endLine: 100, title: doc.title }]).map((section) => {
      const decisionDoc = /(?:^|[/_-])(?:adr|decisions?)(?:[-_/0-9]|\.)/i.test(doc.path) || /^ADR\b/i.test(doc.title ?? "");
      const authoredRationale = decisionDoc && /^(?:context|decision|rationale|trade[- ]?offs?)\b/i.test(section.title ?? "");
      return { path: doc.path, section, score: score + weights[section.kind] + matchScore(section.title ?? "", terms) * 12 +
        (authoredRationale ? /^context\b/i.test(section.title ?? "") ? 14 : 28 : 0) };
    })
  ).sort((a, b) => b.score - a.score || a.section.startLine - b.section.startLine);
  const snippets: EvidenceExcerpt[] = [];
  const byPath = new Map<string, number>();
  let docChars = 0;
  for (const candidate of sections) {
    if (snippets.length >= (focused ? 20 : 8)) break;
    const seen = byPath.get(candidate.path) ?? 0;
    if (seen >= (focused ? 5 : 3)) continue;
    const lines = await read(candidate.path);
    if (!lines) continue;
    const excerpt = makeExcerpt(candidate.path, lines, candidate.section);
    if (!excerpt || docChars + excerpt.text.length > (focused ? 62_000 : 24_000)) continue;
    if (snippets.some((existing) => {
      if (existing.path !== excerpt.path) return false;
      const overlap = Math.min(existing.endLine, excerpt.endLine) - Math.max(existing.startLine, excerpt.startLine) + 1;
      return overlap >= (excerpt.endLine - excerpt.startLine + 1) * 0.8;
    })) continue;
    snippets.push(excerpt);
    docChars += excerpt.text.length;
    byPath.set(candidate.path, seen + 1);
  }

  const mod = report.modules.find((module) => module.name === moduleRef);
  const files = designOnly ? [] : sourceCandidates(mod);
  const code: EvidenceExcerpt[] = [];
  const entries = new Set(mod?.entryFiles ?? []);
  const mentioned = snippets.map((excerpt) => excerpt.text).join("\n").toLowerCase();
  const ranked = files.filter((file) => !/\.(?:md|css|svg|json)$/i.test(file))
    .map((file) => {
      const basename = path.posix.basename(file, path.posix.extname(file));
      const signal = basename.length >= 7 && mentioned.includes(basename.toLowerCase()) ? 5 : 0;
      return { file, score: matchScore(basename, terms) * 6 + matchScore(file, terms) * 2 + signal + (entries.has(file) ? 14 : 0) };
    })
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
  for (const { file } of ranked.slice(0, focused ? 8 : 3)) {
    const lines = await read(file);
    if (!lines) continue;
    const entry = lines.findIndex((line) => /\b(?:function|def|class|router|route)\b/i.test(line));
    const openingLine = Math.max(1, entry - 3);
    const startLine = focused ? focusedSourceLine(lines, terms, openingLine) : openingLine;
    const excerpt = makeExcerpt(file, lines, { kind: "code", startLine, endLine: startLine + 119 });
    if (excerpt) code.push(excerpt);
  }
  return { docs: snippets, code };
}

/** Cap the combined packet, preserving actual source ranges and whole lines. */
export function compactLessonEvidence(
  evidence: { docs: EvidenceExcerpt[]; code: EvidenceExcerpt[] },
  kind: FocusKind,
  narrow: boolean
): { docs: EvidenceExcerpt[]; code: EvidenceExcerpt[] } {
  const architecture = evidence.docs.find((excerpt) => {
    if (kind === "matrix") return excerpt.kind === "table" || excerpt.kind === "decisions";
    if (excerpt.kind !== "mermaid") return false;
    if (kind === "map") return /^\s*(?:flowchart|graph|classDiagram|C4Context|C4Container|C4Component)\b/m.test(excerpt.text);
    if (kind === "sequence") return /^\s*sequenceDiagram\b/m.test(excerpt.text);
    if (kind === "state") return /^\s*stateDiagram(?:-v2)?\b/m.test(excerpt.text);
    return false;
  });
  const docs = architecture ? evidence.docs.filter((excerpt) => excerpt !== architecture) : evidence.docs;
  const seenDocs = new Set(architecture ? [architecture.path] : []);
  const distinctDocs = docs.filter((excerpt) => {
    if (seenDocs.has(excerpt.path)) return false;
    seenDocs.add(excerpt.path);
    return true;
  });
  const preferredDocs = distinctDocs.length ? distinctDocs : docs;
  const inputs = [architecture, evidence.code[0], preferredDocs[0], ...evidence.code.slice(1, 4), preferredDocs[1],
    evidence.code[4], preferredDocs[2], ...evidence.code.slice(5), ...docs];
  const selected: EvidenceExcerpt[] = [];
  const chosen = new Set<EvidenceExcerpt>();
  let left = narrow ? 9_000 : 20_000;
  for (const input of inputs) {
    if (!input || chosen.has(input) || selected.length >= (narrow ? 5 : 9) || left < 400) continue;
    const test = input.kind === "code" && claimEvidenceKind(input.path) === "test";
    const cap = Math.min(left - 180, narrow ? 2_400 : test ? 5_600 : 3_800);
    const lines = input.text.split("\n");
    let length = 0;
    let count = 0;
    for (const line of lines) {
      if (length + line.length + 1 > cap) break;
      length += line.length + 1;
      count += 1;
    }
    if (count === 0) continue;
    const text = lines.slice(0, count).join("\n");
    const endLine = input.startLine + count - 1;
    const id = createHash("sha256").update(JSON.stringify([input.path, input.startLine, endLine, text])).digest("hex").slice(0, 16);
    const excerpt = { ...input, id, text, endLine };
    const size = JSON.stringify(excerpt).length + 1;
    if (size > left) continue;
    selected.push(excerpt);
    chosen.add(input);
    left -= size;
  }
  return { docs: selected.filter((item) => item.kind !== "code"), code: selected.filter((item) => item.kind === "code") };
}

/** City plans need entry points and direct calls across the workspace boundary. */
export async function collectCityEvidence(report: AnalyzerReport, focus: string, brief: string, read: SourceReader): Promise<EvidenceExcerpt[]> {
  const focused = await collectBuildingEvidence(report, focus, brief, true, read);
  const { docs, code } = compactLessonEvidence(focused, "map", true);
  const terms = termsOf(brief);
  const score = (name: string): number => name === "(root)" ? 100 : name === focus ? 90 : matchScore(name, terms);
  const modules = [...report.modules].sort((a, b) => score(b.name) - score(a.name));
  const paths = isDocumentationOnly(report) ? [] : modules.flatMap((module) => sourceCandidates(module)
    .filter((file) => !module.testFiles?.includes(file) && !/\.(?:md|css|svg|json|ya?ml|toml|lock)$/i.test(file))
    .slice(0, module.name === "(root)" ? 3 : 1)).slice(0, 8);
  const entry = await Promise.all(paths.map(async (file) => {
    const lines = await read(file);
    return lines ? makeExcerpt(file, lines, { kind: "code", startLine: 1, endLine: 65 }, 2200) : null;
  }));
  return [...docs.slice(0, 1), ...entry.filter((item) => item !== null),
    ...code.filter((item) => !paths.includes(item.path) || item.startLine > 65), ...docs.slice(1)];
}

function relativeImports(file: string, text: string): string[] {
  const candidates: string[] = [];
  const directory = path.posix.dirname(file);
  if (file.endsWith(".py")) {
    for (const [, level, name] of text.matchAll(/^\s*from\s+(\.{1,4})([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s+import\b/gm)) {
      const base = path.posix.join(directory, "../".repeat(level.length - 1), name.replaceAll(".", "/"));
      candidates.push(`${base}.py`, `${base}/__init__.py`);
      if (candidates.length >= 15) break;
    }
    return candidates;
  }
  if (!/\.(?:[cm]?[jt]s|[jt]sx|vue|svelte)$/i.test(file)) return candidates;
  for (const [, relative] of text.matchAll(/(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*(?:\(\s*)?)["'](\.[^"'\r\n]{1,120})["']/g)) {
    const base = path.posix.join(directory, relative);
    const bare = base.replace(/\.m?js$/, "");
    candidates.push(base, `${bare}.ts`, `${bare}.tsx`, `${bare}.js`, `${bare}/index.ts`);
    if (candidates.length >= 15) break;
  }
  return candidates;
}

export async function expandCodeEvidence(
  report: AnalyzerReport,
  moduleRef: string,
  evidence: { docs: EvidenceExcerpt[]; code: EvidenceExcerpt[] },
  read: SourceReader,
  brief = ""
): Promise<void> {
  const seen = new Set(evidence.code.map((item) => item.path));
  const candidates: string[] = [];
  for (const item of evidence.code.slice(0, 3)) {
    const header = item.startLine > 1 ? (await read(item.path))?.slice(0, 80).join("\n") : undefined;
    candidates.push(...relativeImports(item.path, header ? `${header}\n${item.text}` : item.text).slice(0, 15 - candidates.length));
    if (candidates.length >= 15) break;
  }
  const tests = report.modules.find((item) => item.name === moduleRef)?.testFiles ?? [];
  const terms = new Set(termsOf(brief).map(singularTerm));
  const linkedModules = report.modules.filter((module) => module.name !== moduleRef && module.name !== "(root)" &&
    termsOf(module.name.split("/").at(-1) ?? module.name).some((word) => terms.has(singularTerm(word)))).slice(0, 2);
  const linkedFiles = linkedModules.flatMap((module) => [
    module.testFiles?.[0],
    sourceCandidates(module).find((file) =>
      !module.testFiles?.includes(file) && !/\.(?:md|css|svg|json)$/i.test(file))
  ])
    .filter((file): file is string => Boolean(file));
  candidates.unshift(...linkedFiles, ...tests.slice(0, 2));
  const expanded: EvidenceExcerpt[] = [];
  for (const candidate of new Set(candidates)) {
    if (seen.has(candidate)) continue;
    const lines = await read(candidate);
    if (!lines) continue;
    const excerpt = makeExcerpt(candidate, lines, { kind: "code", startLine: 1, endLine: 100 });
    if (!excerpt) continue;
    seen.add(candidate);
    expanded.push(excerpt);
    if (expanded.length >= 3) break;
  }
  evidence.code.splice(Math.min(2, evidence.code.length), 0, ...expanded);
}

type SourceRef = NonNullable<TSpaceDocument["city"]["buildings"][number]["source"]>;
type Flow = TSpaceDocument["flows"][number];

function guidePhrase(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Find explicit replay names in the question and rank the relevant occurrences in each. */
export function relatedGuideScenarios(flow: Flow, question: string) {
  let query = ` ${guidePhrase(question)} `;
  const named = (flow.scenarios ?? []).flatMap((scenario) => {
    const aliases = [...new Set([scenario.id, scenario.title].map(guidePhrase))]
      .filter((alias) => alias.length >= 3 && query.includes(` ${alias} `));
    return aliases.length ? [{ scenario, aliases }] : [];
  }).slice(0, 4);
  if (!named.length) return [];
  for (const alias of named.flatMap(({ aliases }) => aliases).sort((a, b) => b.length - a.length)) {
    query = query.replaceAll(` ${alias} `, " ");
  }
  const terms = new Set(termsOf(query).map(singularTerm));
  const relevance = (value: string) => termsOf(value).filter((word) => terms.has(singularTerm(word))).length;
  const ordinals = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"];
  const requestedOccurrences = new Set(query.trim().split(/\s+/).flatMap((word) => {
    const index = ordinals.indexOf(word);
    const number = /^(\d+)(?:st|nd|rd|th)$/.exec(word)?.[1];
    return index >= 0 ? [index + 1] : number ? [Number(number)] : [];
  }));
  const points = new Map([...flow.path, ...(flow.branches ?? []).flatMap(({ path }) => path)].map((point) => [point.id, point]));

  return named.map(({ scenario }) => {
    const authored = new Map((scenario.events ?? []).map((event) => [event.stepIndex, event]));
    const occurrences = new Map<string, number>();
    const ranked = scenario.steps.flatMap((step, stepIndex) => {
      const occurrence = (occurrences.get(step) ?? 0) + 1;
      occurrences.set(step, occurrence);
      const point = points.get(step);
      const event = authored.get(stepIndex);
      const source = event?.source ?? point?.source;
      if (!source?.startLine) return [];
      const detail = event?.detail ?? point?.detail;
      const state = event?.state ?? point?.state;
      const actionMatch = relevance([step, point?.caption, point?.actor, point?.detail].filter(Boolean).join(" "));
      const occurrenceMatch = relevance([event?.detail, ...(state ?? []).flatMap(({ key, value }) => [key, value])].filter(Boolean).join(" "));
      const ordinalMatch = actionMatch && scenario.steps.indexOf(step) !== scenario.steps.lastIndexOf(step) && requestedOccurrences.has(occurrence);
      const score = 4 * actionMatch + 6 * occurrenceMatch + (event ? 3 : 0) + (ordinalMatch ? 12 : 0);
      return [{ stepIndex, caption: point?.caption, detail, state, source, score }];
    }).sort((a, b) => b.score - a.score || b.stepIndex - a.stepIndex);
    return { id: scenario.id, title: scenario.title, events: ranked.slice(0, 2).map(({ score: _, ...event }) => event) };
  });
}

export function guideEvidenceCovers(source: SourceRef, evidence: EvidenceExcerpt[]): boolean {
  const { startLine, endLine } = source;
  const file = source.path.replaceAll("\\", "/");
  return startLine !== undefined && evidence.some((excerpt) =>
    excerpt.path === file && excerpt.startLine <= startLine && excerpt.endLine >= (endLine ?? startLine));
}

/** A specific why-request may require a quote only if the packet contains a relevant authored decision. */
export function requestedDecisionEvidence(brief: string, docs: EvidenceExcerpt[], scopedDesign = false): EvidenceExcerpt[] {
  const why = /\b(?:explain|describe|show)\s+why\s+([^.!?\n]{1,180})/i.exec(brief);
  if (!scopedDesign && !why && !/\b(?:design decisions?|rationales?|trade[- ]?offs?)\b/i.test(brief)) return [];
  const generic = new Set(["the", "for", "and", "with", "from", "into", "design", "decision", "rationale", "about"]);
  const topic = termsOf(why?.[1] ?? brief).map(singularTerm).filter((term) => !generic.has(term));
  return docs.filter((row) => row.kind === "section" && /^(?:decision|rationale|trade[- ]?offs?)\b/i.test(row.title ?? "") &&
    (scopedDesign || termsOf(row.text).map(singularTerm).some((term) => topic.includes(term))));
}

export interface AuthoredDecisionQuote {
  id: string;
  text: string;
  evidence: TClaimEvidence;
}

/** Prepare exact choices from the numbered rows the provider can see. */
export function authoredDecisionQuotes(brief: string, shown: EvidenceExcerpt[], scopedDesign = false): AuthoredDecisionQuote[] {
  const sentences = new Intl.Segmenter(undefined, { granularity: "sentence" });
  return requestedDecisionEvidence(brief, shown, scopedDesign).flatMap((row) => {
    const body = row.text.split("\n").map((line, index) => {
      const prefix = `${row.startLine + index} | `;
      const original = line.startsWith(prefix) ? line.slice(prefix.length) : line;
      return /^\s*(?:#{1,6}\s|```)/.test(original) ? " ".repeat(original.length) : original;
    }).join("\n");
    return [...sentences.segment(body)].flatMap(({ segment, index }) => {
      const trimmed = segment.trim();
      const text = trimmed.replace(/\s+/g, " ");
      if (text.length > 360 || !/[\p{L}\p{N}]/u.test(text)) return [];
      const offset = index + segment.indexOf(trimmed);
      const startLine = row.startLine + body.slice(0, offset).split("\n").length - 1;
      const endLine = startLine + trimmed.split("\n").length - 1;
      if (endLine > row.endLine || endLine - startLine >= 40) return [];
      const evidence = { kind: "docs" as const, path: row.path, startLine, endLine };
      const id = createHash("sha256").update(JSON.stringify([text, evidence])).digest("hex").slice(0, 12);
      return [{ id, text, evidence }];
    }).slice(0, 3);
  }).slice(0, 6);
}

function guideTerms(value: string): string[] {
  return [...new Set(termsOf(value).map(singularTerm).map((word) => word.length >= 7
    ? word.replace(/(.)\1ing$/, "$1").replace(/ing$/, "") : word))];
}

export function relatedGuideClaimSources(diagrams: TSpaceDocument["diagrams"], question: string): SourceRef[] {
  const terms = new Set(guideTerms(question));
  return diagrams.flatMap(({ claims }) => claims ?? []).map((claim) => ({
    claim, score: guideTerms(claim.text).filter((term) => terms.has(term)).length
  })).filter(({ score }) => score >= 2).sort((a, b) => b.score - a.score).slice(0, 2)
    .flatMap(({ claim }) => claim.evidence.filter(({ stale }) => !stale));
}

/** Rank short spans instead of sending the first declaration or entire files to Guide. */
export async function collectGuideEvidence(
  report: AnalyzerReport, question: string, sceneContext: string, moduleRef: string | undefined,
  anchors: SourceRef[], read: SourceReader
): Promise<EvidenceExcerpt[]> {
  const terms = guideTerms(question);
  const context = guideTerms(sceneContext).slice(0, 60);
  const scoreTerms = (text: string, list: string[]): number => {
    const words = new Set(guideTerms(text));
    return list.filter((word) => words.has(word)).length;
  };
  const query = question.toLowerCase().replaceAll("\\", "/");
  const indexedCode = new Set(report.modules.flatMap((module) => [
    ...(module.entryFiles ?? []), ...(module.testFiles ?? []), ...module.topFiles.map(({ path }) => path)
  ]));
  const linkedCode = new Set<string>();
  const anchorPaths = new Set(anchors.map(({ path }) => path.replaceAll("\\", "/")));
  const files = new Map<string, number>();
  const offer = (file: string, weight: number): void => {
    const named = query.includes(file.toLowerCase()) || query.includes(path.posix.basename(file).toLowerCase());
    files.set(file, Math.max(files.get(file) ?? 0, weight + scoreTerms(file, terms) * 5 + (named ? 20 : 0)));
  };
  for (const file of anchorPaths) offer(file, 25);
  for (const file of [...anchorPaths].filter((candidate) => /\.md$/i.test(candidate)).slice(0, 3)) {
    const lines = await read(file);
    if (!lines) continue;
    const links = lines.slice(0, 400).join("\n").matchAll(/\[[^\]\n]{1,180}\]\(([^)\s#]{1,250})(?:#[^)]*)?\)/g);
    for (const [, href] of links) {
      const linked = path.posix.normalize(path.posix.join(path.posix.dirname(file), href));
      if (path.posix.isAbsolute(href) || !indexedCode.has(linked) || !allowedEvidencePath(linked) || claimEvidenceKind(linked) !== "code") continue;
      linkedCode.add(linked);
      offer(linked, 18);
    }
  }
  for (const module of report.modules) {
    const focused = module.name === moduleRef;
    const related = scoreTerms(module.name, terms) > 0;
    const weight = focused ? 10 : related ? 6 : 1;
    for (const file of (module.testFiles ?? []).slice(0, 8)) offer(file, weight + 3);
    for (const file of (module.entryFiles ?? []).slice(0, 6)) offer(file, weight + 2);
    for (const file of module.topFiles.slice(0, 8)) offer(file.path, weight);
  }
  for (const doc of report.docs) {
    const related = doc.module === moduleRef || moduleRef !== undefined && doc.matches.includes(moduleRef);
    const titleScore = scoreTerms(`${doc.path} ${doc.title ?? ""}`, terms);
    if (related || titleScore > 0) offer(doc.path, (related ? 5 : 0) + titleScore * 3);
  }

  const chosen: EvidenceExcerpt[] = [];
  let used = 2;
  const add = (excerpt: EvidenceExcerpt | null) => {
    if (!excerpt || chosen.length >= 7) return;
    const size = JSON.stringify(excerpt).length + 1;
    if (used + size > 9_000) return;
    chosen.push(excerpt);
    used += size;
  };
  for (const anchor of anchors.slice(0, 5)) {
    const { startLine } = anchor;
    if (!startLine || guideEvidenceCovers(anchor, chosen)) continue;
    const file = anchor.path.replaceAll("\\", "/");
    const lines = await read(file);
    if (!lines) continue;
    const endLine = anchor.endLine ?? startLine;
    const nearby = makeExcerpt(file, lines, { kind: "code", startLine: Math.max(1, startLine - 2), endLine: endLine + 8 }, 1_600);
    const exact = nearby?.endLine !== undefined && nearby.endLine >= endLine ? nearby
      : makeExcerpt(file, lines, { kind: "code", startLine, endLine }, 1_600);
    if (exact && guideEvidenceCovers(anchor, [exact])) add(exact);
  }

  const ranked: { path: string; line: number; score: number; lines: string[] }[] = [];
  const candidates = [...files].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 24);
  for (const [file, weight] of candidates) {
    if (/\.(?:svg|lock|min\.js)$/i.test(file)) continue;
    const lines = await read(file);
    if (!lines) continue;
    const best = lines.slice(0, 4_000).map((text, i) => {
      const score = scoreTerms(text, terms) * 7 + scoreTerms(text, context) * 2;
      return { line: i + 1, score };
    }).filter(({ score }) => score > 0).sort((a, b) => b.score - a.score || a.line - b.line);
    for (const candidate of best.slice(0, 6)) ranked.push({ ...candidate, path: file, score: candidate.score + weight / 3, lines });
  }
  ranked.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.line - b.line);
  const addRanked = ({ path, line, lines }: typeof ranked[number]) => {
    const startLine = Math.max(1, line - 4);
    const endLine = line + 8;
    if (chosen.some((item) => item.path === path && startLine <= item.endLine && endLine >= item.startLine)) return;
    add(makeExcerpt(path, lines, { kind: "code", startLine, endLine }));
  };
  for (const kind of ["code", "test", "docs"] as const) {
    if (chosen.some(({ path }) => claimEvidenceKind(path) === kind)) continue;
    const first = ranked.find(({ path }) => claimEvidenceKind(path) === kind);
    if (first) addRanked(first);
  }
  const invoked = [...new Set(chosen.filter(({ path }) => claimEvidenceKind(path) === "code")
    .flatMap(({ text }) => [...text.matchAll(/\.([A-Za-z_]\w*)\(/g)].map((match) => match[1])))]
    .filter((name) => scoreTerms(name, terms) > 0);
  const complementaryRows = ranked.filter(({ path }) => linkedCode.has(path) && !chosen.some((item) => item.path === path));
  const complementary = complementaryRows.find(({ lines }) => invoked.some((name) => lines.some((line) => line.includes(name))))
    ?? complementaryRows[0];
  if (complementary) {
    addRanked(complementary);
    const separate = complementaryRows.find(({ path, line }) => path === complementary.path && Math.abs(line - complementary.line) > 12);
    if (separate) addRanked(separate);
  }
  for (const row of ranked) {
    if (chosen.length >= 7) break;
    addRanked(row);
  }
  return chosen;
}

export async function verifiedSourceRef(source: SourceRef, read: SourceReader): Promise<SourceRef | null> {
  const canonical = source.path.replaceAll("\\", "/");
  const lines = await read(canonical);
  if (!lines || source.endLine !== undefined && source.startLine === undefined || (source.startLine ?? 1) > (source.endLine ?? lines.length) || (source.endLine ?? 1) > lines.length) return null;
  return { ...source, path: canonical };
}

const exactClaimText = (value: string): string => value.normalize("NFKC").replace(/\s+/g, " ").trim();

function claimEvidenceKind(file: string): TClaimEvidence["kind"] {
  if (/\.(?:md|mdx|rst|adoc|txt)$/i.test(file)) return "docs";
  if (/(?:^|[/_.-])(?:tests?|specs?)(?:[/_.-]|$)/i.test(file)) return "test";
  return "code";
}

async function claimSpan(source: TClaimEvidence, read: SourceReader): Promise<{ text: string; fingerprint: string } | undefined> {
  const lines = await read(source.path);
  if (!lines || source.startLine < 1 || source.endLine < source.startLine || source.endLine > lines.length) return undefined;
  const text = lines.slice(source.startLine - 1, source.endLine).join("\n");
  return { text, fingerprint: createHash("sha256").update(text).digest("hex") };
}

/** Only claims with exact spans from the packet are accepted. A rationale quotes its authored text. */
export async function acceptDiagramClaims(
  claims: TDiagramClaim[] | undefined, packet: EvidenceExcerpt[], read: SourceReader
): Promise<TDiagramClaim[] | undefined> {
  const accepted: TDiagramClaim[] = [];
  for (const claim of claims ?? []) {
    const evidence: TClaimEvidence[] = [];
    let quotedDecision = false;
    for (const source of claim.evidence) {
      if (source.kind !== claimEvidenceKind(source.path) || !guideEvidenceCovers(source, packet)) break;
      const span = await claimSpan(source, read);
      if (!span || !span.text.trim()) break;
      if (source.kind === "docs" && exactClaimText(span.text).includes(exactClaimText(claim.text))) quotedDecision = true;
      evidence.push({ ...source, fingerprint: span.fingerprint });
    }
    if (evidence.length === claim.evidence.length && (claim.kind !== "decision" || quotedDecision)) {
      accepted.push({ ...claim, evidence });
    }
  }
  return accepted.length ? accepted : undefined;
}

export async function markStaleClaimEvidence(space: TSpaceDocument, read: SourceReader): Promise<void> {
  for (const diagram of space.diagrams) for (const claim of diagram.claims ?? []) {
    for (const evidence of claim.evidence) {
      const span = evidence.fingerprint ? await claimSpan(evidence, read) : undefined;
      evidence.stale = span && span.fingerprint === evidence.fingerprint ? undefined : true;
    }
  }
}

type ClaimReplay = NonNullable<TDiagramClaim["replay"]>;
interface ReplayAnchor {
  replay: ClaimReplay;
  source?: SourceRef;
  eventSource?: SourceRef;
}

function claimReplayAnchor(claim: TDiagramClaim, anchors: ReplayAnchor[]): ClaimReplay | undefined {
  const overlaps = (source?: SourceRef) => source?.startLine !== undefined && claim.evidence.some((evidence) =>
    evidence.path === source.path && evidence.startLine <= (source.endLine ?? source.startLine!) && evidence.endLine >= source.startLine!);
  const target = claim.replay;
  const chosen = target && anchors.find(({ replay }) => replay.flow === target.flow && replay.scenario === target.scenario &&
    replay.step === target.step && replay.stepIndex === target.stepIndex);
  if (chosen && (overlaps(chosen.source) || overlaps(chosen.eventSource))) return chosen.replay;
  const exact = anchors.filter(({ eventSource }) => overlaps(eventSource));
  const matches = exact.length ? exact : anchors.filter(({ source }) => overlaps(source));
  return matches.length === 1 ? matches[0].replay : undefined;
}

/** Resolve and range-check citations before any document coverage is published. */
export async function verifyEvidence(space: TSpaceDocument, report: AnalyzerReport, read: SourceReader): Promise<{
  sourceCount: number;
  droppedSourceCount: number;
}> {
  const targets: { source?: SourceRef }[] = [...space.city.buildings, ...space.tour, ...space.tour.flatMap((stop) => stop.checkpoint ? [stop.checkpoint] : [])];
  for (const flow of space.flows) {
    targets.push(flow, ...flow.path);
    for (const branch of flow.branches ?? []) targets.push(...branch.path);
    for (const scenario of flow.scenarios ?? []) targets.push(...(scenario.events ?? []));
  }
  for (const diagram of space.diagrams) targets.push(diagram, ...diagram.nodes, ...diagram.edges, ...diagram.nodes.flatMap(({ fields }) => fields ?? []));
  for (const interior of space.interiors) targets.push(...interior.floors);
  const valid = new Map<string, SourceRef[]>();
  let sourceCount = 0;
  let droppedSourceCount = 0;
  const record = (source: SourceRef) => {
    const refs = valid.get(source.path) ?? [];
    refs.push(source);
    valid.set(source.path, refs);
    sourceCount += 1;
  };
  for (const target of targets) {
    const source = target.source;
    if (!source) continue;
    const checked = await verifiedSourceRef(source, read);
    if (!checked) {
      delete target.source;
      droppedSourceCount += 1;
      continue;
    }
    target.source = checked;
    record(checked);
  }
  for (const flow of space.flows) for (const scenario of flow.scenarios ?? []) {
    if (scenario.events) scenario.events = scenario.events.filter((event) => event.source?.startLine);
  }
  const replayAnchors = space.flows.flatMap((flow) => {
    const points = new Map([...flow.path, ...(flow.branches ?? []).flatMap(({ path }) => path)].map((point) => [point.id, point]));
    return (flow.scenarios ?? []).flatMap((scenario) => scenario.steps.map((step, stepIndex) => ({
      scope: flow.scope,
      replay: { flow: flow.id, scenario: scenario.id, step, stepIndex },
      source: points.get(step)?.source,
      eventSource: scenario.events?.find((event) => event.stepIndex === stepIndex)?.source
    })));
  });
  await markStaleClaimEvidence(space, read);
  for (const diagram of space.diagrams) {
    if (!diagram.claims?.length) continue;
    const owner = diagram.owner.split(":")[0];
    const anchors = diagram.owner === "city" ? replayAnchors : replayAnchors.filter(({ scope }) => scope === `module:${owner}`);
    const accepted = diagram.claims.filter((claim) => {
      if (claim.evidence.some((source) => source.stale)) {
        droppedSourceCount += claim.evidence.length;
        return false;
      }
      claim.replay = claimReplayAnchor(claim, anchors);
      for (const source of claim.evidence) record(source);
      return true;
    });
    diagram.claims = accepted.length ? accepted : undefined;
  }
  if (space.assessment) {
    const questions = [];
    for (const question of space.assessment.questions) {
      const checked = await verifiedSourceRef(question.source, read);
      if (!checked?.startLine) {
        droppedSourceCount += 1;
        continue;
      }
      questions.push({ ...question, source: { ...checked, startLine: checked.startLine } });
      record(checked);
    }
    space.assessment.questions = questions;
  }
  if (!space.assessment?.questions.length) {
    const questions = space.tour.flatMap((stop, index) => {
      const checkpoint = stop.checkpoint;
      if (!checkpoint?.source?.startLine || !checkpoint.explanation) return [];
      return [{ id: `tour-${index + 1}`, kind: "choice" as const, prompt: checkpoint.question.slice(0, 280),
        options: checkpoint.options.map((option) => ({ id: option.id, label: option.label.slice(0, 120) })),
        answer: checkpoint.options.filter((option) => option.correct).map((option) => option.id),
        explanation: checkpoint.explanation.slice(0, 480), source: { ...checkpoint.source, startLine: checkpoint.source.startLine },
        replay: space.flows.some((flow) => flow.id === stop.ref) ? { flow: stop.ref } : undefined }];
    });
    if (questions.length) space.assessment = { questions };
  }
  const previousCoverage = space.meta.coverage;
  space.meta.coverage = report.docs.map((doc) => {
    const sections = (doc.sections ?? []).filter((section) => section.kind === "section");
    const refs = valid.get(doc.path) ?? [];
    const total = sections.length || 1;
    const placed = sections.length > 0
      ? sections.filter((section) => refs.some((ref) => ref.startLine !== undefined && ref.startLine >= section.startLine && ref.startLine <= section.endLine)).length
      : Number(refs.length > 0);
    return { doc: doc.path, sections: total, placed, pending: total - placed };
  });
  const coverageIndex = new Map(space.meta.coverage.map((row, index) => [row.doc, index]));
  for (const interior of space.interiors) {
    const old = interior.lobby.coverageRefs.map((ref) => previousCoverage[ref]?.doc);
    const building = space.city.buildings.find((item) => item.id === interior.building);
    const owned = report.docs.filter((doc) => doc.module === building?.moduleRef || !!building && doc.matches.includes(building.moduleRef)).map((doc) => doc.path);
    interior.lobby.coverageRefs = [...new Set([...old, ...owned])]
      .map((doc) => doc === undefined ? undefined : coverageIndex.get(doc))
      .filter((ref): ref is number => ref !== undefined)
      .slice(0, 40);
  }
  return { sourceCount, droppedSourceCount };
}
