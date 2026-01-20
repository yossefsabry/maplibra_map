import { Map as MapLibreMap, NavigationControl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { starlightTheme } from './theme.js';
import { loadMVFBundle } from './src/mvf-loader.js';
import { LayerManager } from './src/layer-manager.js';
import { UIManager } from './src/ui-manager.js';
import { LegendToggleManager } from './src/legend-toggle-manager.js';
import { NavigationController } from './src/navigation/NavigationController.js';
import { runVerification } from './src/pathfinding/verification_script.js';

const idle = () => new Promise(resolve => {
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    window.requestIdleCallback(resolve, { timeout: 200 });
  } else {
    setTimeout(resolve, 0);
  }
});

const fetchJson = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    return null;
  }
  return response.json();
};

const urlParams = new URLSearchParams(window.location.search);
const autoLoadDebugLayers = urlParams.has('debug');
const enableVerification = urlParams.has('verify');

async function initApp() {
  // 1. Load Data
  const mvfAssetRoot = '/assets';
  const mvfData = await loadMVFBundle(`${mvfAssetRoot}/my_data.zip`);
  const { manifest, styles, locations, floors, entranceIds, entranceGeometryToFloorMap, geometry } = mvfData;

  const mapTitle = document.getElementById('map-title');
  if (mapTitle && manifest?.properties?.name) {
    mapTitle.textContent = manifest.properties.name;
  }

  const backButton = document.getElementById('back-button');
  if (backButton) {
    backButton.addEventListener('click', () => {
      window.history.back();
    });
  }

  // 2. Initialize Map
  const center = manifest.features?.[0]?.geometry?.coordinates || [0, 0];
  const themeColors = starlightTheme.colors;

  const map = new MapLibreMap({
    container: 'map',
    style: starlightTheme.mapStyle,
    center: center,
    zoom: 19,
    pitch: 60,
    bearing: -17,
    minZoom: 15,
    maxPitch: 85,
    antialias: true // Important for smooth edges
  });

  map.addControl(new NavigationControl(), 'top-right');

  // 3. Customize Basemap to match theme.js colors
  map.on('style.load', () => {
    const layers = map.getStyle().layers;
    layers.forEach(layer => {
      if (layer.type === 'background') {
        map.setPaintProperty(layer.id, 'background-color', themeColors.background);
      }
      if (layer.id.includes('water') && layer.type === 'fill') {
        map.setPaintProperty(layer.id, 'fill-color', themeColors.Restrooms);
      }
      if (layer.id.includes('road') || layer.id.includes('transportation')) {
        if (layer.type === 'line') {
          // Major roads: orange
          if (layer.id.includes('major') || layer.id.includes('primary') || layer.id.includes('trunk') || layer.id.includes('motorway')) {
            map.setPaintProperty(layer.id, 'line-color', '#D97706');
            map.setPaintProperty(layer.id, 'line-opacity', 0.8);
          }
          // Minor roads: dark gray
          else {
            map.setPaintProperty(layer.id, 'line-color', '#2A2D35');
            map.setPaintProperty(layer.id, 'line-opacity', 0.6);
          }
        }
      }
      if (layer.id.includes('building')) {
        map.setLayoutProperty(layer.id, 'visibility', 'none');
      }
    });
  });

  map.on('load', async () => {
    // 4. Setup Managers
    const layerManager = new LayerManager(map, themeColors);

    // 5. Render Layers
    layerManager.addBuildingShell(floors);
    layerManager.processStyles(styles, geometry, entranceIds);
    layerManager.addDoors(geometry, entranceIds, entranceGeometryToFloorMap);
    layerManager.addLabels(locations, geometry);

    // 5a. Load and display building address
    try {
      const response = await fetch(`${mvfAssetRoot}/address.json`);
      if (response.ok) {
        const addressData = await response.json();
        const addressDisplay = document.getElementById('map-address');
        if (addressDisplay && addressData.primary?.display?.displayAddress) {
          addressDisplay.textContent = addressData.primary.display.displayAddress;
        }
      }
    } catch (e) {
      console.warn('Failed to load building address:', e);
    }

    // 6. Setup UI
    const uiManager = new UIManager(map, layerManager, floors);
    uiManager.init();

    // 6b. Setup Search Bar
    import('./src/ui/SearchBox.js').then(({ SearchBox }) => {
      const searchBox = new SearchBox(map, layerManager, locations, floors);
      searchBox.init();
    });

    // 7. Navigation Controller (initialize in background so UI stays responsive)
    const navigationController = new NavigationController(map, layerManager);
    window.navigationController = navigationController;
    const navigationReady = (async () => {
      await idle(); // let map/UI paint first
      try {
        return await navigationController.initialize(mvfData, mvfAssetRoot);
      } catch (e) {
        console.error('Navigation initialization failed:', e);
        return false;
      }
    })();

    // Get first floor as default user location floor
    const defaultFloorId = floors?.[0]?.properties?.id || null;

    // Directions UI (existing component; only needs a panel + toggle in HTML)
    const directionsToggle = document.getElementById('directions-toggle');
    const directionsPanel = document.getElementById('directions-panel');
    let directionsUI = null;
    let directionsInitPromise = null;
    let directionsLoadingStatusEl = null;

    const renderDirectionsLoading = (message) => {
      if (!directionsPanel) return;
      directionsPanel.classList.remove('is-hidden');
      if (directionsLoadingStatusEl) {
        directionsLoadingStatusEl.textContent = message;
        return;
      }
      directionsPanel.innerHTML = `
        <div class="directions-header">
          <div class="directions-title">Directions</div>
          <button class="directions-close" id="directions-close" aria-label="Close directions">&times;</button>
        </div>
        <div class="direction-status">${message}</div>
      `;
      directionsLoadingStatusEl = directionsPanel.querySelector('.direction-status');
    };

    const ensureDirectionsUI = async () => {
      if (directionsUI) return directionsUI;
      if (directionsInitPromise) return directionsInitPromise;

      directionsInitPromise = (async () => {
        renderDirectionsLoading('Loading routing engine…');
        const statusHandler = (e) => {
          const message = e?.detail?.message;
          if (typeof message === 'string' && message.trim().length > 0) {
            renderDirectionsLoading(message);
          }
        };

        window.addEventListener('navigation-status', statusHandler);
        const slowTimer = setTimeout(() => {
          renderDirectionsLoading('Still building routing graph… (first run can take ~10–30s)');
        }, 3000);

        const ready = await navigationReady;
        clearTimeout(slowTimer);
        window.removeEventListener('navigation-status', statusHandler);
        if (!ready) {
          renderDirectionsLoading('Routing failed to initialize.');
          return null;
        }

        const [{ DirectionsUI }] = await Promise.all([
          import('./src/pathfinding/visualization/DirectionsUI.js')
        ]);

        const ui = new DirectionsUI(
          map,
          navigationController.getEngine(),
          navigationController.getRenderer(),
          floors,
          navigationController.getSmoother()
        );
        directionsLoadingStatusEl = null;
        ui.initialize(uiManager.getCurrentFloorId() || defaultFloorId);
        ui.setEnabled(false);

        window.addEventListener('floor-changed', (e) => {
          ui.updateCurrentFloor(e.detail.floorId);
        });

        directionsUI = ui;
        return ui;
      })();

      return directionsInitPromise;
    };

    const setDirectionsOpen = async (open) => {
      if (!directionsPanel || !directionsToggle) return;
      directionsToggle.classList.toggle('is-active', open);

      if (!open) {
        if (directionsUI) {
          directionsUI.setEnabled(false);
        } else {
          directionsPanel.classList.add('is-hidden');
        }
        return;
      }

      directionsPanel.classList.remove('is-hidden');
      const ui = await ensureDirectionsUI();
      if (!ui) return;
      ui.setEnabled(true);
    };

    if (directionsToggle && directionsPanel) {
      directionsToggle.addEventListener('click', async () => {
        const open = directionsPanel.classList.contains('is-hidden');
        await setDirectionsOpen(open);
      });

      // Close button inside panel
      directionsPanel.addEventListener('click', (event) => {
        if (event.target && event.target.id === 'directions-close') {
          setDirectionsOpen(false);
        }
      });

      // Auto-open directions when a destination is selected.
      window.addEventListener('location-clicked', () => {
        setDirectionsOpen(true);
      });

      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          setDirectionsOpen(false);
        }
      });
    }

    // 7c. Run verification in background
    if (enableVerification) {
      navigationReady.then((ready) => {
        if (!ready) return;
        setTimeout(async () => {
          await runVerification(navigationController.getEngine());
        }, 2000);
      });
    }

    // Debug/Developer legend (loads heavy layers only when opened)
    const layersToggle = document.getElementById('layers-toggle');
    const legendPanel = document.getElementById('developer-legend');

    const debugLayerDefinitions = new Map([
      {
        layerId: 'wall-nodes-layer',
        url: '/assets/wall_nodes.geojson',
        add: (dataOrUrl) => layerManager.addWallNodes(dataOrUrl)
      },
      {
        layerId: 'stairs-nodes-layer',
        url: '/assets/stairs_nodes.geojson',
        add: (dataOrUrl) => layerManager.addStairsNodes(dataOrUrl)
      },
      {
        layerId: 'elevator-nodes-layer',
        url: '/assets/elevator_nodes.geojson',
        add: (dataOrUrl) => layerManager.addElevatorNodes(dataOrUrl)
      },
      {
        layerId: 'annotation-nodes-layer',
        url: '/assets/annotation_nodes.geojson',
        add: async (dataOrUrl) => {
          const data = typeof dataOrUrl === 'string' ? await fetchJson(dataOrUrl) : dataOrUrl;
          if (!data) {
            throw new Error(`Failed to load ${dataOrUrl}`);
          }
          await layerManager.addAnnotationNodes(data);
        }
      },
      {
        layerId: 'walkable-nodes-layer',
        url: '/assets/walkable_nodes.geojson',
        add: (dataOrUrl) => layerManager.addWalkableNodes(dataOrUrl)
      },
      {
        layerId: 'walkable-areas-layer',
        url: '/assets/walkable_areas.geojson',
        add: (dataOrUrl) => layerManager.addWalkableAreas(dataOrUrl)
      },
      {
        layerId: 'nonwalkable-nodes-layer',
        url: '/assets/nonwalkable_nodes.geojson',
        add: (dataOrUrl) => layerManager.addNonwalkableNodes(dataOrUrl)
      },
      {
        layerId: 'kinds-nodes-layer',
        url: '/assets/kinds_nodes.geojson',
        add: (dataOrUrl) => layerManager.addKindsNodes(dataOrUrl)
      },
      {
        layerId: 'entrance-aesthetic-nodes-layer',
        url: '/assets/entrance_aesthetic_nodes.geojson',
        add: (dataOrUrl) => layerManager.addEntranceAestheticNodes(dataOrUrl)
      },
      {
        layerId: 'location-markers-layer',
        url: '/assets/location_markers.geojson',
        add: (dataOrUrl) => layerManager.addLocationMarkers(dataOrUrl)
      }
    ].map(def => [def.layerId, def]));

    const loadedDebugLayers = new Set();
    const inFlightDebugLayerLoads = new Map();

    const ensureLayerLoaded = async (layerId) => {
      if (loadedDebugLayers.has(layerId)) return;

      const loader = debugLayerDefinitions.get(layerId);
      if (!loader) return;

      if (inFlightDebugLayerLoads.has(layerId)) {
        await inFlightDebugLayerLoads.get(layerId);
        return;
      }

      const loadPromise = (async () => {
        await idle();
        try {
          await loader.add(loader.url);
          layerManager.updateFloorVisibility(uiManager.getCurrentFloorId());
          loadedDebugLayers.add(layerId);
        } catch (e) {
          console.error(`Error loading ${loader.url}:`, e);
        }
      })();

      inFlightDebugLayerLoads.set(layerId, loadPromise);
      try {
        await loadPromise;
      } finally {
        inFlightDebugLayerLoads.delete(layerId);
      }
    };

    // Defaults: keep heavy layers off unless explicitly enabled.
    const debugLayerDefaults = {
      'wall-nodes-layer': false,
      'stairs-nodes-layer': true,
      'elevator-nodes-layer': true,
      'annotation-nodes-layer': true,
      'walkable-nodes-layer': false,
      'walkable-areas-layer': true,
      'nonwalkable-nodes-layer': false,
      'kinds-nodes-layer': false,
      'entrance-aesthetic-nodes-layer': true,
      'location-markers-layer': true
    };

    const legendToggleManager = new LegendToggleManager(layerManager, {
      defaults: debugLayerDefaults,
      ensureLayerLoaded,
      autoLoadEnabledLayers: autoLoadDebugLayers
    });
    legendToggleManager.init();

    const prefetchEnabledDebugLayers = async () => {
      const enabledLayerIds = [];
      debugLayerDefinitions.forEach((_, layerId) => {
        if (legendToggleManager.getLayerState(layerId)) {
          enabledLayerIds.push(layerId);
        }
      });

      if (enabledLayerIds.length === 0) return;

      // Kick off loads in background; each layer yields once before starting.
      await Promise.allSettled(
        enabledLayerIds.map(async (layerId) => {
          await ensureLayerLoaded(layerId);
          layerManager.setLayerVisibility(layerId, legendToggleManager.getLayerState(layerId));
        })
      );
    };

    if (layersToggle && legendPanel) {
      layersToggle.addEventListener('click', () => {
        const opening = !legendPanel.classList.contains('is-open');
        const isOpen = legendPanel.classList.toggle('is-open');
        layersToggle.classList.toggle('is-active', isOpen);
        if (opening) {
          prefetchEnabledDebugLayers();
        }
      });

      document.addEventListener('click', (event) => {
        if (!legendPanel.contains(event.target) && !layersToggle.contains(event.target)) {
          legendPanel.classList.remove('is-open');
          layersToggle.classList.remove('is-active');
        }
      });

      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          legendPanel.classList.remove('is-open');
          layersToggle.classList.remove('is-active');
        }
      });
    }

    // Dev shortcut: `?debug=1` auto-loads the heavy debug layers on startup.
    if (autoLoadDebugLayers) {
      setTimeout(() => {
        prefetchEnabledDebugLayers();
      }, 0);
    }
  });
}

initApp().catch(console.error);
