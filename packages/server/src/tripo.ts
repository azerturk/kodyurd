import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { TSceneDocument } from "@kodyurd/scene-schema";
import { getTripoKey } from "./config.js";

/**
 * Tripo text-to-model pipeline. See docs/skills/tripo.md for the receipt protocol.
 * - A receipt is persisted BEFORE the paid submit.
 * - An ambiguous submit sets state "unknown" and permanently blocks a
 *   re-submit for that prompt (reconcile happens via the stored taskId).
 * - Models are cached GLOBALLY by prompt hash (~/.kodyurd/tripo-cache), so the
 *   same prop is never generated twice across scenes or projects.
 * - Any failure degrades gracefully: the item keeps its built-in geometry and
 *   the job log says why.
 */

/** Tripo's global v3 API for personal keys. */
const BASE = "https://openapi.tripo3d.ai/v3";
const MODEL = "P2-20260801";
const MAX_MODELS_PER_SCENE = 8;
const POLL_MS = 5000;
const PER_MODEL_TIMEOUT_MS = 8 * 60_000;
const REQUEST_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_GLB_BYTES = 40 * 1024 * 1024;

// Documented request-level rejections. Server errors and non-JSON responses
// cannot establish whether a task was created.
const REJECTION_CODES = new Map([
  [400, [1003, 1004, 2002, 2003, 2004, 2008, 2015, 2018]],
  [401, [2, 1002]],
  [403, [2010]],
  [404, [4001]],
  [429, [1007, 2000]]
]);

export class TripoError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
    this.name = "TripoError";
  }
}

interface Receipt {
  state: "submitting" | "submitted" | "unknown" | "failed" | "ready" | "rejected";
  prompt: string;
  taskId?: string;
  attempt?: number;
  updatedAt: string;
}

function cacheDir(dataDir: string): string {
  return path.join(dataDir, "tripo-cache");
}

function idFor(prompt: string): string {
  return createHash("sha256")
    .update(JSON.stringify({ v: 1, provider: "tripo-rest", type: "text_to_model", prompt }))
    .digest("hex")
    .slice(0, 32);
}

const fileErrorCode = (error: unknown): string | undefined => (error as NodeJS.ErrnoException | null)?.code;

function unknownSubmit(): TripoError {
  return new TripoError(
    "TRIPO_SUBMIT_UNKNOWN",
    "The model submission could not be confirmed. This prompt is blocked until the task is reconciled."
  );
}

function validTaskId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

async function readReceipt(dir: string, id: string, prompt: string): Promise<Receipt | undefined> {
  let data: string;
  try {
    data = await fs.readFile(path.join(dir, `${id}.json`), "utf8");
  } catch (error) {
    if (fileErrorCode(error) === "ENOENT") return undefined;
    throw new TripoError("TRIPO_RECEIPT", "The existing model receipt could not be read.");
  }
  try {
    const receipt = JSON.parse(data) as Receipt;
    if (receipt?.prompt !== prompt || typeof receipt.updatedAt !== "string" ||
      !["submitting", "submitted", "unknown", "failed", "ready", "rejected"].includes(receipt.state) ||
      (receipt.taskId !== undefined && !validTaskId(receipt.taskId)) ||
      (receipt.attempt !== undefined && (!Number.isSafeInteger(receipt.attempt) || receipt.attempt < 1)) ||
      (receipt.state === "rejected" && (receipt.attempt === undefined || receipt.taskId !== undefined))) {
      throw new Error("Invalid receipt");
    }
    return receipt;
  } catch {
    throw new TripoError("TRIPO_RECEIPT", "The existing model receipt is invalid. The prompt requires reconciliation.");
  }
}

async function syncDirectory(dir: string): Promise<void> {
  // Windows does not expose directory handles for fsync through Node's fs API.
  if (process.platform === "win32") return;
  const handle = await fs.open(dir, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

async function writeAtomically(target: string, data: string | Buffer): Promise<void> {
  const temp = `${target}.${randomUUID()}.tmp`;
  const handle = await fs.open(temp, "wx", 0o600);
  try {
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temp, target);
    await syncDirectory(path.dirname(target));
  } finally {
    await fs.unlink(temp).catch(() => undefined);
  }
}

async function writeReceipt(dir: string, id: string, receipt: Receipt): Promise<void> {
  await writeAtomically(path.join(dir, `${id}.json`), JSON.stringify(receipt, null, 2));
}

/** An exclusive claim survives both a process crash and a stale concurrent read. */
async function claimSubmit(dir: string, id: string, attempt: number): Promise<boolean> {
  try {
    const handle = await fs.open(path.join(dir, `${id}.${attempt}.claim`), "wx", 0o600);
    try { await handle.sync(); } finally { await handle.close(); }
    await syncDirectory(dir);
    return true;
  } catch (error) {
    if (fileErrorCode(error) === "EEXIST") return false;
    throw new TripoError("TRIPO_RECEIPT", "The model submission claim could not be saved.");
  }
}

async function readBody(res: Response, maxBytes: number, tooBig: TripoError): Promise<Buffer> {
  if (Number(res.headers.get("content-length")) > maxBytes) {
    await res.body?.cancel();
    throw tooBig;
  }
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return Buffer.concat(chunks, size);
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw tooBig;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
}

async function tripoFetch(key: string, pathname: string, timeoutMs: number, prompt?: string): Promise<unknown> {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const res = await fetch(`${BASE}${pathname}`, {
      method: prompt === undefined ? "GET" : "POST",
      body: prompt === undefined ? undefined : JSON.stringify({ prompt, model: MODEL, face_limit: 12_000 }),
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      redirect: "error",
      signal
    });
    const bytes = await readBody(res, MAX_RESPONSE_BYTES, new TripoError("TRIPO_PROTOCOL", "Tripo response exceeded its size limit."));
    let body: unknown;
    try { body = JSON.parse(bytes.toString("utf8")); }
    catch { throw new TripoError("TRIPO_PROTOCOL", `Tripo returned non-JSON (HTTP ${res.status}).`); }
    if (!res.ok) {
      const code = (body as { code?: unknown } | null)?.code;
      if (prompt !== undefined) {
        if (taskStatus(body).taskId) return body;
        if (typeof code === "number" && REJECTION_CODES.get(res.status)?.includes(code)) {
          throw new TripoError("TRIPO_REJECTED", `Tripo rejected model creation (HTTP ${res.status}, code ${code}).`);
        }
      }
      throw new TripoError("TRIPO_HTTP", `Tripo returned HTTP ${res.status}.`);
    }
    return body;
  } catch (error) {
    if (error instanceof TripoError) throw error;
    if (signal.aborted) throw new TripoError("TRIPO_TIMEOUT", "The Tripo request timed out.");
    throw new TripoError("TRIPO_NETWORK", "The Tripo request could not be completed.");
  }
}

/** Deep-scan a response for the first .glb URL — tolerant to API shape drift. */
function findGlbUrl(value: unknown): string | undefined {
  if (typeof value === "string") {
    const url = URL.parse(value);
    return url?.protocol === "https:" && !url.username && !url.password && url.pathname.toLowerCase().endsWith(".glb")
      ? url.href : undefined;
  }
  if (Array.isArray(value)) {
    for (const v of value) {
      const hit = findGlbUrl(v);
      if (hit) return hit;
    }
    return undefined;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) {
      const hit = findGlbUrl(v);
      if (hit) return hit;
    }
  }
  return undefined;
}

function taskStatus(body: unknown): { status?: string; taskId?: string; raw: unknown } {
  const envelope = body as { data?: unknown } | null;
  const data = (envelope?.data ?? body ?? {}) as Record<string, unknown>;
  return {
    status: typeof data.status === "string" ? data.status : undefined,
    taskId: validTaskId(data.task_id) ? data.task_id : undefined,
    raw: data
  };
}

async function pollUntilDone(
  key: string,
  taskId: string,
  onProgress: (text: string) => void
): Promise<string> {
  const deadline = Date.now() + PER_MODEL_TIMEOUT_MS;
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new TripoError("TRIPO_TIMEOUT", "Model generation timed out.");
    const body = await tripoFetch(key, `/tasks/${encodeURIComponent(taskId)}`, Math.min(remaining, REQUEST_TIMEOUT_MS));
    const { status, raw } = taskStatus(body);
    if (status === "success") {
      const url = findGlbUrl(raw);
      if (!url) throw new TripoError("TRIPO_NO_GLB", "Task succeeded but no HTTPS GLB URL was found.");
      return url;
    }
    if (!status) throw new TripoError("TRIPO_PROTOCOL", "Tripo returned no task status.");
    if (["failed", "cancelled", "banned", "expired"].includes(status)) {
      throw new TripoError("TRIPO_FAILED", "The Tripo task ended without a usable model.");
    }
    const progress = (raw as { progress?: unknown }).progress;
    onProgress(typeof progress === "number" && Number.isFinite(progress)
      ? `sculpting ${Math.round(Math.max(0, Math.min(100, progress)))}%` : "sculpting...");
    await delay(Math.max(0, Math.min(POLL_MS, deadline - Date.now())));
  }
}

function validGlb(header: Buffer, size: number): boolean {
  return header.length >= 12 && size >= 1000 && size <= MAX_GLB_BYTES &&
    header.readUInt32LE(0) === 0x46546c67 && header.readUInt32LE(4) === 2 && header.readUInt32LE(8) === size;
}

async function cachedGlb(file: string): Promise<"ready" | "missing" | "invalid"> {
  let handle;
  try { handle = await fs.open(file, "r"); }
  catch (error) {
    if (fileErrorCode(error) === "ENOENT") return "missing";
    throw new TripoError("TRIPO_CACHE", "The cached model could not be opened.");
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) return "invalid";
    const header = Buffer.alloc(12);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    return validGlb(header.subarray(0, bytesRead), stat.size) ? "ready" : "invalid";
  } finally {
    await handle.close();
  }
}

async function download(url: string, target: string): Promise<void> {
  const signal = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
  let bytes: Buffer;
  try {
    const res = await fetch(url, { redirect: "error", signal });
    if (!res.ok) {
      await res.body?.cancel();
      throw new TripoError("TRIPO_DOWNLOAD", `Model download returned HTTP ${res.status}.`);
    }
    bytes = await readBody(res, MAX_GLB_BYTES, new TripoError("TRIPO_GLB_TOO_BIG", "Downloaded GLB exceeds 40 MiB."));
  } catch (error) {
    if (error instanceof TripoError) throw error;
    throw new TripoError("TRIPO_DOWNLOAD", signal.aborted ? "Model download timed out." : "Model download could not be completed.");
  }
  if (!validGlb(bytes, bytes.length)) throw new TripoError("TRIPO_GLB_INVALID", "Downloaded file is not a complete GLB.");
  await writeAtomically(target, bytes);
}

async function submitModel(dir: string, id: string, key: string, prompt: string, previous?: Receipt): Promise<Receipt> {
  // Legacy failures without a task ID are ambiguous because the previous
  // implementation also marked malformed responses and server errors failed.
  if (previous && previous.state !== "rejected") throw unknownSubmit();
  const attempt = (previous?.attempt ?? 0) + 1;
  if (!await claimSubmit(dir, id, attempt)) {
    const current = await readReceipt(dir, id, prompt);
    if (current?.taskId) return current;
    throw new TripoError("TRIPO_SUBMIT_CLAIMED", "This model submission is already in progress or was interrupted. Check the existing model task.");
  }
  const receipt: Receipt = { state: "submitting", attempt, prompt, updatedAt: new Date().toISOString() };
  await writeReceipt(dir, id, receipt);

  let taskId: string | undefined;
  try {
    const body = await tripoFetch(key, "/generation/text-to-model", REQUEST_TIMEOUT_MS, prompt);
    taskId = taskStatus(body).taskId;
  } catch (error) {
    if (error instanceof TripoError && error.code === "TRIPO_REJECTED") {
      await writeReceipt(dir, id, { ...receipt, state: "rejected", updatedAt: new Date().toISOString() });
      throw error;
    }
  }
  if (!taskId) {
    await writeReceipt(dir, id, { ...receipt, state: "unknown", updatedAt: new Date().toISOString() });
    throw unknownSubmit();
  }
  const submitted: Receipt = { ...receipt, state: "submitted", taskId, updatedAt: new Date().toISOString() };
  await writeReceipt(dir, id, submitted);
  return submitted;
}

/** Returns the cache id of a ready model for this prompt (generating it if needed). */
async function ensureModel(
  dataDir: string,
  key: string,
  prompt: string,
  onProgress: (text: string) => void
): Promise<string> {
  const dir = cacheDir(dataDir);
  await fs.mkdir(dir, { recursive: true });
  const id = idFor(prompt);
  const glbPath = path.join(dir, `${id}.glb`);
  const cached = await cachedGlb(glbPath);
  if (cached === "ready") return id;
  const prior = await readReceipt(dir, id, prompt);
  if (cached === "invalid" && !prior?.taskId) {
    throw new TripoError("TRIPO_CACHE", "An incomplete cached model has no task ID to resume.");
  }
  const receipt = prior?.taskId ? prior : await submitModel(dir, id, key, prompt, prior);
  if (!receipt.taskId) throw unknownSubmit();

  const url = await pollUntilDone(key, receipt.taskId, onProgress);
  await download(url, glbPath);
  await writeReceipt(dir, id, { ...receipt, state: "ready", updatedAt: new Date().toISOString() });
  return id;
}

export function tripoCacheGlb(dataDir: string, id: string): string {
  return path.join(cacheDir(dataDir), `${id}.glb`);
}

export interface EnsureModelsArgs {
  dataDir: string;
  projectId: string;
  scene: TSceneDocument;
  stage: (text: string) => void;
}

/**
 * Walks the scene, generates (or reuses cached) models for items that carry a
 * `model.prompt`, and sets `modelUrl`. Never throws: every failure is logged
 * and that item keeps its built-in geometry.
 */
export async function ensureSceneModels(args: EnsureModelsArgs): Promise<TSceneDocument> {
  const key = getTripoKey(args.dataDir);
  const wanted: { title: string; prompt: string; set: (url: string) => void }[] = [];
  for (const zone of args.scene.zones) {
    for (const item of zone.items) {
      if (item.model?.prompt && wanted.length < MAX_MODELS_PER_SCENE) {
        wanted.push({
          title: item.title,
          prompt: item.model.prompt,
          set: (url) => {
            item.modelUrl = url;
          }
        });
      }
    }
  }
  if (wanted.length === 0) {
    args.stage("No sculpt briefs in this scene — built-in geometry everywhere.");
    return args.scene;
  }
  if (!key) {
    args.stage(
      "Tripo key not set — using built-in geometry for all items (add a key on the connect screen to enable sculpted models)."
    );
    return args.scene;
  }

  let done = 0;
  for (const target of wanted) {
    try {
      args.stage(`Model ${done + 1}/${wanted.length}: "${target.title}" — checking cache...`);
      const id = await ensureModel(args.dataDir, key, target.prompt, (p) =>
        args.stage(`Model ${done + 1}/${wanted.length}: "${target.title}" — ${p}`)
      );
      target.set(`/api/projects/${args.projectId}/assets/${id}.glb`);
      args.stage(`Model ready: "${target.title}".`);
    } catch (err) {
      const code = err instanceof TripoError ? err.code : "TRIPO_FAILED";
      args.stage(`Model skipped ("${target.title}"): ${code} — built-in geometry stays.`);
    }
    done += 1;
  }
  return args.scene;
}

/**
 * One offered overlay model, generated with the USER'S key (never ours).
 * Same receipt law + global prompt-hash cache as every Tripo call.
 * Returns the cache id; the GLB lives at tripoCacheGlb(dataDir, id).
 */
export async function generateOverlayModel(
  dataDir: string,
  prompt: string,
  onProgress: (text: string) => void
): Promise<string> {
  const key = getTripoKey(dataDir);
  if (!key) {
    throw new TripoError("TRIPO_NO_KEY", "No Tripo key — add one on the connect screen first.");
  }
  return ensureModel(dataDir, key, prompt, onProgress);
}
