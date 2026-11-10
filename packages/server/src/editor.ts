import { spawn } from "node:child_process";
import { constants, promises as fs } from "node:fs";
import path from "node:path";

interface EditorCommand {
  executable: string;
  label: string;
  cli?: string;
}

export type EditorOpenResult = {
  status: "dispatched" | "copy";
  pathLine: string;
  editor?: string;
  message?: string;
};

async function isFile(file: string): Promise<boolean> {
  try {
    if (!(await fs.stat(file)).isFile()) return false;
    if (process.platform !== "win32") await fs.access(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function windowsCode(root: string, label: string, executableName = "Code.exe"): Promise<EditorCommand | null> {
  const executable = path.join(root, executableName);
  if (!await isFile(executable)) return null;
  const relativeCli = path.join("resources", "app", "out", "cli.js");
  const directCli = path.join(root, relativeCli);
  if (await fs.stat(directCli).then((stat) => stat.isFile(), () => false)) {
    return { executable, label, cli: directCli };
  }
  const installed = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of installed) {
    if (!entry.isDirectory() || !/^[a-f0-9]{7,64}$/i.test(entry.name)) continue;
    const cli = path.join(root, entry.name, relativeCli);
    if (await fs.stat(cli).then((stat) => stat.isFile(), () => false)) return { executable, label, cli };
  }
  return { executable, label };
}

async function resolveEditor(): Promise<EditorCommand | null> {
  const configured = process.env.KODYURD_EDITOR?.trim();
  const command = configured || "code";
  const win = process.platform === "win32";
  const directories = (process.env.PATH ?? "").split(path.delimiter).map((entry) => entry.replace(/^"|"$/g, ""));
  const candidates = path.isAbsolute(command)
    ? [command]
    : directories.filter(Boolean).flatMap((directory) =>
        win && !path.extname(command)
          ? [path.join(directory, `${command}.exe`), path.join(directory, `${command}.cmd`)]
          : [path.join(directory, command)]
      );
  for (const candidate of candidates) {
    if (!await isFile(candidate)) continue;
    if (win && /[/\\]code(?:-insiders)?\.cmd$/i.test(candidate)) {
      const insiders = candidate.toLowerCase().endsWith("code-insiders.cmd");
      const code = await windowsCode(path.dirname(path.dirname(candidate)),
        insiders ? "VS Code Insiders" : "VS Code", insiders ? "Code - Insiders.exe" : "Code.exe");
      if (code) return code;
    } else if (!win || /\.exe$/i.test(candidate)) {
      if (win && /[/\\]Code\.exe$/i.test(candidate)) {
        return windowsCode(path.dirname(candidate), "VS Code");
      }
      return { executable: candidate, label: configured ? path.basename(candidate) : "VS Code" };
    }
  }
  if (win && !configured) {
    const roots = [
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs", "Microsoft VS Code"),
      process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Microsoft VS Code")
    ];
    for (const root of roots) {
      if (!root) continue;
      const code = await windowsCode(root, "VS Code");
      if (code) return code;
    }
  }
  return null;
}

export async function editorStatus(): Promise<{ available: boolean; name: string; detail: string }> {
  const command = await resolveEditor();
  return command
    ? { available: true, name: command.label, detail: "Ready to dispatch exact file locations." }
    : { available: false, name: "Editor", detail: "Install VS Code or set KODYURD_EDITOR to an editor executable." };
}

/** Spawn a resolved executable with exact arguments and detect immediate failures. */
export async function openEditor(absPath: string, line?: number, copyOnly = false): Promise<EditorOpenResult> {
  const pathLine = line ? `${absPath}:${line}` : absPath;
  if (copyOnly) return { status: "copy", pathLine };
  const command = await resolveEditor();
  if (!command) {
    return { status: "copy", pathLine, message: "No compatible editor executable was found." };
  }
  const { executable, label, cli } = command;
  const dispatched: EditorOpenResult = { status: "dispatched", pathLine, editor: label };
  const failed: EditorOpenResult = {
    status: "copy", pathLine, editor: label, message: `${label} could not open this location.`
  };
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.TRIPO_API_KEY;
  if (cli) {
    env.ELECTRON_RUN_AS_NODE = "1";
    delete env.VSCODE_DEV;
  }
  return new Promise<EditorOpenResult>((resolve) => {
    const child = spawn(executable, [...(cli ? [cli] : []), "-g", pathLine], {
      detached: true, stdio: "ignore", windowsHide: true, env
    });
    const finish = (result: EditorOpenResult): void => {
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => finish(child.pid ? dispatched : failed), 800);
    child.once("error", () => finish(failed));
    child.once("exit", (code) => finish(code === 0 ? dispatched : failed));
    child.unref();
  });
}
