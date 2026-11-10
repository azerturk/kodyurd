export const RESOURCES = Object.freeze([
  Object.freeze({ id: "north-desk", name: "North Desk", kind: "desk", capacity: 1, centsPerSlot: 500 }),
  Object.freeze({ id: "window-desk", name: "Window Desk", kind: "desk", capacity: 1, centsPerSlot: 650 }),
  Object.freeze({ id: "chart-room", name: "Chart Room", kind: "room", capacity: 6, centsPerSlot: 1250 }),
  Object.freeze({ id: "pier-room", name: "Pier Room", kind: "room", capacity: 10, centsPerSlot: 1800 }),
]);

export const getResource = (resourceId) => RESOURCES.find((resource) => resource.id === resourceId);
