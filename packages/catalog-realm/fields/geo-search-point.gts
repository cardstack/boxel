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
    if (!address || address.trim() === '') {
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
        )}&limit=10`,
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (data && data.length > 0) {
        if (this.args.model) {
          const lat = parseFloat(data[0].lat);
          const lon = parseFloat(data[0].lon);

          // Validate the parsed coordinates
          if (
            !isNaN(lat) &&
            !isNaN(lon) &&
            lat >= -90 &&
            lat <= 90 &&
            lon >= -180 &&
            lon <= 180
          ) {
            this.args.model.lat = lat;
            this.args.model.lon = lon;
            console.log('✅ Coordinates updated successfully:', { lat, lon });
          } else {
            console.log('❌ Invalid coordinates returned from geocoding API:', {
              lat,
              lon,
            });
            // Reset coordinates if invalid
            this.args.model.lat = undefined;
            this.args.model.lon = undefined;
          }
        }
      } else {
        console.log('❌ No geocoding results found for address:', address);
        // Reset coordinates when no results found
        if (this.args.model) {
          this.args.model.lat = undefined;
          this.args.model.lon = undefined;
        }
      }
    } catch (error) {
      console.error('Error geocoding address:', error);
      // Reset coordinates on any error
      if (this.args.model) {
        this.args.model.lat = undefined;
        this.args.model.lon = undefined;
      }
    }
  });

  private debouncedGeocodeAddress = debounce(() => {
    this.fetchCoordinate.perform(this.args.model.searchKey);
  }, 1000);

  @action
  updateSearchAddress(value: string) {
    this.args.model.searchKey = value;

    // If address is cleared, immediately reset coordinates
    if (!value || value.trim() === '') {
      if (this.args.model) {
        this.args.model.lat = undefined;
        this.args.model.lon = undefined;
      }
      return;
    }

    this.debouncedGeocodeAddress();
  }

  get hasNoCoordinates() {
    return !this.args.model?.lon && !this.args.model?.lat;
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
          <div class='loading-state'>
            🔍 Searching for coordinates...
          </div>
        {{else if this.hasNoCoordinates}}
          <div class='no-coordinates'>
            No coordinates available
          </div>
        {{else}}
          <div class='coordinate-display'>
            📍 Lat:
            {{this.latValue}}, Lon:
            {{this.lonValue}}
          </div>
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
        padding: 8px 12px;
        border-radius: 4px;
        font-size: 13px;
        font-family: 'Monaco', 'Menlo', monospace;
      }

      .loading-state {
        background: #fef3c7;
        border-left: 4px solid #f59e0b;
        color: #92400e;
        padding: 4px 10px;
      }

      .coordinate-display {
        background: #f0f9ff;
        border-left: 4px solid #0ea5e9;
        color: #0c4a6e;
        padding: 4px 10px;
      }

      .partial-coordinates {
        background: #fef3c7;
        border-left: 4px solid #f59e0b;
        color: #92400e;
        padding: 4px 10px;
      }

      .no-coordinates {
        background: #fef2f2;
        border-left: 4px solid #ef4444;
        color: #991b1b;
        padding: 4px 10px;
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
    return this.args.model?.lat;
  }

  get lonNumber() {
    return this.args.model?.lon;
  }

  get hasValidCoordinateValues() {
    return this.latValue !== 'N/A' || this.lonValue !== 'N/A';
  }

  get hasNoCoordinates() {
    return this.latValue === 'N/A' && this.lonValue === 'N/A';
  }

  get coordinates(): Coordinate[] {
    // Only return coordinates if both lat and lon are valid numbers AND address is meaningful
    if (
      this.latNumber != null &&
      this.lonNumber != null &&
      typeof this.latNumber === 'number' &&
      typeof this.lonNumber === 'number' &&
      !isNaN(this.latNumber) &&
      !isNaN(this.lonNumber) &&
      this.searchAddressValue &&
      this.searchAddressValue.trim() !== '' &&
      this.searchAddressValue !== 'Invalid Address' &&
      this.searchAddressValue !== 'N/A'
    ) {
      const coords = [
        {
          lat: this.latNumber,
          lng: this.lonNumber,
          address: this.searchAddressValue,
        },
      ];
      return coords;
    }

    return [];
  }

  get hasValidCoordinates() {
    return (
      this.args.model?.lat != null &&
      this.args.model?.lon != null &&
      typeof this.args.model.lat === 'number' &&
      typeof this.args.model.lon === 'number' &&
      !isNaN(this.args.model.lat) &&
      !isNaN(this.args.model.lon) &&
      this.searchAddressValue &&
      this.searchAddressValue.trim() !== '' &&
      this.searchAddressValue !== 'Invalid Address' &&
      this.searchAddressValue !== 'N/A'
    );
  }

  <template>
    <div class='embedded-template'>
      {{#if this.hasValidCoordinates}}
        <div class='geo-preview'>
          <div class='geo-header'>
            <MapIcon class='map-icon' />
            <div class='geo-info'>
              <h3 class='geo-title'>{{this.searchAddressValue}}</h3>
              <span class='coordinate'>{{this.latValue}},
                {{this.lonValue}}</span>
            </div>
          </div>

          <div class='map-container'>
            <MapRender @coordinates={{this.coordinates}} />
          </div>
        </div>
      {{else}}
        <div class='geo-placeholder'>
          <div class='placeholder-text'>
            <div class='placeholder-icon'>📍</div>
            <div class='placeholder-title'>Add Location</div>
            <div class='placeholder-description'>
              Enter an address to see the location on the map
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

// @ts-ignore
export class GeoSearchPointField extends GeoPointField {
  static displayName = 'Geo Search Point';

  @field searchKey = contains(StringField);

  static edit = EditTemplate;
  static atom = AtomTemplate;
  static embedded = EmbeddedTemplate;
}
