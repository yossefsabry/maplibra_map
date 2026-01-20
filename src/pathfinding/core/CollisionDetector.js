import * as turf from '@turf/turf';

/**
 * CollisionDetector - Detects collisions with walls and non-walkable areas
 * Uses geometry data to build obstacle polygons and perform line-of-sight checks
 */
export class CollisionDetector {
    constructor() {
        this.obstacles = new Map(); // floorId -> [{ feature, bbox }]
        this.walkableAreas = new Map(); // floorId -> walkable polygons
        this.doorSegments = new Map(); // floorId -> door line segments
        this.doorToleranceMeters = 0.6;
    }

    /**
     * Initialize collision detector with geometry and metadata
     */
    initialize(geometry, nonwalkableData, kindsData) {
        console.log('Initializing CollisionDetector...');

        // Build obstacle polygons from geometry
        geometry.features.forEach(feature => {
            const floorId = feature.properties.floorId;
            const geometryId = feature.properties.id;
            const geometryType = feature.geometry?.type;

            if (!floorId) return;

            // Check if this geometry is a wall (from kinds data)
            const isWall = kindsData && kindsData[geometryId] === 'wall';

            // Check if this geometry is non-walkable
            const isNonwalkable = nonwalkableData && nonwalkableData.has(geometryId);

            if (isWall || isNonwalkable) {
                // Add to obstacles
                if (!this.obstacles.has(floorId)) {
                    this.obstacles.set(floorId, []);
                }

                const pushObstacle = (obstaclePolygon) => {
                    if (!obstaclePolygon?.geometry) {
                        return;
                    }

                    if (obstaclePolygon.geometry.type !== 'Polygon' &&
                        obstaclePolygon.geometry.type !== 'MultiPolygon') {
                        return;
                    }

                    let bbox = null;
                    try {
                        bbox = turf.bbox(obstaclePolygon);
                    } catch (e) {
                        bbox = null;
                    }
                    this.obstacles.get(floorId).push({
                        feature: obstaclePolygon,
                        bbox
                    });
                };

                const bufferLine = (lineFeature) => {
                    try {
                        return turf.buffer(lineFeature, 0.5, { units: 'meters' });
                    } catch (e) {
                        console.warn('Failed to buffer line geometry:', e);
                        return null;
                    }
                };

                // Convert lines to buffered polygons.
                // NOTE: MVF geometry often contains MultiLineString walls; treat each line separately for tighter bboxes.
                if (geometryType === 'LineString') {
                    pushObstacle(bufferLine(feature));
                    return;
                }

                if (geometryType === 'MultiLineString') {
                    const lines = feature.geometry?.coordinates;
                    if (!Array.isArray(lines) || lines.length === 0) {
                        return;
                    }
                    for (const coords of lines) {
                        if (!Array.isArray(coords) || coords.length < 2) continue;
                        const line = turf.lineString(coords, feature.properties || {});
                        pushObstacle(bufferLine(line));
                    }
                    return;
                }

                // Keep polygons as-is.
                pushObstacle(feature);
            }
        });

        console.log(`built obstacle map for ${this.obstacles.size} floors`);
        this.obstacles.forEach((obstacles, floorId) => {
            console.log(`  Floor ${floorId}: ${obstacles.length} obstacles`);
        });
    }

    /**
     * Register door segments so wall collisions can be ignored at openings.
     */
    setDoorSegments(doorSegmentsByFloor) {
        this.doorSegments = doorSegmentsByFloor || new Map();
    }

    /**
     * Check if a line segment intersects any obstacles
     */
    lineIntersectsObstacle(start, end, floorId) {
        const obstacles = this.obstacles.get(floorId);
        if (!obstacles || obstacles.length === 0) {
            return false; // No obstacles on this floor
        }

        try {
            const line = turf.lineString([start, end]);
            let lineBbox = null;
            try {
                lineBbox = turf.bbox(line);
            } catch (e) {
                lineBbox = null;
            }

            // Check intersection with each obstacle
            for (const obstacle of obstacles) {
                if (lineBbox && obstacle.bbox) {
                    const [minX, minY, maxX, maxY] = lineBbox;
                    const [oMinX, oMinY, oMaxX, oMaxY] = obstacle.bbox;
                    if (oMaxX < minX || oMinX > maxX || oMaxY < minY || oMinY > maxY) {
                        continue;
                    }
                }
                const intersection = turf.lineIntersect(line, obstacle.feature);
                if (intersection.features.length > 0) {
                    const allDoorPasses = intersection.features.every(pointFeature =>
                        this.isIntersectionAtDoor(pointFeature, floorId)
                    );
                    if (!allDoorPasses) {
                        return true; // Collision detected
                    }
                }
            }

            return false; // No collisions
        } catch (e) {
            console.warn('Error checking line intersection:', e);
            return false; // Assume safe if error
        }
    }

    isIntersectionAtDoor(pointFeature, floorId) {
        const doorSegments = this.doorSegments.get(floorId);
        if (!doorSegments || doorSegments.length === 0) {
            return false;
        }

        try {
            return doorSegments.some(segment => {
                const distance = turf.pointToLineDistance(pointFeature, segment, { units: 'meters' });
                return distance <= this.doorToleranceMeters;
            });
        } catch (e) {
            return false;
        }
    }

    /**
     * Check if a point is inside any obstacle
     */
    pointInObstacle(coords, floorId) {
        const obstacles = this.obstacles.get(floorId);
        if (!obstacles) return false;

        try {
            const point = turf.point(coords);

            if (this.isIntersectionAtDoor(point, floorId)) {
                return false;
            }

            for (const obstacle of obstacles) {
                if (turf.booleanPointInPolygon(point, obstacle.feature)) {
                    return true;
                }
            }

            return false;
        } catch (e) {
            console.warn('Error checking point in obstacle:', e);
            return false;
        }
    }

    /**
     * Get all obstacles on a floor (for debugging/visualization)
     */
    getObstaclesOnFloor(floorId) {
        const obstacles = this.obstacles.get(floorId) || [];
        return obstacles.map(item => item.feature);
    }

    /**
     * Check if path segment is clear (no obstacles)
     */
    isPathClear(startCoords, endCoords, floorId) {
        // Quick check: are endpoints in obstacles?
        if (this.pointInObstacle(startCoords, floorId) ||
            this.pointInObstacle(endCoords, floorId)) {
            return false;
        }

        // Check line intersection
        return !this.lineIntersectsObstacle(startCoords, endCoords, floorId);
    }

    /**
     * Relaxed path check - more lenient for short connections
     * Used when connecting user clicks to nearby nodes
     */
    isPathClearRelaxed(startCoords, endCoords, floorId) {
        // For very short paths (<2m), skip collision check entirely
        // This handles cases where the click is slightly inside a wall
        const dx = endCoords[0] - startCoords[0];
        const dy = endCoords[1] - startCoords[1];
        const distDegrees = Math.sqrt(dx * dx + dy * dy);
        const distMeters = distDegrees * 111320; // Approximate conversion

        if (distMeters < 2) {
            return true; // Allow very short connections
        }

        // For medium paths, only check line intersection (not endpoint obstacles)
        // This allows connections from points that are technically "in" a room boundary
        if (distMeters < 10) {
            return !this.lineIntersectsObstacle(startCoords, endCoords, floorId);
        }

        // For longer paths, use full collision check
        return this.isPathClear(startCoords, endCoords, floorId);
    }

    /**
     * Validate a multi-point path
     */
    validatePath(pathCoords, floorIds) {
        for (let i = 0; i < pathCoords.length - 1; i++) {
            const start = pathCoords[i];
            const end = pathCoords[i + 1];
            const floorId = floorIds[i]; // Use floor of starting point

            if (!this.isPathClear(start, end, floorId)) {
                return {
                    valid: false,
                    failureIndex: i,
                    segment: { start, end }
                };
            }
        }

        return {
            valid: true
        };
    }
}
