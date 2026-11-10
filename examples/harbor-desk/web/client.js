import { formatSlotLabel } from "../slot-labels/format.mjs";

const booking = document.querySelector("#booking");
const identity = document.querySelector("#identity");
const quote = document.querySelector("#quote");
const notices = document.querySelector("#notice");
const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
let resources = [];
let activityRequest = 0;

const money = (cents) => currency.format(cents / 100);
const choice = (value, label) => new Option(label, value);

async function api(path, { method = "GET", body, actor = identity.value } = {}) {
  const headers = { "x-harbor-user": actor };
  if (body) headers["content-type"] = "application/json";
  const response = await fetch(path, { method, headers, body: body && JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message ?? "The request failed.");
  return result;
}

function showNotice(message, error = false) {
  notices.textContent = message;
  notices.classList.toggle("error", error);
}

function drawList(selector, items, render, empty) {
  const list = document.querySelector(selector);
  list.replaceChildren();
  if (!items.length) {
    const item = document.createElement("li");
    item.textContent = empty;
    list.append(item);
    return;
  }
  list.append(...items.map(render));
}

function reservationRow(reservation, actor) {
  const item = document.createElement("li");
  const text = document.createElement("span");
  const name = resources.find((resource) => resource.id === reservation.resourceId)?.name ?? reservation.resourceId;
  const date = reservation.start.slice(0, 10);
  const interval = `${reservation.start.slice(11, 16)}–${reservation.end.slice(11, 16)} UTC`;
  text.textContent = `${name} · ${date} ${interval} · ${reservation.ownerId} · ${money(reservation.totalCents)} · ${reservation.status}`;
  item.append(text);
  if (reservation.status === "confirmed") {
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "secondary";
    cancel.textContent = "Cancel booking";
    cancel.addEventListener("click", async () => {
      cancel.disabled = true;
      try {
        await api(`/api/reservations/${reservation.id}`, { method: "DELETE", actor });
        if (identity.value === actor) showNotice("Reservation cancelled.");
        await refreshActivity();
      } catch (error) {
        if (identity.value === actor) showNotice(error.message, true);
      } finally {
        cancel.disabled = false;
      }
    });
    item.append(cancel);
  }
  return item;
}

function mailboxRow(message) {
  const item = document.createElement("li");
  item.textContent = `${message.subject} · ${new Date(message.recordedAt).toISOString().slice(11, 19)} UTC`;
  return item;
}

async function refreshActivity() {
  const actor = identity.value;
  const request = ++activityRequest;
  const [{ reservations }, { messages }] = await Promise.all([
    api("/api/reservations", { actor }),
    api("/api/mailbox", { actor }),
  ]);
  if (request !== activityRequest || actor !== identity.value) return;
  document.querySelector("#reservation-scope").textContent = actor === "morgan" ? "Operator view · all reservations" : "Member view · your reservations";
  drawList("#reservations", reservations, (entry) => reservationRow(entry, actor), "No reservations for this view.");
  drawList("#mailbox", messages, mailboxRow, "No notifications have arrived yet.");
}

const refresh = () => refreshActivity().catch((error) => showNotice(error.message, true));
document.querySelector("#refresh").addEventListener("click", refresh);
identity.addEventListener("change", () => {
  document.querySelector("#reservations").replaceChildren();
  document.querySelector("#mailbox").replaceChildren();
  showNotice("");
  refresh();
});

for (let slot = 0; slot <= 18; slot += 1) {
  const time = formatSlotLabel(slot);
  if (slot < 18) booking.elements.start.add(choice(time, time));
  if (slot > 0) booking.elements.end.add(choice(time, time));
}
booking.elements.end.value = "10:00";
booking.elements.date.value = new Date().toISOString().slice(0, 10);

booking.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitter = event.submitter;
  if (!submitter) return;
  const form = new FormData(booking);
  const actor = identity.value;
  const body = {
    resourceId: form.get("resourceId"),
    start: `${form.get("date")}T${form.get("start")}:00Z`,
    end: `${form.get("date")}T${form.get("end")}:00Z`,
    attendees: Number(form.get("attendees")),
  };
  submitter.disabled = true;
  showNotice("");
  try {
    if (submitter.value === "quote") {
      const result = (await api("/api/quote", { method: "POST", body, actor })).quote;
      quote.textContent = `${result.slots} half-hour slot(s) · ${money(result.subtotalCents)} subtotal · ${money(result.discountCents)} discount · ${money(result.totalCents)} total`;
      return;
    }
    await api("/api/reservations", { method: "POST", body, actor });
    if (identity.value === actor) showNotice("Reservation confirmed. The mailbox notification will follow.");
    await refreshActivity();
  } catch (error) {
    if (identity.value === actor) showNotice(error.message, true);
  } finally {
    submitter.disabled = false;
  }
});

async function init() {
  ({ resources } = await api("/api/resources"));
  for (const resource of resources) {
    booking.elements.resourceId.add(choice(resource.id, `${resource.name} · capacity ${resource.capacity} · ${money(resource.centsPerSlot)} / 30 min`));
  }
  await refreshActivity();
}
init().catch((error) => showNotice(error.message, true));
