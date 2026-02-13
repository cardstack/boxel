import GlimmerComponent from '@glimmer/component';
import { eq, or } from '@cardstack/boxel-ui/helpers';
import type { GeoModel } from '../util/index';
import type {
  GeoPointConfiguration,
  GeoPointMapOptions,
  GeoPointVariant,
} from '../../geo-point';
import GeoPointCoordinateInput from './geo-point-coordinate-input';
import GeoPointMapPicker from './geo-point-map-picker';
import CurrentLocationAddon from './current-location-addon';
import QuickLocationsAddon from './quick-locations-addon';

interface GeoPointEditFieldSignature {
  Args: {
    model: GeoModel;
    canEdit?: boolean;
    configuration?: GeoPointConfiguration;
  };
}

export default class GeoPointEditField extends GlimmerComponent<GeoPointEditFieldSignature> {
  get variant(): GeoPointVariant {
    return this.args.configuration?.variant ?? 'standard';
  }

  private get options() {
    return this.args.configuration?.options ?? {};
  }

  get showCurrentLocation(): boolean {
    return this.options.showCurrentLocation ?? false;
  }

  get quickLocations(): string[] {
    return this.options.quickLocations ?? [];
  }

  get hasQuickLocations(): boolean {
    return this.quickLocations.length > 0;
  }

  get mapOptions(): GeoPointMapOptions | undefined {
    const config = this.args.configuration;
    if (config?.variant !== 'map-picker') return undefined;
    const opts = config.options;
    return opts
      ? { tileserverUrl: opts.tileserverUrl, mapHeight: opts.mapHeight }
      : undefined;
  }

  <template>
    <div class='geo-point-edit-field'>
      <div class='variant-section'>
        {{#if (eq this.variant 'map-picker')}}
          <GeoPointMapPicker
            @model={{@model}}
            @options={{this.mapOptions}}
            @canEdit={{@canEdit}}
          />
        {{else}}
          <GeoPointCoordinateInput @model={{@model}} @canEdit={{@canEdit}} />
        {{/if}}
      </div>

      {{#if (or this.showCurrentLocation this.hasQuickLocations)}}
        <div class='addons-section'>
          {{#if this.showCurrentLocation}}
            <CurrentLocationAddon @model={{@model}} @canEdit={{@canEdit}} />
          {{/if}}

          {{#if this.hasQuickLocations}}
            <QuickLocationsAddon
              @model={{@model}}
              @locations={{this.quickLocations}}
              @canEdit={{@canEdit}}
            />
          {{/if}}
        </div>
      {{/if}}
    </div>

    <style scoped>
      .geo-point-edit-field {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
      }

      .variant-section {
        width: 100%;
      }

      .addons-section {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
      }
    </style>
  </template>
}
