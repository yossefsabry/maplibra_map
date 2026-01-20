import { Graph } from './core/Graph.js';
import { CollisionDetector } from './core/CollisionDetector.js';
import { EdgeBuilder } from './core/EdgeBuilder.js';
import { AStar } from './core/AStar.js';
import { ConnectionHandler } from './multi-floor/ConnectionHandler.js';
import { PathCache, TurnByTurnGenerator } from './features/PathEnhancements.js';
import * as turf from '@turf/turf';

/**
 * PathfindingEngine - Main orchestrator for the pathfinding system
 * Coordinates graph construction, pathfinding, and route generation
 */
export class PathfindingEngine {
    constructor() {
        this.graph = new Graph();
        this.collisionDetector = new CollisionDetector();
        this.aStar = null; // Will be initialized after graph is built
        this.initialized = false;
        this.geometryIndex = new Map();
        this.roomIndex = new Map();
        this.roomDoorIndex = new Map();
        this.roomMeta = new Map();
        this.doorNodes = [];
        this.doorNodesByFloor = new Map();
        this.doorSegmentsByFloor = new Map();
        this.walkableNodesByFloor = new Map();
        this.navigationFlags = null;
        this.lastRouteError = null;

        // Path caching and turn-by-turn generation
        this.pathCache = new PathCache(100);
        this.instructionGenerator = new TurnByTurnGenerator();
    }

    /**
     * Initialize the pathfinding engine with MVF data
     */
    async initialize(
        nodeFeatures,
        geometry,
        connections,
        walkableData,
        nonwalkableData,
        kindsData,
        entranceNodesData = null,
        navigationFlags = null,
        options = {}
    ) {
        console.log('🚀 Initializing Pathfinding Engine...');
        const reportStatus = typeof options.onStatus === 'function' ? options.onStatus : null;
        const status = (message) => {
            if (!reportStatus) return;
            try {
                reportStatus(message);
            } catch (e) {
                // Ignore status callback errors.
            }
        };
        this.navigationFlags = navigationFlags;
        this.lastRouteError = null;
        const edgeMaxDistanceMeters = Number.isFinite(options.edgeMaxDistanceMeters)
            ? options.edgeMaxDistanceMeters
            : 15;
        const edgeMaxNeighbors = Number.isFinite(options.edgeMaxNeighbors)
            ? options.edgeMaxNeighbors
            : null;
        const edgeBuildYieldEvery = Number.isFinite(options.edgeBuildYieldEvery)
            ? options.edgeBuildYieldEvery
            : null;
        const edgeBuildYieldAfterMs = Number.isFinite(options.edgeBuildYieldAfterMs)
            ? options.edgeBuildYieldAfterMs
            : null;
        this.walkableNodesByFloor.clear();

        this.buildGeometryIndex(geometry);
        this.roomIndex = this.buildRoomIndex(geometry, kindsData);

        // 1. Initialize collision detector
        status('Step 1/6: Building collision detector…');
        console.log('Step 1: Building collision detector...');
        this.collisionDetector.initialize(geometry, nonwalkableData, kindsData);

        // 2. Load nodes into graph
        status('Step 2/6: Loading nodes into graph…');
        console.log('Step 2: Loading nodes into graph...');

        // Load standard pathfinding nodes
        nodeFeatures.forEach(feature => {
            const props = feature?.properties || {};
            const id = props.id;
            const coords = feature?.geometry?.coordinates;
            const floorId = props.floorId;

            if (!id || !coords || !floorId) {
                return;
            }

            const nodeType = props.nodeType || 'waypoint';
            const node = this.graph.addNode(id, coords, floorId, {
                geometryIds: props.geometryIds || [],
                type: nodeType
            });

            if (nodeType === 'walkable') {
                if (!this.walkableNodesByFloor.has(floorId)) {
                    this.walkableNodesByFloor.set(floorId, []);
                }
                this.walkableNodesByFloor.get(floorId).push(node);
            }
        });

        // Load entrance nodes if provided
        if (entranceNodesData && entranceNodesData.features) {
            console.log(`  Loading ${entranceNodesData.features.length} entrance nodes...`);
            entranceNodesData.features.forEach(feature => {
                // Use geometryId or generate a unique ID
                const id = feature.properties.geometryId || feature.id || `entrance_${Math.random().toString(36).substr(2, 9)}`;
                const coords = feature.geometry.coordinates;
                // Entrance nodes might not have floorId in properties if raw geojson, check struct
                // Based on standard geojson features from extractors, they should have it or we infer it
                // We'll rely on it being present or handled upstream. 
                // However, based on mvf-loader, we might need to ensure floorId is there. 
                // If not present in properties, we can try to find nearest floor or assume checks done.
                // Assuming well-formed data from script.js injection:
                const floorId = feature.properties.floorId;

                if (floorId) {
                    this.graph.addNode(id, coords, floorId, {
                        ...feature.properties,
                        type: 'entrance'
                    });
                }
            });
        }

        // Load door nodes from connections/geometry
        this.addDoorNodes(connections, navigationFlags);
        this.collisionDetector.setDoorSegments(this.doorSegmentsByFloor);

        console.log(`  Loaded ${this.graph.nodes.size} nodes`);

        // 3. Build spatial indexes
        status('Step 3/6: Building spatial indexes…');
        console.log('Step 3: Building spatial indexes...');
        this.graph.buildSpatialIndexes();

        // 4. Build edges using visibility graph
        status('Step 4/6: Building visibility graph edges…');
        console.log('Step 4: Building visibility graph edges...');
        const visibilityEdges = Array.isArray(options.visibilityEdges) ? options.visibilityEdges : null;
        const onVisibilityEdgesBuilt = typeof options.onVisibilityEdgesBuilt === 'function'
            ? options.onVisibilityEdgesBuilt
            : null;

        if (visibilityEdges && visibilityEdges.length > 0) {
            status(`Step 4/6: Applying cached visibility edges (${visibilityEdges.length})…`);
            console.log(`Step 4: Applying ${visibilityEdges.length} cached visibility edges...`);
            visibilityEdges.forEach(edge => {
                if (!Array.isArray(edge) || edge.length < 3) return;
                const [from, to, weight] = edge;
                if (!from || !to || !Number.isFinite(weight)) return;
                this.graph.addEdge(from, to, weight, { type: 'walkable' });
            });
            console.log('  Cached visibility edges applied');
        } else {
            const edgeBuilder = new EdgeBuilder(this.collisionDetector);
            const builtEdges = await edgeBuilder.buildAllEdges(
                this.graph,
                edgeMaxDistanceMeters,
                edgeMaxNeighbors,
                edgeBuildYieldEvery,
                edgeBuildYieldAfterMs,
                { collectEdges: Boolean(onVisibilityEdgesBuilt), onStatus: reportStatus }
            );
            if (onVisibilityEdgesBuilt && Array.isArray(builtEdges) && builtEdges.length > 0) {
                try {
                    onVisibilityEdgesBuilt(
                        builtEdges.map(edge => [edge.from, edge.to, edge.weight])
                    );
                } catch (e) {
                    // Ignore cache write errors.
                }
            }
        }

        // 5. Process connections (elevators, stairs, doors)
        status('Step 5/6: Processing multi-floor connections…');
        console.log('Step 5: Processing multi-floor connections...');
        const connectionHandler = new ConnectionHandler(this.graph);
        connectionHandler.processConnections(connections);
        connectionHandler.tagNodes(connections);

        this.roomDoorIndex = this.buildRoomDoorIndex();
        this.tagNodesWithRooms();
        this.roomMeta = this.buildRoomMeta();
        this.connectOrphanDoors();

        // 6. Initialize A* with built graph
        status('Step 6/6: Initializing A* pathfinder…');
        console.log('Step 6: Initializing A* pathfinder...');
        this.aStar = new AStar(this.graph);

        // 7. Print statistics
        const stats = this.graph.getStats();
        console.log('✅ Pathfinding Engine Initialized!');
        console.log('Graph Statistics:');
        console.log(`  Nodes: ${stats.nodeCount}`);
        console.log(`  Edges: ${stats.edgeCount}`);
        console.log(`  Floors: ${stats.floors}`);
        console.log(`  Avg Edges/Node: ${stats.avgEdgesPerNode.toFixed(2)}`);
        status('Routing engine ready.');

        this.initialized = true;
        return true;
    }

    /**
     * Find a route between two coordinates
     */
    findRoute(startCoords, endCoords, startFloorId, endFloorId, options = {}) {
        if (!this.initialized) {
            throw new Error('PathfindingEngine not initialized. Call initialize() first.');
        }

        // Check cache first (skip if useCache is explicitly false)
        if (options.useCache !== false) {
            const cached = this.pathCache.get(startCoords, endCoords, startFloorId, endFloorId, options);
            if (cached) {
                return cached;
            }
        }

        console.log(`Finding route from ${startFloorId} to ${endFloorId}...`);

        // 1. Find nearest nodes to start and end coordinates
        this.lastRouteError = null;
        const snapToDoors = options.snapToDoors !== false;
        const allowLockedDoors = options.allowLockedDoors === true;
        const roomTraversalMode = options.roomTraversalMode || 'public';
        const publicRoomDoorCount = Number.isFinite(options.publicRoomDoorCount)
            ? options.publicRoomDoorCount
            : 2;
        const publicRoomArea = Number.isFinite(options.publicRoomArea)
            ? options.publicRoomArea
            : 80;

        const startRoom = snapToDoors ? this.findRoomAtPoint(startCoords, startFloorId) : null;
        const endRoom = snapToDoors ? this.findRoomAtPoint(endCoords, endFloorId) : null;
        const sameRoom = startRoom && endRoom && startRoom.geometryId === endRoom.geometryId;

        const isPublicRoom = (meta) => {
            if (!meta) return false;
            if (meta.publicDoorCount >= publicRoomDoorCount) return true;
            if (meta.doorCount >= Math.max(2, publicRoomDoorCount)) return true;
            return meta.area >= publicRoomArea;
        };

        const startRoomMeta = startRoom ? this.roomMeta.get(startRoom.geometryId) : null;
        const endRoomMeta = endRoom ? this.roomMeta.get(endRoom.geometryId) : null;
        const startRoomIsPublic = startRoom ? isPublicRoom(startRoomMeta) : false;
        const endRoomIsPublic = endRoom ? isPublicRoom(endRoomMeta) : false;

        const buildAllowedRoomIds = (mode) => {
            const allowedRoomIds = new Set();
            if (startRoom) allowedRoomIds.add(startRoom.geometryId);
            if (endRoom) allowedRoomIds.add(endRoom.geometryId);

            if (mode === 'public') {
                this.roomMeta.forEach((meta, roomId) => {
                    if (isPublicRoom(meta)) {
                        allowedRoomIds.add(roomId);
                    }
                });
            }

            const explicitAllowed = options.allowedRoomIds;
            if (explicitAllowed) {
                const values = explicitAllowed instanceof Set ? Array.from(explicitAllowed) : explicitAllowed;
                values.forEach(id => allowedRoomIds.add(id));
            }

            return allowedRoomIds;
        };

        const useRoomConstraints = roomTraversalMode !== 'all';
        const allowedRoomIds = useRoomConstraints ? buildAllowedRoomIds(roomTraversalMode) : null;
        const hasAllowedRooms = allowedRoomIds && allowedRoomIds.size > 0;
        const applyRoomConstraints = useRoomConstraints && hasAllowedRooms;

        const routeOptions = {
            ...options,
            disallowOtherRooms: applyRoomConstraints,
            allowedRoomIds: applyRoomConstraints ? Array.from(allowedRoomIds) : null,
            nodeFilter: (node) => {
                const userFilter = typeof options.nodeFilter === 'function' ? options.nodeFilter : null;
                if (userFilter && !userFilter(node)) return false;
                if (!allowLockedDoors && node?.metadata?.isDoor && node?.metadata?.isLocked) {
                    return false;
                }
                return true;
            }
        };

        if (sameRoom) {
            if (this.collisionDetector.isPathClear(startCoords, endCoords, startFloorId)) {
                const distance = turf.distance(turf.point(startCoords), turf.point(endCoords), { units: 'meters' });
                return {
                    path: [startCoords, endCoords],
                    nodeIds: [],
                    distance,
                    floors: [startFloorId, endFloorId],
                    segments: [{
                        from: 'start',
                        to: 'end',
                        fromCoords: startCoords,
                        toCoords: endCoords,
                        distance,
                        floorChange: false,
                        fromFloor: startFloorId,
                        toFloor: endFloorId
                    }],
                    startNode: null,
                    endNode: null,
                    meta: {
                        startCoords,
                        endCoords,
                        startFloorId,
                        endFloorId,
                        startRoomId: startRoom.geometryId,
                        endRoomId: endRoom.geometryId,
                        sameRoom: true
                    }
                };
            }

            this.setRouteError('no-path', 'No clear path inside this room.');
            return null;
        }

        const startNode = this.findNearestWalkableNode(startCoords, startFloorId)
            || this.graph.findNearestNode(startCoords, startFloorId);
        const endNode = this.findNearestWalkableNode(endCoords, endFloorId)
            || this.graph.findNearestNode(endCoords, endFloorId);

        // Door-based anchoring is only required for "private" rooms (corridors/lobbies are treated as open).
        const useDoorsForStart = Boolean(startRoom && !startRoomIsPublic);
        const useDoorsForEnd = Boolean(endRoom && !endRoomIsPublic);

        const startDoorResult = useDoorsForStart ? this.getRoomDoorCandidates(startRoom, allowLockedDoors) : null;
        const endDoorResult = useDoorsForEnd ? this.getRoomDoorCandidates(endRoom, allowLockedDoors) : null;

        if (useDoorsForStart && startDoorResult && startDoorResult.available.length === 0) {
            const message = startDoorResult.total > 0
                ? 'All doors are locked for the start room.'
                : 'No doors found for the start room.';
            this.setRouteError('no-door', message);
            return null;
        }

        if (useDoorsForEnd && endDoorResult && endDoorResult.available.length === 0) {
            const message = endDoorResult.total > 0
                ? 'All doors are locked for the destination room.'
                : 'No doors found for the destination room.';
            this.setRouteError('no-door', message);
            return null;
        }

        // STEP 2: Build initial candidate lists
        let startCandidates = [];
        let endCandidates = [];

        const pushUnique = (list, nodes) => {
            const nodeList = Array.isArray(nodes) ? nodes : [nodes];
            nodeList.forEach(node => {
                if (!node) return;
                if (list.some(existing => existing.id === node.id)) return;
                list.push(node);
            });
        };

        // Always include nearest walkable nodes; include door candidates when needed (private rooms)
        if (startNode) {
            pushUnique(startCandidates, startNode);
        }
        if (startDoorResult?.available?.length) {
            pushUnique(startCandidates, startDoorResult.available);
        }

        if (endNode) {
            pushUnique(endCandidates, endNode);
        }
        if (endDoorResult?.available?.length) {
            pushUnique(endCandidates, endDoorResult.available);
        }

        // STEP 3: Filter to connectable candidates (strict check first)
        let startConnectable = startCandidates.filter(candidate =>
            this.isConnectorClear(startCoords, candidate.coords, startFloorId)
        );
        let endConnectable = endCandidates.filter(candidate =>
            this.isConnectorClear(endCoords, candidate.coords, endFloorId)
        );

        // STEP 4: FALLBACK - If blocked, try relaxed collision check
        if (startConnectable.length === 0 && startCandidates.length > 0) {
            console.log('  Fallback 1: Trying relaxed collision check for start...');
            startConnectable = startCandidates.filter(candidate =>
                this.collisionDetector.isPathClearRelaxed(startCoords, candidate.coords, startFloorId)
            );
        }
        if (endConnectable.length === 0 && endCandidates.length > 0) {
            console.log('  Fallback 1: Trying relaxed collision check for end...');
            endConnectable = endCandidates.filter(candidate =>
                this.collisionDetector.isPathClearRelaxed(endCoords, candidate.coords, endFloorId)
            );
        }

        if (startConnectable.length === 0 && startRoom && startCandidates.length > 0) {
            console.log('  Fallback 1b: Using door candidates inside the start room (no line-of-sight).');
            startConnectable = startCandidates;
        }

        if (endConnectable.length === 0 && endRoom && endCandidates.length > 0) {
            console.log('  Fallback 1b: Using door candidates inside the destination room (no line-of-sight).');
            endConnectable = endCandidates;
        }

        // STEP 5: FALLBACK - If still blocked, find ANY nearby walkable nodes
        if (startConnectable.length === 0) {
            if (!startRoom) {
                console.log('  Fallback 2: Finding nearest walkable nodes for start...');
                const nearbyNodes = this.graph.findNearestNodesInRadius(startCoords, startFloorId, 0.002, 10);

                // Try each nearby node with relaxed collision check
                startConnectable = nearbyNodes.filter(node =>
                    this.collisionDetector.isPathClearRelaxed(startCoords, node.coords, startFloorId)
                );

                // If still nothing, use expanded search with no collision check (trust the graph)
                if (startConnectable.length === 0) {
                    console.log('  Fallback 3: Using expanded search for start (no collision check)...');
                    const expandedNode = this.graph.findNearestNodeExpanded(startCoords, startFloorId);
                    if (expandedNode) {
                        startConnectable = [expandedNode];
                    }
                }
            }
        }

        if (endConnectable.length === 0) {
            if (!endRoom) {
                console.log('  Fallback 2: Finding nearest walkable nodes for end...');
                const nearbyNodes = this.graph.findNearestNodesInRadius(endCoords, endFloorId, 0.002, 10);

                endConnectable = nearbyNodes.filter(node =>
                    this.collisionDetector.isPathClearRelaxed(endCoords, node.coords, endFloorId)
                );

                if (endConnectable.length === 0) {
                    console.log('  Fallback 3: Using expanded search for end (no collision check)...');
                    const expandedNode = this.graph.findNearestNodeExpanded(endCoords, endFloorId);
                    if (expandedNode) {
                        endConnectable = [expandedNode];
                    }
                }
            }
        }

        // Final check - if still no candidates found
        if (startConnectable.length === 0) {
            this.setRouteError('blocked', 'Cannot find a path from this location. Try clicking closer to a walkable area.');
            return null;
        }

        if (endConnectable.length === 0) {
            this.setRouteError('blocked', 'Cannot find a path to this destination. Try clicking closer to a walkable area.');
            return null;
        }

        const findBestPath = (optionsForPath) => {
            let best = null;
            let bestStart = null;
            let bestEnd = null;
            let bestDistance = Infinity;

            startConnectable.forEach(startCandidate => {
                endConnectable.forEach(endCandidate => {
                    const path = this.aStar.findPath(startCandidate.id, endCandidate.id, optionsForPath);
                    if (!path) return;

                    const startConnectorDistance = turf.distance(
                        turf.point(startCoords),
                        turf.point(startCandidate.coords),
                        { units: 'meters' }
                    );
                    const endConnectorDistance = turf.distance(
                        turf.point(endCoords),
                        turf.point(endCandidate.coords),
                        { units: 'meters' }
                    );

                    const totalDistance = path.distance + startConnectorDistance + endConnectorDistance;

                    if (totalDistance < bestDistance) {
                        best = path;
                        bestStart = startCandidate;
                        bestEnd = endCandidate;
                        bestDistance = totalDistance;
                    }
                });
            });

            return best ? { best, bestStart, bestEnd, bestDistance } : null;
        };

        let attempt = findBestPath(routeOptions);
        let effectiveTraversalMode = applyRoomConstraints ? roomTraversalMode : 'all';

        if (!attempt && applyRoomConstraints) {
            const relaxedOptions = {
                ...routeOptions,
                disallowOtherRooms: false,
                allowedRoomIds: null
            };
            attempt = findBestPath(relaxedOptions);
            if (attempt) {
                effectiveTraversalMode = 'all';
            }
        }

        if (!attempt) {
            this.setRouteError('no-path', 'No path available from this location.');
            return null;
        }

        const { best, bestStart, bestEnd, bestDistance } = attempt;

        if (bestStart) {
            console.log(`  Start node: ${bestStart.id}`);
        }
        if (bestEnd) {
            console.log(`  End node: ${bestEnd.id}`);
        }

        // 2. Run A* pathfinding
        console.log(`  Path found: ${best.nodeIds.length} nodes, ${bestDistance.toFixed(2)}m`);

        const route = {
            path: best.coords,
            nodeIds: best.nodeIds,
            distance: bestDistance,
            floors: best.floors,
            segments: best.segments,
            startNode: bestStart,
            endNode: bestEnd,
            meta: {
                startCoords,
                endCoords,
                startFloorId,
                endFloorId,
                startRoomId: startRoom?.geometryId || null,
                endRoomId: endRoom?.geometryId || null,
                startDoorId: bestStart?.metadata?.isDoor ? bestStart.id : null,
                endDoorId: bestEnd?.metadata?.isDoor ? bestEnd.id : null,
                roomTraversalMode: effectiveTraversalMode
            }
        };

        // Store in cache for future lookups
        if (options.useCache !== false) {
            this.pathCache.set(startCoords, endCoords, startFloorId, endFloorId, options, route);
        }

        return route;
    }

    /**
     * Generate turn-by-turn instructions for a route
     */
    generateInstructions(route) {
        return this.instructionGenerator.generateInstructions(route);
    }

    /**
     * Get formatted text instructions for a route
     */
    getTextInstructions(route) {
        const instructions = this.generateInstructions(route);
        return this.instructionGenerator.formatAsText(instructions);
    }

    /**
     * Clear the path cache
     */
    clearCache() {
        this.pathCache.clear();
    }

    /**
     * Get cache statistics
     */
    getCacheStats() {
        return this.pathCache.getStats();
    }

    /**
     * Find an accessible route (no stairs)
     */
    findAccessibleRoute(startCoords, endCoords, startFloorId, endFloorId) {
        return this.findRoute(startCoords, endCoords, startFloorId, endFloorId, {
            accessibleOnly: true,
            avoidStairs: true
        });
    }

    /**
     * Get the graph for external use (debugging, visualization)
     */
    getGraph() {
        return this.graph;
    }

    /**
     * Get collision detector for external use
     */
    getCollisionDetector() {
        return this.collisionDetector;
    }

    /**
     * Find nearest walkable node on a floor (uses pre-indexed walkable nodes)
     */
    findNearestWalkableNode(coords, floorId) {
        const nodes = this.walkableNodesByFloor.get(floorId);
        if (!nodes || nodes.length === 0) return null;

        let nearest = null;
        let minDistSq = Infinity;
        const [lng, lat] = coords;

        nodes.forEach(node => {
            const dx = node.coords[0] - lng;
            const dy = node.coords[1] - lat;
            const distSq = dx * dx + dy * dy;
            if (distSq < minDistSq) {
                minDistSq = distSq;
                nearest = node;
            }
        });

        return nearest;
    }

    /**
     * Snap arbitrary coords to the nearest walkable node (returns null if too far)
     */
    snapToWalkableNode(coords, floorId, maxDistanceMeters = 6) {
        const nearest = this.findNearestWalkableNode(coords, floorId);
        if (!nearest) return null;

        const dx = nearest.coords[0] - coords[0];
        const dy = nearest.coords[1] - coords[1];
        const distMeters = Math.sqrt(dx * dx + dy * dy) * 111320;

        if (distMeters > maxDistanceMeters) return null;

        return {
            node: nearest,
            coords: nearest.coords,
            distanceMeters: distMeters
        };
    }

    getLastRouteError() {
        return this.lastRouteError;
    }

    setRouteError(code, message) {
        this.lastRouteError = { code, message };
    }

    buildGeometryIndex(geometry) {
        this.geometryIndex.clear();
        geometry.features.forEach(feature => {
            const geometryId = feature.properties?.id;
            if (geometryId) {
                this.geometryIndex.set(geometryId, feature);
            }
        });
    }

    buildRoomIndex(geometry, kindsData) {
        const roomIndex = new Map();
        if (!kindsData) return roomIndex;

        geometry.features.forEach(feature => {
            const geometryId = feature.properties?.id;
            const floorId = feature.properties?.floorId;
            const kind = geometryId ? kindsData[geometryId] : null;
            if (!floorId || kind !== 'room') return;

            if (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon') {
                return;
            }

            let buffered = null;
            try {
                buffered = turf.buffer(feature, 0.3, { units: 'meters' });
            } catch (e) {
                buffered = null;
            }

            if (!roomIndex.has(floorId)) {
                roomIndex.set(floorId, []);
            }

            const bboxSource = buffered || feature;
            roomIndex.get(floorId).push({
                geometryId,
                floorId,
                feature,
                buffer: buffered,
                bbox: turf.bbox(bboxSource)
            });
        });

        return roomIndex;
    }

    addDoorNodes(connections, navigationFlags) {
        const doorAccess = new Map();
        const publicBit = navigationFlags?.public?.bit ?? null;

        connections.forEach(conn => {
            if (conn.type !== 'door') return;
            (conn.entrances || []).forEach(entry => {
                if (!entry?.geometryId) return;
                const flagValue = Array.isArray(entry.flags) ? entry.flags[0] ?? 0 : entry.flags ?? 0;
                const isPublic = publicBit == null ? true : ((flagValue & (1 << publicBit)) !== 0);
                const current = doorAccess.get(entry.geometryId);
                if (!current) {
                    doorAccess.set(entry.geometryId, {
                        floorId: entry.floorId || null,
                        isPublic,
                        flagValue
                    });
                } else {
                    current.isPublic = current.isPublic || isPublic;
                    current.flagValue = current.flagValue | flagValue;
                    if (!current.floorId && entry.floorId) {
                        current.floorId = entry.floorId;
                    }
                }
            });
        });

        doorAccess.forEach((access, geometryId) => {
            const feature = this.geometryIndex.get(geometryId);
            const floorId = access.floorId || feature?.properties?.floorId;
            const coords = feature ? this.getFeatureCenter(feature) : null;
            if (!coords || !floorId) return;

            const nodeId = `door_${geometryId}`;
            const node = this.graph.addNode(nodeId, coords, floorId, {
                geometryIds: [geometryId],
                type: 'door',
                isDoor: true,
                isPublic: access.isPublic,
                isLocked: !access.isPublic,
                flags: access.flagValue
            });
            this.doorNodes.push(node);

            if (!this.doorNodesByFloor.has(floorId)) {
                this.doorNodesByFloor.set(floorId, []);
            }
            this.doorNodesByFloor.get(floorId).push(node);

            if (feature && (feature.geometry.type === 'LineString' || feature.geometry.type === 'MultiLineString')) {
                if (!this.doorSegmentsByFloor.has(floorId)) {
                    this.doorSegmentsByFloor.set(floorId, []);
                }
                this.doorSegmentsByFloor.get(floorId).push(feature);
            }
        });
    }

    getFeatureCenter(feature) {
        const geometry = feature.geometry;
        if (!geometry) return null;

        if (geometry.type === 'Point') {
            return geometry.coordinates;
        }

        if (geometry.type === 'LineString') {
            const mid = Math.floor(geometry.coordinates.length / 2);
            return geometry.coordinates[mid];
        }

        if (geometry.type === 'MultiLineString') {
            const lines = geometry.coordinates;
            if (!Array.isArray(lines) || lines.length === 0) {
                return null;
            }

            let longest = lines[0] || [];
            for (const line of lines) {
                if (Array.isArray(line) && line.length > longest.length) {
                    longest = line;
                }
            }

            if (!Array.isArray(longest) || longest.length === 0) {
                return null;
            }

            const mid = Math.floor(longest.length / 2);
            return longest[mid];
        }

        if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') {
            return turf.centroid(feature).geometry.coordinates;
        }

        return null;
    }

    buildRoomDoorIndex() {
        const roomDoorIndex = new Map();

        this.doorNodes.forEach(door => {
            const rooms = this.roomIndex.get(door.floorId) || [];
            if (rooms.length === 0) return;

            const point = turf.point(door.coords);
            const doorRooms = [];
            rooms.forEach(room => {
                if (this.isPointInRoom(point, room)) {
                    if (!roomDoorIndex.has(room.geometryId)) {
                        roomDoorIndex.set(room.geometryId, []);
                    }
                    roomDoorIndex.get(room.geometryId).push(door);
                    doorRooms.push(room.geometryId);
                }
            });

            if (doorRooms.length) {
                door.metadata.roomIds = doorRooms;
                door.metadata.roomId = doorRooms[0];
            }
        });

        return roomDoorIndex;
    }

    buildRoomMeta() {
        const meta = new Map();
        this.roomIndex.forEach(rooms => {
            rooms.forEach(room => {
                const roomId = room.geometryId;
                const doors = this.roomDoorIndex.get(roomId) || [];
                const publicDoors = doors.filter(door => door.metadata?.isPublic);
                let area = 0;
                try {
                    area = turf.area(room.feature);
                } catch (e) {
                    area = 0;
                }
                meta.set(roomId, {
                    area,
                    doorCount: doors.length,
                    publicDoorCount: publicDoors.length
                });
            });
        });
        return meta;
    }

    tagNodesWithRooms() {
        this.graph.nodes.forEach(node => {
            if (node.metadata?.roomIds?.length) {
                return;
            }
            const room = this.findRoomAtPoint(node.coords, node.floorId);
            if (room) {
                node.metadata.roomIds = [room.geometryId];
                node.metadata.roomId = room.geometryId;
            }
        });
    }

    isPointInRoom(point, room) {
        const target = room.buffer || room.feature;
        if (!target) return false;
        try {
            return turf.booleanPointInPolygon(point, target);
        } catch (e) {
            return false;
        }
    }

    findRoomAtPoint(coords, floorId) {
        const rooms = this.roomIndex.get(floorId);
        if (!rooms || rooms.length === 0) return null;

        const [lng, lat] = coords;
        const point = turf.point(coords);

        for (const room of rooms) {
            const [minX, minY, maxX, maxY] = room.bbox;
            if (lng < minX || lng > maxX || lat < minY || lat > maxY) {
                continue;
            }
            if (this.isPointInRoom(point, room)) {
                return room;
            }
        }

        return null;
    }

    getRoomDoorCandidates(room, allowLockedDoors) {
        const doors = this.roomDoorIndex.get(room.geometryId) || [];
        const available = doors.filter(door => allowLockedDoors || !door.metadata.isLocked);
        const locked = doors.filter(door => door.metadata.isLocked);
        return {
            available,
            locked,
            total: doors.length
        };
    }

    isConnectorClear(startCoords, endCoords, floorId) {
        return this.collisionDetector.isPathClear(startCoords, endCoords, floorId);
    }

    connectOrphanDoors(maxDistance = 6) {
        this.doorNodes.forEach(door => {
            const edges = this.graph.getEdges(door.id);
            if (edges && edges.length > 0) return;

            const candidates = this.graph.getNodesOnFloor(door.floorId).filter(node => node.id !== door.id);
            let best = null;
            let bestDistance = Infinity;

            candidates.forEach(node => {
                const distance = turf.distance(turf.point(door.coords), turf.point(node.coords), { units: 'meters' });
                if (distance > maxDistance) return;
                if (!this.collisionDetector.isPathClear(door.coords, node.coords, door.floorId)) return;
                if (distance < bestDistance) {
                    bestDistance = distance;
                    best = node;
                }
            });

            if (!best) {
                candidates.forEach(node => {
                    const distance = turf.distance(turf.point(door.coords), turf.point(node.coords), { units: 'meters' });
                    if (distance < bestDistance && distance <= maxDistance) {
                        bestDistance = distance;
                        best = node;
                    }
                });
            }

            if (best) {
                this.graph.addBidirectionalEdge(door.id, best.id, bestDistance, {
                    type: 'door-link',
                    accessible: true
                });
            }
        });
    }
}
