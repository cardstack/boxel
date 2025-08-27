import MapIcon from '@cardstack/boxel-icons/map';
import StringField from 'https://cardstack.com/base/string';
import {
  Component,
  contains,
  CardDef,
  field,
  linksToMany,
} from 'https://cardstack.com/base/card-api';
import { MapRender, type Coordinate } from '../components/map-render';
import { Route } from '../route/route';
import { LeafletMapConfigField } from '../fields/leaflet-map-config-field';

class AtomTemplate extends Component<typeof TravelMapper> {
  <template>
    <div class='routes-display'>
      <MapIcon class='map-icon' />
      <div class='routes-info'>
        <span class='routes-title'>{{@model.title}}</span>
        <span class='routes-count'>{{@model.routes.length}} routes</span>
      </div>
    </div>

    <style scoped>
      .routes-display {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-xxs);
        flex-shrink: 0;
      }

      .routes-info {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .routes-title {
        font-weight: 500;
        line-height: normal;
      }

      .routes-count {
        font-size: 12px;
        color: var(--boxel-text-muted);
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

class IsolatedTemplate extends Component<typeof TravelMapper> {
  get allRouteCoordinates(): Coordinate[] {
    const allCoordinates: Coordinate[] = [];

    if (this.args.model?.routes) {
      this.args.model.routes.forEach((route: any) => {
        if (route?.coordinates) {
          route.coordinates.forEach((c: any) => {
            if (c?.lat && c?.lon) {
              const address = c.searchKey;
              allCoordinates.push({
                lat: c.lat,
                lng: c.lon,
                address:
                  address && address.trim() !== '' ? address : 'Waypoint',
              });
            }
          });
        }
      });
    }

    return allCoordinates;
  }

  get routesForMap() {
    const routes: any[] = [];

    if (this.args.model?.routes) {
      this.args.model.routes.forEach((route: any) => {
        if (route?.coordinates && route.coordinates.length > 0) {
          const coordinates: Coordinate[] = [];
          route.coordinates.forEach((c: any) => {
            if (c?.lat && c?.lon) {
              const address = c.searchKey;
              coordinates.push({
                lat: c.lat,
                lng: c.lon,
                address:
                  address && address.trim() !== '' ? address : 'Waypoint',
              });
            }
          });

          if (coordinates.length > 0) {
            routes.push({
              name: route.title || 'Untitled Route',
              coordinates: coordinates,
            });
          }
        }
      });
    }

    return routes;
  }

  get hasValidRoutes() {
    return this.args.model?.routes && this.args.model.routes.length > 0;
  }

  <template>
    <div class='isolated-template'>
      <div class='template-content'>
        <div class='fields-panel'>
          <div class='fields-header'>
            <h3>Routes Collection</h3>
            <p class='fields-description'>
              Manage your collection of routes. Each route contains waypoints
              that form a complete journey.
            </p>
          </div>
          <div class='fields-container'>
            <@fields.routes @format='edit' />
            <@fields.mapConfig @format='edit' />
          </div>
        </div>

        <div class='map-panel'>
          {{#if this.hasValidRoutes}}
            <MapRender
              @routes={{this.routesForMap}}
              @mapConfig={{@model.mapConfig}}
            />
          {{else}}
            <div class='map-placeholder'>
              <div class='placeholder-content'>
                <div class='placeholder-icon'>🗺️</div>
                <div class='placeholder-title'>Create Your Routes Collection</div>
                <div class='placeholder-description'>
                  Add routes to this collection to visualize them on the map
                </div>
                <div class='placeholder-hint'>
                  <span class='hint-icon'>💡</span>
                  <span>Start by adding your first route</span>
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

      .routes-section {
        margin-bottom: var(--boxel-sp-xl);
      }

      .routes-section h4 {
        margin: 0 0 var(--boxel-sp-xs) 0;
        font-size: 16px;
        font-weight: 600;
        color: var(--boxel-text-color);
      }

      .section-description {
        margin: 0 0 var(--boxel-sp-md) 0;
        font-size: 14px;
        color: var(--boxel-text-muted);
        line-height: 1.4;
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

class EmbeddedTemplate extends Component<typeof TravelMapper> {
  get allRouteCoordinates(): Coordinate[] {
    const allCoordinates: Coordinate[] = [];

    // Collect coordinates from all linked routes
    if (this.args.model?.routes) {
      this.args.model.routes.forEach((route: any) => {
        if (route?.coordinates) {
          route.coordinates.forEach((c: any) => {
            if (c?.lat && c?.lon) {
              const address = c.searchKey;
              allCoordinates.push({
                lat: c.lat,
                lng: c.lon,
                address:
                  address && address.trim() !== '' ? address : 'Waypoint',
              });
            }
          });
        }
      });
    }

    return allCoordinates;
  }

  get routesForMap() {
    const routes: any[] = [];

    if (this.args.model?.routes) {
      this.args.model.routes.forEach((route: any) => {
        if (route?.coordinates && route.coordinates.length > 0) {
          const coordinates: Coordinate[] = [];
          route.coordinates.forEach((c: any) => {
            if (c?.lat && c?.lon) {
              const address = c.searchKey;
              coordinates.push({
                lat: c.lat,
                lng: c.lon,
                address:
                  address && address.trim() !== '' ? address : 'Waypoint',
              });
            }
          });

          if (coordinates.length > 0) {
            routes.push({
              name: route.title || 'Untitled Route',
              coordinates: coordinates,
            });
          }
        }
      });
    }

    return routes;
  }

  get routesTitle() {
    return this.args.model?.title || 'Routes Collection';
  }

  get routesCount() {
    return this.args.model?.routes?.length || 0;
  }

  get hasValidRoutes() {
    return this.routesForMap.length > 0;
  }

  <template>
    <div class='embedded-template'>
      {{#if this.hasValidRoutes}}
        <div class='routes-preview'>
          <div class='routes-header'>
            <MapIcon class='map-icon' />
            <div class='routes-info'>
              <span class='routes-title'>{{this.routesTitle}}</span>
              <span class='routes-count'>{{this.routesCount}} routes</span>
            </div>
          </div>

          <MapRender
            @routes={{this.routesForMap}}
            @mapConfig={{@model.mapConfig}}
          />
        </div>
      {{else}}
        <div class='routes-placeholder'>
          <div class='placeholder-text'>
            <div class='placeholder-icon'>🗺️</div>
            <div class='placeholder-title'>Add Routes</div>
            <div class='placeholder-description'>
              Add routes to this collection to see them on the map
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

      .routes-preview {
        overflow: hidden;
        background: var(--boxel-surface-secondary);
        border: 1px solid var(--boxel-border-color);
        border-radius: var(--boxel-border-radius);
      }

      .routes-header {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-sm);
        background: var(--boxel-100);
        border-bottom: 1px solid var(--boxel-border-color);
      }

      .routes-info {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .routes-title {
        font-size: 16px;
        font-weight: 600;
        color: var(--boxel-text-color);
        margin: 0;
      }

      .routes-count {
        font-size: 12px;
        color: var(--boxel-text-muted);
      }

      .map-icon {
        flex-shrink: 0;
        color: var(--boxel-blue);
        width: 20px;
        height: 20px;
      }

      .routes-placeholder {
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

export class TravelMapper extends CardDef {
  static displayName = 'Travel Mapper';
  static prefersWideFormat = true;

  @field routes = linksToMany(Route);
  @field mapConfig = contains(LeafletMapConfigField);

  @field title = contains(StringField, {
    computeVia: function (this: TravelMapper) {
      const routes = this.routes || [];
      if (routes.length === 0) {
        return 'Empty Routes Collection';
      }
      // For each route, get its title (which is usually "waypoint – waypoint")
      let titles = routes.map((route: any, idx: number) => {
        let routeTitle = route?.title;
        if (!routeTitle) {
          // Try to construct from waypoints if possible
          let firstWaypoint = route?.coordinates?.[0]?.searchKey;
          let lastWaypoint =
            route?.coordinates?.[route?.coordinates?.length - 1]?.searchKey;

          if (firstWaypoint && lastWaypoint && firstWaypoint !== lastWaypoint) {
            routeTitle = `${firstWaypoint} – ${lastWaypoint}`;
          } else if (firstWaypoint) {
            routeTitle = firstWaypoint;
          } else {
            routeTitle = `Route ${String.fromCharCode(65 + idx)}`; // Route A, B, etc.
          }
        }
        return `Route ${String.fromCharCode(65 + idx)}: ${routeTitle}`;
      });
      return titles.join(' | ');
    },
  });

  static isolated = IsolatedTemplate;
  static embedded = EmbeddedTemplate;
  static atom = AtomTemplate;
}
