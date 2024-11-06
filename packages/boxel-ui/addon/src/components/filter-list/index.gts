import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import type { ComponentLike } from '@glint/template';

export interface FilterListIconSignature {
  Element: SVGElement;
}

export type FilterListIcon = ComponentLike<FilterListIconSignature>;

import { cn, eq } from '../../helpers.ts';

export type Filter = {
  displayName: string;
  icon: FilterListIcon;
};

interface Signature {
  Args: {
    activeFilter?: Filter;
    filters: Filter[];
    onChanged?: (filter: Filter) => void;
  };
  Element: HTMLElement;
}

export default class FilterList extends Component<Signature> {
  @action
  onChanged(filter: Filter) {
    this.args.onChanged?.(filter);
  }

  <template>
    <div class='filter-list' ...attributes>
      {{#each @filters as |filter|}}
        <button
          class={{cn 'filter-list__button' selected=(eq @activeFilter filter)}}
          {{on 'click' (fn this.onChanged filter)}}
          data-test-boxel-filter-list-button={{filter.displayName}}
        ><filter.icon
            class='filter-list__icon'
          />{{filter.displayName}}</button>
      {{/each}}
    </div>
    <style scoped>
      .filter-list {
        display: flex;
        flex-direction: column;
        width: 247px;
        margin-bottom: var(--boxel-sp-xs);
      }
      .filter-list__button {
        text-align: left;
        background: none;
        border: none;
        font: 500 var(--boxel-font-sm);
        padding: var(--boxel-sp-xxs);
        margin-bottom: var(--boxel-sp-4xs);
      }
      .filter-list__button.selected {
        color: var(--boxel-light);
        background: var(--boxel-dark);
        border-radius: 6px;
      }
      .filter-list__button:not(.selected):hover {
        background: var(--boxel-300);
        border-radius: 6px;
      }
      .filter-list__icon {
        width: var(--boxel-icon-xs);
        height: var(--boxel-icon-xs);
        vertical-align: top;
      }
    </style>
  </template>
}
