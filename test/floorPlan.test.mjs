// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.

import test from 'node:test';
import assert from 'node:assert/strict';
import { FloorPlanModel, calculatePolygonArea, isPointInPolygon, calculateRoomAcoustics, UNCLASSIFIED } from '../js/floorPlanModel.js';
import { renderFloorPlanSvg } from '../js/floorPlanSvg.js';

test('calculatePolygonArea computes correct square meters for rectangle', () => {
  const rect = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 5 },
    { x: 0, y: 5 },
  ];
  const area = calculatePolygonArea(rect);
  assert.equal(area, 50);
});

test('isPointInPolygon detects inside vs outside points', () => {
  const room = [
    { x: 2, y: 2 },
    { x: 10, y: 2 },
    { x: 10, y: 10 },
    { x: 2, y: 10 },
  ];
  assert.equal(isPointInPolygon({ x: 5, y: 5 }, room), true);
  assert.equal(isPointInPolygon({ x: 1, y: 1 }, room), false);
  assert.equal(isPointInPolygon({ x: 12, y: 5 }, room), false);
});

test('FloorPlanModel initializes with default rooms and drops', () => {
  const model = new FloorPlanModel();
  assert.ok(model.rooms.length >= 3);
  assert.ok(model.drops.length >= 5);
  const metrics = model.getMetrics();
  assert.ok(metrics.totalAreaSqm > 0);
  assert.equal(metrics.dropCount, model.drops.length);
});

test('FloorPlanModel adds, updates, and deletes drop with room auto-resolution', () => {
  const model = new FloorPlanModel();
  const drop = model.addDrop({
    refdes: 'TEST-D01',
    label: 'Test Drop',
    category: 'AUDIO',
    x: 5,
    y: 5,
  });
  assert.ok(drop.id);
  assert.equal(drop.room, 'Control Room A');

  // Move into Studio A
  model.updateDrop(drop.id, { x: 20, y: 5 });
  assert.equal(drop.room, 'Audio Studio A');

  // Delete
  const deleted = model.deleteDrop(drop.id);
  assert.equal(deleted, true);
  assert.equal(model.drops.some((d) => d.id === drop.id), false);
});

test('FloorPlanModel generates valid GeoJSON FeatureCollection', () => {
  const model = new FloorPlanModel();
  const geojson = model.toGeoJson();
  assert.equal(geojson.type, 'FeatureCollection');
  assert.ok(geojson.features.length >= 8);
  const roomFeature = geojson.features.find((f) => f.properties.kind === 'room');
  assert.ok(roomFeature);
  assert.equal(roomFeature.geometry.type, 'Polygon');
});

test('renderFloorPlanSvg generates SVG string containing room and drop elements', () => {
  const model = new FloorPlanModel();
  const svg = renderFloorPlanSvg(model);
  assert.ok(svg.includes('<svg'));
  assert.ok(svg.includes('Control Room A'));
  assert.ok(svg.includes('scale-bar'));
});

test('room acoustics come from the room type, never from its name', () => {
  const polygon = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 4 }, { x: 0, y: 4 }];
  // Named like a studio, typed as nothing: not guessed.
  const guessed = calculateRoomAcoustics({ name: 'Studio B storage', polygon, ceilingHeight_m: 3 });
  assert.equal(guessed.roomType, UNCLASSIFIED);
  assert.equal(guessed.classified, false);

  const iso = calculateRoomAcoustics({ name: 'Room 12', roomType: 'Iso Booth', polygon, ceilingHeight_m: 3 });
  assert.equal(iso.classified, true);
  assert.equal(iso.meanAbsorption, 0.36);
  assert.equal(iso.nc_rating, 15);
  assert.equal(iso.volume_m3, 60);
  // Sabine: 0.161 * 60 / (S * 0.36), S = 2*20 + 18*3 = 94 m²
  assert.equal(iso.rt60_estimated, Math.round((0.161 * 60 / (94 * 0.36)) * 100) / 100);

  // A room's own value wins over its preset, including a legitimate zero.
  const dead = calculateRoomAcoustics({ name: 'x', roomType: 'Iso Booth', polygon, nc_rating: 0 });
  assert.equal(dead.nc_rating, 0);
});

test('names are escaped, so every floor renders as well-formed SVG', () => {
  const model = new FloorPlanModel();
  for (const floor of model.floors) {
    model.activeFloorId = floor.id;
    const svg = renderFloorPlanSvg(model);
    assert.ok(!/&(?!amp;|lt;|gt;|quot;|#39;)/.test(svg), `raw & on ${floor.id}`);
  }
  assert.ok(renderFloorPlanSvg(model).includes('Live &amp; Control'));
});

test('drop X / Y show in mm while the block keeps metres', async () => {
  const { metresToMm, mmToMetres } = await import('../js/floorPlanModel.js');
  assert.equal(metresToMm(5.5), 5500);
  assert.equal(metresToMm(0.0125), 13);
  assert.equal(mmToMetres('7250'), 7.25);
  assert.equal(mmToMetres(''), 0);
  assert.equal(mmToMetres(metresToMm(12.345)), 12.345);
  const m = new FloorPlanModel();
  const d = m.addDrop({ x: 3, y: 4 });
  m.updateDrop(d.id, { x: mmToMetres('6500') });
  assert.equal(m.toJSON().drops.find((x) => x.id === d.id).x, 6.5);
});

import { categoryForPart } from '../js/floorPlanModel.js';
test('a device from the BIM library is a drop that keeps its part and BIM reference (ROAD-3572)', () => {
  const m = new FloorPlanModel();
  const ref = { part: 'shure/mxa920', url: 'http://bench:8160/api/bim/parts/shure/mxa920', rev: 'r1' };
  const d = m.addDrop({ category: categoryForPart({ category: 'Microphones' }), label: 'Shure MXA920', x: 6, y: 6, bimId: 'shure/mxa920', bimRef: ref });
  assert.equal(d.category, 'MIC');
  assert.deepEqual([d.bimId, d.bimRef], ['shure/mxa920', ref]);
  const plain = m.addDrop({ category: 'DATA', x: 2, y: 2 });
  assert.ok(!('bimRef' in plain), 'a plain drop carries no BIM fields');
});
