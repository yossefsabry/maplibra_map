import * as turf from '@turf/turf';

/**
 * MinHeap - Priority queue for A* algorithm
 * Provides O(log n) insert and extract-min operations
 */
class MinHeap {
    constructor() {
        this.heap = [];
    }

    push(item) {
        this.heap.push(item);
        this.bubbleUp(this.heap.length - 1);
    }

    pop() {
        if (this.heap.length === 0) return null;
        if (this.heap.length === 1) return this.heap.pop();

        const min = this.heap[0];
        this.heap[0] = this.heap.pop();
        this.bubbleDown(0);
        return min;
    }

    bubbleUp(index) {
        while (index > 0) {
            const parentIndex = Math.floor((index - 1) / 2);
            if (this.heap[index].priority >= this.heap[parentIndex].priority) break;

            [this.heap[index], this.heap[parentIndex]] = [this.heap[parentIndex], this.heap[index]];
            index = parentIndex;
        }
    }

    bubbleDown(index) {
        while (true) {
            const leftChild = 2 * index + 1;
            const rightChild = 2 * index + 2;
            let smallest = index;

            if (leftChild < this.heap.length &&
                this.heap[leftChild].priority < this.heap[smallest].priority) {
                smallest = leftChild;
            }

            if (rightChild < this.heap.length &&
                this.heap[rightChild].priority < this.heap[smallest].priority) {
                smallest = rightChild;
            }

            if (smallest === index) break;

            [this.heap[index], this.heap[smallest]] = [this.heap[smallest], this.heap[index]];
            index = smallest;
        }
    }

    isEmpty() {
        return this.heap.length === 0;
    }
}

/**
 * A* Pathfinding Algorithm
 * Uses heuristic-guided search to find optimal paths
 */
export class AStar {
    constructor(graph) {
        this.graph = graph;
    }

    /**
     * Find shortest path between two nodes
     */
    findPath(startNodeId, endNodeId, options = {}) {
        const {
            accessibleOnly = false,
            avoidStairs = false,
            heuristicWeight = 1.0,
            allowedRoomIds = null,
            disallowOtherRooms = false,
            nodeFilter = null
        } = options;

        const startNode = this.graph.getNode(startNodeId);
        const endNode = this.graph.getNode(endNodeId);

        if (!startNode || !endNode) {
            console.error('Start or end node not found');
            return null;
        }

        // Priority queue (open set)
        const openSet = new MinHeap();
        const closedSet = new Set();

        // Cost tracking
        const gScore = new Map(); // Cost from start to node
        const fScore = new Map(); // Estimated total cost
        const cameFrom = new Map(); // Path reconstruction

        // Initialize
        gScore.set(startNodeId, 0);
        const h = this.heuristic(startNode, endNode);
        fScore.set(startNodeId, h);

        openSet.push({
            nodeId: startNodeId,
            priority: h
        });

        const allowedRoomSet = allowedRoomIds
            ? (allowedRoomIds instanceof Set ? allowedRoomIds : new Set(allowedRoomIds))
            : null;

        const isRoomAllowed = (node) => {
            if (!disallowOtherRooms) return true;

            const metadata = node?.metadata || {};

            // ALWAYS allow connection nodes (elevators, stairs, doors) - they enable floor changes
            if (metadata.isElevator || metadata.isStairs || metadata.isDoor) {
                return true;
            }

            const roomIds = metadata.roomIds || (metadata.roomId ? [metadata.roomId] : []);

            // If node has no room restrictions, allow it (it's a public walkway)
            if (!roomIds || roomIds.length === 0) return true;

            // If no room filter specified, allow the node
            if (!allowedRoomSet || allowedRoomSet.size === 0) return true;

            return roomIds.some(id => allowedRoomSet.has(id));
        };

        const isNodeAllowed = (node) => {
            if (!node) return false;
            if (nodeFilter && !nodeFilter(node)) return false;
            return isRoomAllowed(node);
        };

        while (!openSet.isEmpty()) {
            const current = openSet.pop();
            const currentId = current.nodeId;

            // Goal reached
            if (currentId === endNodeId) {
                return this.reconstructPath(cameFrom, currentId, gScore);
            }

            // Already processed
            if (closedSet.has(currentId)) continue;
            closedSet.add(currentId);

            // Explore neighbors
            const edges = this.graph.getEdges(currentId);
            const currentNode = this.graph.getNode(currentId);

            for (const edge of edges) {
                // Apply filters
                if (accessibleOnly && !edge.accessible) continue;
                if (avoidStairs && edge.type === 'stairs') continue;

                const neighborId = edge.target;
                if (closedSet.has(neighborId)) continue;

                const neighborNode = this.graph.getNode(neighborId);
                if (!neighborNode) continue;
                if (!isNodeAllowed(neighborNode)) continue;

                // Calculate tentative g score
                const distance = edge.weight ?? turf.distance(
                    turf.point(currentNode.coords),
                    turf.point(neighborNode.coords),
                    { units: 'meters' }
                );

                const tentativeG = gScore.get(currentId) + distance;

                // Check if this path is better
                if (tentativeG < (gScore.get(neighborId) || Infinity)) {
                    cameFrom.set(neighborId, currentId);
                    gScore.set(neighborId, tentativeG);

                    const h = this.heuristic(neighborNode, endNode) * heuristicWeight;
                    const f = tentativeG + h;
                    fScore.set(neighborId, f);

                    openSet.push({
                        nodeId: neighborId,
                        priority: f
                    });
                }
            }
        }

        // No path found
        console.warn('No path found between nodes');
        return null;
    }

    /**
     * Bidirectional A* - searches from both ends simultaneously
     * ~2x faster for long routes by reducing search space
     */
    findPathBidirectional(startNodeId, endNodeId, options = {}) {
        const {
            accessibleOnly = false,
            avoidStairs = false,
            heuristicWeight = 1.0,
            allowedRoomIds = null,
            disallowOtherRooms = false,
            nodeFilter = null
        } = options;

        const startNode = this.graph.getNode(startNodeId);
        const endNode = this.graph.getNode(endNodeId);

        if (!startNode || !endNode) {
            console.error('Start or end node not found');
            return null;
        }

        // Forward search (start → end)
        const forwardOpen = new MinHeap();
        const forwardClosed = new Set();
        const forwardG = new Map();
        const forwardCameFrom = new Map();

        // Backward search (end → start)
        const backwardOpen = new MinHeap();
        const backwardClosed = new Set();
        const backwardG = new Map();
        const backwardCameFrom = new Map();

        // Initialize forward
        forwardG.set(startNodeId, 0);
        forwardOpen.push({ nodeId: startNodeId, priority: this.heuristic(startNode, endNode) });

        // Initialize backward
        backwardG.set(endNodeId, 0);
        backwardOpen.push({ nodeId: endNodeId, priority: this.heuristic(endNode, startNode) });

        const allowedRoomSet = allowedRoomIds
            ? (allowedRoomIds instanceof Set ? allowedRoomIds : new Set(allowedRoomIds))
            : null;

        const isRoomAllowed = (node) => {
            if (!disallowOtherRooms) return true;
            const metadata = node?.metadata || {};
            const roomIds = metadata.roomIds || (metadata.roomId ? [metadata.roomId] : []);
            if (!roomIds || roomIds.length === 0) return true;
            if (!allowedRoomSet || allowedRoomSet.size === 0) return false;
            return roomIds.some(id => allowedRoomSet.has(id));
        };

        const isNodeAllowed = (node) => {
            if (!node) return false;
            if (nodeFilter && !nodeFilter(node)) return false;
            return isRoomAllowed(node);
        };

        let bestPath = null;
        let bestDistance = Infinity;
        let meetingNode = null;

        // Alternating expansion
        while (!forwardOpen.isEmpty() || !backwardOpen.isEmpty()) {
            // Expand forward
            if (!forwardOpen.isEmpty()) {
                const current = forwardOpen.pop();
                const currentId = current.nodeId;

                if (!forwardClosed.has(currentId)) {
                    forwardClosed.add(currentId);

                    // Check if we met the backward search
                    if (backwardClosed.has(currentId)) {
                        const totalDist = forwardG.get(currentId) + backwardG.get(currentId);
                        if (totalDist < bestDistance) {
                            bestDistance = totalDist;
                            meetingNode = currentId;
                        }
                    }

                    // Expand neighbors
                    const edges = this.graph.getEdges(currentId);
                    const currentNode = this.graph.getNode(currentId);

                    for (const edge of edges) {
                        if (accessibleOnly && !edge.accessible) continue;
                        if (avoidStairs && edge.type === 'stairs') continue;

                        const neighborId = edge.target;
                        if (forwardClosed.has(neighborId)) continue;

                        const neighborNode = this.graph.getNode(neighborId);
                        if (!neighborNode || !isNodeAllowed(neighborNode)) continue;

                        const distance = edge.weight ?? turf.distance(
                            turf.point(currentNode.coords),
                            turf.point(neighborNode.coords),
                            { units: 'meters' }
                        );

                        const tentativeG = forwardG.get(currentId) + distance;

                        if (tentativeG < (forwardG.get(neighborId) || Infinity)) {
                            forwardCameFrom.set(neighborId, currentId);
                            forwardG.set(neighborId, tentativeG);
                            const h = this.heuristic(neighborNode, endNode) * heuristicWeight;
                            forwardOpen.push({ nodeId: neighborId, priority: tentativeG + h });
                        }
                    }
                }
            }

            // Expand backward
            if (!backwardOpen.isEmpty()) {
                const current = backwardOpen.pop();
                const currentId = current.nodeId;

                if (!backwardClosed.has(currentId)) {
                    backwardClosed.add(currentId);

                    // Check if we met the forward search
                    if (forwardClosed.has(currentId)) {
                        const totalDist = forwardG.get(currentId) + backwardG.get(currentId);
                        if (totalDist < bestDistance) {
                            bestDistance = totalDist;
                            meetingNode = currentId;
                        }
                    }

                    // Expand neighbors (reverse edges)
                    const edges = this.graph.getEdges(currentId);
                    const currentNode = this.graph.getNode(currentId);

                    for (const edge of edges) {
                        if (accessibleOnly && !edge.accessible) continue;
                        if (avoidStairs && edge.type === 'stairs') continue;

                        const neighborId = edge.target;
                        if (backwardClosed.has(neighborId)) continue;

                        const neighborNode = this.graph.getNode(neighborId);
                        if (!neighborNode || !isNodeAllowed(neighborNode)) continue;

                        const distance = edge.weight ?? turf.distance(
                            turf.point(currentNode.coords),
                            turf.point(neighborNode.coords),
                            { units: 'meters' }
                        );

                        const tentativeG = backwardG.get(currentId) + distance;

                        if (tentativeG < (backwardG.get(neighborId) || Infinity)) {
                            backwardCameFrom.set(neighborId, currentId);
                            backwardG.set(neighborId, tentativeG);
                            const h = this.heuristic(neighborNode, startNode) * heuristicWeight;
                            backwardOpen.push({ nodeId: neighborId, priority: tentativeG + h });
                        }
                    }
                }
            }

            // Early termination: if best path found is better than any remaining possibility
            if (meetingNode && bestDistance < Infinity) {
                const forwardMin = forwardOpen.isEmpty() ? Infinity : forwardOpen.heap[0]?.priority || Infinity;
                const backwardMin = backwardOpen.isEmpty() ? Infinity : backwardOpen.heap[0]?.priority || Infinity;
                if (bestDistance <= forwardMin + backwardMin) {
                    break;
                }
            }
        }

        if (!meetingNode) {
            console.warn('No path found between nodes (bidirectional)');
            return null;
        }

        // Reconstruct path from both directions
        return this.reconstructBidirectionalPath(
            forwardCameFrom, backwardCameFrom,
            meetingNode, startNodeId, endNodeId,
            bestDistance
        );
    }

    /**
     * Reconstruct path from bidirectional search
     */
    reconstructBidirectionalPath(forwardCameFrom, backwardCameFrom, meetingNode, startId, endId, distance) {
        // Build forward path (start → meeting)
        const forwardPath = [];
        let current = meetingNode;
        while (current !== startId && forwardCameFrom.has(current)) {
            forwardPath.unshift(current);
            current = forwardCameFrom.get(current);
        }
        forwardPath.unshift(startId);

        // Build backward path (meeting → end)
        const backwardPath = [];
        current = meetingNode;
        while (current !== endId && backwardCameFrom.has(current)) {
            current = backwardCameFrom.get(current);
            backwardPath.push(current);
        }

        // Combine paths (avoid duplicating meeting node)
        const fullPath = [...forwardPath, ...backwardPath];

        // Convert to coordinates
        const nodes = fullPath.map(id => this.graph.getNode(id));
        const coords = nodes.map(node => node.coords);
        const floors = nodes.map(node => node.floorId);

        return {
            nodeIds: fullPath,
            nodes: nodes,
            coords: coords,
            floors: floors,
            distance: distance,
            segments: this.buildSegments(nodes)
        };
    }

    /**
     * Heuristic function - Euclidean distance with floor penalty
     */
    heuristic(nodeA, nodeB) {
        // Base distance
        const dist = turf.distance(
            turf.point(nodeA.coords),
            turf.point(nodeB.coords),
            { units: 'meters' }
        );

        // Add penalty for floor changes (encourages staying on same floor)
        const floorPenalty = (nodeA.floorId !== nodeB.floorId) ? 10 : 0;

        return dist + floorPenalty;
    }

    /**
     * Reconstruct path from came_from map
     */
    reconstructPath(cameFrom, currentId, gScore) {
        const path = [currentId];
        let current = currentId;

        while (cameFrom.has(current)) {
            current = cameFrom.get(current);
            path.unshift(current);
        }

        // Convert to coordinates and calculate metadata
        const nodes = path.map(id => this.graph.getNode(id));
        const coords = nodes.map(node => node.coords);
        const floors = nodes.map(node => node.floorId);

        // Calculate total distance
        const totalDistance = gScore.get(currentId);

        return {
            nodeIds: path,
            nodes: nodes,
            coords: coords,
            floors: floors,
            distance: totalDistance,
            segments: this.buildSegments(nodes)
        };
    }

    /**
     * Build path segments with floor change information
     */
    buildSegments(nodes) {
        const segments = [];

        for (let i = 0; i < nodes.length - 1; i++) {
            const from = nodes[i];
            const to = nodes[i + 1];

            const distance = turf.distance(
                turf.point(from.coords),
                turf.point(to.coords),
                { units: 'meters' }
            );

            segments.push({
                from: from.id,
                to: to.id,
                fromCoords: from.coords,
                toCoords: to.coords,
                distance: distance,
                floorChange: from.floorId !== to.floorId,
                fromFloor: from.floorId,
                toFloor: to.floorId
            });
        }

        return segments;
    }
}
