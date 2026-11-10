import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkCommand } from "./doctor.js";
import { getAnthropicKey } from "./config.js";
import { localCommand, windowsSystemExecutable } from "./local-command.js";
import type { SceneReference } from "./scene-reference.js";

export type AgentId = "claude" | "codex" | "api";

export class AgentError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
    this.name = "AgentError";
  }
}

export interface AgentInfo {
  id: AgentId;
  available: boolean;
  detail: string;
  implemented: boolean;
  /** Whether the runner supports explicitly enabled workspace discovery. */
  readsFiles: boolean;
}

export function detectAgents(dataDir?: string): AgentInfo[] {
  const claude = checkCommand("claude");
  const codex = checkCommand("codex");
  const apiKey = Boolean(getAnthropicKey(dataDir));
  return [
    { id: "claude", available: claude.found, detail: claude.detail, implemented: true, readsFiles: true },
    { id: "codex", available: codex.found, detail: codex.detail, implemented: true, readsFiles: true },
    {
      id: "api",
      available: apiKey,
      detail: apiKey ? "API key set" : "add a key on the connect screen",
      implemented: true,
      readsFiles: false
    }
  ];
}

export interface AgentRunOptions {
  prompt: string;
  /** Project source directory, used only for explicit workspace discovery. */
  cwd: string;
  timeoutMs: number;
  /** App data dir (for stored API keys). */
  dataDir?: string;
  /** Optional model override — claude --model / codex -m / API model id. */
  model?: string;
  reference?: SceneReference;
  /** Default: only the supplied packet. Set false for CLI workspace discovery. */
  packetOnly?: boolean;
  maxTokens?: number;
  /** Live activity callback (claude only): short human-readable lines like "Read src/x.ts". */
  onEvent?: (text: string) => void;
}

const cliVision = new Map<"claude" | "codex", boolean>();
const CLI_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9.:/_-]{0,63}$/;

/** Probe local adapter flags only. Never send a model request from preflight. */
export function supportsSceneReference(agent: AgentId, reference: SceneReference): boolean {
  if (agent === "api") return true;
  if (agent === "codex" && !localCommand(agent, ["--image", reference.file])) return false;
  const cached = cliVision.get(agent);
  if (cached !== undefined) return cached;
  const command = localCommand(agent, agent === "codex" ? ["exec", "--help"] : ["--help"]);
  if (!command) return false;
  const result = spawnSync(command.file, command.args, {
    windowsVerbatimArguments: command.windowsVerbatimArguments, windowsHide: true, encoding: "utf8", timeout: 5_000
  });
  if (result.error || result.status !== 0) return false;
  const help = result.stdout ?? "";
  const supported = agent === "codex" ? help.includes("--image") : help.includes("--input-format") && help.includes("stream-json");
  cliVision.set(agent, supported);
  return supported;
}

function imageContent(reference: SceneReference) {
  return { type: "image", source: { type: "base64", media_type: "image/png", data: reference.bytes.toString("base64") } };
}

/** Spawn a CLI, pass the prompt via STDIN (argv breaks on long prompts), collect stdout. */
async function runCliAgent(
  command: string,
  args: string[],
  opts: AgentRunOptions,
  label: string,
  onStdout?: (chunk: string) => void,
  input = opts.prompt
): Promise<string> {
  if (opts.model && !CLI_MODEL_ID.test(opts.model)) {
    throw new AgentError("AGENT_MODEL_INVALID", "The selected CLI model name contains unsupported characters.");
  }
  const launch = localCommand(command, args);
  if (!launch) {
    throw new AgentError("AGENT_SPAWN_FAILED", `Could not resolve a safe \`${command}\` CLI invocation. Check its installation and PATH.`);
  }
  let cwd = opts.cwd;
  const packetOnly = opts.packetOnly !== false;
  if (packetOnly) {
    try {
      cwd = await mkdtemp(path.join(tmpdir(), "kodyurd-agent-"));
    } catch {
      throw new AgentError("AGENT_SPAWN_FAILED", "Could not create a temporary working directory for the agent.");
    }
  }
  try {
    return await collectCliOutput(launch, cwd, opts, label, onStdout, input);
  } finally {
    if (packetOnly) await rmdir(cwd).catch(() => undefined);
  }
}

function collectCliOutput(
  launch: NonNullable<ReturnType<typeof localCommand>>,
  cwd: string,
  opts: AgentRunOptions,
  label: string,
  onStdout: ((chunk: string) => void) | undefined,
  input: string
): Promise<string> {
  const env = { ...process.env };
  delete env.TRIPO_API_KEY;
  if (label === "Claude CLI") delete env.OPENAI_API_KEY;
  else {
    delete env.ANTHROPIC_API_KEY;
    delete env.CLAUDE_CODE_OAUTH_TOKEN;
  }
  env.PWD = cwd;
  delete env.INIT_CWD;
  delete env.OLDPWD;
  return new Promise((resolve, reject) => {
    const child = spawn(launch.file, launch.args, {
      cwd,
      env,
      windowsVerbatimArguments: launch.windowsVerbatimArguments,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (err?: AgentError, value?: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(value ?? "");
    };

    const stop = (): void => {
      const taskkill = process.platform === "win32" ? windowsSystemExecutable("taskkill.exe") : undefined;
      if (taskkill && child.pid !== undefined) {
        const killer = spawn(taskkill, ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        killer.on("error", () => child.kill());
        killer.on("exit", (code) => { if (code !== 0) child.kill(); });
      } else {
        child.kill();
      }
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
    };

    const timer = setTimeout(() => {
      stop();
      finish(
        new AgentError(
          "AGENT_TIMEOUT",
          `${label} did not finish within ${Math.round(opts.timeoutMs / 60000)} minutes. ` +
            `For large repos raise it via KODYURD_AGENT_TIMEOUT_MS (ms).`
        )
      );
    }, opts.timeoutMs);

    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      stdout += text;
      if (onStdout) onStdout(text);
      if (stdout.length > 20 * 1024 * 1024) {
        stop();
        finish(new AgentError("AGENT_OUTPUT_LIMIT", "Agent output exceeded 20MB"));
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + String(chunk)).slice(-8000);
    });
    child.on("error", () =>
      finish(
        new AgentError(
          "AGENT_SPAWN_FAILED",
        `Could not start ${label}. Check its installation and PATH.`
        )
      )
    );
    child.on("close", (code) => {
      if (code !== 0 && opts.reference && /(?:image|vision).*(?:unsupported|not supported|not available)|(?:unsupported|not supported).*image/i.test(stderr)) {
        finish(new AgentError("AGENT_IMAGE_UNSUPPORTED", "The selected runner rejected image input."));
        return;
      }
      if (code !== 0 && !stdout.trim()) {
        finish(new AgentError("AGENT_FAILED", `${label} exited with code ${code}. Check the local CLI setup and model availability.`));
        return;
      }
      finish(undefined, stdout);
    });

    child.stdin.on("error", () => undefined);
    child.stdin.end(input);
  });
}

interface StreamEvent {
  type?: string;
  subtype?: string;
  result?: unknown;
  message?: { content?: { type?: string; name?: string; text?: string; input?: Record<string, unknown> }[] };
}

function describeToolUse(name: string, input: Record<string, unknown> | undefined): string {
  const pick = name === "Read" ? input?.file_path : undefined;
  const detail = typeof pick === "string" ? pick.slice(0, 70) : "";
  return detail ? `${name} ${detail}` : name;
}

/**
 * Runs `claude -p --output-format stream-json --verbose`, prompt via STDIN.
 * Streams JSONL events so the job log can show live activity (which files the
 * agent reads), and takes the final text from the terminal `result` event.
 */
export async function runClaude(opts: AgentRunOptions): Promise<string> {
  let buffer = "";
  let finalResult: string | undefined;
  let rejectedImage = false;
  const assistantTexts: string[] = [];

  const handleLine = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) return;
    let event: StreamEvent;
    try {
      event = JSON.parse(trimmed) as StreamEvent;
    } catch {
      return;
    }
    if (event.type === "result") {
      if (typeof event.result === "string") {
        finalResult = event.result;
        rejectedImage = !!opts.reference && !!event.subtype && event.subtype !== "success" && /image|vision/i.test(event.result);
      }
      return;
    }
    if (event.type === "assistant" && event.message?.content) {
      for (const block of event.message.content) {
        if (block.type === "tool_use" && block.name) {
          opts.onEvent?.(describeToolUse(block.name, block.input));
        } else if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
          assistantTexts.push(block.text);
        }
      }
    }
  };

  const claudeArgs = [
    "-p", "--output-format", "stream-json", "--verbose", "--safe-mode", "--restricted",
    "--strict-mcp-config", "--no-session-persistence", "--permission-mode", "dontAsk",
    "--tools", opts.packetOnly === false ? "Read,Glob,Grep" : ""
  ];
  if (opts.model) claudeArgs.push("--model", opts.model);
  if (opts.reference) claudeArgs.push("--input-format", "stream-json");
  const input = opts.reference ? `${JSON.stringify({
    type: "user", session_id: "", parent_tool_use_id: null,
    message: { role: "user", content: [{ type: "text", text: opts.prompt }, imageContent(opts.reference)] }
  })}\n` : opts.prompt;
  const raw = await runCliAgent(
    "claude",
    claudeArgs,
    opts,
    "Claude CLI",
    (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) handleLine(line);
    },
    input
  );
  if (buffer.trim()) handleLine(buffer);

  if (rejectedImage) throw new AgentError("AGENT_IMAGE_UNSUPPORTED", "The selected runner rejected image input.");
  if (typeof finalResult === "string" && finalResult.trim()) return finalResult;
  if (assistantTexts.length > 0) return assistantTexts.join("\n");
  // Fallback: maybe the CLI version printed a plain envelope after all.
  return raw;
}

/**
 * Codex non-interactive mode: `codex exec` reads the prompt from stdin when it
 * is piped. --skip-git-repo-check lets it run in non-git source folders.
 */
export function runCodex(opts: AgentRunOptions): Promise<string> {
  const args = ["--ask-for-approval", "never", "exec", "--skip-git-repo-check", "--sandbox", "read-only", "--ephemeral",
    "--ignore-user-config", "--ignore-rules", "--disable", "hooks", "--disable", "apps", "-c", "web_search=disabled"];
  if (opts.packetOnly !== false) args.push("--disable", "shell_tool", "--disable", "unified_exec");
  if (opts.model) args.push("-m", opts.model);
  if (opts.reference) args.push("--image", opts.reference.file);
  return runCliAgent("codex", args, opts, "Codex CLI");
}

/** Anthropic REST API (no file access — scenes ground in the analysis summary only). */
export async function runApi(opts: AgentRunOptions): Promise<string> {
  const apiKey = getAnthropicKey(opts.dataDir);
  if (!apiKey) {
    throw new AgentError(
      "AGENT_NOT_CONFIGURED",
      "No Anthropic API key — add one on the connect screen (or set ANTHROPIC_API_KEY)."
    );
  }
  const model = opts.model ?? process.env.KODYURD_ANTHROPIC_MODEL ?? "claude-sonnet-5-5";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model,
        max_tokens: opts.maxTokens ?? 16000,
        messages: [{ role: "user", content: opts.reference ? [{ type: "text", text: opts.prompt }, imageContent(opts.reference)] : opts.prompt }]
      })
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 300);
      if (opts.reference && res.status === 400 && /image|vision/i.test(body)) {
        throw new AgentError("AGENT_IMAGE_UNSUPPORTED", "The selected model rejected image input.");
      }
      const advice = res.status === 401 || res.status === 403 ? "Check the configured API key and model access."
        : res.status === 429 ? "The provider rate limit was reached. Try this deliverable again later."
          : res.status === 402 || /billing|credit balance/i.test(body) ? "Check the provider account credits."
            : res.status >= 500 ? "The provider is temporarily unavailable. Try this deliverable again later."
              : "Check the selected model and try this deliverable again.";
      throw new AgentError("AGENT_API_FAILED", `Anthropic API request failed (HTTP ${res.status}). ${advice}`);
    }
    const data = (await res.json()) as { content?: { type: string; text?: string }[]; stop_reason?: string };
    if (data.stop_reason === "max_tokens") {
      throw new AgentError("AGENT_OUTPUT_LIMIT", "Anthropic API reached its output-token limit before finishing the response.");
    }
    const text = (data.content ?? [])
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("\n");
    if (!text.trim()) throw new AgentError("AGENT_API_FAILED", "Anthropic API returned no text.");
    return text;
  } catch (err) {
    if (err instanceof AgentError) throw err;
    if ((err as Error).name === "AbortError") {
      throw new AgentError("AGENT_TIMEOUT", "Anthropic API call timed out.");
    }
    throw new AgentError("AGENT_API_FAILED", "Anthropic API request failed before a usable response was received.");
  } finally {
    clearTimeout(timer);
  }
}

export function runAgent(agent: AgentId, opts: AgentRunOptions): Promise<string> {
  if (agent === "claude") return runClaude(opts);
  if (agent === "codex") return runCodex(opts);
  return runApi(opts);
}

/** `claude -p --output-format json` wraps the answer in an envelope; unwrap it. */
export function extractResultText(stdout: string): string {
  const trimmed = stdout.trim();
  try {
    const envelope = JSON.parse(trimmed) as { result?: unknown };
    if (typeof envelope.result === "string") return envelope.result;
  } catch {
    /* not an envelope — fall through */
  }
  return trimmed;
}

/**
 * Pull the best JSON object out of agent text. CLI agents may print reasoning
 * around (or containing) braces, so scan for balanced top-level objects and
 * prefer the last parseable one that contains `mustContain`.
 */
export function extractJsonObject(text: string, mustContain = "\"version\""): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidates: string[] = [];
  const scan = (input: string): void => {
    for (let i = 0; i < input.length; i++) {
      if (input[i] !== "{") continue;
      let depth = 0;
      let inString = false;
      let escaped = false;
      for (let j = i; j < input.length; j++) {
        const ch = input[j];
        if (inString) {
          if (escaped) escaped = false;
          else if (ch === "\\") escaped = true;
          else if (ch === "\"") inString = false;
          continue;
        }
        if (ch === "\"") inString = true;
        else if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) {
            candidates.push(input.slice(i, j + 1));
            i = j;
            break;
          }
        }
      }
    }
  };
  if (fenced?.[1]) scan(fenced[1]);
  scan(text);

  let fallback: unknown;
  let fallbackSize = -1;
  for (let k = candidates.length - 1; k >= 0; k--) {
    const candidate = candidates[k];
    try {
      const value = JSON.parse(candidate) as unknown;
      if (candidate.includes(mustContain)) return value;
      if (candidate.length > fallbackSize) {
        fallback = value;
        fallbackSize = candidate.length;
      }
    } catch {
      /* not JSON — keep scanning */
    }
  }
  if (fallbackSize >= 0) return fallback;
  throw new AgentError("AGENT_NO_JSON", "Agent output contained no parseable JSON object");
}
