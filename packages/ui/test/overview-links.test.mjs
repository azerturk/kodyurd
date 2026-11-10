import assert from "node:assert/strict";
import { test } from "node:test";
import { overviewLinkRoute, visibleOverviewLinks } from "../src/viewer/overview-links.ts";
import { walkMove, walkPath } from "../src/viewer/walk-path.ts";

const block = (id, x, z, w = 5, d = 5) => ({ id, pos: { x, z }, size: { w, d } });
const asSolid = ({ pos, size }) => ({ ...pos, halfW: size.w / 2, halfD: size.d / 2 });

test("a map opens clear and limits a requested neighborhood without losing exact selection", () => {
  const links = Array.from({ length: 11 }, (_, i) => ({ id: String(i), from: "a", to: String(i) }));
  const unrelated = { id: "other", from: "b", to: "c" };
  const map = [unrelated, ...links];
  assert.deepEqual(visibleOverviewLinks(map), []);
  assert.deepEqual(visibleOverviewLinks(map, "a"), links.slice(0, 8));
  assert.deepEqual(visibleOverviewLinks(map, "a", "10"), [links[10]]);
  assert.deepEqual(visibleOverviewLinks(map, undefined, "other"), [unrelated]);
});

test("map routes meet building sides, bypass an intervening footprint, and split reverse links", () => {
  const a = block("a", 0, 0);
  const b = block("b", 20, 0);
  const middle = block("m", 10, 0, 5, 7);
  const solids = [a, b, middle].map(asSolid);
  const route = overviewLinkRoute(a, b, solids, walkPath, 0.82);
  const reverse = overviewLinkRoute(b, a, solids, walkPath, 0.82);
  assert(route && reverse);
  assert.deepEqual(route[0], { x: 3.12, z: 0.82 });
  assert.deepEqual(route.at(-1), { x: 16.88, z: 0.82 });
  assert.equal(reverse[0].z, -0.82);
  assert(route.length > 2);
  for (let i = 1; i < route.length; i++) {
    const previous = route[i - 1];
    const current = route[i];
    assert.equal(walkMove(previous, { x: current.x - previous.x, z: current.z - previous.z }, solids).contact, null);
  }
});
