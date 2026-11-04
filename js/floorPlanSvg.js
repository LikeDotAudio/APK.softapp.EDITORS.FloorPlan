// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.

import { calculatePolygonArea, DROP_CATEGORIES } from './floorPlanModel.js';

export function renderFloorPlanSvg(model, options = {}) {
  const { ppm = model.pixelsPerMeter || 40, showGrid = true, showScale = true, selectedDropId = null, selectedRoomId = null } = options;
  const widthPx = model.width_m * ppm;
  const heightPx = model.height_m * ppm;

  // Background and Grid
  let gridSvg = '';
  if (showGrid) {
    gridSvg = `
      <defs>
        <pattern id="grid-minor" width="${ppm / 2}" height="${ppm / 2}" patternUnits="userSpaceOnUse">
          <path d="M ${ppm / 2} 0 L 0 0 0 ${ppm / 2}" fill="none" stroke="#121A2F" stroke-width="0.5"/>
        </pattern>
        <pattern id="grid-major" width="${ppm}" height="${ppm}" patternUnits="userSpaceOnUse">
          <rect width="${ppm}" height="${ppm}" fill="url(#grid-minor)"/>
          <path d="M ${ppm} 0 L 0 0 0 ${ppm}" fill="none" stroke="#1E2A45" stroke-width="1"/>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="#080C16"/>
      <rect width="100%" height="100%" fill="url(#grid-major)"/>
    `;
  } else {
    gridSvg = `<rect width="100%" height="100%" fill="#080C16"/>`;
  }

  // Rooms
  const roomsSvg = model.rooms.map((room) => {
    const isSelected = room.id === selectedRoomId;
    const ptsStr = room.polygon.map((p) => `${p.x * ppm},${p.y * ppm}`).join(' ');
    const area = Math.round(calculatePolygonArea(room.polygon) * 10) / 10;
    
    // Find polygon centroid for label
    const cx = (room.polygon.reduce((acc, p) => acc + p.x, 0) / room.polygon.length) * ppm;
    const cy = (room.polygon.reduce((acc, p) => acc + p.y, 0) / room.polygon.length) * ppm;

    return `
      <g class="room-group" data-room-id="${room.id}">
        <polygon points="${ptsStr}"
          fill="${room.color || '#121A2F'}"
          fill-opacity="${isSelected ? 0.75 : 0.45}"
          stroke="${isSelected ? '#F4902C' : '#4A9EFF'}"
          stroke-width="${isSelected ? 3 : 1.5}"
          stroke-dasharray="${isSelected ? 'none' : 'none'}"
          style="cursor: pointer; transition: all 0.2s ease;"
        />
        <!-- Inner architectural double-line wall -->
        <polygon points="${ptsStr}"
          fill="none"
          stroke="#0E1424"
          stroke-width="5"
          stroke-linejoin="round"
          stroke-opacity="0.8"
        />
        <polygon points="${ptsStr}"
          fill="none"
          stroke="${isSelected ? '#F4902C' : '#2D3D60'}"
          stroke-width="1.5"
          stroke-linejoin="round"
        />
        <text x="${cx}" y="${cy - 8}" text-anchor="middle" font-family="-apple-system, sans-serif" font-size="13" font-weight="700" fill="#F0F4F8" pointer-events="none">${room.name}</text>
        <text x="${cx}" y="${cy + 10}" text-anchor="middle" font-family="-apple-system, sans-serif" font-size="10" font-weight="600" fill="#8B9BB4" pointer-events="none">${area} m² (${Math.round(area * 10.764)} sq ft)</text>
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
      <g class="drop-marker" data-drop-id="${drop.id}" transform="translate(${px}, ${py})" style="cursor: pointer;">
        <!-- Halo selection circle -->
        ${isSelected ? `<circle r="18" fill="none" stroke="#F4902C" stroke-width="2" stroke-dasharray="3,3"/>` : ''}
        <circle r="13" fill="#121A2F" stroke="${cat.color}" stroke-width="${isSelected ? 2.5 : 1.5}" filter="drop-shadow(0 2px 4px rgba(0,0,0,0.6))"/>
        <text y="4" text-anchor="middle" font-size="12" pointer-events="none">${cat.icon}</text>
        <rect x="16" y="-9" width="${drop.refdes.length * 7 + 10}" height="18" rx="3" fill="#080C16" stroke="#1E2A45" stroke-width="1" opacity="0.9"/>
        <text x="21" y="3.5" font-family="'JetBrains Mono', monospace" font-size="9" font-weight="600" fill="${cat.color}">${drop.refdes}</text>
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
        <rect x="0" y="-14" width="${scalePx + 40}" height="28" rx="4" fill="#0E1424" stroke="#1E2A45" stroke-width="1" opacity="0.9"/>
        <line x1="10" y1="4" x2="${10 + scalePx}" y2="4" stroke="#F0F4F8" stroke-width="2"/>
        <line x1="10" y1="0" x2="10" y2="8" stroke="#F0F4F8" stroke-width="2"/>
        <line x1="${10 + scalePx / 2}" y1="2" x2="${10 + scalePx / 2}" y2="6" stroke="#F0F4F8" stroke-width="1.5"/>
        <line x1="${10 + scalePx}" y1="0" x2="${10 + scalePx}" y2="8" stroke="#F0F4F8" stroke-width="2"/>
        <text x="10" y="-2" font-family="'JetBrains Mono', monospace" font-size="8" fill="#8B9BB4">0m</text>
        <text x="${10 + scalePx / 2}" y="-2" text-anchor="middle" font-family="'JetBrains Mono', monospace" font-size="8" fill="#8B9BB4">2.5m</text>
        <text x="${10 + scalePx}" y="-2" text-anchor="middle" font-family="'JetBrains Mono', monospace" font-size="8" fill="#8B9BB4">5m (1:100)</text>
      </g>
    `;
  }

  return `
    <svg id="floorplan-canvas-svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}" xmlns="http://www.w3.org/2000/svg">
      ${gridSvg}
      ${roomsSvg}
      ${dropsSvg}
      ${scaleSvg}
    </svg>
  `;
}
