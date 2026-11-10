import { getResource } from "../catalog/resources.mjs";
import { Problem } from "./problem.mjs";

const SLOT_MINUTES = 30;
const OPENS = 9 * 60;
const CLOSES = 18 * 60;
const MAX_MINUTES = 4 * 60;
const UTC_SLOT = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(00|30):00Z$/;

function parseSlot(value) {
  const parts = typeof value === "string" && UTC_SLOT.exec(value);
  const time = parts ? Date.parse(value) : NaN;
  if (!Number.isFinite(time) || new Date(time).toISOString().replace(".000Z", "Z") !== value) {
    throw new Problem(400, "INVALID_WINDOW", "Use a real UTC date and a half-hour start and end.");
  }
  return { time, day: parts[1], minute: Number(parts[2]) * 60 + Number(parts[3]) };
}

export function quoteReservation(input) {
  const { resourceId, start, end, attendees } = input ?? {};
  const resource = getResource(resourceId);
  if (!resource) throw new Problem(404, "RESOURCE_UNKNOWN", "This desk or room does not exist.");
  if (!Number.isInteger(attendees) || attendees < 1 || attendees > resource.capacity) {
    throw new Problem(400, "INVALID_CAPACITY", `Choose between 1 and ${resource.capacity} attendee(s).`);
  }

  const from = parseSlot(start);
  const until = parseSlot(end);
  const minutes = (until.time - from.time) / 60_000;
  if (from.day !== until.day || from.minute < OPENS || until.minute > CLOSES || minutes < SLOT_MINUTES || minutes > MAX_MINUTES) {
    throw new Problem(400, "INVALID_WINDOW", "Book 30 minutes to 4 hours within 09:00–18:00 UTC on the same day.");
  }

  const slots = minutes / SLOT_MINUTES;
  const subtotalCents = slots * resource.centsPerSlot;
  const discountCents = resource.kind === "room" && slots >= 4 ? Math.floor(subtotalCents / 10) : 0;
  return { resourceId, start, end, attendees, slots, subtotalCents, discountCents, totalCents: subtotalCents - discountCents };
}
