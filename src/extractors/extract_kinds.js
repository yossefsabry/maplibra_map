const fs = require('fs');
const path = require('path');

// Read all kinds files (one per floor)
const kindsDir = path.join(__dirname, '../../temp_mvf/kinds');
const kindsFiles = fs.readdirSync(kindsDir).filter(f => f.endsWith('.json'));

// Read geometry files
const geometryDir = path.join(__dirname, '../../temp_mvf/geometry');
const geometryFiles = fs.readdirSync(geometryDir).filter(f => f.endsWith('.geojson'));

const kindsFeatures = [];

kindsFiles.forEach(file => {
    const floorId = file.replace('.json', '');
    const kindsData = JSON.parse(fs.readFileSync(path.join(kindsDir, file), 'utf8'));

    // kindsData is an object with geometry IDs as keys and kind types as values
    const geometryIds = Object.keys(kindsData);

    // Load corresponding geometry file
    const geometryFile = geometryFiles.find(f => f.startsWith(floorId));
    if (!geometryFile) {
        console.warn(`No geometry file found for floor ${floorId}`);
        return;
    }

    const geometryData = JSON.parse(fs.readFileSync(path.join(geometryDir, geometryFile), 'utf8'));

    geometryIds.forEach(geoId => {
        const feature = geometryData.features.find(f => f.properties.id === geoId);
        const kind = kindsData[geoId];

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
                kindsFeatures.push({
                    type: 'Feature',
                    geometry: {
                        type: 'Point',
                        coordinates: centroid
                    },
                    properties: {
                        floorId: floorId,
                        geometryId: geoId,
                        kind: kind,
                        type: 'kinds'
                    }
                });
            }
        }
    });
});

console.log(`Created ${kindsFeatures.length} kinds node features`);

// Count by kind type
const kindCounts = {};
kindsFeatures.forEach(f => {
    const kind = f.properties.kind;
    kindCounts[kind] = (kindCounts[kind] || 0) + 1;
});
console.log('Kinds breakdown:', kindCounts);

// Create GeoJSON
const kindsGeoJSON = {
    type: 'FeatureCollection',
    features: kindsFeatures
};

// Save to assets folder
fs.writeFileSync(path.join(__dirname, '../../assets/kinds_nodes.geojson'), JSON.stringify(kindsGeoJSON, null, 2));

console.log('✅ Saved kinds nodes to assets/kinds_nodes.geojson');
