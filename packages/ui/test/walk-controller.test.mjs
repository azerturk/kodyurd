import assert from "node:assert/strict";
import test from "node:test";
import { advanceVelocity, avatarVisibleAt, clearBoom, clearSurface, followBoom, groundedClipRate, intersectsWalker, streetExhibitSite, streetExhibitYaw, streetExitPoint, STREET_EXHIBIT_SIZE, walkGait, walkMove, walkPath } from "../src/viewer/walk-path.ts";

const near = (value, expected, tolerance = 0.002) => assert.ok(Math.abs(value - expected) <= tolerance, `${value} ≈ ${expected}`);

test("a continuous collision sweep slides equally along either side of a thin wall", () => {
  const wall = { x: 0, z: 0, halfW: 0.06, halfD: 3, label: "lobby wall" };
  for (const side of [-1, 1]) {
    const result = walkMove({ x: 2 * side, z: -1 }, { x: -4 * side, z: 2 }, [wall]);
    assert.equal(result.contact, "wall");
    assert.equal(result.solid, wall);
    near(result.position.x, 0.32 * side);
    near(result.position.z, 1);
    assert.equal(intersectsWalker(result.position.x, result.position.z, wall), false);
  }
});

test("rounded clearance leaves a route around a corner and into a narrow doorway", () => {
  const block = { x: 0, z: 0, halfW: 0.5, halfD: 0.5 };
  assert.equal(intersectsWalker(-0.70, -0.70, block), false);
  const around = walkMove({ x: -1, z: -0.92 }, { x: 0.30, z: 0.22 }, [block]);
  assert.equal(around.contact, null);
  near(around.position.x, -0.70);
  near(around.position.z, -0.70);

  const door = [
    { x: 1, z: -1.82, halfW: 0.10, halfD: 1.5 },
    { x: 1, z: 1.82, halfW: 0.10, halfD: 1.5 }
  ];
  const floor = (x, z) => x >= 0 && x <= 3 && Math.abs(z) < 2;
  const nearSide = { x: 0.3, z: 0 };
  const farSide = { x: 2.5, z: 0 };
  assert.deepEqual(walkPath(nearSide, farSide, door, floor), [farSide]);
  assert.deepEqual(walkMove(nearSide, { x: 2.2, z: 0 }, door, floor).position, farSide);
  assert.deepEqual(walkMove(farSide, { x: -2.2, z: 0 }, door, floor).contact, null);
});

test("indoor camera boom stops before an exterior opening while a connected passage stays clear", () => {
  const room = (x, z) => x >= -8 && x <= 8 && z >= 0 && z <= 15;
  const passage = (x, z) => x > 7.9 && x < 16 && z >= 5.3 && z <= 8.5;
  const floor = (x, z) => room(x, z) || passage(x, z);
  near(clearSurface({ x: 0, z: 2 }, { x: 0, z: -4 }, floor), 1 / 3);
  assert.equal(clearSurface({ x: 9.5, z: 6.9 }, { x: 6, z: 6.9 }, floor), 1);
  const stopped = walkMove({ x: 0, z: 1 }, { x: 0, z: -3 }, [], floor);
  assert.equal(stopped.contact, "surface");
  near(stopped.position.z, 0);
});

test("starting and braking produce the same travel at 30 and 60 FPS", () => {
  const simulate = (rate) => {
    let velocity = 0;
    let distance = 0;
    for (let frame = 0; frame < rate * 2; frame++) {
      const running = frame < rate;
      const step = advanceVelocity(velocity, running ? 4.45 : 0, 1 / rate, running ? 13 : 22);
      velocity = step.velocity;
      distance += step.travel;
    }
    return { distance, velocity };
  };
  const a = simulate(30);
  const b = simulate(60);
  near(a.distance, b.distance, 1e-9);
  near(a.velocity, 0, 1e-6);
});

test("a dropped frame and a closed door advance the clip only by resolved travel", () => {
  const rigScale = 1.78;
  const pace = 0.558 * rigScale;
  near(groundedClipRate("walk", 0.08, 0.1, rigScale) * 0.1 * pace, 0.08, 1e-8);
  assert.equal(groundedClipRate("walk", 0, 0.05, rigScale), 0);
  assert.equal(walkGait(0.12, "idle", false), "idle");
  assert.equal(walkGait(0.12, "walk", false), "walk");
  assert.equal(walkGait(2.9, "run", false), "run");
  assert.equal(walkGait(2.9, "walk", false), "walk");
  assert.equal(walkGait(0, "idle", true), "jump");
});

test("an exterior exit keeps a clear backdrop distance and falls back in a tight block", () => {
  const door = { x: 12, z: -4 };
  const outward = { x: 0, z: -1 };
  assert.deepEqual(streetExitPoint(door, outward, () => true), { x: 12, z: -11.2 });
  assert.deepEqual(streetExitPoint(door, outward, (_x, z) => z > -10), { x: 12, z: -9.8 });
  assert.equal(streetExitPoint(door, outward, () => false), undefined);
});

test("a street exhibit reserves its turned footprint clear of planters, the approach and the road", () => {
  const door = { x: 0, z: 0 };
  const outward = { x: 0, z: 1 };
  const planter = { x: -3.85, z: 3.05, halfW: 1.6, halfD: 0.8 };
  const approach = [{ x: 3.85, z: 9 }, { x: 3.85, z: 0 }];
  const fitsBeforeRoad = (site) => site.z + site.halfD < 8;
  const site = streetExhibitSite(door, outward, 10, [planter], approach, fitsBeforeRoad);
  assert.deepEqual(site, { x: -3.85, z: 6.3, halfW: 1.32, halfD: 0.93 });
  assert.equal(walkMove(approach[0], { x: 0, z: -9 }, [site]).contact, null);
  assert.equal(streetExhibitSite(door, outward, 10, [planter], approach, (site) => site.z + site.halfD < 7), undefined);

  const turned = streetExhibitSite(door, { x: 1, z: 0 }, 10, [], [], () => true);
  assert.equal(turned.halfW, STREET_EXHIBIT_SIZE.d / 2);
  assert.equal(turned.halfD, STREET_EXHIBIT_SIZE.w / 2);
});

test("street exhibits face their wider side towards an arriving walker on either street axis", () => {
  const site = { x: 0, z: 0 };
  assert.equal(streetExhibitYaw(0.261, 0.882, site, { x: 0, z: 1 }, { x: 0, z: 5 }), 90);
  assert.equal(streetExhibitYaw(0.882, 0.261, site, { x: 1, z: 0 }, { x: 5, z: 0 }), 90);
  assert.equal(streetExhibitYaw(0.882, 0.261, site, { x: 0, z: 1 }, { x: 0, z: 5 }), 180);
  assert.equal(streetExhibitYaw(0.261, 0.882, site, { x: 0, z: 1 }, { x: 5, z: 1 }), 108);
  assert.equal(streetExhibitYaw(0.261, 0.882, site, { x: 0, z: 1 }, { x: 5, z: -1 }), 90);
});

test("a lagged diagonal step cannot tunnel a thin wall or round into a forbidden corner", () => {
  const upright = { x: 0, z: 0, halfW: 0.03, halfD: 7 };
  const cross = { x: -1.4, z: 1.25, halfW: 1.42, halfD: 0.035 };
  const start = { x: -1.8, z: -2.8 };
  const hit = walkMove(start, { x: 8, z: 11 }, [upright, cross]);
  assert.equal(hit.contact, "wall");
  assert.ok(hit.position.x < -0.29);
  assert.ok(hit.position.z < 0.955);
  assert.ok(![upright, cross].some((solid) => intersectsWalker(hit.position.x, hit.position.z, solid)));
  const escape = walkMove(hit.position, { x: -0.68, z: -0.84 }, [upright, cross]);
  assert.equal(escape.contact, null);
  assert.ok(escape.position.x < hit.position.x - 0.6 && escape.position.z < hit.position.z - 0.8);
});

test("camera retracts immediately, then recovers without crossing the clear distance or flickering", () => {
  assert.equal(followBoom(4.15, 0.61, 1 / 60, false), 0.61);
  let distance = 0.61;
  let wasVisible = avatarVisibleAt(distance, true);
  assert.equal(wasVisible, false);
  for (const available of [0.82, 0.71, 0.84, 0.68, 0.83]) {
    distance = followBoom(distance, available, 1 / 30, false);
    assert.ok(distance <= available);
    wasVisible = avatarVisibleAt(distance, wasVisible);
    assert.equal(wasVisible, false);
  }
  const first = followBoom(distance, 4.15, 1 / 60, false);
  assert.ok(first > distance && first < 4.15);
  assert.equal(avatarVisibleAt(1, wasVisible), true);
  assert.equal(avatarVisibleAt(0.75, true), true);
});

test("open gates and inactive rooms leave no hidden collision, while a closed gate still blocks", () => {
  const from = { x: 0, z: 0 };
  const to = { x: 0, z: 4 };
  const gate = { x: 0, z: 2, halfW: 1.58, halfD: 0.09, height: 1.19, active: true };
  const oldRoom = { x: 0, z: 1, halfW: 2, halfD: 0.08, height: 3, active: false };
  const floor = (x, z) => Math.abs(x) <= 1.7 && z >= 0 && z <= 4.5;
  assert.equal(walkMove(from, to, [gate, oldRoom], floor).solid, gate);
  assert.ok(clearBoom({ ...from, y: 0.95 }, { ...to, y: 0.95 }, [gate, oldRoom], 0.18) < 1);
  gate.active = false;
  assert.deepEqual(walkMove(from, to, [gate, oldRoom], floor).position, to);
  assert.deepEqual(walkPath(from, to, [gate, oldRoom], floor), [to]);
  assert.equal(clearBoom({ ...from, y: 0.95 }, { ...to, y: 0.95 }, [gate, oldRoom], 0.18), 1);
  gate.active = true;
  assert.equal(walkMove(to, { x: 0, z: -4 }, [gate, oldRoom], floor).solid, gate);
});

test("a diagonal attempt to leave the passage remains on the active floor", () => {
  const areas = [
    (x, z) => x >= -2 && x <= 2 && z >= 0 && z <= 6,
    (x, z) => x >= 1.95 && x <= 7.05 && z >= 2.8 && z <= 4.2,
    (x, z) => x >= 7 && x <= 11 && z >= 0 && z <= 6
  ];
  const floor = (x, z) => areas.some((contains) => contains(x, z));
  const from = { x: 0, z: 3.5 };
  const to = { x: 9, z: 3.5 };
  assert.deepEqual(walkPath(from, to, [], floor), [to]);
  assert.deepEqual(walkPath(to, from, [], floor), [from]);
  const blocked = walkMove({ x: 4, z: 3.5 }, { x: 1.5, z: 2.2 }, [], floor);
  assert.equal(blocked.contact, "surface");
  assert.ok(floor(blocked.position.x, blocked.position.z));
  near(blocked.position.z, 4.2);
});
