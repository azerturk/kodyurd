# ADR 001 · Store notification intent in the reservation transaction

**Status** Accepted

## Context

Reservations must survive process restarts. Confirmation and cancellation create an observable update for their owners. Updating a reservation and scheduling its notification in separate commits would let an interruption leave a valid reservation with no durable notification intent.

## Decision

Write the reservation and its outbox row in one immediate SQLite transaction. Let the worker read queued events when due. Record delivery and its terminal status in a second transaction. Identify mailbox entries by outbox ID and reject a duplicate event kind on the same reservation.

## Consequences

Reservations can succeed while notifications wait or retry. The worker can resume queued work after a restart and stops after three attempts. The demo has one SQLite database and one delivery destination, the local mailbox. Supporting an external mail service would require a separate design for its side effects.

[Reservation writes](../reservations/service.mjs) · [Schema constraints](../persistence/schema.mjs) · [Rollback test](../persistence/database.test.mjs)
