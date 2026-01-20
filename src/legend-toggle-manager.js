// Legend Toggle Manager - Handles interactive legend with localStorage persistence

const STORAGE_KEY = 'mappedin_layer_visibility';

export class LegendToggleManager {
    constructor(layerManager, options = {}) {
        this.layerManager = layerManager;
        this.defaults = options.defaults || {};
        this.ensureLayerLoaded = options.ensureLayerLoaded || null;
        this.autoLoadEnabledLayers = options.autoLoadEnabledLayers === true;
        this.loadingLayers = new Set();
        this.layerStates = this.loadLayerStates();
    }

    init() {
        // Get all toggleable legend items
        const toggleableItems = document.querySelectorAll('.legend-item.toggleable');

        toggleableItems.forEach(item => {
            const layerId = item.dataset.layer;

            // Apply saved state (default is configured per-layer)
            const isVisible = this.getLayerState(layerId);
            this.updateLegendItem(item, isVisible);

            // If enabled, kick off loading for initially enabled layers.
            if (isVisible && this.autoLoadEnabledLayers) {
                this.ensureAndApply(layerId);
            } else {
                this.layerManager.setLayerVisibility(layerId, isVisible);
            }

            // Add click listener
            item.addEventListener('click', () => {
                this.toggleLayer(layerId, item);
            });
        });
    }

    async ensureAndApply(layerId) {
        if (!this.ensureLayerLoaded) {
            this.layerManager.setLayerVisibility(layerId, this.getLayerState(layerId));
            return;
        }

        if (this.loadingLayers.has(layerId)) {
            return;
        }

        this.loadingLayers.add(layerId);
        try {
            await this.ensureLayerLoaded(layerId);
        } finally {
            this.loadingLayers.delete(layerId);
        }

        // Apply the latest state (it may have changed while loading).
        this.layerManager.setLayerVisibility(layerId, this.getLayerState(layerId));
    }

    async toggleLayer(layerId, legendItem) {
        const nextVisible = !this.getLayerState(layerId);
        this.layerStates[layerId] = nextVisible;

        // Update legend item visual state
        this.updateLegendItem(legendItem, nextVisible);

        // Save to localStorage
        this.saveLayerStates();

        if (nextVisible) {
            await this.ensureAndApply(layerId);
            return;
        }

        this.layerManager.setLayerVisibility(layerId, nextVisible);
    }

    updateLegendItem(item, isVisible) {
        if (isVisible) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    }

    loadLayerStates() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            return saved ? JSON.parse(saved) : {};
        } catch (e) {
            console.warn('Failed to load layer states from localStorage:', e);
            return {};
        }
    }

    saveLayerStates() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.layerStates));
        } catch (e) {
            console.warn('Failed to save layer states to localStorage:', e);
        }
    }

    // Get current state of a layer
    getLayerState(layerId) {
        if (Object.prototype.hasOwnProperty.call(this.layerStates, layerId)) {
            return this.layerStates[layerId] === true;
        }
        if (Object.prototype.hasOwnProperty.call(this.defaults, layerId)) {
            return this.defaults[layerId] === true;
        }
        return false;
    }

    // Set state of a layer programmatically
    setLayerState(layerId, isVisible) {
        const legendItem = document.querySelector(`.legend-item[data-layer="${layerId}"]`);
        if (!legendItem) return;

        this.layerStates[layerId] = isVisible === true;
        this.updateLegendItem(legendItem, isVisible === true);
        this.saveLayerStates();

        if (isVisible) {
            this.ensureAndApply(layerId);
            return;
        }

        this.layerManager.setLayerVisibility(layerId, false);
    }

    // Reset all layers to visible
    resetAll() {
        const toggleableItems = document.querySelectorAll('.legend-item.toggleable');
        toggleableItems.forEach(item => {
            const layerId = item.dataset.layer;
            this.setLayerState(layerId, true);
        });
    }
}
