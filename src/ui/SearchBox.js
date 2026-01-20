export class SearchBox {
    constructor(map, layerManager, locations, floors = []) {
        this.map = map;
        this.layerManager = layerManager;
        this.locations = locations;
        this.searchIndex = (locations || []).map(loc => ({
            loc,
            name: loc?.details?.name || '',
            nameLower: (loc?.details?.name || '').toLowerCase()
        }));
        this.floorLookup = new Map();
        floors.forEach(floor => {
            const name = floor.properties?.details?.name || `Level ${floor.properties?.elevation ?? ''}`.trim();
            this.floorLookup.set(floor.properties.id, name);
        });
        this.selectedResultIndex = -1;
        this.searchResults = [];
    }

    init() {
        this.createSearchUI();
        this.setupEventListeners();
    }

    createSearchUI() {
        const container = document.createElement('div');
        container.className = 'search-container';
        container.innerHTML = `
            <div class="search-input-wrapper">
                <span class="search-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                </span>
                <input type="text" class="search-input" placeholder="Search..." aria-label="Search map">
                <button class="search-clear-btn" style="display: none;">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
            </div>
            <div class="search-results" style="display: none;"></div>
        `;
        document.body.appendChild(container);

        this.input = container.querySelector('.search-input');
        this.resultsContainer = container.querySelector('.search-results');
        this.clearBtn = container.querySelector('.search-clear-btn');
    }

    setupEventListeners() {
        // Debounce helper
        this.debounce = (func, wait) => {
            let timeout;
            return (...args) => {
                clearTimeout(timeout);
                timeout = setTimeout(() => func.apply(this, args), wait);
            };
        };

        // Toggle Clear Button & Search (Debounced)
        this.input.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase();
            this.clearBtn.style.display = query ? 'block' : 'none';

            // Debounce the heavy search logic
            if (!this.debouncedSearch) {
                this.debouncedSearch = this.debounce((q) => this.handleSearch(q), 300);
            }
            this.debouncedSearch(query);
        });

        // Clear Search
        this.clearBtn.addEventListener('click', () => {
            this.input.value = '';
            this.clearBtn.style.display = 'none';
            this.resultsContainer.style.display = 'none';
            this.input.focus();
        });

        // Keyboard Navigation
        this.input.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                this.navigateResults(1);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                this.navigateResults(-1);
            } else if (e.key === 'Enter') {
                if (this.selectedResultIndex >= 0 && this.searchResults[this.selectedResultIndex]) {
                    this.selectResult(this.searchResults[this.selectedResultIndex]);
                    this.input.blur();
                }
            }
        });

        // Close when clicking outside
        document.addEventListener('click', (e) => {
            if (!this.input.closest('.search-container').contains(e.target)) {
                this.resultsContainer.style.display = 'none';
            }
        });
    }

    handleSearch(query) {
        if (!query.trim()) {
            this.resultsContainer.style.display = 'none';
            return;
        }

        // Filter locations
        const needle = query.trim();
        this.searchResults = this.searchIndex
            .filter(entry => entry.nameLower.includes(needle))
            .slice(0, 10)
            .map(entry => entry.loc); // Limit to 10 results

        this.renderResults();
    }

    renderResults() {
        this.resultsContainer.innerHTML = '';
        this.selectedResultIndex = -1;

        if (this.searchResults.length === 0) {
            this.resultsContainer.innerHTML = '<div class="no-results">No results found</div>';
        } else {
            const fragment = document.createDocumentFragment();
            this.searchResults.forEach((loc, index) => {
                const item = document.createElement('div');
                item.className = 'search-result-item';
                // Safe access to floor
                let floorLabel = '';
                const anchor = loc.geometryAnchors && loc.geometryAnchors.length > 0 ? loc.geometryAnchors[0] : null;
                if (anchor) {
                    floorLabel = this.getFloorLabel(anchor.floorId);
                }

                item.innerHTML = `
                    <div class="result-icon">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.7"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
                    </div>
                    <div class="result-info">
                        <div class="result-name">${loc.details.name}</div>
                        <div class="result-floor">${floorLabel}</div>
                    </div>
                `;
                item.addEventListener('click', () => {
                    this.selectResult(loc);
                });
                fragment.appendChild(item);
            });
            this.resultsContainer.appendChild(fragment);
        }

        this.resultsContainer.style.display = 'block';
    }

    navigateResults(direction) {
        const items = this.resultsContainer.querySelectorAll('.search-result-item');
        if (items.length === 0) return;

        this.selectedResultIndex += direction;

        if (this.selectedResultIndex >= items.length) this.selectedResultIndex = 0;
        if (this.selectedResultIndex < 0) this.selectedResultIndex = items.length - 1;

        // Update visual selection
        items.forEach(item => item.classList.remove('selected'));
        const selected = items[this.selectedResultIndex];
        selected.classList.add('selected');
        selected.scrollIntoView({ block: 'nearest' });
    }

    selectResult(location) {
        this.input.value = location.details.name;
        this.resultsContainer.style.display = 'none';

        // Trigger map actions
        const anchor = location.geometryAnchors[0];
        if (!anchor) return;

        // Fly to location
        const coords = anchor.centroid || [0, 0]; // Fallback, though extractors should ensure this
        // If data structure differs, we might need a lookup utility (similar to base-layers.js addLabels)
        // Re-using logic:

        // Find Feature ID to sync selection
        const propsId = anchor.geometryId;
        const floorId = anchor.floorId;

        // Update Floor
        window.dispatchEvent(new CustomEvent('floor-changed', { detail: { floorId: floorId } }));

        // Simulate click for Directions UI setup
        // But first, we need actual coords if they aren't in 'anchor' directly
        // Assuming location object matches what we passed to UI Manager
        // For accurate centroid, we might rely on the labels layer map if accessible.
        // Let's assume passed locations have valid anchor coords or we trigger selection via ID

        // Better: Dispatch 'location-clicked' which UI Manager listens to
        // But we need coordinate data.

        // Let's try to get coords from layerManager's locationMap if available
        let finalCoords = coords;
        if (this.layerManager.locationMap && this.layerManager.locationMap.has(propsId)) {
            const locData = this.layerManager.locationMap.get(propsId);
            finalCoords = locData.coords;
        }

        // Fly
        this.map.flyTo({
            center: finalCoords,
            zoom: 20,
            pitch: 45,
            essential: true
        });

        // Trigger selection
        window.dispatchEvent(new CustomEvent('location-clicked', {
            detail: {
                name: location.details.name,
                coords: finalCoords,
                floorId: floorId,
                locationId: propsId
            }
        }));
    }

    getFloorLabel(floorId) {
        // Simple formatter, can be enhanced with map data lookup
        if (this.floorLookup.has(floorId)) {
            return this.floorLookup.get(floorId);
        }
        return 'Floor';
    }
}
