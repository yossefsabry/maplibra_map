import { Marker, Popup } from 'maplibre-gl';
import * as turf from '@turf/turf';

export class InteractionManager {
    constructor(map, pathfinder, layerManager) {
        this.map = map;
        this.pathfinder = pathfinder;
        this.layerManager = layerManager;

        this.startNode = null;
        this.endNode = null;

        this.startMarker = null;
        this.endMarker = null;
        this.animationFrameId = null;
    }

    init() {
        // Interaction logic removed as per user request.
    }
}
