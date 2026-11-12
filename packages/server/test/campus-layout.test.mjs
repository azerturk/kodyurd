import assert from "node:assert/strict";
import { test } from "node:test";
import { collectPackRoles } from "../dist/export.js";
import { layoutCity, refreshCampus } from "../dist/space-layout/index.js";

test("offline exports can resolve the same character model candidates as the live viewer", () => {
  const roles = collectPackRoles({}, {});
  for (const role of ["character-default.anim.idle", "character-default.rigged", "character-default"]) {
    assert.ok(roles.includes(role));
  }
});
const building = (id, district, archetype = "low") => ({
  id, title: id, moduleRef: id, district, archetype, metrics: { files: 4, loc: 140, docs: 0 }, summary: ""
});
const sample = () => ({
  city: {
    districts: [{ id: "workflow" }, { id: "shared" }],
    buildings: [building("core", "workflow", "tower"), building("api", "workflow", "hall"), building("delivery", "workflow"),
      building("queue", "shared"), building("docs", "shared")]
  },
  presentation: { start: { building: "core" } },
  flows: [{ id: "request", scope: "system", path: [{ ref: "api" }, { ref: "queue" }, { ref: "core" }] }]
});

test("a focused campus has clear frontages, compact neighbors and connected wayfinding", () => {
  const space = sample();
  const city = layoutCity(space);
  assert.deepEqual(layoutCity(space), city);
  const focus = city.buildings.find(({ id }) => id === "core");
  assert.equal(focus.pos.x, 0);
  assert.ok(focus.size.w > focus.size.h, "frame the entrance and wings instead of a thin tower");
  assert.ok(city.buildings.some(({ pos }) => pos.x < -8 && pos.x > -25));
  assert.ok(city.buildings.some(({ pos }) => pos.x > 8 && pos.x < 25));
  for (const building of city.buildings) {
    const front = building.pos.z + building.size.d / 2;
    assert.ok(Math.abs(front) < 0.06);
  }
  for (const [i, first] of city.buildings.entries()) for (const second of city.buildings.slice(i + 1)) {
    assert.ok(Math.abs(first.pos.x - second.pos.x) >= (first.size.w + second.size.w) / 2 + 2);
  }
  assert.ok(city.campus.d > 24);
  assert.equal(city.routes[0].flowId, "request");
  assert.ok(city.routes[0].points.some(({ x, z }) => x === 0 && Math.abs(z - 1.5) < 0.06));
  const roles = collectPackRoles(space, { city });
  assert.ok(roles.includes("tree-round"));
  assert.equal(roles.some((role) => role.startsWith("building-")), false);
});

test("saved focused geometry upgrades independently of rooms and larger city layouts", () => {
  const space = sample();
  const legacy = { city: layoutCity({ ...space, presentation: undefined }), diagrams: {}, interiors: {} };
  assert.equal(legacy.city.campus, undefined);
  const upgraded = refreshCampus(space, legacy);
  assert.ok(upgraded.city.campus);
  assert.equal(upgraded.diagrams, legacy.diagrams);
  assert.equal(upgraded.interiors, legacy.interiors);
  assert.equal(refreshCampus(space, upgraded), upgraded);

  // Up to twenty-four buildings still gather around the court; a crowded wing takes four columns.
  const wide = sample();
  for (let i = 0; i < 19; i++) wide.city.buildings.push(building(`other-${i}`, i % 2 ? "shared" : "workflow"));
  const court = layoutCity(wide);
  assert.ok(court.campus);
  assert.equal(court.buildings.length, 24);
  for (const district of ["workflow", "shared"]) {
    const members = new Set(wide.city.buildings.filter((item) => item.district === district).map(({ id }) => id));
    const rows = new Set(court.buildings.filter(({ id }) => members.has(id)).map(({ pos, size }) => Math.round((pos.z + size.d / 2) * 10)));
    assert.ok(rows.size <= 4, `${district} is at most four rows deep`);
  }
  for (const [i, first] of court.buildings.entries()) for (const second of court.buildings.slice(i + 1)) {
    const apartX = Math.abs(first.pos.x - second.pos.x) >= (first.size.w + second.size.w) / 2 + 2;
    const apartZ = Math.abs(first.pos.z - second.pos.z) >= (first.size.d + second.size.d) / 2 + 2;
    assert.ok(apartX || apartZ, `${first.id} and ${second.id} keep a lane between them`);
  }

  const large = sample();
  for (let i = 0; i < 20; i++) large.city.buildings.push(building(`other-${i}`, "shared"));
  const city = layoutCity(large);
  assert.equal(city.campus, undefined);
  assert.equal(city.buildings.length, 25);
  assert.ok(city.roads.length > 2);
});

test("a third district faces the court from the opposite wing", () => {
  const space = sample();
  space.city.districts.push({ id: "reference" });
  space.city.buildings.push(building("handbook", "reference"));
  const city = layoutCity(space);
  const handbook = city.buildings.find(({ id }) => id === "handbook");
  assert.equal(handbook.pos.x, 0);
  assert.equal(handbook.doorDir.z, -1);
  const front = handbook.pos.z - handbook.size.d / 2;
  assert.ok(front > city.plaza.pos.z && front < city.campus.z + city.campus.d);
});
