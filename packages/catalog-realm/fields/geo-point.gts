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
import MapPinIcon from '@cardstack/boxel-icons/map-pin';
import ColorField from 'https://cardstack.com/base/color';

import { FieldContainer, ColorPalette } from '@cardstack/boxel-ui/components';

class GeoPointConfigField extends FieldDef {
  @field markerColor = contains(ColorField);
}

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

  get latNumber() {
    return this.args.model?.lat ?? 0;
  }

  get lonNumber() {
    return this.args.model?.lon ?? 0;
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
        @lat={{this.latNumber}}
        @lon={{this.lonNumber}}
        @config={{@model.config}}
        @onMapClickUpdate={{this.updateCoordinates}}
      />
    </div>

    <style scoped>
      .coordinates-section {
        display: inline-flex;
        align-items: flex-start;
        gap: var(--boxel-sp-xxs);
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

class EditTemplate extends Component<typeof GeoPointField> {
  get configValue() {
    if (!this.args.model.config) {
      (this.args.model as any).config = {
        markerColor: '#22c55e',
      };
    }
    return this.args.model.config;
  }

  updateMarkerColor = (color: string) => {
    if (!this.args.model.config) {
      // Initialize config if it doesn't exist
      (this.args.model as any).config = {
        markerColor: '#22c55e',
      };
    }
    (this.args.model.config as any).markerColor = color;
  };

  <template>
    <FieldContainer @vertical={{true}} @label='Latitude' @tag='label'>
      <@fields.lat />
    </FieldContainer>
    <FieldContainer @vertical={{true}} @label='Longitude' @tag='label'>
      <@fields.lon />
    </FieldContainer>
    <FieldContainer @vertical={{true}} @label='Marker Color' @tag='label'>
      <ColorPalette
        @color={{this.configValue.markerColor}}
        @onChange={{this.updateMarkerColor}}
        class='color-palette-container'
      />
    </FieldContainer>

    <style scoped>
      label + label {
        margin-top: var(--boxel-sp-xs);
      }

      .color-palette-container {
        padding: 1rem;
        background: var(--boxel-100);
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
  @field config = contains(GeoPointConfigField);

  static atom = AtomTemplate;
  static embedded = EmbeddedTemplate;
  static edit = EditTemplate;
}
