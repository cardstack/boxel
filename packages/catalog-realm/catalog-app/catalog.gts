import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { debounce } from 'lodash';

import {
  contains,
  field,
  Component,
  CardDef,
  realmInfo,
  type BaseDef,
  linksToMany,
  realmURL,
} from 'https://cardstack.com/base/card-api';
import {
  Query,
  isCardInstance,
  AnyFilter,
  Filter,
} from '@cardstack/runtime-common';
import StringField from 'https://cardstack.com/base/string';

import FilterSidebar, { type FilterItem } from './components/filter-section';
import ShowcaseView from './components/showcase-view';
import ListView from './components/list-view';

import CatalogLayout from './layouts/catalog-layout';

import type IconComponent from '@cardstack/boxel-icons/captions';
import BuildingBank from '@cardstack/boxel-icons/building-bank';
import BuildingIcon from '@cardstack/boxel-icons/building';
import CategoryIcon from '@cardstack/boxel-icons/category';
import HealthRecognition from '@cardstack/boxel-icons/health-recognition';
import LayoutGridPlusIcon from '@cardstack/boxel-icons/layout-grid-plus';
import UsersIcon from '@cardstack/boxel-icons/users';
import WorldIcon from '@cardstack/boxel-icons/world';
import { TabbedHeader, BoxelInput } from '@cardstack/boxel-ui/components';

import { Listing } from './listing/listing';
import { Category } from './listing/category';
import { Tag } from './listing/tag';

type SphereName = 'WORK' | 'PLAY' | 'LIFE' | 'LEARN' | 'BUILD';

// Catalog App
class Isolated extends Component<typeof Catalog> {
  tabFilterOptions = [
    {
      tabId: 'showcase',
      displayName: 'Showcase',
    },
    {
      tabId: 'app',
      displayName: 'Apps',
    },
    {
      tabId: 'card',
      displayName: 'Cards',
    },
    {
      tabId: 'field',
      displayName: 'Fields',
    },
    {
      tabId: 'skill',
      displayName: 'Skills',
    },
    {
      tabId: 'theme',
      displayName: 'Themes',
    },
  ];

  @tracked activeTabId: string = this.tabFilterOptions[0].tabId;

  @action
  setActiveTab(tabId: string) {
    this.activeTabId = tabId;
  }

  @tracked activeCategoryId: string | undefined =
    this.activeTabId !== 'showcase' ? 'all' : undefined;

  @tracked activeTags: FilterItem[] = [];

  @action
  handleTagSelect(item: FilterItem) {
    this.activeTags = this.activeTags.some((t) => t.id === item.id)
      ? this.activeTags.filter((t) => t.id !== item.id)
      : [...this.activeTags, item];
  }

  // Filter Search
  @tracked searchValue: string | undefined = undefined;

  private debouncedSetSearchKey = debounce((value: string) => {
    this.searchValue = value;
  }, 300);

  @action
  onSearchInput(value: string) {
    this.debouncedSetSearchKey(value);
  }

  //query
  get query(): Query {
    return {
      filter: {
        on: {
          module: new URL('./listing/listing', import.meta.url).href,
          name:
            this.activeTabId === 'showcase'
              ? 'Listing'
              : `${capitalize(this.activeTabId)}Listing`,
        },
        every: [this.categoryFilter, this.tagFilter, this.searchFilter].filter(
          Boolean,
        ) as Filter[],
      },
    };
  }

  // Category filter
  @tracked activeCategory: FilterItem | undefined = undefined;

  get categoryQuery(): Query {
    return {
      filter: {
        type: {
          module: new URL('./listing/category', import.meta.url).href,
          name: 'Category',
        },
      },
    };
  }

  categorySearch = this.args.context?.getCards(
    this,
    () => this.categoryQuery,
    () => this.realmHrefs,
    {
      isLive: true,
    },
  );

  // Returns a list of filter items for the category sidebar:
  // - "All" button (FilterItem)
  // - SphereFilter containing individual categories
  get categoryItems(): FilterItem[] {
    const categoryInstances = (this.categorySearch?.instances ??
      []) as Category[];

    if (!categoryInstances) {
      return [];
    }

    // Define which icon to use for each sphere
    const sphereIconMap: Record<SphereName, typeof IconComponent> = {
      WORK: BuildingBank,
      PLAY: WorldIcon,
      LIFE: HealthRecognition,
      LEARN: UsersIcon,
      BUILD: BuildingIcon,
    };

    // Define the desired sphere order
    const sphereOrder: SphereName[] = [
      'WORK',
      'PLAY',
      'LIFE',
      'LEARN',
      'BUILD',
    ];

    // Group categories by their sphere
    const sphereFilters: Record<string, FilterItem> = {};

    // Loop through each category and organize them by sphere
    for (const category of categoryInstances) {
      if (!category.sphere?.name) {
        continue;
      }

      const name = category.sphere.name;

      if (!sphereFilters[name]) {
        sphereFilters[name] = {
          id: name.toLowerCase(),
          displayName: name,
          icon: sphereIconMap[name as SphereName] || CategoryIcon,
          filters: [],
        };
      }

      const categoryFilter: FilterItem = {
        id: category.id,
        displayName: category.name,
        icon: CategoryIcon,
      };

      sphereFilters[name].filters!.push(categoryFilter);
    }

    // Create filter items in the desired order
    const orderedSphereFilters = sphereOrder
      .filter((sphereName) => sphereFilters[sphereName])
      .map((sphereName) => sphereFilters[sphereName]);

    const filterItems = [
      {
        id: 'all',
        displayName: 'All',
        icon: LayoutGridPlusIcon,
      },
      ...orderedSphereFilters,
    ];

    return filterItems;
  }

  @action
  handleCategorySelect(category: FilterItem) {
    this.activeCategory = category;
  }

  get categoryFilter(): AnyFilter | undefined {
    const isNoFilterSelected =
      this.activeCategory?.id === 'all' || !this.activeCategory;

    if (isNoFilterSelected) {
      return;
    }

    // Show all items that belong to ANY category within this sphereUser selected a sphere (e.g., "BUILD", "LEARN", etc.)
    const isSphereSelected =
      this.activeCategory?.filters && this.activeCategory.filters.length > 0;

    if (isSphereSelected) {
      const categoryIdsInSphere = this.activeCategory!.filters!.map(
        (category) => category.id,
      );

      const sphereFilter = {
        any: categoryIdsInSphere.map((categoryId) => ({
          eq: {
            'categories.id': categoryId,
          },
        })),
      };

      return sphereFilter;
    } else {
      const specificCategoryFilter = {
        any: [
          {
            eq: {
              'categories.id': this.activeCategory!.id,
            },
          },
        ],
      };

      return specificCategoryFilter;
    }
  }

  get tagQuery(): Query {
    return {
      filter: {
        type: {
          module: new URL('./listing/tag', import.meta.url).href,
          name: 'Tag',
        },
      },
    };
  }

  tagSearch = this.args.context?.getCards(
    this,
    () => this.tagQuery,
    () => this.realmHrefs,
    {
      isLive: true,
    },
  );

  get tagItems(): FilterItem[] {
    let instances = (this.tagSearch?.instances ?? []) as Tag[];
    if (!instances) {
      return [];
    }
    return instances.map((instance) => ({
      id: instance.id,
      displayName: instance.name,
    }));
  }

  get tagFilter(): AnyFilter | undefined {
    if (this.activeTags.length === 0) {
      return;
    }
    return {
      any: this.activeTags.map((tag) => ({
        eq: {
          'tags.id': tag.id,
        },
      })),
    };
  }

  get searchFilter(): AnyFilter | undefined {
    if (!this.searchValue || this.searchValue.length === 0) {
      return;
    }
    return {
      any: [{ contains: { title: this.searchValue } }],
    };
  }

  // end of listing query filter values

  @action clearFiltersAndReset() {
    this.resetFilters();
  }

  @action resetFilters() {
    this.activeCategory = undefined;
    this.searchValue = undefined;
    this.activeTags = [];
  }

  get shouldShowTab() {
    return (tabId: string) => {
      return this.activeTabId === tabId;
    };
  }

  get hasActiveFilters() {
    return (
      this.activeCategory !== undefined ||
      this.searchValue !== undefined ||
      this.activeTags.length > 0
    );
  }

  get hasNoActiveFilters() {
    return !this.hasActiveFilters;
  }

  get isShowcaseView() {
    return this.activeTabId === 'showcase' && this.hasNoActiveFilters;
  }

  get navigationButtonText() {
    if (this.activeTabId === 'showcase') {
      return 'Catalog Home';
    }
    const tabOption = this.tabFilterOptions.find(
      (tab) => tab.tabId === this.activeTabId,
    );
    return tabOption ? `All ${tabOption.displayName}` : 'Catalog Home';
  }

  get headerColor() {
    return (
      Object.getPrototypeOf(this.args.model).constructor.headerColor ??
      undefined
    );
  }

  private get realms() {
    return [this.args.model[realmURL]!];
  }

  get realmHrefs() {
    return this.realms.map((realm) => realm.href);
  }

  getComponent = (card: CardDef) => card.constructor.getComponent(card);

  <template>
    <CatalogLayout
      data-test-catalog-app
      class='catalog-layout {{this.activeTabId}}'
    >
      <:header>
        <TabbedHeader
          @tabs={{this.tabFilterOptions}}
          @setActiveTab={{this.setActiveTab}}
          @activeTabId={{this.activeTabId}}
          @headerBackgroundColor={{this.headerColor}}
          class='catalog-tab-header'
        >
          <:sideContent>
            <BoxelInput
              @type='search'
              @value={{this.searchValue}}
              @onInput={{this.onSearchInput}}
              placeholder='Search by Title'
              data-test-filter-search-input
              class='catalog-search-input'
            />
          </:sideContent>
        </TabbedHeader>
      </:header>
      <:sidebar>
        <div class='sidebar-content'>
          <button
            class='navigation-button
              {{if this.hasNoActiveFilters "is-selected"}}'
            {{on 'click' this.clearFiltersAndReset}}
            data-test-navigation-reset-button={{this.activeTabId}}
          >
            <img
              src='https://boxel-images.boxel.ai/icons/icon_catalog_rounded.png'
              alt='Catalog Icon'
              class='catalog-icon'
            />
            <span class='button-text'>{{this.navigationButtonText}}</span>
          </button>

          <FilterSidebar
            @categoryItems={{this.categoryItems}}
            @activeCategory={{this.activeCategory}}
            @onCategorySelect={{this.handleCategorySelect}}
            @categoryIsLoading={{this.categorySearch.isLoading}}
            @tagItems={{this.tagItems}}
            @activeTags={{this.activeTags}}
            @onTagSelect={{this.handleTagSelect}}
            @tagIsLoading={{this.tagSearch.isLoading}}
          />
        </div>
      </:sidebar>
      <:content>
        <div class='content-area-container {{this.activeTabId}}'>
          <div class='content-area'>
            <div class='catalog-content'>
              <div class='catalog-listing info-box'>
                {{#if this.isShowcaseView}}
                  <ShowcaseView
                    @startHereListings={{@model.startHere}}
                    @newListings={{@model.new}}
                    @featuredListings={{@model.featured}}
                    @context={{@context}}
                    data-test-showcase-view
                  />
                {{else}}
                  <ListView
                    @query={{this.query}}
                    @realms={{this.realmHrefs}}
                    @context={{@context}}
                    data-test-catalog-list-view
                  />
                {{/if}}
              </div>
            </div>
          </div>
        </div>
      </:content>
    </CatalogLayout>

    <style scoped>
      .catalog-tab-header {
        position: sticky;
        top: 0;
        z-index: 10;
        container-name: catalog-tab-header;
        container-type: inline-size;
      }
      .catalog-tab-header :deep(.app-title-group) {
        display: none;
      }
      .catalog-tab-header :deep(.app-content) {
        gap: var(--boxel-sp-xxs);
      }
      .catalog-search-input {
        width: 300px;
        outline: 1px solid var(--boxel-light);
      }

      .info-box {
        width: 100%;
        height: auto;
        border-radius: var(--boxel-border-radius);
        background-color: var(--boxel-light);
      }

      /* Layout */
      .catalog-layout {
        --layout-theme-color: #a66efa;
        --layout-container-background-color: #eeedf7;
        --layout-sidebar-background-color: #eeedf7;
        --layout-content-padding: var(--boxel-sp-xl);
      }

      /* Sidebar */
      .sidebar-content {
        padding: var(--boxel-sp);
        overflow-y: auto;
      }
      .sidebar-content > * + * {
        margin-top: var(--boxel-sp);
      }

      /* Container */
      .content-area-container {
        flex: 1;
        height: auto;
        container-name: content-area-container;
        container-type: inline-size;
      }

      .content-area {
        height: 100%;
        display: grid;
        gap: var(--boxel-sp-lg);
      }
      .catalog-content {
        display: block;
      }
      .catalog-listing {
        background-color: transparent;
        display: flex;
        flex-direction: column;
      }

      /* Sidebar */
      .navigation-button {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        width: 100%;
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        border: none;
        background: var(--boxel-light);

        color: var(--boxel-dark);
        font: 500 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
        text-align: left;
        border-radius: var(--boxel-border-radius-sm);
        cursor: pointer;
      }
      .navigation-button:hover {
        background-color: var(--boxel-300);
      }
      .navigation-button.is-selected {
        background-color: var(--boxel-dark);
        color: var(--boxel-light);
      }
      .catalog-icon {
        width: 16px;
        height: 16px;
      }
      .button-text {
        white-space: nowrap;
        text-overflow: ellipsis;
        overflow: hidden;
      }

      .operator-mode .buried .cards,
      .operator-mode .buried .add-button {
        display: none;
      }
      .go-to-grid {
        font-weight: 600;
        width: 100%;
      }

      @container catalog-tab-header (inline-size <= 500px) {
        .catalog-search-input {
          width: 100cqw;
        }
      }

      @container content-area-container (inline-size <= 768px) {
        .content-area {
          grid-template-columns: 1fr;
          overflow-y: auto;
        }
      }
    </style>
  </template>
}

export class Catalog extends CardDef {
  static displayName = 'Catalog';
  static icon = LayoutGridPlusIcon;
  static isolated = Isolated;
  static prefersWideFormat = true;
  static headerColor = '#9f3bf9';
  @field realmName = contains(StringField, {
    computeVia: function (this: Catalog) {
      return this[realmInfo]?.name;
    },
  });
  @field title = contains(StringField, {
    computeVia: function (this: Catalog) {
      return this.realmName;
    },
  });
  @field startHere = linksToMany(() => Listing);
  @field new = linksToMany(() => Listing);
  @field featured = linksToMany(() => Listing);

  static getDisplayName(instance: BaseDef) {
    if (isCardInstance(instance)) {
      return (instance as CardDef)[realmInfo]?.name ?? this.displayName;
    }
    return this.displayName;
  }
}

const capitalize = (str: string) => str[0].toUpperCase() + str.slice(1);
