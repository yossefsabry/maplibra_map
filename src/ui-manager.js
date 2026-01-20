export class UIManager {
    constructor(map, layerManager, floors) {
        this.map = map;
        this.layerManager = layerManager;
        this.floors = floors;
        this.currentFloorId = floors[0]?.properties.id;
        this.MIN_ZOOM_INDOOR = 19;
    }

    getCurrentFloorId() {
        return this.currentFloorId;
    }

    init() {
        this.createFloorControls();
        this.setupZoomListener();
        this.setupExternalListeners();
        // Initial update
        this.layerManager.updateFloorVisibility(this.currentFloorId);
    }

    createFloorControls() {
        const container = document.getElementById('floor-controls');
        container.innerHTML = '';
        const select = document.createElement('select');
        select.className = 'floor-select';

        this.floors.forEach(floor => {
            const option = document.createElement('option');
            option.value = floor.properties.id;
            option.textContent = floor.properties.details.name || `Level ${floor.properties.elevation}`;
            if (floor.properties.id === this.currentFloorId) {
                option.selected = true;
            }
            select.appendChild(option);
        });

        select.addEventListener('change', () => {
            const floorId = select.value;
            if (this.currentFloorId !== floorId) {
                this.currentFloorId = floorId;
                this.layerManager.updateFloorVisibility(this.currentFloorId);
                window.dispatchEvent(new CustomEvent('floor-changed', { detail: { floorId } }));
            }
        });

        container.appendChild(select);
        this.floorSelect = select;
    }

    setupZoomListener() {
        const floorControlsDiv = document.getElementById('floor-controls');
        const viewIndicator = document.getElementById('view-indicator');

        const checkZoom = () => {
            const zoom = this.map.getZoom();
            if (zoom < this.MIN_ZOOM_INDOOR) {
                floorControlsDiv.style.display = 'none';
                if (viewIndicator) {
                    viewIndicator.textContent = 'Outdoor View - Zoom in for indoor';
                    viewIndicator.classList.remove('is-hidden');
                }
            } else {
                floorControlsDiv.style.display = 'block';
                if (viewIndicator) {
                    viewIndicator.textContent = 'Indoor View';
                    viewIndicator.classList.add('is-hidden');
                }
            }
        };

        this.map.on('zoom', checkZoom);
        checkZoom();

        const adjustView = () => {
            const zoom = this.map.getZoom();
            if (zoom < this.MIN_ZOOM_INDOOR) {
                if (this.map.getPitch() > 15) {
                    this.map.easeTo({ pitch: 0, bearing: 0, duration: 600 });
                }
            } else if (this.map.getPitch() < 40) {
                this.map.easeTo({ pitch: 60, bearing: -17, duration: 600 });
            }
        };

        this.map.on('zoomend', adjustView);
    }

    setupExternalListeners() {
        window.addEventListener('floor-changed', (e) => {
            const newFloorId = e.detail.floorId;
            if (newFloorId && newFloorId !== this.currentFloorId) {
                this.currentFloorId = newFloorId;
                if (this.floorSelect) {
                    this.floorSelect.value = newFloorId;
                }
                this.layerManager.updateFloorVisibility(this.currentFloorId);
            }
        });
    }
}
