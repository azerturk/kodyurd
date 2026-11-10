#!/usr/bin/env node
import { startServer, runDoctor } from "@kodyurd/server";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const requireModule = createRequire(import.meta.url);

function uiDistPath(): string | undefined {
  try {
    const pkgJson = requireModule.resolve("@kodyurd/ui/package.json");
    return join(dirname(pkgJson), "dist");
  } catch {
    return undefined;
  }
}

function openBrowser(url: string): void {
  const platform = process.platform;
  let child;
  if (platform === "win32") {
    child = spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" });
  } else if (platform === "darwin") {
    child = spawn("open", [url], { detached: true, stdio: "ignore" });
  } else {
    child = spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
  }
  child.unref();
}

function ownVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8")
    ) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function printDoctor(): number {
  const checks = runDoctor(join(homedir(), ".kodyurd"));
  console.log("\nKodyurd doctor\n");
  let criticalMissing = 0;
  for (const c of checks) {
    const mark = c.found ? "[ok]  " : c.optional ? "[opt] " : "[MISS]";
    if (!c.found && !c.optional) criticalMissing += 1;
    console.log(`  ${mark} ${c.name.padEnd(14)} ${c.detail}`);
  }
  console.log("");
  if (criticalMissing > 0) {
    console.log("  Missing required tools. Install them and run `kodyurd doctor` again.\n");
  }
  return criticalMissing > 0 ? 1 : 0;
}

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? "run";
  const version = ownVersion();

  if (cmd === "version" || cmd === "--version" || cmd === "-v") {
    console.log(version);
    return;
  }

  if (cmd === "doctor") {
    process.exitCode = printDoctor();
    return;
  }

  if (cmd === "run") {
    const dataDir = join(homedir(), ".kodyurd");
    const server = await startServer({ dataDir, uiDist: uiDistPath(), version });
    console.log(`\n  Kodyurd v${version}`);
    console.log(`  Local server : ${server.url}  (127.0.0.1 only)`);
    console.log(`  Data         : ${dataDir}`);
    console.log(`  Opening your browser... Press Ctrl+C to stop.\n`);
    openBrowser(server.url);
    return;
  }

  console.log(`Unknown command: ${cmd}`);
  console.log("Usage: kodyurd [run|doctor|version]");
  process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error("kodyurd failed to start:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
