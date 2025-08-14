import {
  Component,
  field,
  contains,
  FieldDef,
} from 'https://cardstack.com/base/card-api';
import NumberField from 'https://cardstack.com/base/number';
import MapIcon from '@cardstack/boxel-icons/map';
import { MapRender } from '../components/map-render';
import { action } from '@ember/object';

import { FieldContainer } from '@cardstack/boxel-ui/components';

class AtomTemplate extends Component<typeof GeoPointField> {
  get latValue() {
    return this.args.model?.lat ?? 'N/A';
  }

  get lonValue() {
    return this.args.model?.lon ?? 'N/A';
  }

  <template>
    <div class='geo-point-display'>
      <MapIcon class='map-icon' />
      <span class='coordinates'>{{this.latValue}}, {{this.lonValue}}</span>
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
  get latValue() {
    return this.args.model?.lat ?? 'N/A';
  }

  get lonValue() {
    return this.args.model?.lon ?? 'N/A';
  }

  @action
  updateCoordinates(lat: number, lon: number) {
    this.args.model.lat = lat;
    this.args.model.lon = lon;
  }

  <template>
    <div class='coordinates-section'>
      <MapIcon class='map-icon' />
      <span class='coordinates'>{{this.latValue}}, {{this.lonValue}}</span>
    </div>
    <div class='map-section'>
      <MapRender
        @lat={{@model.lat}}
        @lon={{@model.lon}}
        @onMapClickUpdate={{this.updateCoordinates}}
      />
    </div>

    <style scoped>
      .coordinates-section {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        flex-shrink: 0;
      }

      .map-icon {
        flex-shrink: 0;
        color: var(--map-icon-color, var(--boxel-red));
        width: var(--map-icon-width, 16px);
        height: var(--map-icon-height, 16px);
      }

      .coordinates {
        font-weight: 500;
        color: var(--boxel-text-color);
      }

      .map-section {
        flex: 1;
        width: 100%;
        height: 100%;
        margin-top: var(--boxel-sp-sm);
        border: 1px solid var(--boxel-border-color);
        border-radius: var(--boxel-border-radius);
        background: var(--boxel-surface-secondary);
        overflow: hidden;
        position: relative;
      }
    </style>
  </template>
}

export class GeoPointField extends FieldDef {
  static displayName = 'Geo Point';

  @field lat = contains(NumberField);
  @field lon = contains(NumberField);

  static edit = class Edit extends Component<typeof this> {
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
      </style>
    </template>
  };

  static atom = AtomTemplate;
  static embedded = EmbeddedTemplate;
}
