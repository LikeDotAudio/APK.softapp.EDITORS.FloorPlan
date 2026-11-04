// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.

import test from 'node:test';
import assert from 'node:assert/strict';
import { FloorPlanModel, calculatePolygonArea, isPointInPolygon } from '../js/floorPlanModel.js';
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
