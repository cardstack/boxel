import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { cn } from '../../helpers.gts';
import DropdownArrow from '../../icons/dropdown-arrow-down.gts';
import type { Icon } from '../../icons/types.ts';
import Button from '../button/index.gts';
import IconButton from '../icon-button/index.gts';

export type Filter = {
  count?: number;
  displayName: string;
  filters?: Filter[];
  icon?: Icon | string;
  // Stable identity for the row. Required when two filters can share a
  // display name; the row keeps its DOM node across a rebuild of the array.
  id?: string;
  isExpanded?: boolean;
};

interface Signature<F extends Filter = Filter> {
  Args: {
    activeFilter?: F;
    filters: F[] | undefined;
    onChanged: (filter: F) => void;
  };
  Blocks: {
    // Rendered after each item's button, for a per-item control such as an
    // add button. Receives the item.
    action: [filter: F];
  };
  Element: HTMLElement;
}

export default class FilterList<F extends Filter = Filter> extends Component<
  Signature<F>
> {
  // Rows are keyed by a stable string, not by object identity: a caller that
  // rebuilds its filter objects on every refresh would otherwise replace each
  // row's DOM node under the user, dropping keyboard focus. The id wins; the
  // display name is the fallback for callers whose names are unique.
  private get keyedFilters() {
    return (this.args.filters ?? []).map((filter) => ({
      key: filter.id ?? filter.displayName,
      filter,
    }));
  }

  <template>
    <ul class='filter-list' role='tree' ...attributes>
      {{#each this.keyedFilters key='key' as |entry|}}
        <ListItem
          @filter={{entry.filter}}
          @onChanged={{@onChanged}}
          @activeFilter={{@activeFilter}}
        >
          <:action as |item|>{{yield item to='action'}}</:action>
        </ListItem>
      {{/each}}
    </ul>
    <style scoped>
      @layer boxelComponentL3 {
        .filter-list {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-4xs);
          list-style-type: none;
          padding-inline-start: 0;
          margin-block: 0;
        }
        .filter-list :deep(.filter-list) {
          margin-top: var(--boxel-sp-4xs);
          padding-inline-start: var(--boxel-sp);
        }
      }
    </style>
  </template>
}

interface ListItemSignature<F extends Filter = Filter> {
  Args: {
    activeFilter?: F;
    filter: F;
    onChanged: (filter: F) => void;
  };
  Blocks: {
    action: [filter: F];
  };
  Element: HTMLElement;
}

export class ListItem<F extends Filter = Filter> extends Component<
  ListItemSignature<F>
> {
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
      data-test-filter-list-item={{@filter.displayName}}
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
          data-test-selected-filter={{if this.isSelected @filter.displayName}}
        >
          {{#if (isString @filter.icon)}}
            {{htmlSafe (addClassToSVG @filter.icon 'filter-list__icon')}}
          {{else if @filter.icon}}
            <@filter.icon class='filter-list__icon' role='presentation' />
          {{/if}}
          <span class='filter-name boxel-ellipsize'>
            {{@filter.displayName}}
          </span>
          {{#if (isNumber @filter.count)}}
            <span class='filter-count' data-test-filter-list-count>
              {{@filter.count}}
            </span>
          {{/if}}
        </Button>
        {{yield @filter to='action'}}
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
          @filters={{this.nestedFilters}}
          @onChanged={{@onChanged}}
          @activeFilter={{@activeFilter}}
          role='group'
          aria-label='{{@filter.displayName}} group'
        >
          <:action as |item|>{{yield item to='action'}}</:action>
        </FilterList>
      {{/if}}
    </li>
    <style scoped>
      @layer boxelComponentL2 {
        .list-item-buttons {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-4xs);
          border-radius: var(--boxel-border-radius-sm);
          color: inherit;
          background-color: inherit;
        }
        .list-item-buttons.is-expanded {
          background-color: var(
            --boxel-filter-expanded-background,
            color-mix(
              in oklab,
              var(--accent, var(--boxel-200)) 30%,
              transparent
            )
          );
          color: var(--boxel-filter-expanded-foreground, var(--foreground));
        }
        .list-item-buttons:not(.is-selected):hover {
          background-color: var(
            --boxel-filter-hover-background,
            color-mix(
              in oklab,
              var(--accent, var(--boxel-200)) 95%,
              transparent
            )
          );
          color: var(--boxel-filter-hover-foreground, var(--accent-foreground));
        }
        .list-item-buttons.is-selected {
          background-color: var(
            --boxel-filter-selected-background,
            var(--foreground, var(--boxel-dark))
          );
          color: var(
            --boxel-filter-selected-foreground,
            var(--background, var(--boxel-light))
          );
        }
        .list-item-buttons.is-selected:hover {
          background-color: var(
            --boxel-filter-selected-hover-background,
            color-mix(
              in oklab,
              var(--foreground, var(--boxel-dark)) 90%,
              transparent
            )
          );
          color: var(
            --boxel-filter-selected-hover-foreground,
            var(--background, var(--boxel-light))
          );
        }
        .dropdown-toggle {
          --boxel-icon-button-width: 2rem;
          --boxel-icon-button-height: 2rem;
          flex-shrink: 0;
          /* Collapsed: the down-arrow icon points right. */
          transform: rotate(-90deg);
        }
        .is-expanded > .dropdown-toggle {
          /* Expanded: arrow points down. */
          transform: rotate(0deg);
        }
        .filter-list__button {
          flex-grow: 1;
          width: 100%;
          min-width: 0;
          display: flex;
          justify-content: flex-start;
          gap: var(--boxel-sp-xs);
          font: 500 var(--boxel-font-sm);
          font-family: inherit;
          letter-spacing: var(--boxel-lsp-xs);
          border-radius: var(--boxel-border-radius-sm);
          max-width: 100%;
          overflow: hidden;
          text-align: left;
        }
        /* when a control follows the button (the action slot or the group
           toggle), the button ends close to its content and the control
           carries the edge */
        .filter-list__button:has(+ *) {
          --boxel-button-padding: var(--boxel-sp-4xs) var(--boxel-sp-5xs)
            var(--boxel-sp-4xs) var(--boxel-sp-sm);
        }
        .filter-list__button:hover,
        .filter-list__button:focus {
          color: inherit;
          background-color: transparent;
        }
        .dropdown-toggle,
        .filter-list__button {
          border: none;
          transition: none;
        }
        .filter-name {
          flex: 1 1 auto;
          min-width: 0;
        }
        .filter-count {
          flex-shrink: 0;
          font-size: var(--boxel-font-size-2xs);
          font-variant-numeric: tabular-nums;
          color: var(--boxel-filter-count-foreground, var(--muted-foreground));
        }
        .is-selected .filter-count {
          color: inherit;
        }
        :deep(.filter-list__icon) {
          flex-shrink: 0;
          width: var(--boxel-icon-xs);
          height: var(--boxel-icon-xs);
          vertical-align: top;
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

  // Nested filters are declared on the base type, so they come back as F[]
  // only by this cast; the list is homogeneous in practice.
  private get nestedFilters() {
    return this.args.filter?.filters as F[] | undefined;
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

function isNumber(item: unknown): item is number {
  return typeof item === 'number';
}
