// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.

import { calculatePolygonArea, calculateRoomAcoustics, DROP_CATEGORIES } from './floorPlanModel.js';

/** Text and attribute values into SVG markup: "Live & Control" must not end the document. */
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function renderFloorPlanSvg(model, options = {}) {
  const {
    ppm = model.pixelsPerMeter || 40,
    showGrid = true,
    showScale = true,
    showAcoustics = true,
    selectedDropId = null,
    selectedRoomId = null,
  } = options;
  const widthPx = model.width_m * ppm;
  const heightPx = model.height_m * ppm;

  // Background and Grid
  let gridSvg = '';
  if (showGrid) {
    gridSvg = `
      <defs>
        <pattern id="grid-minor" width="${ppm / 2}" height="${ppm / 2}" patternUnits="userSpaceOnUse">
          <path d="M ${ppm / 2} 0 L 0 0 0 ${ppm / 2}" fill="none" stroke="#18181b" stroke-width="0.5"/>
        </pattern>
        <pattern id="grid-major" width="${ppm}" height="${ppm}" patternUnits="userSpaceOnUse">
          <rect width="${ppm}" height="${ppm}" fill="url(#grid-minor)"/>
          <path d="M ${ppm} 0 L 0 0 0 ${ppm}" fill="none" stroke="#2c2c2c" stroke-width="1"/>
        </pattern>
        <pattern id="acoustic-absorber-hatch" width="8" height="8" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
          <line x1="0" y1="0" x2="0" y2="8" stroke="#8B5CF6" stroke-width="1.5" stroke-opacity="0.3"/>
        </pattern>
        <radialGradient id="sweet-spot-gradient" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#4A9EFF" stop-opacity="0.4"/>
          <stop offset="100%" stop-color="#4A9EFF" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="100%" height="100%" fill="#121212"/>
      <rect width="100%" height="100%" fill="url(#grid-major)"/>
    `;
  } else {
    gridSvg = `<rect width="100%" height="100%" fill="#121212"/>`;
  }

  // Multi-floor Selector Header
  let floorTabsSvg = '';
  if (model.floors && model.floors.length > 1) {
    const tabHeight = 24;
    // Each tab as wide as its own text (11 px sans ≈ 6.4 px a character).
    const tabText = (fl, idx) => `Level ${fl.level || idx + 1}: ${fl.name}`;
    const widths = model.floors.map((fl, idx) => Math.max(140, Math.ceil(tabText(fl, idx).length * 6.4) + 24));
    const tabs = model.floors.map((fl, idx) => {
      const isActive = fl.id === model.activeFloorId;
      const tabWidth = widths[idx];
      const tx = 20 + widths.slice(0, idx).reduce((a, w) => a + w + 8, 0);
      return `
        <g class="floor-tab" data-floor-id="${esc(fl.id)}" transform="translate(${tx}, 12)" style="cursor: pointer;">
          <rect width="${tabWidth}" height="${tabHeight}" rx="4"
            fill="${isActive ? '#F4902C' : '#18181b'}"
            stroke="${isActive ? '#F4902C' : '#3f3f46'}"
            stroke-width="1"
          />
          <text x="12" y="16" font-family="-apple-system, sans-serif" font-size="11" font-weight="${isActive ? '700' : '500'}" fill="${isActive ? '#121212' : '#f4f4f5'}">
            ${esc(tabText(fl, idx))}
          </text>
        </g>
      `;
    }).join('');

    floorTabsSvg = `
      <g id="floor-selector-bar">
        ${tabs}
      </g>
    `;
  }

  // Rooms with Acoustic Space Overlays
  const roomsSvg = model.rooms.map((room) => {
    const isSelected = room.id === selectedRoomId;
    const ptsStr = room.polygon.map((p) => `${p.x * ppm},${p.y * ppm}`).join(' ');
    const area = Math.round(calculatePolygonArea(room.polygon) * 10) / 10;
    const acoustics = calculateRoomAcoustics(room);
    
    // Find polygon centroid for label
    const cx = (room.polygon.reduce((acc, p) => acc + p.x, 0) / room.polygon.length) * ppm;
    const cy = (room.polygon.reduce((acc, p) => acc + p.y, 0) / room.polygon.length) * ppm;
    // The name/type/acoustics block sits along the room's bottom edge, not at
    // its centre, where drops and the mix position usually are.
    const ly = Math.max(...room.polygon.map((p) => p.y)) * ppm - (showAcoustics ? 50 : 22);

    // Acoustic Space Visuals: Sweet spot & monitor dispersion
    let acousticOverlays = '';
    if (showAcoustics && acoustics) {
      const mixPos = room.mixPosition || { x: cx / ppm, y: cy / ppm };
      const mpx = mixPos.x * ppm;
      const mpy = mixPos.y * ppm;

      // Mix Position (Sweet Spot)
      const sweetSpotSvg = `
        <g class="acoustic-sweet-spot" transform="translate(${mpx}, ${mpy})">
          <circle r="${ppm * 0.7}" fill="url(#sweet-spot-gradient)"/>
          <circle r="4" fill="#4A9EFF" stroke="#f4f4f5" stroke-width="1.5"/>
          <line x1="-8" y1="0" x2="8" y2="0" stroke="#4A9EFF" stroke-width="1.5"/>
          <line x1="0" y1="-8" x2="0" y2="8" stroke="#4A9EFF" stroke-width="1.5"/>
          <text x="10" y="3" font-family="'JetBrains Mono', monospace" font-size="8" font-weight="700" fill="#4A9EFF">MIX EAR</text>
        </g>
      `;

      // Monitor Speaker Coverage
      let speakersSvg = '';
      if (room.speakers && Array.isArray(room.speakers)) {
        speakersSvg = room.speakers.map((spk) => {
          const sx = spk.x * ppm;
          const sy = spk.y * ppm;
          return `
            <g class="acoustic-speaker" transform="translate(${sx}, ${sy})">
              <!-- Acoustic dispersion lines to sweet spot -->
              <line x1="0" y1="0" x2="${mpx - sx}" y2="${mpy - sy}" stroke="#8B5CF6" stroke-width="1" stroke-dasharray="3,3" opacity="0.6"/>
              <rect x="-6" y="-6" width="12" height="12" rx="2" fill="#8B5CF6" stroke="#f4f4f5" stroke-width="1"/>
              <text y="-8" text-anchor="middle" font-family="'JetBrains Mono', monospace" font-size="7" fill="#8B5CF6">${spk.label}</text>
            </g>
          `;
        }).join('');
      }

      // Corner Bass Traps
      const cornersSvg = room.polygon.map((pt) => {
        const px = pt.x * ppm;
        const py = pt.y * ppm;
        return `
          <circle cx="${px}" cy="${py}" r="${ppm * 0.25}" fill="#8B5CF6" fill-opacity="0.25" stroke="#8B5CF6" stroke-width="1" stroke-dasharray="2,2"/>
        `;
      }).join('');

      // Acoustic Metadata Tag Badge
      const badgeW = 210;
      const badgeH = 22;
      const badgeSvg = `
        <g class="acoustic-space-badge" transform="translate(${cx - badgeW / 2}, ${ly + 18})">
          <rect width="${badgeW}" height="${badgeH}" rx="3" fill="#0f0f11" stroke="#8B5CF6" stroke-width="1" fill-opacity="0.9"/>
          <text x="${badgeW / 2}" y="14" text-anchor="middle" font-family="'JetBrains Mono', monospace" font-size="8.5" font-weight="600" fill="#C4B5FD">
            ${acoustics.classified ? '' : 'set room type · '}${acoustics.volume_m3}m³ · RT₆₀: ${acoustics.rt60_estimated}s · fₛ: ${acoustics.schroeder_freq_hz}Hz · NC-${acoustics.nc_rating}
          </text>
        </g>
      `;

      acousticOverlays = `
        ${cornersSvg}
        ${sweetSpotSvg}
        ${speakersSvg}
        ${badgeSvg}
      `;
    }

    return `
      <g class="room-group" data-room-id="${esc(room.id)}">
        <polygon points="${ptsStr}"
          fill="${room.color || '#18181b'}"
          fill-opacity="${isSelected ? 0.75 : 0.45}"
          stroke="${isSelected ? '#F4902C' : '#4A9EFF'}"
          stroke-width="${isSelected ? 3 : 1.5}"
          style="cursor: pointer; transition: all 0.2s ease;"
        />
        <!-- Architectural / Acoustic Isolation Wall Boundary -->
        <polygon points="${ptsStr}"
          fill="none"
          stroke="#0f0f11"
          stroke-width="${showAcoustics ? '7' : '5'}"
          stroke-linejoin="round"
          stroke-opacity="0.85"
        />
        <polygon points="${ptsStr}"
          fill="none"
          stroke="${isSelected ? '#F4902C' : (showAcoustics ? '#8B5CF6' : '#3f3f46')}"
          stroke-width="1.5"
          stroke-linejoin="round"
        />
        <text x="${cx}" y="${ly - (showAcoustics ? 12 : 8)}" text-anchor="middle" font-family="-apple-system, sans-serif" font-size="13" font-weight="700" fill="#f4f4f5" pointer-events="none">${esc(room.name)}</text>
        <text x="${cx}" y="${ly + (showAcoustics ? 4 : 10)}" text-anchor="middle" font-family="-apple-system, sans-serif" font-size="10" font-weight="600" fill="#888888" pointer-events="none">
          ${acoustics?.roomType ? esc(acoustics.roomType) + ' · ' : ''}${area} m² (${Math.round(area * 10.764)} sq ft)
        </text>
        ${acousticOverlays}
      </g>
    `;
  }).join('');

  // Drops
  const dropsSvg = model.drops.map((drop) => {
    const isSelected = drop.id === selectedDropId;
    const cat = DROP_CATEGORIES[drop.category] || DROP_CATEGORIES.DATA;
    const px = drop.x * ppm;
    const py = drop.y * ppm;

    return `
      <g class="drop-marker" data-drop-id="${esc(drop.id)}" transform="translate(${px}, ${py})" style="cursor: pointer;">
        <!-- Halo selection circle -->
        ${isSelected ? `<circle r="18" fill="none" stroke="#F4902C" stroke-width="2" stroke-dasharray="3,3"/>` : ''}
        <circle r="13" fill="#18181b" stroke="${cat.color}" stroke-width="${isSelected ? 2.5 : 1.5}" filter="drop-shadow(0 2px 4px rgba(0,0,0,0.6))"/>
        <text y="4" text-anchor="middle" font-size="12" pointer-events="none">${cat.icon}</text>
        <rect x="16" y="-9" width="${drop.refdes.length * 7 + 10}" height="18" rx="3" fill="#121212" stroke="#2c2c2c" stroke-width="1" opacity="0.9"/>
        <text x="21" y="3.5" font-family="'JetBrains Mono', monospace" font-size="9" font-weight="600" fill="${cat.color}">${esc(drop.refdes)}</text>
      </g>
    `;
  }).join('');

  // Architectural Scale Bar
  let scaleSvg = '';
  if (showScale) {
    const scaleLenMeters = 5;
    const scalePx = scaleLenMeters * ppm;
    const sx = 20;
    const sy = heightPx - 30;

    scaleSvg = `
      <g class="scale-bar" transform="translate(${sx}, ${sy})">
        <rect x="0" y="-14" width="${scalePx + 80}" height="28" rx="4" fill="#0f0f11" stroke="#2c2c2c" stroke-width="1" opacity="0.9"/>
        <line x1="10" y1="4" x2="${10 + scalePx}" y2="4" stroke="#f4f4f5" stroke-width="2"/>
        <line x1="10" y1="0" x2="10" y2="8" stroke="#f4f4f5" stroke-width="2"/>
        <line x1="${10 + scalePx / 2}" y1="2" x2="${10 + scalePx / 2}" y2="6" stroke="#f4f4f5" stroke-width="1.5"/>
        <line x1="${10 + scalePx}" y1="0" x2="${10 + scalePx}" y2="8" stroke="#f4f4f5" stroke-width="2"/>
        <text x="10" y="-2" font-family="'JetBrains Mono', monospace" font-size="8" fill="#888888">0</text>
        <text x="${10 + scalePx / 2}" y="-2" text-anchor="middle" font-family="'JetBrains Mono', monospace" font-size="8" fill="#888888">2500</text>
        <text x="${10 + scalePx}" y="-2" text-anchor="middle" font-family="'JetBrains Mono', monospace" font-size="8" fill="#888888">5000 mm (1:100)</text>
      </g>
    `;
  }

  return `
    <svg id="floorplan-canvas-svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}" xmlns="http://www.w3.org/2000/svg">
      ${gridSvg}
      ${floorTabsSvg}
      ${roomsSvg}
      ${dropsSvg}
      ${scaleSvg}
    </svg>
  `;
}
