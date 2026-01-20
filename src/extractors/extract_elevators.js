const fs = require('fs');
const path = require('path');

// Read connections.json
const connections = JSON.parse(fs.readFileSync(path.join(__dirname, '../../temp_mvf/connections.json'), 'utf8'));

// Filter elevator connections
const elevatorConnections = connections.filter(c => c.type === 'elevator');

console.log(`Found ${elevatorConnections.length} elevator connections`);

// Extract all unique geometry IDs for elevators
const elevatorGeometryMap = new Map();
const elevatorsByFloor = {};

elevatorConnections.forEach(elevator => {
    // Process entrances
    elevator.entrances.forEach(entrance => {
        elevatorGeometryMap.set(entrance.geometryId, {
            connectionId: elevator.id,
            geometryId: entrance.geometryId,
            floorId: entrance.floorId
        });

        if (!elevatorsByFloor[entrance.floorId]) {
            elevatorsByFloor[entrance.floorId] = [];
        }
        elevatorsByFloor[entrance.floorId].push(entrance.geometryId);
    });
});

console.log(`Total unique elevator geometry IDs: ${elevatorGeometryMap.size}`);
console.log('Elevators by floor:');
Object.keys(elevatorsByFloor).forEach(floorId => {
    console.log(`  ${floorId}: ${elevatorsByFloor[floorId].length} elevators`);
});

// Now read geometry files and extract elevator locations
const geometryDir = path.join(__dirname, '../../temp_mvf/geometry');
const geometryFiles = fs.readdirSync(geometryDir).filter(f => f.endsWith('.geojson') || f.endsWith('.json'));

const elevatorFeatures = [];

geometryFiles.forEach(file => {
    const floorId = file.replace('.geojson', '').replace('.json', '');
    const geometryData = JSON.parse(fs.readFileSync(path.join(geometryDir, file), 'utf8'));

    if (geometryData.features) {
        geometryData.features.forEach(feature => {
            if (elevatorGeometryMap.has(feature.properties.id)) {
                const elevatorInfo = elevatorGeometryMap.get(feature.properties.id);

                // Calculate centroid for the elevator
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
                    elevatorFeatures.push({
                        type: 'Feature',
                        geometry: {
                            type: 'Point',
                            coordinates: centroid
                        },
                        properties: {
                            floorId: elevatorInfo.floorId,
                            geometryId: elevatorInfo.geometryId,
                            connectionId: elevatorInfo.connectionId,
                            type: 'elevator'
                        }
                    });
                }
            }
        });
    }
});

console.log(`Created ${elevatorFeatures.length} elevator point features`);

// Create GeoJSON
const elevatorsGeoJSON = {
    type: 'FeatureCollection',
    features: elevatorFeatures
};

// Save to assets folder
fs.writeFileSync(path.join(__dirname, '../../assets/elevator_nodes.geojson'), JSON.stringify(elevatorsGeoJSON, null, 2));

console.log('✅ Saved elevator nodes to assets/elevator_nodes.geojson');
