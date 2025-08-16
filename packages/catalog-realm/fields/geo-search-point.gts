import { action } from '@ember/object';
import { task } from 'ember-concurrency';
import { debounce } from 'lodash';
import { BoxelInput } from '@cardstack/boxel-ui/components';
import MapIcon from '@cardstack/boxel-icons/map';
import StringField from 'https://cardstack.com/base/string';
import {
  Component,
  contains,
  field,
} from 'https://cardstack.com/base/card-api';
import { GeoPointField } from './geo-point';
import { MapRender, type Coordinate } from '../components/map-render';

class AtomTemplate extends Component<typeof GeoSearchPointField> {
  get searchAddressValue() {
    return this.args.model?.searchKey ?? 'Invalid Address';
  }

  get latValue() {
    return this.args.model?.lat ?? 'N/A';
  }

  get lonValue() {
    return this.args.model?.lon ?? 'N/A';
  }

  <template>
    <div class='coordinate-section'>
      <MapIcon class='map-icon' />
      <span
        class='coordinate-section-info-title'
      >{{this.searchAddressValue}}</span>
    </div>

    <style scoped>
      .coordinate-section {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-xxs);
        flex-shrink: 0;
      }

      .coordinate-section-info-title {
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

class EditTemplate extends Component<typeof GeoSearchPointField> {
  get searchAddressValue() {
    return this.args.model.searchKey;
  }

  get latValue() {
    return this.args.model?.lat ?? 'N/A';
  }

  get lonValue() {
    return this.args.model?.lon ?? 'N/A';
  }

  private fetchCoordinate = task(async (address: string | undefined) => {
    if (!address) {
      if (this.args.model) {
        this.args.model.lat = undefined;
        this.args.model.lon = undefined;
      }
      return;
    }

    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
          address,
        )}&limit=1`,
      );
      const data = await response.json();

      if (data && data.length > 0) {
        if (this.args.model) {
          this.args.model.lat = parseFloat(data[0].lat);
          this.args.model.lon = parseFloat(data[0].lon);
        }
      }
    } catch (error) {
      console.error('Error geocoding address:', error);
    }
  });

  @action
  geocodeAddress() {
    this.fetchCoordinate.perform(this.args.model.searchKey);
  }

  private debouncedGeocodeAddress = debounce(() => {
    this.geocodeAddress();
  }, 1000);

  @action
  updateSearchAddress(value: string) {
    this.args.model.searchKey = value;
    this.debouncedGeocodeAddress();
  }

  <template>
    <div class='edit-template'>
      <BoxelInput
        id='address-search-input'
        type='text'
        placeholder='Enter address to search...'
        @value={{this.searchAddressValue}}
        @onInput={{this.updateSearchAddress}}
      />

      <div class='coordinate'>
        {{#if this.fetchCoordinate.isRunning}}
          Loading...
        {{else}}
          📍 Lat:
          {{this.latValue}}, Lon:
          {{this.lonValue}}

        {{/if}}
      </div>
    </div>

    <style scoped>
      .edit-template > * + * {
        margin-top: 1rem;
      }

      .coordinate-container {
        margin-top: 0.2rem;
      }

      .coordinate {
        margin-top: 8px;
        padding: 4px 10px;
        background: #f0f9ff;
        border-left: 4px solid #0ea5e9;
        border-radius: 4px;
        font-size: 13px;
        font-family: 'Monaco', 'Menlo', monospace;
        color: #0c4a6e;
      }

      .color-palette-container {
        padding: 1rem;
        border-radius: var(--boxel-border-radius);
        border: var(--boxel-border-card);
      }
    </style>
  </template>
}

class EmbeddedTemplate extends Component<typeof GeoSearchPointField> {
  get searchAddressValue() {
    return this.args.model?.searchKey ?? 'Invalid Address';
  }

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

  get coordinate(): Coordinate {
    return {
      lat: this.latNumber,
      lng: this.lonNumber,
    };
  }

  <template>
    <div class='coordinate-section'>
      <MapIcon class='map-icon' />
      <div class='coordinate-section-info'>
        <h3
          class='coordinate-section-info-title'
        >{{this.searchAddressValue}}</h3>
        <span class='coordinate'>{{this.latValue}}, {{this.lonValue}}</span>
      </div>
    </div>
    <div class='map-section'>
      <MapRender @coordinate={{this.coordinate}} @disableMapClick={{true}} />
    </div>

    <style scoped>
      .coordinate-section {
        display: inline-flex;
        align-items: flex-start;
        gap: var(--boxel-sp-xxs);
        flex-shrink: 0;
      }

      .coordinate-section-info {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xxs);
      }

      .coordinate-section-info-title {
        line-height: normal;
        margin: 0;
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

// @ts-ignore
export class GeoSearchPointField extends GeoPointField {
  static displayName = 'Geo Search Point';

  @field searchKey = contains(StringField);

  static edit = EditTemplate;
  static atom = AtomTemplate;
  static embedded = EmbeddedTemplate;
}
