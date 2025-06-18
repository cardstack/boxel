import GlimmerComponent from '@glimmer/component';

import { fn, concat } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';

import {
  Pill,
  FilterList,
  SkeletonPlaceholder,
} from '@cardstack/boxel-ui/components';
import type { Icon } from '@cardstack/boxel-ui/icons';

export type FilterItem = {
  id: string;
  displayName: string;
  filters?: FilterItem[];
  icon?: Icon | string;
  isExpanded?: boolean;
};

interface FilterCategoryGroupArgs {
  Args: {
    title: string;
    categories: FilterItem[];
    activeCategory?: FilterItem;
    onCategorySelect: (category: FilterItem) => void;
    isLoading?: boolean;
  };
  Element: HTMLElement;
}

export class FilterCategoryGroup extends GlimmerComponent<FilterCategoryGroupArgs> {
  <template>
    <FilterGroupWrapper @title={{@title}} ...attributes>
      {{#if @isLoading}}
        <SkeletonPlaceholder class='skeleton-placeholder-filter-list' />
      {{else}}
        <FilterList
          @filters={{@categories}}
          @activeFilter={{@activeCategory}}
          @onChanged={{@onCategorySelect}}
          class='filter-category-list'
        />
      {{/if}}
    </FilterGroupWrapper>

    <style scoped>
      .filter-category-list :deep(.list-item-buttons) {
        background-color: var(--layout-container-background-color);
      }
      .filter-category-list :deep(.list-item-buttons:hover) {
        background-color: var(--boxel-300);
      }
      .skeleton-placeholder-filter-list {
        height: 20px;
        width: 100%;
      }
    </style>
  </template>
}

interface FilterTagGroupArgs {
  Args: {
    title: string;
    tags: FilterItem[];
    activeTagIds: string[]; // Array since it's multi-select
    onTagSelect: (item: FilterItem) => void;
    isLoading?: boolean;
  };
  Element: HTMLElement;
}

export class FilterTagGroup extends GlimmerComponent<FilterTagGroupArgs> {
  @action
  handleItemClick(item: FilterItem) {
    this.args.onTagSelect(item);
  }

  get isItemSelected() {
    return (itemId: string) => this.args.activeTagIds.includes(itemId);
  }

  get noItems() {
    return this.args.tags.length === 0;
  }

  <template>
    <FilterGroupWrapper @title={{@title}} ...attributes>
      {{#if @isLoading}}
        <div class='filter-list'>
          <SkeletonPlaceholder class='skeleton-placeholder-filter-list' />
        </div>
      {{else}}
        <div class='filter-list'>
          {{#if this.noItems}}
            <span>No {{@title}} found</span>
          {{else}}
            {{#each @tags as |tag|}}
              {{! Take note: did not choose to use @pillBackgroundColor args because we want a custom background color toggled based on the selected state }}
              <Pill
                @kind='button'
                class={{concat
                  'tag-filter-pill'
                  (if (this.isItemSelected tag.id) ' selected')
                }}
                {{on 'click' (fn this.handleItemClick tag)}}
                data-test-filter-pill={{tag.id}}
              >
                <:default>
                  <span>{{tag.displayName}}</span>
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
          padding: var(--boxel-sp-xxxs) var(--boxel-sp-sm) var(--boxel-sp-sm)
            var(--boxel-sp-sm);
        }
        .tag-filter-pill.selected {
          background: var(--boxel-dark);
          color: var(--boxel-light);
        }
        .tag-filter-pill:not(.selected):hover {
          background: var(--boxel-300);
        }
        .skeleton-placeholder-filter-list {
          height: 20px;
          width: 100%;
        }
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
          background-color: var(
            --filter-group-background-color,
            var(--boxel-light)
          );
          border-radius: var(--boxel-border-radius);
        }
        .filter-heading {
          font: 500 var(--boxel-font);
          margin: 0;
          padding: var(--boxel-sp-xs);
        }
      }
    </style>
  </template>
}

// Filter Sidebar Component - Grouped Filters
interface FilterSidebarArgs {
  Args: {
    categoryItems: FilterItem[];
    activeCategory: FilterItem | undefined;
    onCategorySelect: (category: FilterItem) => void;
    categoryIsLoading?: boolean;
    tagItems: FilterItem[];
    activeTagIds: string[];
    onTagSelect: (tag: FilterItem) => void;
    tagIsLoading?: boolean;
  };
}

export default class FilterSidebar extends GlimmerComponent<FilterSidebarArgs> {
  <template>
    <div
      role='complementary'
      aria-label='Filters'
      class='filters-container info-box'
    >
      <FilterCategoryGroup
        @title='Categories'
        @categories={{@categoryItems}}
        @activeCategory={{@activeCategory}}
        @onCategorySelect={{@onCategorySelect}}
        @isLoading={{@categoryIsLoading}}
        class='filter-category-group'
      />
      <FilterTagGroup
        @title='Tags'
        @tags={{@tagItems}}
        @activeTagIds={{@activeTagIds}}
        @onTagSelect={{@onTagSelect}}
        @isLoading={{@tagIsLoading}}
      />
    </div>

    <style scoped>
      .filters-container {
        background-color: transparent;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
        margin-top: var(--boxel-sp);
      }

      .filter-category-group {
        --filter-group-background-color: transparent;
      }
    </style>
  </template>
}
