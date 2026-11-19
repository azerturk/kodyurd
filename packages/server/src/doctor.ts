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

const adapterChecks = new Map<string, { checkedAt: number; result: { found: boolean; detail: string } }>();

/** Help/version probes never read a workspace or send an inference request. */
export function checkAgentCommand(agent: "claude" | "codex"): { found: boolean; detail: string } {
  const version = checkCommand(agent);
  if (!version.found) return version;
  const key = JSON.stringify([agent, process.env.PATH, version.detail]);
  const cached = adapterChecks.get(key);
  if (cached && Date.now() - cached.checkedAt < 60_000) return cached.result;
  const help = (args: string[]): string | undefined => {
    const command = localCommand(agent, args);
    if (!command) return undefined;
    try {
      const result = spawnSync(command.file, command.args, {
        windowsVerbatimArguments: command.windowsVerbatimArguments, windowsHide: true,
        encoding: "utf8", timeout: 5_000, maxBuffer: 256 * 1024
      });
      return !result.error && result.status === 0 ? `${result.stdout ?? ""}\n${result.stderr ?? ""}` : undefined;
    } catch {
      return undefined;
    }
  };
  const root = help(["--help"]);
  const execution = agent === "codex" ? help(["exec", "--help"]) : root;
  const commonFlags = agent === "claude"
    ? ["--output-format", "--verbose", "--safe-mode", "--restricted", "--strict-mcp-config", "--no-session-persistence", "--permission-mode", "--tools"]
    : ["--ask-for-approval", "--disable"];
  const executionFlags = agent === "codex"
    ? ["--skip-git-repo-check", "--sandbox", "--ephemeral", "--ignore-user-config", "--ignore-rules"] : [];
  const supported = root !== undefined && execution !== undefined &&
    commonFlags.every((flag) => root.includes(flag)) && executionFlags.every((flag) => execution.includes(flag)) &&
    (agent !== "codex" || root.includes("--config") || /(?:^|\s)-c(?:\s|,)/m.test(root));
  const result = supported ? version : {
    found: false,
    detail: `${agent} is installed; its help does not confirm the runner's required isolation flags. Update the CLI.`
  };
  if (adapterChecks.size >= 20) adapterChecks.clear();
  adapterChecks.set(key, { checkedAt: Date.now(), result });
  return result;
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

  const claude = checkAgentCommand("claude");
  checks.push({ name: "Claude CLI", ...claude, optional: true });

  const codex = checkAgentCommand("codex");
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
