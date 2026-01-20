// Visibility management methods for floor and layer toggling
export const visibilityManager = {
    updateFloorVisibility(currentFloorId) {
        this.currentFloorId = currentFloorId;

        // Handle regular layers
        this.mvfLayerIds.forEach(layerId => {
            if (this.map.getLayer(layerId)) {
                if (layerId === 'building-shell') return;
                if (layerId === 'annotation-nodes-layer') return;
                this.map.setFilter(layerId, ['==', ['get', 'floorId'], currentFloorId]);
            }
        });

        // Handle annotation markers
        if (this.annotationMarkers) {
            this.annotationMarkers.forEach(({ marker, floorId }) => {
                if (floorId === currentFloorId) {
                    marker.getElement().style.display = 'block';
                } else {
                    marker.getElement().style.display = 'none';
                }
            });
        }
    },

    updateMultiFloorVisibility(visibleFloorIds) {
        this.currentFloorId = Array.from(visibleFloorIds)[0];
        this.mvfLayerIds.forEach(layerId => {
            if (this.map.getLayer(layerId)) {
                if (layerId === 'building-shell') return;
                this.map.setFilter(layerId, ['in', ['get', 'floorId'], ['literal', Array.from(visibleFloorIds)]]);
            }
        });
    },

    toggleLayerVisibility(layerId) {
        const linkedLayers = {
            'walkable-areas-layer': ['walkable-areas-outline-layer']
        };
        // Handle annotation markers
        if (layerId === 'annotation-nodes-layer' && this.annotationMarkers) {
            const currentlyVisible = this.annotationMarkers[0]?.marker.getElement().style.display !== 'none';
            const newVisibility = !currentlyVisible;

            this.annotationMarkers.forEach(({ marker, floorId }) => {
                if (floorId === this.currentFloorId) {
                    marker.getElement().style.display = newVisibility ? 'block' : 'none';
                }
            });

            return newVisibility;
        }

        // Handle regular layers
        if (this.map.getLayer(layerId)) {
            const currentVisibility = this.map.getLayoutProperty(layerId, 'visibility');
            const newVisibility = currentVisibility === 'visible' ? 'none' : 'visible';
            this.map.setLayoutProperty(layerId, 'visibility', newVisibility);

            if (linkedLayers[layerId]) {
                linkedLayers[layerId].forEach(linkedId => {
                    if (this.map.getLayer(linkedId)) {
                        this.map.setLayoutProperty(linkedId, 'visibility', newVisibility);
                    }
                });
            }
            return newVisibility === 'visible';
        }
        return false;
    },

    setLayerVisibility(layerId, visible) {
        const linkedLayers = {
            'walkable-areas-layer': ['walkable-areas-outline-layer']
        };
        // Handle annotation markers
        if (layerId === 'annotation-nodes-layer' && this.annotationMarkers) {
            this.annotationMarkers.forEach(({ marker, floorId }) => {
                if (floorId === this.currentFloorId) {
                    marker.getElement().style.display = visible ? 'block' : 'none';
                }
            });
            return;
        }

        // Handle regular layers
        if (this.map.getLayer(layerId)) {
            this.map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
        }
        if (linkedLayers[layerId]) {
            linkedLayers[layerId].forEach(linkedId => {
                if (this.map.getLayer(linkedId)) {
                    this.map.setLayoutProperty(linkedId, 'visibility', visible ? 'visible' : 'none');
                }
            });
        }
    },

    isLayerVisible(layerId) {
        // Handle annotation markers
        if (layerId === 'annotation-nodes-layer' && this.annotationMarkers && this.annotationMarkers.length > 0) {
            return this.annotationMarkers[0].marker.getElement().style.display !== 'none';
        }

        // Handle regular layers
        if (this.map.getLayer(layerId)) {
            const visibility = this.map.getLayoutProperty(layerId, 'visibility');
            return visibility === 'visible' || visibility === undefined;
        }
        return false;
    }
};
