import * as turf from '@turf/turf';

/**
 * PathSmoother - Smooths paths using Catmull-Rom splines
 * Makes paths look natural and curved instead of sharp zigzags
 */
export class PathSmoother {
    /**
     * Smooth a path using Catmull-Rom spline
     */
    smoothPath(pathCoords, options = {}) {
        const {
            resolution = 20000, // Higher resolution for silkier curves
            sharpness = 0.4 // Lower sharpness for more natural flow
        } = options;

        if (pathCoords.length < 2) {
            return pathCoords;
        }

        if (pathCoords.length === 2) {
            // Just a straight line, no smoothing needed
            return pathCoords;
        }

        try {
            // Create line from path
            const line = turf.lineString(pathCoords);

            // Use bezier spline for smoothing
            const curved = turf.bezierSpline(line, {
                resolution: resolution,
                sharpness: sharpness
            });

            return curved.geometry.coordinates;
        } catch (e) {
            console.warn('Failed to smooth path:', e);
            return pathCoords; // Return original if smoothing fails
        }
    }

    /**
     * Simplify path by removing redundant points
     */
    simplifyPath(pathCoords, tolerance = 0.00001) {
        if (pathCoords.length < 3) {
            return pathCoords;
        }

        try {
            const line = turf.lineString(pathCoords);
            const simplified = turf.simplify(line, {
                tolerance: tolerance,
                highQuality: true
            });

            return simplified.geometry.coordinates;
        } catch (e) {
            console.warn('Failed to simplify path:', e);
            return pathCoords;
        }
    }

    /**
     * Smooth path while preserving multi-floor waypoints
     */
    smoothPathWithFloors(pathCoords, floorIds) {
        if (pathCoords.length < 2) {
            return pathCoords;
        }

        // Find floor transition points
        const segments = [];
        let currentSegment = [pathCoords[0]];
        let currentFloor = floorIds[0];

        for (let i = 1; i < pathCoords.length; i++) {
            if (floorIds[i] !== currentFloor) {
                // Floor change detected, save current segment
                currentSegment.push(pathCoords[i]);
                segments.push({
                    coords: currentSegment,
                    floor: currentFloor
                });

                // Start new segment
                currentSegment = [pathCoords[i]];
                currentFloor = floorIds[i];
            } else {
                currentSegment.push(pathCoords[i]);
            }
        }

        // Add last segment
        if (currentSegment.length > 0) {
            segments.push({
                coords: currentSegment,
                floor: currentFloor
            });
        }

        // Smooth each segment separately
        const smoothedPath = [];
        segments.forEach((segment, index) => {
            const smoothed = this.smoothPath(segment.coords);

            // Add smoothed coordinates (skip first if not first segment to avoid duplicates)
            if (index === 0) {
                smoothedPath.push(...smoothed);
            } else {
                smoothedPath.push(...smoothed.slice(1));
            }
        });

        return smoothedPath;
    }
}
