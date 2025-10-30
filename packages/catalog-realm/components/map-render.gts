import GlimmerComponent from '@glimmer/component';
import Modifier, { NamedArgs } from 'ember-modifier';

// Leaflet type definitions
interface LeafletMap {
  setView: (center: [number, number], zoom: number) => LeafletMap;
  addTo: (layer: any) => LeafletMap;
  on: (event: string, handler: (event: any) => void) => LeafletMap;
  remove: () => void;
  getSize: () => { x: number; y: number };
  flyTo: (center: [number, number], zoom: number, options: any) => LeafletMap;
  flyToBounds: (bounds: any, options: any) => LeafletMap;
  invalidateSize: () => void;
}

interface LeafletTileLayer {
  addTo: (map: LeafletMap) => LeafletTileLayer;
  remove: () => void;
}

interface LeafletMarker {
  bindPopup: (content: string) => LeafletMarker;
  getLatLng: () => LeafletLatLng;
}

interface LeafletPolyline {
  // Leaflet polyline methods, we add this when we need more control over the polyline
}

type LeafletLayers = LeafletMarker | LeafletPolyline;

interface LeafletLatLng {
  lat: number;
  lng: number;
}

interface LeafletLayerGroup {
  addLayer: (layer: any) => LeafletLayerGroup;
  clearLayers: () => void;
  getLayers: () => any[];
  addTo: (map: LeafletMap) => LeafletLayerGroup;
}

export interface Coordinate {
  address?: string;
  lat: number;
  lng: number;
}

export interface Route {
  name?: string;
  coordinates: Coordinate[];
}

interface LeafletMapConfig {
  tileserverUrl?: string;
  disableMapClick?: boolean;
}

interface MapRenderSignature {
  Args: {
    coordinates?: Coordinate[]; //use this arg if you want markers only
    routes?: Route[]; //use this arg if you want to render routes (polylines)
    mapConfig?: LeafletMapConfig;
    onMapClick?: (coordinate: Coordinate) => void;
  };
  Element: HTMLElement;
}

declare global {
  var L: any;
}

export class MapRender extends GlimmerComponent<MapRenderSignature> {
  <template>
    <figure
      {{LeafletModifier
        coordinates=@coordinates
        routes=@routes
        mapConfig=@mapConfig
        onMapClick=@onMapClick
      }}
      class='map'
    />

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
        background: var(--boxel-50);
        color: #666;
        font-size: 14px;
        text-align: center;
        flex: 1;
        overflow: hidden; /* Prevent scrollbars from affecting tile calculations */
      }

      figure.map :deep(.leaflet-container) {
        width: 100% !important;
        height: 100% !important;
        min-height: 300px;
      }
    </style>
    <link
      href='https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.min.css'
      rel='stylesheet'
    />
  </template>
}

interface LeafletTileInterface {
  onTileChange: (tile: string | null) => void;
}

class LeafletTile implements LeafletTileInterface {
  private tile: LeafletTileLayer | null = null;

  constructor(private map: LeafletMap) {
    this.map = map;
  }

  onTileChange(tile: string | null) {
    this.teardown();
    const defaultTile = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
    this.tile = L.tileLayer(tile || defaultTile, {
      maxZoom: 18,
      attribution: '© OpenStreetMap contributors',
    }).addTo(this.map);
  }

  teardown() {
    if (this.tile) {
      this.tile.remove();
      this.tile = null;
    }
  }
}

interface LeafletModifierSignature {
  Args: {
    Positional: [];
    Named: {
      coordinates?: Coordinate[];
      routes?: Route[];
      mapConfig?: LeafletMapConfig;
      onMapClick?: (coordinate: Coordinate) => void;
    };
  };
}

interface LeafletLayerStateInterface {
  onCoordinatesChange: (coordinates: Coordinate[]) => void;
  onRoutesChange: (routes: Route[]) => void;
}

class LeafletLayerState implements LeafletLayerStateInterface {
  private group: LeafletLayerGroup | null = null;

  constructor(private map: LeafletMap) {
    this.group = L.layerGroup();
    this.group?.addTo(this.map);
  }

  onCoordinatesChange(coordinates: Coordinate[]) {
    this.teardown();
    let markers = this.createMarkers(coordinates);
    this.addLayers(markers);
  }

  onRoutesChange(routes: Route[]) {
    this.teardown();
    let layersToAdd: LeafletLayers[] = [];
    routes.forEach((route) => {
      if (route.coordinates.length > 0) {
        this.createMarkers(route.coordinates).forEach((marker) =>
          layersToAdd.push(marker),
        );
      }
      let line = this.addPolyline(route.coordinates);
      if (line) layersToAdd.push(line);
    });
    this.addLayers(layersToAdd);
  }

  private addLayers(layers: LeafletLayers[]) {
    layers.forEach((layer) => this.group?.addLayer(layer));
    this.readjustMapView();
  }

  private createMarkers(coords: Coordinate[]): LeafletMarker[] {
    return coords.map((c, i) => {
      const color =
        i === 0 ? '#22c55e' : i === coords.length - 1 ? '#ef4444' : '#3b82f6';
      const marker = createMarker(c, color);
      if (c.address) marker.bindPopup(c.address);
      return marker;
    });
  }

  private addPolyline(coordinates: Coordinate[]): LeafletPolyline | null {
    if (coordinates.length < 2) return null;
    const latLngs = coordinates.map((c) => L.latLng(c.lat, c.lng));
    return new L.Polyline(latLngs);
  }

  private readjustMapView() {
    if (!this.group) return;

    let markerLayers = this.group
      .getLayers()
      .filter((layer: any) => layer instanceof L.Marker);
    let coords = markerLayers.map((markerLayer: LeafletMarker) => {
      return markerLayer.getLatLng();
    });
    this.fitMapToCoordinates(
      coords.map((ll: LeafletLatLng) => ({ lat: ll.lat, lng: ll.lng })),
    );
  }

  private fitMapToCoordinates(coords: Coordinate[], attempt = 0) {
    if (!this.map || coords.length === 0) {
      throw new Error('Map is not initialized or no coordinates provided');
    }

    let size = this.map.getSize ? this.map.getSize() : null;
    // Leaflet divides by the current map size; while prerender lays things out
    // the container reports 0×0 which produces NaNs, so retry a few times until
    // the map has real dimensions.
    if (!size || size.x === 0 || size.y === 0) {
      if (attempt >= 5) {
        return;
      }
      let delay = Math.min(200, 50 * (attempt + 1));
      setTimeout(() => {
        if (this.map) {
          this.fitMapToCoordinates(coords, attempt + 1);
        }
      }, delay);
      return;
    }

    if (coords.length === 1) {
      // single point → just flyTo
      this.map.flyTo([coords[0].lat, coords[0].lng], 15, {
        animate: true,
        duration: 1.2,
      });
    } else {
      const latLngs = coords.map((c) => L.latLng(c.lat, c.lng));
      this.map.flyToBounds(latLngs, {
        padding: [32, 32],
        animate: true,
        duration: 1.5,
      });
    }

    // Single invalidate size after view change to ensure proper tile coverage
    setTimeout(() => {
      if (this.map) {
        this.map.invalidateSize();
      }
    }, 200);
  }

  teardown() {
    this.group?.clearLayers();
  }
}

export default class LeafletModifier extends Modifier<LeafletModifierSignature> {
  private element: HTMLElement | null = null;
  private moduleSet: boolean = false;
  private map: LeafletMap | null = null;
  private tile: LeafletTile | null = null;
  private state: LeafletLayerState | undefined;

  modify(
    element: HTMLElement,
    _positional: [],
    named: NamedArgs<LeafletModifierSignature>,
  ) {
    let { coordinates, routes, onMapClick, mapConfig } = named;
    let { tileserverUrl } = mapConfig || {};
    this.element = element;

    // Prerendered runs start with a 0×0 container, so give Leaflet a minimal
    // footprint until the real layout kicks in.
    if (element && (element.clientWidth === 0 || element.clientHeight === 0)) {
      if (!element.style.minWidth) {
        element.style.minWidth = '320px';
      }
      if (!element.style.minHeight) {
        element.style.minHeight = '320px';
      }
    }

    (async () => {
      if (!this.moduleSet) {
        let module = await fetch(
          'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js',
        );
        let script = await module.text();
        eval(script);
        // the reason we do this is bcos there exist an error when adding a polyline layer
        // complaining that x() coordinate doesn't exist when calling intersects() method
        // this I suspect is due to a bug in the conversion of LatLng object into L.Bounds
        // which is a recurring issue in Leaflet github repo
        L.Bounds.prototype.intersects = function () {
          // Always return true (ignore bounds checks)
          return true;
        };
        this.initMap(mapConfig, onMapClick);
        this.moduleSet = true;
      }
      if (!this.map) {
        return;
      }
      if (!this.tile) {
        this.tile = new LeafletTile(this.map);
      }
      this.tile.onTileChange(tileserverUrl || null);

      if (!this.state) {
        this.state = new LeafletLayerState(this.map);
      }
      if (coordinates) {
        this.state.onCoordinatesChange(coordinates);
      }
      if (routes) {
        this.state.onRoutesChange(routes);
      }
    })();
  }

  willRemove() {
    this.teardown();
  }

  private initMap(
    mapConfig?: LeafletMapConfig,
    onMapClick?: (c: Coordinate) => void,
  ) {
    if (!this.element) return;

    this.map = L.map(this.element).setView([0, 0], 13);

    L.tileLayer(
      mapConfig?.tileserverUrl ||
        'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      {
        maxZoom: 18,
        attribution: '© OpenStreetMap contributors',
      },
    ).addTo(this.map);

    if (!mapConfig?.disableMapClick && onMapClick) {
      this.map?.on(
        'click',
        (event: { latlng: { lat: number; lng: number } }) => {
          const { lat, lng } = event.latlng;
          onMapClick({ lat, lng });
        },
      );
    }
  }

  private teardown() {
    this.state?.teardown();
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
  }
}

//utilities
function createMarker(coord: Coordinate, color: string): LeafletMarker {
  const strokeColor = darken(color, 0.3);
  const html = `<svg width="24" height="32" viewBox="0 0 24 32" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 0C5.3 0 0 5.3 0 12c0 8.5 12 20 12 20s12-11.5 12-20C24 5.3 18.7 0 12 0z"
            fill="${color}" stroke="${strokeColor}" stroke-width="2"/>
      <circle cx="12" cy="12" r="4" fill="white" stroke="${strokeColor}" stroke-width="1"/>
    </svg>`;

  return L.marker([coord.lat, coord.lng], {
    icon: L.divIcon({
      className: 'marker',
      html,
      iconSize: [24, 32],
      iconAnchor: [12, 32],
      popupAnchor: [0, -32],
    }),
  });
}

function darken(hex: string, factor: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  const d = (c: number) => Math.max(0, Math.floor(c * (1 - factor)));
  return `#${d(r).toString(16).padStart(2, '0')}${d(g)
    .toString(16)
    .padStart(2, '0')}${d(b).toString(16).padStart(2, '0')}`;
}
