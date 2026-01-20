import * as turf from '@turf/turf';
import { getCentroid } from '../utils.js';
import maplibregl from 'maplibre-gl';

// Base layer rendering methods for building geometry, styles, doors, and labels
export const baseLayers = {
    ensureGeometryIndex(geometry) {
        if (this.geometryIndex) return;
        this.geometryIndex = new Map();
        if (!geometry || !Array.isArray(geometry.features)) return;
        geometry.features.forEach(feature => {
            const id = feature?.properties?.id;
            if (id) {
                this.geometryIndex.set(id, feature);
            }
        });
    },

    addBuildingShell(floors) {
        if (floors.length > 0) {
            const buildingFootprint = floors[0]; // Ground floor
            const totalHeight = floors.length * 3; // Reduced from 4 for sleeker appearance

            this.map.addSource('building-shell', {
                type: 'geojson',
                data: buildingFootprint
            });

            // Initialize location map for lookup
            this.locationMap = new Map(); // geometryId -> {name, coords, floorId}
            this.roomStateMap = new Map(); // geometryId -> {source, id (int)}

            this.map.addLayer({
                id: 'building-shell',
                type: 'fill-extrusion',
                source: 'building-shell',
                maxzoom: this.MIN_ZOOM_INDOOR,
                paint: {
                    'fill-extrusion-color': this.themeColors.ExteriorWalls,
                    'fill-extrusion-height': totalHeight,
                    'fill-extrusion-base': 0, // Solid ground contact to prevent glitches
                    'fill-extrusion-opacity': 0.9,
                    'fill-extrusion-vertical-gradient': true
                }
            });

            this.map.on('click', 'building-shell', (e) => {
                this.map.flyTo({
                    center: e.lngLat,
                    zoom: this.MIN_ZOOM_INDOOR + 1,
                    pitch: 60,
                    bearing: -17,
                    essential: true
                });
            });
            this.map.on('mouseenter', 'building-shell', () => {
                this.map.getCanvas().style.cursor = 'pointer';
            });
            this.map.on('mouseleave', 'building-shell', () => {
                this.map.getCanvas().style.cursor = '';
            });
        }
    },

    processStyles(styles, geometry, entranceIds) {
        this.ensureGeometryIndex(geometry);

        const layersToAdd = [];

        Object.entries(styles).forEach(([styleName, style]) => {
            const anchors = style.geometryAnchors || [];
            if (!anchors.length) return;

            const filteredFeatures = [];
            const seen = new Set();
            anchors.forEach(anchor => {
                const geometryId = anchor.geometryId;
                if (!geometryId || entranceIds.has(geometryId)) return;
                if (seen.has(geometryId)) return;
                seen.add(geometryId);
                const feature = this.geometryIndex.get(geometryId);
                if (!feature) return;
                filteredFeatures.push({
                    ...feature,
                    properties: {
                        ...feature.properties,
                        floorId: anchor.floorId || feature.properties?.floorId
                    }
                });
            });

            if (filteredFeatures.length === 0) return;

            layersToAdd.push({ styleName, style, features: filteredFeatures });
        });

        const is3D = (item) => {
            const { styleName, style, features } = item;
            const layerHeight = (style.height || 0) * 3;
            const isLine = features[0].geometry.type === 'LineString' || features[0].geometry.type === 'MultiLineString';
            if (styleName.includes('Walls') && isLine && layerHeight > 0) return true;
            const isPolygon = features[0].geometry.type === 'Polygon' || features[0].geometry.type === 'MultiPolygon';
            if (isPolygon && layerHeight > 0) return true;
            return false;
        };

        layersToAdd.sort((a, b) => {
            const a3D = is3D(a);
            const b3D = is3D(b);
            if (a3D === b3D) return 0;
            return a3D ? 1 : -1;
        });

        this.first3DLayerId = null;
        this.hoveredStateId = null; // Track hovered feature
        this.selectedStateId = null; // Track selected feature

        layersToAdd.forEach(item => {
            this.createStyleLayer(item.styleName, item.style, item.features);
            if (is3D(item) && !this.first3DLayerId) {
                this.first3DLayerId = item.styleName;
            }
        });
    },

    createStyleLayer(styleName, style, features) {
        let isPolygon = features[0].geometry.type === 'Polygon' || features[0].geometry.type === 'MultiPolygon';
        let isLine = features[0].geometry.type === 'LineString' || features[0].geometry.type === 'MultiLineString';

        let layerColor;
        if (this.themeColors[styleName]) {
            layerColor = this.themeColors[styleName];
        } else if (style.color) {
            const lightColors = ['#ffffff', '#FFFFFF', '#fcfcfc', '#f5f5f5', '#E6F4FB', '#DCDCDC', '#F5EFE0'];
            if (lightColors.some(c => c.toLowerCase() === style.color.toLowerCase())) {
                layerColor = '#2A2D35';
            } else {
                layerColor = style.color;
            }
        } else {
            layerColor = this.themeColors.Default;
        }

        let heightMultiplier = styleName.includes('Walls') ? 1.0 : 1.8;
        const layerHeight = (style.height || 0) * heightMultiplier;

        if (styleName.includes('Walls') && isLine && layerHeight > 0) {
            features = features.map(feature => {
                try {
                    const buffered = turf.buffer(feature, 0.15, { units: 'meters' });
                    buffered.properties = feature.properties;
                    return buffered;
                } catch (e) {
                    return feature;
                }
            });
            isPolygon = true;
            isLine = false;
        }

        // Ensure features have integer IDs for feature-state
        features = features.map((f, index) => ({ ...f, id: index }));

        // Populate roomStateMap for label lookups
        features.forEach(f => {
            if (f.properties && f.properties.id) {
                this.roomStateMap.set(f.properties.id, {
                    source: styleName,
                    id: f.id
                });
            }
        });

        this.map.addSource(styleName, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: features }
        });

        const layerMinZoom = styleName === 'ExteriorWalls' ? 15 : this.MIN_ZOOM_INDOOR;
        const isWall = styleName.includes('Walls');
        const layerOpacity = isWall ? 1.0 : (style.opacity || 1);

        if (isPolygon && layerHeight > 0) {
            this.map.addLayer({
                id: styleName,
                type: 'fill-extrusion',
                source: styleName,
                minzoom: layerMinZoom,
                paint: {
                    'fill-extrusion-color': [
                        'case',
                        ['boolean', ['feature-state', 'selected'], false], 'rgba(123, 97, 255, 1)',
                        ['boolean', ['feature-state', 'hover'], false], 'rgba(157, 137, 255, 1)',
                        layerColor
                    ],
                    'fill-extrusion-height': layerHeight,
                    'fill-extrusion-base': 0,
                    'fill-extrusion-opacity': layerOpacity,
                    'fill-extrusion-vertical-gradient': true,
                    'fill-extrusion-color-transition': { duration: 300 }
                }
            });
            this.mvfLayerIds.add(styleName);

            // Add "Cap" layer for walls to simulate stroke
            if (isWall) {
                const strokeLayerId = `${styleName}-stroke`;
                const strokeSourceId = `${styleName}-stroke-source`;
                const strokeThickness = 0.1; // 10cm stroke
                const zFightingOffset = 0.005; // Minimal offset needed since we are buffering

                // Create buffered features for the cap to avoid z-fighting on sides
                // and give a nice 'capstone' look. Increased steps for smoothness.
                const strokeFeatures = features.map(f => {
                    try {
                        const buffered = turf.buffer(f, 0.05, { units: 'meters', steps: 32 });
                        buffered.properties = f.properties;
                        return buffered;
                    } catch (e) {
                        return f;
                    }
                });

                this.map.addSource(strokeSourceId, {
                    type: 'geojson',
                    data: { type: 'FeatureCollection', features: strokeFeatures }
                });

                // User requested "little dark but not that deep dark" -> Soft Charcoal
                const strokeColor = '#1A1A1A';

                this.map.addLayer({
                    id: strokeLayerId,
                    type: 'fill-extrusion',
                    source: strokeSourceId, // Use specific buffered source
                    minzoom: layerMinZoom,
                    paint: {
                        'fill-extrusion-color': strokeColor,
                        'fill-extrusion-height': layerHeight + strokeThickness + zFightingOffset,
                        'fill-extrusion-base': layerHeight, // Sit directly on top (or slightly inside if we want)
                        'fill-extrusion-opacity': 1.0,
                        'fill-extrusion-vertical-gradient': false
                    }
                });
                this.mvfLayerIds.add(strokeLayerId);
            }
        }

        // Add interaction handlers for room polygons
        if (!isWall && !styleName.includes('Walls')) {
            this.map.on('click', styleName, (e) => {
                if (e.features.length > 0) {
                    const feature = e.features[0];
                    const id = feature.id;
                    const propsId = feature.properties.id;

                    // Restrict interaction to named rooms
                    if (!this.locationMap || !this.locationMap.has(propsId)) {
                        return;
                    }

                    // Update selected state
                    if (this.selectedStateId && this.selectedStateId.id === id && this.selectedStateId.source === styleName) {
                        // Toggle off if clicking the same feature
                        this.map.setFeatureState(
                            { source: styleName, id: id },
                            { selected: false }
                        );
                        this.selectedStateId = null;
                        // Dispatch deselection event
                        window.dispatchEvent(new CustomEvent('location-deselected'));
                        return; // Stop here, don't trigger 'location-clicked' for deselection
                    } else {
                        // Deselect previous if different
                        if (this.selectedStateId) {
                            this.map.setFeatureState(
                                { source: this.selectedStateId.source, id: this.selectedStateId.id },
                                { selected: false }
                            );
                        }
                        // Select new
                        this.selectedStateId = { source: styleName, id: id };
                        this.map.setFeatureState(
                            { source: styleName, id: id },
                            { selected: true }
                        );
                    }

                    // Check if clicked feature is a known location for directions
                    if (this.locationMap && this.locationMap.has(propsId)) {
                        const locationFn = this.locationMap.get(propsId);

                        // Dispatch event for DirectionsUI
                        window.dispatchEvent(new CustomEvent('location-clicked', {
                            detail: {
                                name: locationFn.name,
                                coords: locationFn.coords,
                                floorId: locationFn.floorId,
                                locationId: propsId
                            }
                        }));
                    }
                }
            });

            // Hover effects
            this.map.on('mousemove', styleName, (e) => {
                if (e.features.length > 0) {
                    const feature = e.features[0];
                    const id = feature.id;
                    const propsId = feature.properties.id;

                    // Restrict interaction to named rooms
                    if (!this.locationMap || !this.locationMap.has(propsId)) {
                        if (this.hoveredStateId) {
                            this.map.setFeatureState(
                                { source: this.hoveredStateId.source, id: this.hoveredStateId.id },
                                { hover: false }
                            );
                            this.hoveredStateId = null;
                        }
                        this.map.getCanvas().style.cursor = '';
                        return;
                    }

                    if (this.hoveredStateId && (this.hoveredStateId.id !== id || this.hoveredStateId.source !== styleName)) {
                        this.map.setFeatureState(
                            { source: this.hoveredStateId.source, id: this.hoveredStateId.id },
                            { hover: false }
                        );
                    }
                    this.hoveredStateId = { source: styleName, id: id };
                    this.map.setFeatureState(
                        { source: styleName, id: id },
                        { hover: true }
                    );

                    if (this.locationMap && this.locationMap.has(propsId)) {
                        this.map.getCanvas().style.cursor = 'pointer';
                    }
                }
            });

            this.map.on('mouseleave', styleName, () => {
                if (this.hoveredStateId) {
                    this.map.setFeatureState(
                        { source: this.hoveredStateId.source, id: this.hoveredStateId.id },
                        { hover: false }
                    );
                }
                this.hoveredStateId = null;
                this.map.getCanvas().style.cursor = '';
            });
        }
    },

    addDoors(geometry, entranceIds, entranceGeometryToFloorMap) {
        this.ensureGeometryIndex(geometry);

        const doorFeatures = [];
        entranceIds.forEach(geometryId => {
            const feature = this.geometryIndex.get(geometryId);
            if (!feature) return;
            const floorId = entranceGeometryToFloorMap.get(geometryId) || feature.properties?.floorId;
            doorFeatures.push({
                ...feature,
                properties: {
                    ...feature.properties,
                    floorId: floorId
                }
            });
        });

        const bufferedDoors = doorFeatures.map(feature => {
            if (feature.geometry.type === 'LineString') {
                try {
                    const buffered = turf.buffer(feature, 0.05, { units: 'meters' });
                    buffered.properties = feature.properties;
                    return buffered;
                } catch (e) {
                    return feature;
                }
            }
            return feature;
        });

        if (bufferedDoors.length > 0) {
            this.map.addSource('doors', {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: bufferedDoors }
            });

            this.map.addLayer({
                id: 'doors',
                type: 'fill-extrusion',
                source: 'doors',
                minzoom: this.MIN_ZOOM_INDOOR,
                paint: {
                    'fill-extrusion-color': this.themeColors['Doors'],
                    'fill-extrusion-height': 0.6,
                    'fill-extrusion-base': 0,
                    'fill-extrusion-opacity': 0.4,
                    'fill-extrusion-vertical-gradient': true
                }
            });
            this.mvfLayerIds.add('doors');
        }
    },

    addLabels(locations, geometry) {
        const labelFeatures = [];
        this.ensureGeometryIndex(geometry);

        // Initialize location map for lookup
        if (!this.locationMap) {
            this.locationMap = new Map();
        }

        locations.forEach(loc => {
            if (loc.details && loc.details.name && loc.geometryAnchors && loc.geometryAnchors.length > 0) {
                const geoId = loc.geometryAnchors[0].geometryId;
                const floorId = loc.geometryAnchors[0].floorId;

                const feature = this.geometryIndex.get(geoId);
                if (feature) {
                    const centroid = getCentroid(feature.geometry);
                    if (centroid) {
                        // Add to label features
                        labelFeatures.push({
                            type: 'Feature',
                            geometry: { type: 'Point', coordinates: centroid },
                            properties: {
                                name: loc.details.name,
                                floorId: floorId,
                                id: geoId // Store UUID for lookup
                            }
                        });

                        // Populate location map
                        this.locationMap.set(geoId, {
                            name: loc.details.name,
                            coords: centroid,
                            floorId: floorId
                        });
                    }
                }
            }
        });

        if (labelFeatures.length > 0) {
            this.map.addSource('labels', {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: labelFeatures }
            });
            this.map.addLayer({
                id: 'labels',
                type: 'symbol',
                source: 'labels',
                minzoom: this.MIN_ZOOM_INDOOR,
                layout: {
                    'text-field': ['get', 'name'],
                    'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
                    'text-size': 12,
                    'text-anchor': 'center',
                    'text-offset': [0, -1.5] // Offset text slightly above the node
                },
                paint: {
                    'text-color': '#ffffff',
                    'text-halo-color': '#000000',
                    'text-halo-width': 1
                }
            });
            this.mvfLayerIds.add('labels');

            // Add click handler for directions
            this.map.on('click', 'labels', (e) => {
                const feature = e.features[0];
                const coords = feature.geometry.coordinates.slice();
                const name = feature.properties.name;
                const floorId = feature.properties.floorId;
                const propsId = feature.properties.id; // UUID

                // Trigger Room Selection Logic if mapped
                if (propsId && this.roomStateMap.has(propsId)) {
                    const roomState = this.roomStateMap.get(propsId);
                    const source = roomState.source;
                    const id = roomState.id;

                    // Update selected state (Duplicate logic from createStyleLayer)
                    if (this.selectedStateId && this.selectedStateId.id === id && this.selectedStateId.source === source) {
                        // Toggle off
                        this.map.setFeatureState(
                            { source: source, id: id },
                            { selected: false }
                        );
                        this.selectedStateId = null;
                        // Dispatch deselection event
                        window.dispatchEvent(new CustomEvent('location-deselected'));
                        return; // Stop here to simulate toggle off behavior
                    } else {
                        // Deselect previous
                        if (this.selectedStateId) {
                            this.map.setFeatureState(
                                { source: this.selectedStateId.source, id: this.selectedStateId.id },
                                { selected: false }
                            );
                        }
                        // Select new
                        this.selectedStateId = { source: source, id: id };
                        this.map.setFeatureState(
                            { source: source, id: id },
                            { selected: true }
                        );
                    }
                }

                // Dispatch event for DirectionsUI
                window.dispatchEvent(new CustomEvent('location-clicked', {
                    detail: {
                        name: name,
                        coords: coords,
                        floorId: floorId,
                        locationId: propsId
                    }
                }));
            });

            // Cursor on hover
            this.map.on('mouseenter', 'labels', () => {
                this.map.getCanvas().style.cursor = 'pointer';
            });
            this.map.on('mouseleave', 'labels', () => {
                this.map.getCanvas().style.cursor = '';
            });
        }
    },

    addNodes(nodeFeatures) {
        // Nodes are for pathfinding logic only
    },

    addDebugNodes(categories, geometry) {
        Object.entries(categories).forEach(([name, data]) => {
            const debugFeatures = [];
            const { ids, color } = data;

            geometry.features.forEach(feature => {
                if (ids.has(feature.properties.id)) {
                    const centroid = getCentroid(feature.geometry);
                    if (centroid) {
                        debugFeatures.push({
                            type: 'Feature',
                            geometry: { type: 'Point', coordinates: centroid },
                            properties: {
                                id: feature.properties.id,
                                floorId: feature.properties.floorId
                            }
                        });
                    }
                }
            });

            if (debugFeatures.length > 0) {
                const sourceId = `debug-${name}-source`;
                const layerId = `debug-${name}-layer`;

                if (this.map.getSource(sourceId)) {
                    this.map.getSource(sourceId).setData({
                        type: 'FeatureCollection',
                        features: debugFeatures
                    });
                } else {
                    this.map.addSource(sourceId, {
                        type: 'geojson',
                        data: {
                            type: 'FeatureCollection',
                            features: debugFeatures
                        }
                    });

                    this.map.addLayer({
                        id: layerId,
                        type: 'circle',
                        source: sourceId,
                        minzoom: this.MIN_ZOOM_INDOOR,
                        paint: {
                            'circle-radius': 3,
                            'circle-color': color,
                            'circle-stroke-width': 1,
                            'circle-stroke-color': '#ffffff',
                            'circle-opacity': 0.8
                        }
                    });
                    this.mvfLayerIds.add(layerId);

                    this.map.on('click', layerId, (e) => {
                        const feature = e.features[0];
                        const props = feature.properties;
                        const coordinates = feature.geometry.coordinates.slice();

                        new maplibregl.Popup()
                            .setLngLat(coordinates)
                            .setHTML(`
                                <strong>Category:</strong> ${name}<br>
                                <strong>ID:</strong> ${props.id}<br>
                                <strong>Floor:</strong> ${props.floorId}
                            `)
                            .addTo(this.map);
                    });

                    this.map.on('mouseenter', layerId, () => {
                        this.map.getCanvas().style.cursor = 'pointer';
                    });
                    this.map.on('mouseleave', layerId, () => {
                        this.map.getCanvas().style.cursor = '';
                    });
                }
            }
        });
    }
};
