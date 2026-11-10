import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

/**
 * node:sqlite is stable in Node >= 22.5, but its typings differ across
 * @types/node versions — so we load it dynamically behind a typed facade.
 */
export interface SqliteStatement {
  all(...args: unknown[]): unknown[];
  get(...args: unknown[]): unknown;
  run(...args: unknown[]): unknown;
}
export interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

const requireModule = createRequire(import.meta.url);

export function openDb(dataDir: string): SqliteDb {
  mkdirSync(dataDir, { recursive: true });
  const { DatabaseSync } = requireModule("node:sqlite") as {
    DatabaseSync: new (path: string) => SqliteDb;
  };
  const db = new DatabaseSync(join(dataDir, "kodyurd.db"));
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      source_dir TEXT NOT NULL,
      scene_type TEXT NOT NULL DEFAULT 'codewalk',
      model_style TEXT NOT NULL DEFAULT 'minimal',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      log TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS jobs_project_created ON jobs (project_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS project_generation (
      project_id TEXT PRIMARY KEY REFERENCES projects(id),
      brief TEXT NOT NULL,
      language TEXT NOT NULL,
      agent TEXT NOT NULL,
      model TEXT,
      focus_module TEXT,
      refresh_scan INTEGER NOT NULL DEFAULT 1,
      reuse_cache INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS workspace_removals (
      project_id TEXT PRIMARY KEY
    );
  `);
  // Migration for databases created before model_style existed.
  try {
    db.exec("ALTER TABLE projects ADD COLUMN model_style TEXT NOT NULL DEFAULT 'minimal'");
  } catch {
    /* column already exists */
  }
  const settingsColumns = db.prepare("PRAGMA table_info(project_generation)").all() as { name: string }[];
  if (!settingsColumns.some(({ name }) => name === "refresh_scan")) {
    db.exec("ALTER TABLE project_generation ADD COLUMN refresh_scan INTEGER NOT NULL DEFAULT 1");
  }
  if (!settingsColumns.some(({ name }) => name === "reuse_cache")) {
    db.exec("ALTER TABLE project_generation ADD COLUMN reuse_cache INTEGER NOT NULL DEFAULT 1");
  }
  if (!settingsColumns.some(({ name }) => name === "focus_module")) {
    db.exec("ALTER TABLE project_generation ADD COLUMN focus_module TEXT");
  }
  return db;
}
