import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { AgentError, runAgent } from "../dist/agents.js";
import { checkAgentCommand } from "../dist/doctor.js";
import { runFocusDeliverable } from "../dist/focus-generation.js";

const settings = { prompt: "fixture prompt", cwd: process.cwd(), timeoutMs: 5_000 };
const cancelled = ({ code }) => code === "AGENT_CANCELLED";

function watchedSignal() {
  const controller = new AbortController();
  const listeners = new Set();
  const signal = controller.signal;
  const add = signal.addEventListener.bind(signal);
  const remove = signal.removeEventListener.bind(signal);
  signal.addEventListener = (type, callback, options) => {
    if (type === "abort") listeners.add(callback);
    return add(type, callback, options);
  };
  signal.removeEventListener = (type, callback, options) => {
    if (type === "abort") listeners.delete(callback);
    return remove(type, callback, options);
  };
  return { controller, signal, listeners };
}

test("an already stopped request never starts any provider adapter", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalSpawn = childProcess.spawn;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("Unexpected request"); };
  childProcess.spawn = () => { calls++; throw new Error("Unexpected process"); };
  syncBuiltinESMExports();
  t.after(() => { globalThis.fetch = originalFetch; childProcess.spawn = originalSpawn; syncBuiltinESMExports(); });
  const controller = new AbortController();
  controller.abort();
  for (const agent of ["api", "claude", "codex"]) {
    await assert.rejects(runAgent(agent, { ...settings, signal: controller.signal }), cancelled);
  }
  assert.equal(calls, 0);
});

test("API cancellation aborts transport, stays distinct from timeout, and removes listeners", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "fixture-only";
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
  });
  let transport;
  globalThis.fetch = async (_, request) => {
    transport = request.signal;
    return new Promise((_, reject) => request.signal.addEventListener("abort", () => reject(request.signal.reason), { once: true }));
  };
  const { controller, signal, listeners } = watchedSignal();
  const pending = runAgent("api", { ...settings, signal });
  assert.equal(listeners.size, 1);
  controller.abort();
  await assert.rejects(pending, cancelled);
  assert.equal(transport.aborted, true);
  assert.equal(listeners.size, 0);
  await assert.rejects(runAgent("api", { ...settings, timeoutMs: 5 }), ({ code }) => code === "AGENT_TIMEOUT");

  globalThis.fetch = async () => new Response(JSON.stringify({ content: [{ type: "text", text: "done" }] }));
  const complete = watchedSignal();
  assert.equal(await runAgent("api", { ...settings, signal: complete.signal }), "done");
  assert.equal(complete.listeners.size, 0);
  complete.controller.abort();
});

test("CLI cancellation targets its process tree and waits for close before releasing the request", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "kodyurd-cancel-adapter-"));
  const originalPath = process.env.PATH;
  const originalSpawn = childProcess.spawn;
  const originalKill = process.kill;
  await writeFile(path.join(directory, "codex.cmd"), "@echo off\r\n");
  process.env.PATH = directory;
  const calls = [];
  const signals = [];
  let active;
  childProcess.spawn = (file, args, options) => {
    calls.push({ file, args, options });
    const process = new EventEmitter();
    if (/taskkill\.exe$/i.test(file)) {
      queueMicrotask(() => process.emit("exit", 0));
      return process;
    }
    process.pid = 19723001;
    process.stdin = new PassThrough();
    process.stdout = new PassThrough();
    process.stderr = new PassThrough();
    process.kill = () => { signals.push([process.pid, "child"]); return true; };
    active = process;
    return process;
  };
  process.kill = (pid, signal) => { signals.push([pid, signal]); return true; };
  syncBuiltinESMExports();
  t.after(async () => {
    childProcess.spawn = originalSpawn;
    process.kill = originalKill;
    syncBuiltinESMExports();
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    await rm(directory, { recursive: true, force: true });
  });
  const { controller, signal, listeners } = watchedSignal();
  const pending = runAgent("codex", { ...settings, packetOnly: false, signal });
  let finished = false;
  const rejected = assert.rejects(pending, cancelled).then(() => { finished = true; });
  assert.equal(calls.length, 1);
  controller.abort();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(finished, false);
  if (process.platform === "win32") {
    assert.deepEqual(calls[1].args, ["/pid", String(active.pid), "/T", "/F"]);
    assert.equal(calls[1].options.windowsHide, true);
  } else {
    assert.equal(calls[0].options.detached, true);
    assert.deepEqual(signals, [[-active.pid, "SIGKILL"]]);
  }
  active.emit("close", null);
  await rejected;
  assert.equal(listeners.size, 0);

  const complete = watchedSignal();
  const done = runAgent("codex", { ...settings, packetOnly: false, signal: complete.signal });
  active.stdout.write("done");
  active.emit("close", 0);
  assert.equal(await done, "done");
  assert.equal(complete.listeners.size, 0);
  const previousCalls = calls.length;
  complete.controller.abort();
  assert.equal(calls.length, previousCalls, "finished adapters keep no abort handler");
});

test("cancellation never spends the focused deliverable's one retry", async () => {
  let calls = 0;
  const controller = new AbortController();
  await assert.rejects(runFocusDeliverable({
    kind: "map", evidence: { docs: [], code: [] },
    prompt: { building: { id: "orders", moduleRef: "orders", title: "Orders" }, brief: "Explain orders", language: "en" },
    read: async () => null,
    run: async () => { calls++; controller.abort(); throw new AgentError("AGENT_CANCELLED", "Stopped"); },
    onRetry: () => assert.fail("A cancelled request must not retry")
  }), cancelled);
  assert.equal(calls, 1);
});

test("CLI availability requires help-confirmed isolation flags, with no provider call", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "kodyurd-capability-"));
  const originalPath = process.env.PATH;
  const originalSpawn = childProcess.spawnSync;
  for (const agent of ["claude", "codex"]) await writeFile(path.join(directory, `${agent}.cmd`), "@echo off\r\n");
  process.env.PATH = directory;
  const probes = [];
  childProcess.spawnSync = (file, args) => {
    const command = [file, ...args].join(" ");
    probes.push(command);
    const stdout = command.includes("--version") ? "fixture capability version"
      : command.includes("claude") ? "--output-format --verbose --tools"
        : command.includes("exec") ? "--skip-git-repo-check --sandbox --ephemeral --ignore-user-config --ignore-rules"
          : "--ask-for-approval --disable --config";
    return { status: 0, stdout, stderr: "" };
  };
  syncBuiltinESMExports();
  t.after(async () => {
    childProcess.spawnSync = originalSpawn;
    syncBuiltinESMExports();
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    await rm(directory, { recursive: true, force: true });
  });
  assert.equal(checkAgentCommand("codex").found, true);
  const helpProbes = probes.filter((command) => command.includes("--help")).length;
  assert.equal(checkAgentCommand("codex").found, true);
  assert.equal(probes.filter((command) => command.includes("--help")).length, helpProbes);
  assert.equal(checkAgentCommand("claude").found, false);
  assert.ok(probes.every((command) => command.includes("--help") || command.includes("--version")));
});
