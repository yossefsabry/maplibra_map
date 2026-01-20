/**
 * DirectionsUI - Interactive UI for pathfinding
 * Handles drop-pin start and location selection for routes
 */
import maplibregl from 'maplibre-gl';

export class DirectionsUI {
    constructor(map, pathfindingEngine, pathRenderer, floors, pathSmoother = null) {
        this.map = map;
        this.pathfindingEngine = pathfindingEngine;
        this.pathRenderer = pathRenderer;
        this.pathSmoother = pathSmoother;
        const floorList = floors || [];
        this.floors = floorList;
        this.groundFloorId = floorList?.[0]?.properties?.id || null;
        this.floorLookup = new Map();
        floorList.forEach(floor => {
            const name = floor.properties?.details?.name || `Level ${floor.properties?.elevation ?? ''}`.trim();
            this.floorLookup.set(floor.properties.id, name || 'Floor');
        });

        this.selectedDestination = null;
        this.startPoint = null;
        this.startMarker = null;
        this.currentFloor = null;
        this.awaitingStart = false;
        this.enabled = true;
        this.MIN_ZOOM_INDOOR = 19;

        this.panel = document.getElementById('directions-panel');
        this.statusEl = null;
        this.toField = null;
        this.fromField = null;
    }

    initialize(currentFloor) {
        this.currentFloor = currentFloor;
        this.createPanel();
        if (this.fromField) {
            this.fromField.textContent = `Dropped Pin (${this.getFloorName(currentFloor)})`;
        }
        this.bindUI();
        this.setupLocationClickHandlers();
    }

    setEnabled(enabled) {
        this.enabled = enabled;
        if (!this.panel) return;
        this.panel.classList.toggle('is-hidden', !enabled);
        if (!enabled) {
            this.pathRenderer.clearRoute();
            this.awaitingStart = false;
            this.map.getCanvas().style.cursor = '';
            if (this.startMarker) {
                this.startMarker.remove();
                this.startMarker = null;
            }
            this.startPoint = null;
        } else if (this.fromField) {
            this.fromField.textContent = `Dropped Pin (${this.getFloorName(this.currentFloor)})`;
        }
    }

    createPanel() {
        if (!this.panel) return;

        this.panel.innerHTML = `
            <div class="directions-header">
                <div class="directions-title">Directions</div>
                <button class="directions-close" id="directions-close" aria-label="Close directions">&times;</button>
            </div>
            <div class="direction-group">
                <div class="direction-label">From</div>
                <div class="direction-field">
                    <button id="from-field" type="button">Dropped Pin</button>
                </div>
                <div class="direction-helper" id="from-helper">Click the map to set a start point.</div>
            </div>
            <div class="direction-group">
                <div class="direction-label">To</div>
                <div class="direction-field" id="to-field">Select a destination</div>
            </div>
            <div class="direction-actions">
                <button class="primary" id="route-button" type="button">Route</button>
                <button id="clear-button" type="button">Clear</button>
            </div>
            <div class="direction-status" id="direction-status">Choose a destination to begin.</div>
        `;

        this.statusEl = this.panel.querySelector('#direction-status');
        this.toField = this.panel.querySelector('#to-field');
        this.fromField = this.panel.querySelector('#from-field');
    }

    bindUI() {
        if (!this.panel) return;

        const closeBtn = this.panel.querySelector('#directions-close');
        const routeBtn = this.panel.querySelector('#route-button');
        const clearBtn = this.panel.querySelector('#clear-button');

        closeBtn.addEventListener('click', () => {
            const toggle = document.getElementById('directions-toggle');
            if (toggle) {
                toggle.checked = false;
            }
            this.setEnabled(false);
        });

        this.fromField.addEventListener('click', () => {
            this.awaitingStart = true;
            this.updateStatus('Click on the map to drop a start pin.');
            this.map.getCanvas().style.cursor = 'crosshair';
        });

        routeBtn.addEventListener('click', () => {
            this.tryRoute();
        });

        clearBtn.addEventListener('click', () => {
            this.clearRoute();
        });

        this.map.on('click', (e) => {
            if (!this.awaitingStart) return;
            this.awaitingStart = false;
            this.map.getCanvas().style.cursor = '';
            this.setStartPoint([e.lngLat.lng, e.lngLat.lat]);
            this.tryRoute();
        });
    }

    setupLocationClickHandlers() {
        window.addEventListener('location-clicked', (e) => {
            const { name, coords, floorId } = e.detail;
            this.setDestination({ name, coords, floorId });
            this.tryRoute();
        });

        window.addEventListener('location-deselected', () => {
            this.clearRoute();
        });
    }

    setDestination(destination) {
        this.selectedDestination = destination;
        if (!this.toField) return;

        if (!destination) {
            this.toField.textContent = 'Select a destination';
            this.updateStatus('Choose a destination to begin.');
            return;
        }

        const floorLabel = this.getFloorName(destination.floorId);
        this.toField.textContent = `${destination.name} (${floorLabel})`;
        this.updateStatus('Drop a start pin or route from the map center.');

        this.map.flyTo({
            center: destination.coords,
            zoom: Math.max(this.map.getZoom(), this.MIN_ZOOM_INDOOR + 1),
            pitch: 55,
            bearing: -17,
            essential: true
        });
    }

    setStartPoint(coords) {
        const floorId = this.getStartFloorId();
        let finalCoords = coords;
        let snapMessage = 'Start point set.';

        if (this.pathfindingEngine?.snapToWalkableNode) {
            const snap = this.pathfindingEngine.snapToWalkableNode(coords, floorId);
            if (snap) {
                finalCoords = snap.coords;
                snapMessage = `Snapped to walkable node (${Math.round(snap.distanceMeters)}m)`;
            }
        }

        this.startPoint = { coords: finalCoords, floorId };
        if (this.fromField) {
            this.fromField.textContent = `Dropped Pin (${this.getFloorName(floorId)})`;
        }
        this.updateStatus(snapMessage);

        if (this.startMarker) {
            this.startMarker.setLngLat(finalCoords);
            return;
        }

        const markerEl = document.createElement('div');
        markerEl.className = 'start-pin';
        markerEl.innerHTML = '<span></span>';

        this.startMarker = new maplibregl.Marker({ element: markerEl, draggable: true })
            .setLngLat(finalCoords)
            .addTo(this.map);

        this.startMarker.on('dragend', () => {
            const next = this.startMarker.getLngLat();
            this.setStartPoint([next.lng, next.lat]);
            this.tryRoute();
        });
    }

    tryRoute() {
        if (!this.enabled) {
            return;
        }

        if (!this.selectedDestination) {
            this.updateStatus('Select a destination first.');
            return;
        }

        if (!this.startPoint) {
            const center = this.map.getCenter();
            this.setStartPoint([center.lng, center.lat]);
        }

        this.calculateAndShowRoute();
    }

    getStartFloorId() {
        if (this.isOutdoorView() && this.groundFloorId) {
            return this.groundFloorId;
        }
        return this.currentFloor;
    }

    getFloorName(floorId) {
        return this.floorLookup.get(floorId) || 'Floor';
    }

    isOutdoorView() {
        return this.map.getZoom() < this.MIN_ZOOM_INDOOR;
    }

    findNearestEntrance(coords, floorId) {
        const graph = this.pathfindingEngine.getGraph();
        const candidates = graph.getNodesOnFloor(floorId).filter(node => node.type === 'entrance');
        const entranceNodes = candidates.length
            ? candidates
            : Array.from(graph.nodes.values()).filter(node => node.type === 'entrance');

        if (!entranceNodes.length) return null;

        let nearest = null;
        let minDist = Infinity;
        entranceNodes.forEach(node => {
            const dx = node.coords[0] - coords[0];
            const dy = node.coords[1] - coords[1];
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < minDist) {
                minDist = dist;
                nearest = node;
            }
        });

        return nearest ? { coords: nearest.coords, floorId: nearest.floorId } : null;
    }

    calculateAndShowRoute() {
        if (!this.selectedDestination || !this.startPoint) return;

        try {
            let route = this.pathfindingEngine.findRoute(
                this.startPoint.coords,
                this.selectedDestination.coords,
                this.startPoint.floorId,
                this.selectedDestination.floorId
            );

            if (!route) {
                const routeError = this.pathfindingEngine.getLastRouteError();
                if (routeError?.code === 'no-door') {
                    this.updateStatus(routeError.message, true);
                    return;
                }

                const snapped = this.findNearestEntrance(this.startPoint.coords, this.startPoint.floorId);
                if (snapped) {
                    this.startPoint = { coords: snapped.coords, floorId: snapped.floorId };
                    if (this.startMarker) {
                        this.startMarker.setLngLat(snapped.coords);
                    }
                    if (this.fromField) {
                        this.fromField.textContent = `Nearest Entrance (${this.getFloorName(snapped.floorId)})`;
                    }
                    route = this.pathfindingEngine.findRoute(
                        this.startPoint.coords,
                        this.selectedDestination.coords,
                        this.startPoint.floorId,
                        this.selectedDestination.floorId
                    );
                }
            }

            if (!route) {
                const routeError = this.pathfindingEngine.getLastRouteError();
                this.updateStatus(routeError?.message || 'No route available from this location.', true);
                return;
            }

            const enrichedRoute = this.withRouteEndpoints(
                route,
                this.startPoint.coords,
                this.selectedDestination.coords,
                this.startPoint.floorId,
                this.selectedDestination.floorId
            );

            const renderRoute = this.getRenderRoute(enrichedRoute);

            this.pathRenderer.renderRoute(renderRoute, {
                color: '#4f7cff',
                width: 4,
                animated: true
            });

            const warnings = enrichedRoute.warnings || [];
            const warningText = warnings.length ? ` ${warnings.join(' ')}` : '';
            const suffix = warnings.length ? `.${warningText}` : '';
            this.updateStatus(`Route ready - ${enrichedRoute.distance.toFixed(1)}m${suffix}`, warnings.length > 0);
        } catch (error) {
            this.updateStatus(`Routing failed: ${error.message}`, true);
        }
    }

    withRouteEndpoints(route, startCoords, endCoords, startFloorId, endFloorId) {
        const detector = this.pathfindingEngine.getCollisionDetector();
        const path = [...route.path];
        let floors = Array.isArray(route.floors) ? [...route.floors] : [];
        const warnings = [];
        const first = path[0];
        const last = path[path.length - 1];
        let addedStart = false;
        let addedEnd = false;

        if (!this.coordsEqual(first, startCoords)) {
            if (!detector || detector.isPathClear(startCoords, first, startFloorId)) {
                path.unshift(startCoords);
                addedStart = true;
            } else {
                warnings.push('Start point is blocked by walls.');
            }
        }

        if (!this.coordsEqual(last, endCoords)) {
            if (!detector || detector.isPathClear(last, endCoords, endFloorId)) {
                path.push(endCoords);
                addedEnd = true;
            } else {
                warnings.push('Destination is blocked by walls.');
            }
        }

        if (floors.length) {
            if (addedStart) floors.unshift(startFloorId);
            if (addedEnd) floors.push(endFloorId);
        }

        if (floors.length !== path.length) {
            floors = path.map((_, index) => {
                if (index === 0) return startFloorId;
                if (index === path.length - 1) return endFloorId;
                return startFloorId;
            });
        }

        return {
            ...route,
            path,
            floors,
            warnings
        };
    }

    getRenderRoute(route) {
        if (!this.pathSmoother || !route?.path || route.path.length < 3) {
            return route;
        }

        const simplified = this.pathSmoother.simplifyPath(route.path, 0.000005);
        const floors = route.floors || [];
        const smoothed = floors.length === simplified.length
            ? this.pathSmoother.smoothPathWithFloors(simplified, floors)
            : this.pathSmoother.smoothPath(simplified);

        return {
            ...route,
            path: smoothed
        };
    }

    coordsEqual(a, b) {
        if (!a || !b) return false;
        return Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7;
    }

    updateStatus(message, isError = false) {
        if (!this.statusEl) return;
        this.statusEl.textContent = message;
        this.statusEl.classList.toggle('is-error', isError);
    }

    clearRoute() {
        this.pathRenderer.clearRoute();
        if (this.startMarker) {
            this.startMarker.remove();
            this.startMarker = null;
        }
        this.startPoint = null;
        this.selectedDestination = null;

        if (this.toField) {
            this.toField.textContent = 'Select a destination';
        }
        if (this.fromField) {
            this.fromField.textContent = `Dropped Pin (${this.getFloorName(this.currentFloor)})`;
        }
        this.updateStatus('Route cleared.');
    }

    updateCurrentFloor(floorId) {
        this.currentFloor = floorId;
        if (!this.startPoint && this.fromField) {
            this.fromField.textContent = `Dropped Pin (${this.getFloorName(floorId)})`;
        }
    }
}
