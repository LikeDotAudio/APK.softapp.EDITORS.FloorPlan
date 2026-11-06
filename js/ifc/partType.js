// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.
/**
 * A BIM PART'S OWN IFC TYPE, EMBEDDED (ROAD-3582 r4) — the same way EDITORS.PowerChain does it.
 *
 * A drop placed from the BIM library is an occurrence of its part. The part's stored twin
 * (GET /api/bim/parts/<maker>/<model>.ifc, DATABASE.server.BIM) holds its IFC type: the type
 * entity with its property sets (Pset_ManufacturerTypeInformation, Pset_ElectricalDeviceCommon,
 * the Qto, APK_Part), its Body representation map, and its ports (IfcRelNests) with their sets.
 * That closure is copied into the plan's file with the GlobalIds the part file gave it, so the
 * plan says what the part is instead of naming it. The part file's owner history, contexts and
 * SI units are the plan's own; a unit the plan does not assign yet is added to its assignment.
 */
import { isRef, isTypeObject, parseStep, ref } from '../../vendor/apk-contracts/apk-ifc.js';

/** The type entity of a part's file: the one tagged with the part id, else the only one. */
export function partTypeEntity(file, partId) {
  const types = file.entities.filter((e) => isTypeObject(e.type));
  if (partId) {
    const byTag = types.find((t) => t.args[7] === partId);
    if (byTag) return byTag;
  }
  return types.length === 1 ? types[0] : (types.find((t) => /^IFC[A-Z]+TYPE$/.test(t.type) && t.args[7]) ?? null);
}

/** The occurrence entity a type entity types (ISO 16739: IfcXType → IfcX). */
export const occurrenceOf = (typeEntity) => typeEntity.replace(/TYPE$/, '');

const enumKey = (v) => (v && typeof v === 'object' && v.kind === 'enum' ? v.value : null);
const unitKey = (args) => `${enumKey(args[1])}/${enumKey(args[2]) ?? ''}/${enumKey(args[3])}`;

/**
 * Copy part `pid`'s type out of its .ifc text into StepWriter `w` (frame F of projectFrame).
 * → {ref, entity, name} of the copied type, or null when the text holds no type.
 */
export function embedPartType(w, F, textIn, pid) {
  const file = typeof textIn === 'string' ? parseStep(textIn) : textIn;
  const t = partTypeEntity(file, pid);
  if (!t) return null;
  const include = new Set([t.id]);
  const portIds = new Set();
  for (const e of file.entities) {
    if (e.type === 'IFCRELNESTS' && isRef(e.args[4]) && e.args[4].id === t.id) {
      include.add(e.id);
      for (const r of e.args[5] ?? []) if (isRef(r)) portIds.add(r.id);
    }
  }
  for (const id of portIds) include.add(id);
  for (const e of file.entities) {
    if (e.type === 'IFCRELDEFINESBYPROPERTIES' && (e.args[4] ?? []).length && e.args[4].every((r) => isRef(r) && portIds.has(r.id))) include.add(e.id);
  }

  // what the plan already has: owner history, contexts, SI units (its assignment grows by what is new)
  const assignment = w.entity(F.units);
  const units = new Map();
  for (const r of assignment.args[0]) units.set(unitKey(w.entity(r).args), r);
  // the part measures in its own project's units (V, A, Hz …): the plan assigns each kind it lacks, once
  for (const ua of file.entities.filter((e) => e.type === 'IFCUNITASSIGNMENT')) {
    for (const r of ua.args[0] ?? []) {
      const u = isRef(r) ? file.byId.get(r.id) : null;
      if (u?.type !== 'IFCSIUNIT') continue;
      const kind = enumKey(u.args[1]);
      if (assignment.args[0].some((x) => enumKey(w.entity(x).args[1]) === kind)) continue;
      const added = w.once('IFCSIUNIT', u.args);
      assignment.args[0].push(added);
      units.set(unitKey(u.args), added);
    }
  }
  const shared = (e) => {
    if (e.type === 'IFCOWNERHISTORY') return F.oh;
    if (e.type === 'IFCGEOMETRICREPRESENTATIONCONTEXT') return Number(e.args[2]) === 2 ? F.plan : F.model;
    if (e.type === 'IFCGEOMETRICREPRESENTATIONSUBCONTEXT') return e.args[0] === 'FootPrint' ? F.footprint : e.args[0] === 'Annotation' ? F.annotation : F.body;
    if (e.type === 'IFCSIUNIT') return units.get(unitKey(e.args));
    if (e.type === 'IFCCONTEXTDEPENDENTUNIT') return F.contextUnits?.get(e.args[2]);
    return undefined;
  };

  const map = new Map();
  const order = [];
  const visit = (id) => {
    if (map.has(id)) return;
    const e = file.byId.get(id);
    if (!e) return;
    const s = shared(e);
    if (s !== undefined) { map.set(id, s); return; }
    map.set(id, 'pending');
    order.push(id);
    const walk = (v) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (isRef(v)) visit(v.id);
      else if (v && typeof v === 'object' && v.kind === 'typed') walk(v.value);
    };
    e.args.forEach(walk);
  };
  [...include].sort((a, b) => a - b).forEach(visit);
  order.sort((a, b) => a - b);
  const base = w.next;
  order.forEach((id, i) => map.set(id, ref(base + i)));
  const remap = (v) => {
    if (Array.isArray(v)) return v.map(remap);
    if (isRef(v)) return map.get(v.id);
    if (v && typeof v === 'object' && v.kind === 'typed') return { ...v, value: remap(v.value) };
    return v;
  };
  for (const id of order) {
    const e = file.byId.get(id);
    const r = w.add(e.type, e.args.map(remap));
    if (e.type === 'IFCSIUNIT') {
      units.set(unitKey(e.args), r);
      // one unit per UnitType in an assignment (IfcUnitAssignment WR01): a kind the plan has in another scale stays unassigned
      const kind = enumKey(e.args[1]);
      if (!assignment.args[0].some((u) => enumKey(w.entity(u).args[1]) === kind)) assignment.args[0].push(r);
    }
    if (e.type === 'IFCCONTEXTDEPENDENTUNIT') (F.contextUnits ??= new Map()).set(e.args[2], r);
  }
  return { ref: map.get(t.id), entity: t.type, name: t.args[2] };
}
