import GlimmerComponent from '@glimmer/component';
import Modifier, { NamedArgs } from 'ember-modifier';
import { action } from '@ember/object';

interface MapRenderSignature {
  Args: {
    lat?: number;
    lon?: number;
    tileserverUrl?: string;
    config?: any;
    disableMapClick?: boolean;
    onMapClickUpdate?: (lat: number, lon: number) => void;
  };
  Element: HTMLElement;
}

interface LeafletMouseEvent {
  originalEvent: MouseEvent;
  latlng: { lat: number; lng: number };
  target: any;
  type: string;
}

// Type declaration for Leaflet - this tells TypeScript about the global L object
// This is needed because Leaflet is loaded dynamically and creates a global 'L' variable
declare global {
  var L: any;
}

// Helper functions
// Creates the HTML content for a map popup, showing a title and coordinates.
function createPopupContent(
  coordinates: { lat: number; lng: number },
  title: string,
): string {
  return `
    <div style="text-align: center; min-width: 250px;">
      <div style="font-weight: bold; margin-bottom: 8px;">📍 ${title}</div>
      <div style="margin-bottom: 6px; color: #666;">
        <strong>Coordinates:</strong><br>
        ${coordinates.lat.toFixed(6)}, ${coordinates.lng.toFixed(6)}
      </div>
    </div>
  `;
}

// Creates a Leaflet popup instance with custom options.
function createPopup() {
  return L.popup({
    offset: [0, -20],
    closeButton: false,
    autoClose: false,
  });
}

// Sets up popup behavior for a marker: shows popup on mouseover, hides on mouseout.
function setupMarkerPopup(
  marker: any,
  coordinates: { lat: number; lng: number },
  map: any,
  title: string,
): void {
  const popup = createPopup().setContent(
    createPopupContent(coordinates, title),
  );

  marker.on('mouseover', () => {
    popup.setLatLng([coordinates.lat, coordinates.lng]).openOn(map);
  });

  marker.on('mouseout', () => {
    popup.remove();
  });
}

// Determines if a map click event originated from a marker element.
function isMarkerClick(event: LeafletMouseEvent): boolean {
  if (!event.originalEvent?.target) return false;

  const target = event.originalEvent.target as HTMLElement;
  return !!(
    target.closest('.leaflet-marker-icon') || target.closest('.leaflet-marker')
  );
}

export class MapRender extends GlimmerComponent<MapRenderSignature> {
  map: any;

  get shouldShowMap() {
    return !!(this.args.lat && this.args.lon);
  }

  @action
  setMap(map: any) {
    this.map = map;
  }

  @action
  handleMapClick(lat: number, lng: number) {
    if (this.args.onMapClickUpdate) {
      this.args.onMapClickUpdate(lat, lng);
    }
  }

  <template>
    {{#if this.shouldShowMap}}
      <figure
        {{LeafletModifier
          lat=@lat
          lon=@lon
          tileserverUrl=@tileserverUrl
          config=@config
          disableMapClick=@disableMapClick
          setMap=this.setMap
          onMapClick=this.handleMapClick
        }}
        class='map'
      />
    {{else}}
      <div class='map-placeholder'>
        <div class='placeholder-text'>
          <div class='simple-placeholder'>
            <div class='placeholder-icon'>📍</div>
            <div class='placeholder-title'>Enter Location Coordinates</div>
            <div class='placeholder-description'>
              Add correctly formatted coordinates to see the location on the map
            </div>
            <div class='placeholder-example'>
              <strong>Example:</strong><br />
              Lat: 40.7128<br />
              Lon: -74.0060
            </div>
          </div>
        </div>
      </div>
    {{/if}}

    <style scoped>
      figure.map {
        margin: 0;
        width: 100%;
        height: 100%;
        min-height: 300px;
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #f5f5f5;
        color: #666;
        font-size: 14px;
        text-align: center;
      }

      .map-placeholder {
        width: 100%;
        height: 100%;
        padding: 1rem;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #f8fafc;
        border: 2px dashed #cbd5e1;
        border-radius: 8px;
      }

      .placeholder-text {
        color: #64748b;
        font-size: 14px;
        font-weight: 500;
        text-align: center;
        width: 100%;
      }

      .simple-placeholder {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
        padding: 20px;
      }

      .placeholder-icon {
        font-size: 48px;
        margin-bottom: 8px;
      }

      .placeholder-title {
        font-size: 18px;
        font-weight: 600;
        color: #1e293b;
        margin-bottom: 4px;
      }

      .placeholder-description {
        font-size: 14px;
        color: #64748b;
        text-align: center;
        line-height: 1.5;
        margin-bottom: 16px;
      }

      .placeholder-example {
        background: #f1f5f9;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        padding: 12px;
        font-size: 13px;
        color: #475569;
        line-height: 1.6;
        min-width: 280px;
      }
    </style>
    <link
      href='https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.min.css'
      rel='stylesheet'
    />
  </template>
}

interface LeafletModifierSignature {
  Args: {
    Positional: [];
    Named: {
      lat?: number;
      lon?: number;
      tileserverUrl?: string;
      config?: any;
      disableMapClick?: boolean;
      setMap?: (map: any) => void;
      onMapClick?: (lat: number, lng: number) => void;
    };
  };
}

export class LeafletModifier extends Modifier<LeafletModifierSignature> {
  element: HTMLElement | null = null;
  map: any = null;
  marker: any = null;
  lastConfig: any = null;

  private darkenColor(color: string, factor: number): string {
    // Convert hex to RGB
    const hex = color.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);

    // Darken by factor
    const newR = Math.max(0, Math.floor(r * (1 - factor)));
    const newG = Math.max(0, Math.floor(g * (1 - factor)));
    const newB = Math.max(0, Math.floor(b * (1 - factor)));

    // Convert back to hex
    return `#${newR.toString(16).padStart(2, '0')}${newG
      .toString(16)
      .padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
  }

  private updateMarkerColor(config: any) {
    if (!this.map || !this.marker) return;

    // Update marker color from config
    const markerColor = config?.markerColor || '#22c55e';
    const strokeColor = this.darkenColor(markerColor, 0.3);

    const newIcon = L.divIcon({
      className: 'marker',
      html: `<svg width="24" height="32" viewBox="0 0 24 32" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 0C5.373 0 0 5.373 0 12c0 8.5 12 20 12 20s12-11.5 12-20c0-6.627-5.373-12-12-12z" fill="${markerColor}" stroke="${strokeColor}" stroke-width="1"/>
        <circle cx="12" cy="12" r="4" fill="white" stroke="${strokeColor}" stroke-width="1"/>
      </svg>`,
      iconSize: [24, 32],
      iconAnchor: [12, 32],
    });

    this.marker.setIcon(newIcon);
  }

  modify(
    element: HTMLElement,
    [],
    namedArgs: NamedArgs<LeafletModifierSignature>,
  ) {
    this.element = element;

    // Check if config has changed
    const configChanged =
      JSON.stringify(namedArgs.config) !== JSON.stringify(this.lastConfig);

    if (configChanged) {
      this.lastConfig = namedArgs.config;

      // If map already exists, update marker color
      if (this.map) {
        this.updateMarkerColor(namedArgs.config);
      } else {
        // First time initialization
        this.initializeMap(
          namedArgs.tileserverUrl,
          namedArgs.lat,
          namedArgs.lon,
          namedArgs.config,
          namedArgs.setMap,
          namedArgs.onMapClick,
          namedArgs.disableMapClick,
        );
      }
    }
  }

  private initializeMap(
    tileserverUrl?: string,
    lat?: number | undefined,
    lon?: number | undefined,
    config?: any,
    setMap?: (map: any) => void,
    onMapClick?: (lat: number, lng: number) => void,
    disableMapClick?: boolean,
  ) {
    fetch('https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.min.js')
      .then((r) => r.text())
      .then((t) => {
        eval(t);

        if (!lat || !lon) {
          lat = 0;
          lon = 0;
        }

        let map = L.map(this.element!).setView([lat, lon], 13);
        this.map = map;

        L.tileLayer(
          tileserverUrl || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        ).addTo(map);

        // Get marker color from config or use default
        const markerColor = config?.markerColor || '#22c55e';
        const strokeColor = this.darkenColor(markerColor, 0.3);

        // Create marker
        this.marker = L.marker([lat, lon], {
          icon: L.divIcon({
            className: 'marker',
            html: `<svg width="24" height="32" viewBox="0 0 24 32" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 0C5.373 0 0 5.373 0 12c0 8.5 12 20 12 20s12-11.5 12-20c0-6.627-5.373-12-12-12z" fill="${markerColor}" stroke="${strokeColor}" stroke-width="1"/>
              <circle cx="12" cy="12" r="4" fill="white" stroke="${strokeColor}" stroke-width="1"/>
            </svg>`,
            iconSize: [24, 32],
            iconAnchor: [12, 32],
          }),
        }).addTo(map);

        setupMarkerPopup(this.marker, { lat, lng: lon }, map, 'Location');

        // Add click handler only if map clicking is not disabled
        if (!disableMapClick) {
          map.on('click', (event: LeafletMouseEvent) => {
            // Use helper function to check if click target is a marker
            if (isMarkerClick(event)) {
              return;
            }

            const { lat: clickLat, lng: clickLng } = event.latlng;

            // Remove previous marker if one exists
            if (this.marker) {
              map.removeLayer(this.marker);
            }

            // Create new marker at clicked location
            const clickMarkerColor = config?.markerColor || '#22c55e';
            const clickStrokeColor = this.darkenColor(clickMarkerColor, 0.3);

            this.marker = L.marker([clickLat, clickLng], {
              icon: L.divIcon({
                className: 'marker',
                html: `<svg width="24" height="32" viewBox="0 0 24 32" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 0C5.373 0 0 5.373 0 12c0 8.5 12 20 12 20s12-11.5 12-20c0-6.627-5.373-12-12-12z" fill="${clickMarkerColor}" stroke="${clickStrokeColor}" stroke-width="1"/>
                  <circle cx="12" cy="12" r="4" fill="white" stroke="${clickStrokeColor}" stroke-width="1"/>
                </svg>`,
                iconSize: [24, 32],
                iconAnchor: [12, 32],
              }),
            }).addTo(map);

            setupMarkerPopup(
              this.marker,
              { lat: clickLat, lng: clickLng },
              map,
              'Location',
            );

            // Call optional callback with coordinates
            onMapClick?.(clickLat, clickLng);
          });
        }

        setMap?.(map);
      });
  }

  willRemove() {
    // Clean up map elements
    if (this.marker) {
      this.marker = null;
    }
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
  }
}
