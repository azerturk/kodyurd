import assert from "node:assert/strict";
import test from "node:test";
import { districtStyle, mapDistrictTitle } from "../src/viewer/city-map.ts";

test("the map legend shares distinguishable deterministic district colors and preserves authored names", () => {
  assert.notDeepEqual(districtStyle(0), districtStyle(1));
  assert.deepEqual(districtStyle(6), districtStyle(0));
  assert.equal(mapDistrictTitle("City", "Harbor Desk", 1), "Harbor Desk modules");
  assert.equal(mapDistrictTitle("Booking", "Harbor Desk", 1), "Booking");
  assert.equal(mapDistrictTitle("City", "Harbor Desk", 2), "City");
});
