import GlimmerComponent from '@glimmer/component';
import Modifier, { NamedArgs } from 'ember-modifier';
import { action } from '@ember/object';

interface MapRenderSignature {
  Args: {
    lat: number | undefined;
    lon: number | undefined;
    tileserverUrl?: string | undefined;
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

  @action
  setMap(map: any) {
    this.map = map;
  }

  @action
  handleMapClick(lat: number, lng: number) {
    this.args.onMapClickUpdate?.(lat, lng);
  }

  <template>
    <figure
      {{LeafletModifier
        lat=@lat
        lon=@lon
        tileserverUrl=@tileserverUrl
        setMap=this.setMap
        onMapClick=this.handleMapClick
      }}
      class='map'
    >
    </figure>

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
      lat: number | undefined;
      lon: number | undefined;
      tileserverUrl?: string;
      setMap?: (map: any) => void;
      onMapClick?: (lat: number, lng: number) => void;
    };
  };
}

export class LeafletModifier extends Modifier<LeafletModifierSignature> {
  element: HTMLElement | null = null;
  map: any = null;
  currentMarker: any = null;

  modify(
    element: HTMLElement,
    [],
    {
      lat,
      lon,
      tileserverUrl,
      setMap,
      onMapClick,
    }: NamedArgs<LeafletModifierSignature>,
  ) {
    this.element = element;

    fetch('https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.min.js')
      .then((r) => r.text())
      .then((t) => {
        eval(t);

        // Use default coordinates if lat/lon are null/undefined
        const defaultLat = lat ?? 0;
        const defaultLon = lon ?? 0;

        let map = L.map(element).setView([defaultLat, defaultLon], 13);
        this.map = map;

        L.tileLayer(
          tileserverUrl || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        ).addTo(map);

        this.currentMarker = L.marker([defaultLat, defaultLon]).addTo(map);

        // Use helper function for initial popup setup
        setupMarkerPopup(
          this.currentMarker,
          { lat: defaultLat, lng: defaultLon },
          map,
          'Current Location',
        );

        map.on('click', (event: LeafletMouseEvent) => {
          // Use helper function to check if click target is a marker
          if (isMarkerClick(event)) {
            return;
          }

          const { lat: clickLat, lng: clickLng } = event.latlng;

          // Remove previous marker if one exists
          if (this.currentMarker) {
            map.removeLayer(this.currentMarker);
          }

          // Create new marker at clicked location
          this.currentMarker = L.marker([clickLat, clickLng]).addTo(map);

          // Use helper function for onMapClick marker popup setup
          setupMarkerPopup(
            this.currentMarker,
            { lat: clickLat, lng: clickLng },
            map,
            'Selected Location',
          );

          // Call optional callback with coordinates
          onMapClick?.(clickLat, clickLng);
        });

        setMap?.(map);
      });
  }

  willRemove() {
    if (this.currentMarker) {
      this.currentMarker = null;
    }
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
  }
}
