import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';

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

import {
  FilterCategoryGroup,
  FilterTagGroup,
  FilterSearch,
  type FilterItem,
} from './components/filter-section';
import CardsDisplaySection, {
  CardsIntancesGrid,
} from './components/cards-display-section';

import { CardsGrid } from '../components/grid';

import CatalogLayout from './layouts/catalog-layout';

import LayoutGridPlusIcon from '@cardstack/boxel-icons/layout-grid-plus';
import {
  Grid3x3 as GridIcon,
  Rows4 as StripIcon,
} from '@cardstack/boxel-ui/icons';
import {
  TabbedHeader,
  BoxelButton,
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
    <div class='showcase-display-container' ...attributes>
      <CardsDisplaySection class='showcase-cards-display'>
        <:intro>
          <div class='intro-title'>
            <h2>Start Here</h2>
            <p>The starter stack — Install these first</p>
          </div>
          <p class='intro-description'>These are the foundational tools we think
            every builder should have. Whether you're just exploring or setting
            up your workspace for serious work, start with these must-haves.</p>
        </:intro>
        <:content>
          <CardsIntancesGrid
            @cards={{@startHereListings}}
            @context={{@context}}
          />
        </:content>
      </CardsDisplaySection>

      <CardsDisplaySection class='new-this-week-cards-display'>
        <:intro>
          <div class='intro-title'>
            <h2>New this Week</h2>
            <p>Hand-picked by our editors — What's buzzing right now</p>
          </div>
          <p class='intro-description'>These new entries have caught the
            community's eye, whether for creative flair, clever utility, or just
            plain polish.</p>
        </:intro>
        <:content>
          <CardsIntancesGrid @cards={{@newListings}} @context={{@context}} />
        </:content>
      </CardsDisplaySection>

      <CardsDisplaySection class='featured-cards-display'>
        <:intro>
          <div class='intro-title'>
            <h2>Feature Collection</h2>
            <p>:Personal Organization</p>
          </div>
          <p class='intro-description'>A hand-picked duo of focused, flexible
            tools for personal</p>
        </:intro>
        <:content>
          <CardsIntancesGrid
            @cards={{@featuredListings}}
            @context={{@context}}
          />
        </:content>
      </CardsDisplaySection>
    </div>

    <style scoped>
      h2,
      p {
        margin-block: 0;
        margin-bottom: var(--boxel-sp);
      }
      .showcase-display-container {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xxxl);
        container-name: showcase-display-container;
        container-type: inline-size;
      }
      .showcase-cards-display :deep(.cards),
      .featured-cards-display :deep(.cards) {
        --grid-view-height: 390px;
        grid-template-columns: repeat(2, 1fr);
      }
      .new-this-week-cards-display :deep(.cards) {
        --grid-view-height: 270px;
        grid-template-columns: repeat(4, 1fr);
      }

      .intro-title {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--boxel-sp-sm);
      }
      .intro-title h2 {
        font: 700 var(--boxel-font-xl);
      }
      .intro-title p {
        font: var(--boxel-font-lg);
        font-style: italic;
      }
      .intro-description {
        font: var(--boxel-font);
      }

      @container showcase-display-container (inline-size <= 768px) {
        .new-this-week-cards-display :deep(.cards) {
          grid-template-columns: repeat(2, 1fr);
        }

        @container showcase-display-container (inline-size <= 500px) {
          .showcase-cards-display :deep(.cards),
          .new-this-week-cards-display :deep(.cards),
          .featured-cards-display :deep(.cards) {
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
    realms: URL[];
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
    <CardsDisplaySection>
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

  @tracked activeCategoryId = 'all';

  @action
  handleCategorySelect(category: { id: string; name: string }) {
    this.activeCategoryId = category.id;
  }

  // TODO: Remove this after we get the real tags from query
  mockTags = [
    { id: 'ai', name: 'AI' },
    { id: 'bundled', name: 'Bundled' },
    { id: 'official', name: 'Official' },
    { id: 'userContributed', name: 'User Contributed' },
    { id: 'solo', name: 'Solo' },
  ];

  @tracked activeTagIds: string[] = [];

  @action
  handleTagSelect(item: FilterItem) {
    if (this.activeTagIds.includes(item.id)) {
      this.activeTagIds = this.activeTagIds.filter((id) => id !== item.id);
    } else {
      this.activeTagIds = [...this.activeTagIds, item.id];
    }
  }

  // Filter Search
  @tracked searchValue: string = '';

  @action
  handleSearch(value: string) {
    this.searchValue = value;
  }

  //query
  get query(): Query {
    return {
      filter: {
        on: {
          module: new URL('./listing/listing', import.meta.url).href,
          name: `${capitalize(this.activeTabId)}Listing`,
        },
        every: [this.categoryFilter, this.tagFilter, this.searchFilter].filter(
          Boolean,
        ) as Filter[],
      },
    };
  }

  // Category filter
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
    let instances = (this.categorySearch?.instances ?? []) as Category[];
    if (!instances) {
      return [];
    }
    return [
      { id: 'all', name: 'All' },
      ...instances.map((instance) => ({
        id: instance.id,
        name: instance.name,
      })),
    ];
  }

  get categoryFilter(): EqFilter | undefined {
    if (this.activeCategoryId === 'all') {
      return;
    }
    return {
      eq: {
        'categories.id': this.activeCategoryId,
      },
    };
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
      name: instance.name,
    }));
  }

  get tagFilter(): AnyFilter | undefined {
    if (this.activeTagIds.length === 0) {
      return;
    }
    return {
      any: this.activeTagIds.map((id) => ({
        eq: {
          'tags.id': id,
        },
      })),
    };
  }

  get searchFilter(): AnyFilter | undefined {
    if (!this.searchValue) {
      return;
    }
    return {
      any: [{ contains: { title: this.searchValue } }],
    };
  }

  // end of listing query filter values

  @action viewGrid() {
    if (!this.args.context?.actions?.viewCard) {
      throw new Error('viewCard action is not available');
    }
    let gridUrl = new URL('grid.json', this.args.model[realmURL]!.href);
    this.args.context?.actions?.viewCard(gridUrl);
  }

  get shouldShowTab() {
    return (tabId: string) => {
      return this.activeTabId === tabId;
    };
  }

  get shouldShowSidebar() {
    return !this.shouldShowTab('showcase');
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
    <TabbedHeader
      @tabs={{this.tabFilterOptions}}
      @setActiveTab={{this.setActiveTab}}
      @activeTabId={{this.activeTabId}}
      @headerBackgroundColor={{this.headerColor}}
      class='catalog-tab-header'
    />

    <CatalogLayout
      @showSidebar={{this.shouldShowSidebar}}
      class='catalog-layout {{this.activeTabId}}'
    >
      <:sidebar>
        <div class='sidebar-content'>
          <BoxelButton
            class='go-to-grid'
            @kind='primary'
            {{on 'click' this.viewGrid}}
          >
            View Grid
          </BoxelButton>

          <div
            role='complementary'
            aria-label='Filters'
            class='filters-container info-box'
          >
            <FilterCategoryGroup
              @title='Categories'
              @items={{this.categoryItems}}
              @activeId={{this.activeCategoryId}}
              @onItemSelect={{this.handleCategorySelect}}
              @isLoading={{this.categorySearch.isLoading}}
            />
            <FilterSearch
              @title='Search'
              @placeholder='Enter Keywords'
              @searchValue={{this.searchValue}}
              @onSearch={{this.handleSearch}}
            />
            <FilterTagGroup
              @title='Tags'
              @items={{this.tagItems}}
              @activeIds={{this.activeTagIds}}
              @onItemSelect={{this.handleTagSelect}}
              @isLoading={{this.tagSearch.isLoading}}
            />
          </div>
        </div>
      </:sidebar>
      <:content>
        <div class='content-area-container {{this.activeTabId}}'>
          <div class='content-area'>
            <div class='catalog-content'>
              <div class='catalog-listing info-box'>
                {{#if (this.shouldShowTab 'showcase')}}
                  <ShowcaseView
                    @startHereListings={{@model.startHere}}
                    @newListings={{@model.new}}
                    @featuredListings={{@model.featured}}
                    @context={{@context}}
                  />
                {{else}}
                  <CatalogListView
                    @query={{this.query}}
                    @realms={{this.realms}}
                    @context={{@context}}
                  />
                {{/if}}
              </div>
            </div>
          </div>
        </div>
      </:content>
    </CatalogLayout>

    <style scoped>
      :global(:root) {
        --catalog-layout-padding-top: var(--boxel-sp-lg);
      }
      .catalog-tab-header :deep(.app-title-group) {
        display: none;
      }

      .info-box {
        width: 100%;
        height: auto;
        border-radius: var(--boxel-border-radius);
        background-color: var(--boxel-light);
      }

      /* Layout */
      .catalog-layout {
        --layout-container-background-color: var(--boxel-100);
        --layout-sidebar-background-color: var(--boxel-100);
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
      .content-area-container.showcase {
        max-width: 800px;
        margin: 0 auto;
      }

      .content-area {
        height: 100%;
        display: grid;
        gap: var(--boxel-sp-lg);
      }
      .catalog-content {
        display: block;
        overflow-y: auto;
      }
      .catalog-listing {
        background-color: transparent;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xxl);
      }

      /* Sidebar */
      .filters-container {
        background-color: transparent;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
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
  static headerColor = '#00ebac';
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
