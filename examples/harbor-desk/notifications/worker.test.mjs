import assert from "node:assert/strict";
import test from "node:test";
import { resolveActor } from "../identity/access.mjs";
import { createReservationService } from "../reservations/service.mjs";
import { openStore } from "../persistence/database.mjs";
import { createNotificationWorker } from "./worker.mjs";

const input = { resourceId: "north-desk", start: "2031-06-12T09:00:00Z", end: "2031-06-12T10:00:00Z", attendees: 1 };
const alice = resolveActor("alice");

function fixture(t, simulateDelivery) {
  const store = openStore();
  t.after(() => store.close());
  let time = 10_000;
  const now = () => time;
  const reservation = createReservationService(store, { now }).create(alice, input);
  return { store, reservation, tick: createNotificationWorker(store, { now, simulateDelivery }).tick, advance: (ms) => { time += ms; } };
}

test("temporary failure waits for its persisted due time and then delivers exactly once", (t) => {
  const { store, tick, advance } = fixture(t, (_item, attempt) => attempt > 1);
  assert.deepEqual(tick(), { state: "retry-scheduled", attempts: 1, dueAt: 11_000 });
  assert.equal(store.inspectOutbox()[0].lastError, "MAILBOX_TEMPORARILY_UNAVAILABLE");
  assert.deepEqual(store.listMailbox(alice.id), []);
  advance(999);
  assert.deepEqual(tick(), { state: "idle" });
  advance(1);
  assert.deepEqual(tick(), { state: "delivered", attempts: 2 });
  assert.equal(store.inspectOutbox()[0].lastError, null);
  assert.deepEqual(tick(), { state: "idle" });
  assert.equal(store.listMailbox(alice.id).length, 1);
});

test("three failed attempts stop retrying while the reservation stays confirmed", (t) => {
  const { store, reservation, tick, advance } = fixture(t, () => false);
  assert.equal(tick().dueAt, 11_000);
  advance(1000);
  assert.equal(tick().dueAt, 13_000);
  advance(2000);
  assert.equal(tick().state, "failed");
  assert.equal(store.inspectOutbox()[0].attempts, 3);
  assert.equal(store.getReservation(reservation.id).status, "confirmed");
  advance(100_000);
  assert.equal(tick().state, "idle");
  assert.deepEqual(store.listMailbox(alice.id), []);
});
