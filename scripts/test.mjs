import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const tests = ["scene-schema", "server", "ui"].flatMap((name) => {
  const directory = new URL(`packages/${name}/test/`, root);
  return readdirSync(directory).filter((file) => file.endsWith(".test.mjs")).sort()
    .map((file) => fileURLToPath(new URL(file, directory)));
});

const run = spawnSync(process.execPath, ["--test", "--test-concurrency=1", ...tests], {
  cwd: fileURLToPath(root), stdio: "inherit"
});
if (run.error) throw run.error;
process.exitCode = run.status ?? 1;
