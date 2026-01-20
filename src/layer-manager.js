// Main LayerManager orchestrator - combines all layer modules
import { baseLayers } from './layers/base-layers.js';
import { debugNodesPart1 } from './layers/debug-node-layers-part1.js';
import { debugNodesPart2 } from './layers/debug-node-layers-part2.js';
import { visibilityManager } from './layers/visibility-manager.js';

export class LayerManager {
    constructor(map, themeColors) {
        this.map = map;
        this.themeColors = themeColors;
        this.mvfLayerIds = new Set();
        this.MIN_ZOOM_INDOOR = 19;
    }
}

// Mixin all layer methods into LayerManager prototype
Object.assign(
    LayerManager.prototype,
    baseLayers,
    debugNodesPart1,
    debugNodesPart2,
    visibilityManager
);
