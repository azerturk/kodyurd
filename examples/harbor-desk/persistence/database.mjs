import { DatabaseSync } from "node:sqlite";
import { SCHEMA } from "./schema.mjs";

const RESERVATION = `
  id, owner_id AS ownerId, resource_id AS resourceId, start_utc AS start, end_utc AS end,
  attendees, total_cents AS totalCents, status, created_at AS createdAt, cancelled_at AS cancelledAt
`;

export function openStore(file = ":memory:") {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;");
  db.exec(SCHEMA);
  const readReservation = db.prepare(`SELECT ${RESERVATION} FROM reservations WHERE id = ?`);
  const allReservations = db.prepare(`SELECT ${RESERVATION} FROM reservations ORDER BY start_utc, id`);
  const ownReservations = db.prepare(`SELECT ${RESERVATION} FROM reservations WHERE owner_id = ? ORDER BY start_utc, id`);
  const overlapping = db.prepare(`
    SELECT 1 FROM reservations
    WHERE resource_id = ? AND status = 'confirmed' AND start_utc < ? AND end_utc > ?
    LIMIT 1
  `);
  const insertReservation = db.prepare(`
    INSERT INTO reservations(id, owner_id, resource_id, start_utc, end_utc, attendees, total_cents, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', ?)
  `);
  const cancelReservation = db.prepare("UPDATE reservations SET status = 'cancelled', cancelled_at = ? WHERE id = ?");
  const enqueue = db.prepare("INSERT INTO outbox(reservation_id, kind, due_at) VALUES (?, ?, ?)");
  const nextNotification = db.prepare(`
    SELECT outbox.id, reservation_id AS reservationId, kind, attempts, owner_id AS recipientId
    FROM outbox JOIN reservations ON reservations.id = outbox.reservation_id
    WHERE outbox.status = 'queued' AND due_at <= ?
    ORDER BY due_at, outbox.id LIMIT 1
  `);
  const recordDelivery = db.prepare(`
    INSERT INTO mailbox(outbox_id, recipient_id, subject, recorded_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(outbox_id) DO NOTHING
  `);
  const finishNotification = db.prepare("UPDATE outbox SET status = 'delivered', attempts = ?, last_error = NULL WHERE id = ?");
  const failNotification = db.prepare("UPDATE outbox SET status = ?, attempts = ?, due_at = ?, last_error = ? WHERE id = ?");
  const readMailbox = db.prepare(`
    SELECT outbox_id AS id, subject, recorded_at AS recordedAt FROM mailbox
    WHERE recipient_id = ? ORDER BY outbox_id
  `);
  const inspectOutbox = db.prepare("SELECT id, kind, status, attempts, due_at AS dueAt, last_error AS lastError FROM outbox ORDER BY id");

  return {
    write(operation) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const result = operation();
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    getReservation: (id) => readReservation.get(id),
    listReservations: (ownerId) => ownerId === null ? allReservations.all() : ownReservations.all(ownerId),
    hasOverlap: (resourceId, start, end) => Boolean(overlapping.get(resourceId, end, start)),
    insertReservation(input) {
      insertReservation.run(input.id, input.ownerId, input.resourceId, input.start, input.end, input.attendees, input.totalCents, input.createdAt);
      return readReservation.get(input.id);
    },
    cancelReservation(id, timestamp) {
      cancelReservation.run(timestamp, id);
      return readReservation.get(id);
    },
    enqueue: ({ reservationId, kind, dueAt }) => enqueue.run(reservationId, kind, dueAt),
    nextNotification: (timestamp) => nextNotification.get(timestamp),
    recordDelivery: (notification, subject, timestamp) => recordDelivery.run(notification.id, notification.recipientId, subject, timestamp),
    finishNotification: (id, attempts) => finishNotification.run(attempts, id),
    failNotification: (id, status, attempts, dueAt, reason) => failNotification.run(status, attempts, dueAt, reason, id),
    listMailbox: (recipientId) => readMailbox.all(recipientId),
    inspectOutbox: () => inspectOutbox.all(),
    close: () => db.close(),
  };
}
