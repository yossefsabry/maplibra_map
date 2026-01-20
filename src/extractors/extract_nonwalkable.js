const fs = require('fs');
const path = require('path');

// Read all nonwalkable files (one per floor)
const nonwalkableDir = path.join(__dirname, '../../temp_mvf/nonwalkable');
const nonwalkableFiles = fs.readdirSync(nonwalkableDir).filter(f => f.endsWith('.json'));

// Read geometry files
const geometryDir = path.join(__dirname, '../../temp_mvf/geometry');
const geometryFiles = fs.readdirSync(geometryDir).filter(f => f.endsWith('.geojson'));

const nonwalkableFeatures = [];

nonwalkableFiles.forEach(file => {
    const floorId = file.replace('.json', '');
    const nonwalkableData = JSON.parse(fs.readFileSync(path.join(nonwalkableDir, file), 'utf8'));

    // nonwalkableData is an object with geometry IDs as keys
    const geometryIds = Object.keys(nonwalkableData);

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
                nonwalkableFeatures.push({
                    type: 'Feature',
                    geometry: {
                        type: 'Point',
                        coordinates: centroid
                    },
                    properties: {
                        floorId: floorId,
                        geometryId: geoId,
                        type: 'nonwalkable'
                    }
                });
            }
        }
    });
});

console.log(`Created ${nonwalkableFeatures.length} nonwalkable node features`);

// Create GeoJSON
const nonwalkableGeoJSON = {
    type: 'FeatureCollection',
    features: nonwalkableFeatures
};

// Save to assets folder
fs.writeFileSync(path.join(__dirname, '../../assets/nonwalkable_nodes.geojson'), JSON.stringify(nonwalkableGeoJSON, null, 2));

console.log('✅ Saved nonwalkable nodes to assets/nonwalkable_nodes.geojson');
