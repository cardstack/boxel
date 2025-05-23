import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { cn } from '../../helpers.ts';
import DropdownArrow from '../../icons/dropdown-arrow-down.gts';
import Button from '../button/index.gts';
import IconButton from '../icon-button/index.gts';
import FilterList, { type Filter } from './index.gts';

interface Signature {
  Args: {
    activeFilter?: Filter;
    filter: Filter;
    onChanged: (filter: Filter) => void;
  };
  Element: HTMLElement;
}

export default class FilterListItem extends Component<Signature> {
  <template>
    <li
      class='filter-list-item'
      role='treeitem'
      aria-expanded={{if
        this.isExpanded
        'true'
        (if this.hasNestedItems 'false')
      }}
      aria-selected='{{this.isSelected}}'
      aria-label={{@filter.displayName}}
      ...attributes
    >
      <span
        class={{cn
          'list-item-buttons'
          is-selected=this.isSelected
          is-expanded=this.isExpanded
        }}
      >
        <Button
          @kind='text-only'
          @size='small'
          class='filter-list__button'
          {{on 'click' this.onChange}}
          data-test-boxel-filter-list-button={{@filter.displayName}}
        >
          {{#if (isString @filter.icon)}}
            {{htmlSafe (addClassToSVG @filter.icon 'filter-list__icon')}}
          {{else if @filter.icon}}
            <@filter.icon class='filter-list__icon' role='presentation' />
          {{/if}}
          <span class='filter-name ellipsize'>
            {{@filter.displayName}}
          </span>
        </Button>
        {{#if this.hasNestedItems}}
          <IconButton
            class='dropdown-toggle'
            @icon={{DropdownArrow}}
            @width='10'
            @height='10'
            aria-label='Toggle {{@filter.displayName}} group items'
            {{on 'click' this.toggleExpanded}}
          />
        {{/if}}
      </span>
      {{#if this.isExpanded}}
        <FilterList
          @filters={{@filter.filters}}
          @onChanged={{@onChanged}}
          @activeFilter={{@activeFilter}}
          role='group'
          aria-label='{{@filter.displayName}} group'
        />
      {{/if}}
    </li>
    <style scoped>
      @layer {
        .list-item-buttons {
          display: flex;
          border-radius: var(--boxel-border-radius-sm);
          color: var(--boxel-dark);
          background-color: var(--boxel-light);
        }
        .list-item-buttons:not(.is-selected):hover {
          background-color: var(--boxel-200);
        }
        .list-item-buttons.is-selected {
          filter: invert(1);
        }
        .list-item-buttons.is-expanded {
          background-color: var(--boxel-100);
        }
        .dropdown-toggle {
          --boxel-icon-button-width: 2rem;
          --boxel-icon-button-height: 2rem;
          flex-shrink: 0;
        }
        .is-expanded > .dropdown-toggle {
          transform: rotate(180deg);
        }
        .filter-list__button {
          flex-grow: 1;
          width: 100%;
          display: flex;
          justify-content: flex-start;
          gap: var(--boxel-sp-xs);
          font: 500 var(--boxel-font-sm);
          letter-spacing: var(--boxel-lsp-xs);
          border-radius: var(--boxel-border-radius-sm);
          max-width: 100%;
          overflow: hidden;
          text-align: left;
          transition: none;
        }
        .filter-list__button:hover,
        .filter-list__button:focus {
          color: inherit;
          background-color: inherit;
        }
        :deep(.filter-list__icon) {
          flex-shrink: 0;
          width: var(--boxel-icon-xs);
          height: var(--boxel-icon-xs);
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

  @tracked private isExpanded = this.args.filter?.isExpanded ?? false;

  private get isSelected() {
    return this.args.filter === this.args.activeFilter;
  }

  private get hasNestedItems() {
    return Boolean(this.args.filter?.filters);
  }

  @action private toggleExpanded() {
    return (this.isExpanded = !this.isExpanded);
  }

  @action private onChange() {
    this.args.onChanged(this.args.filter);
  }
}

function addClassToSVG(svgString: string, className: string) {
  return svgString
    .replace(/<svg\b([^>]*)\sclass="([^"]*)"/, `<svg$1 class="$2 ${className}"`)
    .replace(
      /<svg\b([^>]*)>/,
      `<svg$1 class="${className}" role="presentation">`,
    );
}

function isString(item: unknown): item is string {
  return typeof item === 'string';
}
