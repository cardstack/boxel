import GlimmerComponent from '@glimmer/component';
import { action } from '@ember/object';
import { htmlSafe } from '@ember/template';
import MapPinIcon from '@cardstack/boxel-icons/map-pin';
import { MapRender, type Coordinate } from '../../../components/map-render';
import { hasValidCoordinates, formatCoordinates } from '../util/index';
import type { GeoModel } from '../util/index';
import type { GeoPointMapOptions } from '../../geo-point';

interface MapPickerSignature {
  Args: {
    model: GeoModel;
    options?: GeoPointMapOptions;
    canEdit?: boolean;
  };
}

export default class GeoPointMapPicker extends GlimmerComponent<MapPickerSignature> {
  get hasCoordinates() {
    return hasValidCoordinates(this.args.model);
  }

  get coordinates(): Coordinate[] {
    if (!this.hasCoordinates) return [];
    return [{ lat: this.args.model.lat!, lng: this.args.model.lon! }];
  }

  get coordinateDisplay() {
    if (this.hasCoordinates) {
      return formatCoordinates(this.args.model.lat, this.args.model.lon);
    }
    return this.args.canEdit
      ? 'Click the map to place a pin'
      : 'No location set';
  }

  get mapConfig(): {
    tileserverUrl?: string;
    disableMapClick?: boolean;
  } {
    const config: {
      tileserverUrl?: string;
      disableMapClick?: boolean;
    } = {};
    if (this.args.options?.tileserverUrl) {
      config.tileserverUrl = this.args.options.tileserverUrl;
    }
    if (!this.args.canEdit) {
      config.disableMapClick = true;
    }
    return config;
  }

  get mapContainerStyle() {
    const height = this.args.options?.mapHeight;
    return height ? htmlSafe(`height: ${height}`) : undefined;
  }

  @action
  handleMapClick(coordinate: Coordinate) {
    if (this.args.canEdit && this.args.model) {
      this.args.model.lat = coordinate.lat;
      this.args.model.lon = coordinate.lng;
    }
  }

  <template>
    <div class='geo-point-map-picker'>
      {{#if this.hasCoordinates}}
        <div class='map-container' style={{this.mapContainerStyle}}>
          {{#if @canEdit}}
            <MapRender
              @coordinates={{this.coordinates}}
              @onMapClick={{this.handleMapClick}}
              @mapConfig={{this.mapConfig}}
            />
          {{else}}
            <MapRender
              @coordinates={{this.coordinates}}
              @mapConfig={{this.mapConfig}}
            />
          {{/if}}
        </div>
        <div class='coordinate-display'>
          📍
          {{this.coordinateDisplay}}
        </div>
      {{else}}
        <div class='no-location-placeholder'>
          <MapPinIcon class='placeholder-icon' />
          <span class='placeholder-text'>{{this.coordinateDisplay}}</span>
        </div>
      {{/if}}
    </div>

    <style scoped>
      .geo-point-map-picker {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }

      .map-container {
        width: 100%;
        border: 1px solid var(--boxel-border-color);
        border-radius: var(--boxel-border-radius);
        overflow: hidden;
        position: relative;
      }

      .coordinate-display {
        --coordinate-display-bg-color: #daf3ff;
        --coordinate-display-border-color: #0ea5e9;
        padding: var(--boxel-sp-4xs) var(--boxel-sp-xs);
        font-size: var(--boxel-font-size-xs);
        line-height: var(--boxel-line-height-xs);
        font-family: var(--boxel-font-family-mono);
        background: var(--coordinate-display-bg-color);
        border-left: 3px solid var(--coordinate-display-border-color);
        color: var(--boxel-dark);
      }

      .no-location-placeholder {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: var(--boxel-sp-2xs);
        background: var(--boxel-surface-secondary);
        border: 2px dashed var(--boxel-border-color);
        border-radius: var(--boxel-border-radius);
        color: var(--boxel-text-muted);
        aspect-ratio: 16 / 9;
      }

      .placeholder-icon {
        width: 24px;
        height: 24px;
      }

      .placeholder-text {
        font-size: var(--boxel-font-size-sm);
      }
    </style>
  </template>
}
