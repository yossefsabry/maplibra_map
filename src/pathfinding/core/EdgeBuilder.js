/**
 * EdgeBuilder - Constructs edges between nodes using visibility graph algorithm
 * Ensures edges don't pass through walls or obstacles
 */
export class EdgeBuilder {
    constructor(collisionDetector) {
        this.collisionDetector = collisionDetector;
    }

    now() {
        if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
            return performance.now();
        }
        return Date.now();
    }

    yieldToMainThread() {
        return new Promise(resolve => {
            const idle = globalThis.requestIdleCallback;
            if (typeof idle === 'function') {
                idle(() => resolve(), { timeout: 200 });
                return;
            }
            setTimeout(resolve, 0);
        });
    }

    /**
     * Select the k nearest candidates to a node without sorting the full list.
     * O(n*k) with small k, faster than n log n.
     */
    selectNearestCandidates(nodeA, candidates, maxNeighbors) {
        const [lng, lat] = nodeA.coords;
        const best = [];
        let worstIndex = -1;
        let worstDistSq = -Infinity;

        for (const candidate of candidates) {
            if (candidate.id === nodeA.id) {
                continue;
            }
            const [cLng, cLat] = candidate.coords;
            const dx = cLng - lng;
            const dy = cLat - lat;
            const distSq = dx * dx + dy * dy;

            if (best.length < maxNeighbors) {
                best.push({ candidate, distSq });
                if (distSq > worstDistSq) {
                    worstDistSq = distSq;
                    worstIndex = best.length - 1;
                }
                continue;
            }

            if (distSq >= worstDistSq) {
                continue;
            }

            best[worstIndex] = { candidate, distSq };
            worstDistSq = -Infinity;
            worstIndex = -1;
            for (let i = 0; i < best.length; i++) {
                if (best[i].distSq > worstDistSq) {
                    worstDistSq = best[i].distSq;
                    worstIndex = i;
                }
            }
        }

        best.sort((a, b) => a.distSq - b.distSq);
        return best.map(item => item.candidate);
    }

    /**
     * Build edges for all nodes on a floor using visibility graph
     * OPTIMIZED: Uses spatial partitioning for O(n log n) instead of O(n²)
     */
    async buildEdgesForFloor(
        nodes,
        floorId,
        maxDistance = 15,
        spatialIndex = null,
        maxNeighbors = null,
        yieldEvery = null,
        yieldAfterMs = null
    ) {
        const edges = [];
        console.log(`Building edges for floor ${floorId} with ${nodes.length} nodes (maxDist: ${maxDistance}m)...`);

        // Convert maxDistance to approximate degrees (rough conversion for spatial queries)
        const maxDistDegrees = maxDistance / 111320; // ~1 degree = 111km
        const maxDistSqMeters = maxDistance * maxDistance;
        const metersPerDegreeLat = 111320;
        const radiansPerDegree = Math.PI / 180;
        const neighborLimit = Number.isFinite(maxNeighbors) ? maxNeighbors : null;
        const candidatePoolMultiplier = 6;
        const candidatePoolLimit = neighborLimit
            ? Math.max(neighborLimit, neighborLimit * candidatePoolMultiplier)
            : null;

        let lastYieldAt = this.now();

        // For each node, only check nearby nodes
        for (let index = 0; index < nodes.length; index++) {
            const nodeA = nodes[index];
            const [lng, lat] = nodeA.coords;
            const metersPerDegreeLng = Math.cos(lat * radiansPerDegree) * metersPerDegreeLat;

            // Get candidate neighbors from spatial query or nearby filter
            let candidates;
            if (spatialIndex && spatialIndex.quadTree) {
                // Use QuadTree for fast neighbor lookup
                const range = {
                    minX: lng - maxDistDegrees,
                    minY: lat - maxDistDegrees,
                    maxX: lng + maxDistDegrees,
                    maxY: lat + maxDistDegrees
                };
                candidates = spatialIndex.quadTree.query(range);
            } else {
                // Fallback: filter by bounding box
                candidates = nodes.filter(n => {
                    const [nLng, nLat] = n.coords;
                    return Math.abs(nLng - lng) <= maxDistDegrees &&
                        Math.abs(nLat - lat) <= maxDistDegrees;
                });
            }

            // NOTE:
            // If we limit to the nearest N candidates BEFORE line-of-sight checks, many candidates can be blocked
            // (across walls), which creates disconnected graphs and longer-than-needed routes.
            // Instead: oversample a candidate pool, then keep the first N that pass line-of-sight.
            if (candidatePoolLimit && candidates.length > candidatePoolLimit) {
                candidates = this.selectNearestCandidates(nodeA, candidates, candidatePoolLimit);
            }

            let addedForNode = 0;
            for (const nodeB of candidates) {
                // Skip self and already-processed pairs
                if (nodeB.id <= nodeA.id) continue;

                const dxMeters = (nodeB.coords[0] - lng) * metersPerDegreeLng;
                const dyMeters = (nodeB.coords[1] - lat) * metersPerDegreeLat;
                const distanceSqMeters = dxMeters * dxMeters + dyMeters * dyMeters;

                // Skip if too far (exact check)
                if (distanceSqMeters > maxDistSqMeters) continue;

                // Check line-of-sight
                if (this.hasLineOfSight(nodeA.coords, nodeB.coords, floorId)) {
                    const distance = Math.sqrt(distanceSqMeters);
                    // Add bidirectional edge
                    edges.push({
                        from: nodeA.id,
                        to: nodeB.id,
                        weight: distance,
                        type: 'walkable'
                    });
                    edges.push({
                        from: nodeB.id,
                        to: nodeA.id,
                        weight: distance,
                        type: 'walkable'
                    });

                    addedForNode += 1;
                    if (neighborLimit && addedForNode >= neighborLimit) {
                        break;
                    }
                }
            }

            if (yieldEvery && index % yieldEvery === 0) {
                await this.yieldToMainThread();
                lastYieldAt = this.now();
            } else if (yieldAfterMs && (this.now() - lastYieldAt) >= yieldAfterMs) {
                await this.yieldToMainThread();
                lastYieldAt = this.now();
            }
        }

        console.log(`  Created ${edges.length} edges`);
        return edges;
    }

    /**
     * Check if two points have line-of-sight (no obstacles between them)
     */
    hasLineOfSight(coordsA, coordsB, floorId) {
        return this.collisionDetector.isPathClear(coordsA, coordsB, floorId);
    }

    /**
     * Calculate Euclidean distance between two points
     */
    calculateDistance(coordsA, coordsB) {
        const [lng1, lat1] = coordsA;
        const [lng2, lat2] = coordsB;
        const metersPerDegreeLat = 111320;
        const radiansPerDegree = Math.PI / 180;
        const metersPerDegreeLng = Math.cos(((lat1 + lat2) / 2) * radiansPerDegree) * metersPerDegreeLat;

        const dxMeters = (lng2 - lng1) * metersPerDegreeLng;
        const dyMeters = (lat2 - lat1) * metersPerDegreeLat;
        return Math.sqrt(dxMeters * dxMeters + dyMeters * dyMeters);
    }

    /**
     * Build all edges for a graph
     */
    async buildAllEdges(
        graph,
        maxDistance = 15,
        maxNeighbors = null,
        yieldEvery = null,
        yieldAfterMs = null,
        options = {}
    ) {
        let totalEdges = 0;
        const collectEdges = options.collectEdges === true;
        const collectedEdges = collectEdges ? [] : null;
        const reportStatus = typeof options.onStatus === 'function' ? options.onStatus : null;
        const status = (message) => {
            if (!reportStatus) return;
            try {
                reportStatus(message);
            } catch (e) {
                // Ignore status callback errors.
            }
        };

        // Get all floors
        const floors = new Set();
        graph.nodes.forEach(node => floors.add(node.floorId));
        const floorList = Array.from(floors);

        // Build edges for each floor
        for (let floorIndex = 0; floorIndex < floorList.length; floorIndex++) {
            const floorId = floorList[floorIndex];
            const nodesOnFloor = graph.getNodesOnFloor(floorId);
            const spatialData = graph.spatialIndex.get(floorId);
            status(`Building edges (${floorIndex + 1}/${floorList.length}) for floor ${floorId}…`);
            const edges = await this.buildEdgesForFloor(
                nodesOnFloor,
                floorId,
                maxDistance,
                spatialData,
                maxNeighbors,
                yieldEvery,
                yieldAfterMs
            );
            status(`Built ${edges.length} visibility edges for floor ${floorId}.`);

            // Add edges to graph
            edges.forEach(edge => {
                graph.addEdge(edge.from, edge.to, edge.weight, {
                    type: edge.type
                });
            });

            totalEdges += edges.length;
            if (collectEdges) {
                collectedEdges.push(...edges);
            }
        }

        console.log(`Total edges built: ${totalEdges}`);
        return collectedEdges;
    }
}
