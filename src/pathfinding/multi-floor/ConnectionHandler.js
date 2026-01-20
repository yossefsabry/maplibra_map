/**
 * ConnectionHandler - Processes inter-floor connections (elevators, stairs, doors)
 * Adds appropriate edges to the graph for multi-floor navigation
 */
export class ConnectionHandler {
    constructor(graph) {
        this.graph = graph;
    }

    /**
     * Process all connections from MVF data
     */
    processConnections(connections) {
        console.log(`Processing ${connections.length} connections...`);

        let elevatorCount = 0;
        let stairCount = 0;
        let doorCount = 0;

        connections.forEach(conn => {
            if (conn.type === 'elevator') {
                this.addElevatorConnection(conn);
                elevatorCount++;
            } else if (conn.type === 'stairs') {
                this.addStairConnection(conn);
                stairCount++;
            } else if (conn.type === 'door') {
                this.addDoorConnection(conn);
                doorCount++;
            }
        });

        console.log(`  Elevators: ${elevatorCount}`);
        console.log(`  Stairs: ${stairCount}`);
        console.log(`  Doors: ${doorCount}`);
    }

    /**
     * Add elevator connection (fully connected clique)
     */
    addElevatorConnection(connection) {
        const nodes = this.getNodesFromConnection(connection);
        if (nodes.length < 2) return;

        // Create clique - connect all nodes to each other
        for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
                const nodeA = nodes[i];
                const nodeB = nodes[j];

                // Bidirectional edge
                const cost = connection.entryCost || 3000; // Elevator cost

                this.graph.addBidirectionalEdge(nodeA.id, nodeB.id, cost, {
                    type: 'elevator',
                    accessible: true, // Elevators are wheelchair accessible
                    connectionId: connection.id
                });
            }
        }
    }

    /**
     * Add stair connection (connect entrance/exit pairs)
     */
    addStairConnection(connection) {
        const nodes = this.getNodesFromConnection(connection);
        if (nodes.length < 2) return;

        // Connect all pairs (stairs connect between floors)
        for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
                const nodeA = nodes[i];
                const nodeB = nodes[j];

                // Bidirectional edge
                const cost = connection.entryCost || 1000; // Stair cost

                this.graph.addBidirectionalEdge(nodeA.id, nodeB.id, cost, {
                    type: 'stairs',
                    accessible: false, // Stairs are NOT wheelchair accessible
                    connectionId: connection.id
                });
            }
        }
    }

    /**
     * Add door connection (same floor, low cost)
     */
    addDoorConnection(connection) {
        const nodes = this.getNodesFromConnection(connection);
        if (nodes.length < 1) return;

        // Doors typically connect areas on the same floor
        // Low cost transition
        const cost = connection.entryCost || 100;

        // If multiple nodes, connect them
        if (nodes.length >= 2) {
            for (let i = 0; i < nodes.length; i++) {
                for (let j = i + 1; j < nodes.length; j++) {
                    const nodeA = nodes[i];
                    const nodeB = nodes[j];

                    this.graph.addBidirectionalEdge(nodeA.id, nodeB.id, cost, {
                        type: 'door',
                        accessible: true,
                        connectionId: connection.id
                    });
                }
            }
        }
    }

    /**
     * Get graph nodes from connection data
     */
    getNodesFromConnection(connection) {
        const nodes = [];
        const geometryIds = new Set();

        // Collect all geometry IDs from entrances and exits
        if (connection.entrances) {
            connection.entrances.forEach(entrance => {
                geometryIds.add(entrance.geometryId);
            });
        }

        if (connection.exits) {
            connection.exits.forEach(exit => {
                geometryIds.add(exit.geometryId);
            });
        }

        // Find corresponding nodes in graph
        geometryIds.forEach(geoId => {
            const node = this.graph.getNodeByGeometryId(geoId);
            if (node) {
                nodes.push(node);
            }
        });

        return nodes;
    }

    /**
     * Add tags to nodes based on connections
     */
    tagNodes(connections) {
        connections.forEach(conn => {
            const nodes = this.getNodesFromConnection(conn);

            nodes.forEach(node => {
                if (!node.metadata.connections) {
                    node.metadata.connections = [];
                }

                node.metadata.connections.push({
                    id: conn.id,
                    type: conn.type
                });

                // Set node type flags
                if (conn.type === 'elevator') {
                    node.metadata.isElevator = true;
                } else if (conn.type === 'stairs') {
                    node.metadata.isStairs = true;
                } else if (conn.type === 'door') {
                    node.metadata.isDoor = true;
                }
            });
        });
    }
}
