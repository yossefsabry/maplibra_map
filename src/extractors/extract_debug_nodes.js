const fs = require('fs');
const path = require('path');

const TEMP_MVF_DIR = path.join(__dirname, 'temp_mvf');
const ASSETS_DIR = path.join(__dirname, 'assets');

// Helper to read JSON files from a directory
function readJsonFiles(dir) {
    const files = fs.readdirSync(dir);
    const data = [];
    files.forEach(file => {
        if (file.endsWith('.json')) {
            const content = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
            data.push(content);
        }
    });
    return data;
}

// Helper to create a map of geometryId -> coordinates
function createGeometryMap() {
    const geometryDir = path.join(TEMP_MVF_DIR, 'geometry');
    const geometryFiles = readJsonFiles(geometryDir);
    const geometryMap = new Map();

    geometryFiles.forEach(file => {
        // Handle different structure of geometry files if necessary
        // Assuming file structure: { id: "...", geometry: { type: "Point", coordinates: [...] }, ... }
        // Or if it's a list of items
        const items = Array.isArray(file) ? file : [file];
        items.forEach(item => {
            if (item.id && item.geometry && item.geometry.coordinates) {
                geometryMap.set(item.id, item.geometry.coordinates);
            } else if (item.template && item.template.geometry && item.template.geometry.coordinates) {
                // For some structures, coordinates might be deep
                geometryMap.set(item.id, item.template.geometry.coordinates);
            }
        });
    });

    // Also try reading from a consolidated geometry.json if individual files aren't enough
    // Based on previous tool outputs, there are multiple files in geometry/
    return geometryMap;
}

// Specific geometry loader for this project which seems to have multiple files in geometry/
function loadGeometryConfigs() {
    const geometryMap = new Map();
    const geometryDir = path.join(TEMP_MVF_DIR, 'geometry');

    if (fs.existsSync(geometryDir)) {
        const files = fs.readdirSync(geometryDir);
        files.forEach(file => {
            if (file.endsWith('.json')) {
                const filePath = path.join(geometryDir, file);
                const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));

                // The geometry files in temp_mvf seem to be arrays of objects
                if (Array.isArray(content)) {
                    content.forEach(item => {
                        if (item.id && item.geometry && item.geometry.coordinates) {
                            geometryMap.set(item.id, item.geometry.coordinates);
                        }
                    });
                }
            }
        });
    }
    return geometryMap;
}


function generateGeoJSON(nodes, geometryMap, type) {
    const features = [];

    nodes.forEach(node => {
        // Check if node has geometry_id directly or via geometry_id property
        const geometryId = node.geometry_id || node.geometryId;

        let coordinates = null;
        if (geometryId) {
            coordinates = geometryMap.get(geometryId);
        }

        if (coordinates) {
            features.push({
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: coordinates
                },
                properties: {
                    id: node.id,
                    nodeType: type, // 'walkable', 'nonwalkable', 'kinds'
                    floorId: node.floor_id || node.floorId,
                    ...node // Include other properties
                }
            });
        }
    });

    return {
        type: 'FeatureCollection',
        features: features
    };
}


function processNodes(folderName, outputFilename, nodeType) {
    const dirPath = path.join(TEMP_MVF_DIR, folderName);
    if (!fs.existsSync(dirPath)) {
        console.warn(`Directory ${dirPath} does not exist. Skipping.`);
        return;
    }

    const files = readJsonFiles(dirPath);
    let allNodes = [];
    files.forEach(file => {
        if (Array.isArray(file)) {
            allNodes = allNodes.concat(file);
        } else {
            allNodes.push(file);
        }
    });

    const geometryMap = loadGeometryConfigs();
    const geojson = generateGeoJSON(allNodes, geometryMap, nodeType);

    const outputPath = path.join(ASSETS_DIR, outputFilename);
    fs.writeFileSync(outputPath, JSON.stringify(geojson, null, 2));
    console.log(`Generated ${outputFilename} with ${geojson.features.length} features.`);
}

function main() {
    if (!fs.existsSync(ASSETS_DIR)) {
        fs.mkdirSync(ASSETS_DIR);
    }

    console.log('Starting extraction of debug nodes...');

    processNodes('walkable', 'walkable_nodes.geojson', 'walkable');
    processNodes('nonwalkable', 'nonwalkable_nodes.geojson', 'nonwalkable');

    // Kinds might have a slightly different structure or multiple files/types
    processNodes('kinds', 'kinds_nodes.geojson', 'kinds');

    console.log('Extraction complete.');
}

main();
