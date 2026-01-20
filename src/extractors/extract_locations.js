const fs = require('fs');
const path = require('path');

// Read locations.json
const locationsPath = path.join(__dirname, '../../temp_mvf/locations.json');
const locations = JSON.parse(fs.readFileSync(locationsPath, 'utf8'));

console.log(`Found ${locations.length} total locations`);

// Filter locations that have geometry anchors
const locationsWithGeometry = locations.filter(loc =>
    loc.geometryAnchors && loc.geometryAnchors.length > 0
);

console.log(`${locationsWithGeometry.length} locations have geometry anchors`);

// Read geometry files
const geometryDir = path.join(__dirname, '../../temp_mvf/geometry');
const geometryFiles = fs.readdirSync(geometryDir).filter(f => f.endsWith('.geojson'));

const locationFeatures = [];

locationsWithGeometry.forEach(location => {
    const anchor = location.geometryAnchors[0]; // Use first anchor
    const { geometryId, floorId } = anchor;

    // Find the geometry file for this floor
    const geometryFile = geometryFiles.find(f => f.startsWith(floorId));
    if (!geometryFile) {
        console.warn(`No geometry file found for floor ${floorId}`);
        return;
    }

    const geometryData = JSON.parse(fs.readFileSync(path.join(geometryDir, geometryFile), 'utf8'));
    const feature = geometryData.features.find(f => f.properties.id === geometryId);

    if (feature) {
        // Calculate centroid
        let centroid;
        if (feature.geometry.type === 'Point') {
            centroid = feature.geometry.coordinates;
        } else if (feature.geometry.type === 'Polygon') {
            const coords = feature.geometry.coordinates[0];
            let x = 0, y = 0, n = coords.length;
            coords.forEach(coord => {
                x += coord[0];
                y += coord[1];
            });
            centroid = [x / n, y / n];
        } else if (feature.geometry.type === 'LineString') {
            const mid = Math.floor(feature.geometry.coordinates.length / 2);
            centroid = feature.geometry.coordinates[mid];
        }

        if (centroid) {
            locationFeatures.push({
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: centroid
                },
                properties: {
                    locationId: location.id,
                    name: location.details?.name || 'Unknown',
                    geometryId: geometryId,
                    floorId: floorId,
                    categories: location.categories || [],
                    hasImage: location.images && location.images.length > 0
                }
            });
        }
    } else {
        console.warn(`Geometry ${geometryId} not found for location ${location.id}`);
    }
});

console.log(`Created ${locationFeatures.length} location marker features`);

// Create GeoJSON
const locationsGeoJSON = {
    type: 'FeatureCollection',
    features: locationFeatures
};

// Save to assets folder
fs.writeFileSync(
    path.join(__dirname, '../../assets/location_markers.geojson'),
    JSON.stringify(locationsGeoJSON, null, 2)
);

console.log('✅ Saved location markers to assets/location_markers.geojson');
