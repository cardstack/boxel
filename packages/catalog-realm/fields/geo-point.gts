import {
  Component,
  contains,
  FieldDef,
  field,
} from 'https://cardstack.com/base/card-api';
import NumberField from 'https://cardstack.com/base/number';
import MapPinIcon from '@cardstack/boxel-icons/map-pin';

import GeoPointEditField from './geo-point/components/geo-point-edit-field';
import GeoPointMapPicker from './geo-point/components/geo-point-map-picker';

// --- Configuration Types ---

export interface GeoPointBaseOptions {
  showCurrentLocation?: boolean;
  quickLocations?: string[];
}

export interface GeoPointMapOptions {
  tileserverUrl?: string;
  mapHeight?: string;
}

export type GeoPointVariant = 'standard' | 'map-picker';

export type GeoPointConfiguration =
  | {
      variant?: 'standard';
      options?: GeoPointBaseOptions;
    }
  | {
      variant?: 'map-picker';
      options?: GeoPointBaseOptions & GeoPointMapOptions;
    };

// --- Dispatcher Templates ---

export class GeoPointEdit extends Component<typeof GeoPointField> {
  <template>
    <GeoPointEditField
      @model={{@model}}
      @canEdit={{@canEdit}}
      @configuration={{@configuration}}
    />
  </template>
}

export class GeoPointEmbedded extends Component<typeof GeoPointField> {
  get config(): GeoPointConfiguration {
    return (this.args.configuration as GeoPointConfiguration) ?? {};
  }

  get mapOptions() {
    const opts = this.config.options;
    if (!opts) return undefined;
    return {
      mapHeight: (opts as GeoPointMapOptions).mapHeight,
      tileserverUrl: (opts as GeoPointMapOptions).tileserverUrl,
    };
  }

  <template>
    <GeoPointMapPicker
      @model={{@model}}
      @options={{this.mapOptions}}
      @canEdit={{false}}
    />
  </template>
}

export class GeoPointAtom extends Component<typeof GeoPointField> {
  get displayValue(): string {
    const { lat, lon } = this.args.model;
    if (lat != null && lon != null) {
      return `${lat}, ${lon}`;
    }
    return 'No location';
  }

  <template>
    <span class='geo-point-atom'>
      <MapPinIcon class='pin-icon' />
      <span>{{this.displayValue}}</span>
    </span>

    <style scoped>
      .geo-point-atom {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-xxs);
      }

      .pin-icon {
        width: 14px;
        height: 14px;
        flex-shrink: 0;
        color: var(--boxel-red);
      }
    </style>
  </template>
}

// --- Field Definition ---

export default class GeoPointField extends FieldDef {
  static displayName = 'Geo Point';
  static icon = MapPinIcon;

  @field lat = contains(NumberField);
  @field lon = contains(NumberField);

  static atom = GeoPointAtom;
  static embedded = GeoPointEmbedded;
  static edit = GeoPointEdit;
}
