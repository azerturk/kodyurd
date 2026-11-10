import assert from "node:assert/strict";
import test from "node:test";
import { formatSlotLabel } from "./format.mjs";

test("slot indices format as zero-padded half-hour labels from opening to close", () => {
  assert.deepEqual([0, 1, 2, 17, 18].map(formatSlotLabel), ["09:00", "09:30", "10:00", "17:30", "18:00"]);
});
