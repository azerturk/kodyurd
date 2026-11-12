import assert from "node:assert/strict";
import { test } from "node:test";
import * as pc from "playcanvas";
import { signFaceMount } from "../src/viewer/exhibit-layout.ts";
import { renderSpatialGraph, renderSpatialSequence, spatialDiagram, spatialSequence } from "../src/viewer/spatial-graph.ts";

function stage(t) {
  const canvas = { width: 800, height: 600, style: {} };
  const device = new pc.NullGraphicsDevice(canvas);
  const options = new pc.AppOptions();
  options.graphicsDevice = device;
  options.componentSystems = [pc.RenderComponentSystem];
  const app = new pc.AppBase(canvas);
  app.init(options);
  t.after(() => app.destroy());
  const root = new pc.Entity("stage", app);
  app.root.addChild(root);
  const materials = new Map();
  const material = (name) => {
    if (!materials.has(name)) materials.set(name, new pc.StandardMaterial());
    return materials.get(name);
  };
  const part = (parent, type, sx, sy, sz, x, y, z, paint) => {
    const piece = new pc.Entity("part", app);
    piece.addComponent("render", { type });
    piece.render.material = paint;
    piece.setLocalScale(sx, sy, sz);
    piece.setLocalPosition(x, y, z);
    parent.addChild(piece);
    return piece;
  };
  return { root, device, part, material };
}

test("both printed sign faces clear the backing and preserve upright lettering", () => {
  for (const side of [-1, 1]) {
    const { z, yaw } = signFaceMount(-0.21, 0.18, side);
    assert(Math.abs((z + 0.21) * side - 0.09 - 0.055) < 1e-12);
    const orientation = new pc.Quat().setFromEulerAngles(90, yaw, 0);
    assert(orientation.transformVector(new pc.Vec3(0, 1, 0)).z * side > 0.999);
    assert(orientation.transformVector(new pc.Vec3(0, 0, -1)).y > 0.999);
    assert(orientation.transformVector(new pc.Vec3(1, 0, 0)).x * side > 0.999);
  }
});

test("diagram slabs have outward faces, survive asset fallback, and release their shared mesh", (t) => {
  const { root, device, part, material } = stage(t);
  const nodes = [
    { id: "a", label: "Input", x: 0, z: -3, width: 3, depth: 1.4, icon: "monitor" },
    { id: "b", label: "Check", x: 0, z: 3, width: 3, depth: 1.4, kind: "decision" }
  ];
  const edges = [{ id: "next", from: "a", to: "b" }, { id: "again", from: "b", to: "a" }];
  const fallback = [];
  let floorDimensions;
  const view = renderSpatialGraph(root, nodes, edges, part, material,
    (_parent, role, size, parts) => fallback.push({ role, size, parts: parts.length }), "state", device, undefined, (x, z) => {
      floorDimensions = [x, z];
      return material("#d8c9b2");
    });
  assert.ok(floorDimensions.every((tiles) => Number.isInteger(tiles) && tiles > 0));
  assert.equal(fallback[0].role, "monitor");
  assert.equal(fallback[0].parts, 4);
  assert(fallback[0].size > 1.2 && fallback[0].size < nodes[0].depth);
  assert(nodes[0].visualHeight >= 2.30);
  const [next, again] = view.linkShapes;
  assert(next.points.some(({ x }) => x > 0.4));
  assert(again.points.some(({ x }) => x < -0.4));
  assert(next.points.every(({ y }) => y === 0.49));
  const tip = next.pieces.at(-1);
  const [before, end] = next.points.slice(-2);
  const direction = new pc.Vec3(end.x - before.x, 0, end.z - before.z).normalize();
  assert(tip.getLocalRotation().transformVector(new pc.Vec3(0, 1, 0)).dot(direction) > 0.99);
  const [first, second] = root.find((item) => item.name === "diagram-node");
  const mesh = first.children[0].render.meshInstances[0].mesh;
  assert(second.children[0].render.meshInstances[0].mesh === mesh, "node slabs should share a single mesh");
  const positions = [];
  const indices = [];
  mesh.getPositions(positions);
  mesh.getIndices(indices);
  assert.equal(indices.length / 3, 60);
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = indices.slice(i, i + 3).map((index) => new pc.Vec3(...positions.slice(index * 3, index * 3 + 3)));
    const normal = new pc.Vec3().cross(b.clone().sub(a), c.clone().sub(a));
    assert(normal.dot(a.clone().add(b).add(c)) > 0);
  }
  view.paint("b", "next", new Set(["a"]), new Set());
  assert(second.children[2].render.meshInstances[0].material === material("#77cabb"), "the selected slab should change its paint");
  assert(next.pieces[0].render.material === material("#087d70"), "the active arrow should be teal");
  assert(again.pieces[0].render.material === material("#758585"), "the alternate arrow should be muted");
  assert.equal(tip.getLocalScale().x, 0.70);
  assert.equal(again.pieces.at(-1).getLocalScale().x, 0.53);
  root.destroy();
  assert.equal(mesh.refCount, 0);
});

test("a state view keeps explicit roles and shows inferred start and terminal shapes", () => {
  const diagram = {
    kind: "state", nodes: [{ id: "a", label: "Ready" }, { id: "b", label: "Validating", hint: "event" }, { id: "c", label: "Complete" }],
    edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }]
  };
  const layout = { width: 600, height: 120, nodes: diagram.nodes.map(({ id }, i) => ({ id, x: i * 200, y: 0, w: 170, h: 70 })) };
  assert.deepEqual(spatialDiagram(diagram, layout).nodes.map(({ kind }) => kind), ["initial", "event", "terminal"]);
  const cycle = { ...diagram, edges: [...diagram.edges, { from: "c", to: "a" }] };
  assert.deepEqual(spatialDiagram(cycle, layout).nodes.map(({ kind }) => kind), ["state", "event", "state"]);
});

test("a sequence retains actor roles and distinguishes calls, replies and active lanes", (t) => {
  const { root, device, part, material } = stage(t);
  const diagram = {
    nodes: [{ id: "form", label: "Form", icon: "monitor" }, { id: "check", label: "Validate", hint: "service" }],
    edges: [{ id: "send", from: "form", to: "check", label: "Submit" }, { id: "result", from: "check", to: "form", kind: "return" }]
  };
  const { nodes, edges } = spatialSequence(diagram);
  assert.equal(nodes[0].icon, "monitor");
  assert.equal(nodes[1].kind, "service");
  assert.equal(edges[1].label, "2. Return");
  const shadows = [];
  const view = renderSpatialSequence(root, nodes, edges, part, material, device,
    (_parent, x, z, width, depth, y) => shadows.push({ x, z, width, depth, y }));
  const [call, reply] = view.linkShapes;
  assert(call.pieces.length < reply.pieces.length);
  assert.equal(shadows.length, nodes.length);
  assert.equal(root.findByName("sequence-role").children.length, 4);
  view.paint("form", "result");
  assert(call.pieces[0].render.material === material("#2f4b55"), "the initial message should keep its call paint");
  assert(reply.pieces[0].render.material === material("#198b7c"), "the active reply should be teal");
});

test("a layer stack rises in terraces and a timeline links its nodes in order", (t) => {
  const three = [{ id: "a", label: "Storage" }, { id: "b", label: "Service" }, { id: "c", label: "Interface" }];
  // The server lays a stack out bottom-up: the first node has the largest y.
  const stackLayout = { width: 300, height: 260, nodes: three.map(({ id }, i) => ({ id, x: 36, y: 36 + (2 - i) * 72, w: 228, h: 60 })) };
  const stack = spatialDiagram({ kind: "stack", nodes: three, edges: [{ from: "a", to: "b" }] }, stackLayout);
  assert.deepEqual(stack.nodes.map(({ rise }) => rise), [0, 0.36, 0.72]);
  assert.ok(stack.nodes[0].z > stack.nodes[1].z && stack.nodes[1].z > stack.nodes[2].z, "the bottom layer stands nearest");
  assert.deepEqual(stack.edges, []);

  const lineLayout = { width: 700, height: 150, nodes: three.map(({ id }, i) => ({ id, x: 36 + i * 220, y: 60, w: 160, h: 60 })) };
  const timeline = spatialDiagram({ kind: "timeline", nodes: three, edges: [] }, lineLayout);
  assert.deepEqual(timeline.edges.map(({ from, to }) => [from, to]), [["a", "b"], ["b", "c"]]);
  const authored = spatialDiagram({ kind: "timeline", nodes: three, edges: [{ id: "skip", from: "a", to: "c" }] }, lineLayout);
  assert.deepEqual(authored.edges.map(({ id }) => id), ["skip"]);

  const { root, device, part, material } = stage(t);
  const view = renderSpatialGraph(root, stack.nodes, stack.edges, part, material, () => undefined, "stack", device);
  assert.equal(view.linkShapes.length, 0);
  assert.ok(stack.nodes[2].visualHeight - stack.nodes[0].visualHeight > 0.7, "a higher layer has a higher top face");
});
