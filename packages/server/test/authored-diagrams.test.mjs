import assert from "node:assert/strict";
import { mkdtemp, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { parseSpace } from "@kodyurd/scene-schema";
import { readAuthoredDiagrams } from "../dist/authored-diagrams.js";
import { readSavedSpaceFile } from "../dist/export.js";
import { buildSpaceLayout } from "../dist/space-layout/index.js";

const anchor = (path, startLine, endLine = startLine) => ({ path, startLine, endLine });
const codeMap = (id, kind, source) => ({
  id, kind, owner: "city", title: id, source,
  nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
  edges: [{ from: "a", to: "b" }]
});
const fence = (...lines) => ["```mermaid", ...lines, "```"].join("\n");

function fixture(paths, diagrams = []) {
  const result = parseSpace({
    version: "0.2",
    meta: {
      name: "Harbor Desk",
      sourceDir: "/saved/path/never/read",
      createdAt: "2026-11-10",
      coverage: paths.map((doc) => ({ doc, sections: 1, placed: 0, pending: 1 }))
    },
    city: {
      districts: [{ id: "d-local", title: "Local" }],
      buildings: [{ id: "b-waitlist", moduleRef: "waitlist-design", title: "Waitlist design",
        district: "d-local", summary: "A proposed opt-in waitlist." }]
    },
    diagrams
  });
  assert.equal(result.success, true, JSON.stringify(result));
  return result.data;
}

const sequence = fence(
  "sequenceDiagram",
  "actor Member",
  "participant API as HTTP API",
  "participant Store as SQLite adapter",
  "Member->>API: POST /api/reservations",
  "alt Known identity",
  "    API->>Store: Check overlap",
  "    alt Active overlap",
  "        API-->>Member: 409 TIME_CONFLICT",
  "    else Available",
  "        API-->>Member: 201 Confirmed",
  "    end",
  "else Missing or unknown identity",
  "    API-->>Member: 401 IDENTITY_REQUIRED",
  "end"
);
const state = fence(
  "stateDiagram-v2",
  "[*] --> Queued : commit",
  "Queued --> Queued : retry",
  "Queued --> Delivered : delivered",
  "Delivered --> [*]"
);
const graph = fence(
  "flowchart LR",
  'subgraph Process["Local process"]',
  'API["HTTP API"]',
  'Gate{"Gate"}',
  "end",
  'DB[("SQLite file")]',
  'API -->|"Check access"| Gate',
  "Gate -.-> DB"
);
const erd = fence(
  "erDiagram",
  'ACCOUNT ||--o{ "Login event" : records',
  'ACCOUNT }|..o| PROFILE : uses',
  "ACCOUNT {",
  '    integer *id UK "Local account id"',
  "}",
  '"Login event" {',
  "    integer account_id PK, FK",
  "    text? message",
  "}"
);

test("authored ERD preserves entities, per-field sources and both relationship ends", async () => {
  const [diagram] = await readAuthoredDiagrams(fixture(["data.md"]), async () => erd.split("\n"));
  assert.equal(diagram.kind, "erd");
  assert.deepEqual(diagram.nodes.map(({ id }) => id), ["ACCOUNT", "Login event", "PROFILE"]);
  assert.deepEqual(diagram.nodes[0].source, anchor("data.md", 5));
  assert.deepEqual(diagram.nodes[0].fields[0], {
    name: "id", type: "integer", keys: ["UK", "PK"], note: "Local account id", source: anchor("data.md", 6)
  });
  assert.deepEqual(diagram.nodes[1].fields[0].keys, ["PK", "FK"]);
  assert.equal(diagram.nodes[1].fields[1].type, "text?");
  assert.deepEqual(diagram.edges.map(({ kind, cardinality, source }) => ({ kind, cardinality, source })), [
    { kind: "solid", cardinality: { from: "1", to: "0..*" }, source: anchor("data.md", 3) },
    { kind: "dashed", cardinality: { from: "1..*", to: "0..1" }, source: anchor("data.md", 4) }
  ]);
  const single = fence("erDiagram", "PROFILE {", "    text id PK", "}");
  const [entity] = await readAuthoredDiagrams(fixture(["data.md"]), async () => single.split("\n"));
  assert.equal(entity.nodes.length, 1);
  assert.equal(entity.edges.length, 0);
});

test("authored sequence, state and architecture preserve exact source and graph semantics", async () => {
  const docs = {
    "docs/reservations.md": `## Booking sequence\n\n${sequence}\n\n## Notification lifecycle\n\n${state}`,
    "waitlist-design/README.md": `# Proposed waitlist\n\n${graph}`
  };
  const space = fixture([...Object.keys(docs), "secrets.json", "missing.md"]);
  const visited = [];
  const read = async (doc) => {
    visited.push(doc);
    return docs[doc]?.split("\n") ?? null;
  };
  const [booking, lifecycle, components] = await readAuthoredDiagrams(space, read);
  assert.deepEqual(visited, ["docs/reservations.md", "waitlist-design/README.md", "missing.md"]);
  assert.deepEqual([booking.kind, lifecycle.kind, components.kind], ["sequence", "state", "graph"]);
  assert.equal(booking.origin, "mermaid");
  assert.equal(booking.title, "Booking sequence");
  assert.match(booking.note, /current workspace document/);
  assert.deepEqual(booking.source, anchor("docs/reservations.md", 3, 19));
  assert.equal(booking.nodes.find(({ id }) => id === "Member")?.hint, "actor");
  assert.deepEqual(booking.edges.find(({ label }) => label === "409 TIME_CONFLICT"), {
    id: "e-3", from: "API", to: "Member", label: "409 TIME_CONFLICT", kind: "dashed",
    guard: "Known identity / Active overlap", source: anchor("docs/reservations.md", 12)
  });
  assert.equal(booking.edges.at(-1)?.guard, "Missing or unknown identity");
  assert.equal(lifecycle.nodes.find(({ id }) => id === "$start")?.hint, "initial");
  assert.equal(lifecycle.nodes.find(({ id }) => id === "$end")?.hint, "terminal");
  assert.equal(lifecycle.edges.find(({ from, to }) => from === to)?.guard, "retry");
  assert.equal(components.owner, "b-waitlist");
  assert.equal(components.nodes.find(({ id }) => id === "Gate")?.hint, "decision");
  assert.equal(components.nodes.find(({ id }) => id === "API")?.group, "Local process");
  assert.equal(components.nodes.find(({ id }) => id === "DB")?.hint, "store");
  assert.equal(components.edges.at(-1)?.kind, "dashed");
  assert.equal((await readAuthoredDiagrams(space, read))[0]?.id, booking.id);
  docs["docs/reservations.md"] = docs["docs/reservations.md"].replace("201 Confirmed", "201 Reservation confirmed");
  assert.notEqual((await readAuthoredDiagrams(space, read))[0]?.id, booking.id);
  assert.deepEqual(space.diagrams, []);
});

test("unsupported statements, unsafe labels, invalid alternatives and oversized graphs stay raw", async () => {
  const input = [
    fence("erDiagram", "ONE ||--x{ MANY : unknown"),
    fence("erDiagram", "ONE {", "    text id PK"),
    fence("erDiagram", "ONE {", '    text id PK "<script>unsafe</script>"', "}"),
    fence("erDiagram", "ONE {", "    text id", "    text id PK", "}"),
    fence("%%{init: {}}%%", "flowchart LR", "A --> B"),
    fence("flowchart LR", "A --> B", 'click A "javascript:alert(1)"'),
    fence("flowchart LR", 'A["<b>HTML</b>"] --> B'),
    fence("flowchart LR", 'A["&lt;HTML&gt;"] --> B'),
    fence("flowchart LR", "A --> B --> C"),
    fence("flowchart LR", "subgraph A", "B --> C", "end", "A --> B"),
    fence("sequenceDiagram", "alt incomplete", "A->>B: first"),
    fence("sequenceDiagram", "A->>B: first", "else alone", "B-->>A: later"),
    fence("stateDiagram-v2", "[*] --> A", "note right of A : text"),
    fence("flowchart LR", ...Array.from({ length: 25 }, (_, index) => `A --> B${index}`)),
    fence("flowchart LR", ...Array.from({ length: 49 }, () => "A --> B")),
    "## Supported diagram",
    graph
  ].join("\n\n");
  const diagrams = await readAuthoredDiagrams(fixture(["guide.md"]), async () => input.split("\n"));
  assert.deepEqual(diagrams.map(({ title }) => title), ["Supported diagram"]);
});

test("live and export reads add searchable layouts without writing the accepted snapshot", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "kodyurd-authored-"));
  const saved = path.join(dir, "space.json");
  const doc = path.join(dir, "guide.md");
  t.after(async () => {
    await unlink(saved);
    await unlink(doc);
    await rmdir(dir);
  });
  const docs = [sequence, state, graph, erd].join("\n\n");
  await writeFile(doc, docs);
  const accepted = fixture(["guide.md", "../outside.md"], [
    codeMap("accepted-code-sequence", "sequence", anchor("app.mjs", 12)),
    codeMap("accepted-doc-state", "state", anchor("guide.md", 19, 25))
  ]);
  const original = JSON.stringify({ space: accepted, layout: buildSpaceLayout(accepted) });
  await writeFile(saved, original);
  const stored = await readSavedSpaceFile(saved);
  assert.deepEqual(stored.space.diagrams, accepted.diagrams);

  const live = await readSavedSpaceFile(saved, dir);
  assert.deepEqual(live.space.diagrams.slice(0, 2), accepted.diagrams);
  const authored = live.space.diagrams.slice(2);
  assert.deepEqual(authored.map(({ kind }) => kind), ["sequence", "graph", "erd"]);
  const entityLayout = live.layout.diagrams[authored[2].id];
  const [account, event] = ["ACCOUNT", "Login event"].map((id) => entityLayout.nodes.find((node) => node.id === id));
  assert.ok(event.x > account.x + account.w);
  assert.ok(event.h > account.h);
  for (const { id } of authored) {
    assert.ok(live.layout.diagrams[id]);
    assert.ok(live.space.navigation.searchIndex.some(({ ref, sourcePath }) => ref === id && sourcePath === "guide.md"));
  }
  assert.equal(parseSpace(live.space).success, true);
  assert.deepEqual(live.space.meta.coverage, accepted.meta.coverage);
  assert.equal(await readFile(saved, "utf8"), original);
  await writeFile(doc, docs.replace("201 Confirmed", "201 Reservation confirmed"));
  const revised = await readSavedSpaceFile(saved, dir);
  assert.notEqual(revised.space.diagrams[2]?.id, authored[0]?.id);
  assert.equal(revised.space.diagrams[3]?.id, authored[1]?.id);
  assert.equal(await readFile(saved, "utf8"), original);
});
