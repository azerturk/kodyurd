import { randomUUID } from "node:crypto";
import { canManageReservation, ownerFilter } from "../identity/access.mjs";
import { Problem } from "./problem.mjs";
import { quoteReservation } from "./quote.mjs";

export function createReservationService(store, { now = Date.now, id = randomUUID } = {}) {
  return {
    quote: quoteReservation,
    list(actor) {
      return store.listReservations(ownerFilter(actor));
    },
    create(actor, input) {
      const quote = quoteReservation(input);
      const timestamp = now();
      return store.write(() => {
        if (store.hasOverlap(quote.resourceId, quote.start, quote.end)) {
          throw new Problem(409, "TIME_CONFLICT", "This resource is already reserved during part of that window.");
        }
        const reservation = store.insertReservation({ ...quote, id: id(), ownerId: actor.id, createdAt: timestamp });
        store.enqueue({ reservationId: reservation.id, kind: "confirmed", dueAt: timestamp });
        return reservation;
      });
    },
    cancel(actor, reservationId) {
      const timestamp = now();
      return store.write(() => {
        const current = store.getReservation(reservationId);
        if (!current) throw new Problem(404, "RESERVATION_UNKNOWN", "This reservation does not exist.");
        if (!canManageReservation(actor, current)) {
          throw new Problem(403, "CANCELLATION_DENIED", "Only the owner or an operator can cancel this reservation.");
        }
        if (current.status === "cancelled") return current;
        const updated = store.cancelReservation(reservationId, timestamp);
        store.enqueue({ reservationId, kind: "cancelled", dueAt: timestamp });
        return updated;
      });
    },
  };
}
