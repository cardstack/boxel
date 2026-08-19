import { CardDef, field, contains, Component } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import { modifier } from 'ember-modifier';
// @ts-expect-error esm.sh is a runtime import; TS can't resolve it
import L from 'https://esm.sh/leaflet@1.9.4';

// 🧩 PATTERN: Leaflet map inside a card.
//
// Requires Leaflet CSS to be linked in the template (see below).

interface MapConfig {
  center: [number, number];   // [lat, lng]
  zoom: number;
  marker?: { lat: number; lng: number; label?: string };
}

const leafletMapModifier = modifier(
  (element: HTMLElement, [config]: [MapConfig]) => {
    const map = L.map(element).setView(config.center, config.zoom);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    if (config.marker) {
      // Use an absolute URL for the marker icon — relative paths don't resolve in realms.
      const icon = L.icon({
        iconUrl: 'https://esm.sh/leaflet@1.9.4/dist/images/marker-icon.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
      });
      const m = L.marker([config.marker.lat, config.marker.lng], { icon }).addTo(map);
      if (config.marker.label) m.bindPopup(config.marker.label);
    }

    return () => {
      map.remove(); // 🎯 Full cleanup: layers, listeners, DOM
    };
  },
);

// === The CardDef ======================================================

export class GeoLocationCard extends CardDef {
  static displayName = 'Geo Location';

  @field name      = contains(StringField);
  @field latitude  = contains(NumberField);
  @field longitude = contains(NumberField);

  static isolated = class extends Component<typeof GeoLocationCard> {
    get mapConfig(): MapConfig {
      const lat = Number(this.args.model.latitude ?? 51.5);
      const lng = Number(this.args.model.longitude ?? -0.1);
      return {
        center: [lat, lng],
        zoom: 13,
        marker: { lat, lng, label: this.args.model.name ?? 'Location' },
      };
    }

    <template>
      {{!-- Leaflet's stylesheet — required for tiles + controls --}}
      <link rel='stylesheet' href='https://esm.sh/leaflet@1.9.4/dist/leaflet.css' />

      <article class='geo-card'>
        <h1>{{@model.name}}</h1>
        <div class='map-host' {{leafletMapModifier this.mapConfig}}></div>
      </article>

      <style scoped>
        .geo-card { padding: 1rem; }
        .map-host {
          width: 100%;
          height: 400px;       /* Leaflet needs explicit dimensions */
          border-radius: var(--radius, 8px);
          margin-top: 0.5rem;
        }
      </style>
    </template>
  };
}
