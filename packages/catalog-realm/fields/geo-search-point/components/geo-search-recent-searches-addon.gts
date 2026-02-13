import GlimmerComponent from '@glimmer/component';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { Pill } from '@cardstack/boxel-ui/components';

interface GeoSearchRecentSearchesAddonSignature {
  Args: {
    searches: string[];
    canEdit?: boolean;
    onSelectSearch: (query: string) => void;
  };
}

export default class GeoSearchRecentSearchesAddon extends GlimmerComponent<GeoSearchRecentSearchesAddonSignature> {
  get canEdit(): boolean {
    return this.args.canEdit ?? true;
  }

  <template>
    {{#if this.canEdit}}
      <section class='recent-section'>
        <h3 class='section-title'>Recent Searches</h3>
        <div class='recent-pills'>
          {{#each @searches as |query|}}
            <Pill
              class='search-pill'
              @kind='button'
              @pillBackgroundColor='var(--boxel-100)'
              @pillFontColor='var(--boxel-dark-green)'
              @pillBorderColor='var(--boxel-200)'
              title={{query}}
              {{on 'click' (fn @onSelectSearch query)}}
            >
              <span class='pill-text'>{{query}}</span>
            </Pill>
          {{/each}}
        </div>
      </section>
    {{/if}}

    <style scoped>
      .recent-section {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }

      .section-title {
        font: 600 var(--boxel-font-sm);
        color: var(--boxel-dark);
        margin: 0;
      }

      .recent-pills {
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xxs);
      }

      .search-pill {
        --boxel-pill-padding: var(--boxel-sp-5xs) var(--boxel-sp-xs);
        --boxel-pill-border-radius: 9999px;
        --boxel-pill-font: 500 var(--boxel-font-xs);
        max-width: 150px;
        cursor: pointer;
      }

      .pill-text {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .search-pill:hover {
        --boxel-pill-border-color: var(--boxel-dark-green);
      }
    </style>
  </template>
}
