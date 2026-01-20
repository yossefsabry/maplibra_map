import * as turf from '@turf/turf';

/**
 * PathCache - LRU cache for recently computed paths
 * Reduces redundant pathfinding for common routes
 */
export class PathCache {
    constructor(maxSize = 100) {
        this.cache = new Map();
        this.maxSize = maxSize;
    }

    /**
     * Generate cache key from route endpoints
     */
    generateKey(startCoords, endCoords, startFloorId, endFloorId, options = {}) {
        // Round coordinates to ~1 meter precision for cache hits on nearby points
        const roundCoord = (c) => Math.round(c * 10000) / 10000;

        const startKey = `${roundCoord(startCoords[0])},${roundCoord(startCoords[1])},${startFloorId}`;
        const endKey = `${roundCoord(endCoords[0])},${roundCoord(endCoords[1])},${endFloorId}`;
        const baseKey = options.accessibleOnly ? 'acc' : 'std';
        const roomMode = options.roomTraversalMode || (options.disallowOtherRooms ? 'strict' : 'all');
        const roomDoorCount = Number.isFinite(options.publicRoomDoorCount)
            ? options.publicRoomDoorCount
            : '';
        const roomArea = Number.isFinite(options.publicRoomArea)
            ? options.publicRoomArea
            : '';
        const optionsKey = `${baseKey}:${roomMode}:${roomDoorCount}:${roomArea}`;

        return `${startKey}|${endKey}|${optionsKey}`;
    }

    /**
     * Get cached path if available
     */
    get(startCoords, endCoords, startFloorId, endFloorId, options = {}) {
        const key = this.generateKey(startCoords, endCoords, startFloorId, endFloorId, options);

        if (this.cache.has(key)) {
            // Move to end (most recently used)
            const value = this.cache.get(key);
            this.cache.delete(key);
            this.cache.set(key, value);
            console.log('📦 Path cache HIT');
            return value;
        }

        return null;
    }

    /**
     * Store path in cache
     */
    set(startCoords, endCoords, startFloorId, endFloorId, options, route) {
        const key = this.generateKey(startCoords, endCoords, startFloorId, endFloorId, options);

        // Evict oldest if at capacity
        if (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }

        this.cache.set(key, route);
    }

    /**
     * Clear the cache
     */
    clear() {
        this.cache.clear();
    }

    /**
     * Get cache statistics
     */
    getStats() {
        return {
            size: this.cache.size,
            maxSize: this.maxSize
        };
    }
}

/**
 * TurnByTurnGenerator - Generates human-readable navigation instructions
 */
export class TurnByTurnGenerator {
    /**
     * Generate turn-by-turn instructions from a route
     */
    generateInstructions(route) {
        if (!route || !route.path || route.path.length < 2) {
            return [];
        }

        const instructions = [];
        const path = route.path;
        const segments = route.segments || [];

        // Start instruction
        instructions.push({
            type: 'start',
            text: 'Start navigation',
            distance: 0,
            icon: '🚀'
        });

        // Track cumulative distance
        let cumulativeDistance = 0;
        let lastDirection = null;
        let straightDistance = 0;

        for (let i = 1; i < path.length; i++) {
            const prev = path[i - 1];
            const curr = path[i];
            const next = path[i + 1];

            // Calculate segment distance
            const segmentDist = this.calculateDistance(prev, curr);
            cumulativeDistance += segmentDist;

            // Check for floor change
            const segment = segments[i - 1];
            if (segment && segment.floorChange) {
                // Add accumulated straight distance first
                if (straightDistance > 5) {
                    instructions.push({
                        type: 'straight',
                        text: `Continue straight for ${Math.round(straightDistance)} meters`,
                        distance: straightDistance,
                        icon: '⬆️'
                    });
                    straightDistance = 0;
                }

                // Floor change instruction
                const floorChangeType = this.getFloorChangeType(segment);
                instructions.push({
                    type: 'floor-change',
                    text: `Take the ${floorChangeType} to ${segment.toFloor}`,
                    distance: 0,
                    icon: floorChangeType === 'elevator' ? '🛗' : '🪜',
                    fromFloor: segment.fromFloor,
                    toFloor: segment.toFloor
                });
                continue;
            }

            // Calculate turn direction if there's a next point
            if (next) {
                const bearing1 = this.calculateBearing(prev, curr);
                const bearing2 = this.calculateBearing(curr, next);
                const turn = this.getTurnInfo(bearing1, bearing2);

                if (turn.type !== 'straight') {
                    // Add accumulated straight distance first
                    if (straightDistance > 5) {
                        instructions.push({
                            type: 'straight',
                            text: `Continue straight for ${Math.round(straightDistance)} meters`,
                            distance: straightDistance,
                            icon: '⬆️'
                        });
                        straightDistance = 0;
                    }

                    // Add turn instruction
                    instructions.push({
                        type: turn.type,
                        text: turn.text,
                        distance: segmentDist,
                        icon: turn.icon,
                        angle: turn.angle
                    });
                } else {
                    straightDistance += segmentDist;
                }
            } else {
                straightDistance += segmentDist;
            }
        }

        // Add final straight segment if any
        if (straightDistance > 5) {
            instructions.push({
                type: 'straight',
                text: `Continue straight for ${Math.round(straightDistance)} meters`,
                distance: straightDistance,
                icon: '⬆️'
            });
        }

        // Destination reached
        instructions.push({
            type: 'destination',
            text: `Arrive at your destination`,
            distance: route.distance,
            icon: '🎯',
            totalDistance: Math.round(route.distance)
        });

        return instructions;
    }

    /**
     * Calculate bearing between two points
     */
    calculateBearing(start, end) {
        const startLat = this.toRad(start[1]);
        const startLng = this.toRad(start[0]);
        const endLat = this.toRad(end[1]);
        const endLng = this.toRad(end[0]);

        const y = Math.sin(endLng - startLng) * Math.cos(endLat);
        const x = Math.cos(startLat) * Math.sin(endLat) -
            Math.sin(startLat) * Math.cos(endLat) * Math.cos(endLng - startLng);
        const brng = this.toDeg(Math.atan2(y, x));
        return (brng + 360) % 360;
    }

    /**
     * Get turn information from two bearings
     */
    getTurnInfo(bearing1, bearing2) {
        let diff = bearing2 - bearing1;
        if (diff < -180) diff += 360;
        if (diff > 180) diff -= 360;

        const absDiff = Math.abs(diff);

        if (absDiff < 20) {
            return { type: 'straight', text: 'Continue straight', icon: '⬆️', angle: absDiff };
        } else if (absDiff < 45) {
            return diff > 0
                ? { type: 'slight-right', text: 'Bear slightly right', icon: '↗️', angle: absDiff }
                : { type: 'slight-left', text: 'Bear slightly left', icon: '↖️', angle: absDiff };
        } else if (absDiff < 135) {
            return diff > 0
                ? { type: 'right', text: 'Turn right', icon: '➡️', angle: absDiff }
                : { type: 'left', text: 'Turn left', icon: '⬅️', angle: absDiff };
        } else {
            return diff > 0
                ? { type: 'sharp-right', text: 'Make a sharp right turn', icon: '↩️', angle: absDiff }
                : { type: 'sharp-left', text: 'Make a sharp left turn', icon: '↪️', angle: absDiff };
        }
    }

    /**
     * Determine floor change mechanism type
     */
    getFloorChangeType(segment) {
        // Check segment metadata or use default
        if (segment.type === 'elevator') return 'elevator';
        if (segment.type === 'escalator') return 'escalator';
        return 'stairs';
    }

    /**
     * Calculate distance between coordinates
     */
    calculateDistance(coord1, coord2) {
        try {
            return turf.distance(turf.point(coord1), turf.point(coord2), { units: 'meters' });
        } catch (e) {
            // Fallback to Haversine
            const R = 6371000;
            const lat1 = coord1[1] * Math.PI / 180;
            const lat2 = coord2[1] * Math.PI / 180;
            const dLat = (coord2[1] - coord1[1]) * Math.PI / 180;
            const dLon = (coord2[0] - coord1[0]) * Math.PI / 180;
            const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
            return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        }
    }

    toRad(deg) { return deg * Math.PI / 180; }
    toDeg(rad) { return rad * 180 / Math.PI; }

    /**
     * Format instructions as a single text summary
     */
    formatAsText(instructions) {
        return instructions
            .map((inst, i) => `${i + 1}. ${inst.icon} ${inst.text}`)
            .join('\n');
    }
}
