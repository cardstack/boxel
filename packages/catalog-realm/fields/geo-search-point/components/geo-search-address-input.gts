import GlimmerComponent from '@glimmer/component';
import { action } from '@ember/object';
import { not } from '@cardstack/boxel-ui/helpers';
import { BoxelInput } from '@cardstack/boxel-ui/components';
import type { GeoSearchModel } from '../util/index';

interface GeoSearchAddressInputOptions {
  placeholder?: string;
}

interface GeoSearchAddressInputSignature {
  Args: {
    model: GeoSearchModel;
    canEdit?: boolean;
    options?: GeoSearchAddressInputOptions;
    isSearching?: boolean;
    onSearch: (value: string) => void;
  };
}

export default class GeoSearchAddressInput extends GlimmerComponent<GeoSearchAddressInputSignature> {
  get canEdit(): boolean {
    return this.args.canEdit ?? true;
  }

  get searchAddressValue() {
    return this.args.model.searchKey ?? '';
  }

  get coordinateDisplay() {
    const lat = this.args.model?.lat;
    const lon = this.args.model?.lon;
    if (lat != null && lon != null) {
      return `Lat: ${lat}, Lon: ${lon}`;
    }
    return 'No coordinates available';
  }

  get placeholder() {
    return this.args.options?.placeholder ?? 'Enter address to search...';
  }

  @action
  updateSearchAddress(value: string) {
    this.args.onSearch(value);
  }

  <template>
    <div class='geo-search-address-input'>
      <BoxelInput
        type='text'
        placeholder={{this.placeholder}}
        @value={{this.searchAddressValue}}
        @onInput={{this.updateSearchAddress}}
        @disabled={{not this.canEdit}}
      />

      <div class='coordinate-display'>
        {{#if @isSearching}}
          Searching for coordinates...
        {{else}}
          📍
          {{this.coordinateDisplay}}
        {{/if}}
      </div>
    </div>

    <style scoped>
      .geo-search-address-input {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
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
    </style>
  </template>
}
