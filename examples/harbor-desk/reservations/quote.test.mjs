import assert from "node:assert/strict";
import test from "node:test";
import { quoteReservation } from "./quote.mjs";

const room = {
  resourceId: "chart-room", start: "2031-06-12T09:00:00Z", end: "2031-06-12T11:00:00Z", attendees: 4,
};

test("the four-slot room applies a 10% discount in integer cents", () => {
  assert.deepEqual(quoteReservation(room), { ...room, slots: 4, subtotalCents: 5000, discountCents: 500, totalCents: 4500 });
});

test("a shorter room booking and an equally long desk booking use full rate", () => {
  assert.equal(quoteReservation({ ...room, end: "2031-06-12T10:30:00Z" }).totalCents, 3750);
  assert.equal(quoteReservation({ ...room, resourceId: "north-desk", attendees: 1 }).totalCents, 2000);
});

test("the final closing slot works, but impossible dates, cross-day and off-grid slots fail", () => {
  assert.equal(quoteReservation({ ...room, start: "2031-06-12T17:30:00Z", end: "2031-06-12T18:00:00Z" }).slots, 1);
  for (const variation of [
    { start: "2031-02-30T09:00:00Z", end: "2031-02-30T11:00:00Z" },
    { start: "2031-06-12T09:15:00Z" }, { start: "2031-06-12T08:30:00Z" },
    { end: "2031-06-13T11:00:00Z" }, { end: "2031-06-12T13:30:00Z" },
  ]) assert.throws(() => quoteReservation({ ...room, ...variation }), { code: "INVALID_WINDOW" });
  assert.throws(() => quoteReservation({ ...room, attendees: 7 }), { code: "INVALID_CAPACITY" });
});
