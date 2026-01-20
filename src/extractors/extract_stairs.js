const fs = require('fs');
const path = require('path');

// Read connections.json
const connections = JSON.parse(fs.readFileSync(path.join(__dirname, '../../temp_mvf/connections.json'), 'utf8'));

// Filter stairs connections
const stairsConnections = connections.filter(c => c.type === 'stairs');

console.log(`Found ${stairsConnections.length} stairs connections`);

// Extract all unique geometry IDs for stairs with floor info
const stairGeometryMap = new Map();
const stairsByFloor = {};

stairsConnections.forEach(stair => {
    // Process entrances
    stair.entrances.forEach(entrance => {
        stairGeometryMap.set(entrance.geometryId, {
            connectionId: stair.id,
            geometryId: entrance.geometryId,
            floorId: entrance.floorId
        });

        if (!stairsByFloor[entrance.floorId]) {
            stairsByFloor[entrance.floorId] = [];
        }
        stairsByFloor[entrance.floorId].push(entrance.geometryId);
    });
});

console.log(`Total unique stair geometry IDs: ${stairGeometryMap.size}`);
console.log('Stairs by floor:');
Object.keys(stairsByFloor).forEach(floorId => {
    console.log(`  ${floorId}: ${stairsByFloor[floorId].length} stairs`);
});

// Now read geometry files and extract stair locations
const geometryDir = path.join(__dirname, '../../temp_mvf/geometry');
const geometryFiles = fs.readdirSync(geometryDir).filter(f => f.endsWith('.geojson') || f.endsWith('.json'));

const stairFeatures = [];

geometryFiles.forEach(file => {
    const floorId = file.replace('.geojson', '').replace('.json', '');
    const geometryData = JSON.parse(fs.readFileSync(path.join(geometryDir, file), 'utf8'));

    if (geometryData.features) {
        geometryData.features.forEach(feature => {
            if (stairGeometryMap.has(feature.properties.id)) {
                const stairInfo = stairGeometryMap.get(feature.properties.id);

                // Calculate centroid for the stair
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
                    stairFeatures.push({
                        type: 'Feature',
                        geometry: {
                            type: 'Point',
                            coordinates: centroid
                        },
                        properties: {
                            floorId: stairInfo.floorId,
                            geometryId: stairInfo.geometryId,
                            connectionId: stairInfo.connectionId,
                            type: 'stair'
                        }
                    });
                }
            }
        });
    }
});

console.log(`Created ${stairFeatures.length} stair point features`);

// Create GeoJSON
const stairsGeoJSON = {
    type: 'FeatureCollection',
    features: stairFeatures
};

// Save to assets folder
fs.writeFileSync(path.join(__dirname, '../../assets/stairs_nodes.geojson'), JSON.stringify(stairsGeoJSON, null, 2));

console.log('✅ Saved stairs nodes to assets/stairs_nodes.geojson');
