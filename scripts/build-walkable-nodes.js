#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const turf = require('@turf/turf');

const PROJECT_ROOT = path.join(__dirname, '..');

const resolveDir = (input) => (input ? path.resolve(input) : null);

const getFirstExistingDir = (candidates) => {
  for (const dir of candidates) {
    if (dir && fs.existsSync(dir)) {
      return dir;
    }
  }
  return null;
};

const DATA_DIR = resolveDir(process.env.MVF_SRC_DIR) || getFirstExistingDir([
  path.join(PROJECT_ROOT, 'temp_mvf'),
  path.join(PROJECT_ROOT, 'data_map'),
  path.join(PROJECT_ROOT, '..', 'data_map')
]);

const ASSET_DIR = resolveDir(process.env.MVF_DST_DIR) || path.join(PROJECT_ROOT, 'assets');
const GEOMETRY_DIR = path.join(DATA_DIR, 'geometry');
const WALKABLE_DIR = path.join(DATA_DIR, 'walkable');
const KINDS_DIR = path.join(DATA_DIR, 'kinds');
const NONWALKABLE_DIR = path.join(DATA_DIR, 'nonwalkable');
const CONNECTIONS_PATH = path.join(DATA_DIR, 'connections.json');

const args = new Set(process.argv.slice(2));
const getNumberArg = (name, fallback) => {
  const arg = process.argv.find(item => item.startsWith(`${name}=`));
  if (!arg) return fallback;
  const raw = arg.split('=')[1];
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
};

const gridMeters = getNumberArg('--grid', null);
const buildAreas = args.has('--areas');
const sharedClearance = getNumberArg('--clearance', null);
const wallClearance = getNumberArg('--wall-clearance', sharedClearance ?? 0.6);
const objectClearance = getNumberArg('--object-clearance', sharedClearance ?? 0.4);
const nonwalkableClearance = getNumberArg('--nonwalkable-clearance', sharedClearance ?? 0.4);
const doorClearance = getNumberArg('--door-clearance', 1.0);
const walkableInset = getNumberArg('--walkable-inset', 0);

if (!DATA_DIR) {
  console.error('Missing MVF source directory. Set MVF_SRC_DIR or create temp_mvf/data_map.');
  process.exit(1);
}

if (!fs.existsSync(GEOMETRY_DIR) || !fs.existsSync(WALKABLE_DIR)) {
  console.error(`Missing geometry or walkable directories under ${DATA_DIR}`);
  process.exit(1);
}

if (!fs.existsSync(ASSET_DIR)) {
  fs.mkdirSync(ASSET_DIR, { recursive: true });
}

const geometryFiles = fs.readdirSync(GEOMETRY_DIR).filter(file => file.endsWith('.geojson'));
const geometryByFloor = new Map();
const geometryLookup = new Map();

geometryFiles.forEach(file => {
  const floorId = file.replace('.geojson', '');
  const fullPath = path.join(GEOMETRY_DIR, file);
  const geojson = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  geometryByFloor.set(floorId, geojson.features || []);

  const floorMap = new Map();
  (geojson.features || []).forEach(feature => {
    const id = feature?.properties?.id;
    if (id) {
      floorMap.set(id, feature);
      geometryLookup.set(id, feature);
    }
  });
  geometryByFloor.set(`${floorId}-map`, floorMap);
});

const loadLookupByFloor = (dir) => {
  const lookup = new Map();
  if (!fs.existsSync(dir)) return lookup;
  const files = fs.readdirSync(dir).filter(file => file.endsWith('.json'));
  files.forEach(file => {
    const floorId = file.replace('.json', '');
    const fullPath = path.join(dir, file);
    const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    lookup.set(floorId, data);
  });
  return lookup;
};

const kindsByFloor = loadLookupByFloor(KINDS_DIR);
const nonwalkableByFloor = loadLookupByFloor(NONWALKABLE_DIR);
const connections = fs.existsSync(CONNECTIONS_PATH)
  ? JSON.parse(fs.readFileSync(CONNECTIONS_PATH, 'utf8'))
  : [];

const doorFeaturesByFloor = new Map();
const addDoorFeature = (floorId, geometryId) => {
  if (!floorId || !geometryId) return;
  const floorMap = geometryByFloor.get(`${floorId}-map`) || new Map();
  const feature = floorMap.get(geometryId) || geometryLookup.get(geometryId);
  if (!feature) return;
  if (!doorFeaturesByFloor.has(floorId)) {
    doorFeaturesByFloor.set(floorId, []);
  }
  doorFeaturesByFloor.get(floorId).push(feature);
};

connections.forEach(conn => {
  if (conn.type !== 'door') return;
  (conn.entrances || []).forEach(entry => {
    addDoorFeature(entry.floorId, entry.geometryId);
  });
});

const obstacleSpecsByFloor = new Map();
const obstaclePriority = { wall: 3, object: 2, nonwalkable: 1 };

const addObstacleSpec = (floorId, geometryId, type, clearance) => {
  if (!floorId || !geometryId) return;
  if (!Number.isFinite(clearance) || clearance <= 0) return;
  if (!obstacleSpecsByFloor.has(floorId)) {
    obstacleSpecsByFloor.set(floorId, new Map());
  }

  const floorSpecs = obstacleSpecsByFloor.get(floorId);
  const existing = floorSpecs.get(geometryId);
  if (!existing) {
    floorSpecs.set(geometryId, { type, clearance });
    return;
  }

  existing.clearance = Math.max(existing.clearance, clearance);
  if (obstaclePriority[type] > obstaclePriority[existing.type]) {
    existing.type = type;
  }
};

kindsByFloor.forEach((kindMap, floorId) => {
  Object.entries(kindMap).forEach(([geometryId, kind]) => {
    if (kind === 'wall') {
      addObstacleSpec(floorId, geometryId, 'wall', wallClearance);
    } else if (kind === 'object') {
      addObstacleSpec(floorId, geometryId, 'object', objectClearance);
    }
  });
});

nonwalkableByFloor.forEach((nonwalkableMap, floorId) => {
  Object.keys(nonwalkableMap).forEach(geometryId => {
    addObstacleSpec(floorId, geometryId, 'nonwalkable', nonwalkableClearance);
  });
});

const bufferFeature = (feature, meters) => {
  if (!feature?.geometry) return null;
  if (!Number.isFinite(meters) || meters === 0) {
    if (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon') {
      return feature;
    }
    return null;
  }
  try {
    const buffered = turf.buffer(feature, meters, { units: 'meters' });
    if (!buffered?.geometry) return null;
    if (buffered.geometry.type === 'Polygon' || buffered.geometry.type === 'MultiPolygon') {
      return buffered;
    }
  } catch (e) {
    return null;
  }
  return null;
};

const obstacleIndexByFloor = new Map();
obstacleSpecsByFloor.forEach((specMap, floorId) => {
  const floorMap = geometryByFloor.get(`${floorId}-map`) || new Map();
  const obstacles = [];
  specMap.forEach((spec, geometryId) => {
    const feature = floorMap.get(geometryId) || geometryLookup.get(geometryId);
    if (!feature) return;
    const buffer = bufferFeature(feature, spec.clearance);
    if (!buffer) return;
    obstacles.push({
      geometryId,
      type: spec.type,
      buffer,
      bbox: turf.bbox(buffer)
    });
  });
  if (obstacles.length) {
    obstacleIndexByFloor.set(floorId, obstacles);
  }
});

const distanceToFeature = (point, feature) => {
  const geometry = feature?.geometry;
  if (!geometry) return Infinity;
  try {
    if (geometry.type === 'LineString' || geometry.type === 'MultiLineString') {
      return turf.pointToLineDistance(point, feature, { units: 'meters' });
    }
    if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') {
      const outline = turf.polygonToLine(feature);
      return turf.pointToLineDistance(point, outline, { units: 'meters' });
    }
    if (geometry.type === 'Point') {
      return turf.distance(point, feature, { units: 'meters' });
    }
  } catch (e) {
    return Infinity;
  }
  return Infinity;
};

const isNearDoor = (point, floorId) => {
  if (!Number.isFinite(doorClearance) || doorClearance <= 0) return false;
  const doors = doorFeaturesByFloor.get(floorId);
  if (!doors || doors.length === 0) return false;
  return doors.some(door => distanceToFeature(point, door) <= doorClearance);
};

const isPointBlocked = (point, floorId) => {
  const obstacles = obstacleIndexByFloor.get(floorId);
  if (!obstacles || obstacles.length === 0) return false;
  const [lng, lat] = point.geometry.coordinates;

  for (const obstacle of obstacles) {
    const [minX, minY, maxX, maxY] = obstacle.bbox;
    if (lng < minX || lng > maxX || lat < minY || lat > maxY) {
      continue;
    }
    if (turf.booleanPointInPolygon(point, obstacle.buffer)) {
      if (obstacle.type === 'wall' && isNearDoor(point, floorId)) {
        continue;
      }
      return true;
    }
  }
  return false;
};

const walkableFiles = fs.readdirSync(WALKABLE_DIR).filter(file => file.endsWith('.json'));
const walkablePoints = [];
const walkableAreas = [];

const addPoint = (coords, floorId, geometryId, source) => {
  walkablePoints.push({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: coords },
    properties: {
      floorId,
      geometryId,
      type: 'walkable',
      source
    }
  });
};

const maybeAddPoint = (coords, floorId, geometryId, source) => {
  const point = turf.point(coords);
  if (isPointBlocked(point, floorId)) {
    return;
  }
  addPoint(coords, floorId, geometryId, source);
};

const insetPolygon = (feature, insetMeters) => {
  if (!Number.isFinite(insetMeters) || insetMeters <= 0) return feature;
  if (!feature?.geometry) return feature;
  if (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon') {
    return feature;
  }
  try {
    const inset = turf.buffer(feature, -Math.abs(insetMeters), { units: 'meters' });
    if (inset?.geometry &&
        (inset.geometry.type === 'Polygon' || inset.geometry.type === 'MultiPolygon')) {
      return inset;
    }
  } catch (e) {
    return feature;
  }
  return feature;
};

const sampleFeature = (feature, floorId, geometryId) => {
  const geometry = feature.geometry;
  if (!geometry) return;

  if (!gridMeters) {
    const centroid = turf.centroid(feature).geometry.coordinates;
    maybeAddPoint(centroid, floorId, geometryId, 'centroid');
    if (buildAreas && (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon')) {
      walkableAreas.push({
        ...insetPolygon(feature, walkableInset),
        properties: {
          ...feature.properties,
          floorId,
          geometryId
        }
      });
    }
    return;
  }

  if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') {
    const targetFeature = insetPolygon(feature, walkableInset);
    const bbox = turf.bbox(targetFeature);
    const grid = turf.pointGrid(bbox, gridMeters, { units: 'meters' });
    grid.features.forEach(point => {
      if (turf.booleanPointInPolygon(point, targetFeature)) {
        maybeAddPoint(point.geometry.coordinates, floorId, geometryId, 'grid');
      }
    });
    if (buildAreas) {
      walkableAreas.push({
        ...targetFeature,
        properties: {
          ...feature.properties,
          floorId,
          geometryId
        }
      });
    }
    return;
  }

  if (geometry.type === 'LineString' || geometry.type === 'MultiLineString') {
    const line = geometry.type === 'LineString' ? feature : turf.lineMerge(feature);
    const length = turf.length(line, { units: 'meters' });
    const step = Math.max(gridMeters, 1);
    for (let dist = 0; dist <= length; dist += step) {
      const point = turf.along(line, dist, { units: 'meters' });
      maybeAddPoint(point.geometry.coordinates, floorId, geometryId, 'grid');
    }
    return;
  }

  if (geometry.type === 'Point') {
    maybeAddPoint(geometry.coordinates, floorId, geometryId, 'point');
  }
};

walkableFiles.forEach(file => {
  const floorId = file.replace('.json', '');
  const walkablePath = path.join(WALKABLE_DIR, file);
  const walkableData = JSON.parse(fs.readFileSync(walkablePath, 'utf8'));
  const geometryIds = Object.keys(walkableData);
  const floorMap = geometryByFloor.get(`${floorId}-map`) || new Map();

  geometryIds.forEach(id => {
    const feature = floorMap.get(id) || geometryLookup.get(id);
    if (!feature) return;
    sampleFeature(feature, floorId, id);
  });
});

const outputNodes = {
  type: 'FeatureCollection',
  features: walkablePoints
};

fs.writeFileSync(path.join(ASSET_DIR, 'walkable_nodes.geojson'), JSON.stringify(outputNodes));
console.log(`Created ${walkablePoints.length} walkable nodes -> ${path.join(ASSET_DIR, 'walkable_nodes.geojson')}`);

if (buildAreas) {
  const outputAreas = {
    type: 'FeatureCollection',
    features: walkableAreas
  };
  fs.writeFileSync(path.join(ASSET_DIR, 'walkable_areas.geojson'), JSON.stringify(outputAreas));
  console.log(`Created ${walkableAreas.length} walkable areas -> ${path.join(ASSET_DIR, 'walkable_areas.geojson')}`);
}
