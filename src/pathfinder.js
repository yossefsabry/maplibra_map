import * as turf from '@turf/turf';

export class Pathfinder {
    constructor() {
        this.nodes = new Map(); // id -> node
        this.adjacencyList = new Map(); // id -> [{nodeId, cost}]
        this.geometryToNodeMap = new Map(); // geometryId -> nodeId
    }

    load(nodeFeatures, connections) {
        // 1. Add Nodes
        nodeFeatures.forEach(feature => {
            const id = feature.properties.id;
            const coords = feature.geometry.coordinates;
            const floorId = feature.properties.floorId;

            this.nodes.set(id, {
                id,
                coords,
                floorId,
                geometryIds: feature.properties.geometryIds || []
            });

            // Map geometry IDs to this node
            if (feature.properties.geometryIds) {
                feature.properties.geometryIds.forEach(geoId => {
                    this.geometryToNodeMap.set(geoId, id);
                });
            }

            // Initialize adjacency list
            if (!this.adjacencyList.has(id)) {
                this.adjacencyList.set(id, []);
            }

            // Add internal neighbors (same floor)
            if (feature.properties.neighbors) {
                feature.properties.neighbors.forEach(neighbor => {
                    // Calculate distance cost
                    // We need the neighbor's coordinates. 
                    // Since we might not have processed the neighbor yet, we store the edge and resolve cost later?
                    // Or just store the neighbor ID and resolve during pathfinding?
                    // Better: Store neighbor ID and extraCost.
                    this.adjacencyList.get(id).push({
                        nodeId: neighbor.id,
                        cost: 0, // Will calculate distance dynamically or in a second pass
                        extraCost: neighbor.extraCost || 0
                    });
                });
            }
        });

        // 2. Process Connections (Inter-floor)
        if (connections) {
            connections.forEach(conn => {
                // Link all entrances/exits to each other
                // Usually entrances <-> exits.
                // For simplicity, we link all nodes associated with this connection.

                const nodesInConnection = [];

                const processPoints = (points) => {
                    points.forEach(p => {
                        const nodeId = this.geometryToNodeMap.get(p.geometryId);
                        if (nodeId) {
                            nodesInConnection.push(nodeId);
                        }
                    });
                };

                if (conn.entrances) processPoints(conn.entrances);
                if (conn.exits) processPoints(conn.exits);

                // Create complete graph between these nodes (clique)
                // Or just link them sequentially? A clique is safer for elevators.
                for (let i = 0; i < nodesInConnection.length; i++) {
                    for (let j = i + 1; j < nodesInConnection.length; j++) {
                        const u = nodesInConnection[i];
                        const v = nodesInConnection[j];

                        const cost = conn.entryCost || 0; // Simplified cost

                        this.adjacencyList.get(u).push({ nodeId: v, cost: cost, extraCost: 0 });
                        this.adjacencyList.get(v).push({ nodeId: u, cost: cost, extraCost: 0 });
                    }
                }
            });
        }
    }

    findPath(startNodeId, endNodeId) {
        if (!this.nodes.has(startNodeId) || !this.nodes.has(endNodeId)) return null;

        const openSet = new Set([startNodeId]);
        const cameFrom = new Map();

        const gScore = new Map(); // Cost from start to current
        gScore.set(startNodeId, 0);

        const fScore = new Map(); // Estimated total cost
        fScore.set(startNodeId, this.heuristic(startNodeId, endNodeId));

        while (openSet.size > 0) {
            // Get node with lowest fScore
            let current = null;
            let minF = Infinity;

            for (const nodeId of openSet) {
                const score = fScore.get(nodeId) || Infinity;
                if (score < minF) {
                    minF = score;
                    current = nodeId;
                }
            }

            if (current === endNodeId) {
                return this.reconstructPath(cameFrom, current);
            }

            openSet.delete(current);

            const neighbors = this.adjacencyList.get(current) || [];
            for (const neighbor of neighbors) {
                const neighborNode = this.nodes.get(neighbor.nodeId);
                if (!neighborNode) continue;

                // Calculate distance cost
                const currentNode = this.nodes.get(current);
                const dist = turf.distance(
                    turf.point(currentNode.coords),
                    turf.point(neighborNode.coords),
                    { units: 'meters' }
                );

                const tentativeG = (gScore.get(current) || Infinity) + dist + neighbor.extraCost + (neighbor.cost || 0);

                if (tentativeG < (gScore.get(neighbor.nodeId) || Infinity)) {
                    cameFrom.set(neighbor.nodeId, current);
                    gScore.set(neighbor.nodeId, tentativeG);
                    fScore.set(neighbor.nodeId, tentativeG + this.heuristic(neighbor.nodeId, endNodeId));

                    openSet.add(neighbor.nodeId);
                }
            }
        }

        return null; // No path
    }

    heuristic(nodeAId, nodeBId) {
        const a = this.nodes.get(nodeAId);
        const b = this.nodes.get(nodeBId);
        // Simple Euclidean distance, ignoring floor difference for heuristic (or add penalty)
        return turf.distance(
            turf.point(a.coords),
            turf.point(b.coords),
            { units: 'meters' }
        );
    }

    reconstructPath(cameFrom, current) {
        const totalPath = [this.nodes.get(current)];
        while (cameFrom.has(current)) {
            current = cameFrom.get(current);
            totalPath.unshift(this.nodes.get(current));
        }
        return totalPath;
    }

    findNearestNode(lngLat, floorId) {
        let nearest = null;
        let minDist = Infinity;
        const point = turf.point([lngLat.lng, lngLat.lat]);

        this.nodes.forEach(node => {
            if (node.floorId === floorId) {
                const dist = turf.distance(point, turf.point(node.coords));
                if (dist < minDist) {
                    minDist = dist;
                    nearest = node;
                }
            }
        });

        return nearest;
    }

    getNodeByGeometryId(geometryId) {
        const nodeId = this.geometryToNodeMap.get(geometryId);
        return nodeId ? this.nodes.get(nodeId) : null;
    }
}
