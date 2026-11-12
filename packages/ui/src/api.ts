export interface DoctorCheck {
  name: string;
  found: boolean;
  detail: string;
  optional: boolean;
}

export type AgentId = "claude" | "codex" | "api";

export interface AgentInfo {
  id: AgentId;
  available: boolean;
  detail: string;
  implemented: boolean;
  readsFiles: boolean;
}

export interface Project {
  id: string;
  name: string;
  source_dir: string;
  scene_type: string;
  model_style: string;
  created_at: string;
  hasSpace?: boolean;
}

export interface GenerationSettings {
  brief: string;
  language: string;
  agent: AgentId;
  model: string | null;
  focusModule?: string | null;
  refreshScan?: boolean;
  reuseCache?: boolean;
}

export interface ProjectDetailResponse {
  project: Project;
  hasSpace: boolean;
  generation: GenerationSettings | null;
  latestJob: JobView | null;
  latestGenerationJob?: JobView | null;
}

export interface KeysInfo {
  anthropic: boolean;
  tripo: boolean;
  anthropicSource?: "environment" | "local";
  tripoSource?: "environment" | "local";
}

export interface ModuleSummary {
  name: string;
  files: number;
  loc: number;
  topFiles: { path: string; loc: number }[];
}

export interface ScanExclusion {
  reason: "ignore-rule" | "generated" | "hidden" | "link" | "unreadable";
  count: number;
  examples: string[];
}

export interface AnalyzerReport {
  sourceDir: string;
  scannedAt: string;
  totals: { files: number; dirs: number; loc: number };
  languages: Record<string, { files: number; loc: number }>;
  modules: ModuleSummary[];
  docs: { path: string; bytes: number; title?: string; module?: string | null }[];
  readmeExcerpt?: string;
  truncated: boolean;
  scanLimits?: {
    files: number;
    depth: number;
    docs: number;
    reached: ("files" | "depth" | "docs")[];
    excludedEntries: number;
    exclusions?: ScanExclusion[];
  };
}

export interface JobStage {
  at: string;
  text: string;
  phase?: "scan" | "plan" | "content" | "layout" | "quality";
  building?: string;
  state?: "running" | "ready" | "pending" | "cached";
  evidence?: string[];
  outputs?: { title: string; kind: "diagram" | "flow"; ref?: string }[];
  focus?: boolean;
  deliverableId?: string;
}

export interface GenerationDeliverable {
  id: string;
  kind: "map" | "scenario" | "sequence" | "state" | "matrix" | "erd" | "class" | "mindmap" | "context";
  title: string;
  state: "pending" | "running" | "ready" | "failed" | "timed-out";
  error?: string;
  reference?: string;
}

/** A city this workspace generated earlier; each brief keeps its latest one. */
export interface SavedCity {
  jobId: string;
  brief: string;
  language: string;
  title: string;
  savedAt: string;
  buildings: number;
  lessons: number;
  diagrams: number;
  flows: number;
}

export interface JobView {
  id: string;
  projectId: string;
  kind: string;
  status: string;
  stages: JobStage[];
  error?: { code: string; message: string };
  createdAt: string;
  updatedAt: string;
  deliverables?: GenerationDeliverable[];
  focusReady?: boolean;
  draftAvailable?: boolean;
  /** Buildings the brief asks about that wait beyond the lesson limit. */
  lessonsWaiting?: number;
  quality?: {
    focusBuilding?: string;
    status: "ready" | "partial" | "pending";
    sourceCount: number;
    droppedSourceCount: number;
    playableFlowCount: number;
    issues: string[];
    keptPrevious?: boolean;
  };
}

export interface AskResult {
  answer: string;
  sources: string[];
  focusRef?: string;
  citations?: { path: string; startLine?: number; endLine?: number; focusRef?: string }[];
}

export interface EditorOpenResult {
  status: "dispatched" | "copy";
  pathLine: string;
  editor?: string;
  message?: string;
}

export interface DocExcerpt {
  path: string;
  from: number;
  to: number;
  totalLines: number;
  text: string;
  /** The same lines in Markdown terms, sent for reStructuredText and AsciiDoc. */
  display?: string;
  sections?: { title?: string; startLine: number; endLine: number }[];
}

export interface SpaceOffer {
  class: "landmark" | "centerpiece" | "character" | "emblem" | "icon";
  building: string;
  prompt: string;
}

export interface OverlayItem {
  building: string;
  class: string;
  prompt: string;
  id: string;
  url: string;
  hidden?: boolean;
}

export interface CityPreview {
  city: import("./space-types").CityLayout;
  focusId?: string;
  focusTitle?: string;
  savedAt: string;
}

export class LocalApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new LocalApiError(message, res.status);
  }
  return (await res.json()) as T;
}

export const api = {
  health: () => fetch("/api/health").then((r) => json<{ ok: boolean; version: string }>(r)),
  doctor: () => fetch("/api/doctor").then((r) => json<{ checks: DoctorCheck[] }>(r)),
  agents: () => fetch("/api/agents").then((r) => json<{ agents: AgentInfo[] }>(r)),
  editor: () => fetch("/api/editor").then((r) => json<{ available: boolean; name: string; detail: string }>(r)),
  checkAnthropic: () => fetch("/api/agents/anthropic/check", { method: "POST" }).then((r) => json<{ ok: boolean }>(r)),
  projects: () => fetch("/api/projects").then((r) => json<{ projects: Project[] }>(r)),
  keys: () => fetch("/api/keys").then((r) => json<KeysInfo>(r)),
  saveKeys: (body: { anthropicKey?: string; tripoKey?: string }) =>
    fetch("/api/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }).then((r) => json<KeysInfo>(r)),
  createProject: (body: { name: string; sourceDir: string; modelStyle?: string }) =>
    fetch("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }).then((r) => json<{ project: Project }>(r)),
  validateWorkspace: (sourceDir: string) =>
    fetch("/api/projects/validate-path", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceDir })
    }).then((r) => json<{ sourceDir: string }>(r)),
  project: (id: string) =>
    fetch(`/api/projects/${id}`).then((r) => json<ProjectDetailResponse>(r)),
  analysis: (id: string, force = false) =>
    fetch(`/api/projects/${id}/analysis${force ? "?force=1" : ""}`).then((r) =>
      json<{ report: AnalyzerReport }>(r)
    ),
  clearGenerationCache: (id: string) =>
    fetch(`/api/projects/${id}/generation-cache`, { method: "DELETE" }).then((r) => json<{ ok: boolean }>(r)),
  removeWorkspace: (id: string) =>
    fetch(`/api/projects/${id}`, { method: "DELETE" }).then((r) => json<{ ok: boolean; cleanupPending?: boolean }>(r)),
  job: (id: string) => fetch(`/api/jobs/${id}`).then((r) => json<{ job: JobView }>(r)),
  startSpace: (
    id: string,
    body: { brief: string; language: string; agent: string; model?: string; focusModule?: string | null; fresh?: boolean; refreshScan?: boolean }
  ) =>
    fetch(`/api/projects/${id}/space`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }).then((r) => json<{ jobId: string }>(r)),
  saveDiagram: (id: string, diagram: import("./space-types").SpaceDiagram, diagramId?: string) =>
    fetch(`/api/projects/${id}/diagrams${diagramId ? `/${encodeURIComponent(diagramId)}` : ""}`, {
      method: diagramId ? "PUT" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ diagram })
    }).then((r) => json<{ diagram: import("./space-types").SpaceDiagram }>(r)),
  removeDiagramEdit: (id: string, diagramId: string) =>
    fetch(`/api/projects/${id}/diagrams/${encodeURIComponent(diagramId)}`, { method: "DELETE" }).then((r) => json<{ ok: boolean }>(r)),
  importDiagram: (id: string, body: { format: "mermaid" | "drawio"; text: string; title?: string; owner?: string }) =>
    fetch(`/api/projects/${id}/diagrams/import`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
    }).then((r) => json<{ diagram: import("./space-types").SpaceDiagram }>(r)),
  savedCities: (id: string) =>
    fetch(`/api/projects/${id}/cities`).then((r) => json<{ current?: string; cities: SavedCity[] }>(r)),
  openSavedCity: (id: string, jobId: string) =>
    fetch(`/api/projects/${id}/cities/${jobId}/open`, { method: "POST" }).then((r) => json<{ city: SavedCity }>(r)),
  removeSavedCity: (id: string, jobId: string) =>
    fetch(`/api/projects/${id}/cities/${jobId}`, { method: "DELETE" }).then((r) => json<{ ok: boolean }>(r)),
  continueLessons: (id: string, jobId: string) =>
    fetch(`/api/projects/${id}/jobs/${jobId}/lessons/continue`, { method: "POST" }).then((r) => json<{ jobId: string }>(r)),
  retryDeliverable: (id: string, jobId: string, deliverableId: string) =>
    fetch(`/api/projects/${id}/jobs/${jobId}/deliverables/${encodeURIComponent(deliverableId)}/retry`, {
      method: "POST"
    }).then((r) => json<{ jobId: string }>(r)),
  space: (id: string, signal?: AbortSignal) =>
    fetch(`/api/projects/${id}/space`, { signal }).then((r) => json<import("./space-types").SpacePayload>(r)),
  cityPreview: (id: string) =>
    fetch(`/api/projects/${id}/city-preview`).then((r) => json<CityPreview>(r)),
  draft: (id: string, jobId: string, signal?: AbortSignal) =>
    fetch(`/api/projects/${id}/jobs/${jobId}/draft`, { signal }).then((r) => json<import("./space-types").SpacePayload>(r)),
  offers: (id: string) =>
    fetch(`/api/projects/${id}/offers`).then((r) => json<{ offers: SpaceOffer[] }>(r)),
  overlays: (id: string, includeHidden = false, signal?: AbortSignal) =>
    fetch(`/api/projects/${id}/overlays${includeHidden ? "?includeHidden=1" : ""}`, { signal }).then((r) => json<{ items: OverlayItem[] }>(r)),
  setOverlayHidden: (id: string, item: OverlayItem, hidden: boolean) =>
    fetch(`/api/projects/${id}/overlays/${item.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ building: item.building, class: item.class, hidden })
    }).then((r) => json<{ ok: boolean; hidden: boolean }>(r)),
  generateOffer: (id: string, index: number) =>
    fetch(`/api/projects/${id}/offers/${index}/generate`, { method: "POST" }).then((r) =>
      json<{ jobId: string }>(r)
    ),
  packManifest: (signal?: AbortSignal) =>
    fetch("/api/assets/manifest", { signal }).then((r) =>
      json<{ assets: { role: string; file: string }[] }>(r)
    ),
  doc: (id: string, path: string, from?: number, to?: number, outline = false) =>
    fetch(
      `/api/projects/${id}/doc?path=${encodeURIComponent(path)}${from ? `&from=${from}` : ""}${to ? `&to=${to}` : ""}${outline ? "&outline=1" : ""}`
    ).then((r) => json<DocExcerpt>(r)),
  openInEditor: (id: string, path: string, line?: number, action?: "open" | "copy") =>
    fetch(`/api/projects/${id}/open`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path, line, action })
    }).then((r) => json<EditorOpenResult>(r)),
  exportBundle: (id: string) =>
    fetch(`/api/projects/${id}/export`, { method: "POST" }).then((r) => json<{ ok: boolean; zip: string }>(r)),
  ask: (
    id: string,
    body: {
      question: string;
      language: string;
      agent?: string;
      model?: string;
      focusRef?: string;
      draftJobId?: string;
      scenarioId?: string;
      stepId?: string;
      stepIndex?: number;
      sourceStartLine?: number;
      sourceEndLine?: number;
      focusTitle?: string;
      focusSourcePath?: string;
    }
  ) =>
    fetch(`/api/projects/${id}/ask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }).then((r) => json<AskResult>(r))
};
