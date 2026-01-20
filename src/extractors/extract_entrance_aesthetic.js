const fs = require('fs');
const path = require('path');

// Read all entrance-aesthetic files (one per floor)
const entranceDir = path.join(__dirname, '../../temp_mvf/entrance-aesthetic');
const entranceFiles = fs.readdirSync(entranceDir).filter(f => f.endsWith('.json'));

// Read geometry files
const geometryDir = path.join(__dirname, '../../temp_mvf/geometry');
const geometryFiles = fs.readdirSync(geometryDir).filter(f => f.endsWith('.geojson'));

const entranceFeatures = [];

entranceFiles.forEach(file => {
    const floorId = file.replace('.json', '');
    const entranceData = JSON.parse(fs.readFileSync(path.join(entranceDir, file), 'utf8'));

    // entranceData is an array of entrance objects
    const geometryIds = entranceData.map(e => e.geometryId);

    // Load corresponding geometry file
    const geometryFile = geometryFiles.find(f => f.startsWith(floorId));
    if (!geometryFile) {
        console.warn(`No geometry file found for floor ${floorId}`);
        return;
    }

    const geometryData = JSON.parse(fs.readFileSync(path.join(geometryDir, geometryFile), 'utf8'));

    entranceData.forEach(entrance => {
        const feature = geometryData.features.find(f => f.properties.id === entrance.geometryId);

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
                entranceFeatures.push({
                    type: 'Feature',
                    geometry: {
                        type: 'Point',
                        coordinates: centroid
                    },
                    properties: {
                        floorId: floorId,
                        geometryId: entrance.geometryId,
                        entranceId: entrance.id,
                        kind: entrance.kind,
                        type: 'entrance-aesthetic'
                    }
                });
            }
        }
    });
});

console.log(`Created ${entranceFeatures.length} entrance-aesthetic node features`);

// Create GeoJSON
const entranceGeoJSON = {
    type: 'FeatureCollection',
    features: entranceFeatures
};

// Save to assets folder
fs.writeFileSync(path.join(__dirname, '../../assets/entrance_aesthetic_nodes.geojson'), JSON.stringify(entranceGeoJSON, null, 2));

console.log('✅ Saved entrance-aesthetic nodes to assets/entrance_aesthetic_nodes.geojson');
