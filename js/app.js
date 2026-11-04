// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.

import { BlockBridge } from './blockBridge.js';
import { FloorPlanModel, DROP_CATEGORIES } from './floorPlanModel.js';
import { renderFloorPlanSvg } from './floorPlanSvg.js';

let model = new FloorPlanModel();
let activeCategory = 'DATA';
let isPlacingDrop = false;

const bridge = new BlockBridge({
  name: 'Floor Plan Editor',
  type: 'floorplan',
  defaultBlock: model.toJSON(),
  onBlockLoaded: (block) => {
    if (block) {
      model = new FloorPlanModel(block);
      renderAll();
    }
  },
});

function renderPalette() {
  const container = document.getElementById('palette-categories');
  if (!container) return;

  container.innerHTML = Object.entries(DROP_CATEGORIES).map(([key, cat]) => {
    const isActive = activeCategory === key;
    return `
      <button class="btn ${isActive ? 'btn-primary' : 'btn-secondary'} btn-category" data-cat="${key}" style="justify-content: flex-start; text-align: left; padding: 8px 10px;">
        <span style="font-size: 15px; margin-right: 6px;">${cat.icon}</span>
        <div style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          <div style="font-weight: 600; font-size: 11px;">${cat.label}</div>
          <div style="font-size: 9px; opacity: 0.7; font-family: var(--font-mono);">${key}</div>
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
          <span style="font-size: 18px;">${cat.icon}</span>
          <span style="font-weight: 700; color: var(--osc-text-primary); font-size: 13px;">${drop.refdes}</span>
        </div>
        <button class="btn btn-secondary btn-sm" id="btn-delete-drop" style="color: var(--osc-status-danger);">🗑️ Delete</button>
      </div>

      <div style="display: flex; flex-direction: column; gap: 10px;">
        <div>
          <label style="display: block; font-size: 10px; color: var(--osc-text-muted); margin-bottom: 3px;">REFERENCE DESIGNATION</label>
          <input type="text" class="input" id="inp-refdes" value="${drop.refdes}">
        </div>
        <div>
          <label style="display: block; font-size: 10px; color: var(--osc-text-muted); margin-bottom: 3px;">LABEL / PURPOSE</label>
          <input type="text" class="input" id="inp-label" value="${drop.label}">
        </div>
        <div>
          <label style="display: block; font-size: 10px; color: var(--osc-text-muted); margin-bottom: 3px;">CATEGORY</label>
          <select class="input" id="inp-category">
            ${Object.keys(DROP_CATEGORIES).map((k) => `
              <option value="${k}" ${drop.category === k ? 'selected' : ''}>${DROP_CATEGORIES[k].label}</option>
            `).join('')}
          </select>
        </div>
        <div>
          <label style="display: block; font-size: 10px; color: var(--osc-text-muted); margin-bottom: 3px;">LOCATION / ROOM</label>
          <input type="text" class="input" id="inp-room" value="${drop.room}" readonly style="opacity: 0.8;">
        </div>
        <div>
          <label style="display: block; font-size: 10px; color: var(--osc-text-muted); margin-bottom: 3px;">CIRCUIT / FEED</label>
          <input type="text" class="input" id="inp-circuit" value="${drop.circuit}">
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
          <div>
            <label style="display: block; font-size: 10px; color: var(--osc-text-muted); margin-bottom: 3px;">X (METERS)</label>
            <input type="number" step="0.5" class="input" id="inp-x" value="${drop.x}">
          </div>
          <div>
            <label style="display: block; font-size: 10px; color: var(--osc-text-muted); margin-bottom: 3px;">Y (METERS)</label>
            <input type="number" step="0.5" class="input" id="inp-y" value="${drop.y}">
          </div>
        </div>
      </div>
    `;

    document.getElementById('btn-delete-drop')?.addEventListener('click', () => {
      model.deleteDrop(drop.id);
      bridge.notifyChanged();
      renderAll();
    });

    const bindField = (id, prop) => {
      document.getElementById(id)?.addEventListener('input', (e) => {
        const val = prop === 'x' || prop === 'y' ? parseFloat(e.target.value) || 0 : e.target.value;
        model.updateDrop(drop.id, { [prop]: val });
        bridge.notifyChanged();
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
        <div style="font-weight: 700; color: var(--osc-text-primary); font-size: 14px; margin-top: 2px;">${room.name}</div>
      </div>

      <div style="display: flex; flex-direction: column; gap: 10px;">
        <div>
          <label style="display: block; font-size: 10px; color: var(--osc-text-muted); margin-bottom: 3px;">ROOM NAME</label>
          <input type="text" class="input" id="inp-room-name" value="${room.name}">
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
      bridge.notifyChanged();
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
      <span>TOTAL AREA: <strong style="color: var(--osc-text-primary);">${m.totalAreaSqm} m²</strong></span>
      <span>ROOMS: <strong style="color: var(--osc-accent-secondary);">${m.roomCount}</strong></span>
      <span>TOTAL DROPS: <strong style="color: var(--osc-accent-primary);">${m.dropCount}</strong></span>
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
    const xM = Math.round((clickPxX / model.pixelsPerMeter) * 2) / 2; // snap to 0.5m
    const yM = Math.round((clickPxY / model.pixelsPerMeter) * 2) / 2;

    if (isPlacingDrop) {
      const newDrop = model.addDrop({
        category: activeCategory,
        x: xM,
        y: yM,
      });
      model.selectedDropId = newDrop.id;
      model.selectedRoomId = null;
      isPlacingDrop = false;
      document.getElementById('btn-mode-place')?.classList.remove('btn-primary');
      document.getElementById('btn-mode-place')?.classList.add('btn-secondary');
      bridge.notifyChanged();
      renderAll();
    } else {
      model.selectedDropId = null;
      model.selectedRoomId = null;
      renderAll();
    }
  });
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

  document.getElementById('btn-open-block')?.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.geojson';
    input.onchange = (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const parsed = JSON.parse(event.target.result);
          model = new FloorPlanModel(parsed);
          bridge.loadBlock(model.toJSON(), { filename: file.name });
          renderAll();
        } catch (err) {
          alert('Failed to parse floor plan file: ' + err.message);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  });

  document.getElementById('btn-discovered')?.addEventListener('click', async () => {
    const project = await bridge.fetchDiscoveredProject();
    if (project) {
      alert(`Discovered Project: ${project.project_name || 'APK Audio Facility'}\nRooms: ${model.rooms.length}`);
    } else {
      alert('Connecting to live discovery bus...');
    }
  });

  document.getElementById('btn-save-block')?.addEventListener('click', () => {
    bridge.saveBlock(model.toJSON(), { filename: model.name.toLowerCase().replace(/\s+/g, '_') });
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
