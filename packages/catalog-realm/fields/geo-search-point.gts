import {
  Component,
  contains,
  field,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import MapPinIcon from '@cardstack/boxel-icons/map-pin';
import GeoPointField from './geo-point';
import GeoSearchPointEditField from './geo-search-point/components/geo-search-point-edit-field';
import GeoPointMapPicker from './geo-point/components/geo-point-map-picker';

// --- Configuration Types ---

interface GeoSearchPointCommonOptions {
  placeholder?: string;
  tileserverUrl?: string;
  mapHeight?: string;
}

interface GeoSearchPointWithSearchResults extends GeoSearchPointCommonOptions {
  showTopSearchResults: true;
  topSearchResultsLimit?: number;
  showRecentSearches?: boolean;
  recentSearchesLimit?: number;
}

interface GeoSearchPointWithoutSearchResults extends GeoSearchPointCommonOptions {
  showTopSearchResults?: false;
}

export type GeoSearchPointOptions =
  | GeoSearchPointWithSearchResults
  | GeoSearchPointWithoutSearchResults;

export type GeoSearchPointConfiguration = {
  options?: GeoSearchPointOptions;
};

// --- Dispatcher Templates ---

export class GeoSearchPointEdit extends Component<typeof GeoSearchPointField> {
  <template>
    <GeoSearchPointEditField
      @model={{@model}}
      @canEdit={{@canEdit}}
      @configuration={{@configuration}}
    />
  </template>
}

export class GeoSearchPointEmbedded extends Component<
  typeof GeoSearchPointField
> {
  get displayName(): string {
    const { searchKey, lat, lon } = this.args.model;
    if (searchKey && searchKey.trim() !== '') return searchKey;
    if (lat != null && lon != null) return `${lat}, ${lon}`;
    return 'No location';
  }

  get config(): GeoSearchPointConfiguration {
    return (this.args.configuration as GeoSearchPointConfiguration) ?? {};
  }

  get mapOptions() {
    const opts = this.config.options;
    return {
      mapHeight: opts?.mapHeight,
      tileserverUrl: opts?.tileserverUrl,
    };
  }

  <template>
    <div class='geo-search-point-embedded'>
      <div class='info-row'>
        <MapPinIcon class='pin-icon' />
        <div class='content'>
          <span class='display-name'>{{this.displayName}}</span>
        </div>
      </div>

      <GeoPointMapPicker
        @model={{@model}}
        @options={{this.mapOptions}}
        @canEdit={{false}}
      />
    </div>

    <style scoped>
      .geo-search-point-embedded {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }

      .info-row {
        display: flex;
        align-items: start;
        gap: var(--boxel-sp-xxs);
      }

      .pin-icon {
        width: 14px;
        height: 14px;
        flex-shrink: 0;
        color: var(--boxel-red);
      }

      .content {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xxs);
      }

      .display-name {
        font-size: var(--boxel-font-size-sm);
        font-weight: 600;
        color: var(--boxel-dark);
      }
    </style>
  </template>
}

export class GeoSearchPointAtom extends Component<typeof GeoSearchPointField> {
  get displayValue(): string {
    const { searchKey, lat, lon } = this.args.model;
    if (searchKey && searchKey.trim() !== '') return searchKey;
    if (lat != null && lon != null) return `${lat}, ${lon}`;
    return 'No location';
  }

  <template>
    <span class='geo-search-point-atom'>
      <MapPinIcon class='pin-icon' />
      <span>{{this.displayValue}}</span>
    </span>

    <style scoped>
      .geo-search-point-atom {
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

// @ts-ignore
export default class GeoSearchPointField extends GeoPointField {
  static displayName = 'Geo Search Point';
  static icon = MapPinIcon;

  @field searchKey = contains(StringField);

  static edit = GeoSearchPointEdit;
  static atom = GeoSearchPointAtom;
  static embedded = GeoSearchPointEmbedded;
}
