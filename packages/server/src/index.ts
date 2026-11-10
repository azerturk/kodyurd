import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { openDb, type SqliteDb } from "./db.js";
import { registerApi } from "./routes.js";
import { recoverWorkspaceRemovals } from "./workspace-maintenance.js";

export { runDoctor, checkCommand } from "./doctor.js";
export type { DoctorCheck } from "./doctor.js";
export { detectAgents } from "./agents.js";
export type { AgentInfo, AgentId } from "./agents.js";
export { analyzeSource, summarizeForPrompt } from "./analyzer.js";
export type { AnalyzerReport } from "./analyzer.js";

export interface ServerOptions {
  /** Directory for SQLite and app data, e.g. ~/.kodyurd */
  dataDir: string;
  /** Absolute path to the built UI (dist). If missing, a JSON placeholder is served. */
  uiDist?: string;
  port?: number;
  version?: string;
}

export interface RunningServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

export async function startServer(opts: ServerOptions): Promise<RunningServer> {
  const app = Fastify({ logger: false });
  const db: SqliteDb = openDb(opts.dataDir);
  const version = opts.version ?? "0.1.0";

  registerApi(app, { db, dataDir: opts.dataDir, version, uiDist: opts.uiDist });

  if (opts.uiDist && existsSync(opts.uiDist)) {
    await app.register(fastifyStatic, { root: opts.uiDist });
    app.setNotFoundHandler((req, reply) => {
      const url = req.raw.url ?? "";
      if (url.startsWith("/api/")) {
        void reply.code(404).send({ error: "not found" });
        return;
      }
      // SPA fallback
      void reply.sendFile("index.html");
    });
  } else {
    app.get("/", async () => ({
      ok: true,
      note: "UI bundle not found. Run: npm run build -w @kodyurd/ui"
    }));
  }

  const port = opts.port ?? 4717;
  try {
    await app.listen({ port, host: "127.0.0.1" });
    db.prepare(
      "UPDATE jobs SET status = 'interrupted', updated_at = ? WHERE status IN ('queued', 'running')"
    ).run(new Date().toISOString());
    await recoverWorkspaceRemovals(db, opts.dataDir);
  } catch (error) {
    await app.close();
    db.close();
    throw error;
  }

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    close: async () => {
      await app.close();
      db.close();
    }
  };
}
