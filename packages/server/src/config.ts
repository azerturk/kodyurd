import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Local key store: ~/.kodyurd/config.json (0600 where the OS supports it).
 * Environment variables always win over stored values.
 */
export interface KeyStore {
  anthropicKey?: string;
  tripoKey?: string;
}

function configPath(dataDir: string): string {
  return join(dataDir, "config.json");
}

export function readKeys(dataDir: string): KeyStore {
  try {
    const raw = readFileSync(configPath(dataDir), "utf8");
    const value = JSON.parse(raw) as KeyStore;
    return {
      anthropicKey: typeof value.anthropicKey === "string" ? value.anthropicKey : undefined,
      tripoKey: typeof value.tripoKey === "string" ? value.tripoKey : undefined
    };
  } catch {
    return {};
  }
}

export function writeKeys(dataDir: string, patch: KeyStore): KeyStore {
  mkdirSync(dataDir, { recursive: true });
  const current = readKeys(dataDir);
  const next: KeyStore = { ...current };
  if (patch.anthropicKey !== undefined) {
    next.anthropicKey = patch.anthropicKey.trim() || undefined;
  }
  if (patch.tripoKey !== undefined) {
    next.tripoKey = patch.tripoKey.trim() || undefined;
  }
  const file = configPath(dataDir);
  writeFileSync(file, JSON.stringify(next, null, 2));
  try {
    chmodSync(file, 0o600);
  } catch {
    /* Windows: ACLs apply instead */
  }
  return next;
}

export function getAnthropicKey(dataDir?: string): string | undefined {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  if (dataDir && existsSync(configPath(dataDir))) return readKeys(dataDir).anthropicKey;
  return undefined;
}

export function getTripoKey(dataDir?: string): string | undefined {
  if (process.env.TRIPO_API_KEY) return process.env.TRIPO_API_KEY;
  if (dataDir && existsSync(configPath(dataDir))) return readKeys(dataDir).tripoKey;
  return undefined;
}
