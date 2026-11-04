// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.

export const DROP_CATEGORIES = {
  AUDIO: { label: 'Audio Drop', icon: '🎤', color: '#4A9EFF' },
  VIDEO: { label: 'Video Display / Feed', icon: '📺', color: '#F4902C' },
  DATA: { label: 'Network Data Port', icon: '🌐', color: '#10B981' },
  SPEAKER: { label: 'Ceiling / Wall Speaker', icon: '🔊', color: '#A855F7' },
  MIC: { label: 'Ceiling Array Mic', icon: '🎙️', color: '#EC4899' },
  POWER: { label: 'Floor Box / AC Duplex', icon: '⚡', color: '#F59E0B' },
};

/**
 * Computes polygon area in square meters using Shoelace formula
 */
export function calculatePolygonArea(points) {
  if (!points || points.length < 3) return 0;
  let total = 0;
  for (let i = 0, l = points.length; i < l; i++) {
    const addX = points[i].x;
    const addY = points[i === points.length - 1 ? 0 : i + 1].y;
    const subX = points[i === points.length - 1 ? 0 : i + 1].x;
    const subY = points[i].y;
    total += (addX * addY * 0.5) - (subX * subY * 0.5);
  }
  return Math.abs(total);
}

/**
 * Tests if point (x, y) is inside polygon
 */
export function isPointInPolygon(pt, polygon) {
  if (!polygon || polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect = ((yi > pt.y) !== (yj > pt.y)) &&
      (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

export class FloorPlanModel {
  constructor(initialData = null) {
    this.id = initialData?.id || `plan_${Date.now()}`;
    this.name = initialData?.name || 'Main Production Floor';
    this.scaleRatio = initialData?.scaleRatio || 100; // 1:100 (1m = 10mm on print / 40px on screen)
    this.pixelsPerMeter = initialData?.pixelsPerMeter || 40;
    this.width_m = initialData?.width_m || 30; // 30 meters wide
    this.height_m = initialData?.height_m || 20; // 20 meters tall

    this.rooms = initialData?.rooms || [
      {
        id: 'room_1',
        name: 'Control Room A',
        color: '#1E2A45',
        polygon: [
          { x: 2, y: 2 },
          { x: 12, y: 2 },
          { x: 12, y: 10 },
          { x: 2, y: 10 },
        ],
      },
      {
        id: 'room_2',
        name: 'Audio Studio A',
        color: '#1A2F2B',
        polygon: [
          { x: 14, y: 2 },
          { x: 26, y: 2 },
          { x: 26, y: 12 },
          { x: 14, y: 12 },
        ],
      },
      {
        id: 'room_3',
        name: 'Rack Equipment Room',
        color: '#36231E',
        polygon: [
          { x: 2, y: 12 },
          { x: 12, y: 12 },
          { x: 12, y: 18 },
          { x: 2, y: 18 },
        ],
      },
    ];

    this.drops = initialData?.drops || [
      { id: 'dp_1', refdes: 'CR-D01', label: 'Console Workstation', category: 'DATA', x: 7, y: 6, room: 'Control Room A', circuit: 'EP-1 CKT 12' },
      { id: 'dp_2', refdes: 'CR-V01', label: 'Multiviewer Display', category: 'VIDEO', x: 11, y: 6, room: 'Control Room A', circuit: 'EP-1 CKT 14' },
      { id: 'dp_3', refdes: 'CR-S01', label: 'Monitor Left', category: 'SPEAKER', x: 4, y: 3, room: 'Control Room A', circuit: 'EP-1 CKT 12' },
      { id: 'dp_4', refdes: 'CR-S02', label: 'Monitor Right', category: 'SPEAKER', x: 10, y: 3, room: 'Control Room A', circuit: 'EP-1 CKT 12' },
      { id: 'dp_5', refdes: 'ST-M01', label: 'Drum Mic Drop Box', category: 'AUDIO', x: 20, y: 7, room: 'Audio Studio A', circuit: 'EP-2 CKT 04' },
      { id: 'dp_6', refdes: 'ST-C01', label: 'Ceiling Array Mic', category: 'MIC', x: 18, y: 5, room: 'Audio Studio A', circuit: 'POE-SWITCH-1' },
      { id: 'dp_7', refdes: 'RK-P01', label: 'Central Rack Feed', category: 'POWER', x: 7, y: 15, room: 'Rack Equipment Room', circuit: 'PANEL-A 208V' },
    ];

    this.selectedRoomId = null;
    this.selectedDropId = null;
    this._dropCounter = this.drops.length + 1;
  }

  addRoom(room) {
    const id = room.id || `room_${Date.now()}`;
    const newRoom = { ...room, id };
    this.rooms.push(newRoom);
    return newRoom;
  }

  addDrop(drop) {
    const id = drop.id || `dp_${this._dropCounter++}`;
    const newDrop = {
      id,
      refdes: drop.refdes || `DP-${this._dropCounter}`,
      label: drop.label || 'New Drop',
      category: drop.category || 'DATA',
      x: Math.max(0, Math.min(this.width_m, drop.x || 5)),
      y: Math.max(0, Math.min(this.height_m, drop.y || 5)),
      room: this.resolveRoomAt(drop.x || 5, drop.y || 5),
      circuit: drop.circuit || 'UNASSIGNED',
    };
    this.drops.push(newDrop);
    return newDrop;
  }

  updateDrop(id, updates) {
    const drop = this.drops.find((d) => d.id === id);
    if (!drop) return null;
    Object.assign(drop, updates);
    if (updates.x !== undefined || updates.y !== undefined) {
      drop.room = this.resolveRoomAt(drop.x, drop.y);
    }
    return drop;
  }

  deleteDrop(id) {
    const idx = this.drops.findIndex((d) => d.id === id);
    if (idx !== -1) {
      this.drops.splice(idx, 1);
      if (this.selectedDropId === id) this.selectedDropId = null;
      return true;
    }
    return false;
  }

  resolveRoomAt(x, y) {
    const pt = { x, y };
    for (const r of this.rooms) {
      if (isPointInPolygon(pt, r.polygon)) {
        return r.name;
      }
    }
    return 'Hallway / Common';
  }

  getRoomArea(roomId) {
    const r = this.rooms.find((rm) => rm.id === roomId);
    if (!r) return 0;
    return calculatePolygonArea(r.polygon);
  }

  getMetrics() {
    const totalAreaSqm = this.rooms.reduce((acc, r) => acc + calculatePolygonArea(r.polygon), 0);
    const dropCount = this.drops.length;
    const categoryCounts = {};
    for (const d of this.drops) {
      categoryCounts[d.category] = (categoryCounts[d.category] || 0) + 1;
    }
    return {
      totalAreaSqm: Math.round(totalAreaSqm * 10) / 10,
      dropCount,
      categoryCounts,
      roomCount: this.rooms.length,
    };
  }

  toGeoJson() {
    return {
      type: 'FeatureCollection',
      features: [
        ...this.rooms.map((r) => ({
          type: 'Feature',
          properties: {
            id: r.id,
            name: r.name,
            kind: 'room',
            area_sqm: calculatePolygonArea(r.polygon),
          },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [...r.polygon.map((p) => [p.x, p.y]), [r.polygon[0].x, r.polygon[0].y]],
            ],
          },
        })),
        ...this.drops.map((d) => ({
          type: 'Feature',
          properties: {
            id: d.id,
            refdes: d.refdes,
            label: d.label,
            category: d.category,
            room: d.room,
            circuit: d.circuit,
          },
          geometry: {
            type: 'Point',
            coordinates: [d.x, d.y],
          },
        })),
      ],
    };
  }

  toJSON() {
    return {
      type: 'floorplan',
      id: this.id,
      name: this.name,
      scaleRatio: this.scaleRatio,
      pixelsPerMeter: this.pixelsPerMeter,
      width_m: this.width_m,
      height_m: this.height_m,
      rooms: this.rooms,
      drops: this.drops,
    };
  }
}
