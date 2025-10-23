import GlimmerComponent from '@glimmer/component';

import {
  FilterList,
  SkeletonPlaceholder,
} from '@cardstack/boxel-ui/components';
import type { Icon } from '@cardstack/boxel-ui/icons';
import { TagList } from '@cardstack/boxel-ui/components';

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
  get shouldShowLoadingState() {
    return (
      this.args.isLoading &&
      (!this.args.categories || this.args.categories.length === 0)
    );
  }

  <template>
    <FilterGroupWrapper @title={{@title}} ...attributes>
      {{#if this.shouldShowLoadingState}}
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
      .filter-category-list {
        --boxel-filter-expanded-background: transparent;
        --boxel-filter-hover-background: var(--boxel-300);
      }
      .filter-category-list :deep(.filter-list) {
        padding-inline-start: var(--boxel-sp-xs);
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
    activeTags: FilterItem[]; // Array since it's multi-select
    onTagSelect: (item: FilterItem) => void;
    isLoading?: boolean;
  };
  Element: HTMLElement;
}

export class FilterTagGroup extends GlimmerComponent<FilterTagGroupArgs> {
  get shouldShowLoadingState() {
    return (
      this.args.isLoading &&
      (!this.args.tags || this.args.tags.length === 0)
    );
  }

  <template>
    <FilterGroupWrapper @title={{@title}} ...attributes>
      {{#if this.shouldShowLoadingState}}
        <SkeletonPlaceholder class='skeleton-placeholder-filter-list' />
      {{else}}
        <TagList
          @tags={{@tags}}
          @selectedTags={{@activeTags}}
          @onTagSelect={{@onTagSelect}}
        />
      {{/if}}
    </FilterGroupWrapper>

    <style scoped>
      @layer {
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
    <section
      class='filter-group'
      aria-labelledby='filter-heading-{{@title}}'
      ...attributes
    >
      <h2 class='filter-heading' id='filter-heading-{{@title}}'>
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
          padding: var(--boxel-sp-xs);
          gap: var(--boxel-sp-sm);
        }
        .filter-heading {
          font: 500 var(--boxel-font);
          margin: 0;
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
    activeTags: FilterItem[];
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
        @activeTags={{@activeTags}}
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
