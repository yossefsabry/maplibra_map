const DB_NAME = 'maplibra_web_cache';
const DB_VERSION = 1;
const STORE_NAME = 'visibility_edges';

const EDGE_CACHE_VERSION = 2;

const isIndexedDbAvailable = () => {
  try {
    return typeof indexedDB !== 'undefined';
  } catch {
    return false;
  }
};

const openDb = () => new Promise((resolve, reject) => {
  if (!isIndexedDbAvailable()) {
    reject(new Error('IndexedDB not available'));
    return;
  }

  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(STORE_NAME)) {
      db.createObjectStore(STORE_NAME, { keyPath: 'key' });
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || new Error('Failed to open IndexedDB'));
});

const getRecord = async (key) => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(key);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error('Failed to read from IndexedDB'));
  });
};

const putRecord = async (record) => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(record);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error('Failed to write to IndexedDB'));
  });
};

export const buildVisibilityEdgeCacheKey = ({ mapId, mapTime, edgeMaxDistanceMeters, edgeMaxNeighbors }) => {
  const safeMapId = mapId || 'unknown';
  const safeTime = mapTime || 'unknown';
  const safeDist = Number.isFinite(edgeMaxDistanceMeters) ? edgeMaxDistanceMeters : 'na';
  const safeNeighbors = Number.isFinite(edgeMaxNeighbors) ? edgeMaxNeighbors : 'na';

  return `visibilityEdges:v${EDGE_CACHE_VERSION}:${safeMapId}:${safeTime}:d${safeDist}:k${safeNeighbors}`;
};

/**
 * Cached visibility edges (directed).
 * Stored as tuples: [fromId, toId, weightMeters]
 */
export const getCachedVisibilityEdges = async (key) => {
  try {
    const record = await getRecord(key);
    if (!record?.edges || !Array.isArray(record.edges)) {
      return null;
    }
    return record.edges;
  } catch (e) {
    console.warn('Visibility edge cache read failed:', e);
    return null;
  }
};

export const setCachedVisibilityEdges = async (key, edges, meta = {}) => {
  if (!Array.isArray(edges) || edges.length === 0) {
    return;
  }

  try {
    await putRecord({
      key,
      edges,
      meta,
      createdAt: Date.now()
    });
  } catch (e) {
    console.warn('Visibility edge cache write failed:', e);
  }
};
