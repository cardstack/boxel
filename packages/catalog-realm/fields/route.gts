import { action } from '@ember/object';
import { BoxelInput, BoxelSelect } from '@cardstack/boxel-ui/components';
import MapIcon from '@cardstack/boxel-icons/map';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import {
  Component,
  contains,
  CardDef,
  field,
} from 'https://cardstack.com/base/card-api';
import { gt } from '@cardstack/boxel-ui/helpers';
import { MapRender, type RoutePoint } from '../components/map-render';
import { GeoSearchPointField } from './geo-search-point';

class AtomTemplate extends Component<typeof RouteField> {
  get routeName() {
    return this.args.model?.title ?? 'Unnamed Route';
  }

  get hasRoute() {
    return !!(
      this.args.model?.startPoint?.lat && this.args.model?.endPoint?.lat
    );
  }

  get transportMode() {
    return this.args.model?.transportMode ?? 'Unknown';
  }

  <template>
    <div class='route-display'>
      <MapIcon class='map-icon' />
      <div class='route-info'>
        <span class='route-name'>{{this.routeName}}</span>
        <span class='route-details'>{{#if this.hasRoute}}2 points{{else}}No
            route{{/if}}
          •
          {{this.transportMode}}</span>
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
  get routeName() {
    return this.args.model?.name ?? '';
  }

  get transportMode() {
    return this.args.model?.transportMode ?? 'car';
  }

  get estimatedTime() {
    return this.args.model?.estimatedTimeMin ?? 0;
  }

  get distance() {
    return this.args.model?.distanceKm ?? 0;
  }

  get notes() {
    return this.args.model?.notes ?? '';
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

  get transportModeOptions() {
    return [
      { value: 'car', label: '🚗 Car' },
      { value: 'walk', label: '🚶 Walk' },
      { value: 'bike', label: '🚲 Bike' },
      { value: 'transit', label: '🚌 Transit' },
      { value: 'flight', label: '✈️ Flight' },
      { value: 'train', label: '🚂 Train' },
      { value: 'boat', label: '🚢 Boat' },
    ];
  }

  get selectedTransportMode() {
    return (
      this.transportModeOptions.find(
        (option) => option.value === this.transportMode,
      ) ?? this.transportModeOptions[0]
    );
  }

  @action
  updateRouteName(value: string) {
    this.args.model.name = value;
  }

  @action
  updateTransportMode(transportMode: { value: string } | null) {
    this.args.model.transportMode = transportMode?.value ?? 'car';
  }

  @action
  updateEstimatedTime(value: number) {
    this.args.model.estimatedTimeMin = value;
  }

  @action
  updateDistance(value: number) {
    this.args.model.distanceKm = value;
  }

  @action
  updateNotes(value: string) {
    this.args.model.notes = value;
  }

  <template>
    <div class='edit-template'>
      <div class='route-header'>
        <BoxelInput
          type='text'
          placeholder='Route name...'
          @value={{this.routeName}}
          @onInput={{this.updateRouteName}}
        />

        <BoxelSelect
          @placeholder='Select transport mode'
          @options={{this.transportModeOptions}}
          @selected={{this.selectedTransportMode}}
          @onChange={{this.updateTransportMode}}
          @searchEnabled={{false}}
          class='transport-select'
          as |option|
        >
          <div>{{option.label}}</div>
        </BoxelSelect>
      </div>

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

      <div class='route-details'>
        <div class='detail-row'>
          <BoxelInput
            type='number'
            placeholder='Estimated time (minutes)'
            @value={{this.estimatedTime}}
            @onInput={{this.updateEstimatedTime}}
            class='detail-input'
          />
          <BoxelInput
            type='number'
            placeholder='Distance (km)'
            @value={{this.distance}}
            @onInput={{this.updateDistance}}
            class='detail-input'
          />
        </div>

        <BoxelInput
          type='text'
          placeholder='Route notes...'
          @value={{this.notes}}
          @onInput={{this.updateNotes}}
        />
      </div>

      {{#if (gt this.routeCoordinates.length 1)}}
        <div class='route-preview'>
          <h4>Route Preview: {{this.args.model.title}}</h4>
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
      .edit-template > * + * {
        margin-top: 1.5rem;
      }

      .route-header {
        display: flex;
        gap: 1rem;
        align-items: center;
      }

      .transport-select {
        min-width: 120px;
      }

      .points-section {
        border: 1px solid var(--boxel-border-color);
        border-radius: var(--boxel-border-radius);
        padding: 1rem;
        background: var(--boxel-surface-secondary);
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
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

      .route-details {
        border: 1px solid var(--boxel-border-color);
        border-radius: var(--boxel-border-radius);
        padding: 1rem;
        background: var(--boxel-surface-secondary);
      }

      .detail-row {
        display: flex;
        gap: 1rem;
        margin-bottom: 1rem;
      }

      .detail-input {
        flex: 1;
      }

      .route-preview {
        border: 1px solid var(--boxel-border-color);
        border-radius: var(--boxel-border-radius);
        padding: 1rem;
        background: var(--boxel-surface-secondary);
      }

      .route-preview h4 {
        margin: 0 0 1rem 0;
        font-size: 16px;
        font-weight: 600;
      }

      .map-container {
        height: 300px;
        border-radius: var(--boxel-border-radius);
        overflow: hidden;
      }

      .route-placeholder {
        height: 200px;
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

class EmbeddedTemplate extends Component<typeof RouteField> {
  get routeName() {
    return this.args.model?.title ?? 'Unnamed Route';
  }

  get transportMode() {
    return this.args.model?.transportMode ?? 'car';
  }

  get estimatedTime() {
    return this.args.model?.estimatedTimeMin ?? 0;
  }

  get distance() {
    return this.args.model?.distanceKm ?? 0;
  }

  get notes() {
    return this.args.model?.notes ?? '';
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

  get transportModeIcon() {
    const icons = {
      car: '🚗',
      walk: '🚶',
      bike: '🚲',
      transit: '🚌',
      flight: '✈️',
      train: '🚂',
      boat: '🚢',
    };
    return icons[this.transportMode as keyof typeof icons] || '🚗';
  }

  <template>
    <div class='embedded-template'>
      <div class='route-header'>
        <MapIcon class='map-icon' />
        <div class='route-info'>
          <h3 class='route-name'>{{this.routeName}}</h3>
          <div class='route-meta'>
            <span class='transport-mode'>{{this.transportModeIcon}}
              {{this.transportMode}}</span>
            {{#if this.estimatedTime}}
              <span class='time'>⏱️ {{this.estimatedTime}} min</span>
            {{/if}}
            {{#if this.distance}}
              <span class='distance'>📏 {{this.distance}} km</span>
            {{/if}}
          </div>
        </div>
      </div>

      {{#if this.notes}}
        <div class='route-notes'>
          {{this.notes}}
        </div>
      {{/if}}

      {{#if (gt this.routeCoordinates.length 1)}}
        <div class='route-map'>
          <MapRender @route={{this.routeCoordinates}} />
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
        color: var(--map-icon-color, var(--boxel-red));
        width: var(--map-icon-width, 16px);
        height: var(--map-icon-width, 16px);
      }

      .route-notes {
        padding: 0.75rem;
        background: var(--boxel-surface-secondary);
        border-radius: var(--boxel-border-radius);
        font-size: 14px;
        color: var(--boxel-text-muted);
        border-left: 3px solid var(--boxel-blue);
      }

      .route-map {
        height: 300px;
        border: 1px solid var(--boxel-border-color);
        border-radius: var(--boxel-border-radius);
        overflow: hidden;
      }

      .route-placeholder {
        height: 200px;
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

export class RouteField extends CardDef {
  static displayName = 'Route';

  @field name = contains(StringField);
  @field transportMode = contains(StringField);
  @field startPoint = contains(GeoSearchPointField);
  @field endPoint = contains(GeoSearchPointField);
  @field estimatedTimeMin = contains(NumberField);
  @field distanceKm = contains(NumberField);
  @field notes = contains(StringField);

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
        } else if (this.name?.trim()) {
          return this.name.trim();
        }

        return 'Untitled Route';
      } catch (e) {
        console.error('RouteField: Error computing title', e);
        return 'Untitled Route';
      }
    },
  });

  static edit = EditTemplate;
  static atom = AtomTemplate;
  static embedded = EmbeddedTemplate;
}
