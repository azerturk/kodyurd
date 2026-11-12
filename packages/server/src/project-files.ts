import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
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

export async function atomicJson(file: string, value: unknown): Promise<void> {
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, JSON.stringify(value));
    await fs.rename(temp, file);
  } finally {
    await fs.rm(temp, { force: true }).catch(() => undefined);
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
