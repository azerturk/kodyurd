import assert from "node:assert/strict";
import test from "node:test";
import { walkerPose } from "../src/viewer/procedural-avatar.ts";

test("the procedural walker keeps one sole grounded while alternating support legs", () => {
  const radians = Math.PI / 180;
  for (const running of [false, true]) {
    for (const weight of [0, 0.3, 1]) {
      for (let step = 0; step < 32; step++) {
        const phase = step * Math.PI / 16;
        const pose = walkerPose(phase, weight, running);
        const soles = pose.sides.map(({ hip, knee, ankle }) => {
          assert.ok(Math.abs(hip + knee + ankle) < 1e-10);
          return 0.76 - 0.39 * Math.cos(hip * radians) - 0.37 * Math.cos((hip + knee) * radians) + pose.offset;
        });
        assert.ok(Math.abs(Math.min(...soles)) < 1e-10);
        assert.ok(Math.max(...soles) < 0.4);
      }
    }
  }
  const first = walkerPose(Math.PI / 4, 1, false);
  const next = walkerPose(Math.PI / 4 + Math.PI, 1, false);
  assert.ok(Math.abs(first.sides[0].knee - next.sides[1].knee) < 1e-10);
});

test("a standing jump bends both knees without adjusting world height", () => {
  const standing = walkerPose(0, 0, false);
  assert.ok(standing.sides.every(({ hip, knee, shoulder }) => hip === 0 && knee === 0 && shoulder === 0));
  const apex = walkerPose(0, 0, false, 0.5);
  assert.equal(apex.offset, 0);
  assert.ok(apex.sides.every(({ hip, knee, shoulder }) => hip < 0 && knee > 0 && shoulder < 0));
});
