// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.
/**
 * THE FLOOR PLAN AS IFC4X3_ADD2 (IFC-CORE-DELTAS cad-8)
 *
 *   IfcProject ─ IfcSite ─ IfcBuilding ─ IfcBuildingStorey per floor ─ IfcSpace per room
 *
 * - A floor is an IfcBuildingStorey: Name, Elevation in mm — the floor's own
 *   elevation_mm, else (level − 1) × 4000 mm, said so in
 *   APK_FloorPlanStorey.ElevationAssumed.
 * - A room is an IfcSpace: FootPrint polygon and (with a ceiling height) a
 *   SweptSolid Body, both mm; ObjectType = its room type;
 *   Pset_SpaceCommon.Reference = its id; Qto_SpaceBaseQuantities Height (mm),
 *   NetPerimeter (mm), NetFloorArea (m²), NetVolume (m³); its acoustic design
 *   targets in APK_RoomAcoustics (IFC has no acoustic target for a space).
 *   The mix position is an IfcAnnotation ObjectType 'LISTENING_POSITION' in it.
 * - A drop is an occurrence of its category's entity, contained in the space
 *   it stands in (else the storey), Name = label, Tag = refdes:
 *     SPEAKER IfcAudioVisualAppliance SPEAKER · MIC … MICROPHONE · VIDEO … DISPLAY
 *     AUDIO IfcOutlet AUDIOVISUALOUTLET · DATA … DATAOUTLET · POWER … POWEROUTLET
 *     ACOUSTIC_MIC IfcSensor SOUNDSENSOR · ACOUSTIC_PANEL / DIFFUSER IfcCovering
 *     USERDEFINED ABSORBER / DIFFUSER · anything else IfcBuildingElementProxy.
 *   A drop placed from the BIM library is typed by its part: the part's own
 *   IFC type, embedded from its stored twin (opts.types {partId: the text of
 *   GET /api/bim/parts/<id>.ifc}, js/partTypes.js; ifc/partType.js) with its
 *   sets, Body map and ports, GlobalIds as the part file has them — and then the
 *   occurrence is that type's own entity (IfcXType types an IfcX), the category's
 *   PredefinedType kept only when the entity is the category's. A part whose
 *   twin is not to hand gets a stub type of the category's class carrying
 *   APK_Part.PartId (GlobalId part/<id>, the one the BIM library writes); a drop
 *   without a part is Stage 'stub'.
 * - Each named circuit is an IfcDistributionCircuit (ELECTRICAL) the drops on
 *   it are assigned to (IfcRelAssignsToGroup).
 *
 * Every length goes out in mm (the plan keeps metres — × 1000 out, ÷ 1000 in)
 * and fromIfc(toIfc(plan)) is the plan again (test/floorPlanIfc.test.mjs).
 * What IFC has no word for (screen scale, colours) rides in APK_FloorPlan* sets.
 */
import { entitiesByType, getPsets, ifcGuid, isRef, parseStep, unwrap } from '../../vendor/apk-contracts/apk-ifc.js';
import { calculatePolygonArea, calculatePolygonPerimeter } from '../floorPlanModel.js';
import { embedPartType, occurrenceOf } from './partType.js';
import { E, R, StepWriter, bool, ident, int, label, measure, projectFrame, psetWriter, stepHeader, text } from './stepWriter.js';

export const FLOORPLAN_IFC_SCHEMA = 'apk.floorplan/ifc@1';
export const DEFAULT_STOREY_MM = 4000;
const APP = 'EDITORS.FloorPlan';

/** Drop category → [entity, PredefinedType, ObjectType?]. */
export const DROP_IFC = Object.freeze({
  SPEAKER: ['IFCAUDIOVISUALAPPLIANCE', 'SPEAKER'],
  MIC: ['IFCAUDIOVISUALAPPLIANCE', 'MICROPHONE'],
  VIDEO: ['IFCAUDIOVISUALAPPLIANCE', 'DISPLAY'],
  AUDIO: ['IFCOUTLET', 'AUDIOVISUALOUTLET'],
  DATA: ['IFCOUTLET', 'DATAOUTLET'],
  POWER: ['IFCOUTLET', 'POWEROUTLET'],
  ACOUSTIC_MIC: ['IFCSENSOR', 'SOUNDSENSOR'],
  ACOUSTIC_PANEL: ['IFCCOVERING', 'USERDEFINED', 'ABSORBER'],
  DIFFUSER: ['IFCCOVERING', 'USERDEFINED', 'DIFFUSER'],
});
export const dropEntity = (category) => DROP_IFC[category] || ['IFCBUILDINGELEMENTPROXY', 'USERDEFINED', String(category || 'DROP')];

/** An occurrence's attributes: the IfcElement head (GlobalId … Tag) and its PredefinedType where its entity puts it. */
function occurrenceArgs(entity, head, pre) {
  const p = pre ? E(pre) : null;
  if (entity === 'IFCELEMENTASSEMBLY') return [...head, null, p];
  if (entity === 'IFCMECHANICALFASTENER') return [...head, null, null, p];
  return [...head, p];
}

/** A circuit that is a placeholder, not a circuit. */
const UNASSIGNED = new Set(['', 'UNASSIGNED']);

const PLAN_KEYS = new Set(['type', 'id', 'name', 'scaleRatio', 'pixelsPerMeter', 'width_m', 'height_m', 'activeFloorId', 'floors', 'rooms', 'drops']);
const FLOOR_KEYS = new Set(['id', 'name', 'level', 'elevation_mm', 'rooms', 'drops']);
const ROOM_KEYS = new Set(['id', 'name', 'color', 'ceilingHeight_m', 'roomType', 'meanAbsorption', 'target_rt60', 'nc_rating', 'mixPosition', 'polygon']);
const DROP_KEYS = new Set(['id', 'refdes', 'label', 'category', 'x', 'y', 'room', 'circuit', 'bimId', 'bimRef']);
/** What a record carries beyond the keys written as their own IFC words, as JSON (absent when nothing). */
const extra = (o, keys) => {
  const rest = Object.fromEntries(Object.entries(o).filter(([k]) => !keys.has(k)));
  return Object.keys(rest).length ? text(JSON.stringify(rest)) : undefined;
};
const MM = (m) => Number(m) * 1000;
const M = (mm) => mm / 1000;

function inside(p, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

/** The plan (a FloorPlanModel, or its toJSON block) as one IFC4X3_ADD2 file. */
export function toIfc(planIn, opts = {}) {
  const plan = typeof planIn?.toJSON === 'function' ? planIn.toJSON() : planIn;
  const w = new StepWriter();
  const F = projectFrame(w, APP);
  const { oh } = F;
  const { pset, flush } = psetWriter(w, oh, ifcGuid);
  const role = (...r) => ifcGuid('floorplan', String(plan.id), ...r.map(String));
  const p2 = (x, y) => w.add('IFCCARTESIANPOINT', [[R(x), R(y)]]);
  const local = (relTo, x = 0, y = 0, z = 0) => w.add('IFCLOCALPLACEMENT', [relTo, x || y || z ? w.add('IFCAXIS2PLACEMENT3D', [w.add('IFCCARTESIANPOINT', [[R(x), R(y), R(z)]]), null, null]) : F.world]);
  const ring = (poly) => w.add('IFCPOLYLINE', [[...poly, poly[0]].map((p) => p2(MM(p.x), MM(p.y)))]);

  const project = w.add('IFCPROJECT', [role('project'), oh, plan.name ?? null, 'A floor plan (EDITORS.FloorPlan) as IFC', null, null, null, [F.model, F.plan], F.units]);
  pset(role('project'), 'APK_FloorPlan', [
    ['Schema', ident(FLOORPLAN_IFC_SCHEMA)], ['PlanId', ident(plan.id)],
    ['ScaleRatio', plan.scaleRatio !== undefined ? measure('IFCREAL', plan.scaleRatio) : undefined],
    ['PixelsPerMetre', plan.pixelsPerMeter !== undefined ? measure('IFCREAL', plan.pixelsPerMeter) : undefined],
    ['Width', plan.width_m !== undefined ? measure('IFCLENGTHMEASURE', MM(plan.width_m)) : undefined],
    ['Height', plan.height_m !== undefined ? measure('IFCLENGTHMEASURE', MM(plan.height_m)) : undefined],
    ['ActiveFloorId', plan.activeFloorId !== undefined ? ident(plan.activeFloorId) : undefined],
    ['Extra', extra(plan, PLAN_KEYS)],
  ], [project]);
  const sitePl = local(null);
  const site = w.add('IFCSITE', [role('site'), oh, 'Site', null, null, sitePl, null, null, E('ELEMENT'), null, null, null, null, null]);
  const buildingPl = local(sitePl);
  const building = w.add('IFCBUILDING', [role('building'), oh, plan.name ?? 'Building', null, null, buildingPl, null, null, E('ELEMENT'), null, null, null]);
  w.add('IFCRELAGGREGATES', [role('rel', 'project-site'), oh, null, null, project, [site]]);
  w.add('IFCRELAGGREGATES', [role('rel', 'site-building'), oh, null, null, site, [building]]);

  const storeys = [];
  const circuits = new Map();
  const types = new Map();
  const typed = new Map();
  const partSeen = new Set();
  const partTypes = opts.types ?? {};
  const full = new Map(); // partId → the embedded type {ref, entity, name} | null
  const embedded = (pid) => {
    if (!full.has(pid)) {
      let t = null;
      const textOf = partTypes[pid];
      if (typeof textOf === 'string' && textOf.startsWith('ISO-10303-21')) {
        try { t = embedPartType(w, F, textOf, pid); } catch (_) { t = null; }
      }
      if (t) partSeen.add(pid);
      full.set(pid, t);
    }
    return full.get(pid);
  };
  for (const [fi, floor] of (plan.floors ?? []).entries()) {
    const fid = floor.id ?? `floor_${fi + 1}`;
    const assumed = floor.elevation_mm === undefined;
    const elevation = assumed ? (Number(floor.level ?? fi + 1) - 1) * DEFAULT_STOREY_MM : Number(floor.elevation_mm);
    const storeyPl = local(buildingPl, 0, 0, elevation);
    const storey = w.add('IFCBUILDINGSTOREY', [role('storey', fid), oh, floor.name ?? fid, null, null, storeyPl, null, null, E('ELEMENT'), R(elevation)]);
    storeys.push(storey);
    pset(role('storey', fid), 'APK_FloorPlanStorey', [
      ['FloorId', ident(fid)], ['Level', floor.level !== undefined ? int(floor.level) : undefined],
      ['ElevationAssumed', assumed ? bool(true) : undefined], ['Extra', extra(floor, FLOOR_KEYS)],
    ], [storey]);

    // ---- rooms
    const spaces = [];
    const inStorey = [];
    const held = new Map();
    for (const room of floor.rooms ?? []) {
      const poly = room.polygon ?? [];
      if (poly.length < 3) continue;
      const g = role('space', room.id);
      const reps = [w.add('IFCSHAPEREPRESENTATION', [F.footprint, 'FootPrint', 'Curve2D', [ring(poly)]])];
      const h = room.ceilingHeight_m !== undefined ? MM(room.ceilingHeight_m) : undefined;
      if (h && h > 0) {
        const profile = w.add('IFCARBITRARYCLOSEDPROFILEDEF', [E('AREA'), null, ring(poly)]);
        reps.push(w.add('IFCSHAPEREPRESENTATION', [F.body, 'Body', 'SweptSolid', [w.add('IFCEXTRUDEDAREASOLID', [profile, null, w.once('IFCDIRECTION', [[R(0), R(0), R(1)]]), R(h)])]]));
      }
      const pl = local(storeyPl);
      const space = w.add('IFCSPACE', [g, oh, room.name ?? room.id, null, room.roomType ?? null, pl, w.add('IFCPRODUCTDEFINITIONSHAPE', [null, null, reps]), null, E('ELEMENT'), E('SPACE'), null]);
      spaces.push({ ref: space, poly, room });
      pset(g, 'Pset_SpaceCommon', [['Reference', ident(room.id)]], [space]);
      const area = calculatePolygonArea(poly);
      pset(g, 'Qto_SpaceBaseQuantities', [
        ['Height', h ? { q: 'IFCQUANTITYLENGTH', value: h } : undefined],
        ['NetPerimeter', { q: 'IFCQUANTITYLENGTH', value: MM(calculatePolygonPerimeter(poly)) }],
        ['NetFloorArea', { q: 'IFCQUANTITYAREA', value: area }],
        ['NetVolume', h ? { q: 'IFCQUANTITYVOLUME', value: area * M(h) } : undefined],
      ], [space], 'IFCELEMENTQUANTITY');
      pset(g, 'APK_RoomAcoustics', [
        ['MeanAbsorption', room.meanAbsorption !== undefined ? measure('IFCNORMALISEDRATIOMEASURE', room.meanAbsorption) : undefined],
        ['TargetRT60', room.target_rt60 !== undefined ? measure('IFCTIMEMEASURE', room.target_rt60) : undefined],
        ['NCRating', room.nc_rating !== undefined ? measure('IFCREAL', room.nc_rating) : undefined],
      ], [space]);
      pset(g, 'APK_FloorPlanRoom', [
        ['RoomId', ident(room.id)], ['Name', room.name !== undefined ? label(room.name) : undefined],
        ['Color', room.color !== undefined ? label(room.color) : undefined], ['Extra', extra(room, ROOM_KEYS)],
      ], [space]);
      if (room.mixPosition) {
        const ann = w.add('IFCANNOTATION', [role('listening', room.id), oh, 'Mix position', null, 'LISTENING_POSITION', local(pl, MM(room.mixPosition.x), MM(room.mixPosition.y)), null, E('USERDEFINED')]);
        (held.get(space) ?? held.set(space, []).get(space)).push(ann);
      }
    }
    if (spaces.length) w.add('IFCRELAGGREGATES', [role('rel', 'storey-spaces', fid), oh, null, null, storey, spaces.map((s) => s.ref)]);

    // ---- drops
    for (const d of floor.drops ?? []) {
      const [catEntity, catPre, catObjType] = dropEntity(d.category);
      const g = role('drop', d.id);
      const at = { x: Number(d.x) || 0, y: Number(d.y) || 0 };
      const room = spaces.find((s) => inside(at, s.poly));
      const relTo = room ? w.entity(room.ref).args[5] : storeyPl;
      const part = d.bimRef?.part || d.bimId;
      const full = part ? embedded(part) : null;
      const entity = full ? occurrenceOf(full.entity) : catEntity;
      const own = entity === catEntity; // the category's words fit this entity
      const pre = own ? catPre : null;
      const objType = own ? catObjType : undefined;
      const occ = w.add(entity, occurrenceArgs(entity, [g, oh, d.label ?? null, null, objType ?? null, local(relTo, MM(at.x), MM(at.y)), null, d.refdes ?? null], pre));
      if (room) (held.get(room.ref) ?? held.set(room.ref, []).get(room.ref)).push(occ);
      else inStorey.push(occ);
      if (full) {
        const key = `part:${part}`;
        types.set(key, full.ref);
        (typed.get(key) ?? typed.set(key, []).get(key)).push(occ);
      } else if (part) {
        const key = `${entity}:${part}`;
        if (!types.has(key)) {
          const partSet = w.add('IFCPROPERTYSET', [ifcGuid('part', part, 'pset', 'APK_Part', entity), oh, 'APK_Part', null, [
            w.add('IFCPROPERTYSINGLEVALUE', ['PartId', null, ident(part), null]),
            w.add('IFCPROPERTYSINGLEVALUE', ['Stage', null, label('stub'), null]),
          ]]);
          // the part's own GlobalId (as the BIM library and the CAD write it); a second class of the same part its own
          const tid = partSeen.has(part) ? ifcGuid('part', part, entity) : ifcGuid('part', part);
          partSeen.add(part);
          types.set(key, w.add(`${entity}TYPE`, [tid, oh, part, 'A BIM part placed on the plan: re-resolved by APK_Part.PartId', null, [partSet], null, part, objType ?? null, E(pre)]));
        }
        (typed.get(key) ?? typed.set(key, []).get(key)).push(occ);
      }
      const circuit = d.circuit !== undefined && !UNASSIGNED.has(String(d.circuit)) ? String(d.circuit) : null;
      if (circuit) (circuits.get(circuit) ?? circuits.set(circuit, []).get(circuit)).push(occ);
      pset(g, 'APK_FloorPlanDrop', [
        ['DropId', ident(d.id)], ['Category', d.category !== undefined ? label(d.category) : undefined],
        ['Room', d.room !== undefined ? label(d.room) : undefined],
        ['Circuit', d.circuit !== undefined && !circuit ? label(d.circuit) : undefined],
        ['BimId', d.bimId !== undefined ? ident(d.bimId) : undefined], ['BimRef', d.bimRef ? text(JSON.stringify(d.bimRef)) : undefined],
        ['Stage', part ? undefined : label('stub')], ['Extra', extra(d, DROP_KEYS)],
      ], [occ]);
    }
    for (const [space, list] of held) w.add('IFCRELCONTAINEDINSPATIALSTRUCTURE', [ifcGuid(w.entity(space).args[0], 'contains'), oh, null, null, list, space]);
    if (inStorey.length) w.add('IFCRELCONTAINEDINSPATIALSTRUCTURE', [role('rel', 'storey-contains', fid), oh, null, null, inStorey, storey]);
  }
  if (storeys.length) w.add('IFCRELAGGREGATES', [role('rel', 'building-storeys'), oh, null, null, building, storeys]);
  if (types.size) {
    w.add('IFCRELDECLARES', [role('rel', 'project-types'), oh, null, null, project, [...types.values()]]);
    for (const [key, occs] of typed) w.add('IFCRELDEFINESBYTYPE', [role('rel', 'type', key), oh, null, null, occs, types.get(key)]);
  }
  for (const [name, members] of circuits) {
    const c = w.add('IFCDISTRIBUTIONCIRCUIT', [role('circuit', name), oh, name, null, null, null, E('ELECTRICAL')]);
    w.add('IFCRELASSIGNSTOGROUP', [role('rel', 'circuit', name), oh, null, null, members, null, c]);
  }
  flush();
  const stem = String(opts.fileName ?? plan.name ?? 'floorplan').replace(/\.(ifc|json)$/i, '');
  return w.write(stepHeader(`${stem}.ifc`, opts.timestamp ?? new Date(0).toISOString(), APP));
}

// ------------------------------------------------------------------ reading

export class FloorPlanIfcError extends Error {
  constructor(msg) { super(msg); this.code = 'bad_input'; }
}

function coords(file, v) {
  const p = isRef(v) ? file.byId.get(v.id) : undefined;
  if (!p || p.type !== 'IFCCARTESIANPOINT' || !Array.isArray(p.args[0])) return null;
  const c = p.args[0].map(unwrap);
  return typeof c[0] === 'number' && typeof c[1] === 'number' ? c : null;
}
const deref = (file, v) => (isRef(v) ? file.byId.get(v.id) : undefined);

/** The FootPrint polygon of a space, mm, closing point dropped. */
function footprint(file, space) {
  const shape = deref(file, space.args[6]);
  for (const r of Array.isArray(shape?.args[2]) ? shape.args[2] : []) {
    const rep = deref(file, r);
    if (rep?.args[1] !== 'FootPrint') continue;
    const line = (rep.args[3] ?? []).map((x) => deref(file, x)).find((x) => x?.type === 'IFCPOLYLINE');
    const pts = (line?.args[0] ?? []).map((p) => coords(file, p)).filter(Boolean);
    if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
    return pts;
  }
  return [];
}

/** The leaf translation of a product's placement, mm (the editor writes x, y on the leaf only). */
function leaf(file, product) {
  const pl = deref(file, product.args[5]);
  const ax = deref(file, pl?.args[1]);
  const c = coords(file, ax?.args[0]);
  return c ? { x: c[0], y: c[1] } : { x: 0, y: 0 };
}

/** An .ifc this editor wrote back into the plan block (what toJSON gives). Another tool's file: its storeys and spaces. */
export function fromIfc(textIn) {
  let file;
  try { file = parseStep(textIn); } catch (e) { throw new FloorPlanIfcError(`not an IFC file: ${e.message}`); }
  const project = entitiesByType(file, 'IFCPROJECT')[0];
  if (!project) throw new FloorPlanIfcError('the file has no IfcProject');
  const P = getPsets(file, project).APK_FloorPlan ?? {};
  const ours = P.Schema === FLOORPLAN_IFC_SCHEMA;
  const psets = (e) => getPsets(file, e);

  // relationships, by the object they hold
  const aggregated = new Map();
  for (const r of entitiesByType(file, 'IFCRELAGGREGATES')) if (isRef(r.args[4])) aggregated.set(r.args[4].id, (r.args[5] ?? []).filter(isRef).map((x) => file.byId.get(x.id)));
  const contained = new Map();
  for (const r of entitiesByType(file, 'IFCRELCONTAINEDINSPATIALSTRUCTURE')) {
    if (!isRef(r.args[5])) continue;
    contained.set(r.args[5].id, [...(contained.get(r.args[5].id) ?? []), ...(r.args[4] ?? []).filter(isRef).map((x) => file.byId.get(x.id))]);
  }
  const circuitOf = new Map();
  for (const r of entitiesByType(file, 'IFCRELASSIGNSTOGROUP')) {
    const g = deref(file, r.args[6]);
    if (g?.type !== 'IFCDISTRIBUTIONCIRCUIT') continue;
    for (const x of r.args[4] ?? []) if (isRef(x)) circuitOf.set(x.id, String(g.args[2]));
  }
  const json = (v) => (v === undefined ? {} : JSON.parse(String(v)));

  const building = (aggregated.get((aggregated.get(project.id) ?? [])[0]?.id) ?? [])[0];
  const storeys = building ? (aggregated.get(building.id) ?? []).filter((e) => e?.type === 'IFCBUILDINGSTOREY') : entitiesByType(file, 'IFCBUILDINGSTOREY');
  const floors = storeys.map((s, si) => {
    const S = psets(s).APK_FloorPlanStorey ?? {};
    const floor = { id: S.FloorId !== undefined ? String(S.FloorId) : (s.args[0] ?? `floor_${si + 1}`), name: s.args[2] ?? '' };
    if (S.Level !== undefined) floor.level = S.Level;
    else if (!ours) floor.level = si + 1;
    if (ours && S.ElevationAssumed !== true) floor.elevation_mm = unwrap(s.args[9]);
    else if (!ours && typeof unwrap(s.args[9]) === 'number') floor.elevation_mm = unwrap(s.args[9]);
    Object.assign(floor, json(S.Extra));
    floor.rooms = [];
    floor.drops = [];
    const spaces = (aggregated.get(s.id) ?? []).filter((e) => e?.type === 'IFCSPACE');
    const drops = [...(contained.get(s.id) ?? [])];
    for (const sp of spaces) {
      const ps = psets(sp);
      const Rm = ps.APK_FloorPlanRoom ?? {};
      const A = ps.APK_RoomAcoustics ?? {};
      const Q = ps.Qto_SpaceBaseQuantities ?? {};
      const room = { id: Rm.RoomId !== undefined ? String(Rm.RoomId) : String(ps.Pset_SpaceCommon?.Reference ?? sp.args[0]) };
      if (Rm.Name !== undefined || !ours) room.name = Rm.Name !== undefined ? String(Rm.Name) : (sp.args[2] ?? room.id);
      if (Rm.Color !== undefined) room.color = String(Rm.Color);
      if (typeof Q.Height === 'number') room.ceilingHeight_m = M(Q.Height);
      if (typeof sp.args[4] === 'string') room.roomType = sp.args[4];
      if (A.MeanAbsorption !== undefined) room.meanAbsorption = A.MeanAbsorption;
      if (A.TargetRT60 !== undefined) room.target_rt60 = A.TargetRT60;
      if (A.NCRating !== undefined) room.nc_rating = A.NCRating;
      for (const e of contained.get(sp.id) ?? []) {
        if (e?.type === 'IFCANNOTATION' && e.args[4] === 'LISTENING_POSITION') { const p = leaf(file, e); room.mixPosition = { x: M(p.x), y: M(p.y) }; }
        else if (e) drops.push(e);
      }
      room.polygon = footprint(file, sp).map(([x, y]) => ({ x: M(x), y: M(y) }));
      Object.assign(room, json(Rm.Extra));
      floor.rooms.push(room);
    }
    drops.sort((a, b) => a.id - b.id); // the order they were written in
    for (const e of drops) {
      const D = psets(e).APK_FloorPlanDrop;
      if (!D && ours) continue;
      const at = leaf(file, e);
      const drop = { id: D?.DropId !== undefined ? String(D.DropId) : String(e.args[0]) };
      if (typeof e.args[7] === 'string') drop.refdes = e.args[7];
      if (typeof e.args[2] === 'string') drop.label = e.args[2];
      drop.category = D?.Category !== undefined ? String(D.Category) : categoryOf(e);
      drop.x = M(at.x);
      drop.y = M(at.y);
      if (D?.Room !== undefined) drop.room = String(D.Room);
      if (circuitOf.has(e.id)) drop.circuit = circuitOf.get(e.id);
      else if (D?.Circuit !== undefined) drop.circuit = String(D.Circuit);
      if (D?.BimId !== undefined) drop.bimId = String(D.BimId);
      if (D?.BimRef !== undefined) drop.bimRef = JSON.parse(String(D.BimRef));
      Object.assign(drop, json(D?.Extra));
      floor.drops.push(drop);
    }
    return floor;
  });

  const plan = { type: 'floorplan', id: P.PlanId !== undefined ? String(P.PlanId) : String(project.args[0]), name: project.args[2] ?? 'Imported plan' };
  if (P.ScaleRatio !== undefined) plan.scaleRatio = P.ScaleRatio;
  if (P.PixelsPerMetre !== undefined) plan.pixelsPerMeter = P.PixelsPerMetre;
  if (P.Width !== undefined) plan.width_m = M(P.Width);
  if (P.Height !== undefined) plan.height_m = M(P.Height);
  plan.activeFloorId = P.ActiveFloorId !== undefined ? String(P.ActiveFloorId) : floors[0]?.id;
  plan.floors = floors;
  const active = floors.find((f) => f.id === plan.activeFloorId) ?? floors[0];
  plan.rooms = active ? active.rooms : [];
  plan.drops = active ? active.drops : [];
  Object.assign(plan, json(P.Extra));
  return plan;
}

/** A foreign occurrence's drop category, by entity and PredefinedType (the DROP_IFC table, read backwards). */
function categoryOf(e) {
  const pre = unwrap(e.args[8]);
  for (const [cat, [ent, p, ot]] of Object.entries(DROP_IFC)) if (ent === e.type && p === pre && (!ot || ot === e.args[4])) return cat;
  return 'DATA';
}
