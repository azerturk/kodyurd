import assert from "node:assert/strict";
import { mkdir, mkdtemp, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { analyzeSource } from "../dist/analyzer.js";
import { collectBuildingEvidence, createSourceReader, expandCodeEvidence } from "../dist/source-evidence.js";

test("source in storage is indexed while local data and ignored entries are reported separately", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "kodyurd-storage-scan-"));
  const directories = ["storage", "storage/build", "scratch", ".hidden"];
  const files = {
    ".gitignore": "scratch/\n",
    "storage/query.ts": "export const read = () => 'SELECT 1';",
    "storage/design.md": "# Storage design\nThe query is read-only.",
    "storage/local.sqlite": "runtime database",
    "storage/local.sqlite-wal": "runtime journal",
    "storage/build/generated.js": "generated",
    "scratch/draft.ts": "ignored by the workspace",
    ".hidden/private.ts": "hidden",
    ".env": "fixture secret",
    "storage/credentials.json": "fixture secret",
    ".private.md": "# Hidden documentation"
  };
  try {
    for (const directory of directories) await mkdir(path.join(root, directory));
    for (const [file, content] of Object.entries(files)) await writeFile(path.join(root, file), content);

    const report = await analyzeSource(root);
    assert.equal(report.truncated, false);
    assert.equal(report.totals.files, 3);
    assert.deepEqual(report.docs.map(({ path }) => path), ["storage/design.md"]);
    assert.deepEqual(report.modules.find(({ name }) => name === "storage").topFiles.map(({ path }) => path).sort(),
      ["storage/design.md", "storage/query.ts"]);
    assert.equal(report.scanLimits.excludedEntries, 8);
    assert.deepEqual(report.scanLimits.exclusions.find(({ reason }) => reason === "generated"), {
      reason: "generated", count: 3, examples: ["storage/build", "storage/local.sqlite", "storage/local.sqlite-wal"]
    });
    assert.deepEqual(report.scanLimits.exclusions.find(({ reason }) => reason === "ignore-rule").examples, ["scratch"]);
    assert.deepEqual(report.scanLimits.exclusions.find(({ reason }) => reason === "hidden").examples, [".hidden"]);
    const read = createSourceReader(root);
    for (const file of [".env", "storage/credentials.json", ".private.md", "scratch/draft.ts", "storage/build/generated.js", "storage/local.sqlite"]) {
      assert.equal(await read(file), null);
    }
    assert.ok(await read("storage/query.ts"));
  } finally {
    for (const file of Object.keys(files)) await unlink(path.join(root, file)).catch(() => undefined);
    for (const directory of [...directories].reverse()) await rmdir(path.join(root, directory)).catch(() => undefined);
    await rmdir(root);
  }
});

test("shallow documentation survives the cap on a deep module's inventory", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "kodyurd-scan-priority-"));
  const directories = ["archive", "archive/old", "core"];
  const docs = ["README.md", "core/design.md", ...Array.from({ length: 402 }, (_, index) => `archive/old/page-${index}.md`)];
  try {
    for (const directory of directories) await mkdir(path.join(root, directory));
    await Promise.all(docs.map((file) => writeFile(path.join(root, file), `# ${file}\nExample documentation.`)));
    const report = await analyzeSource(root);
    assert.deepEqual(report.scanLimits.reached, ["docs"]);
    assert.equal(report.docs.length, 400);
    assert.deepEqual(report.docs.slice(0, 2).map(({ path }) => path), ["README.md", "core/design.md"]);
    assert.match(report.readmeExcerpt, /README\.md/);
  } finally {
    await Promise.all(docs.map((file) => unlink(path.join(root, file)).catch(() => undefined)));
    for (const directory of [...directories].reverse()) await rmdir(path.join(root, directory)).catch(() => undefined);
    await rmdir(root);
  }
});

test("a flat source module surfaces a late function and resolves its local Python import", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "kodyurd-python-evidence-"));
  const files = {
    "quote.py": `from .pricing.discount import calculate\ndef example(): pass\n${"padding = 0\n".repeat(180)}def calculate_room_discount(slots):\n    return calculate(slots)\n`,
    "pricing/discount.py": "def calculate(slots):\n    return slots * 0.1\n",
    ...Object.fromEntries(Array.from({ length: 7 }, (_, index) => [`record-${index}.json`, `[\n${"  {},\n".repeat(300)}  {}\n]\n`]))
  };
  try {
    await mkdir(path.join(root, "pricing"));
    await Promise.all(Object.entries(files).map(([file, content]) => writeFile(path.join(root, file), content)));
    const report = await analyzeSource(root);
    const read = createSourceReader(root);
    const evidence = await collectBuildingEvidence(report, "(root)", "Calculate room discount", true, read);
    assert.equal(evidence.code[0].path, "quote.py");
    assert.ok(evidence.code[0].startLine > 100);
    assert.match(evidence.code[0].text, /def calculate_room_discount/);
    await expandCodeEvidence(report, "(root)", evidence, read);
    assert.ok(evidence.code.some(({ path, text }) => path === "pricing/discount.py" && text.includes("return slots * 0.1")));
  } finally {
    await Promise.all(Object.keys(files).map((file) => unlink(path.join(root, file)).catch(() => undefined)));
    await rmdir(path.join(root, "pricing")).catch(() => undefined);
    await rmdir(root);
  }
});
