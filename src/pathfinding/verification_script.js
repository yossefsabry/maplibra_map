/**
 * Verification Script for Pathfinding System
 * automated stress test to ensure 100% reliability
 */

export async function runVerification(pathfindingEngine) {
    console.group('🔍 Running Pathfinding Verification Suite');

    const yieldToMainThread = () => new Promise(resolve => {
        const idle = globalThis.requestIdleCallback;
        if (typeof idle === 'function') {
            idle(() => resolve(), { timeout: 200 });
            return;
        }
        setTimeout(resolve, 0);
    });

    const graph = pathfindingEngine.getGraph();
    const nodes = Array.from(graph.nodes.values());

    if (nodes.length === 0) {
        console.error('❌ Verification Failed: No nodes in graph');
        console.groupEnd();
        return;
    }

    console.log(`Graph contains ${nodes.length} nodes across ${new Set(nodes.map(n => n.floorId)).size} floors.`);

    // Test 1: Connectivity Check (Random Sampling)
    console.log('Test 1: Random Connectivity Stress Test (50 samples)...');
    let successCount = 0;
    const samples = 50;

    for (let i = 0; i < samples; i++) {
        // Pick random start/end
        const start = nodes[Math.floor(Math.random() * nodes.length)];
        const end = nodes[Math.floor(Math.random() * nodes.length)];

        // Skip if same node
        if (start.id === end.id) {
            i--;
            continue;
        }

        // Try to find path
        const result = pathfindingEngine.findRoute(
            start.coords,
            end.coords,
            start.floorId,
            end.floorId
        );

        if (result) {
            successCount++;
        } else {
            const error = pathfindingEngine.lastRouteError;
            const errorMsg = error ? `${error.code}: ${error.message}` : 'Unknown error';
            console.warn(`  ⚠️ Failed to find path from ${start.floorId} to ${end.floorId} | ${errorMsg}`);
        }

        // Yield periodically so the UI stays responsive during verification.
        if (i % 5 === 0) {
            await yieldToMainThread();
        }
    }

    const rate = (successCount / samples) * 100;
    console.log(`Connectivity Result: ${successCount}/${samples} (${rate}%)`);

    if (rate < 90) {
        console.error('❌ Connectivity is low! Check for graph islands.');
    } else {
        console.log('✅ Connectivity looks good.');
    }

    // Test 2: Cross-Floor specific check
    console.log('Test 2: Cross-Floor Verification...');
    const floors = Array.from(new Set(nodes.map(n => n.floorId)));

    if (floors.length > 1) {
        const f1 = floors[0];
        const f2 = floors[1];

        const startNode = nodes.find(n => n.floorId === f1);
        const endNode = nodes.find(n => n.floorId === f2);

        if (startNode && endNode) {
            console.log(`  Testing route from ${f1} to ${f2}...`);
            const path = pathfindingEngine.findRoute(
                startNode.coords,
                endNode.coords,
                f1,
                f2
            );

            if (path) {
                console.log('  ✅ Cross-floor path found!');
                console.log(`     Distance: ${path.distance.toFixed(1)}m, Nodes: ${path.nodeIds.length}`);
                console.log(`     Floors traversed: ${path.floors.length}`);
            } else {
                console.error('  ❌ Failed to find cross-floor path!');
            }
        }
    } else {
        console.log('  Skipping (only 1 floor found)');
    }

    console.groupEnd();
    return { successRate: rate };
}
