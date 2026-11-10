import { spawnSync } from "node:child_process";
import { getAnthropicKey, getTripoKey } from "./config.js";
import { localCommand } from "./local-command.js";

export interface DoctorCheck {
  name: string;
  found: boolean;
  detail: string;
  optional: boolean;
}

export function checkCommand(cmd: string): { found: boolean; detail: string } {
  try {
    const command = localCommand(cmd, ["--version"]);
    if (!command) return { found: false, detail: "not found" };
    const res = spawnSync(command.file, command.args, {
      encoding: "utf8",
      windowsHide: true,
      windowsVerbatimArguments: command.windowsVerbatimArguments,
      timeout: 8000
    });
    if (res.error || res.status !== 0) return { found: false, detail: "not found" };
    const out = (res.stdout || res.stderr || "").trim().split("\n")[0] ?? "";
    return { found: true, detail: out.slice(0, 80) || "found" };
  } catch {
    return { found: false, detail: "not found" };
  }
}

/**
 * Environment check. Generation needs at least one available agent.
 */
export function runDoctor(dataDir?: string): DoctorCheck[] {
  const checks: DoctorCheck[] = [];

  checks.push({
    name: "Node.js",
    found: true,
    detail: process.version,
    optional: false
  });

  const claude = checkCommand("claude");
  checks.push({ name: "Claude CLI", ...claude, optional: true });

  const codex = checkCommand("codex");
  checks.push({ name: "Codex CLI", ...codex, optional: true });

  const anthropicKey = Boolean(getAnthropicKey(dataDir));
  const hasAgent = claude.found || codex.found || anthropicKey;
  checks.push({
    name: "Generation agent",
    found: hasAgent,
    detail: hasAgent ? "available" : "connect Claude Code, Codex, or the Anthropic API in Settings",
    optional: false
  });
  checks.push({
    name: "Anthropic API key",
    found: anthropicKey,
    detail: anthropicKey ? "set" : "not set — add it in Settings or via ANTHROPIC_API_KEY",
    optional: true
  });

  const tripoKey = Boolean(getTripoKey(dataDir));
  checks.push({
    name: "Tripo API key",
    found: tripoKey,
    detail: tripoKey ? "set" : "not set — needed for personal models",
    optional: true
  });

  const blender = checkCommand("blender");
  checks.push({
    name: "Blender",
    found: blender.found,
    detail: blender.found ? blender.detail : "not found — optional quality pipeline",
    optional: true
  });

  return checks;
}
