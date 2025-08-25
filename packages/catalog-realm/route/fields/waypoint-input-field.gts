import { Component } from 'https://cardstack.com/base/card-api';
import { GeoSearchPointField } from '../../fields/geo-search-point';
import { action } from '@ember/object';
import { task } from 'ember-concurrency';
import { debounce } from 'lodash';
import { BoxelInput } from '@cardstack/boxel-ui/components';

class EditTemplate extends Component<typeof WaypointInputField> {
  get searchAddressValue() {
    return this.args.model.searchKey;
  }

  get coordinateDisplay() {
    const lat = this.args.model?.lat;
    const lon = this.args.model?.lon;

    if (lat != null && lon != null) {
      return `📍 Lat: ${lat}, Lon: ${lon}`;
    }
    return 'No coordinates available';
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
        {{else}}
          <div class='coordinate-display'>
            {{this.coordinateDisplay}}
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

      .color-palette-container {
        padding: 1rem;
        border-radius: var(--boxel-border-radius);
        border: var(--boxel-border-card);
      }
    </style>
  </template>
}

// @ts-ignore
export class WaypointInputField extends GeoSearchPointField {
  static displayName = 'Waypoints';

  static embedded = EditTemplate;
}
