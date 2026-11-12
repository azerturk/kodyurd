import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { parseSpace } from "@kodyurd/scene-schema";
import { analyzeSource, indexDocument } from "../dist/analyzer.js";
import { readAuthoredDiagrams } from "../dist/authored-diagrams.js";
import { asMarkdownLines } from "../dist/documents.js";
import { declarationLine } from "../dist/source-declarations.js";
import { documentFormat, isDocumentPath, isTestPath } from "../dist/source-paths.js";

const rst = [
  "==========",        // 1
  "Operations",        // 2
  "==========",        // 3
  "",                  // 4
  "Delivery states",   // 5
  "---------------",   // 6
  "",                  // 7
  ".. mermaid::",      // 8
  "   :caption: Outbox",  // 9
  "",                  // 10
  "   stateDiagram-v2",   // 11
  "   [*] --> Queued : commit",    // 12
  "   Queued --> Delivered : sent", // 13
  "",                  // 14
  "Run it::",          // 15
  "",                  // 16
  "   client -> api -> store",  // 17
  "   store -> outbox",         // 18
  "",                  // 19
  "+------+-------+",  // 20
  "| Role | May   |",  // 21
  "+======+=======+",  // 22
  "| desk | book  |",  // 23
  "+------+-------+",  // 24
  "",                  // 25
  "#. Stop the worker.",   // 26
  "#. Copy the data file.", // 27
  "#. Start the worker.",   // 28
  ""                   // 29
];

const adoc = [
  "= Operations",       // 1
  "",                   // 2
  "== Delivery states", // 3
  "",                   // 4
  "[mermaid]",          // 5
  "....",               // 6
  "stateDiagram-v2",    // 7
  "[*] --> Queued : commit",    // 8
  "Queued --> Delivered : sent", // 9
  "....",               // 10
  "",                   // 11
  "[source,js]",        // 12
  "----",               // 13
  "worker.tick();",     // 14
  "----",               // 15
  "",                   // 16
  "|===",               // 17
  "|Role |May",         // 18
  "|desk |book",        // 19
  "|===",               // 20
  "",                   // 21
  ". Stop the worker.",   // 22
  ". Copy the data file.", // 23
  ". Start the worker."    // 24
];

function city(paths) {
  const result = parseSpace({
    version: "0.2",
    meta: { name: "Formats", sourceDir: "/never/read", createdAt: "2026-11-12",
      coverage: paths.map((doc) => ({ doc, sections: 1, placed: 0, pending: 1 })) },
    city: { districts: [{ id: "d", title: "Local" }],
      buildings: [{ id: "b-docs", moduleRef: "docs", title: "Docs", district: "d", summary: "Operations notes." }] }
  });
  assert.equal(result.success, true, JSON.stringify(result));
  return result.data;
}

test("document and test paths follow one rule across formats and languages", () => {
  assert.deepEqual(["a.md", "b.MDX", "c.rst", "d.adoc", "e.asciidoc", "f.markdown"].map(documentFormat),
    ["markdown", "markdown", "rst", "asciidoc", "asciidoc", "markdown"]);
  assert.deepEqual(["notes.txt", "app.ts", "x.constructor", "README"].map(isDocumentPath), [false, false, false, false]);
  assert.deepEqual(["pkg/store_test.go", "tests/api.rs", "BookingTests.swift", "QuoteSpec.scala", "src/a.test.ts"].map(isTestPath),
    [true, true, true, true, true]);
  assert.deepEqual(["src/Latest.java", "contest/entry.py", "Protest.kt"].map(isTestPath), [false, false, false]);
});

test("reStructuredText and AsciiDoc are indexed with the file's own line numbers", () => {
  const converted = asMarkdownLines(rst, "rst");
  assert.equal(converted.length, rst.length);
  assert.equal(converted[1], "# Operations");
  assert.equal(converted[4], "## Delivery states");
  assert.equal(converted[7], "```mermaid");
  assert.equal(converted[8], "");
  assert.equal(converted[13], "```");
  assert.equal(converted[11], rst[11]);
  assert.deepEqual(converted.slice(19, 24), ["", "| Role | May   |", "|---|---|", "| desk | book  |", "|"]);
  assert.deepEqual(asMarkdownLines(adoc, "asciidoc").slice(16, 20), ["|Role |May", "|---|---|", "|desk |book", ""]);

  for (const [file, lines] of [["ops.rst", rst], ["ops.adoc", adoc]]) {
    const { blocks, sections } = indexDocument(lines.join("\n"), file);
    assert.deepEqual(blocks, { mermaid: 1, tables: 1, decisions: 1, ascii: file === "ops.rst" ? 1 : 0 }, file);
    const titled = sections.filter(({ kind }) => kind === "section").map(({ title, startLine }) => [title, startLine]);
    assert.deepEqual(titled, file === "ops.rst" ? [["Operations", 2], ["Delivery states", 5]] : [["Operations", 1], ["Delivery states", 3]], file);
    const diagram = sections.find(({ kind }) => kind === "mermaid");
    assert.deepEqual([diagram.startLine, diagram.endLine], file === "ops.rst" ? [8, 14] : [6, 10], file);
  }
  assert.equal(asMarkdownLines(adoc, "asciidoc").length, adoc.length);
  assert.deepEqual(asMarkdownLines(["# Title", "text"], "markdown"), ["# Title", "text"]);
  // A directive that runs to the end of the file is closed by one added line.
  assert.deepEqual(asMarkdownLines([".. code-block:: js", "", "   run();"], "rst"), ["```js", "", "   run();", "```"]);
});

test("Mermaid blocks in reStructuredText and AsciiDoc import with exact source lines", async () => {
  for (const [file, lines, first] of [["docs/ops.rst", rst, 12], ["docs/ops.adoc", adoc, 8]]) {
    const [diagram] = await readAuthoredDiagrams(city([file]), async () => lines);
    assert.equal(diagram.kind, "state", file);
    assert.equal(diagram.owner, "b-docs", file);
    assert.equal(diagram.title, "Delivery states", file);
    assert.deepEqual(diagram.edges.map(({ source }) => source.startLine), [first, first + 1], file);
  }
});

test("a code excerpt opens at the first declaration of typed languages", () => {
  const go = ["package store", "", "import \"database/sql\"", "", "// Open returns a store.", "func Open(path string) (*Store, error) {"];
  assert.equal(declarationLine("store/open.go", go), 5);
  assert.equal(declarationLine("store/types.go", ["package store", "", "type Store struct {", "  db *sql.DB", "}"]), 2);
  assert.equal(declarationLine("src/lib.rs", ["use std::fmt;", "", "pub(crate) fn open() {}", "impl Store {}"]), 2);
  assert.equal(declarationLine("App.swift", ["import SwiftUI", "", "public final actor Bookings {}"]), 2);
  assert.equal(declarationLine("lib/desk.ex", ["defmodule Desk do", "  def run, do: :ok", "end"]), 0);
  assert.equal(declarationLine("Main.scala", ["package desk", "", "object Main extends App {"]), 2);
  // Languages that already worked keep their first classic match, and their old miss.
  assert.equal(declarationLine("app.ts", ["interface Slot {}", "export function book() {}"]), 1);
  assert.equal(declarationLine("types.ts", ["interface Slot {}", "enum State { Open }"]), -1);
});

test("the scan counts more languages and indexes documents beside Markdown", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "kodyurd-formats-"));
  try {
    for (const directory of ["mobile", "core", "core/src", "docs"]) await mkdir(path.join(root, directory));
    await writeFile(path.join(root, "mobile/App.swift"), "import SwiftUI\n\nstruct DeskApp {}\n");
    await writeFile(path.join(root, "mobile/BookingTests.swift"), "import XCTest\n\nfinal class BookingTests {}\n");
    await writeFile(path.join(root, "core/src/lib.rs"), "pub fn open() {}\n");
    await writeFile(path.join(root, "core/src/store_test.go"), "package store\n\nfunc TestOpen() {}\n");
    await writeFile(path.join(root, "docs/ops.rst"), rst.join("\n"));
    await writeFile(path.join(root, "docs/ops.adoc"), adoc.join("\n"));
    await writeFile(path.join(root, "docs/guide.mdx"), "# Guide\n\n```mermaid\nflowchart LR\n  a --> b\n```\n");
    const report = await analyzeSource(root);
    assert.equal(report.languages[".swift"].loc > 0, true);
    assert.equal(report.languages[".rs"].loc > 0, true);
    assert.deepEqual(report.docs.map(({ path: file, title, blocks }) => [file, title, blocks.mermaid]).sort(),
      [["docs/guide.mdx", "Guide", 1], ["docs/ops.adoc", "Operations", 1], ["docs/ops.rst", "Operations", 1]]);
    const files = (key) => report.modules.flatMap((module) => module[key] ?? []).sort();
    assert.deepEqual(files("entryFiles"), ["core/src/lib.rs", "mobile/App.swift"]);
    assert.deepEqual(files("testFiles"), ["core/src/store_test.go", "mobile/BookingTests.swift"]);
    assert.equal(files("sourceFiles").some((file) => /\.(?:rst|adoc|mdx)$/.test(file)), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
