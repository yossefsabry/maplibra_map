import maplibregl from 'maplibre-gl';

// Debug node rendering methods - Part 1: Wall, Stairs, Elevator, Annotation nodes
export const debugNodesPart1 = {
    addWallNodes(geojsonData) {
        const sourceId = 'wall-nodes-source';
        const layerId = 'wall-nodes-layer';

        if (this.map.getSource(sourceId)) {
            this.map.getSource(sourceId).setData(geojsonData);
        } else {
            this.map.addSource(sourceId, {
                type: 'geojson',
                data: geojsonData
            });

            this.map.addLayer({
                id: layerId,
                type: 'circle',
                source: sourceId,
                minzoom: this.MIN_ZOOM_INDOOR,
                paint: {
                    'circle-radius': 3,
                    'circle-color': '#FF0000',
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
                        <strong>Type:</strong> Wall Node<br>
                        <strong>Original ID:</strong> ${props.originalId}<br>
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
    },

    addStairsNodes(geojsonData) {
        const sourceId = 'stairs-nodes-source';
        const layerId = 'stairs-nodes-layer';

        if (this.map.getSource(sourceId)) {
            this.map.getSource(sourceId).setData(geojsonData);
        } else {
            this.map.addSource(sourceId, {
                type: 'geojson',
                data: geojsonData
            });

            this.map.addLayer({
                id: layerId,
                type: 'circle',
                source: sourceId,
                minzoom: this.MIN_ZOOM_INDOOR,
                paint: {
                    'circle-radius': 3,
                    'circle-color': '#FF00FF',
                    'circle-stroke-width': 1.5,
                    'circle-stroke-color': '#ffffff',
                    'circle-opacity': 0.9
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
                        <strong>Type:</strong> Stairs 🪜<br>
                        <strong>Geometry ID:</strong> ${props.geometryId}<br>
                        <strong>Connection ID:</strong> ${props.connectionId}<br>
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
    },

    addElevatorNodes(geojsonData) {
        const sourceId = 'elevator-nodes-source';
        const layerId = 'elevator-nodes-layer';

        if (this.map.getSource(sourceId)) {
            this.map.getSource(sourceId).setData(geojsonData);
        } else {
            this.map.addSource(sourceId, {
                type: 'geojson',
                data: geojsonData
            });

            this.map.addLayer({
                id: layerId,
                type: 'circle',
                source: sourceId,
                minzoom: this.MIN_ZOOM_INDOOR,
                paint: {
                    'circle-radius': 3,
                    'circle-color': '#00FFFF',
                    'circle-stroke-width': 1.5,
                    'circle-stroke-color': '#ffffff',
                    'circle-opacity': 0.9
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
                        <strong>Type:</strong> Elevator 🛗<br>
                        <strong>Geometry ID:</strong> ${props.geometryId}<br>
                        <strong>Connection ID:</strong> ${props.connectionId}<br>
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
    },

    async addAnnotationNodes(geojsonData) {
        if (!this.annotationMarkers) {
            this.annotationMarkers = [];
        }

        const loadSVG = async (iconType) => {
            const response = await fetch(`/assets/icons/${iconType}.svg`);
            return await response.text();
        };

        for (const feature of geojsonData.features) {
            const { coordinates } = feature.geometry;
            const { iconType, entranceType, annotationId, floorId } = feature.properties;

            const svgContent = await loadSVG(iconType);

            const el = document.createElement('div');
            el.className = `annotation-marker ${iconType}`;
            el.innerHTML = `<div class="annotation-icon">${svgContent}</div>`;
            el.style.width = '14px';
            el.style.height = '14px';

            const marker = new maplibregl.Marker({
                element: el,
                anchor: 'center'
            })
                .setLngLat(coordinates)
                .setPopup(
                    new maplibregl.Popup({ offset: 25 })
                        .setHTML(`
                            <strong>Type:</strong> ${entranceType}<br>
                            <strong>Annotation ID:</strong> ${annotationId}<br>
                            <strong>Floor:</strong> ${floorId}
                        `)
                )
                .addTo(this.map);

            this.annotationMarkers.push({
                marker,
                floorId,
                layerId: 'annotation-nodes-layer'
            });
        }

        this.mvfLayerIds.add('annotation-nodes-layer');

        // Add zoom listener to toggle marker visibility
        this.map.on('zoom', () => {
            const currentZoom = this.map.getZoom();
            const isVisible = currentZoom >= this.MIN_ZOOM_INDOOR;

            this.annotationMarkers.forEach(item => {
                const el = item.marker.getElement();
                el.style.display = isVisible ? 'block' : 'none';
            });
        });

        // Trigger once to set initial state
        const initialZoom = this.map.getZoom();
        if (initialZoom < this.MIN_ZOOM_INDOOR) {
            this.annotationMarkers.forEach(item => {
                item.marker.getElement().style.display = 'none';
            });
        }
    }
};
