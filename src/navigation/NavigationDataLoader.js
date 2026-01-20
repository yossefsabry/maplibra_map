/**
 * NavigationDataLoader - Loads and normalizes all navigation data
 * Transforms MVF data into the format expected by PathfindingEngine
 */

/**
 * Load all navigation data and normalize it for pathfinding
 * @param {string} assetRoot - Base path to assets folder
 * @param {Array} floorIds - List of floor IDs to load
 * @returns {Object} Normalized navigation data
 */
export async function loadNavigationData(assetRoot, floorIds) {
    console.group('📦 Loading Navigation Data');

    // 1. Load kinds data for all floors → merge into kindsData map
    const kindsData = await loadKindsData(assetRoot, floorIds);
    console.log(`Loaded kinds: ${Object.keys(kindsData).length} geometry entries`);

    // 2. Load walkable/nonwalkable sets
    const walkableSet = await loadWalkableSet(assetRoot, floorIds);
    const nonwalkableSet = await loadNonwalkableSet(assetRoot, floorIds);
    console.log(`Loaded walkable: ${walkableSet.size}, nonwalkable: ${nonwalkableSet.size}`);

    // 3. Load and normalize walkable nodes
    const walkableNodes = await loadAndNormalizeWalkableNodes(assetRoot);
    console.log(`Loaded walkable nodes: ${walkableNodes.features.length} nodes`);

    // 3b. Load and normalize connector nodes (stairs/elevators) so cross-floor routing works
    const connectorNodes = await loadAndNormalizeConnectorNodes(assetRoot);
    console.log(`Loaded connector nodes: ${connectorNodes.features.length} nodes`);

    const routingNodes = {
        type: 'FeatureCollection',
        features: [...walkableNodes.features, ...connectorNodes.features]
    };
    console.log(`Total routing nodes: ${routingNodes.features.length}`);

    // 4. Load walkable areas for inside/outside detection
    const walkableAreas = await fetchJson(`${assetRoot}/walkable_areas.geojson`);
    console.log(`Loaded walkable areas: ${walkableAreas?.features?.length || 0} areas`);

    // 5. Load connections and navigation flags
    const connections = await fetchJson(`${assetRoot}/connections.json`) || [];
    const navigationFlags = await fetchJson(`${assetRoot}/navigationFlags.json`) || {};
    console.log(`Loaded connections: ${connections.length} (doors/stairs/elevators)`);

    // 6. Load entrance aesthetic nodes (for entrance detection)
    const entranceNodes = await fetchJson(`${assetRoot}/entrance_aesthetic_nodes.geojson`);
    console.log(`Loaded entrance nodes: ${entranceNodes?.features?.length || 0}`);

    console.groupEnd();

    return {
        kindsData,
        walkableSet,
        nonwalkableSet,
        walkableNodes: routingNodes,
        walkableAreas,
        connections,
        navigationFlags,
        entranceNodes
    };
}

/**
 * Load kinds/*.json files and merge into single map
 */
async function loadKindsData(assetRoot, floorIds) {
    const kindsData = {};

    for (const floorId of floorIds) {
        const data = await fetchJson(`${assetRoot}/kinds/${floorId}.json`);
        if (data) {
            Object.assign(kindsData, data);
        }
    }

    return kindsData;
}

/**
 * Load walkable/*.json files and build a Set of geometry IDs
 */
async function loadWalkableSet(assetRoot, floorIds) {
    const walkableSet = new Set();

    for (const floorId of floorIds) {
        const data = await fetchJson(`${assetRoot}/walkable/${floorId}.json`);
        if (data) {
            Object.keys(data).forEach(geoId => walkableSet.add(geoId));
        }
    }

    return walkableSet;
}

/**
 * Load nonwalkable/*.json files and build a Set of geometry IDs
 */
async function loadNonwalkableSet(assetRoot, floorIds) {
    const nonwalkableSet = new Set();

    for (const floorId of floorIds) {
        const data = await fetchJson(`${assetRoot}/nonwalkable/${floorId}.json`);
        if (data) {
            Object.keys(data).forEach(geoId => nonwalkableSet.add(geoId));
        }
    }

    return nonwalkableSet;
}

/**
 * Load walkable_nodes.geojson and normalize properties
 * Adds: id, geometryIds array, nodeType
 */
async function loadAndNormalizeWalkableNodes(assetRoot) {
    const data = await fetchJson(`${assetRoot}/walkable_nodes.geojson`);

    if (!data || !data.features) {
        console.warn('No walkable nodes found');
        return { type: 'FeatureCollection', features: [] };
    }

    // Transform each feature to add required properties
    const normalizedFeatures = data.features.map((feature, index) => {
        const props = feature.properties || {};
        const geometryId = props.geometryId;
        const stableId = geometryId ? `wn_${geometryId}` : `wn_${index}`;

        return {
            ...feature,
            properties: {
                ...props,
                // Add unique ID if not present
                id: props.id || stableId,
                // Wrap geometryId in array
                geometryIds: geometryId ? [geometryId] : [],
                // Set node type
                nodeType: props.type || 'walkable'
            }
        };
    });

    return {
        type: 'FeatureCollection',
        features: normalizedFeatures
    };
}

/**
 * Load stairs_nodes.geojson + elevator_nodes.geojson and normalize properties
 * Adds: id, geometryIds array, nodeType
 */
async function loadAndNormalizeConnectorNodes(assetRoot) {
    const [stairsData, elevatorData] = await Promise.all([
        fetchJson(`${assetRoot}/stairs_nodes.geojson`),
        fetchJson(`${assetRoot}/elevator_nodes.geojson`)
    ]);

    const normalize = (data, nodeType, prefix) => {
        if (!data?.features) return [];
        return data.features
            .map((feature, index) => {
                const props = feature.properties || {};
                const geometryId = props.geometryId;
                const floorId = props.floorId;
                if (!geometryId || !floorId) {
                    return null;
                }
                return {
                    ...feature,
                    properties: {
                        ...props,
                        id: props.id || `${prefix}_${geometryId}`,
                        geometryIds: [geometryId],
                        nodeType
                    }
                };
            })
            .filter(Boolean);
    };

    const features = [
        ...normalize(stairsData, 'stairs', 'stairs'),
        ...normalize(elevatorData, 'elevator', 'elevator')
    ];

    return { type: 'FeatureCollection', features };
}

/**
 * Helper to fetch JSON with error handling
 */
async function fetchJson(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            return null;
        }
        return response.json();
    } catch (e) {
        console.warn(`Failed to load ${url}:`, e.message);
        return null;
    }
}

/**
 * Extract floor IDs from floors GeoJSON
 */
export function extractFloorIds(floors) {
    if (!floors) return [];
    if (Array.isArray(floors)) {
        return floors.map(f => f?.properties?.id).filter(Boolean);
    }
    if (Array.isArray(floors.features)) {
        return floors.features.map(f => f?.properties?.id).filter(Boolean);
    }
    return [];
}
