/**
 * NavigationController - Main orchestrator for indoor navigation
 * Wraps PathfindingEngine and provides user-friendly API
 */

import { PathfindingEngine } from '../pathfinding/PathfindingEngine.js';
import { PathRenderer } from '../pathfinding/visualization/PathRenderer.js';
import { PathSmoother } from '../pathfinding/features/PathSmoother.js';
import {
    buildVisibilityEdgeCacheKey,
    getCachedVisibilityEdges,
    setCachedVisibilityEdges
} from '../pathfinding/cache/VisibilityEdgeCache.js';
import { loadNavigationData, extractFloorIds } from './NavigationDataLoader.js';
import * as turf from '@turf/turf';

export class NavigationController {
    constructor(map, layerManager) {
        this.map = map;
        this.layerManager = layerManager;
        this.engine = new PathfindingEngine();
        this.renderer = new PathRenderer(map, layerManager);
        this.smoother = new PathSmoother();

        this.initialized = false;
        this.currentRoute = null;
        this.userLocation = null;
        this.destination = null;
        this.walkableAreas = null;
        this.groundFloorId = null;

        // Marker for user position during simulation
        this.userMarker = null;
        this.animationFrameId = null;
    }

    emitStatus(message) {
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
            try {
                window.dispatchEvent(new CustomEvent('navigation-status', { detail: { message } }));
            } catch (e) {
                // Ignore event dispatch errors.
            }
        }
    }

    /**
     * Initialize the navigation system with MVF data
     * @param {Object} mvfData - Data from loadMVFBundle
     * @param {string} assetRoot - Path to assets folder
     */
    async initialize(mvfData, assetRoot = '/assets') {
        console.group('🧭 Initializing Navigation Controller');
        this.emitStatus('Loading navigation data…');

        const { geometry, floors, manifest } = mvfData;
        const floorIds = extractFloorIds(floors);
        this.groundFloorId = floors?.[0]?.properties?.id || floorIds[0] || null;

        if (floorIds.length === 0) {
            console.error('No floors found in MVF data');
            console.groupEnd();
            return false;
        }

        console.log(`Found ${floorIds.length} floors:`, floorIds);

        // Load and normalize all navigation data
        const navData = await loadNavigationData(assetRoot, floorIds);
        this.emitStatus('Building routing graph…');

        // Store walkable areas for inside/outside detection
        this.walkableAreas = navData.walkableAreas;

        const nodeCount = navData.walkableNodes?.features?.length || 0;
        let edgeMaxDistanceMeters = 15;
        let edgeMaxNeighbors = 8;

        // Large graphs can freeze the UI while building visibility edges.
        // Use slightly tighter edge limits + time-sliced yielding for smoother startup.
        if (nodeCount > 8000) {
            edgeMaxDistanceMeters = 8;
            edgeMaxNeighbors = 6;
        }

        const engineOptions = {
            edgeMaxDistanceMeters,
            edgeMaxNeighbors,
            edgeBuildYieldEvery: nodeCount > 8000 ? 10 : 25,
            edgeBuildYieldAfterMs: 12
        };
        engineOptions.onStatus = (message) => this.emitStatus(message);

        const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
        const forceRebuildGraph = urlParams ? urlParams.has('rebuildGraph') : false;
        const disableGraphCache = urlParams ? urlParams.has('noGraphCache') : false;

        const manifestProps = manifest?.features?.[0]?.properties || {};
        const cacheKey = buildVisibilityEdgeCacheKey({
            mapId: manifestProps.mapId,
            mapTime: manifestProps.time,
            edgeMaxDistanceMeters,
            edgeMaxNeighbors
        });

        if (!disableGraphCache && !forceRebuildGraph) {
            const cachedEdges = await getCachedVisibilityEdges(cacheKey);
            if (cachedEdges) {
                console.log(`🧠 Using cached visibility edges (${cachedEdges.length})`);
                engineOptions.visibilityEdges = cachedEdges;
            }
        }

        if (!disableGraphCache && !engineOptions.visibilityEdges) {
            engineOptions.onVisibilityEdgesBuilt = (edges) => {
                void setCachedVisibilityEdges(cacheKey, edges, {
                    mapId: manifestProps.mapId,
                    mapTime: manifestProps.time,
                    nodeCount,
                    edgeMaxDistanceMeters,
                    edgeMaxNeighbors
                });
            };
        }

        console.log('🧩 Graph build settings:', {
            edgeMaxDistanceMeters,
            edgeMaxNeighbors,
            edgeBuildYieldEvery: engineOptions.edgeBuildYieldEvery,
            edgeBuildYieldAfterMs: engineOptions.edgeBuildYieldAfterMs,
            visibilityEdges: engineOptions.visibilityEdges ? `cached(${engineOptions.visibilityEdges.length})` : 'build'
        }, `(${nodeCount} routing nodes)`);

        // Initialize the pathfinding engine
        await this.engine.initialize(
            navData.walkableNodes.features,  // nodeFeatures
            geometry,                          // geometry
            navData.connections,               // connections
            navData.walkableSet,               // walkableData
            navData.nonwalkableSet,            // nonwalkableData
            navData.kindsData,                 // kindsData
            navData.entranceNodes,             // entranceNodesData
            navData.navigationFlags,           // navigationFlags
            engineOptions
        );

        this.initialized = true;
        this.emitStatus('Routing engine ready.');
        console.log('✅ Navigation Controller Ready!');
        console.groupEnd();

        return true;
    }

    findNearestEntranceNode(coords, preferredFloorId = this.groundFloorId) {
        const graph = this.engine.getGraph();
        const allNodes = Array.from(graph.nodes.values());

        let candidates = allNodes.filter(node => node.type === 'entrance');
        if (preferredFloorId) {
            const sameFloor = candidates.filter(node => node.floorId === preferredFloorId);
            if (sameFloor.length > 0) {
                candidates = sameFloor;
            }
        }

        if (candidates.length === 0) {
            return null;
        }

        const origin = turf.point(coords);
        let nearest = null;
        let bestDist = Infinity;

        candidates.forEach(node => {
            const dist = turf.distance(origin, turf.point(node.coords), { units: 'meters' });
            if (dist < bestDist) {
                bestDist = dist;
                nearest = node;
            }
        });

        return nearest;
    }

    /**
     * Check if a point is inside a walkable area
     * @param {Array} coords - [lng, lat]
     * @returns {boolean}
     */
    isInsideWalkableArea(coords) {
        if (!this.walkableAreas || !this.walkableAreas.features) {
            return false;
        }

        const point = turf.point(coords);

        for (const area of this.walkableAreas.features) {
            if (area.geometry.type === 'Polygon' || area.geometry.type === 'MultiPolygon') {
                if (turf.booleanPointInPolygon(point, area)) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Set user's current location
     * @param {Array} coords - [lng, lat]
     * @param {string} floorId - Current floor ID
     */
    setUserLocation(coords, floorId) {
        this.userLocation = { coords, floorId };

        // If inside building, snap to nearest walkable node
        if (this.isInsideWalkableArea(coords)) {
            const snapped = this.engine.snapToWalkableNode(coords, floorId);
            if (snapped) {
                console.log(`User snapped to node at ${snapped.distanceMeters.toFixed(2)}m`);
                this.userLocation.snappedCoords = snapped.coords;
                this.userLocation.snappedNode = snapped.node;
            }
        }

        return this.userLocation;
    }

    /**
     * Set navigation destination
     * @param {Object} destination - { coords: [lng, lat], floorId, geometryId? }
     */
    setDestination(destination) {
        this.destination = destination;
        return this.destination;
    }

    /**
     * Set destination by geometry ID (e.g., from POI selection)
     * @param {string} geometryId - Geometry ID of the destination
     * @param {string} floorId - Floor ID
     */
    setDestinationByGeometryId(geometryId, floorId) {
        // Try to find a node associated with this geometry
        const node = this.engine.getGraph().getNodeByGeometryId(geometryId);

        if (node) {
            this.destination = {
                coords: node.coords,
                floorId: node.floorId,
                geometryId,
                node
            };
        } else {
            console.warn(`No node found for geometryId: ${geometryId}`);
            this.destination = { geometryId, floorId };
        }

        return this.destination;
    }

    /**
     * Compute route from user location to destination
     * @param {Object} options - Routing options
     * @returns {Object|null} Route object or null if no path found
     */
    computeRoute(options = {}) {
        if (!this.initialized) {
            console.error('Navigation not initialized');
            return null;
        }

        if (!this.userLocation || !this.destination) {
            console.error('Both user location and destination must be set');
            return null;
        }

        const rawStartCoords = this.userLocation.coords;
        const rawStartFloorId = this.userLocation.floorId;
        const rawEndCoords = this.destination.coords;
        const rawEndFloorId = this.destination.floorId;

        if (!rawEndCoords) {
            console.error('Destination coordinates not available');
            return null;
        }

        const startInside = this.isInsideWalkableArea(rawStartCoords);
        const endInside = this.isInsideWalkableArea(rawEndCoords);

        let startCoords = this.userLocation.snappedCoords || rawStartCoords;
        let startFloorId = rawStartFloorId;
        let endCoords = rawEndCoords;
        let endFloorId = rawEndFloorId;

        // If one side is outside, route to/from the nearest entrance node first.
        // This avoids trying to snap far-away outdoor GPS points directly onto the indoor graph.
        if (!startInside && endInside) {
            const entrance = this.findNearestEntranceNode(rawStartCoords);
            if (entrance) {
                startCoords = entrance.coords;
                startFloorId = entrance.floorId;
            }
        } else if (startInside && !endInside) {
            const entrance = this.findNearestEntranceNode(rawEndCoords);
            if (entrance) {
                endCoords = entrance.coords;
                endFloorId = entrance.floorId;
            }
        }

        if (!startInside && !endInside) {
            console.warn('Both start and destination are outside; skipping indoor routing.');
            this.currentRoute = null;
            return null;
        }

        // Find route (indoor portion)
        const route = this.engine.findRoute(startCoords, endCoords, startFloorId, endFloorId, options);

        if (route) {
            // Add start/end coords to path for complete route
            const fullPath = [
                rawStartCoords,
                ...route.path,
                rawEndCoords
            ];

            route.fullPath = fullPath;
            route.startCoords = rawStartCoords;
            route.endCoords = rawEndCoords;
            route.anchorStartCoords = startCoords;
            route.anchorEndCoords = endCoords;
            route.meta = {
                ...(route.meta || {}),
                startInside,
                endInside
            };

            this.currentRoute = route;
        } else {
            const error = this.engine.getLastRouteError();
            console.error('Route not found:', error?.message || 'Unknown error');
        }

        return route;
    }

    /**
     * Render the current route on the map
     * @param {Object} options - Rendering options
     */
    renderRoute(options = {}) {
        if (!this.currentRoute) {
            console.warn('No route to render');
            return;
        }

        const coordsEqual = (a, b, epsilon = 1e-7) => {
            if (!a || !b) return false;
            return Math.abs(a[0] - b[0]) < epsilon && Math.abs(a[1] - b[1]) < epsilon;
        };

        const pushUnique = (arr, coords) => {
            if (!coords) return;
            if (arr.length === 0 || !coordsEqual(arr[arr.length - 1], coords)) {
                arr.push(coords);
            }
        };

        // Smooth only the indoor node-path, then stitch start/end connectors back in.
        const smoothedIndoorPath = this.smoother.smoothPathWithFloors(
            this.currentRoute.path,
            this.currentRoute.floors
        );

        const startCoords = this.currentRoute.startCoords || this.userLocation?.coords;
        const endCoords = this.currentRoute.endCoords || this.destination?.coords;
        const anchorStartCoords = this.currentRoute.anchorStartCoords || startCoords;
        const anchorEndCoords = this.currentRoute.anchorEndCoords || endCoords;

        const renderPath = [];
        pushUnique(renderPath, startCoords);
        pushUnique(renderPath, anchorStartCoords);
        smoothedIndoorPath.forEach(coords => pushUnique(renderPath, coords));
        pushUnique(renderPath, anchorEndCoords);
        pushUnique(renderPath, endCoords);

        const renderDistance =
            this.currentRoute.distance +
            (startCoords && anchorStartCoords && !coordsEqual(startCoords, anchorStartCoords)
                ? turf.distance(turf.point(startCoords), turf.point(anchorStartCoords), { units: 'meters' })
                : 0) +
            (endCoords && anchorEndCoords && !coordsEqual(endCoords, anchorEndCoords)
                ? turf.distance(turf.point(endCoords), turf.point(anchorEndCoords), { units: 'meters' })
                : 0);

        // Create route object with smoothed path for rendering
        const routeToRender = {
            ...this.currentRoute,
            path: renderPath,
            distance: renderDistance
        };

        // Render the route
        this.renderer.renderRoute(routeToRender, {
            animated: true,
            showWaypoints: true,
            showDirections: true,
            ...options
        });
    }

    /**
     * Clear the current route from the map
     */
    clearRoute() {
        this.renderer.clearRoute();
        this.currentRoute = null;
    }

    /**
     * Convenience method: set destination and compute route in one call
     */
    navigateTo(coords, floorId, options = {}) {
        this.setDestination({ coords, floorId });
        return this.computeRoute(options);
    }

    /**
     * Convenience method: navigate to a POI by geometry ID
     */
    navigateToGeometry(geometryId, floorId, options = {}) {
        this.setDestinationByGeometryId(geometryId, floorId);
        return this.computeRoute(options);
    }

    /**
     * Get turn-by-turn instructions for current route
     */
    getInstructions() {
        if (!this.currentRoute) {
            return null;
        }
        return this.engine.getTextInstructions(this.currentRoute);
    }

    /**
     * Start route simulation (animated marker along path)
     * @param {number} speedMps - Speed in meters per second
     */
    startSimulation(speedMps = 1.5) {
        if (!this.currentRoute || !this.currentRoute.path) {
            console.warn('No route for simulation');
            return;
        }

        this.stopSimulation();

        const path = this.currentRoute.path;
        const distances = this._computeCumulativeDistances(path);
        const totalDistance = distances[distances.length - 1];

        let distanceTraveled = 0;
        let lastTime = performance.now();

        // Create user marker if not exists
        if (!this.userMarker) {
            this.userMarker = document.createElement('div');
            this.userMarker.className = 'navigation-user-marker';
            this.userMarker.style.cssText = `
                width: 20px;
                height: 20px;
                background: #3B82F6;
                border: 3px solid white;
                border-radius: 50%;
                box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            `;
        }

        const marker = new (window.maplibregl || {}).Marker({ element: this.userMarker })
            .setLngLat(path[0])
            .addTo(this.map);

        const animate = () => {
            const now = performance.now();
            const dt = (now - lastTime) / 1000; // seconds
            lastTime = now;

            distanceTraveled += speedMps * dt;

            if (distanceTraveled >= totalDistance) {
                // Arrived
                marker.setLngLat(path[path.length - 1]);
                this.stopSimulation();
                console.log('🎯 Arrived at destination!');
                return;
            }

            // Find current position
            const pos = this._interpolatePosition(path, distances, distanceTraveled);
            marker.setLngLat(pos);

            this.animationFrameId = requestAnimationFrame(animate);
        };

        this.animationFrameId = requestAnimationFrame(animate);
    }

    /**
     * Stop route simulation
     */
    stopSimulation() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    /**
     * Compute cumulative distances along path
     */
    _computeCumulativeDistances(path) {
        const distances = [0];
        for (let i = 1; i < path.length; i++) {
            const d = turf.distance(turf.point(path[i - 1]), turf.point(path[i]), { units: 'meters' });
            distances.push(distances[i - 1] + d);
        }
        return distances;
    }

    /**
     * Interpolate position along path at given distance
     */
    _interpolatePosition(path, distances, targetDist) {
        for (let i = 1; i < distances.length; i++) {
            if (distances[i] >= targetDist) {
                const segmentStart = distances[i - 1];
                const segmentEnd = distances[i];
                const segmentLen = segmentEnd - segmentStart;
                const t = segmentLen > 0 ? (targetDist - segmentStart) / segmentLen : 0;

                const p0 = path[i - 1];
                const p1 = path[i];

                return [
                    p0[0] + t * (p1[0] - p0[0]),
                    p0[1] + t * (p1[1] - p0[1])
                ];
            }
        }
        return path[path.length - 1];
    }

    /**
     * Get pathfinding engine for advanced use
     */
    getEngine() {
        return this.engine;
    }

    getRenderer() {
        return this.renderer;
    }

    getSmoother() {
        return this.smoother;
    }

    /**
     * Check if navigation is initialized
     */
    isReady() {
        return this.initialized;
    }
}
