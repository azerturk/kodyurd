import assert from 'node:assert/strict';
import { test } from 'node:test';
import { layoutDiagram, refreshCompactDiagrams } from '../dist/space-layout/index.js';

function chain(size, kind = 'graph') {
  const nodes = Array.from({ length: size }, (_, i) => ({ id: `node-${i}`, label: `Component ${i + 1}` }));
  return {
    id: `${kind}-chain-${size}`, owner: 'service', title: 'Component map', kind, nodes,
    edges: nodes.slice(1).map((node, i) => ({ from: nodes[i].id, to: node.id, label: `Step ${i + 1}` }))
  };
}

function crossesInterior(a, b, node) {
  const x = node.x;
  const y = node.y;
  if (a.x === b.x) {
    return x < a.x && a.x < x + node.w &&
      Math.max(Math.min(a.y, b.y), y) < Math.min(Math.max(a.y, b.y), y + node.h);
  }
  return y < a.y && a.y < y + node.h &&
    Math.max(Math.min(a.x, b.x), x) < Math.min(Math.max(a.x, b.x), x + node.w);
}

test('a six-component chain folds into two rows while keeping its route continuous', () => {
  const diagram = chain(6);
  const layout = layoutDiagram(diagram);
  const [a, b, c, d, e, f] = layout.nodes;
  assert.ok(a.x < b.x && b.x < c.x);
  assert.ok(d.x > e.x && e.x > f.x);
  assert.equal(a.y, c.y);
  assert.equal(d.y, f.y);
  assert.ok(a.y < d.y);
  assert.equal(c.x, d.x);
  assert.ok(layout.width / layout.height < 2.5);
  assert.ok(layout.edges[2].points.every(({ x }) => x === c.x + c.w / 2));
});

test('cycles, parallel edges, and self-loops retain labels, endpoints, and safe routes', () => {
  const diagram = chain(6);
  diagram.edges.push(
    { from: 'node-5', to: 'node-0', label: 'Retry from start' },
    { from: 'node-1', to: 'node-0', label: 'Return' },
    { from: 'node-0', to: 'node-2', label: 'Bypass' },
    { from: 'node-4', to: 'node-0', label: 'Cross-row branch' },
    { from: 'node-5', to: 'node-5', label: 'Self-check' }
  );
  const layout = layoutDiagram(diagram);
  assert.deepEqual(layout, layoutDiagram(diagram));
  assert.deepEqual(layout.edges.map(({ from, to, label }) => ({ from, to, label })), diagram.edges);
  assert.notEqual(layout.edges[0].points[0].y, layout.edges[6].points[0].y);
  for (const { from, to, points } of layout.edges) {
    assert.ok(points.every(({ x, y }) => x >= 0 && x <= layout.width && y >= 0 && y <= layout.height));
    for (let i = 1; i < points.length; i++) {
      const [a, b] = [points[i - 1], points[i]];
      assert.notDeepEqual(a, b);
      assert.ok(a.x === b.x || a.y === b.y);
      for (const node of layout.nodes.filter(({ id }) => id !== from && id !== to)) {
        assert.equal(crossesInterior(a, b, node), false, `${from} → ${to} crosses ${node.id}`);
      }
    }
  }
});

test('refreshing saved diagram geometry keeps city, interiors, and other layouts intact', () => {
  const compact = chain(6);
  const large = chain(9);
  const state = chain(6, 'state');
  const previousCompact = { id: compact.id, width: 1142, height: 116 };
  const previous = { city: {}, interiors: {}, diagrams: {
    [compact.id]: previousCompact, [large.id]: layoutDiagram(large), [state.id]: layoutDiagram(state)
  } };
  const refreshed = refreshCompactDiagrams({ diagrams: [compact, large, state] }, previous);
  assert.equal(refreshed.city, previous.city);
  assert.equal(refreshed.interiors, previous.interiors);
  assert.equal(refreshed.diagrams[large.id], previous.diagrams[large.id]);
  assert.equal(refreshed.diagrams[state.id], previous.diagrams[state.id]);
  assert.deepEqual(refreshed.diagrams[compact.id], layoutDiagram(compact));
  assert.equal(previous.diagrams[compact.id], previousCompact);
  assert.equal(refreshCompactDiagrams({ diagrams: [large, state] }, previous), previous);
});
