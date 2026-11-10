import { statSync } from "node:fs";
import path from "node:path";

interface LocalCommand {
  file: string;
  args: string[];
  windowsVerbatimArguments?: boolean;
}

export function windowsSystemExecutable(name: "cmd.exe" | "taskkill.exe"): string | undefined {
  const file = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", name);
  return path.isAbsolute(file) ? file : undefined;
}

/** Resolve a trusted executable from PATH before setting a workspace as the child cwd. */
export function localCommand(name: string, args: string[]): LocalCommand | undefined {
  if (!/^[a-z0-9_-]+$/i.test(name)) return undefined;
  if (process.platform !== "win32") return { file: name, args };
  for (const raw of (process.env.PATH ?? "").split(path.delimiter)) {
    const directory = raw.trim().replace(/^"|"$/g, "");
    if (!path.isAbsolute(directory)) continue;
    for (const extension of [".exe", ".cmd", ".bat"]) {
      const file = path.join(directory, name + extension);
      try {
        if (!statSync(file, { throwIfNoEntry: false })?.isFile()) continue;
      } catch {
        continue;
      }
      if (extension === ".exe") return { file, args };
      // CMD expands percent variables inside quotes. Reject expansion characters
      // and quote each remaining token before the /s wrapper removes its outer pair.
      if ([file, ...args].some((value) => /[%!"\u0000-\u001f]/.test(value))) return undefined;
      const commandLine = [file, ...args].map((value) => `"${value}"`).join(" ");
      const cmd = windowsSystemExecutable("cmd.exe");
      if (!cmd) return undefined;
      return { file: cmd, args: ["/d", "/s", "/v:off", "/c", `"${commandLine}"`], windowsVerbatimArguments: true };
    }
  }
  return undefined;
}
