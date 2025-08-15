import {
  Component,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { FieldContainer, ColorPalette } from '@cardstack/boxel-ui/components';
import { GeoPointField, GeoPointConfigField } from './geo-point';
import StringField from 'https://cardstack.com/base/string';
import MapIcon from '@cardstack/boxel-icons/map';
import { MapRender } from '../components/map-render';

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
    <div class='coordinates-section'>
      <MapIcon class='map-icon' />
      <span
        class='coordinates-section-info-title'
      >{{this.searchAddressValue}}</span>
    </div>

    <style scoped>
      .coordinates-section {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-xxs);
        flex-shrink: 0;
      }

      .coordinates-section-info-title {
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
  addressTimeout: ReturnType<typeof setTimeout> | undefined;

  get searchAddressValue() {
    return this.args.model.searchKey;
  }

  get latValue() {
    return this.args.model?.lat ?? 'N/A';
  }

  get lonValue() {
    return this.args.model?.lon ?? 'N/A';
  }

  get configValue() {
    if (!this.args.model?.config) {
      return { markerColor: '#22c55e' };
    }
    return this.args.model.config;
  }

  private async geocodeAddressInternal(
    address: string,
    latField: 'lat',
    lonField: 'lon',
  ) {
    if (!address) {
      if (this.args.model) {
        this.args.model[latField] = undefined;
        this.args.model[lonField] = undefined;
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
          this.args.model[latField] = parseFloat(data[0].lat);
          this.args.model[lonField] = parseFloat(data[0].lon);
        }
      }
    } catch (error) {
      console.error('Error geocoding address:', error);
    }
  }

  @action
  async geocodeAddress() {
    await this.geocodeAddressInternal(
      this.args.model.searchKey || '',
      'lat',
      'lon',
    );
  }

  @action
  updateSearchAddress(event: Event) {
    const target = event.target as HTMLInputElement;
    this.args.model.searchKey = target.value;

    // Debounce geocoding - only geocode if user stops typing for 500ms
    if (this.addressTimeout) {
      clearTimeout(this.addressTimeout);
    }
    this.addressTimeout = setTimeout(() => {
      this.geocodeAddress();
    }, 500);
  }

  updateMarkerColor = (color: string) => {
    if (!this.args.model?.config) {
      this.args.model.config = new GeoPointConfigField();
      this.args.model.config.markerColor = color;
    } else {
      this.args.model.config.markerColor = color;
    }
  };

  <template>
    <div class='edit-template'>
      <FieldContainer
        @vertical={{true}}
        @label='Address'
        @tag='label'
        @for='address-search-input'
      >
        <input
          id='address-search-input'
          type='text'
          placeholder='Enter address to search...'
          value={{this.searchAddressValue}}
          {{on 'input' this.updateSearchAddress}}
        />

        <div class='coordinates'>
          📍 Lat:
          {{this.latValue}}, Lon:
          {{this.lonValue}}
        </div>
      </FieldContainer>

      <FieldContainer
        @vertical={{true}}
        @label='Origin Marker Colors'
        @tag='label'
      >
        <ColorPalette
          @color={{this.configValue.markerColor}}
          @onChange={{this.updateMarkerColor}}
          class='color-palette-container'
        />
      </FieldContainer>
    </div>

    <style scoped>
      .edit-template > * + * {
        margin-top: 1rem;
      }

      input {
        width: 100%;
        padding: 12px 16px;
        border: 2px solid #e5e7eb;
        border-radius: 8px;
        font-size: 14px;
        transition: all 0.2s ease;
        box-sizing: border-box;
      }

      input:focus {
        outline: none;
        border-color: #3b82f6;
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
      }

      input::placeholder {
        color: #9ca3af;
        font-style: italic;
      }

      .coordinates-container {
        margin-top: 0.2rem;
      }

      .coordinates {
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
        background: var(-boxel-100);
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

  <template>
    <div class='coordinates-section'>
      <MapIcon class='map-icon' />
      <div class='coordinates-section-info'>
        <h3
          class='coordinates-section-info-title'
        >{{this.searchAddressValue}}</h3>
        <span class='coordinates'>{{this.latValue}}, {{this.lonValue}}</span>
      </div>
    </div>
    <div class='map-section'>
      <MapRender
        @lat={{this.latNumber}}
        @lon={{this.lonNumber}}
        @config={{@model.config}}
        @disableMapClick={{true}}
      />
    </div>

    <style scoped>
      .coordinates-section {
        display: inline-flex;
        align-items: flex-start;
        gap: var(--boxel-sp-xxs);
        flex-shrink: 0;
      }

      .coordinates-section-info {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xxs);
      }

      .coordinates-section-info-title {
        line-height: normal;
        margin: 0;
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

// @ts-ignore
export class GeoSearchPointField extends GeoPointField {
  static displayName = 'Geo Search Point';

  @field searchKey = contains(StringField);

  static edit = EditTemplate;
  static atom = AtomTemplate;
  static embedded = EmbeddedTemplate;
}
