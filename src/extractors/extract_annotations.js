const fs = require('fs');
const path = require('path');

// Read annotations
const annotationsPath = path.join(__dirname, '../../temp_mvf/annotations/f_b5369b1f7a27bb97.json');
const annotations = JSON.parse(fs.readFileSync(annotationsPath, 'utf8'));

console.log(`Found ${annotations.length} annotations`);

// Count by type
const byType = {};
annotations.forEach(ann => {
    byType[ann.symbolKey] = (byType[ann.symbolKey] || 0) + 1;
});

console.log('Annotations by type:');
Object.entries(byType).forEach(([type, count]) => {
    console.log(`  ${type}: ${count}`);
});

// Read geometry for ground floor
const geometryPath = path.join(__dirname, '../../temp_mvf/geometry/f_b5369b1f7a27bb97.geojson');
const geometryData = JSON.parse(fs.readFileSync(geometryPath, 'utf8'));

const annotationFeatures = [];

annotations.forEach(annotation => {
    // Find the geometry for this annotation
    const geometry = geometryData.features.find(f => f.properties.id === annotation.geometryId);

    if (geometry) {
        // Calculate centroid
        let centroid;
        if (geometry.geometry.type === 'Point') {
            centroid = geometry.geometry.coordinates;
        } else if (geometry.geometry.type === 'Polygon') {
            const coords = geometry.geometry.coordinates[0];
            let x = 0, y = 0, n = coords.length;
            coords.forEach(coord => {
                x += coord[0];
                y += coord[1];
            });
            centroid = [x / n, y / n];
        } else if (geometry.geometry.type === 'LineString') {
            const mid = Math.floor(geometry.geometry.coordinates.length / 2);
            centroid = geometry.geometry.coordinates[mid];
        }

        if (centroid) {
            // Determine icon type
            const iconType = annotation.symbolKey.includes('primary') ? 'primary-entrance' : 'secondary-entrance';
            const entranceType = annotation.symbolKey.includes('primary') ? 'Primary Entrance' : 'Secondary Entrance';

            annotationFeatures.push({
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: centroid
                },
                properties: {
                    floorId: 'f_b5369b1f7a27bb97', // Ground floor
                    annotationId: annotation.id,
                    geometryId: annotation.geometryId,
                    symbolKey: annotation.symbolKey,
                    iconType: iconType,
                    entranceType: entranceType,
                    type: 'annotation'
                }
            });
        }
    }
});

console.log(`Created ${annotationFeatures.length} annotation point features`);

// Create GeoJSON
const annotationsGeoJSON = {
    type: 'FeatureCollection',
    features: annotationFeatures
};

// Save to assets folder
fs.writeFileSync(path.join(__dirname, '../../assets/annotation_nodes.geojson'), JSON.stringify(annotationsGeoJSON, null, 2));

console.log('✅ Saved annotation nodes to assets/annotation_nodes.geojson');
