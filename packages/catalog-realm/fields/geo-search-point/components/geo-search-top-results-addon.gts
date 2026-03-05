import GlimmerComponent from '@glimmer/component';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import MapPinIcon from '@cardstack/boxel-icons/map-pin';
import InfoIcon from '@cardstack/boxel-icons/info';
import SearchIcon from '@cardstack/boxel-icons/search';
import { SkeletonPlaceholder } from '@cardstack/boxel-ui/components';
import { not } from '@cardstack/boxel-ui/helpers';

interface GeoSearchTopResultsAddonSignature {
  Args: {
    results: any[];
    canEdit?: boolean;
    isSearching?: boolean;
    onSelectResult: (result: any) => void;
  };
}

export default class GeoSearchTopResultsAddon extends GlimmerComponent<GeoSearchTopResultsAddonSignature> {
  get canEdit(): boolean {
    return this.args.canEdit ?? true;
  }

  resultAddressType = (value: string): string => {
    if (!value) return '';
    return value.charAt(0).toUpperCase() + value.slice(1);
  };

  <template>
    {{#if this.canEdit}}
      <section class='results-section'>
        <h3 class='section-title'><InfoIcon class='info-icon' />Results</h3>
        {{#if (not @isSearching)}}
          {{#if @results.length}}
            <div class='results-list'>
              {{#each @results as |result|}}
                <button
                  type='button'
                  class='result-card'
                  {{on 'click' (fn @onSelectResult result.display_name)}}
                >
                  <div class='result-icon'>
                    <MapPinIcon />
                  </div>
                  <div class='result-content'>
                    <p class='result-name'>
                      {{result.name}}
                    </p>
                    <p class='result-address'>
                      {{result.display_name}}
                    </p>
                    {{#if result.addresstype}}
                      <span class='result-address-type'>
                        {{this.resultAddressType result.addresstype}}
                      </span>
                    {{/if}}
                  </div>
                </button>
              {{/each}}
            </div>
          {{else}}
            <div class='no-results'>
              <SearchIcon class='no-results-icon' />
              <span class='no-results-text'>No results found. Try a different search term.</span>
            </div>
          {{/if}}
        {{else}}
          <div class='result-card skeleton-card'>
            <div class='result-icon'>
              <MapPinIcon />
            </div>
            <div class='skeleton-content'>
              <SkeletonPlaceholder class='skeleton-name' />
              <SkeletonPlaceholder class='skeleton-address' />
            </div>
          </div>
        {{/if}}
      </section>
    {{/if}}

    <style scoped>
      .results-section {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }

      .section-title {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xxs);
        font: 600 var(--boxel-font-sm);
        color: var(--boxel-dark);
        margin: 0;
      }

      .info-icon {
        width: 16px;
        height: 16px;
        flex-shrink: 0;
      }

      .results-list {
        display: flex;
        flex-direction: column;
      }

      .result-card {
        border: none;
        display: flex;
        align-items: flex-start;
        gap: var(--boxel-sp-sm);
        width: 100%;
        padding: var(--boxel-sp) var(--boxel-sp);
        background-color: var(--boxel-light);
        cursor: pointer;
        text-align: left;
        transition: background-color 0.15s ease;
      }

      .result-card + .result-card {
        border-top: 1px solid var(--boxel-200);
      }

      .result-card:hover {
        background-color: var(--boxel-200);
      }

      .result-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        padding-top: var(--boxel-sp-5xs);
      }

      .result-icon :global(svg) {
        width: 28px;
        height: 28px;
        color: var(--boxel-dark-green);
      }

      .result-content {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xxxs);
        flex: 1;
        min-width: 0;
      }

      .result-name {
        font: 700 var(--boxel-font-sm);
        color: var(--boxel-dark);
        margin: 0;
      }

      .result-address {
        font: var(--boxel-font-xs);
        color: var(--boxel-600);
        margin: 0;
      }

      .result-address-type {
        font: 600 var(--boxel-font-xs);
        color: var(--boxel-dark);
        margin-top: var(--boxel-sp-5xs);
      }

      .no-results {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: var(--boxel-sp-2xs);
        padding: var(--boxel-sp-lg) var(--boxel-sp);
        background: var(--boxel-surface-secondary);
        border: 2px dashed var(--boxel-border-color);
        border-radius: var(--boxel-border-radius);
        color: var(--boxel-text-muted);
      }

      .no-results-icon {
        width: 24px;
        height: 24px;
      }

      .no-results-text {
        font-size: var(--boxel-font-size-sm);
      }

      .skeleton-card {
        cursor: default;
      }

      .skeleton-content {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xxxs);
        flex: 1;
      }

      .skeleton-name {
        --boxel-skeleton-width: 40%;
        --boxel-skeleton-height: 14px;
        --boxel-skeleton-border-radius: 0;
      }

      .skeleton-address {
        --boxel-skeleton-width: 80%;
        --boxel-skeleton-height: 12px;
        --boxel-skeleton-border-radius: 0;
      }
    </style>
  </template>
}
