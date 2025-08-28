import {
  Component,
  contains,
  FieldDef,
  field,
} from 'https://cardstack.com/base/card-api';
import NumberField from 'https://cardstack.com/base/number';
import { action } from '@ember/object';
import MapIcon from '@cardstack/boxel-icons/map';
import MapPinIcon from '@cardstack/boxel-icons/map-pin';
import { FieldContainer } from '@cardstack/boxel-ui/components';
import { MapRender } from '../components/map-render';

class AtomTemplate extends Component<typeof GeoPointField> {
  get displayValue() {
    const lat = this.args.model?.lat;
    const lon = this.args.model?.lon;

    if (lat != null && lon != null) {
      return `${lat}, ${lon}`;
    }
    return 'No coordinates';
  }

  <template>
    <div class='geo-point-display'>
      <MapIcon class='map-icon' />
      <span class='coordinate'>{{this.displayValue}}</span>
    </div>

    <style scoped>
      .geo-point-display {
        display: inline-flex;
        align-items: center;
        gap: var(--geo-point-gap, var(--boxel-sp-xxs));
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

class EmbeddedTemplate extends Component<typeof GeoPointField> {
  get displayValue() {
    const lat = this.args.model?.lat;
    const lon = this.args.model?.lon;

    if (lat != null && lon != null) {
      return `${lat}, ${lon}`;
    }
    return 'No coordinates';
  }

  get coordinates() {
    const lat = this.args.model?.lat;
    const lon = this.args.model?.lon;

    if (lat != null && lon != null) {
      return [{ lat, lng: lon }];
    }
    return [];
  }

  get hasValidCoordinates() {
    return this.args.model?.lat != null && this.args.model?.lon != null;
  }

  @action
  updateCoordinate(coordinate: { lat: number; lng: number }) {
    if (this.args.model) {
      this.args.model.lat = coordinate.lat;
      this.args.model.lon = coordinate.lng;
    }
  }

  <template>
    <div class='embedded-template'>
      {{#if this.hasValidCoordinates}}
        <div class='geo-preview'>
          <div class='geo-header'>
            <MapIcon class='map-icon' />
            <div class='geo-info'>
              <h3 class='geo-title'>Location</h3>
              <span class='coordinate'>{{this.displayValue}}</span>
            </div>
          </div>

          <div class='map-container'>
            <MapRender
              @coordinates={{this.coordinates}}
              @onMapClick={{this.updateCoordinate}}
            />
          </div>
        </div>
      {{else}}
        <div class='geo-placeholder'>
          <div class='placeholder-text'>
            <div class='placeholder-icon'>📍</div>
            <div class='placeholder-title'>Add Coordinates</div>
            <div class='placeholder-description'>
              Enter latitude and longitude values to see the location on the map
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

      .geo-preview {
        overflow: hidden;
        background: var(--boxel-surface-secondary);
        border: 1px solid var(--boxel-border-color);
      }

      .geo-header {
        display: flex;
        align-items: flex-start;
        gap: var(--boxel-sp-xxs);
        padding: var(--boxel-sp-sm);
        background: var(--boxel-surface);
        border-bottom: 1px solid var(--boxel-border-color);
      }

      .geo-info {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xxs);
        flex: 1;
      }

      .geo-title {
        margin: 0;
        font-size: 16px;
        font-weight: 600;
        line-height: normal;
        color: var(--boxel-text-color);
      }

      .map-icon {
        flex-shrink: 0;
        color: var(--map-icon-color, var(--boxel-red));
        width: var(--map-icon-width, 16px);
        height: var(--map-icon-height, 16px);
      }

      .coordinate {
        font-weight: 500;
        color: var(--boxel-text-color);
        font-size: 14px;
      }

      .map-container {
        flex: 1;
        width: 100%;
        height: 100%;
        border: 1px solid var(--boxel-border-color);
        border-radius: var(--boxel-border-radius);
        background: var(--boxel-surface-secondary);
        overflow: hidden;
        position: relative;
      }

      .geo-placeholder {
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

class EditTemplate extends Component<typeof GeoPointField> {
  <template>
    <FieldContainer @vertical={{true}} @label='Latitude' @tag='label'>
      <@fields.lat />
    </FieldContainer>
    <FieldContainer @vertical={{true}} @label='Longitude' @tag='label'>
      <@fields.lon />
    </FieldContainer>

    <style scoped>
      label + label {
        margin-top: var(--boxel-sp-xs);
      }

      .color-palette-container {
        padding: 1rem;
        border-radius: var(--boxel-border-radius);
        border: var(--boxel-border-card);
      }
    </style>
  </template>
}

export class GeoPointField extends FieldDef {
  static displayName = 'Geo Point';
  static icon = MapPinIcon;

  @field lat = contains(NumberField);
  @field lon = contains(NumberField);

  static atom = AtomTemplate;
  static embedded = EmbeddedTemplate;
  static edit = EditTemplate;
}
