import { fn } from '@ember/helper';
import { eq } from '@cardstack/boxel-ui/helpers';
import { on } from '@ember/modifier';
import { action } from '@ember/object';

import GlimmerComponent from '@glimmer/component';

import { Pill } from '@cardstack/boxel-ui/components';

export type FilterOption = {
  id: string;
  displayName: string;
};

interface TopBarFilterSignature {
  Args: {
    activeFilterId?: string;
    filters: FilterOption[];
    onChange?: (filterId: string) => void;
  };
  Element: HTMLElement;
}

export default class TopBarFilter extends GlimmerComponent<TopBarFilterSignature> {
  @action
  onChange(filterId: string) {
    this.args.onChange?.(filterId);
  }

  <template>
    <div class='top-bar-filter' ...attributes>
      {{#each @filters as |filter|}}
        <Pill
          @kind='button'
          class='spec-filter-pill
            {{if (eq @activeFilterId filter.id) "active"}}'
          {{on 'click' (fn this.onChange filter.id)}}
          data-test-filter-pill={{filter.id}}
        >
          <:default>
            <span>{{filter.displayName}}</span>
          </:default>
        </Pill>
      {{/each}}
    </div>
    <style scoped>
      .top-bar-filter {
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xs);
      }
      .spec-filter-pill {
        --pill-border-radius: 50px;
        --pill-font: 600 var(--boxel-font);
        --pill-padding: var(--boxel-sp-5xs) var(--boxel-sp);
        min-width: 100px;
        justify-content: center;
      }
      .spec-filter-pill.active {
        background-color: var(--boxel-highlight);
        color: var(--boxel-dark);
      }
      .spec-filter-pill:not(.active):hover {
        background-color: var(--boxel-300);
      }
    </style>
  </template>
}
