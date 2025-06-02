import GlimmerComponent from '@glimmer/component';

import { fn, concat } from '@ember/helper';
import { on } from '@ember/modifier';
import { eq } from '@cardstack/boxel-ui/helpers';
import { action } from '@ember/object';

import { Pill, BoxelInput } from '@cardstack/boxel-ui/components';

export type FilterItem = { id: string; name: string };

interface FilterCategoryGroupArgs {
  Args: {
    title: string;
    items: FilterItem[];
    activeId: string;
    onItemSelect: (item: FilterItem) => void;
    isLoading?: boolean;
  };
  Element: HTMLElement;
}

export class FilterCategoryGroup extends GlimmerComponent<FilterCategoryGroupArgs> {
  @action
  handleItemClick(item: FilterItem) {
    this.args.onItemSelect(item);
  }

  <template>
    <FilterGroupWrapper @title={{@title}} ...attributes>
      {{#if @isLoading}}
        Loading...
      {{else}}
        <div class='filter-list'>
          {{#each @items as |item|}}
            <button
              class={{concat
                'filter-button'
                (if (eq @activeId item.id) ' selected')
              }}
              {{on 'click' (fn this.handleItemClick item)}}
              data-test-filter-button={{item.id}}
            >
              {{item.name}}
            </button>
          {{/each}}
        </div>
      {{/if}}
    </FilterGroupWrapper>

    <style scoped>
      @layer {
        .filter-list {
          display: flex;
          flex-direction: column;
          padding: var(--boxel-sp-sm);
        }
        .filter-button {
          text-align: left;
          background: none;
          border: none;
          font: 500 var(--boxel-font-sm);
          padding: var(--boxel-sp-xxs);
          margin-bottom: var(--boxel-sp-4xs);
        }
        .filter-button.selected {
          color: var(--boxel-light);
          background: var(--boxel-dark);
          border-radius: 6px;
        }
        .filter-button:not(.selected):hover {
          background: var(--boxel-300);
          border-radius: 6px;
        }
      }
    </style>
  </template>
}

interface FilterTagGroupArgs {
  Args: {
    title: string;
    items: FilterItem[];
    activeIds: string[]; // Array since it's multi-select
    onItemSelect: (item: FilterItem) => void;
    isLoading?: boolean;
  };
  Element: HTMLElement;
}

export class FilterTagGroup extends GlimmerComponent<FilterTagGroupArgs> {
  @action
  handleItemClick(item: FilterItem) {
    this.args.onItemSelect(item);
  }

  get isItemSelected() {
    return (itemId: string) => this.args.activeIds.includes(itemId);
  }

  get noItems() {
    return this.args.items.length === 0;
  }

  <template>
    <FilterGroupWrapper @title={{@title}} ...attributes>
      {{#if @isLoading}}
        Loading...
      {{else}}
        <div class='filter-list'>
          {{#if this.noItems}}
            <span>No {{@title}} found</span>
          {{else}}
            {{#each @items as |item|}}
              {{! Take note: did not choose to use @pillBackgroundColor args because we want a custom background color toggled based on the selected state }}
              <Pill
                @kind='button'
                class={{concat
                  'tag-filter-pill'
                  (if (this.isItemSelected item.id) ' selected')
                }}
                {{on 'click' (fn this.handleItemClick item)}}
                data-test-filter-pill={{item.id}}
              >
                <:default>
                  <span>{{item.name}}</span>
                </:default>
              </Pill>
            {{/each}}
          {{/if}}
        </div>
      {{/if}}
    </FilterGroupWrapper>

    <style scoped>
      @layer {
        .filter-list {
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp-xs);
          padding: var(--boxel-sp-sm);
        }
        .tag-filter-pill.selected {
          background: var(--boxel-dark);
          color: var(--boxel-light);
        }
        .tag-filter-pill:not(.selected):hover {
          background: var(--boxel-300);
        }
      }
    </style>
  </template>
}

interface FilterSearchArgs {
  Args: {
    title: string;
    placeholder?: string;
    searchValue?: string;
    onSearch: (searchValue: string) => void;
  };
  Element: HTMLElement;
}

export class FilterSearch extends GlimmerComponent<FilterSearchArgs> {
  @action
  handleSearch(value: string) {
    this.args.onSearch(value);
  }

  <template>
    <FilterGroupWrapper @title={{@title}} ...attributes>
      <div class='search-container'>
        <BoxelInput
          @type='search'
          @value={{@searchValue}}
          @placeholder={{@placeholder}}
          @onInput={{this.handleSearch}}
          data-test-filter-search-input
        />
      </div>
    </FilterGroupWrapper>

    <style scoped>
      .search-container {
        padding: var(--boxel-sp-sm);
      }
      :deep(.boxel-input.search) {
        --boxel-form-control-border-radius: var(--boxel-border-radius-xxl);
      }
    </style>
  </template>
}

// FilterGroupWrapper
interface FilterGroupWrapperArgs {
  Args: {
    title: string;
  };
  Element: HTMLElement;
  Blocks: {
    default: [];
  };
}

class FilterGroupWrapper extends GlimmerComponent<FilterGroupWrapperArgs> {
  <template>
    <section class='filter-group' ...attributes>
      <h2 class='filter-heading'>
        {{@title}}
      </h2>
      {{yield}}
    </section>

    <style scoped>
      @layer {
        .filter-group {
          display: flex;
          flex-direction: column;
          background-color: var(--boxel-light);
          border-radius: var(--boxel-border-radius);
        }
        .filter-heading {
          font: 500 var(--boxel-font);
          margin: 0;
          padding: var(--boxel-sp-sm);
          border-bottom: 1px solid var(--boxel-border-color);
        }
      }
    </style>
  </template>
}
