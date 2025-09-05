import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { cn } from '../../helpers.ts';
import DropdownArrow from '../../icons/dropdown-arrow-down.gts';
import type { Icon } from '../../icons/types.ts';
import Button from '../button/index.gts';
import IconButton from '../icon-button/index.gts';

export type Filter = {
  displayName: string;
  filters?: Filter[];
  icon?: Icon | string;
  isExpanded?: boolean;
};

interface Signature {
  Args: {
    activeFilter?: Filter;
    filters: Filter[] | undefined;
    onChanged: (filter: Filter) => void;
  };
  Element: HTMLElement;
}

const FilterList: TemplateOnlyComponent<Signature> = <template>
  <ul class='filter-list' role='tree' ...attributes>
    {{#each @filters key='displayName' as |filter|}}
      <ListItem
        @filter={{filter}}
        @onChanged={{@onChanged}}
        @activeFilter={{@activeFilter}}
      />
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
      .filter-list :deep(.filter-list) {
        margin-top: var(--boxel-sp-4xs);
        padding-inline-start: var(--boxel-sp);
      }
    }
  </style>
</template>;

export default FilterList;

interface ListItemSignature {
  Args: {
    activeFilter?: Filter;
    filter: Filter;
    onChanged: (filter: Filter) => void;
  };
  Element: HTMLElement;
}

export class ListItem extends Component<ListItemSignature> {
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
          font-family: inherit;
          letter-spacing: var(--boxel-lsp-xs);
          border-radius: var(--boxel-border-radius-sm);
          max-width: 100%;
          overflow: hidden;
          text-align: left;
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
