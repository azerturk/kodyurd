import { randomUUID } from "node:crypto";
import { promises as fs, renameSync, unlinkSync } from "node:fs";
import path from "node:path";
import { AgentError } from "./agents.js";
import { analyzeSource, INVENTORY_VERSION, type AnalyzerReport } from "./analyzer.js";

/** Where one workspace keeps its generated data inside the Kodyurd data directory. */

export function projectDir(dataDir: string, projectId: string): string {
  return path.join(dataDir, "projects", projectId);
}

export function spacePath(dataDir: string, projectId: string): string {
  return path.join(projectDir(dataDir, projectId), "space.json");
}

export function generationDir(dataDir: string, projectId: string, jobId: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) throw new AgentError("BAD_GENERATION_ID", "Invalid generation job ID.");
  return path.join(projectDir(dataDir, projectId), "generation", jobId);
}

export function generationDraftPath(dataDir: string, projectId: string, jobId: string): string {
  return path.join(generationDir(dataDir, projectId, jobId), "draft.json");
}

export function offersPath(dataDir: string, projectId: string): string {
  return path.join(projectDir(dataDir, projectId), "offers.json");
}

export function overlaysPath(dataDir: string, projectId: string): string {
  return path.join(projectDir(dataDir, projectId), "overlays.json");
}

export async function atomicJson(file: string, value: unknown, beforeCommit?: () => void): Promise<void> {
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, JSON.stringify(value));
    if (beforeCommit) {
      // A Stop event must not run after the guard but before the published rename.
      beforeCommit();
      renameSync(temp, file);
    } else await fs.rename(temp, file);
  } finally {
    await fs.rm(temp, { force: true }).catch(() => undefined);
  }
}

interface JsonWrite { file: string; value: unknown }

/** Publish matching offers and city together without an event-loop gap between their commits. */
export async function atomicJsonPair(entries: readonly [JsonWrite, JsonWrite], beforeCommit: () => void): Promise<void> {
  const staged = entries.map(({ file, value }) => ({ file, value, temp: `${file}.${randomUUID()}.tmp` }));
  const backup = `${entries[0].file}.${randomUUID()}.previous.tmp`;
  try {
    const previous = await fs.readFile(entries[0].file).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    const writes = await Promise.allSettled(staged.map(({ temp, value }) => fs.writeFile(temp, JSON.stringify(value))));
    const failed = writes.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
    if (previous !== undefined) await fs.writeFile(backup, previous);
    beforeCommit();
    renameSync(staged[0].temp, staged[0].file);
    try {
      renameSync(staged[1].temp, staged[1].file);
    } catch (error) {
      // The city remains the publication boundary if its replacement fails.
      if (previous !== undefined) renameSync(backup, staged[0].file);
      else unlinkSync(staged[0].file);
      throw error;
    }
  } finally {
    await Promise.allSettled([...staged.map(({ temp }) => temp), backup].map((file) => fs.rm(file, { force: true })));
  }
}

/** The workspace scan, reused until the inventory format changes or a fresh scan is asked for. */
export async function getOrCreateAnalysis(
  dataDir: string,
  project: { id: string; source_dir: string },
  force = false
): Promise<AnalyzerReport> {
  const file = path.join(projectDir(dataDir, project.id), "analysis.json");
  if (!force) {
    try {
      const report = JSON.parse(await fs.readFile(file, "utf8")) as AnalyzerReport;
      if (report.inventoryVersion === INVENTORY_VERSION) return report;
    } catch {
      /* no cache yet */
    }
  }
  const report = await analyzeSource(project.source_dir);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await atomicJson(file, report);
  return report;
}
