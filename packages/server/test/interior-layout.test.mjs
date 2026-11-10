import assert from 'node:assert/strict';
import { test } from 'node:test';
import { layoutInterior, refreshInteriors } from '../dist/space-layout/index.js';

const interior = {
  building: 'fulfillment', lobby: { summary: 'Fulfillment', catalogRefs: ['dispatch'], coverageRefs: [] },
  floors: [{ id: 'workshop', title: 'Workshop', components: [], diagrams: [], corridors: ['dispatch'] }]
};

const flow = {
  id: 'dispatch', title: 'Dispatch', scope: 'module:fulfillment', kind: 'calls',
  path: ['dispatch', 'decision', 'complete'].map((id) => ({ id, ref: `step:${id}`, caption: id })),
  branches: [
    { at: 1, from: 'decision', join: 'dispatch', condition: 'Retry', path: [{ id: 'wait', ref: 'step:wait' }] },
    { at: 1, from: 'decision', condition: 'Exhausted', path: [{ id: 'park', ref: 'step:park' }] }
  ]
};

test('physical retry corridor rejoins the same step as the semantic flow', () => {
  const layout = layoutInterior(interior, [flow]);
  const [corridor] = layout.corridors;
  const [dispatch, decision, complete, wait, park] = corridor.stations;
  assert.ok(Math.abs(layout.lobby.reception.x - layout.lobby.entry.x) > 3);
  assert.ok(corridor.segments[0].from.z <= -6);
  const retry = corridor.segments.slice(1, 5);
  assert.deepEqual(retry[0].from, decision.pos);
  assert.deepEqual(retry[0].to, wait.pos);
  assert.deepEqual(retry.at(-1).to, dispatch.pos);
  retry.slice(1).forEach((segment, index) => assert.deepEqual(segment.from, retry[index].to));
  assert.deepEqual(corridor.segments[0].to, { x: complete.pos.x, z: complete.pos.z + 3 });
  assert.deepEqual(corridor.segments.at(-1), { from: decision.pos, to: park.pos });
});

test('saved scenes refresh interior geometry without losing city or diagram data', () => {
  const legacy = { city: { buildings: [] }, diagrams: { map: {} }, interiors: { fulfillment: {} } };
  const refreshed = refreshInteriors({ interiors: [interior], flows: [flow] }, legacy);
  assert.equal(refreshed.city, legacy.city);
  assert.equal(refreshed.diagrams, legacy.diagrams);
  assert.deepEqual(refreshed.interiors.fulfillment, layoutInterior(interior, [flow]));
});
