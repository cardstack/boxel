import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { debounce } from 'lodash';

import {
  contains,
  field,
  Component,
  CardDef,
  CardContext,
  realmInfo,
  type BaseDef,
  linksToMany,
  realmURL,
} from 'https://cardstack.com/base/card-api';
import {
  Query,
  isCardInstance,
  EqFilter,
  AnyFilter,
  Filter,
} from '@cardstack/runtime-common';
import StringField from 'https://cardstack.com/base/string';
import GlimmerComponent from '@glimmer/component';

import FilterSidebar, { type FilterItem } from './components/filter-section';
import CardsDisplaySection, {
  CardsIntancesGrid,
} from './components/cards-display-section';

import { CardsGrid } from './components/grid';

import CatalogLayout from './layouts/catalog-layout';

import type IconComponent from '@cardstack/boxel-icons/captions';
import BuildingBank from '@cardstack/boxel-icons/building-bank';
import BuildingIcon from '@cardstack/boxel-icons/building';
import CategoryIcon from '@cardstack/boxel-icons/category';
import HealthRecognition from '@cardstack/boxel-icons/health-recognition';
import LayoutGridPlusIcon from '@cardstack/boxel-icons/layout-grid-plus';
import ShipWheelIcon from '@cardstack/boxel-icons/ship-wheel';
import UsersIcon from '@cardstack/boxel-icons/users';
import WorldIcon from '@cardstack/boxel-icons/world';
import {
  Grid3x3 as GridIcon,
  Rows4 as StripIcon,
} from '@cardstack/boxel-ui/icons';
import {
  TabbedHeader,
  BoxelInput,
  ViewSelector,
  type ViewItem,
} from '@cardstack/boxel-ui/components';

import { Listing } from './listing/listing';
import { Category } from './listing/category';
import { Tag } from './listing/tag';

type ViewOption = 'strip' | 'grid';

// ShowcaseView
interface ShowcaseViewArgs {
  Args: {
    startHereListings?: CardDef[];
    newListings?: CardDef[];
    featuredListings?: CardDef[];
    context?: CardContext;
  };
  Element: HTMLElement;
}

class ShowcaseView extends GlimmerComponent<ShowcaseViewArgs> {
  <template>
    <header class='showcase-header'>
      <img
        src='https://boxel-images.boxel.ai/icons/icon_catalog_rounded.png'
        alt='Catalog Icon'
        class='catalog-icon'
      />
      <h1 class='showcase-header-title'>
        Cardstack Catalog: Discover & Remix the Best
      </h1>
    </header>

    <hr class='showcase-divider' />

    <div class='showcase-center-div' ...attributes>
      <div class='showcase-display-container'>
        <CardsDisplaySection class='showcase-cards-display'>
          <:intro>
            <h2 class='intro-title'>Starter stack — Begin Here</h2>
            <p class='intro-description'>These are the foundational tools we
              think every builder should have. Whether you're just exploring or
              setting up your workspace for serious work, start with these
              must-haves.</p>
          </:intro>
          <:content>
            <CardsIntancesGrid
              @cards={{@startHereListings}}
              @context={{@context}}
            />
          </:content>
        </CardsDisplaySection>

        <hr class='showcase-divider' />

        <CardsDisplaySection class='new-this-week-cards-display'>
          <:intro>
            <h2 class='intro-title'>Editor's Picks – What's Hot This Week</h2>
            <p class='intro-description'>These new entries have caught the
              community's eye, whether for creative flair, clever utility, or
              just plain polish.
            </p>
          </:intro>
          <:content>
            <CardsIntancesGrid @cards={{@newListings}} @context={{@context}} />
          </:content>
        </CardsDisplaySection>

        <hr class='showcase-divider' />

        <CardsDisplaySection class='featured-cards-display'>
          <:intro>
            <h2 class='intro-title'>Feature Collection – Personal Organization</h2>
            <p class='intro-description'>A hand-picked duo of focused, flexible
              tools for personal project management.</p>
          </:intro>
          <:content>
            <CardsIntancesGrid
              @cards={{@featuredListings}}
              @context={{@context}}
            />
          </:content>
        </CardsDisplaySection>
      </div>
    </div>

    <style scoped>
      .showcase-header {
        position: relative;
        overflow: hidden;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
      .catalog-icon {
        width: 2rem;
        height: 2rem;
        flex-shrink: 0;
      }
      .showcase-header-title {
        font-size: 1.5rem;
        font-weight: 600;
        line-height: 1.2;
        margin-block: 0;
      }

      .showcase-divider {
        border: none;
        height: 1px;
        background-color: #999999;
        margin: var(--boxel-sp-xl) 0;
      }

      .showcase-center-div {
        display: table;
        margin: 0 auto;
        width: 100%;
      }

      .showcase-display-container {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
        container-name: showcase-display-container;
        container-type: inline-size;
      }
      .showcase-cards-display :deep(.cards.grid-view),
      .featured-cards-display :deep(.cards.grid-view) {
        --grid-view-height: 380px;
        grid-template-columns: repeat(2, 1fr);
      }
      .new-this-week-cards-display :deep(.cards.grid-view) {
        --grid-view-height: 380px;
        grid-template-columns: repeat(4, 1fr);
      }

      .intro-title {
        font: 600 var(--boxel-font-lg);
        margin-block: 0;
        color: var(--boxel-dark);
      }
      .intro-description {
        font: 400 var(--boxel-font);
        color: var(--boxel-dark);
        margin-bottom: var(--boxel-sp-xl);
      }

      @container showcase-display-container (inline-size <= 768px) {
        .new-this-week-cards-display :deep(.cards.grid-view) {
          grid-template-columns: repeat(2, 1fr);
        }

        @container showcase-display-container (inline-size <= 500px) {
          .showcase-cards-display :deep(.cards.grid-view),
          .new-this-week-cards-display :deep(.cards.grid-view),
          .featured-cards-display :deep(.cards.grid-view) {
            grid-template-columns: 1fr;
          }
        }
      }
    </style>
  </template>
}

// CatalogListView
const CATALOG_VIEW_OPTIONS: ViewItem[] = [
  { id: 'strip', icon: StripIcon },
  { id: 'grid', icon: GridIcon },
];

interface CatalogListViewArgs {
  Args: {
    query: Query;
    realms: string[];
    context?: CardContext;
  };
  Element: HTMLElement;
}

class CatalogListView extends GlimmerComponent<CatalogListViewArgs> {
  @tracked private selectedView: ViewOption = 'grid';

  @action private onChangeView(id: ViewOption) {
    this.selectedView = id;
  }

  <template>
    <CardsDisplaySection ...attributes>
      <:intro>
        <header class='catalog-list-header'>
          <ViewSelector
            class='catalog-list-view-selector'
            @selectedId={{this.selectedView}}
            @onChange={{this.onChangeView}}
            @items={{CATALOG_VIEW_OPTIONS}}
          />
        </header>
      </:intro>
      <:content>
        <CardsGrid
          @query={{@query}}
          @realms={{@realms}}
          @selectedView={{this.selectedView}}
          @context={{@context}}
        />
      </:content>
    </CardsDisplaySection>

    <style scoped>
      h2 {
        margin-block: 0;
        margin-bottom: var(--boxel-sp);
      }
      .catalog-list-header {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--boxel-sp-sm);
        margin-bottom: var(--boxel-sp-sm);
      }
      .catalog-list-view-selector {
        margin-left: auto;
      }
    </style>
  </template>
}

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

  get categoryItems() {
    // Get all category instances from the database
    const categoryInstances = (this.categorySearch?.instances ??
      []) as Category[];

    if (!categoryInstances) {
      return [];
    }

    // Define sphere names as a union type for better type safety
    type SphereName = 'BUILD' | 'LEARN' | 'LIFE' | 'PLAY' | 'WORK';
    const sphereGroup: SphereName[] = [
      'BUILD',
      'LEARN',
      'LIFE',
      'PLAY',
      'WORK',
    ];
    // Define which icon to use for each sphere
    const sphereIconMap: Record<SphereName, typeof IconComponent> = {
      BUILD: BuildingIcon,
      LEARN: UsersIcon,
      LIFE: HealthRecognition,
      PLAY: WorldIcon,
      WORK: BuildingBank,
    };

    // Define the structure for sphere groups
    interface SphereGroupSignature {
      id: string;
      displayName: string;
      icon: typeof IconComponent;
      filters: CategoryFilterItemSignature[];
    }

    // Define the structure for category filter items
    interface CategoryFilterItemSignature {
      id: string;
      displayName: string;
      icon: typeof IconComponent;
      sphere?: string;
    }

    // Group categories by their sphere
    const categoriesGroupedBySphere: Record<string, SphereGroupSignature> = {};

    // Loop through each category and organize them by sphere
    for (const category of categoryInstances) {
      // Skip categories that aren't linked to a sphere
      if (!category.sphere?.name) {
        continue;
      }

      const sphereName = category.sphere.name;

      if (!categoriesGroupedBySphere[sphereName]) {
        categoriesGroupedBySphere[sphereName] = {
          id: sphereName.toLowerCase(),
          displayName: sphereName,
          icon: sphereIconMap[sphereName],
          filters: [],
        };
      }

      const categoryFilterItem: CategoryFilterItemSignature = {
        id: category.id,
        displayName: category.name,
        icon: CategoryIcon,
        sphere: sphereName,
      };

      categoriesGroupedBySphere[sphereName].filters.push(categoryFilterItem);
    }

    // Sort categories within each sphere group
    for (const sphereGroup of Object.values(categoriesGroupedBySphere)) {
      sphereGroup.filters.sort((a, b) =>
        a.displayName.localeCompare(b.displayName),
      );
    }

    // Create the final list with "All" button at the top
    // Sort categories by their display name
    const allCategoriesList: (
      | SphereGroupSignature
      | CategoryFilterItemSignature
    )[] = [
      {
        id: 'all',
        displayName: 'All',
        icon: LayoutGridPlusIcon,
      },
      ...Object.values(categoriesGroupedBySphere).sort((a, b) =>
        a.displayName.localeCompare(b.displayName),
      ),
    ];

    return allCategoriesList;
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
      this.activeCategory.filters && this.activeCategory.filters.length > 0;

    if (isSphereSelected) {
      const categoryIdsInSphere = this.activeCategory.filters.map(
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
        eq: {
          'categories.id': this.activeCategory.id,
        },
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

  get tagItems() {
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
    <CatalogLayout class='catalog-layout {{this.activeTabId}}'>
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
                  <CatalogListView
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
      .instance-error {
        position: relative;
      }
      .instance-error::after {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(255, 0, 0, 0.1);
      }
      .instance-error .boundaries {
        box-shadow: 0 0 0 1px var(--boxel-error-300);
      }
      .instance-error:hover .boundaries {
        box-shadow: 0 0 0 1px var(--boxel-dark);
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
