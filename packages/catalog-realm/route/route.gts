import MapIcon from '@cardstack/boxel-icons/map';
import StringField from 'https://cardstack.com/base/string';
import {
  Component,
  contains,
  containsMany,
  CardDef,
  field,
} from 'https://cardstack.com/base/card-api';
import { MapRender, type Coordinate } from '../components/map-render';
import { LeafletMapConfigField } from '../fields/leaflet-map-config-field';
import {
  GeoSearchPointField,
  GeoSearchPointEditTemplate,
} from '../fields/geo-search-point';

class AtomTemplate extends Component<typeof Route> {
  <template>
    <div class='route-display'>
      <MapIcon class='map-icon' />
      <div class='route-info'>
        <span class='route-title'>{{@model.title}}</span>
      </div>
    </div>

    <style scoped>
      .route-display {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-xxs);
        flex-shrink: 0;
      }

      .route-info {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .route-title {
        font-weight: 500;
        line-height: normal;
      }

      .map-icon {
        flex-shrink: 0;
        color: var(--map-icon-color, var(--boxel-red));
        width: var(--map-icon-width, 16px);
        height: var(--map-icon-height, 16px);
      }
    </style>
  </template>
}

class IsolatedTemplate extends Component<typeof Route> {
  get routeCoordinates(): Coordinate[] {
    const coordinates: Coordinate[] = [];

    // Get coordinates from the route field
    if (this.args.model?.coordinates) {
      this.args.model.coordinates.forEach((c: any) => {
        if (c?.lat && c?.lon) {
          const address = c.searchKey;
          coordinates.push({
            lat: c.lat,
            lng: c.lon,
            address: address && address.trim() !== '' ? address : 'Waypoint',
          });
        }
      });
    }

    return coordinates;
  }

  get routes() {
    return [
      {
        name: this.args.model?.title || 'Route',
        coordinates: this.routeCoordinates,
      },
    ];
  }

  get hasValidCoordinates() {
    return this.routeCoordinates.length > 0;
  }

  <template>
    <div class='isolated-template'>

      <div class='template-content'>
        <div class='fields-panel'>
          <div class='fields-header'>
            <h3>Route Configuration</h3>
            <p class='fields-description'>
              Add waypoints to create your route. Each waypoint will be
              connected to form a complete journey.
            </p>
          </div>
          <div class='fields-container'>
            <@fields.coordinates @format='edit' />
            <@fields.mapConfig @format='edit' />
          </div>
        </div>

        <div class='map-panel'>
          {{#if this.hasValidCoordinates}}
            <MapRender
              @routes={{this.routes}}
              @mapConfig={{@model.mapConfig}}
            />
          {{else}}
            <div class='map-placeholder'>
              <div class='placeholder-content'>
                <div class='placeholder-icon'>🗺️</div>
                <div class='placeholder-title'>Create Your Route</div>
                <div class='placeholder-description'>
                  Add waypoints using the configuration panel to visualize your
                  route on the map
                </div>
                <div class='placeholder-hint'>
                  <span class='hint-icon'>💡</span>
                  <span>Start by adding your first waypoint</span>
                </div>
              </div>
            </div>
          {{/if}}
        </div>
      </div>
    </div>

    <style scoped>
      .isolated-template {
        display: flex;
        flex-direction: column;
        height: 100vh;
        background: linear-gradient(
          135deg,
          var(--boxel-100) 0%,
          var(--boxel-surface-secondary) 100%
        );
        font-family:
          -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }

      .template-content {
        display: flex;
        flex: 1;
        min-height: 0;
        gap: 0;
      }

      .fields-panel {
        width: 420px;
        background: var(--boxel-light);
        border-right: 1px solid var(--boxel-border-color);
        display: flex;
        flex-direction: column;
        box-shadow: 2px 0 8px rgba(0, 0, 0, 0.04);
      }

      .fields-header {
        padding: var(--boxel-sp-xl);
        border-bottom: 1px solid var(--boxel-border-color);
        background: var(--boxel-surface-secondary);
      }

      .fields-header h3 {
        margin: 0 0 var(--boxel-sp-sm) 0;
        font-size: 18px;
        font-weight: 600;
        color: var(--boxel-text-color);
        letter-spacing: -0.01em;
      }

      .fields-description {
        margin: 0;
        font-size: 14px;
        color: var(--boxel-text-muted);
        line-height: 1.5;
      }

      .fields-container {
        flex: 1;
        padding: var(--boxel-sp-xl);
        overflow-y: auto;
        background: var(--boxel-light);
      }

      .fields-container > * + * {
        margin-top: var(--boxel-sp);
      }

      .map-panel {
        flex: 1;
        display: flex;
        flex-direction: column;
        background: var(--boxel-surface-secondary);
      }

      .map-placeholder {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        margin: var(--boxel-sp-xl);
        border-radius: var(--boxel-border-radius-xl);
        background: var(--boxel-100);
        border: 2px dashed var(--boxel-border-color);
        transition: all 0.2s ease;
      }

      .map-placeholder:hover {
        border-color: var(--boxel-blue);
        background: var(--boxel-surface-secondary);
        transform: translateY(-2px);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
      }

      .placeholder-content {
        text-align: center;
        color: var(--boxel-text-muted);
        padding: var(--boxel-sp-xxl);
        max-width: 400px;
      }

      .placeholder-icon {
        font-size: 64px;
        margin-bottom: var(--boxel-sp-lg);
        filter: grayscale(0.3);
      }

      .placeholder-title {
        font-size: 22px;
        font-weight: 600;
        margin-bottom: var(--boxel-sp-sm);
        color: var(--boxel-text-color);
        letter-spacing: -0.01em;
      }

      .placeholder-description {
        font-size: 16px;
        line-height: 1.6;
        margin-bottom: var(--boxel-sp-lg);
        color: var(--boxel-text-muted);
      }

      .placeholder-hint {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-sm) var(--boxel-sp-md);
        background: var(--boxel-surface-secondary);
        border-radius: var(--boxel-border-radius);
        font-size: 14px;
        color: var(--boxel-text-muted);
      }

      .hint-icon {
        font-size: 16px;
      }
    </style>
  </template>
}

class EmbeddedTemplate extends Component<typeof Route> {
  get routeCoordinates(): Coordinate[] {
    const coordinates: Coordinate[] = [];

    // Get coordinates from the routes field
    if (this.args.model?.coordinates) {
      this.args.model.coordinates.forEach((routePoint: any) => {
        if (routePoint?.lat && routePoint?.lon) {
          const address = routePoint.searchKey;
          coordinates.push({
            lat: routePoint.lat,
            lng: routePoint.lon,
            address: address && address.trim() !== '' ? address : 'Waypoint',
          });
        }
      });
    }

    return coordinates;
  }

  get routes() {
    return [
      {
        name: this.args.model?.title || 'Route',
        coordinates: this.routeCoordinates,
      },
    ];
  }

  get hasValidCoordinates() {
    return this.routeCoordinates.length > 0;
  }

  get routeTitle() {
    return this.args.model?.title || 'Untitled Route';
  }

  <template>
    <div class='embedded-template'>
      {{#if this.hasValidCoordinates}}
        <div class='route-preview'>
          <div class='route-header'>
            <MapIcon class='map-icon' />
            <span class='route-title'>{{this.routeTitle}}</span>
          </div>

          <MapRender @routes={{this.routes}} @mapConfig={{@model.mapConfig}} />
        </div>
      {{else}}
        <div class='route-placeholder'>
          <div class='placeholder-text'>
            <div class='placeholder-icon'>📍</div>
            <div class='placeholder-title'>Add Waypoints</div>
            <div class='placeholder-description'>
              Add waypoints with coordinates to see the route on the map
            </div>
          </div>
        </div>
      {{/if}}
    </div>

    <style scoped>
      .embedded-template {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-md);
      }

      .route-preview {
        overflow: hidden;
        background: var(--boxel-surface-secondary);
        border: 1px solid var(--boxel-border-color);
        border-radius: var(--boxel-border-radius);
      }

      .route-header {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-sm);
        background: var(--boxel-100);
        border-bottom: 1px solid var(--boxel-border-color);
      }

      .route-title {
        font-size: 16px;
        font-weight: 600;
        color: var(--boxel-text-color);
        margin: 0;
      }

      .map-icon {
        flex-shrink: 0;
        color: var(--boxel-blue);
        width: 20px;
        height: 20px;
      }

      .route-placeholder {
        height: 250px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--boxel-surface-secondary);
        border: 2px dashed var(--boxel-border-color);
        border-radius: var(--boxel-border-radius);
      }

      .placeholder-text {
        text-align: center;
        color: var(--boxel-text-muted);
      }

      .placeholder-icon {
        font-size: 32px;
        margin-bottom: 8px;
      }

      .placeholder-title {
        font-size: 16px;
        font-weight: 600;
        margin-bottom: 4px;
        color: var(--boxel-text-color);
      }

      .placeholder-description {
        font-size: 14px;
        line-height: 1.4;
      }
    </style>
  </template>
}

// @ts-ignore TODO fix type
export class CoordinateField extends GeoSearchPointField {
  static displayName = 'Coordinate';

  // resuse the edit template to prevent map embedding
  static embedded = GeoSearchPointEditTemplate;
}

export class Route extends CardDef {
  static displayName = 'Route';
  static prefersWideFormat = true;

  @field routeName = contains(StringField);
  @field coordinates = containsMany(CoordinateField);
  @field mapConfig = contains(LeafletMapConfigField);

  @field title = contains(StringField, {
    computeVia: function (this: Route) {
      if (this.routeName && this.routeName.trim() !== '') {
        return this.routeName;
      }
      let firstWaypoint = this.coordinates[0]?.searchKey;
      let lastWaypoint =
        this.coordinates[this.coordinates.length - 1]?.searchKey;

      if (firstWaypoint && lastWaypoint && firstWaypoint !== lastWaypoint) {
        return `${firstWaypoint} – ${lastWaypoint}`;
      } else if (firstWaypoint) {
        return firstWaypoint;
      } else {
        return 'Untitled Route';
      }
    },
  });

  static isolated = IsolatedTemplate;
  static embedded = EmbeddedTemplate;
  static atom = AtomTemplate;
}
