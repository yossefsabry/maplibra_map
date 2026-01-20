/**
 * PathRenderer - Visualizes routes on the map
 * Renders path lines, waypoints, and direction indicators
 */
import maplibregl from 'maplibre-gl';

export class PathRenderer {
    constructor(map, layerManager) {
        this.map = map;
        this.layerManager = layerManager;
        this.currentRoute = null;
    }

    /**
     * Render a route on the map with premium visual effects
     */
    renderRoute(route, options = {}) {
        const {
            startColor = '#4f7cff',
            endColor = '#f0b45a',
            width = 5,
            showWaypoints = true,
            animated = true,
            showTurnIndicators = true,
            showDistanceMarkers = true
        } = options;

        // Backward compatibility for single 'color' option
        const color = options.color || startColor;

        // Clear existing route
        this.clearRoute();

        // Store current route
        this.currentRoute = route;

        // Add route line source with line-progress support
        const routeSourceId = 'route-line-source';
        const routeLayerId = 'route-line-layer';

        this.map.addSource(routeSourceId, {
            type: 'geojson',
            data: {
                type: 'Feature',
                geometry: {
                    type: 'LineString',
                    coordinates: route.path
                }
            },
            lineMetrics: true // Enable line-progress for gradient
        });

        // 0. Shadow Layer (3D depth effect)
        this.map.addLayer({
            id: `${routeLayerId}-shadow`,
            type: 'line',
            source: routeSourceId,
            paint: {
                'line-color': '#000000',
                'line-width': width + 4,
                'line-opacity': 0.15,
                'line-blur': 4,
                'line-translate': [2, 2] // Offset shadow down-right
            }
        });

        // 1. Glow Effect (Underlay)
        this.map.addLayer({
            id: `${routeLayerId}-glow`,
            type: 'line',
            source: routeSourceId,
            paint: {
                'line-color': startColor,
                'line-width': width * 2.5,
                'line-opacity': 0.25,
                'line-blur': 5
            }
        });

        // 2. Animated Dash Layer (travels along path)
        if (animated) {
            this.map.addLayer({
                id: `${routeLayerId}-animated`,
                type: 'line',
                source: routeSourceId,
                paint: {
                    'line-color': '#FFFFFF',
                    'line-width': width,
                    'line-dasharray': [0, 4, 3],
                    'line-opacity': 0.85
                }
            });

            this.animateDashArray(`${routeLayerId}-animated`);
        }

        // 3. Main Route Line with Gradient
        this.map.addLayer({
            id: routeLayerId,
            type: 'line',
            source: routeSourceId,
            paint: {
                'line-color': color,
                'line-width': width,
                'line-opacity': 0.9,
                // Gradient from start to end color using line-progress
                'line-gradient': [
                    'interpolate',
                    ['linear'],
                    ['line-progress'],
                    0, startColor,
                    0.5, '#7c5ce8',  // Purple midpoint for visual interest
                    1, endColor
                ]
            }
        });

        // Add turn indicators at significant direction changes
        if (showTurnIndicators) {
            this.renderTurnIndicators(route, startColor);
        }

        // Add distance markers along path
        if (showDistanceMarkers && route.distance > 20) {
            this.renderDistanceMarkers(route, startColor);
        }

        // Add arrows along the path
        this.renderDirectionalArrows(route, color);

        // Add waypoint markers if enabled
        if (showWaypoints && route.segments) {
            this.renderWaypoints(route, color);
        }

        // Add start/end markers
        this.renderStartEndMarkers(route, color);
    }

    /**
     * Render distance markers along the path
     */
    renderDistanceMarkers(route, color) {
        const path = route.path;
        const totalDistance = route.distance;

        // Determine interval based on route length
        const interval = totalDistance > 100 ? 50 : 20; // meters

        // Calculate cumulative distances along path
        let cumulative = 0;
        let nextMarkerAt = interval;

        for (let i = 1; i < path.length; i++) {
            const prev = path[i - 1];
            const curr = path[i];

            // Approximate segment distance
            const segDist = this.haversineDistance(prev, curr);
            cumulative += segDist;

            if (cumulative >= nextMarkerAt) {
                const remaining = Math.round(totalDistance - cumulative);

                // Create distance marker
                const marker = document.createElement('div');
                marker.className = 'route-distance-marker';
                marker.innerHTML = `${remaining}m`;
                marker.style.cssText = `
                    padding: 2px 6px;
                    background: rgba(0, 0, 0, 0.7);
                    color: white;
                    border-radius: 8px;
                    font-size: 10px;
                    font-weight: 500;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.3);
                    pointer-events: none;
                `;

                new maplibregl.Marker({ element: marker })
                    .setLngLat(curr)
                    .addTo(this.map);

                nextMarkerAt += interval;
            }
        }
    }

    /**
     * Calculate distance between two coordinates using Haversine formula
     */
    haversineDistance(coord1, coord2) {
        const R = 6371000; // Earth radius in meters
        const lat1 = coord1[1] * Math.PI / 180;
        const lat2 = coord2[1] * Math.PI / 180;
        const dLat = (coord2[1] - coord1[1]) * Math.PI / 180;
        const dLon = (coord2[0] - coord1[0]) * Math.PI / 180;

        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1) * Math.cos(lat2) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        return R * c;
    }

    /**
     * Render turn indicators at significant direction changes
     */
    renderTurnIndicators(route, color) {
        const path = route.path;
        if (path.length < 3) return;

        const minAngleChange = 30; // Only show for turns > 30 degrees
        const turnPoints = [];

        for (let i = 1; i < path.length - 1; i++) {
            const prev = path[i - 1];
            const curr = path[i];
            const next = path[i + 1];

            const angle1 = this.calculateBearing(prev, curr);
            const angle2 = this.calculateBearing(curr, next);

            let angleDiff = Math.abs(angle2 - angle1);
            if (angleDiff > 180) angleDiff = 360 - angleDiff;

            if (angleDiff > minAngleChange) {
                turnPoints.push({
                    coords: curr,
                    angle: angleDiff,
                    turnDirection: this.getTurnDirection(angle1, angle2)
                });
            }
        }

        // Add turn indicator markers
        turnPoints.forEach(turn => {
            const marker = document.createElement('div');
            marker.className = 'route-turn-indicator';

            // Use different icons based on turn sharpness
            const isSharpTurn = turn.angle > 70;
            const turnIcon = turn.turnDirection === 'left' ? '↰' : '↱';

            marker.innerHTML = isSharpTurn ? turnIcon : '•';
            marker.style.cssText = `
                width: 18px;
                height: 18px;
                background: rgba(255, 255, 255, 0.95);
                border: 2px solid ${color};
                color: ${color};
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: ${isSharpTurn ? '14px' : '10px'};
                font-weight: bold;
                box-shadow: 0 2px 6px rgba(0,0,0,0.3);
            `;

            new maplibregl.Marker({ element: marker })
                .setLngLat(turn.coords)
                .addTo(this.map);
        });
    }

    /**
     * Determine if turn is left or right
     */
    getTurnDirection(angle1, angle2) {
        let diff = angle2 - angle1;
        if (diff < -180) diff += 360;
        if (diff > 180) diff -= 360;
        return diff > 0 ? 'right' : 'left';
    }

    /**
     * Render directional arrows along the path
     */
    renderDirectionalArrows(route, color) {
        // Add arrows every N meters or at key turns
        const pathCoords = route.path;
        if (pathCoords.length < 2) return;

        // Simple approach: Add an arrow near the end and middle for now
        // A full "arrows along line" implementation often requires a symbol layer with placement: 'line',
        // but text-field icons can be tricky to rotate.
        // Instead, let's place a few fixed HTML markers with rotation. (Simpler for "logic" request)

        // Calculate bearing for the last segment to place the "final approach" arrow
        const end = pathCoords[pathCoords.length - 1];
        const beforeEnd = pathCoords[pathCoords.length - 10] || pathCoords[pathCoords.length - 2];
        // Use a point slightly back to get better direction on curve

        if (!beforeEnd) return;

        const bearing = this.calculateBearing(beforeEnd, end);

        const arrowMarker = document.createElement('div');
        arrowMarker.className = 'route-arrow-marker';
        arrowMarker.innerHTML = `
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="transform: rotate(${bearing}deg); filter: drop-shadow(0 0 5px ${color});">
                <path d="M12 2L2 22L12 18L22 22L12 2Z" fill="${color}" stroke="white" stroke-width="2"/>
            </svg>
        `;
        arrowMarker.style.cssText = `
            width: 24px;
            height: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            pointer-events: none;
        `;

        new maplibregl.Marker({ element: arrowMarker, rotationAlignment: 'map', pitchAlignment: 'map' })
            .setLngLat(end)
            // Offset slightly back so it doesn't cover the target dot exactly? 
            // Or maybe placing it ON the line before the end is better.
            .addTo(this.map);

        // Add one in the middle too
        const midIndex = Math.floor(pathCoords.length / 2);
        if (midIndex > 0 && midIndex < pathCoords.length - 1) {
            const mid = pathCoords[midIndex];
            const next = pathCoords[midIndex + 5] || pathCoords[midIndex + 1];
            const midBearing = this.calculateBearing(mid, next);

            const midArrow = arrowMarker.cloneNode(true);
            midArrow.innerHTML = `
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style="transform: rotate(${midBearing}deg); opacity: 0.8;">
                    <path d="M12 2L2 22L12 18L22 22L12 2Z" fill="${color}" stroke="white" stroke-width="2"/>
                </svg>
             `;
            new maplibregl.Marker({ element: midArrow, rotationAlignment: 'map', pitchAlignment: 'map' })
                .setLngLat(mid)
                .addTo(this.map);
        }
    }

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

    toRad(deg) { return deg * Math.PI / 180; }
    toDeg(rad) { return rad * 180 / Math.PI; }

    /**
     * Animate dash array for moving effect
     */
    animateDashArray(layerId) {
        let step = 0;
        const dashArraySequence = [
            [0, 4, 3],
            [0.5, 4, 2.5],
            [1, 4, 2],
            [1.5, 4, 1.5],
            [2, 4, 1],
            [2.5, 4, 0.5],
            [3, 4, 0],
            [0, 0.5, 3, 3.5],
            [0, 1, 3, 3],
            [0, 1.5, 3, 2.5],
            [0, 2, 3, 2],
            [0, 2.5, 3, 1.5],
            [0, 3, 3, 1]
        ];

        const animate = () => {
            // Check if layer still exists before animating
            if (!this.map.getLayer(layerId)) return;

            step = (step + 1) % dashArraySequence.length;
            this.map.setPaintProperty(
                layerId,
                'line-dasharray',
                dashArraySequence[step]
            );

            requestAnimationFrame(animate);
        };

        animate();
    }

    /**
     * Render waypoint markers for floor changes
     */
    renderWaypoints(route, color) {
        route.segments.forEach((segment, index) => {
            if (segment.floorChange) {
                // Add marker at floor transition point
                const marker = document.createElement('div');
                marker.className = 'route-waypoint';
                marker.innerHTML = segment.fromFloor !== segment.toFloor
                    ? '🔄'
                    : '•';
                marker.style.cssText = `
                    width: 24px;
                    height: 24px;
                    background: #292929;
                    border: 2px solid ${color};
                    color: #fff;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 12px;
                    box-shadow: 0 0 8px ${color};
                `;

                new maplibregl.Marker(marker)
                    .setLngLat(segment.fromCoords)
                    .addTo(this.map);
            }
        });
    }

    /**
     * Render start and end markers
     */
    renderStartEndMarkers(route, color) {
        this.injectStyles();
        const endColor = '#f0b45a';

        // Start marker (green)
        const startMarker = document.createElement('div');
        startMarker.className = 'route-start-marker';
        startMarker.innerHTML = `<div style=\"background: ${color}; width: 12px; height: 12px; border-radius: 50%;\"></div>`;
        startMarker.style.cssText = `
            width: 24px;
            height: 24px;
            background: rgba(79, 124, 255, 0.2);
            border: 2px solid ${color};
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 0 10px ${color};
        `;

        new maplibregl.Marker(startMarker)
            .setLngLat(route.path[0])
            .addTo(this.map);

        // End marker (Pulsing Target)
        const endMarker = document.createElement('div');
        endMarker.className = 'route-end-marker pulsing-marker';
        endMarker.innerHTML = '📍';
        endMarker.style.cssText = `
            font-size: 24px;
            color: ${endColor};
            filter: drop-shadow(0 0 10px ${endColor});
        `;

        new maplibregl.Marker(endMarker)
            .setLngLat(route.path[route.path.length - 1])
            .addTo(this.map);
    }

    injectStyles() {
        if (!document.getElementById('path-renderer-styles')) {
            const style = document.createElement('style');
            style.id = 'path-renderer-styles';
            style.innerHTML = `
                @keyframes pulse-ring {
                    0% { transform: scale(0.33); opacity: 1; }
                    80%, 100% { opacity: 0; }
                }
                .pulsing-marker::before {
                    content: '';
                    position: absolute;
                    left: 50%; top: 50%;
                    transform: translate(-50%, -50%);
                    width: 30px; height: 30px;
                    border: 3px solid currentColor;
                    border-radius: 50%;
                    animation: pulse-ring 2s cubic-bezier(0.215, 0.61, 0.355, 1) infinite;
                    pointer-events: none;
                }
            `;
            document.head.appendChild(style);
        }
    }

    /**
     * Clear current route from map
     */
    clearRoute() {
        // Remove all route layers (including new shadow layer)
        ['route-line-layer', 'route-line-layer-animated', 'route-line-layer-glow', 'route-line-layer-shadow'].forEach(layerId => {
            if (this.map.getLayer(layerId)) {
                this.map.removeLayer(layerId);
            }
        });

        // Remove source
        if (this.map.getSource('route-line-source')) {
            this.map.removeSource('route-line-source');
        }

        // Remove all route markers (including new turn indicators and distance markers)
        document.querySelectorAll('.route-waypoint, .route-start-marker, .route-end-marker, .route-arrow-marker, .route-turn-indicator, .route-distance-marker')
            .forEach(el => el.remove());

        this.currentRoute = null;
    }

    /**
     * Get current route
     */
    getCurrentRoute() {
        return this.currentRoute;
    }
}
