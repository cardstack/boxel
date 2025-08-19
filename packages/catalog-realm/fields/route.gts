import MapIcon from '@cardstack/boxel-icons/map';
import StringField from 'https://cardstack.com/base/string';
import {
  Component,
  contains,
  FieldDef,
  field,
} from 'https://cardstack.com/base/card-api';
import { gt } from '@cardstack/boxel-ui/helpers';
import { MapRender, type RoutePoint } from '../components/map-render';
import { GeoSearchPointField } from './geo-search-point';

class AtomTemplate extends Component<typeof RouteField> {
  get routeName() {
    return this.args.model?.title ?? 'Untitled Route';
  }

  get hasRoute() {
    return !!(
      this.args.model?.startPoint?.lat && this.args.model?.endPoint?.lat
    );
  }

  <template>
    <div class='route-display'>
      <MapIcon class='map-icon' />
      <div class='route-info'>
        <span class='route-name'>{{this.routeName}}</span>
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

      .route-name {
        font-weight: 500;
        line-height: normal;
      }

      .route-details {
        font-size: 12px;
        color: var(--boxel-text-muted);
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

class EditTemplate extends Component<typeof RouteField> {
  get routeCoordinates(): RoutePoint[] {
    const points: RoutePoint[] = [];

    if (this.args.model?.startPoint?.lat && this.args.model?.startPoint?.lon) {
      points.push({
        lat: this.args.model.startPoint.lat,
        lng: this.args.model.startPoint.lon,
        address: this.args.model.startPoint.searchKey ?? 'Start Point',
      });
    }

    if (this.args.model?.endPoint?.lat && this.args.model?.endPoint?.lon) {
      points.push({
        lat: this.args.model.endPoint.lat,
        lng: this.args.model.endPoint.lon,
        address: this.args.model.endPoint.searchKey ?? 'End Point',
      });
    }

    return points;
  }

  <template>
    <div class='edit-template'>
      <div class='points-section'>
        <div class='point-group'>
          <h4>Start Point</h4>
          <@fields.startPoint @format='edit' />
        </div>

        <div class='point-group'>
          <h4>End Point</h4>
          <@fields.endPoint @format='edit' />
        </div>
      </div>
    </div>

    <style scoped>
      .edit-template > * + * {
        margin-top: 1rem;
      }

      .route-header {
        display: flex;
        gap: 1rem;
        align-items: center;
      }

      .points-section {
        padding: 1rem;
        background: var(--boxel-surface-secondary);
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }

      .route-info {
        border: 1px solid var(--boxel-border-color);
        border-radius: var(--boxel-border-radius);
        padding: 1rem;
        background: var(--boxel-surface-secondary);
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .info-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0.5rem 0;
      }

      .info-label {
        font-weight: 500;
        color: var(--boxel-text-muted);
      }

      .info-value {
        font-weight: 600;
        color: var(--boxel-text-color);
      }

      .point-group {
        border: 1px solid var(--boxel-border-color);
        border-radius: var(--boxel-border-radius);
        padding: 1rem;
        background: var(--boxel-surface);
      }

      .point-group h4 {
        margin: 0 0 0.75rem 0;
        font-size: 14px;
        font-weight: 600;
        color: var(--boxel-text-muted);
      }
    </style>
  </template>
}

class EmbeddedTemplate extends Component<typeof RouteField> {
  get routeName() {
    return this.args.model?.title ?? 'Unnamed Route';
  }

  get routeCoordinates(): RoutePoint[] {
    const points: RoutePoint[] = [];

    if (this.args.model?.startPoint?.lat && this.args.model?.startPoint?.lon) {
      points.push({
        lat: this.args.model.startPoint.lat,
        lng: this.args.model.startPoint.lon,
        address: this.args.model.startPoint.searchKey ?? 'Start Point',
      });
    }

    if (this.args.model?.endPoint?.lat && this.args.model?.endPoint?.lon) {
      points.push({
        lat: this.args.model.endPoint.lat,
        lng: this.args.model.endPoint.lon,
        address: this.args.model.endPoint.searchKey ?? 'End Point',
      });
    }

    return points;
  }

  <template>
    <div class='embedded-template'>
      {{#if (gt this.routeCoordinates.length 1)}}
        <div class='route-preview'>
          <div class='route-header'>
            <MapIcon class='map-icon' />
            <span class='route-title'>{{@model.title}}</span>
          </div>

          <div class='map-container'>
            <MapRender
              @route={{this.routeCoordinates}}
              @disableMapClick={{true}}
            />
          </div>
        </div>
      {{else}}
        <div class='route-placeholder'>
          <div class='placeholder-text'>
            <div class='placeholder-icon'>📍</div>
            <div class='placeholder-title'>Add Waypoints</div>
            <div class='placeholder-description'>
              Add at least 2 waypoints with coordinates to see the route on the
              map
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

      .route-header {
        display: flex;
        align-items: flex-start;
        gap: var(--boxel-sp-xxs);
      }

      .route-info {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xxs);
        flex: 1;
      }

      .route-name {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
        line-height: normal;
      }

      .route-meta {
        display: flex;
        gap: var(--boxel-sp-sm);
        flex-wrap: wrap;
        font-size: 14px;
        color: var(--boxel-text-muted);
      }

      .transport-mode,
      .time,
      .distance {
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .map-icon {
        flex-shrink: 0;
        color: var(--boxel-blue);
        width: 20px;
        height: 20px;
      }

      .route-preview {
        border: 1px solid var(--boxel-border-color);
        border-radius: var(--boxel-border-radius);
        overflow: hidden;
        background: var(--boxel-surface-secondary);
      }

      .route-header {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-sm);
        background: var(--boxel-surface);
        border-bottom: 1px solid var(--boxel-border-color);
      }

      .route-title {
        font-size: 16px;
        font-weight: 600;
        color: var(--boxel-text-color);
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

export class RouteField extends FieldDef {
  static displayName = 'Route';

  @field startPoint = contains(GeoSearchPointField);
  @field endPoint = contains(GeoSearchPointField);

  // Computed title that generates route name from start and end points
  @field title = contains(StringField, {
    computeVia: function (this: RouteField) {
      try {
        const startName = this.startPoint?.searchKey?.trim();
        const endName = this.endPoint?.searchKey?.trim();

        if (startName && endName) {
          return `${startName} → ${endName}`;
        } else if (startName) {
          return `From ${startName}`;
        } else if (endName) {
          return `To ${endName}`;
        }

        return 'Untitled Route';
      } catch (e) {
        console.error('RouteField: Error computing title', e);
        return 'Untitled Route';
      }
    },
  });

  static isolated = EmbeddedTemplate;
  static embedded = EmbeddedTemplate;
  static edit = EditTemplate;
  static atom = AtomTemplate;
}
