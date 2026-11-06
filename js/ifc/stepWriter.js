// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.
/**
 * A STEP file written one entity at a time, numbered in the order added — so
 * the same model always writes the same bytes. The codec is the contracts one
 * (vendor/apk-contracts/apk-ifc.js, built from contracts/src/ifc by
 * scripts/vendor-ifc.mjs): no IfcOpenShell in the page.
 */
import { enumv, real, ref, typed, writeStep } from '../../vendor/apk-contracts/apk-ifc.js';

export class StepWriter {
  constructor() {
    this.entities = [];
    this.next = 1;
    this.shared = new Map();
  }

  add(type, args) {
    const id = this.next++;
    this.entities.push({ id, type, args });
    return ref(id);
  }

  /** The same entity once (units, shared directions). */
  once(type, args) {
    const key = JSON.stringify([type, args]);
    if (!this.shared.has(key)) this.shared.set(key, this.add(type, args));
    return this.shared.get(key);
  }

  entity(r) {
    return this.entities[r.id - 1];
  }

  write(header) {
    return writeStep({ header, entities: this.entities });
  }
}

/** A REAL; -0 written as 0. */
export const R = (x) => real(Object.is(x, -0) ? 0 : Number(x));
export const E = enumv;
export const DERIVED = { kind: 'derived' };
export const label = (s) => typed('IFCLABEL', String(s));
export const text = (s) => typed('IFCTEXT', String(s));
export const ident = (s) => typed('IFCIDENTIFIER', String(s));
export const int = (n) => typed('IFCINTEGER', Math.trunc(n));
export const bool = (b) => typed('IFCBOOLEAN', enumv(b ? 'T' : 'F'));
export const measure = (type, x) => typed(type, R(x));

/**
 * The project frame every editor's file opens with: owner, units (mm, m², m³,
 * s), the 3D Model context (Body, FootPrint) and the 2D Plan context
 * (Annotation). `app` names the editor in IfcApplication.
 */
export function projectFrame(w, app) {
  const person = w.add('IFCPERSON', [null, 'APK.audio', null, null, null, null, null, null]);
  const org = w.add('IFCORGANIZATION', [null, 'APK.audio', app, null, null]);
  const po = w.add('IFCPERSONANDORGANIZATION', [person, org, null]);
  const application = w.add('IFCAPPLICATION', [org, '1', app, app]);
  const oh = w.add('IFCOWNERHISTORY', [po, application, null, null, null, null, null, 0]);
  const si = (kind, prefix, name) => w.once('IFCSIUNIT', [DERIVED, E(kind), prefix ? E(prefix) : null, E(name)]);
  const units = w.add('IFCUNITASSIGNMENT', [[
    si('LENGTHUNIT', 'MILLI', 'METRE'), si('AREAUNIT', null, 'SQUARE_METRE'), si('VOLUMEUNIT', null, 'CUBIC_METRE'),
    si('TIMEUNIT', null, 'SECOND'), si('MASSUNIT', 'KILO', 'GRAM'), si('POWERUNIT', null, 'WATT'),
  ]]);
  const origin = w.add('IFCCARTESIANPOINT', [[R(0), R(0), R(0)]]);
  const world = w.add('IFCAXIS2PLACEMENT3D', [origin, null, null]);
  const model = w.add('IFCGEOMETRICREPRESENTATIONCONTEXT', [null, 'Model', 3, R(1e-5), world, null]);
  const sub = (id, parent, type, view) => w.add('IFCGEOMETRICREPRESENTATIONSUBCONTEXT', [id, type, DERIVED, DERIVED, DERIVED, DERIVED, parent, null, E(view), null]);
  const body = sub('Body', model, 'Model', 'MODEL_VIEW');
  const footprint = sub('FootPrint', model, 'Model', 'PLAN_VIEW');
  const plan = w.add('IFCGEOMETRICREPRESENTATIONCONTEXT', [null, 'Plan', 2, R(1e-5), w.add('IFCAXIS2PLACEMENT2D', [w.add('IFCCARTESIANPOINT', [[R(0), R(0)]]), null]), null]);
  const annotation = sub('Annotation', plan, 'Plan', 'PLAN_VIEW');
  return { oh, org, units, origin, world, model, plan, body, footprint, annotation };
}

/** The ISO 10303-21 header every editor's file carries. */
export function stepHeader(name, stamp, app) {
  return [
    { type: 'FILE_DESCRIPTION', args: [['ViewDefinition [ReferenceView]'], '2;1'] },
    { type: 'FILE_NAME', args: [name, stamp, ['APK.audio'], ['APK.audio'], app, app, ''] },
    { type: 'FILE_SCHEMA', args: [['IFC4X3_ADD2']] },
  ];
}

/** Property sets collected while writing, related at the end (one IfcRelDefinesByProperties each). */
export function psetWriter(w, oh, ifcGuid) {
  const rels = [];
  const pset = (owner, name, props, objects, entity = 'IFCPROPERTYSET') => {
    const values = props.filter(([, v]) => v !== undefined && v !== null);
    if (!values.length || !objects.length) return;
    const items = values.map(([k, v]) => (entity === 'IFCELEMENTQUANTITY'
      ? w.add(v.q, [k, null, null, R(v.value), null])
      : w.add(Array.isArray(v) ? 'IFCPROPERTYLISTVALUE' : 'IFCPROPERTYSINGLEVALUE', [k, null, v, null])));
    const gid = ifcGuid(owner, entity === 'IFCELEMENTQUANTITY' ? 'qto' : 'pset', name);
    const set = w.add(entity, entity === 'IFCELEMENTQUANTITY' ? [gid, oh, name, null, null, items] : [gid, oh, name, null, items]);
    rels.push({ set, objects, gid });
  };
  const flush = () => {
    for (const { set, objects, gid } of rels) w.add('IFCRELDEFINESBYPROPERTIES', [ifcGuid('rel', 'props', gid), oh, null, null, objects, set]);
  };
  return { pset, flush };
}
