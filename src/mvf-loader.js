import JSZip from 'jszip';

export async function loadMVFBundle(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch MVF bundle (${response.status} ${response.statusText}): ${url}`);
    }

    const contentType = response.headers.get('content-type') || '';
    const blob = await response.blob();
    let zip;
    try {
        zip = await JSZip.loadAsync(blob);
    } catch (e) {
        const message = e && e.message ? e.message : String(e);
        const hint = contentType.includes('text/html')
            ? ' (received HTML; check that the file exists and is not being redirected)'
            : '';
        throw new Error(`Failed to read MVF bundle as zip from ${url}${hint}: ${message}`);
    }

    // 1. Parse Manifest
    const manifestFile = zip.file('manifest.geojson');
    if (!manifestFile) throw new Error('manifest.geojson not found!');
    const manifest = JSON.parse(await manifestFile.async('string'));

    // 2. Parse Styles
    const styleFile = zip.file('default-style.json');
    const styles = styleFile ? JSON.parse(await styleFile.async('string')) : {};

    // 3. Parse Locations
    const locationsFile = zip.file('locations.json');
    const locations = locationsFile ? JSON.parse(await locationsFile.async('string')) : [];

    // 4. Parse Floors
    const floorsFile = zip.file('floors.geojson');
    const floorsData = floorsFile ? JSON.parse(await floorsFile.async('string')) : { features: [] };
    const floors = floorsData.features.sort((a, b) => a.properties.elevation - b.properties.elevation);

    // 5. Parse Entrances
    const entranceFiles = zip.folder('entrance-aesthetic').filter((path) => path.endsWith('.json'));
    const entranceIds = new Set();
    const entranceGeometryToFloorMap = new Map();
    for (const file of entranceFiles) {
        const content = JSON.parse(await file.async('string'));
        const floorId = file.name.split('/').pop().replace('.json', '');
        content.forEach(e => {
            entranceIds.add(e.geometryId);
            entranceGeometryToFloorMap.set(e.geometryId, floorId);
        });
    }

    // 6. Load Geometry
    const geometryFolder = zip.folder('geometry');
    const geometryFiles = [];
    geometryFolder.forEach((relativePath, file) => {
        if (relativePath.endsWith('.geojson') || relativePath.endsWith('.json')) {
            geometryFiles.push(file);
        }
    });

    let allFeatures = [];
    for (const file of geometryFiles) {
        const content = JSON.parse(await file.async('string'));
        // Extract floorId from filename (e.g., "geometry/f_123.geojson" -> "f_123")
        const floorId = file.name.split('/').pop().replace('.geojson', '').replace('.json', '');

        if (content.features) {
            const featuresWithFloor = content.features.map(f => ({
                ...f,
                properties: {
                    ...f.properties,
                    floorId: floorId
                }
            }));
            allFeatures = allFeatures.concat(featuresWithFloor);
        }
    }
    const geometry = { type: 'FeatureCollection', features: allFeatures };

    // 7. Parse Connections
    const connectionsFile = zip.file('connections.json');
    const connections = connectionsFile ? JSON.parse(await connectionsFile.async('string')) : [];

    // 8. Parse Navigation Flags
    const navigationFlagsFile = zip.file('navigationFlags.json');
    const navigationFlags = navigationFlagsFile ? JSON.parse(await navigationFlagsFile.async('string')) : null;

    // 9. Parse Debug Data (Walkable, Nonwalkable, Kinds, Entrance-Aesthetic, Annotations)
    const loadIdSetFromFolder = async (folderName, isArray = false) => {
        const files = zip.folder(folderName).filter((path) => path.endsWith('.json'));
        const ids = new Set();
        for (const file of files) {
            const content = JSON.parse(await file.async('string'));
            if (isArray) {
                content.forEach(item => ids.add(item.geometryId));
            } else {
                Object.keys(content).forEach(id => ids.add(id));
            }
        }
        return ids;
    };

    const walkableIds = await loadIdSetFromFolder('walkable');
    const nonwalkableIds = await loadIdSetFromFolder('nonwalkable');
    const kindsIds = await loadIdSetFromFolder('kinds');
    const entranceAestheticIds = await loadIdSetFromFolder('entrance-aesthetic', true);
    const annotationsIds = await loadIdSetFromFolder('annotations', true);

    // Locations IDs
    const locationsIds = new Set();
    locations.forEach(loc => {
        if (loc.geometryAnchors) {
            loc.geometryAnchors.forEach(anchor => locationsIds.add(anchor.geometryId));
        }
    });

    // All Geometry IDs (for catch-all visualization)
    const geometryIds = new Set();

    // AUGMENT LOCATIONS: Scan all geometry for names (e.g. "Room 1000")
    // This ensures search finds everything, even if not in locations.json
    const existingNames = new Set(locations.map(l => l.details?.name));

    if (allFeatures) {
        allFeatures.forEach(feature => {
            const props = feature.properties;
            geometryIds.add(props.id); // Track ID

            if (props && props.name && !existingNames.has(props.name)) {
                // Create a synthetic location object
                locations.push({
                    details: { name: props.name },
                    geometryAnchors: [{
                        geometryId: props.id,
                        floorId: props.floorId
                    }]
                });
                existingNames.add(props.name);
            }
        });
    }

    return {
        manifest,
        styles,
        locations,
        floors,
        entranceIds,
        entranceGeometryToFloorMap,
        geometry,
        connections,
        navigationFlags,
        walkableIds,
        nonwalkableIds,
        kindsIds,
        entranceAestheticIds,
        annotationsIds,
        locationsIds,
        geometryIds
    };
}

export async function loadNodes(floors, baseUrl = '/assets') {
    const nodeFeatures = [];

    for (const floor of floors) {
        const floorId = floor.properties.id;
        const nodeUrl = `${baseUrl}/nodes/${floorId}.geojson`;

        try {
            const res = await fetch(nodeUrl);
            if (res.ok) {
                const nodeGeoJSON = await res.json();
                if (nodeGeoJSON.features) {
                    // Inject floorId into properties for filtering
                    const featuresWithFloor = nodeGeoJSON.features.map(f => ({
                        ...f,
                        properties: {
                            ...f.properties,
                            floorId: floorId
                        }
                    }));
                    nodeFeatures.push(...featuresWithFloor);
                    console.log(`Loaded ${featuresWithFloor.length} nodes for floor ${floorId}`);
                }
            } else {
                console.warn(`Could not load nodes for floor ${floorId} (404)`);
            }
        } catch (e) {
            console.warn(`Error loading nodes for floor ${floorId}:`, e);
        }
    }
    return nodeFeatures;
}
