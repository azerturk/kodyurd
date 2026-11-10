import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { promises as fs } from "node:fs";
import { buildSpaceExport, exportZipPath, readSavedSpace, readSavedSpaceFile } from "./export.js";
import { getAnthropicKey, getTripoKey, readKeys, writeKeys } from "./config.js";
import { installedPackRoles, packAssetPath, packDirectory } from "./asset-registry.js";
import { indexMarkdown } from "./analyzer.js";
import { tripoCacheGlb } from "./tripo.js";
import type { SqliteDb } from "./db.js";
import { runDoctor } from "./doctor.js";
import { detectAgents, type AgentId } from "./agents.js";
import path from "node:path";
import {
  askGuide,
  atomicJson,
  generationDraftPath,
  getJob,
  getOrCreateAnalysis,
  hasActiveGuide,
  offersPath,
  overlaysPath,
  projectDir,
  spacePath,
  startOverlayJob,
  startSpaceJob,
  type ProjectRow
} from "./jobs.js";
import { AgentError } from "./agents.js";
import { createSourceReader, resolveEvidencePath } from "./source-evidence.js";
import { editorStatus, openEditor } from "./editor.js";
import { clearWorkspaceCache, removeWorkspace } from "./workspace-maintenance.js";
import { isWorkspaceUnderMaintenance, tryAcquireWorkspaceOperation } from "./workspace-operation.js";
import { overlayBuilding, savedBuildingIdentities, type OverlayRecord } from "./overlay-records.js";

export interface ApiContext {
  db: SqliteDb;
  dataDir: string;
  version: string;
  uiDist?: string;
}

/** Model override as the user typed it — claude --model / codex -m / API model id. */
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9.:/_-]{0,63}$/;
function readModel(body: Record<string, unknown>): string | undefined {
  if (typeof body.model !== "string") return undefined;
  const value = body.model.trim();
  return MODEL_RE.test(value) ? value : undefined;
}

function readAgent(value: unknown): AgentId | undefined {
  return value === "claude" || value === "codex" || value === "api" ? value : undefined;
}

function readPositiveLine(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value < 1_000_000
    ? value : undefined;
}

interface GenerationSettings {
  brief: string;
  language: string;
  agent: AgentId;
  model: string | null;
  focusModule: string | null;
  refreshScan: boolean;
  reuseCache: boolean;
}

function generationSettings(db: SqliteDb, projectId: string): GenerationSettings | undefined {
  const row = db.prepare("SELECT brief, language, agent, model, focus_module AS focusModule, refresh_scan, reuse_cache FROM project_generation WHERE project_id = ?")
    .get(projectId) as (Omit<GenerationSettings, "refreshScan" | "reuseCache"> & {
      refresh_scan: number;
      reuse_cache: number;
    }) | undefined;
  if (!row) return undefined;
  const { refresh_scan, reuse_cache, ...settings } = row;
  return { ...settings, refreshScan: refresh_scan === 1, reuseCache: reuse_cache === 1 };
}

function getProject(db: SqliteDb, id: string): ProjectRow | undefined {
  return db
    .prepare("SELECT id, name, source_dir, scene_type, model_style, created_at FROM projects WHERE id = ?")
    .get(id) as ProjectRow | undefined;
}

async function readableFolder(value: unknown): Promise<string> {
  const input = typeof value === "string" ? value.trim() : "";
  if (!input || input.length > 4096) {
    throw new AgentError("WORKSPACE_PATH", "Enter a local folder path.");
  }
  try {
    const absolute = await fs.realpath(input);
    const directory = await fs.opendir(absolute);
    await directory.close();
    return absolute;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    const message = code === "ENOENT" ? "This folder could not be found. Check the local path."
      : code === "ENOTDIR" ? "Choose a folder. This path points to a file."
        : "Kodyurd could not read this folder. Check its permissions.";
    throw new AgentError("WORKSPACE_PATH", message);
  }
}

const WORKSPACE_BUSY = { error: "This workspace has an active operation. Wait for it to finish and try again." };

export function registerApi(app: FastifyInstance, ctx: ApiContext): void {
  const { db, dataDir, version, uiDist } = ctx;

  app.get("/api/health", async () => ({ ok: true, version }));

  app.get("/api/doctor", async () => ({ checks: runDoctor(dataDir) }));

  app.get("/api/agents", async () => ({ agents: detectAgents(dataDir) }));
  app.get("/api/editor", async () => editorStatus());

  app.post("/api/agents/anthropic/check", async (_req, reply) => {
    const key = getAnthropicKey(dataDir);
    if (!key) return reply.code(400).send({ error: "Set an Anthropic API key first." });
    try {
      const result = await fetch("https://api.anthropic.com/v1/models?limit=1", {
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01" }, redirect: "error", signal: AbortSignal.timeout(8_000)
      });
      await result.body?.cancel();
      if (result.ok) return { ok: true };
      return reply.code(502).send({ error: result.status === 401 || result.status === 403
        ? "Anthropic did not accept this key." : `Anthropic returned HTTP ${result.status}.` });
    } catch {
      return reply.code(502).send({ error: "Could not reach Anthropic. Check the connection and try again." });
    }
  });

  app.get("/api/keys", async () => {
    const stored = readKeys(dataDir);
    return {
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY || stored.anthropicKey),
      tripo: Boolean(process.env.TRIPO_API_KEY || stored.tripoKey),
      anthropicSource: process.env.ANTHROPIC_API_KEY ? "environment" : stored.anthropicKey ? "local" : undefined,
      tripoSource: process.env.TRIPO_API_KEY ? "environment" : stored.tripoKey ? "local" : undefined
    };
  });

  app.post("/api/keys", async (req) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const next = writeKeys(dataDir, {
      anthropicKey: typeof body.anthropicKey === "string" ? body.anthropicKey : undefined,
      tripoKey: typeof body.tripoKey === "string" ? body.tripoKey : undefined
    });
    return {
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY || next.anthropicKey),
      tripo: Boolean(process.env.TRIPO_API_KEY || next.tripoKey),
      anthropicSource: process.env.ANTHROPIC_API_KEY ? "environment" : next.anthropicKey ? "local" : undefined,
      tripoSource: process.env.TRIPO_API_KEY ? "environment" : next.tripoKey ? "local" : undefined
    };
  });

  app.get("/api/projects", async () => {
    const rows = db
      .prepare(
        "SELECT id, name, source_dir, scene_type, model_style, created_at FROM projects ORDER BY created_at DESC"
      )
      .all() as unknown as ProjectRow[];
    return { projects: rows.map((project) => ({ ...project, hasSpace: existsSync(spacePath(dataDir, project.id)) })) };
  });

  app.post("/api/projects/validate-path", async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      return { sourceDir: await readableFolder(body.sourceDir) };
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.post("/api/projects", async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";

    if (!name || name.length > 120) {
      return reply.code(400).send({ error: "name is required (max 120 chars)" });
    }
    let sourceDir: string;
    try {
      sourceDir = await readableFolder(body.sourceDir);
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }

    const modelStyle = body.modelStyle === "sculpted" ? "sculpted" : "minimal";
    const project: ProjectRow = {
      id: randomUUID(),
      name,
      source_dir: sourceDir,
      scene_type: "codewalk", // legacy column — the product has ONE space kind (D1)
      model_style: modelStyle,
      created_at: new Date().toISOString()
    };
    db.prepare(
      "INSERT INTO projects (id, name, source_dir, scene_type, model_style, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(
      project.id,
      project.name,
      project.source_dir,
      project.scene_type,
      project.model_style,
      project.created_at
    );

    return { project };
  });

  app.get("/api/projects/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const project = getProject(db, id);
    if (!project) return reply.code(404).send({ error: "project not found" });
    const hasSpace = existsSync(spacePath(dataDir, id));
    const latest = db.prepare("SELECT id, kind FROM jobs WHERE project_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1")
      .get(id) as { id: string; kind: string } | undefined;
    const generation = latest?.kind === "space" ? latest : db.prepare(
      "SELECT id FROM jobs WHERE project_id = ? AND kind = 'space' ORDER BY created_at DESC, rowid DESC LIMIT 1"
    ).get(id) as { id: string } | undefined;
    const latestJob = latest ? getJob(db, latest.id) ?? null : null;
    return {
      project,
      hasSpace,
      generation: generationSettings(db, id) ?? null,
      latestJob,
      latestGenerationJob: generation?.id === latest?.id ? latestJob : generation ? getJob(db, generation.id) ?? null : null
    };
  });

  app.get("/api/projects/:id/analysis", async (req, reply) => {
    const { id } = req.params as { id: string };
    const query = req.query as { force?: string };
    const project = getProject(db, id);
    if (!project) return reply.code(404).send({ error: "project not found" });
    if (isWorkspaceUnderMaintenance(id)) return reply.code(409).send(WORKSPACE_BUSY);
    const release = tryAcquireWorkspaceOperation(id);
    if (!release) {
      if (query.force === "1") return reply.code(409).send(WORKSPACE_BUSY);
      try {
        const report: unknown = JSON.parse(await fs.readFile(path.join(projectDir(dataDir, id), "analysis.json"), "utf8"));
        return { report };
      } catch {
        return reply.code(409).send(WORKSPACE_BUSY);
      }
    }
    try {
      const report = await getOrCreateAnalysis(dataDir, project, query.force === "1");
      return { report };
    } catch (err) {
      return reply
        .code(500)
        .send({ error: `analysis failed: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      release();
    }
  });

  app.delete("/api/projects/:id/generation-cache", async (req, reply) => {
    const { id } = req.params as { id: string };
    const project = getProject(db, id);
    if (!project) return reply.code(404).send({ error: "project not found" });
    const release = hasActiveGuide(id) ? null : tryAcquireWorkspaceOperation(id, { maintenance: true });
    if (!release) return reply.code(409).send(WORKSPACE_BUSY);
    try {
      await clearWorkspaceCache(dataDir, project);
      return { ok: true };
    } catch (error) {
      return reply.code(409).send({ error: error instanceof AgentError ? error.message : "The local generation cache could not be cleared." });
    } finally {
      release();
    }
  });

  app.delete("/api/projects/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const project = getProject(db, id);
    if (!project) return reply.code(404).send({ error: "project not found" });
    const release = hasActiveGuide(id) ? null : tryAcquireWorkspaceOperation(id, { maintenance: true });
    if (!release) return reply.code(409).send(WORKSPACE_BUSY);
    try {
      return { ok: true, ...await removeWorkspace(db, dataDir, project) };
    } catch (error) {
      return reply.code(409).send({ error: error instanceof AgentError ? error.message : "The local workspace could not be removed." });
    } finally {
      release();
    }
  });

  // ---- Knowledge City (Scene JSON v0.2) ----

  app.post("/api/projects/:id/space", async (req, reply) => {
    const { id } = req.params as { id: string };
    const project = getProject(db, id);
    if (!project) return reply.code(404).send({ error: "project not found" });

    const body = (req.body ?? {}) as Record<string, unknown>;
    const prior = generationSettings(db, id);
    const brief = typeof body.brief === "string" ? body.brief.trim().slice(0, 2000) : prior?.brief ?? "";
    const language = typeof body.language === "string" && /^[a-zA-Z0-9-]{2,24}$/.test(body.language)
      ? body.language : prior?.language ?? "en";
    const agent = readAgent(body.agent) ?? prior?.agent ?? "claude";
    const model = readModel(body);
    const focusModule = body.focusModule === null ? undefined : typeof body.focusModule === "string" ? body.focusModule : prior?.focusModule ?? undefined;
    const refreshScan = typeof body.refreshScan === "boolean" ? body.refreshScan : prior?.refreshScan ?? true;
    const fresh = typeof body.fresh === "boolean" ? body.fresh : prior?.reuseCache === false;
    if (typeof body.model === "string" && body.model.trim() && !model) {
      return reply.code(400).send({ error: "Enter a valid model identifier or use the agent default." });
    }
    if (focusModule !== undefined && (!focusModule || focusModule.length > 400 || /[\u0000-\u001f]/.test(focusModule))) {
      return reply.code(400).send({ error: "Choose a focus module from the scan." });
    }

    const result = startSpaceJob({
      db,
      dataDir,
      project,
      brief,
      language,
      agent,
      model,
      focusModule,
      refreshScan,
      fresh
    });
    if ("error" in result) return reply.code(409).send({ error: result.error });
    db.prepare(`
      INSERT INTO project_generation (project_id, brief, language, agent, model, focus_module, refresh_scan, reuse_cache) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET
        brief = excluded.brief, language = excluded.language, agent = excluded.agent, model = excluded.model, focus_module = excluded.focus_module,
        refresh_scan = excluded.refresh_scan, reuse_cache = excluded.reuse_cache
    `).run(id, brief, language, agent, model ?? null, focusModule ?? null, refreshScan ? 1 : 0, fresh ? 0 : 1);
    return { jobId: result.jobId };
  });

  app.post("/api/projects/:id/jobs/:jobId/deliverables/:deliverableId/retry", async (req, reply) => {
    const { id, jobId, deliverableId } = req.params as { id: string; jobId: string; deliverableId: string };
    const project = getProject(db, id);
    const job = getJob(db, jobId);
    if (!project || !job || job.projectId !== id || job.kind !== "space") {
      return reply.code(404).send({ error: "Generation job not found." });
    }
    if (job.status === "queued" || job.status === "running") return reply.code(409).send(WORKSPACE_BUSY);
    const deliverable = job.deliverables?.find((item) => item.id === deliverableId);
    const replace = (req.body as { replace?: unknown } | undefined)?.replace === true;
    if (!deliverable || (!["pending", "failed", "timed-out"].includes(deliverable.state) &&
      !(job.status === "interrupted" && deliverable.state === "running") && !(replace && deliverable.state === "ready"))) {
      return reply.code(409).send({ error: "This focus artifact is not available to retry." });
    }
    const settings = generationSettings(db, id);
    if (!settings) return reply.code(409).send({ error: "Start a new generation to recover its saved settings." });
    const result = startSpaceJob({
      db, dataDir, project, brief: settings.brief, language: settings.language,
      agent: settings.agent, model: settings.model ?? undefined, refreshScan: false,
      resume: { jobId, deliverableId }
    });
    if ("error" in result) return reply.code(409).send({ error: result.error });
    return { jobId: result.jobId };
  });

  app.get("/api/projects/:id/space", async (req, reply) => {
    const { id } = req.params as { id: string };
    const project = getProject(db, id);
    if (!project) return reply.code(404).send({ error: "project not found" });
    if (isWorkspaceUnderMaintenance(id)) return reply.code(409).send(WORKSPACE_BUSY);
    try {
      return await readSavedSpace(dataDir, id, project.source_dir);
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ENOENT"
        ? reply.code(404).send({ error: "space not generated yet" })
        : reply.code(422).send({ error: "The saved city is invalid. Generate it again." });
    }
  });

  app.get("/api/projects/:id/city-preview", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!getProject(db, id)) return reply.code(404).send({ error: "project not found" });
    if (isWorkspaceUnderMaintenance(id)) return reply.code(409).send(WORKSPACE_BUSY);
    try {
      const { space, layout } = await readSavedSpace(dataDir, id);
      const focus = space.city.buildings.find(({ id }) => id === space.presentation?.start?.building);
      return { city: layout.city, focusId: focus?.id, focusTitle: focus?.title, savedAt: space.meta.createdAt };
    } catch {
      return reply.code(404).send({ error: "City map preview unavailable." });
    }
  });

  app.get("/api/projects/:id/jobs/:jobId/draft", async (req, reply) => {
    const { id, jobId } = req.params as { id: string; jobId: string };
    const job = getJob(db, jobId);
    const project = getProject(db, id);
    if (!project || job?.projectId !== id || !job.draftAvailable || isWorkspaceUnderMaintenance(id)) {
      return reply.code(404).send({ error: "Draft city unavailable." });
    }
    try {
      return await readSavedSpaceFile(generationDraftPath(dataDir, id, jobId), project.source_dir);
    } catch {
      return reply.code(404).send({ error: "Draft city unavailable." });
    }
  });

  app.get("/api/projects/:id/offers", async (req, reply) => {
    const { id } = req.params as { id: string };
    const project = getProject(db, id);
    if (!project) return reply.code(404).send({ error: "project not found" });
    try {
      const raw = await fs.readFile(offersPath(dataDir, id), "utf8");
      reply.header("content-type", "application/json");
      return reply.send(raw);
    } catch {
      return { offers: [] };
    }
  });

  // ---- Personal overlays (generated with the USER'S Tripo key, on click) ----

  app.get("/api/projects/:id/overlays", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { includeHidden } = req.query as { includeHidden?: string };
    const project = getProject(db, id);
    if (!project) return reply.code(404).send({ error: "project not found" });
    try {
      const raw = JSON.parse(await fs.readFile(overlaysPath(dataDir, id), "utf8")) as {
        items?: OverlayRecord[];
      };
      const buildings = await savedBuildingIdentities(spacePath(dataDir, id));
      const items = (raw.items ?? []).flatMap((item) => {
        const building = overlayBuilding(item, buildings);
        return building && (includeHidden === "1" || !item.hidden) ? [{
          ...item, building, url: `/api/projects/${id}/assets/${item.id}.glb`
        }] : [];
      });
      return { items };
    } catch {
      return { items: [] };
    }
  });

  app.patch("/api/projects/:id/overlays/:modelId", async (req, reply) => {
    const { id, modelId } = req.params as { id: string; modelId: string };
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (!getProject(db, id)) return reply.code(404).send({ error: "project not found" });
    if (!/^[a-f0-9]{16,64}$/.test(modelId) || typeof body.building !== "string" ||
        typeof body.class !== "string" || typeof body.hidden !== "boolean") {
      return reply.code(400).send({ error: "Choose a saved model and its visibility." });
    }
    const release = tryAcquireWorkspaceOperation(id);
    if (!release) return reply.code(409).send(WORKSPACE_BUSY);
    try {
      const file = overlaysPath(dataDir, id);
      const raw = JSON.parse(await fs.readFile(file, "utf8")) as { items?: OverlayRecord[] };
      const buildings = await savedBuildingIdentities(spacePath(dataDir, id));
      const overlay = raw.items?.find((item) => item.id === modelId && overlayBuilding(item, buildings) === body.building && item.class === body.class);
      if (!overlay) return reply.code(404).send({ error: "Saved model not found." });
      overlay.hidden = body.hidden;
      await atomicJson(file, raw);
      return { ok: true, hidden: overlay.hidden };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return reply.code(404).send({ error: "Saved model not found." });
      return reply.code(500).send({ error: "Could not update the saved model." });
    } finally {
      release();
    }
  });

  app.post("/api/projects/:id/offers/:index/generate", async (req, reply) => {
    const { id, index } = req.params as { id: string; index: string };
    const project = getProject(db, id);
    if (!project) return reply.code(404).send({ error: "project not found" });
    const offerIndex = Number(index);
    if (!Number.isInteger(offerIndex) || offerIndex < 0 || offerIndex > 64) {
      return reply.code(400).send({ error: "bad offer index" });
    }
    if (!getTripoKey(dataDir)) {
      return reply
        .code(400)
        .send({ error: "Add a Tripo key in Settings first." });
    }
    const result = startOverlayJob({ db, dataDir, project, offerIndex });
    if ("error" in result) return reply.code(409).send({ error: result.error });
    return { jobId: result.jobId };
  });

  /** Reading mode: a bounded, path-validated excerpt of a real source doc. */
  app.get("/api/projects/:id/doc", async (req, reply) => {
    const { id } = req.params as { id: string };
    const project = getProject(db, id);
    if (!project) return reply.code(404).send({ error: "project not found" });
    const query = req.query as { path?: string; from?: string; to?: string; outline?: string };
    const rel = typeof query.path === "string" ? query.path : "";
    if (!rel || rel.length > 500) return reply.code(400).send({ error: "path is required" });
    const lines = await createSourceReader(project.source_dir)(rel);
    if (!lines) return reply.code(404).send({ error: "Source file is unavailable." });
    const requestedFrom = Number(query.from ?? 1);
    const requestedTo = Number(query.to ?? requestedFrom + 199);
    if (!Number.isSafeInteger(requestedFrom) || !Number.isSafeInteger(requestedTo) ||
      requestedFrom < 1 || requestedTo < requestedFrom || requestedFrom > lines.length) {
      return reply.code(400).send({ error: "The source line range is invalid." });
    }
    const to = Math.min(lines.length, requestedTo, requestedFrom + 399);
    return {
      path: rel,
      from: requestedFrom,
      to,
      totalLines: lines.length,
      sections: /\.md$/i.test(rel) && query.outline === "1"
        ? indexMarkdown(lines.join("\n")).sections.filter((section) => section.kind === "section").slice(0, 100) : undefined,
      text: lines.slice(requestedFrom - 1, to).join("\n")
    };
  });

  /** Open a source file in the user's editor (local-only; path validated). */
  app.post("/api/projects/:id/open", async (req, reply) => {
    const { id } = req.params as { id: string };
    const project = getProject(db, id);
    if (!project) return reply.code(404).send({ error: "project not found" });
    const body = (req.body ?? {}) as Record<string, unknown>;
    const rel = typeof body.path === "string" ? body.path : "";
    if (!rel || rel.length > 500) return reply.code(400).send({ error: "path is required" });
    const abs = await resolveEvidencePath(project.source_dir, rel);
    if (!abs) return reply.code(404).send({ error: "Source file is unavailable." });
    try {
      if (!statSync(abs).isFile()) return reply.code(404).send({ error: "file not found" });
    } catch {
      return reply.code(404).send({ error: "file not found" });
    }
    const line = readPositiveLine(body.line);
    if (body.line !== undefined && line === undefined) {
      return reply.code(400).send({ error: "The source line is invalid." });
    }
    if (line) {
      const lines = await createSourceReader(project.source_dir)(rel);
      if (!lines || line > lines.length) {
        return reply.code(400).send({ error: "The source line is no longer available." });
      }
    }
    return openEditor(abs, line, body.action === "copy");
  });

  app.post("/api/projects/:id/ask", async (req, reply) => {
    const { id } = req.params as { id: string };
    const project = getProject(db, id);
    if (!project) return reply.code(404).send({ error: "project not found" });

    const body = (req.body ?? {}) as Record<string, unknown>;
    const question = typeof body.question === "string" ? body.question.trim().slice(0, 2000) : "";
    const prior = generationSettings(db, id);
    const language = typeof body.language === "string" && /^[a-zA-Z0-9-]{2,24}$/.test(body.language)
      ? body.language : prior?.language ?? "en";
    const agent = readAgent(body.agent) ?? prior?.agent ?? "claude";
    const model = readModel(body) ?? (prior?.agent === agent ? prior?.model ?? undefined : undefined);
    if (!question) return reply.code(400).send({ error: "question is required" });
    const draftJobId = typeof body.draftJobId === "string" ? body.draftJobId : undefined;
    if (draftJobId) {
      const job = getJob(db, draftJobId);
      if (job?.projectId !== id || !job.draftAvailable) return reply.code(404).send({ error: "Draft city unavailable." });
    }

    try {
      const result = await askGuide({
        dataDir,
        project,
        question,
        language,
        agent,
        model,
        draftJobId,
        focusRef: typeof body.focusRef === "string" ? body.focusRef.slice(0, 200) : undefined,
        scenarioId: typeof body.scenarioId === "string" ? body.scenarioId.slice(0, 100) : undefined,
        stepId: typeof body.stepId === "string" ? body.stepId.slice(0, 100) : undefined,
        stepIndex: typeof body.stepIndex === "number" && Number.isInteger(body.stepIndex) && body.stepIndex >= 0 && body.stepIndex < 32
          ? body.stepIndex : undefined,
        sourceStartLine: readPositiveLine(body.sourceStartLine),
        sourceEndLine: readPositiveLine(body.sourceEndLine),
        focusTitle: typeof body.focusTitle === "string" ? body.focusTitle.slice(0, 200) : undefined,
        focusSourcePath:
          typeof body.focusSourcePath === "string" ? body.focusSourcePath.slice(0, 300) : undefined
      });
      return result;
    } catch (err) {
      if (err instanceof AgentError) {
        const status = err.code === "ASK_BUSY" || err.code === "WORKSPACE_BUSY" ? 409 : 500;
        return reply.code(status).send({ error: `${err.code}: ${err.message}` });
      }
      return reply
        .code(500)
        .send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/jobs/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const job = getJob(db, id);
    if (!job) return reply.code(404).send({ error: "job not found" });
    return { job };
  });

  // ---- bundled model pack (@kodyurd/assets) ----

  app.get("/api/assets/manifest", async (_req, reply) => {
    return reply.send({ schemaVersion: 1, assets: installedPackRoles().map((role) => ({ role, file: `models/${role}.glb` })) });
  });

  app.get("/api/assets/pack/:file", async (req, reply) => {
    const { file } = req.params as { file: string };
    if (!/^[a-z0-9][a-z0-9.-]{0,80}\.glb$/.test(file)) {
      return reply.code(400).send({ error: "bad asset name" });
    }
    const dir = packDirectory();
    if (!dir) return reply.code(404).send({ error: "pack not installed" });
    const glb = packAssetPath(dir, file.slice(0, -4));
    if (!glb) return reply.code(404).send({ error: "model not in pack" });
    return reply
      .header("content-type", "model/gltf-binary")
      .header("cache-control", "public, max-age=86400")
      .send(createReadStream(glb));
  });

  /** Personal overlay models from the global Tripo cache (prompt-hash ids). */
  app.get("/api/projects/:id/assets/:file", async (req, reply) => {
    const { id, file } = req.params as { id: string; file: string };
    if (!/^[a-f0-9]{16,64}\.glb$/.test(file)) {
      return reply.code(400).send({ error: "bad asset name" });
    }
    if (!getProject(db, id) || isWorkspaceUnderMaintenance(id)) {
      return reply.code(404).send({ error: "asset not found" });
    }
    const modelId = file.slice(0, -4);
    const owned = await fs.readFile(overlaysPath(dataDir, id), "utf8")
      .then((text) => (JSON.parse(text) as { items?: { id: string }[] }).items?.some((item) => item.id === modelId))
      .catch(() => false);
    if (!owned) return reply.code(404).send({ error: "asset not found" });
    const glb = tripoCacheGlb(dataDir, modelId);
    if (!existsSync(glb)) return reply.code(404).send({ error: "asset not found" });
    return reply
      .header("content-type", "model/gltf-binary")
      .header("cache-control", "public, max-age=86400")
      .send(createReadStream(glb));
  });

  // ---- static export of the knowledge city ----

  app.post("/api/projects/:id/export", async (req, reply) => {
    const { id } = req.params as { id: string };
    const project = getProject(db, id);
    if (!project) return reply.code(404).send({ error: "project not found" });
    try {
      await buildSpaceExport(dataDir, project, uiDist);
      return { ok: true, zip: `/api/projects/${id}/export.zip` };
    } catch (err) {
      return reply
        .code(err instanceof AgentError && err.code === "WORKSPACE_BUSY" ? 409 : 400)
        .send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/projects/:id/export.zip", async (req, reply) => {
    const { id } = req.params as { id: string };
    const project = getProject(db, id);
    if (!project) return reply.code(404).send({ error: "project not found" });
    const zip = exportZipPath(dataDir, id);
    if (!existsSync(zip)) return reply.code(404).send({ error: "export not built yet" });
    const slug = project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "city";
    return reply
      .header("content-type", "application/zip")
      .header("content-disposition", `attachment; filename="kodyurd-${slug}.zip"`)
      .send(createReadStream(zip));
  });
}
