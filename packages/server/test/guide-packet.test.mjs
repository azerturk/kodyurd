import assert from "node:assert/strict";
import test from "node:test";
import { collectGuideEvidence, guideEvidenceCovers, relatedGuideClaimSources } from "../dist/source-evidence.js";

test("Guide starts with document context and retrieves the rule, linked query and exact test", async () => {
  const files = new Map([
    ["docs/booking.md", ["# Reservation windows", "Overlapping bookings conflict. Adjacent bookings succeed.",
      "[Storage query](../persistence/database.mjs) · [service](../reservations/service.mjs)"]],
    ["reservations/service.mjs", ["function reserve(input) {", "  if (store.hasOverlap(input)) throw new Problem(409);", "}"]],
    ["persistence/database.mjs", ["const overlapping = db.prepare(`", "  WHERE start_utc < ? AND end_utc > ?", "`);"]],
    ["test/http.test.mjs", ["test('overlap and adjacent booking', () => {", "  assert.equal(book(overlapping).status, 409);",
      "  assert.equal(book(adjacent).status, 201);", "});"]]
  ]);
  const src = (path, startLine, endLine = startLine) => ({ path, startLine, endLine });
  const report = { modules: [
    { name: "reservations", topFiles: [{ path: "reservations/service.mjs" }] },
    { name: "persistence", topFiles: [{ path: "persistence/database.mjs" }] },
    { name: "test", topFiles: [], testFiles: ["test/http.test.mjs"] }
  ], docs: [{ path: "docs/booking.md", matches: ["reservations"] }] };
  const question = "Why does an overlapping booking return 409 while an adjacent booking succeeds?";
  const claims = [{ text: "An overlap returns 409 and the adjacent booking succeeds.", evidence: [
    src("reservations/service.mjs", 2), src("test/http.test.mjs", 2, 3)
  ] }];
  const sources = await collectGuideEvidence(report, question, "Reservation windows", "reservations",
    [src("docs/booking.md", 1, 3), ...relatedGuideClaimSources([{ claims }], question)], async (file) => files.get(file) ?? null);
  for (const expected of [src("docs/booking.md", 1), src("reservations/service.mjs", 2), src("test/http.test.mjs", 2, 3),
    src("persistence/database.mjs", 2)]) {
    assert.ok(guideEvidenceCovers(expected, sources), expected.path);
  }
  assert.ok(JSON.stringify(sources).length <= 9000);
});
