import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import type { ComponentLike } from '@glint/template';

import { not } from '../../helpers/truth-helpers.ts';
import Button from '../button/index.gts';

export interface FilterListIconSignature {
  Element: SVGElement;
}

export type FilterListIcon = ComponentLike<FilterListIconSignature>;

import { htmlSafe } from '@ember/template';

import { cn, eq } from '../../helpers.ts';

export type Filter = {
  displayName: string;
  icon: FilterListIcon | string;
  query?: any; // TODO: import type Query
};

interface Signature {
  Args: {
    activeFilter?: Filter;
    allowTextWrapping?: boolean;
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
    <ul class='filter-list' ...attributes>
      {{#each @filters as |filter|}}
        <li>
          <Button
            @kind='text-only'
            @size='small'
            class={{cn
              'filter-list__button'
              selected=(eq @activeFilter filter)
            }}
            {{on 'click' (fn this.onChanged filter)}}
            data-test-boxel-filter-list-button={{filter.displayName}}
          >
            {{#if (isIconString filter.icon)}}
              {{htmlSafe (addClassToSVG filter.icon 'filter-list__icon')}}
            {{else}}
              <filter.icon class='filter-list__icon' />
            {{/if}}
            <span class={{cn 'filter-name' ellipsize=(not @allowTextWrapping)}}>
              {{filter.displayName}}
            </span>
          </Button>
        </li>
      {{/each}}
    </ul>
    <style scoped>
      @layer {
        .filter-list {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-4xs);
          list-style-type: none;
          padding-inline-start: 0;
          margin-block: 0;
        }
        .filter-list__button {
          width: 100%;
          display: flex;
          justify-content: flex-start;
          gap: var(--boxel-sp-xs);
          font: 500 var(--boxel-font-sm);
          letter-spacing: var(--boxel-lsp-xs);
          border-radius: var(--boxel-border-radius-sm);
          color: var(--boxel-dark);
          background-color: var(--boxel-light);
          max-width: 100%;
          overflow: hidden;
          text-align: left;
        }
        .filter-list__button.selected {
          filter: invert(1);
        }
        .filter-list__button:not(.selected):hover {
          background-color: var(--boxel-300);
        }
        .filter-list__icon {
          flex-shrink: 0;
          width: var(--boxel-icon-sm);
          height: var(--boxel-icon-sm);
          vertical-align: top;
        }
        .ellipsize {
          white-space: nowrap;
          text-overflow: ellipsis;
          overflow: hidden;
          max-width: 100%;
        }
      }
    </style>
  </template>
}

function addClassToSVG(svgString: string, className: string) {
  return svgString
    .replace(/<svg\b([^>]*)\sclass="([^"]*)"/, `<svg$1 class="$2 ${className}"`)
    .replace(/<svg\b([^>]*)>/, `<svg$1 class="${className}">`);
}

function isIconString(icon: FilterListIcon | string): icon is string {
  return typeof icon === 'string';
}
