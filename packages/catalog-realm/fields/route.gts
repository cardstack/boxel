import MapIcon from '@cardstack/boxel-icons/map';
import StringField from 'https://cardstack.com/base/string';
import {
  Component,
  contains,
  FieldDef,
  field,
} from 'https://cardstack.com/base/card-api';
import { MapRender, type Coordinate } from '../components/map-render';
import { GeoSearchPointField } from './geo-search-point';

// style: function (feature: any) {
//   return {
//     color: feature.properties.color,
//     weight: feature.properties.weight,
//     opacity: feature.properties.opacity,
//     smoothFactor: 1,
//   };
// },

class AtomTemplate extends Component<typeof RouteField> {
  get hasRoute() {
    return !!(
      this.args.model?.startPoint?.lat && this.args.model?.endPoint?.lat
    );
  }

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
  get routeCoordinates(): Coordinate[] {
    const points: Coordinate[] = [];

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
  get startPointSearchAddressValue() {
    return this.args.model?.startPoint?.searchKey ?? 'Invalid Address';
  }

  get startPointLatValue() {
    return this.args.model?.startPoint?.lat ?? 'N/A';
  }

  get startPointLonValue() {
    return this.args.model?.startPoint?.lon ?? 'N/A';
  }

  get startPointLatNumber() {
    return this.args.model?.startPoint?.lat;
  }

  get startPointLonNumber() {
    return this.args.model?.startPoint?.lon;
  }

  get endPointSearchAddressValue() {
    return this.args.model?.endPoint?.searchKey ?? 'Invalid Address';
  }

  get endPointLatValue() {
    return this.args.model?.endPoint?.lat ?? 'N/A';
  }

  get endPointLonValue() {
    return this.args.model?.endPoint?.lon ?? 'N/A';
  }

  get endPointLatNumber() {
    return this.args.model?.endPoint?.lat;
  }

  get endPointLonNumber() {
    return this.args.model?.endPoint?.lon;
  }

  get routeCoordinates(): Coordinate[] {
    const coordinates: Coordinate[] = [];

    if (
      this.startPointLatNumber != null &&
      this.startPointLonNumber != null &&
      typeof this.startPointLatNumber === 'number' &&
      typeof this.startPointLonNumber === 'number' &&
      !isNaN(this.startPointLatNumber) &&
      !isNaN(this.startPointLonNumber) &&
      this.startPointSearchAddressValue &&
      this.startPointSearchAddressValue.trim() !== '' &&
      this.startPointSearchAddressValue !== 'Invalid Address' &&
      this.startPointSearchAddressValue !== 'N/A'
    ) {
      const startCoord = {
        lat: this.startPointLatNumber,
        lng: this.startPointLonNumber,
        address: this.startPointSearchAddressValue,
      };
      coordinates.push(startCoord);
    }

    if (
      this.endPointLatNumber != null &&
      this.endPointLonNumber != null &&
      typeof this.endPointLatNumber === 'number' &&
      typeof this.endPointLonNumber === 'number' &&
      !isNaN(this.endPointLatNumber) &&
      !isNaN(this.endPointLonNumber) &&
      this.endPointSearchAddressValue &&
      this.endPointSearchAddressValue.trim() !== '' &&
      this.endPointSearchAddressValue !== 'Invalid Address' &&
      this.endPointSearchAddressValue !== 'N/A'
    ) {
      const endCoord = {
        lat: this.endPointLatNumber,
        lng: this.endPointLonNumber,
        address: this.endPointSearchAddressValue,
      };
      coordinates.push(endCoord);
    }

    return [...coordinates];
  }

  get routes() {
    return [
      {
        name: 'route to heaven',
        coordinates: this.routeCoordinates,
      },
    ];
  }

  get hasValidCoordinates() {
    const hasValid = this.routeCoordinates.length > 0;
    return hasValid;
  }

  <template>
    <div class='embedded-template'>
      {{#if this.hasValidCoordinates}}
        <div class='route-preview'>
          <div class='route-header'>
            <MapIcon class='map-icon' />
            <span class='route-title'>{{@model.title}}</span>
          </div>

          <div class='map-container'>
            <MapRender @routes={{this.routes}} />
          </div>
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

      .route-title {
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
        overflow: hidden;
        background: var(--boxel-surface-secondary);
        border: 1px solid var(--boxel-border-color);
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
