const fs = require('fs');
const path = require('path');

// Read all walkable files (one per floor)
const walkableDir = path.join(__dirname, '../../temp_mvf/walkable');
const walkableFiles = fs.readdirSync(walkableDir).filter(f => f.endsWith('.json'));

// Read geometry files
const geometryDir = path.join(__dirname, '../../temp_mvf/geometry');
const geometryFiles = fs.readdirSync(geometryDir).filter(f => f.endsWith('.geojson'));

const walkableFeatures = [];

walkableFiles.forEach(file => {
    const floorId = file.replace('.json', '');
    const walkableData = JSON.parse(fs.readFileSync(path.join(walkableDir, file), 'utf8'));

    // walkableData is an object with geometry IDs as keys
    const geometryIds = Object.keys(walkableData);

    // Load corresponding geometry file
    const geometryFile = geometryFiles.find(f => f.startsWith(floorId));
    if (!geometryFile) {
        console.warn(`No geometry file found for floor ${floorId}`);
        return;
    }

    const geometryData = JSON.parse(fs.readFileSync(path.join(geometryDir, geometryFile), 'utf8'));

    geometryIds.forEach(geoId => {
        const feature = geometryData.features.find(f => f.properties.id === geoId);

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
                walkableFeatures.push({
                    type: 'Feature',
                    geometry: {
                        type: 'Point',
                        coordinates: centroid
                    },
                    properties: {
                        floorId: floorId,
                        geometryId: geoId,
                        type: 'walkable'
                    }
                });
            }
        }
    });
});

console.log(`Created ${walkableFeatures.length} walkable node features`);

// Create GeoJSON
const walkableGeoJSON = {
    type: 'FeatureCollection',
    features: walkableFeatures
};

// Save to assets folder
fs.writeFileSync(path.join(__dirname, '../../assets/walkable_nodes.geojson'), JSON.stringify(walkableGeoJSON, null, 2));

console.log('✅ Saved walkable nodes to assets/walkable_nodes.geojson');
