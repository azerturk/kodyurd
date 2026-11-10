import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createApp } from "../app.mjs";
import { createNotificationWorker } from "../notifications/worker.mjs";
import { openStore } from "../persistence/database.mjs";

const room = { resourceId: "chart-room", start: "2031-06-12T09:00:00Z", end: "2031-06-12T11:00:00Z", attendees: 4 };

async function fixture(t) {
  const store = openStore();
  const app = createApp({ store, now: () => 1000 });
  t.after(async () => {
    try {
      if (app.listening) await new Promise((resolve, reject) => app.close((error) => error ? reject(error) : resolve()));
    } finally {
      store.close();
    }
  });
  app.listen(0, "127.0.0.1");
  await once(app, "listening");
  const base = `http://127.0.0.1:${app.address().port}`;
  const raw = (path, options) => fetch(base + path, options);
  async function request(path, { method = "GET", actor, body, contentType = "application/json" } = {}) {
    const headers = {};
    if (actor) headers["x-harbor-user"] = actor;
    if (body !== undefined) headers["content-type"] = contentType;
    const response = await raw(path, { method, headers, body: typeof body === "string" ? body : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }
  const book = (actor, body = room) => request("/api/reservations", { method: "POST", actor, body });
  return { raw, request, book, store };
}

test("HTTP flow serves the browser UI, quotes, confirms, lists and asynchronously delivers", async (t) => {
  const { raw, request, book, store } = await fixture(t);
  const page = await raw("/");
  assert.match(page.headers.get("content-type"), /^text\/html/);
  assert.match(await page.text(), /Local mailbox/);
  const script = await raw("/client.js");
  assert.match(script.headers.get("content-type"), /^text\/javascript/);
  const client = await script.text();
  assert.match(client, /\/api\/quote/);
  assert.match(client, /from "\.\.\/slot-labels\/format\.mjs"/);
  const slotLabels = await raw("/slot-labels/format.mjs");
  assert.equal(slotLabels.status, 200);
  assert.match(slotLabels.headers.get("content-type"), /^text\/javascript/);
  assert.match(await slotLabels.text(), /export function formatSlotLabel/);
  assert.equal((await raw("/slot-labels/format.test.mjs")).status, 404);
  assert.equal((await request("/api/resources")).body.resources.length, 4);

  const quote = await request("/api/quote", { method: "POST", body: room });
  assert.equal(quote.body.quote.totalCents, 4500);
  const booked = await book("alice");
  assert.equal(booked.status, 201);
  assert.equal(booked.body.reservation.status, "confirmed");
  assert.equal(booked.body.reservation.totalCents, quote.body.quote.totalCents);
  assert.equal((await request("/api/reservations", { actor: "alice" })).body.reservations.length, 1);
  assert.equal((await request("/api/reservations", { actor: "bob" })).body.reservations.length, 0);
  assert.equal((await request("/api/reservations", { actor: "morgan" })).body.reservations.length, 1);

  assert.deepEqual((await request("/api/mailbox", { actor: "alice" })).body.messages, []);
  assert.equal(createNotificationWorker(store, { now: () => 1000 }).tick().state, "delivered");
  assert.equal((await request("/api/mailbox", { actor: "alice" })).body.messages[0].subject, "Reservation confirmed");
  assert.deepEqual((await request("/api/mailbox", { actor: "morgan" })).body.messages, []);
});

test("HTTP rejects missing identities, malformed or oversized bodies and invalid capacity", async (t) => {
  const { request, book, store } = await fixture(t);
  assert.equal((await book(undefined)).body.error, "IDENTITY_REQUIRED");
  assert.equal((await book("not-a-user")).status, 401);
  assert.equal((await request("/api/quote", { method: "POST", body: "{}", contentType: "text/plain" })).status, 415);
  assert.equal((await request("/api/quote", { method: "POST", body: "{", contentType: "application/json" })).body.error, "BAD_JSON");
  assert.equal((await request("/api/quote", { method: "POST", body: { content: "x".repeat(9000) } })).status, 413);
  assert.equal((await book("alice", { ...room, attendees: 7 })).body.error, "INVALID_CAPACITY");
  assert.deepEqual(store.inspectOutbox(), []);
});

test("overlap conflict is exclusive, an adjacent slot succeeds, and only an owner or operator can release it", async (t) => {
  const { request, book, store } = await fixture(t);
  const [first, second] = await Promise.all([book("alice"), book("bob")]);
  const accepted = [first, second].find((result) => result.status === 201);
  const conflict = [first, second].find((result) => result.status === 409);
  assert.equal(conflict.body.error, "TIME_CONFLICT");
  const reservation = accepted.body.reservation;
  const outsider = reservation.ownerId === "alice" ? "bob" : "alice";
  const cancellation = `/api/reservations/${reservation.id}`;
  assert.equal((await request(cancellation, { method: "DELETE", actor: outsider })).body.error, "CANCELLATION_DENIED");
  assert.equal((await book(outsider, { ...room, start: "2031-06-12T11:00:00Z", end: "2031-06-12T11:30:00Z" })).status, 201);
  assert.equal((await request(cancellation, { method: "DELETE", actor: "morgan" })).body.reservation.status, "cancelled");
  assert.equal((await request(cancellation, { method: "DELETE", actor: "morgan" })).status, 200);
  assert.equal(store.inspectOutbox().filter((event) => event.kind === "cancelled").length, 1);
  assert.equal((await book(outsider)).status, 201);
});
