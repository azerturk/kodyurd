const identities = new Map([
  ["alice", Object.freeze({ id: "alice", name: "Alice", role: "member" })],
  ["bob", Object.freeze({ id: "bob", name: "Bob", role: "member" })],
  ["morgan", Object.freeze({ id: "morgan", name: "Morgan", role: "operator" })],
]);

export function resolveActor(header) {
  return typeof header === "string" ? identities.get(header) : undefined;
}

export function canManageReservation(actor, reservation) {
  return actor.id === reservation.ownerId || actor.role === "operator";
}

export function ownerFilter(actor) {
  return actor.role === "operator" ? null : actor.id;
}
