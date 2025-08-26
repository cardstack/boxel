import GlimmerComponent from '@glimmer/component';
import Modifier, { NamedArgs } from 'ember-modifier';

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
  singleZoom?: number;
  fitBoundsPadding?: number;
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
        background: #f5f5f5;
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
  group: any | null = null;
  constructor(private map: any) {
    this.group = L.layerGroup();
    this.group.addTo(this.map);
  }

  addLayers(layers: any[]) {
    layers.forEach((layer) => this.group?.addLayer(layer));
    this.readjustMapView();
  }

  onCoordinatesChange(coordinates: Coordinate[]) {
    this.teardown();
    let markers = this.createMarkers(coordinates);
    this.addLayers(markers);
  }

  onRoutesChange(routes: Route[]) {
    this.teardown();
    let layersToAdd: any[] = [];
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

  private createMarkers(coords: Coordinate[]) {
    return coords.map((c, i) => {
      const color =
        i === 0 ? '#22c55e' : i === coords.length - 1 ? '#ef4444' : '#3b82f6';
      const marker = createMarker(c, color);
      if (c.address) marker.bindPopup(c.address);
      return marker;
    });
  }

  private addPolyline(coordinates: Coordinate[]) {
    const latLngs = coordinates.map((c) => L.latLng(c.lat, c.lng));
    return new L.Polyline(latLngs);
  }

  private readjustMapView() {
    let markerLayers = this.group
      .getLayers()
      .filter((layer: any) => layer instanceof L.Marker);
    let coords = markerLayers.map((markerLayer: any) => {
      return markerLayer.getLatLng();
    });
    this.fitMapToCoordinates(
      coords.map((ll: any) => ({ lat: ll.lat, lng: ll.lng })),
    );
  }

  private fitMapToCoordinates(coords: Coordinate[]) {
    if (!this.map || coords.length === 0) {
      throw new Error('Map is not initialized or no coordinates provided');
    }

    if (coords.length === 1) {
      // single point → just flyTo
      this.map.flyTo([coords[0].lat, coords[0].lng], 15, {
        animate: true,
        duration: 1.2,
      });
    } else {
      const latLngs = coords.map((c) => L.latLng([c.lat, c.lng]));
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
  element: HTMLElement | null = null;
  moduleSet: boolean = false;
  map: any;
  state: LeafletLayerState | undefined;

  modify(
    element: HTMLElement,
    _positional: [],
    named: NamedArgs<LeafletModifierSignature>,
  ) {
    let { coordinates, routes, onMapClick, mapConfig } = named;
    this.element = element;

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
    const zoom = mapConfig?.singleZoom ?? 13;
    this.map = L.map(this.element!).setView([0, 0], zoom);

    L.tileLayer(
      mapConfig?.tileserverUrl ||
        'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      {
        maxZoom: 18,
        attribution: '© OpenStreetMap contributors',
      },
    ).addTo(this.map);

    if (!mapConfig?.disableMapClick && onMapClick) {
      this.map.on('click', (event: any) => {
        const { lat, lng } = event.latlng;
        onMapClick({ lat, lng });
      });
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
function createMarker(coord: Coordinate, color: string) {
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

function darken(hex: string, factor: number) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  const d = (c: number) => Math.max(0, Math.floor(c * (1 - factor)));
  return `#${d(r).toString(16).padStart(2, '0')}${d(g)
    .toString(16)
    .padStart(2, '0')}${d(b).toString(16).padStart(2, '0')}`;
}
