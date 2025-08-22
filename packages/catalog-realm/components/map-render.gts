import GlimmerComponent from '@glimmer/component';
import Modifier, { NamedArgs } from 'ember-modifier';
import { action } from '@ember/object';

export interface Coordinate {
  address?: string;
  lat: number;
  lng: number;
}

interface MapRenderSignature {
  Args: {
    coordinates: Coordinate[];
    mapConfig?: {
      tileserverUrl?: string;
      disableMapClick?: boolean;
      singleZoom?: number;
      fitBoundsPadding?: number;
      showLayerControl?: boolean;
    };
    onMapClickUpdate?: (coordinate: Coordinate) => void;
  };
  Element: HTMLElement;
}

declare global {
  var L: any;
}
let oldL: any;
export class MapRender extends GlimmerComponent<MapRenderSignature> {
  get shouldShowMap() {
    const coords = this.args.coordinates?.filter(
      (coord) =>
        coord &&
        typeof coord.lat === 'number' &&
        typeof coord.lng === 'number' &&
        !isNaN(coord.lat) &&
        !isNaN(coord.lng) &&
        coord.lat >= -90 &&
        coord.lat <= 90 &&
        coord.lng >= -180 &&
        coord.lng <= 180,
    );
    return coords && coords.length > 0;
  }

  get singleZoom() {
    return this.args.mapConfig?.singleZoom ?? 13;
  }

  get fitBoundsPadding() {
    return this.args.mapConfig?.fitBoundsPadding ?? 32;
  }

  @action
  handleMapClick(coordinate: Coordinate) {
    if (this.args.onMapClickUpdate) {
      this.args.onMapClickUpdate(coordinate);
    }
  }

  <template>
    {{#if this.shouldShowMap}}
      <figure
        {{LeafletModifier
          coordinates=@coordinates
          mapConfig=@mapConfig
          onMapClickUpdate=this.handleMapClick
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
      coordinates: Coordinate[];
      mapConfig?: {
        tileserverUrl?: string;
        disableMapClick?: boolean;
        singleZoom?: number;
        fitBoundsPadding?: number;
        showLayerControl?: boolean;
      };
      onMapClickUpdate?: (coordinate: Coordinate) => void;
    };
  };
}

export default class LeafletModifier extends Modifier<LeafletModifierSignature> {
  element: HTMLElement | null = null;
  map: any | null = null;

  markersGroup: any | null = null;
  routeGroup: any | null = null;
  startMarkerGroup: any | null = null;
  endMarkerGroup: any | null = null;
  polyline: any | null = null;
  moduleSet: boolean = false;

  modify(
    element: HTMLElement,
    _positional: [],
    named: NamedArgs<LeafletModifierSignature>,
  ) {
    console.log(named.coordinates);
    this.element = element;

    (async () => {
      if (!this.moduleSet) {
        // 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.min.js',
        let module = await fetch(
          'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js',

          // 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet-src.esm.js',
        );
        let script = await module.text();
        eval(script);
        this.initMap(named.mapConfig, named.onMapClickUpdate);
        this.moduleSet = true;
      }
      this.resetLayers();
      this.updateLayers(named.coordinates);
    })();
  }

  willRemove() {
    this.teardown();
  }

  //
  // --- Private helpers ---
  //

  private initMap(mapConfig?: any, onMapClickUpdate?: (c: Coordinate) => void) {
    console.log('checking initmap');
    console.log(window.L);
    console.log(oldL);
    console.log(window.L == oldL);
    if (!window.L) {
      throw new Error('Leaflet is not loaded, window L is not exist');
    }

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

    this.startMarkerGroup = L.layerGroup().addTo(this.map);
    this.endMarkerGroup = L.layerGroup().addTo(this.map);
    this.markersGroup = L.layerGroup().addTo(this.map);
    this.routeGroup = L.layerGroup().addTo(this.map);

    if (!mapConfig?.disableMapClick && onMapClickUpdate) {
      this.map.on('click', (event: any) => {
        const { lat, lng } = event.latlng;
        onMapClickUpdate({ lat, lng });
      });
    }
  }

  private resetLayers() {
    console.log('🧹 Resetting all layers...');

    // Clear polyline first
    if (this.polyline) {
      try {
        this.routeGroup?.removeLayer(this.polyline);
      } catch (error) {
        console.warn('Error removing polyline:', error);
      }
      this.polyline = null;
    }

    // Clear all layer groups
    [
      this.startMarkerGroup,
      this.endMarkerGroup,
      this.markersGroup,
      this.routeGroup,
    ].forEach((group, index) => {
      if (group) {
        try {
          group.clearLayers();
        } catch (error) {
          console.warn(`Error clearing layer group ${index}:`, error);
        }
      }
    });
  }

  private updateLayers(coordinates: Coordinate[]) {
    if (!this.map) {
      throw new Error('Map is not initialized');
    }

    if (coordinates.length === 0) {
      throw new Error('No coordinates provided');
    }

    if (coordinates.length > 0) {
      this.addMarkers(coordinates);
    }

    if (coordinates.length > 1) {
      this.addPolyline(coordinates);
    }

    this.fitMapToCoordinates(coordinates);
  }

  private addMarkers(coords: Coordinate[]) {
    coords.forEach((c, i) => {
      const color =
        i === 0 ? '#22c55e' : i === coords.length - 1 ? '#ef4444' : '#3b82f6';
      const group =
        i === 0
          ? this.startMarkerGroup
          : i === coords.length - 1
          ? this.endMarkerGroup
          : this.markersGroup;

      const marker = this.createMarker(c, color);
      if (c.address) marker.bindPopup(c.address);
      group?.addLayer(marker);
    });
  }

  private addPolyline(coordinates: Coordinate[]) {
    try {
      if (!window.L) {
        throw new Error('Leaflet not loaded');
      }

      const latLngs = coordinates.map((c) => ({ lat: c.lat, lng: c.lng }));

      let polyline = L.polyline(latLngs, {
        color: '#3b82f6',
        weight: 4,
        opacity: 0.7,
        smoothFactor: 1,
      });

      this.routeGroup.addLayer(polyline);
    } catch (error) {
      console.error('❌ Error in addPolyline:', error.message);
      console.error('Error stack:', error.stack);
    }
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

    this.map.invalidateSize();
  }

  private createMarker(coord: Coordinate, color: string) {
    const strokeColor = this.darken(color, 0.3);
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

  private darken(hex: string, factor: number) {
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    const d = (c: number) => Math.max(0, Math.floor(c * (1 - factor)));
    return `#${d(r).toString(16).padStart(2, '0')}${d(g)
      .toString(16)
      .padStart(2, '0')}${d(b).toString(16).padStart(2, '0')}`;
  }

  private teardown() {
    if (this.polyline) {
      this.routeGroup?.removeLayer(this.polyline);
      this.polyline = null;
    }

    [
      this.startMarkerGroup,
      this.endMarkerGroup,
      this.markersGroup,
      this.routeGroup,
    ].forEach((g) => {
      g?.clearLayers();
      if (this.map && this.map.hasLayer(g)) {
        this.map.removeLayer(g);
      }
    });

    if (this.map) {
      this.map.remove();
      this.map = null;
    }
  }
}
