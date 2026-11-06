// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.
// cad-8: the plan as IFC4X3_ADD2 — storeys, spaces, drops as occurrences, circuits — and back.
// IFC_OUT=<dir> npm test  also writes the files there, for IfcOpenShell validate + ifctester.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FloorPlanModel } from '../js/floorPlanModel.js';
import { DROP_IFC, fromIfc, toIfc } from '../js/ifc/floorPlanIfc.js';
import { entitiesByType, getPsets, parseStep } from '../vendor/apk-contracts/apk-ifc.js';

const emit = (name, text) => {
  if (!process.env.IFC_OUT) return;
  mkdirSync(process.env.IFC_OUT, { recursive: true });
  writeFileSync(join(process.env.IFC_OUT, name), text);
};
const plain = (m) => JSON.parse(JSON.stringify(m.toJSON()));
const enumOf = (v) => (v && typeof v === 'object' ? v.value : v);

test('the default plan → 2 storeys, 5 spaces, 10 drops by category, 7 circuits', () => {
  const m = new FloorPlanModel({ id: 'plan_default' });
  const text = toIfc(m);
  emit('floorplan-default.ifc', text);
  const f = parseStep(text);
  assert.deepEqual(f.header.find((h) => h.type === 'FILE_SCHEMA').args[0], ['IFC4X3_ADD2']);
  const storeys = entitiesByType(f, 'IFCBUILDINGSTOREY');
  assert.equal(storeys.length, 2);
  assert.deepEqual(storeys.map((s) => s.args[9].value), [0, 4000]); // (level − 1) × 4000 mm, assumed
  assert.equal(getPsets(f, storeys[0]).APK_FloorPlanStorey.ElevationAssumed, true);
  const spaces = entitiesByType(f, 'IFCSPACE');
  assert.equal(spaces.length, 5);
  const cr = spaces.find((s) => s.args[2] === 'Control Room A');
  const ps = getPsets(f, cr);
  assert.equal(cr.args[4], 'Control Room (LEDE)');
  assert.equal(ps.Pset_SpaceCommon.Reference, 'room_1');
  assert.equal(ps.Qto_SpaceBaseQuantities.Height, 3500);
  assert.equal(ps.Qto_SpaceBaseQuantities.NetFloorArea, 80);
  assert.deepEqual(ps.APK_RoomAcoustics, { MeanAbsorption: 0.28, TargetRT60: 0.24, NCRating: 20 });
  // drops: the entity / PredefinedType table
  const drops = [];
  for (const [cat, [ent, pre]] of Object.entries(DROP_IFC)) {
    for (const e of entitiesByType(f, ent)) if (enumOf(e.args[8]) === pre && getPsets(f, e).APK_FloorPlanDrop?.Category === cat) drops.push([cat, e.args[7]]);
  }
  assert.equal(drops.length, 10);
  assert.deepEqual(drops.filter(([c]) => c === 'SPEAKER').map(([, t]) => t).sort(), ['CR-S01', 'CR-S02', 'MAS-S01', 'MAS-S02']);
  assert.equal(entitiesByType(f, 'IFCOUTLET').length, 3);
  const circuits = entitiesByType(f, 'IFCDISTRIBUTIONCIRCUIT');
  assert.equal(circuits.length, 7);
  assert.ok(circuits.some((c) => c.args[2] === 'EP-1 CKT 12'));
  // every drop stands in its room: contained in the IfcSpace, not the storey
  const inSpaces = new Set(entitiesByType(f, 'IFCRELCONTAINEDINSPATIALSTRUCTURE')
    .filter((r) => f.byId.get(r.args[5].id).type === 'IFCSPACE').flatMap((r) => r.args[4].map((x) => x.id)));
  assert.equal(entitiesByType(f, 'IFCAUDIOVISUALAPPLIANCE').filter((e) => inSpaces.has(e.id)).length, 7);
  assert.equal(entitiesByType(f, 'IFCANNOTATION').filter((a) => a.args[4] === 'LISTENING_POSITION').length, 4);
  assert.ok(text.includes("IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.)"));
});

test('fromIfc(toIfc(plan)) is the plan, and the file is the same bytes every time', () => {
  const m = new FloorPlanModel({ id: 'plan_default' });
  const text = toIfc(m);
  assert.equal(toIfc(m), text);
  assert.deepEqual(fromIfc(text), plain(m));
  // and the model rebuilt from it saves the same file again
  assert.equal(toIfc(new FloorPlanModel(fromIfc(text))), text);
});

test('a drop from the BIM library is typed by its part; odd fields and a legacy room.speakers survive', () => {
  const m = new FloorPlanModel({ id: 'plan_bim', name: 'Studio B' });
  m.floors[0].elevation_mm = 150;
  m.floors[0].rooms[0].speakers = [{ id: 'spk_l', label: 'Monitor L', x: 4, y: 3 }];
  m.floors[0].rooms[0].note = 'kept';
  m.addDrop({ category: 'SPEAKER', x: 5.25, y: 4.125, bimId: 'genelec/8050bpm', bimRef: { part: 'genelec/8050bpm', url: '/api/bim/parts/genelec/8050bpm', rev: 'r1' }, label: 'Genelec L' });
  m.addDrop({ category: 'ACOUSTIC_PANEL', x: 3, y: 9 });
  m.addDrop({ category: 'DIFFUSER', x: 50, y: 50 }); // clamped onto the plan, outside every room
  m.addDrop({ category: 'ACOUSTIC_MIC', x: 6, y: 6, circuit: 'UNASSIGNED' });
  m.drops[m.drops.length - 1].custom = { a: 1 };
  const text = toIfc(m);
  emit('floorplan-bim.ifc', text);
  assert.deepEqual(fromIfc(text), plain(m));
  const f = parseStep(text);
  const types = entitiesByType(f, 'IFCAUDIOVISUALAPPLIANCETYPE');
  assert.equal(types.length, 1);
  assert.equal(getPsets(f, types[0]).APK_Part.PartId, 'genelec/8050bpm');
  assert.equal(entitiesByType(f, 'IFCRELDEFINESBYTYPE').length, 1);
  const panel = entitiesByType(f, 'IFCCOVERING').find((c) => c.args[4] === 'ABSORBER');
  assert.equal(enumOf(panel.args[8]), 'USERDEFINED');
  assert.equal(getPsets(f, panel).APK_FloorPlanDrop.Stage, 'stub');
  assert.equal(entitiesByType(f, 'IFCSENSOR')[0].args[8].value, 'SOUNDSENSOR');
  assert.equal(entitiesByType(f, 'IFCBUILDINGSTOREY')[0].args[9].value, 150);
});

test('a foreign file with storeys and spaces opens as floors and rooms', () => {
  const m = new FloorPlanModel({ id: 'plan_x' });
  const text = toIfc(m).replace(/'APK_FloorPlan'/g, "'X_Other'").replace(/'APK_FloorPlanStorey'/g, "'X_S'");
  const plan = fromIfc(text);
  assert.equal(plan.floors.length, 2);
  assert.equal(plan.floors[0].rooms.length, 3);
  assert.deepEqual(plan.floors[0].rooms[0].polygon, m.floors[0].rooms[0].polygon);
  assert.throws(() => fromIfc('not a step file'), /not an IFC file/);
});
