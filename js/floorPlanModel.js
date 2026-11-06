// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.

export const DROP_CATEGORIES = {
  AUDIO: { label: 'Audio Drop', icon: '🎤', color: '#4A9EFF' },
  VIDEO: { label: 'Video Display / Feed', icon: '📺', color: '#F4902C' },
  DATA: { label: 'Network Data Port', icon: '🌐', color: '#10B981' },
  SPEAKER: { label: 'Ceiling / Wall Speaker', icon: '🔊', color: '#A855F7' },
  MIC: { label: 'Ceiling Array Mic', icon: '🎙️', color: '#EC4899' },
  POWER: { label: 'Floor Box / AC Duplex', icon: '⚡', color: '#F59E0B' },
  ACOUSTIC_PANEL: { label: 'Acoustic Absorber / Cloud', icon: '🛡️', color: '#8B5CF6' },
  DIFFUSER: { label: 'Acoustic Diffuser / Grid', icon: '〰️', color: '#06B6D4' },
  ACOUSTIC_MIC: { label: 'Measurement / RTA Mic', icon: '📡', color: '#14B8A6' },
};

/** The drop kind a BIM part is drawn as (📚 Library, ROAD-3572): by its category and class. */
export function categoryForPart(bim = {}) {
  const c = `${bim.category || ''} ${bim.class || ''}`.toLowerCase();
  if (/microphone|\bmic/.test(c)) return 'MIC';
  if (/speaker|loudspeaker|monitor/.test(c)) return 'SPEAKER';
  if (/acoustic/.test(c)) return 'ACOUSTIC_PANEL';
  if (/video|display/.test(c)) return 'VIDEO';
  if (/power/.test(c)) return 'POWER';
  if (/audio/.test(c)) return 'AUDIO';
  return 'DATA';
}

/**
 * Lengths on screen are millimetres (every CAD dimension is in mm); the block
 * keeps metres, as every saved plan, polygon and GeoJSON export already does.
 * These two convert at the UI edge only.
 */
export function metresToMm(m) {
  return Math.round((Number(m) || 0) * 1000);
}

/** A typed mm value back to the block's metres; blank / junk is 0. */
export function mmToMetres(mm) {
  const n = parseFloat(mm);
  return Number.isFinite(n) ? n / 1000 : 0;
}

/**
 * Computes polygon perimeter in meters
 */
export function calculatePolygonPerimeter(points) {
  if (!points || points.length < 2) return 0;
  let total = 0;
  for (let i = 0, l = points.length; i < l; i++) {
    const p1 = points[i];
    const p2 = points[i === points.length - 1 ? 0 : i + 1];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    total += Math.sqrt(dx * dx + dy * dy);
  }
  return total;
}

/**
 * Computes acoustic space metrics for a room using Sabine formula and wave-cutoff Schroeder frequency.
 * Volume V = Area * Height
 * Surface Area A_total = 2 * Area + Perimeter * Height
 * RT60 = 0.161 * V / (A_total * mean_alpha)
 * Schroeder frequency fs = 2000 * sqrt(RT60 / V)
 */
export const UNCLASSIFIED = 'Unclassified';

/**
 * Design defaults per room type: mean absorption coefficient (ᾱ), target
 * RT60 (s) and NC rating. A room picks one by its `roomType`, exactly; any of
 * the three can be overridden on the room itself.
 */
export const ROOM_TYPE_PRESETS = Object.freeze({
  'Control Room (LEDE)': { meanAbsorption: 0.28, target_rt60: 0.24, nc_rating: 20 },
  'Iso Booth': { meanAbsorption: 0.36, target_rt60: 0.18, nc_rating: 15 },
  'Live Studio': { meanAbsorption: 0.20, target_rt60: 0.55, nc_rating: 22 },
  'Equipment / Machine Room': { meanAbsorption: 0.08, target_rt60: 0.80, nc_rating: 45 },
  'Production Space': { meanAbsorption: 0.18, target_rt60: 0.80, nc_rating: 45 },
  [UNCLASSIFIED]: { meanAbsorption: 0.18, target_rt60: 0.80, nc_rating: 45 },
});

export function calculateRoomAcoustics(room) {
  if (!room || !room.polygon || room.polygon.length < 3) return null;
  const area_m2 = calculatePolygonArea(room.polygon);
  const perimeter_m = calculatePolygonPerimeter(room.polygon);
  const height_m = room.ceilingHeight_m || 3.2;
  const volume_m3 = Math.round(area_m2 * height_m * 10) / 10;
  const surfaceArea_m2 = Math.round((2 * area_m2 + perimeter_m * height_m) * 10) / 10;

  // The type is the room's own field, never guessed from its name: "Studio
  // B storage" is not a live room. No type → Unclassified, said on the plan.
  const roomType = room.roomType || UNCLASSIFIED;
  const preset = ROOM_TYPE_PRESETS[roomType] || ROOM_TYPE_PRESETS[UNCLASSIFIED];
  const meanAbsorption = room.meanAbsorption ?? preset.meanAbsorption;
  const target_rt60 = room.target_rt60 ?? preset.target_rt60;

  const totalAbsorptionArea = Math.max(0.1, surfaceArea_m2 * meanAbsorption);
  const rt60_estimated = Math.round((0.161 * volume_m3 / totalAbsorptionArea) * 100) / 100;
  const schroeder_freq_hz = volume_m3 > 0 ? Math.round(2000 * Math.sqrt(rt60_estimated / volume_m3)) : 100;
  
  const nc_rating = room.nc_rating ?? preset.nc_rating;

  return {
    roomType,
    classified: roomType in ROOM_TYPE_PRESETS && roomType !== UNCLASSIFIED,
    area_m2: Math.round(area_m2 * 10) / 10,
    perimeter_m: Math.round(perimeter_m * 10) / 10,
    height_m,
    volume_m3,
    surfaceArea_m2,
    meanAbsorption,
    rt60_estimated,
    target_rt60,
    schroeder_freq_hz,
    nc_rating,
  };
}

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

export const DEFAULT_FLOORS = [
  {
    id: 'floor_1',
    name: 'Ground Floor (Live & Control Suites)',
    level: 1,
    rooms: [
      {
        id: 'room_1',
        name: 'Control Room A',
        color: '#2c2c2c',
        ceilingHeight_m: 3.5,
        roomType: 'Control Room (LEDE)',
        meanAbsorption: 0.28,
        target_rt60: 0.24,
        nc_rating: 20,
        mixPosition: { x: 7, y: 6 },
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
        ceilingHeight_m: 4.5,
        roomType: 'Live Studio',
        meanAbsorption: 0.20,
        target_rt60: 0.55,
        nc_rating: 22,
        mixPosition: { x: 20, y: 7 },
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
        ceilingHeight_m: 3.0,
        roomType: 'Equipment / Machine Room',
        meanAbsorption: 0.08,
        target_rt60: 0.85,
        nc_rating: 45,
        polygon: [
          { x: 2, y: 12 },
          { x: 12, y: 12 },
          { x: 12, y: 18 },
          { x: 2, y: 18 },
        ],
      },
    ],
    drops: [
      { id: 'dp_1', refdes: 'CR-D01', label: 'Console Workstation', category: 'DATA', x: 7, y: 6, room: 'Control Room A', circuit: 'EP-1 CKT 12' },
      { id: 'dp_2', refdes: 'CR-V01', label: 'Multiviewer Display', category: 'VIDEO', x: 11, y: 6, room: 'Control Room A', circuit: 'EP-1 CKT 14' },
      { id: 'dp_3', refdes: 'CR-S01', label: 'Monitor Left', category: 'SPEAKER', x: 4, y: 3, room: 'Control Room A', circuit: 'EP-1 CKT 12' },
      { id: 'dp_4', refdes: 'CR-S02', label: 'Monitor Right', category: 'SPEAKER', x: 10, y: 3, room: 'Control Room A', circuit: 'EP-1 CKT 12' },
      { id: 'dp_5', refdes: 'ST-M01', label: 'Drum Mic Drop Box', category: 'AUDIO', x: 20, y: 7, room: 'Audio Studio A', circuit: 'EP-2 CKT 04' },
      { id: 'dp_6', refdes: 'ST-C01', label: 'Ceiling Array Mic', category: 'MIC', x: 18, y: 5, room: 'Audio Studio A', circuit: 'POE-SWITCH-1' },
      { id: 'dp_7', refdes: 'RK-P01', label: 'Central Rack Feed', category: 'POWER', x: 7, y: 15, room: 'Rack Equipment Room', circuit: 'PANEL-A 208V' },
    ],
  },
  {
    id: 'floor_2',
    name: 'Upper Level (Mezzanine & Iso Suites)',
    level: 2,
    rooms: [
      {
        id: 'room_4',
        name: 'Vocal Iso Booth B',
        color: '#261C2C',
        ceilingHeight_m: 2.8,
        roomType: 'Iso Booth',
        meanAbsorption: 0.36,
        target_rt60: 0.18,
        nc_rating: 15,
        mixPosition: { x: 5.5, y: 5.5 },
        polygon: [
          { x: 3, y: 3 },
          { x: 8, y: 3 },
          { x: 8, y: 8 },
          { x: 3, y: 8 },
        ],
      },
      {
        id: 'room_5',
        name: 'Mastering Suite',
        color: '#1D2A44',
        ceilingHeight_m: 3.2,
        roomType: 'Control Room (LEDE)',
        meanAbsorption: 0.30,
        target_rt60: 0.22,
        nc_rating: 18,
        mixPosition: { x: 18, y: 8 },
        polygon: [
          { x: 12, y: 3 },
          { x: 24, y: 3 },
          { x: 24, y: 13 },
          { x: 12, y: 13 },
        ],
      },
    ],
    drops: [
      { id: 'dp_8', refdes: 'ISO-M01', label: 'Vocal Mic Drop', category: 'MIC', x: 5.5, y: 5.5, room: 'Vocal Iso Booth B', circuit: 'ISO-PANEL-1' },
      { id: 'dp_9', refdes: 'MAS-S01', label: 'Mastering Nearfield L', category: 'SPEAKER', x: 16, y: 6, room: 'Mastering Suite', circuit: 'CLEAN-PWR-1' },
      { id: 'dp_10', refdes: 'MAS-S02', label: 'Mastering Nearfield R', category: 'SPEAKER', x: 20, y: 6, room: 'Mastering Suite', circuit: 'CLEAN-PWR-1' },
    ],
  },
];

export class FloorPlanModel {
  constructor(initialData = null) {
    this.id = initialData?.id || `plan_${Date.now()}`;
    this.name = initialData?.name || 'Main Production Facility';
    this.scaleRatio = initialData?.scaleRatio || 100; // 1:100 (1m = 10mm on print / 40px on screen)
    this.pixelsPerMeter = initialData?.pixelsPerMeter || 40;
    this.width_m = initialData?.width_m || 30; // 30 meters wide
    this.height_m = initialData?.height_m || 20; // 20 meters tall

    if (initialData?.floors && Array.isArray(initialData.floors)) {
      this.floors = initialData.floors;
    } else {
      this.floors = JSON.parse(JSON.stringify(DEFAULT_FLOORS));
      if (initialData?.rooms) {
        this.floors[0].rooms = initialData.rooms;
      }
      if (initialData?.drops) {
        this.floors[0].drops = initialData.drops;
      }
    }

    this.activeFloorId = initialData?.activeFloorId || this.floors[0].id;
    this.selectedRoomId = null;
    this.selectedDropId = null;
    this._dropCounter = 11;
  }

  get activeFloor() {
    return this.floors.find((f) => f.id === this.activeFloorId) || this.floors[0];
  }

  get rooms() {
    return this.activeFloor.rooms;
  }

  set rooms(val) {
    this.activeFloor.rooms = val;
  }

  get drops() {
    return this.activeFloor.drops;
  }

  set drops(val) {
    this.activeFloor.drops = val;
  }

  switchFloor(floorId) {
    if (this.floors.some((f) => f.id === floorId)) {
      this.activeFloorId = floorId;
      this.selectedRoomId = null;
      this.selectedDropId = null;
      return true;
    }
    return false;
  }

  addFloor(floor) {
    const id = floor.id || `floor_${this.floors.length + 1}`;
    const newFloor = {
      id,
      name: floor.name || `Floor Level ${this.floors.length + 1}`,
      level: floor.level || this.floors.length + 1,
      rooms: floor.rooms || [],
      drops: floor.drops || [],
    };
    this.floors.push(newFloor);
    return newFloor;
  }

  getRoomAcoustics(roomId) {
    const r = this.rooms.find((rm) => rm.id === roomId);
    return calculateRoomAcoustics(r);
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
    // a device placed from the BIM library keeps its part and BIM reference (ROAD-3572)
    if (drop.bimId) newDrop.bimId = String(drop.bimId);
    if (drop.bimRef && drop.bimRef.part) newDrop.bimRef = { ...drop.bimRef };
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
            acoustics: calculateRoomAcoustics(r),
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
      activeFloorId: this.activeFloorId,
      floors: this.floors,
      rooms: this.rooms,
      drops: this.drops,
    };
  }
}
