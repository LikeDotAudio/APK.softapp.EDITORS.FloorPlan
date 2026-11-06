// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.

import { linkBlock, mountDiscovered, openJsonFile } from './softappLink.js';
import { FloorPlanModel, DROP_CATEGORIES, categoryForPart, metresToMm, mmToMetres } from './floorPlanModel.js';
import { libraryButton, acceptLibraryDrops, bimFields } from './bimLibrary.js';
import { renderFloorPlanSvg } from './floorPlanSvg.js';
import { fromIfc, toIfc } from './ifc/floorPlanIfc.js';

let model = new FloorPlanModel();
let activeCategory = 'DATA';
let isPlacingDrop = false;
let pendingPart = null;   // a BIM part picked from 📚 Library, placed on the next click (ROAD-3572)

const S = window.APKSoftapp;
const esc = S.esc;

S.describe({
  name: 'Floor Plan Editor',
  does: 'A facility floor plan: floors and rooms, with numbered drops (data, power, audio...) placed on a 500 mm grid, and a count of each kind.',
  inputs: [
    { name: 'Floor plan block', from: 'the CAD (when opened from a drawing), or a .json file via Open Block', kind: 'file' },
    { name: '<plan>.ifc', from: 'Open Model: an IFC4X3 file (storeys → floors, spaces → rooms, occurrences → drops), or the plan .json', kind: 'file' },
    { name: 'Discovered', from: 'the bus: what scanners and agents found (kinds in config/discovered.json), shown read-only', kind: 'bus' },
  ],
  outputs: [
    { name: 'Floor plan block', to: 'the CAD on Save & Return and on every edit; standalone Save downloads <plan name>.json', kind: 'file' },
    { name: '<plan name>.ifc + .json', to: 'Save Model: the plan as IFC4X3_ADD2 (storeys, spaces, drops as occurrences, circuits; mm) and its native .json twin', kind: 'file' },
    { name: '<plan name>.geojson', to: 'a download (Export GeoJSON); a GIS convenience export only, it does not open back in', kind: 'file' },
  ],
  controls: [
    { name: 'Drop categories', how: 'pick the kind of drop to place' },
    { name: 'Place Drop Tool', how: 'toggle on, then click the plan to drop one at the snapped point' },
    { name: '📚 Library', how: 'pick a device from the BIM library (Ctrl+Shift+L), then click the plan to place it — or drag a part from the library onto the plan; it keeps its bimId and bimRef' },
    { name: 'Click a drop or room', how: 'select it; click empty plan to deselect' },
    { name: 'Inspector', how: 'drop refdes, label, category, circuit, room, X / Y (mm), Delete; room name' },
    { name: 'Discovered / Open Block / Open Model / Save Model / Export GeoJSON / Save & Return / Close', how: 'header buttons' },
  ],
  problems: ['bad_json', 'bad_input', 'file_unreadable', 'not_in_cad', 'bus_missing', 'save_failed'],
});

const bridge = linkBlock(S, {
  editor: 'Floor Plan Editor',
  blockType: 'floorplan',
  Model: FloorPlanModel,
  getModel: () => model,
  setModel: (m, meta) => {
    model = m;
    const tag = document.getElementById('block-tag');
    if (tag && (meta.blockName || meta.filename)) tag.textContent = meta.blockName || meta.filename;
    renderAll();
  },
  filename: (m) => m.name.toLowerCase().replace(/\s+/g, '_'),
});

function renderPalette() {
  const container = document.getElementById('palette-categories');
  if (!container) return;

  container.innerHTML = Object.entries(DROP_CATEGORIES).map(([key, cat]) => {
    const isActive = activeCategory === key;
    return `
      <button class="btn ${isActive ? 'btn-primary' : 'btn-secondary'} btn-category" data-cat="${esc(key)}" style="justify-content: flex-start; text-align: left; padding: 8px 10px;">
        <span style="font-size: 15px; margin-right: 6px;">${esc(cat.icon)}</span>
        <div style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          <div style="font-weight: 600; font-size: 11px;">${esc(cat.label)}</div>
          <div style="font-size: 9px; opacity: 0.7; font-family: var(--font-mono);">${esc(key)}</div>
        </div>
      </button>
    `;
  }).join('');

  container.querySelectorAll('.btn-category').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeCategory = btn.getAttribute('data-cat');
      renderPalette();
    });
  });
}

function renderInspector() {
  const container = document.getElementById('inspector-content');
  if (!container) return;

  if (model.selectedDropId) {
    const drop = model.drops.find((d) => d.id === model.selectedDropId);
    if (!drop) {
      model.selectedDropId = null;
      renderInspector();
      return;
    }
    const cat = DROP_CATEGORIES[drop.category] || DROP_CATEGORIES.DATA;

    container.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; border-bottom: 1px solid var(--osc-border-default); padding-bottom: 8px;">
        <div style="display: flex; align-items: center; gap: 6px;">
          <span style="font-size: 18px;">${esc(cat.icon)}</span>
          <span style="font-weight: 700; color: var(--osc-text-primary); font-size: 13px;">${esc(drop.refdes)}</span>
        </div>
        <button class="btn btn-secondary btn-sm" id="btn-delete-drop" style="color: var(--osc-status-danger);">🗑️ Delete</button>
      </div>

      <div style="display: flex; flex-direction: column; gap: 10px;">
        <div>
          <label style="display: block; font-size: 10px; color: var(--osc-text-muted); margin-bottom: 3px;">REFERENCE DESIGNATION</label>
          <input type="text" class="input" id="inp-refdes" value="${esc(drop.refdes)}">
        </div>
        ${drop.bimId ? `<div class="drop-bim-part" title="${esc((drop.bimRef && drop.bimRef.url) || '')}" style="font-size: 11px; color: var(--osc-text-muted);">📚 BIM part <b>${esc(drop.bimId)}</b></div>` : ''}
        <div>
          <label style="display: block; font-size: 10px; color: var(--osc-text-muted); margin-bottom: 3px;">LABEL / PURPOSE</label>
          <input type="text" class="input" id="inp-label" value="${esc(drop.label)}">
        </div>
        <div>
          <label style="display: block; font-size: 10px; color: var(--osc-text-muted); margin-bottom: 3px;">CATEGORY</label>
          <select class="input" id="inp-category">
            ${Object.keys(DROP_CATEGORIES).map((k) => `
              <option value="${esc(k)}" ${drop.category === k ? 'selected' : ''}>${esc(DROP_CATEGORIES[k].label)}</option>
            `).join('')}
          </select>
        </div>
        <div>
          <label style="display: block; font-size: 10px; color: var(--osc-text-muted); margin-bottom: 3px;">LOCATION / ROOM</label>
          <input type="text" class="input" id="inp-room" value="${esc(drop.room)}" readonly style="opacity: 0.8;">
        </div>
        <div>
          <label style="display: block; font-size: 10px; color: var(--osc-text-muted); margin-bottom: 3px;">CIRCUIT / FEED</label>
          <input type="text" class="input" id="inp-circuit" value="${esc(drop.circuit)}">
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
          <div>
            <label style="display: block; font-size: 10px; color: var(--osc-text-muted); margin-bottom: 3px;">X (MM)</label>
            <input type="number" step="500" class="input" id="inp-x" value="${esc(metresToMm(drop.x))}">
          </div>
          <div>
            <label style="display: block; font-size: 10px; color: var(--osc-text-muted); margin-bottom: 3px;">Y (MM)</label>
            <input type="number" step="500" class="input" id="inp-y" value="${esc(metresToMm(drop.y))}">
          </div>
        </div>
      </div>
    `;

    document.getElementById('btn-delete-drop')?.addEventListener('click', () => {
      model.deleteDrop(drop.id);
      bridge.changed();
      renderAll();
    });

    const bindField = (id, prop) => {
      document.getElementById(id)?.addEventListener('input', (e) => {
        const val = prop === 'x' || prop === 'y' ? mmToMetres(e.target.value) : e.target.value; // field mm, block m
        model.updateDrop(drop.id, { [prop]: val });
        bridge.changed();
        renderSvg();
        renderMetrics();
      });
    };

    bindField('inp-refdes', 'refdes');
    bindField('inp-label', 'label');
    bindField('inp-category', 'category');
    bindField('inp-circuit', 'circuit');
    bindField('inp-x', 'x');
    bindField('inp-y', 'y');

  } else if (model.selectedRoomId) {
    const room = model.rooms.find((r) => r.id === model.selectedRoomId);
    if (!room) {
      model.selectedRoomId = null;
      renderInspector();
      return;
    }
    const area = Math.round(model.getRoomArea(room.id) * 10) / 10;
    const roomDrops = model.drops.filter((d) => d.room === room.name);

    container.innerHTML = `
      <div style="margin-bottom: 12px; border-bottom: 1px solid var(--osc-border-default); padding-bottom: 8px;">
        <span style="font-size: 10px; text-transform: uppercase; color: var(--osc-accent-primary); font-weight: 700;">ROOM PROPERTIES</span>
        <div style="font-weight: 700; color: var(--osc-text-primary); font-size: 14px; margin-top: 2px;">${esc(room.name)}</div>
      </div>

      <div style="display: flex; flex-direction: column; gap: 10px;">
        <div>
          <label style="display: block; font-size: 10px; color: var(--osc-text-muted); margin-bottom: 3px;">ROOM NAME</label>
          <input type="text" class="input" id="inp-room-name" value="${esc(room.name)}">
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
          <div>
            <label style="display: block; font-size: 10px; color: var(--osc-text-muted); margin-bottom: 3px;">AREA (M²)</label>
            <input type="text" class="input" value="${area} m²" readonly style="opacity: 0.8;">
          </div>
          <div>
            <label style="display: block; font-size: 10px; color: var(--osc-text-muted); margin-bottom: 3px;">DROPS IN ROOM</label>
            <input type="text" class="input" value="${roomDrops.length}" readonly style="opacity: 0.8;">
          </div>
        </div>
      </div>
    `;

    document.getElementById('inp-room-name')?.addEventListener('input', (e) => {
      const oldName = room.name;
      room.name = e.target.value;
      // Update drop rooms if they matched
      for (const d of model.drops) {
        if (d.room === oldName) d.room = room.name;
      }
      bridge.changed();
      renderSvg();
    });

  } else {
    container.innerHTML = `
      <div style="padding: 20px 10px; text-align: center; color: var(--osc-text-muted);">
        <div style="font-size: 28px; margin-bottom: 8px; opacity: 0.5;">🗺️</div>
        <div>Select a room or drop marker on the canvas to inspect and edit details.</div>
      </div>
    `;
  }
}

function renderMetrics() {
  const container = document.getElementById('telemetry-metrics');
  if (!container) return;

  const m = model.getMetrics();
  container.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: space-between; font-size: 10px; color: var(--osc-text-muted);">
      <span>TOTAL AREA: <strong style="color: var(--osc-text-primary);">${esc(m.totalAreaSqm)} m²</strong></span>
      <span>ROOMS: <strong style="color: var(--osc-accent-secondary);">${esc(m.roomCount)}</strong></span>
      <span>TOTAL DROPS: <strong style="color: var(--osc-accent-primary);">${esc(m.dropCount)}</strong></span>
    </div>
  `;
}

function renderSvg() {
  const container = document.getElementById('canvas-wrapper');
  if (!container) return;

  container.innerHTML = renderFloorPlanSvg(model, {
    ppm: model.pixelsPerMeter,
    showGrid: true,
    showScale: true,
    selectedDropId: model.selectedDropId,
    selectedRoomId: model.selectedRoomId,
  });

  // Attach interactive SVG handlers
  const svg = container.querySelector('#floorplan-canvas-svg');
  if (!svg) return;

  svg.querySelectorAll('.drop-marker').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const dropId = el.getAttribute('data-drop-id');
      model.selectedDropId = dropId;
      model.selectedRoomId = null;
      renderAll();
    });
  });

  svg.querySelectorAll('.room-group').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const roomId = el.getAttribute('data-room-id');
      model.selectedRoomId = roomId;
      model.selectedDropId = null;
      renderAll();
    });
  });

  svg.addEventListener('click', (e) => {
    const rect = svg.getBoundingClientRect();
    const clickPxX = e.clientX - rect.left;
    const clickPxY = e.clientY - rect.top;
    const xM = Math.round((clickPxX / model.pixelsPerMeter) * 2) / 2; // snap to 500 mm (block keeps m)
    const yM = Math.round((clickPxY / model.pixelsPerMeter) * 2) / 2;

    if (isPlacingDrop) {
      const newDrop = pendingPart ? model.addDrop(dropForPart(pendingPart, xM, yM)) : model.addDrop({
        category: activeCategory,
        x: xM,
        y: yM,
      });
      pendingPart = null;
      model.selectedDropId = newDrop.id;
      model.selectedRoomId = null;
      isPlacingDrop = false;
      document.getElementById('btn-mode-place')?.classList.remove('btn-primary');
      document.getElementById('btn-mode-place')?.classList.add('btn-secondary');
      bridge.changed();
      renderAll();
    } else {
      model.selectedDropId = null;
      model.selectedRoomId = null;
      renderAll();
    }
  });
}

/** A drop for a part from the library: its kind, its name, its part and BIM reference. */
function dropForPart(item, x, y) {
  const { bimId, bimRef } = bimFields(item);
  return { category: categoryForPart(item.bim), label: item.bim.name || `${item.bim.manufacturer || ''} ${item.bim.model || ''}`.trim() || bimId, x, y, bimId, bimRef };
}

function renderAll() {
  renderSvg();
  renderPalette();
  renderInspector();
  renderMetrics();
}

// Window actions
document.addEventListener('DOMContentLoaded', () => {
  renderAll();

  document.getElementById('btn-mode-place')?.addEventListener('click', () => {
    isPlacingDrop = !isPlacingDrop;
    const btn = document.getElementById('btn-mode-place');
    if (isPlacingDrop) {
      btn?.classList.remove('btn-secondary');
      btn?.classList.add('btn-primary');
    } else {
      btn?.classList.remove('btn-primary');
      btn?.classList.add('btn-secondary');
    }
  });

  // 📚 Library (ROAD-3572): pick a device, then click the plan to place it
  const placeBtn = document.getElementById('btn-mode-place');
  placeBtn?.after(libraryButton((items) => {
    pendingPart = items[0];
    isPlacingDrop = true;
    placeBtn.classList.remove('btn-secondary');
    placeBtn.classList.add('btn-primary');
  }, { className: 'btn btn-secondary btn-sm', title: 'Place a device from the BIM library: pick it, then click the plan' }));
  // a part dragged from the library onto the plan is placed where it is let go
  const wrapper = document.getElementById('canvas-wrapper');
  if (wrapper) acceptLibraryDrops(wrapper, (item, e) => {
    const svg = wrapper.querySelector('#floorplan-canvas-svg');
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const snap = (px) => Math.round((px / model.pixelsPerMeter) * 2) / 2;
    const d = model.addDrop(dropForPart(item, snap(e.clientX - rect.left), snap(e.clientY - rect.top)));
    model.selectedDropId = d.id;
    model.selectedRoomId = null;
    bridge.changed();
    renderAll();
  });

  document.getElementById('btn-open-block')?.addEventListener('click', () => openJsonFile(S, {
    what: 'a floor plan block',
    accept: '.json,.geojson',
    onJson: (parsed, file) => {
      // A bare GeoJSON (what Export GeoJSON writes) has no floors / rooms / drops: it would open as the default plan.
      if (!parsed || typeof parsed !== 'object' || (!parsed.floors && !parsed.rooms && !parsed.drops && parsed.type === 'FeatureCollection')) {
        throw new TypeError('this is a GeoJSON export (no floors, rooms or drops): open the floor plan block .json that Save & Return wrote');
      }
      bridge.openLocal(parsed, { filename: file.name });
    },
  }));

  mountDiscovered(S, window.APKTable, {
    button: document.getElementById('btn-discovered'),
    panel: document.getElementById('discovered-panel'),
    status: document.getElementById('discovered-status'),
    tableHost: document.getElementById('discovered-table'),
    tableId: 'floorplan-discovered',
  });

  document.getElementById('btn-save-block')?.addEventListener('click', () => {
    bridge.save();
  });

  // Save Model / Open Model: the plan as IFC4X3 with its .json twin (cad-8, apk-softapp saveModel / openModel)
  document.getElementById('btn-save-model')?.addEventListener('click', async () => {
    const r = await S.saveModel(model, { name: model.name.toLowerCase().replace(/\s+/g, '_'), toIfc: (m) => toIfc(m), toJson: (m) => m.toJSON() });
    if (!r.ok && !r.cancelled && r.problem) S.showProblem(r.problem);
  });
  document.getElementById('btn-open-model')?.addEventListener('click', async () => {
    const o = await S.openModel({ fromIfc: (t) => fromIfc(t), fromJson: (data) => data });
    if (o.ok) bridge.openLocal(o.model, { filename: o.name || '' });
    else if (!o.cancelled && o.problem) S.showProblem(o.problem);
  });

  document.getElementById('btn-export-geojson')?.addEventListener('click', () => {
    const geojson = model.toGeoJson();
    const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/geo+json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${model.name.toLowerCase().replace(/\s+/g, '_')}.geojson`;
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById('btn-close')?.addEventListener('click', () => {
    bridge.close();
  });
});
