// Helper: Convert hex to RGBA
export function hexToRGBA(hex, opacity = 1) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

// Helper: Calculate centroid of a geometry for labeling
export function getCentroid(geometry) {
    if (geometry.type === 'Point') return geometry.coordinates;
    if (geometry.type === 'Polygon') {
        // Simple average of vertices
        let x = 0, y = 0, n = 0;
        geometry.coordinates[0].forEach(coord => {
            x += coord[0];
            y += coord[1];
            n++;
        });
        return [x / n, y / n];
    }
    if (geometry.type === 'LineString') {
        // Midpoint
        const mid = Math.floor(geometry.coordinates.length / 2);
        return geometry.coordinates[mid];
    }
    return null;
}
