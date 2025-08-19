import GlimmerComponent from '@glimmer/component';
import Modifier, { NamedArgs } from 'ember-modifier';
import { action } from '@ember/object';

export interface Coordinate {
  lat: number;
  lng: number;
}

export interface RoutePoint extends Coordinate {
  address?: string;
}

interface MapRenderSignature {
  Args:
    | {
        coordinate: Coordinate;
        route?: never;
        tileserverUrl?: string;
        disableMapClick?: boolean;
        onMapClickUpdate?: (coordinate: Coordinate) => void;
        onRouteUpdate?: never;
      }
    | {
        route: RoutePoint[];
        coordinate?: never;
        tileserverUrl?: string;
        disableMapClick?: boolean;
        onMapClickUpdate?: (coordinate: Coordinate) => void;
        onRouteUpdate?: (route: RoutePoint[]) => void;
      };
  Element: HTMLElement;
}

interface LeafletMouseEvent {
  originalEvent: MouseEvent;
  latlng: Coordinate;
  target: HTMLElement;
  type: string;
}

interface LeafletMap {
  setView: (coords: [number, number], zoom: number) => LeafletMap;
  addTo: (container: HTMLElement) => LeafletMap;
  on: (
    event: string,
    handler: (event: LeafletMouseEvent) => void,
  ) => LeafletMap;
  removeLayer: (layer: any) => LeafletMap;
  fitBounds: (bounds: any) => LeafletMap;
  remove: () => void;
  eachLayer: (callback: (layer: any) => void) => void;
}

interface LeafletMarker {
  addTo: (map: LeafletMap) => LeafletMarker;
  bindPopup: (content: string) => LeafletMarker;
  on: (event: string, handler: () => void) => LeafletMarker;
  remove: () => void;
}

declare global {
  var L: any;
}

export class MapRender extends GlimmerComponent<MapRenderSignature> {
  map: any;

  get shouldShowMap() {
    const coords = getCoordinateOrRoute(this.args);
    return !!coords;
  }

  get coordinate() {
    return getCoordinateOrRoute(this.args);
  }

  @action
  setMap(map: any) {
    this.map = map;
  }

  @action
  handleMapClick(coordinate: Coordinate) {
    if (this.args.onMapClickUpdate) {
      this.args.onMapClickUpdate(coordinate);
    }
  }

  @action
  handleRouteUpdate(route: RoutePoint[]) {
    if (this.args.onRouteUpdate) {
      this.args.onRouteUpdate(route);
    }
  }

  <template>
    {{#if this.shouldShowMap}}
      <figure
        {{LeafletModifier
          coordinate=@coordinate
          route=@route
          tileserverUrl=@tileserverUrl
          disableMapClick=@disableMapClick
          setMap=this.setMap
          onMapClick=this.handleMapClick
          onRouteUpdate=this.handleRouteUpdate
        }}
        class='map'
      />
    {{else}}
      <div class='map-placeholder'>
        <div class='placeholder-text'>
          <div class='simple-placeholder'>
            <div class='placeholder-icon'>📍</div>
            <div class='placeholder-title'>Enter Location Coordinate</div>
            <div class='placeholder-description'>
              Add correctly formatted coordinate to see the location on the map
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
      coordinate?: Coordinate;
      route?: RoutePoint[];
      tileserverUrl?: string;
      disableMapClick?: boolean;
      setMap?: (map: LeafletMap) => void;
      onMapClick?: (coordinate: Coordinate) => void;
      onRouteUpdate?: (route: RoutePoint[]) => void;
    };
  };
}

export class LeafletModifier extends Modifier<LeafletModifierSignature> {
  element: HTMLElement | null = null;
  map: LeafletMap | null = null;
  marker: LeafletMarker | null = null;

  modify(
    element: HTMLElement,
    [],
    namedArgs: NamedArgs<LeafletModifierSignature>,
  ) {
    this.element = element;

    if (this.map) {
      this.updateMap(namedArgs);
    } else {
      // Only initialize if map doesn't exist
      this.initializeMap(
        namedArgs.tileserverUrl,
        namedArgs.coordinate,
        namedArgs.route,
        namedArgs.setMap,
        namedArgs.onMapClick,
        namedArgs.onRouteUpdate,
        namedArgs.disableMapClick,
      );
    }
  }

  private updateMap(namedArgs: NamedArgs<LeafletModifierSignature>) {
    if (!this.map) return;

    // Clear existing route and markers
    this.clearMap();

    // Update coordinate
    if (namedArgs.coordinate) {
      this.map.setView(
        [namedArgs.coordinate.lat, namedArgs.coordinate.lng],
        13,
      );
      this.marker = createMarker(
        namedArgs.coordinate,
        '#ef4444',
        'marker',
      ).addTo(this.map);

      if (this.marker) {
        setupMarkerPopup(
          this.marker,
          namedArgs.coordinate,
          this.map,
          'Location',
        );
      }
    }

    // Update route
    if (namedArgs.route && namedArgs.route.length > 0) {
      drawRoute(this.map, namedArgs.route, namedArgs.onRouteUpdate);
    }
  }

  private clearMap() {
    if (!this.map) return;

    // Remove all layers except the tile layer (base map)
    this.map.eachLayer((layer: any) => {
      if (layer instanceof L.TileLayer) return; // Keep base tiles
      this.map!.removeLayer(layer);
    });

    this.marker = null;
  }

  private initializeMap(
    tileserverUrl?: string,
    coordinate?: Coordinate,
    route?: RoutePoint[],
    setMap?: (map: LeafletMap) => void,
    onMapClick?: (coordinate: Coordinate) => void,
    onRouteUpdate?: (route: RoutePoint[]) => void,
    disableMapClick?: boolean,
  ) {
    // Load Leaflet library dynamically
    fetch('https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.min.js')
      .then((r) => r.text())
      .then((t) => {
        eval(t);

        // Initialize map with coordinate or defaults
        const defaultCoords: Coordinate = coordinate || { lat: 0, lng: 0 };
        const zoom = 13;
        let map = L.map(this.element!).setView(
          [defaultCoords.lat, defaultCoords.lng],
          zoom,
        );
        this.map = map;

        // Add tile layer (map background)
        L.tileLayer(
          tileserverUrl || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        ).addTo(map);

        // Draw route if provided
        if (route && route.length > 0) {
          drawRoute(map, route, onRouteUpdate);
        }

        // Only create default marker if no route is provided
        if (!route || route.length === 0) {
          this.marker = createMarker(defaultCoords, '#ef4444', 'marker').addTo(
            map,
          );
          if (this.marker) {
            setupMarkerPopup(this.marker, defaultCoords, map, 'Location');
          }
        }

        // Handle map click events
        if (!disableMapClick) {
          map.on('click', (event: LeafletMouseEvent) => {
            if (isMarkerClick(event)) {
              return;
            }

            const clickCoords: Coordinate = event.latlng;

            // Remove existing marker
            if (this.marker) {
              map.removeLayer(this.marker);
            }

            // Create new marker at clicked location
            this.marker = createMarker(clickCoords, '#ef4444', 'marker').addTo(
              map,
            );

            if (this.marker) {
              setupMarkerPopup(this.marker, clickCoords, map, 'Location');
            }
            onMapClick?.(clickCoords);
          });
        }

        setMap?.(map);
      });
  }

  willRemove() {
    if (this.marker) {
      this.marker = null;
    }
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
  }
}

function darkenColor(color: string, factor: number): string {
  const hex = color.replace('#', '');
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);

  const newR = Math.max(0, Math.floor(r * (1 - factor)));
  const newG = Math.max(0, Math.floor(g * (1 - factor)));
  const newB = Math.max(0, Math.floor(b * (1 - factor)));

  return `#${newR.toString(16).padStart(2, '0')}${newG
    .toString(16)
    .padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
}

function createMarker(
  coordinate: Coordinate | RoutePoint,
  color: string = '#ef4444',
  className: string = 'marker',
) {
  const strokeColor = darkenColor(color, 0.3);

  return L.marker([coordinate.lat, coordinate.lng], {
    icon: L.divIcon({
      className,
      html: `<svg width="24" height="32" viewBox="0 0 24 32" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 0C5.373 0 0 5.373 0 12c0 8.5 12 20 12 20s12-11.5 12-20c0-6.627-5.373-12-12-12z" fill="${color}" stroke="${strokeColor}" stroke-width="1"/>
        <circle cx="12" cy="12" r="4" fill="white" stroke="${strokeColor}" stroke-width="1"/>
      </svg>`,
      iconSize: [24, 32],
      iconAnchor: [12, 32],
    }),
  });
}

function drawRoute(
  map: LeafletMap,
  route: RoutePoint[],
  onRouteUpdate?: (route: RoutePoint[]) => void,
) {
  if (!map || route.length < 2) return;

  const routeCoords = route.map(
    (point) => [point.lat, point.lng] as [number, number],
  );

  const polyline = L.polyline(routeCoords, {
    color: '#3b82f6',
    weight: 3,
    opacity: 0.8,
  }).addTo(map);

  route.forEach((point, index) => {
    // Different styling for start vs other points
    const isStartPoint = index === 0;
    const markerColor = isStartPoint ? '#10b981' : '#ef4444'; // Green for start, red for others
    const markerClass = isStartPoint
      ? 'route-marker start-point'
      : 'route-marker';

    const marker = createMarker(point, markerColor, markerClass).addTo(map);

    if (point.address) {
      setupMarkerPopup(marker, point, map, point.address);
    }
  });

  map.fitBounds(polyline.getBounds());
  onRouteUpdate?.(route);
}

function createPopupContent(coordinate: Coordinate, title: string): string {
  return `
    <div style="text-align: center; min-width: 250px;">
      <div style="font-weight: bold; margin-bottom: 8px;">📍 ${title}</div>
      <div style="margin-bottom: 6px; color: #666;">
        <strong>Coordinate:</strong><br>
        ${coordinate.lat.toFixed(6)}, ${coordinate.lng.toFixed(6)}
      </div>
    </div>
  `;
}

function createPopup() {
  return L.popup({
    offset: [0, -20],
    closeButton: false,
    autoClose: false,
  });
}

function setupMarkerPopup(
  marker: LeafletMarker,
  coordinate: Coordinate,
  map: LeafletMap,
  title: string,
): void {
  const popup = createPopup().setContent(createPopupContent(coordinate, title));

  marker.on('mouseover', () => {
    popup.setLatLng([coordinate.lat, coordinate.lng]).openOn(map);
  });

  marker.on('mouseout', () => {
    popup.remove();
  });
}

function isMarkerClick(event: LeafletMouseEvent): boolean {
  if (!event.originalEvent?.target) return false;

  const target = event.originalEvent.target as HTMLElement;
  return !!(
    target.closest('.leaflet-marker-icon') || target.closest('.leaflet-marker')
  );
}

function getCoordinateOrRoute(
  args: MapRenderSignature['Args'],
): Coordinate | RoutePoint[] | null {
  if (args.coordinate) {
    return args.coordinate;
  }

  if (args.route) {
    return args.route;
  }

  return null;
}
