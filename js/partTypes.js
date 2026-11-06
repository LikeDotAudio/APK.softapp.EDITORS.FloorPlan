// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.
/* THE DROPS' PART TYPES (ROAD-3582 r4) — a drop placed from the BIM library is an occurrence of
   its part, and the part's IFC type is the stored twin GET <BIM API>/parts/<maker>/<model>.ifc
   (DATABASE.server.BIM). Save Model fetches the types the plan's drops name and embeds each in
   the .ifc (ifc/partType.js), the way EDITORS.PowerChain does. The API is same-origin /api/bim
   unless the page sets window.APK_BIM_API. A part that does not answer is still written, typed
   by a stub naming the part (APK_Part.PartId). */

export const bimApi = () => String(globalThis.APK_BIM_API || '/api/bim').replace(/\/$/, '');

/** The URL of a part's .ifc type (ids are <maker>/<model>). */
export function partIfcUrl(pid, base = bimApi()) {
  const [maker, model] = String(pid).split('/');
  return `${base}/parts/${encodeURIComponent(maker)}/${encodeURIComponent(model ?? '')}.ifc`;
}

/** Every part id the plan's drops name, on every floor. */
export function partIdsOf(plan) {
  const json = typeof plan?.toJSON === 'function' ? plan.toJSON() : plan;
  const out = new Set();
  for (const f of json?.floors ?? []) for (const d of f.drops ?? []) { const p = d.bimRef?.part || d.bimId; if (p) out.add(p); }
  return [...out].sort();
}

/** Fetch the part types the plan needs (cache: Map pid → text | null). → {types: {pid: text}, missing: [pid]}. */
export async function loadPartTypes(plan, cache, { fetchFn = globalThis.fetch, base = bimApi() } = {}) {
  const missing = [];
  const types = {};
  for (const pid of partIdsOf(plan)) {
    if (!cache.has(pid)) {
      let text = null;
      try {
        const r = await fetchFn(partIfcUrl(pid, base), { headers: { Accept: 'model/step, application/x-step' } });
        if (r.ok) text = await r.text();
      } catch (_) { text = null; }
      cache.set(pid, typeof text === 'string' && text.startsWith('ISO-10303-21') ? text : null);
    }
    if (cache.get(pid)) types[pid] = cache.get(pid);
    else missing.push(pid);
  }
  return { types, missing };
}
