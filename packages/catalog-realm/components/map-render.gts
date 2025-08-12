import GlimmerComponent from '@glimmer/component';
import Modifier, { NamedArgs } from 'ember-modifier';
import { action } from '@ember/object';

interface MapRenderSignature {
  Args: {
    lat: number | undefined;
    lon: number | undefined;
    tileserverUrl: string | undefined;
    onCoordinatesUpdate?: (lat: number, lon: number) => void;
  };
  Element: HTMLElement;
}

export class MapRender extends GlimmerComponent<MapRenderSignature> {
  map: any;

  @action
  setMap(map: any) {
    this.map = map;
  }

  @action
  handleMapClick(lat: number, lng: number) {
    this.args.onCoordinatesUpdate?.(lat, lng);
  }

  <template>
    <figure
      {{LeafletModifier
        lat=this.args.lat
        lon=this.args.lon
        tileserverUrl=this.args.tileserverUrl
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

        const popupContent = `
          <div style="text-align: center; min-width: 250px;">
            <div style="font-weight: bold; margin-bottom: 8px;">📍 Current Location</div>
            <div style="margin-bottom: 6px; color: #666;">
              <strong>Coordinates:</strong><br>
              ${lat?.toFixed(6) ?? 'N/A'}, ${lon?.toFixed(6) ?? 'N/A'}
            </div>
          </div>
        `;

        const popup = L.popup({
          offset: [0, -20],
          closeButton: false,
          autoClose: false,
        }).setContent(popupContent);

        this.currentMarker.on('mouseover', () => {
          popup.setLatLng([defaultLat, defaultLon]).openOn(map);
        });

        this.currentMarker.on('mouseout', () => {
          popup.remove();
        });

        map.on('click', (e: any) => {
          if (e.originalEvent && e.originalEvent.target) {
            const target = e.originalEvent.target as HTMLElement;
            if (
              target.closest('.leaflet-marker-icon') ||
              target.closest('.leaflet-marker')
            ) {
              return;
            }
          }

          const { lat: clickLat, lng: clickLng } = e.latlng;

          if (this.currentMarker) {
            map.removeLayer(this.currentMarker);
          }

          this.currentMarker = L.marker([clickLat, clickLng]).addTo(map);

          const popupContent = `
            <div style="text-align: center; min-width: 250px;">
              <div style="font-weight: bold; margin-bottom: 8px;">📍 Selected Location</div>
              <div style="margin-bottom: 6px; color: #666;">
                <strong>Coordinates:</strong><br>
                ${clickLat?.toFixed(6) ?? 'N/A'}, ${
                  clickLng?.toFixed(6) ?? 'N/A'
                }
              </div>
            </div>
          `;

          const popup = L.popup({
            offset: [0, -20],
            closeButton: false,
            autoClose: false,
          }).setContent(popupContent);

          this.currentMarker.on('mouseover', () => {
            popup.setLatLng([clickLat, clickLng]).openOn(map);
          });

          this.currentMarker.on('mouseout', () => {
            popup.remove();
          });

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
