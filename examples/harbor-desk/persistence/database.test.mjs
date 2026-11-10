import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveActor } from "../identity/access.mjs";
import { createNotificationWorker } from "../notifications/worker.mjs";
import { createReservationService } from "../reservations/service.mjs";
import { openStore } from "./database.mjs";

const input = { resourceId: "window-desk", start: "2031-06-12T10:00:00Z", end: "2031-06-12T10:30:00Z", attendees: 1 };
const alice = resolveActor("alice");

test("a failed enqueue rolls back the reservation row", (t) => {
  const store = openStore();
  t.after(() => store.close());
  const failingStore = { ...store, enqueue() { throw new Error("injected enqueue failure"); } };
  assert.throws(() => createReservationService(failingStore).create(alice, input), /injected enqueue failure/);
  assert.deepEqual(store.listReservations(alice.id), []);
  assert.deepEqual(store.inspectOutbox(), []);
});

test("reservations and scheduled notification retries survive closing the SQLite database", (t) => {
  const folder = mkdtempSync(join(tmpdir(), "harbor-desk-test-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const path = join(folder, "harbor.sqlite");
  const initial = openStore(path);
  let reservation;
  try {
    reservation = createReservationService(initial, { now: () => 1000 }).create(alice, input);
    const worker = createNotificationWorker(initial, { now: () => 1000, simulateDelivery: () => false });
    assert.equal(worker.tick().dueAt, 2000);
  } finally {
    initial.close();
  }

  const reopened = openStore(path);
  try {
    assert.equal(reopened.getReservation(reservation.id).totalCents, 650);
    assert.equal(reopened.inspectOutbox()[0].status, "queued");
    const worker = createNotificationWorker(reopened, { now: () => 2000 });
    assert.deepEqual(worker.tick(), { state: "delivered", attempts: 2 });
    assert.equal(reopened.listMailbox(alice.id).length, 1);
  } finally {
    reopened.close();
  }
});
