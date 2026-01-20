/**
 * QuadTree implementation for spatial indexing of nodes
 * Enables fast nearest-neighbor lookups
 */
class QuadTree {
    constructor(bounds, capacity = 4, maxDepth = 8, depth = 0) {
        this.bounds = bounds; // { minX, minY, maxX, maxY }
        this.capacity = capacity;
        this.maxDepth = maxDepth;
        this.depth = depth;
        this.nodes = [];
        this.divided = false;
        this.northwest = null;
        this.northeast = null;
        this.southwest = null;
        this.southeast = null;
    }

    insert(node) {
        if (!this.contains(node.coords)) {
            return false;
        }

        if (this.nodes.length < this.capacity || this.depth >= this.maxDepth) {
            this.nodes.push(node);
            return true;
        }

        if (!this.divided) {
            this.subdivide();
        }

        return (
            this.northwest.insert(node) ||
            this.northeast.insert(node) ||
            this.southwest.insert(node) ||
            this.southeast.insert(node)
        );
    }

    contains(coords) {
        const [lng, lat] = coords;
        return (
            lng >= this.bounds.minX &&
            lng <= this.bounds.maxX &&
            lat >= this.bounds.minY &&
            lat <= this.bounds.maxY
        );
    }

    subdivide() {
        const { minX, minY, maxX, maxY } = this.bounds;
        const midX = (minX + maxX) / 2;
        const midY = (minY + maxY) / 2;

        this.northwest = new QuadTree(
            { minX, minY: midY, maxX: midX, maxY },
            this.capacity,
            this.maxDepth,
            this.depth + 1
        );
        this.northeast = new QuadTree(
            { minX: midX, minY: midY, maxX, maxY },
            this.capacity,
            this.maxDepth,
            this.depth + 1
        );
        this.southwest = new QuadTree(
            { minX, minY, maxX: midX, maxY: midY },
            this.capacity,
            this.maxDepth,
            this.depth + 1
        );
        this.southeast = new QuadTree(
            { minX: midX, minY, maxX, maxY: midY },
            this.capacity,
            this.maxDepth,
            this.depth + 1
        );

        this.divided = true;
    }

    query(range, found = []) {
        if (!this.intersects(range)) {
            return found;
        }

        for (const node of this.nodes) {
            if (this.inRange(node.coords, range)) {
                found.push(node);
            }
        }

        if (this.divided) {
            this.northwest.query(range, found);
            this.northeast.query(range, found);
            this.southwest.query(range, found);
            this.southeast.query(range, found);
        }

        return found;
    }

    intersects(range) {
        return !(
            range.maxX < this.bounds.minX ||
            range.minX > this.bounds.maxX ||
            range.maxY < this.bounds.minY ||
            range.minY > this.bounds.maxY
        );
    }

    inRange(coords, range) {
        const [lng, lat] = coords;
        return (
            lng >= range.minX &&
            lng <= range.maxX &&
            lat >= range.minY &&
            lat <= range.maxY
        );
    }
}

/**
 * Graph data structure for pathfinding
 * Stores nodes and edges with spatial indexing
 */
export class Graph {
    constructor() {
        this.nodes = new Map(); // nodeId -> Node{ id, coords, floorId, type, metadata }
        this.edges = new Map(); // nodeId -> Edge[]{ target, weight, type, accessible }
        this.spatialIndex = new Map(); // floorId -> QuadTree<Node>
        this.geometryToNodeMap = new Map(); // geometryId -> nodeId
    }

    /**
     * Add a node to the graph
     */
    addNode(id, coords, floorId, metadata = {}) {
        const node = {
            id,
            coords, // [lng, lat]
            floorId,
            type: metadata.type || 'waypoint',
            metadata
        };

        this.nodes.set(id, node);

        // Initialize edge list for this node
        if (!this.edges.has(id)) {
            this.edges.set(id, []);
        }

        // Add to spatial index
        if (!this.spatialIndex.has(floorId)) {
            // Create QuadTree for this floor with approximate bounds
            // We'll update bounds as we add nodes
            this.spatialIndex.set(floorId, {
                quadTree: null,
                nodes: []
            });
        }

        this.spatialIndex.get(floorId).nodes.push(node);

        // Map geometry IDs to this node
        if (metadata.geometryIds) {
            metadata.geometryIds.forEach(geoId => {
                this.geometryToNodeMap.set(geoId, id);
            });
        }

        return node;
    }

    /**
     * Build QuadTrees for all floors after all nodes are added
     */
    buildSpatialIndexes() {
        this.spatialIndex.forEach((data, floorId) => {
            if (data.nodes.length === 0) return;

            // Calculate bounds for this floor
            let minX = Infinity, minY = Infinity;
            let maxX = -Infinity, maxY = -Infinity;

            data.nodes.forEach(node => {
                const [lng, lat] = node.coords;
                minX = Math.min(minX, lng);
                minY = Math.min(minY, lat);
                maxX = Math.max(maxX, lng);
                maxY = Math.max(maxY, lat);
            });

            // Add small padding
            const padding = 0.0001;
            const bounds = {
                minX: minX - padding,
                minY: minY - padding,
                maxX: maxX + padding,
                maxY: maxY + padding
            };

            // Create QuadTree and insert all nodes
            const quadTree = new QuadTree(bounds);
            data.nodes.forEach(node => quadTree.insert(node));
            data.quadTree = quadTree;
        });
    }

    /**
     * Get a node by ID
     */
    getNode(id) {
        return this.nodes.get(id);
    }

    /**
     * Add a directed edge from one node to another
     */
    addEdge(fromId, toId, weight, edgeMetadata = {}) {
        const edge = {
            target: toId,
            weight,
            type: edgeMetadata.type || 'walkable',
            accessible: edgeMetadata.accessible !== false, // Default true
            ...edgeMetadata
        };

        const edgeList = this.edges.get(fromId);
        if (edgeList) {
            edgeList.push(edge);
        }
    }

    /**
     * Add a bidirectional edge between two nodes
     */
    addBidirectionalEdge(nodeA, nodeB, weight, edgeMetadata = {}) {
        this.addEdge(nodeA, nodeB, weight, edgeMetadata);
        this.addEdge(nodeB, nodeA, weight, edgeMetadata);
    }

    /**
     * Get all edges from a node
     */
    getEdges(nodeId) {
        return this.edges.get(nodeId) || [];
    }

    /**
     * Get all nodes on a specific floor
     */
    getNodesOnFloor(floorId) {
        const data = this.spatialIndex.get(floorId);
        return data ? data.nodes : [];
    }

    /**
     * Find the nearest node to a point on a specific floor
     */
    findNearestNode(coords, floorId, maxDistance = 0.0005) {
        const data = this.spatialIndex.get(floorId);
        if (!data || !data.quadTree) return null;

        const [lng, lat] = coords;
        const range = {
            minX: lng - maxDistance,
            minY: lat - maxDistance,
            maxX: lng + maxDistance,
            maxY: lat + maxDistance
        };

        const candidates = data.quadTree.query(range);
        if (candidates.length === 0) return null;

        // Find closest candidate
        let nearest = null;
        let minDist = Infinity;

        candidates.forEach(node => {
            const [nodeLng, nodeLat] = node.coords;
            const dx = nodeLng - lng;
            const dy = nodeLat - lat;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < minDist) {
                minDist = dist;
                nearest = node;
            }
        });

        return nearest;
    }

    /**
     * Find nearest node with progressively expanding search radius
     * Used as fallback when initial search finds no nodes
     */
    findNearestNodeExpanded(coords, floorId, maxAttempts = 5) {
        // Progressive radii: ~55m, ~110m, ~220m, ~550m, ~1.1km
        const radii = [0.0005, 0.001, 0.002, 0.005, 0.01];

        for (let i = 0; i < Math.min(maxAttempts, radii.length); i++) {
            const node = this.findNearestNode(coords, floorId, radii[i]);
            if (node) {
                console.log(`  Found node at radius ${i + 1} (${radii[i]}°)`);
                return node;
            }
        }

        console.warn('No node found even with expanded search');
        return null;
    }

    /**
     * Find multiple nearest nodes within a radius (for multi-candidate routing)
     */
    findNearestNodesInRadius(coords, floorId, maxDistance = 0.001, maxNodes = 5) {
        const data = this.spatialIndex.get(floorId);
        if (!data || !data.quadTree) return [];

        const [lng, lat] = coords;
        const range = {
            minX: lng - maxDistance,
            minY: lat - maxDistance,
            maxX: lng + maxDistance,
            maxY: lat + maxDistance
        };

        const candidates = data.quadTree.query(range);
        if (candidates.length === 0) return [];

        // Sort by distance and return top candidates
        return candidates
            .map(node => {
                const [nodeLng, nodeLat] = node.coords;
                const dx = nodeLng - lng;
                const dy = nodeLat - lat;
                return { node, dist: Math.sqrt(dx * dx + dy * dy) };
            })
            .sort((a, b) => a.dist - b.dist)
            .slice(0, maxNodes)
            .map(item => item.node);
    }

    /**
     * Get a node by geometry ID
     */
    getNodeByGeometryId(geometryId) {
        const nodeId = this.geometryToNodeMap.get(geometryId);
        return nodeId ? this.nodes.get(nodeId) : null;
    }

    /**
     * Get graph statistics
     */
    getStats() {
        let totalEdges = 0;
        this.edges.forEach(edgeList => {
            totalEdges += edgeList.length;
        });

        return {
            nodeCount: this.nodes.size,
            edgeCount: totalEdges,
            floors: this.spatialIndex.size,
            avgEdgesPerNode: totalEdges / this.nodes.size
        };
    }
}
