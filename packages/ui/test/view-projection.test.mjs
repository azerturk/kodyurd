import assert from "node:assert/strict";
import test from "node:test";
import { Camera, GraphNode, PROJECTION_ORTHOGRAPHIC, PROJECTION_PERSPECTIVE, ASPECT_MANUAL, Vec3 } from "playcanvas";
import { labelPosition, distanceToSegment, fitArrivalView, fitClearArrivalView, fitOrthographic, placeWorldLabel, viewRect } from "../src/viewer/view-projection.ts";
import { fitDisplayCopy, workshopExhibits, wrapDisplayCopy } from "../src/viewer/exhibit-layout.ts";
import { clearBoom } from "../src/viewer/walk-path.ts";

const width = 1280;
const height = 720;

test("billboard and projected label copy keep every character on long technical lines", () => {
  const name = "bindProfileFormAndRenderDetailedValidationStatus";
  const title = `Profile validation with ${name} and the full results`;
  const measure = (text, size) => text.length * size * 0.55;
  const board = fitDisplayCopy(title, 175, 63, 31, measure);
  assert.equal(board.lines.join("").replace(/\s/g, ""), title.replace(/\s/g, ""));
  assert.ok(board.lines.every((line) => measure(line, board.size) <= 175));
  assert.ok(board.leading * board.lines.length <= 63);
  const narrow = wrapDisplayCopy(name, 92, (text) => measure(text, 13));
  assert.ok(narrow.length > 1);
  assert.equal(narrow.join(""), name);
});

test("workshop exhibits keep the entire door and wall gap clear, including older dense layouts", () => {
  const panels = Array.from({ length: 8 }, (_, index) => ({ pos: { x: index % 2 ? 10 : -10, z: 8 } }));
  for (const d of [16, 22, 34]) {
    const cards = workshopExhibits(panels, { z: 0, d }, 6.9, 1.65);
    assert.equal(cards.length, panels.length);
    for (const side of [-1, 1]) {
      let last = 6.9 + 1.65;
      for (const { z, width } of cards.filter(({ panel }) => Math.sign(panel.pos.x) === side)) {
        const halfFrame = (width + 0.17) / 2;
        assert.ok(z - halfFrame > last, "A frame overlaps the passage or another exhibit");
        assert.ok(z + halfFrame < d, "A frame extends beyond the room");
        last = z + halfFrame;
      }
    }
  }
});

test("diagram labels stay outside model silhouettes and yield when a compact view has no room", () => {
  const view = { left: 12, right: 420, top: 30, bottom: 300 };
  const model = { left: 150, right: 260, top: 110, bottom: 220 };
  const neighbor = { left: 120, right: 290, top: 56, bottom: 108 };
  const placed = placeWorldLabel(205, 110, 48, 24, view, [model, neighbor], model);
  assert.ok(placed);
  assert.ok(placed.rect.left > model.right || placed.rect.right < model.left || placed.rect.top > model.bottom);
  assert.equal(placeWorldLabel(205, 110, 60, 38, model, [model], model), undefined);
});
const camera = new Camera();
camera.node = new GraphNode();
camera.aspectRatioMode = ASPECT_MANUAL;
camera.aspectRatio = width / height;
camera.nearClip = 0.1;
camera.farClip = 700;
camera.orthoHeight = 12;
camera.node.setPosition(0, 34, -4973);
camera.node.lookAt(0, 0, -5000);

function project(point) {
  const screen = camera.worldToScreen(point, width, height);
  return labelPosition(point, camera.node.getPosition(), camera.node.forward, camera.nearClip, camera.farClip, width, height, screen);
}

test("front-of-camera graph labels survive negative orthographic clip z", () => {
  camera.projection = PROJECTION_ORTHOGRAPHIC;
  const point = new Vec3(0, 0.75, -5000);
  assert.ok(camera.worldToScreen(point, width, height).z < 0);
  assert.equal(project(point).xPct, 50);
  assert.ok(project(point).yPct > 46 && project(point).yPct < 51);
});

test("both camera projections reject behind, far, and viewport-cropped anchors", () => {
  for (const projection of [PROJECTION_ORTHOGRAPHIC, PROJECTION_PERSPECTIVE]) {
    camera.projection = projection;
    assert.ok(project(new Vec3(0, 0.75, -5000)));
    assert.equal(project(new Vec3(0, 34, -4965)), null);
    assert.equal(project(new Vec3(10000, 0, -5000)), null);
    assert.equal(project(new Vec3(0, -1100, -6100)), null);
  }
});

test("CSS viewport percentages remain invariant across device-pixel ratios", () => {
  const point = new Vec3(0, 0.75, -5000);
  const screen = camera.worldToScreen(point, width, height);
  for (const dpr of [1, 1.25, 1.5, 2]) {
    const clientWidth = width * dpr / dpr;
    const clientHeight = height * dpr / dpr;
    assert.equal(labelPosition(point, camera.node.getPosition(), camera.node.forward, 0.1, 700, clientWidth, clientHeight, screen).xPct, 50);
  }
  assert.equal(distanceToSegment(5, 3, { x: 0, y: 0 }, { x: 10, y: 0 }), 3);
});

function assertInside(viewCamera, points, w, h, safe) {
  for (const { x, y, z } of points) {
    const screen = viewCamera.worldToScreen(new Vec3(x, y, z), w, h);
    assert.ok(screen.x >= safe.left - 0.04 && screen.x <= safe.right + 0.04, `${screen.x} outside x ${safe.left}–${safe.right}`);
    assert.ok(screen.y >= safe.top - 0.04 && screen.y <= safe.bottom + 0.04, `${screen.y} outside y ${safe.top}–${safe.bottom}`);
  }
}

test("orthographic fit includes branch geometry at orbit and top-view angles with responsive insets", () => {
  const points = [{ x: -21, y: 0, z: 0 }, { x: -4, y: 1.7, z: -8 }, { x: 18, y: 1.7, z: 0 }, { x: 25, y: 0.3, z: 11 }];
  for (const [w, h, insets] of [[1280, 720, { left: 0, right: 365, top: 68, bottom: 88 }], [390, 750, { left: 0, right: 0, top: 58, bottom: 290 }]]) {
    const safe = viewRect(w, h, insets, 24);
    for (const yaw of [-0.9, 0, 0.9]) for (const pitch of [0.68, 1.49]) {
      const stageCamera = new Camera();
      stageCamera.node = new GraphNode();
      stageCamera.projection = PROJECTION_ORTHOGRAPHIC;
      stageCamera.aspectRatioMode = ASPECT_MANUAL;
      stageCamera.aspectRatio = w / h;
      const { target, halfHeight, back, distance } = fitOrthographic(points, w, h, safe, yaw, pitch);
      stageCamera.orthoHeight = halfHeight;
      stageCamera.node.setPosition(target.x + back.x * distance, target.y + back.y * distance, target.z + back.z * distance);
      stageCamera.node.lookAt(target.x, target.y, target.z);
      assertInside(stageCamera, points, w, h, safe);
    }
  }
});

test("perspective arrival fits the roof, doorway and foreground avatar around a start card", () => {
  const safe = viewRect(width, height, { left: 0, right: 310, top: 58, bottom: 50 }, 18);
  for (const side of [-1, 1]) {
    const arrivalCamera = new Camera();
    arrivalCamera.node = new GraphNode();
    arrivalCamera.projection = PROJECTION_PERSPECTIVE;
    arrivalCamera.aspectRatioMode = ASPECT_MANUAL;
    arrivalCamera.fov = 62;
    arrivalCamera.aspectRatio = width / height;
    const points = [
      { x: -11, y: 0, z: 0 }, { x: 11, y: 0, z: 0 },
      { x: -11, y: 22, z: 0 }, { x: 11, y: 22, z: 0 },
      { x: 0, y: 0, z: side * 19 }, { x: 0, y: 1.95, z: side * 19 }
    ];
    const { position, back } = fitArrivalView(points, width, height, safe, side > 0 ? 0.17 : Math.PI + 0.17, 0.12, arrivalCamera.fov);
    assert.ok(position.y >= 0.48);
    arrivalCamera.node.setPosition(position.x, position.y, position.z);
    arrivalCamera.node.lookAt(position.x - back.x, position.y - back.y, position.z - back.z);
    assertInside(arrivalCamera, points, width, height, safe);
    const foot = arrivalCamera.worldToScreen(new Vec3(0, 0, side * 19), width, height);
    assert.ok(foot.y > (safe.top + safe.bottom) / 2);
  }
});

test("Harbor's narrow arrival bypasses the plaza board with the avatar and facade in frame", () => {
  const width = 390;
  const height = 844;
  const board = { x: 10.4, z: 19.8, halfW: 2.91, halfD: 0.15, height: 3.78 };
  const avatar = { x: 5.3, y: 1.626, z: 12.3 };
  const entrance = { x: 0, y: 1.7, z: 0.64 };
  const points = [
    ...[-8.06, 8.06].flatMap((x) => [{ x, y: 0, z: 0 }, { x, y: 14.43, z: 0 }]),
    { ...avatar, y: 0.046 }, { ...avatar, y: 1.996 }
  ];
  const fov = 71.05;
  const canSee = (from, to) => clearBoom(from, to, [board], 0.15) === 1;
  for (const bottom of [0, 170, 330]) {
    const rect = viewRect(width, height, { top: 60, right: 0, bottom, left: 0 }, 18);
    const options = { points, width, height, rect, fov, avatar, entrance };
    const obstructed = fitClearArrivalView({ ...options, yaws: [0.36], canSee: () => true });
    assert.equal(canSee(avatar, obstructed.position), false);
    assert.equal(canSee(entrance, obstructed.position), false);
    const fit = fitClearArrivalView({ ...options, yaws: [0.36, 0, -0.34, 0.34], canSee });
    assert.ok(fit);
    const { position, back } = fit;
    assert.ok(position.x < 2 && position.y < 4.5);
    assert.equal(canSee(avatar, position), true);
    assert.equal(canSee(entrance, position), true);
    const camera = new Camera();
    camera.node = new GraphNode();
    camera.projection = PROJECTION_PERSPECTIVE;
    camera.aspectRatioMode = ASPECT_MANUAL;
    camera.aspectRatio = width / height;
    camera.fov = fov;
    camera.node.setPosition(position.x, position.y, position.z);
    camera.node.lookAt(position.x - back.x, position.y - back.y, position.z - back.z);
    assertInside(camera, points, width, height, rect);
  }
});
