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
import { Query, isCardInstance, Filter } from '@cardstack/runtime-common';
import StringField from 'https://cardstack.com/base/string';
import GlimmerComponent from '@glimmer/component';

import { FilterCategoryGroup } from './components/filter-section';
import CardsDisplaySection, {
  CardsIntancesGrid,
} from './components/cards-display-section';

import ContentContainer from './components/content-container';

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
            every builder should have. Whether you’re just exploring or setting
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
            <p>Hand-picked by our editors — What’s buzzing right now</p>
          </div>
          <p class='intro-description'>These new entries have caught the
            community’s eye, whether for creative flair, clever utility, or just
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
    pageTitle?: string;
    listingQuery: Query;
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
          <h2>{{@pageTitle}}</h2>
          <ViewSelector
            @selectedId={{this.selectedView}}
            @onChange={{this.onChangeView}}
            @items={{CATALOG_VIEW_OPTIONS}}
          />
        </header>
      </:intro>
      <:content>
        <CardsGrid
          @query={{@listingQuery}}
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

  // listing query filter values
  // TODO: Remove this after we get the real categories from query
  mockCategories = [
    { id: 'all', name: 'All' },
    { id: 'business', name: 'Business' },
    { id: 'accounting', name: 'Accounting' },
    { id: 'collaboration', name: 'Collaboration' },
  ];

  @tracked activeCategoryId = this.mockCategories[0].id;

  @action
  handleCategorySelect(category: { id: string; name: string }) {
    this.activeCategoryId = category.id;
    this.updateFilter('categories', category.name);
  }

  @action
  updateFilter(filterType: string, value: any) {
    // TODO: Update the query based on the filterType and value
    console.log('filterType', filterType);
    console.log('value', value);
  }

  get listingQuery(): Query {
    const listingTypeRef = {
      module: new URL('./listing/listing', import.meta.url).href,
      name: 'Listing',
    };

    const baseFilter: Filter = {
      on: listingTypeRef,
      eq: {
        listingType: this.activeTabId,
      },
    };

    return {
      filter: {
        on: listingTypeRef,
        every: [baseFilter],
      },
    };
  }
  // end of listing query filter values

  // TODO: Remove this after testing
  @action goToGrid() {
    if (!this.args.context?.actions?.viewCard) {
      throw new Error('viewCard action is not available');
    }
    let gridUrl = new URL('http://localhost:4201/catalog/grid.json');
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

  get startHereListings() {
    return this.args.model.startHere;
  }

  get newListings() {
    return this.args.model.new;
  }

  get featuredListings() {
    return this.args.model.featured;
  }

  private get realms() {
    return [this.args.model[realmURL]!];
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
        <BoxelButton
          class='go-to-grid'
          @kind='primary'
          {{on 'click' this.goToGrid}}
        >
          Go to Grid
        </BoxelButton>

        <ContentContainer
          role='complementary'
          aria-label='Filters'
          class='filters-container'
        >
          <FilterCategoryGroup
            @title='Categories'
            @items={{this.mockCategories}}
            @activeId={{this.activeCategoryId}}
            @onItemSelect={{this.handleCategorySelect}}
          />
        </ContentContainer>
      </:sidebar>
      <:content>
        <div class='content-area-container {{this.activeTabId}}'>
          <div class='content-area'>
            <div class='catalog-content'>
              <ContentContainer class='catalog-listing'>
                {{#if (this.shouldShowTab 'showcase')}}
                  <ShowcaseView
                    @startHereListings={{this.startHereListings}}
                    @newListings={{this.newListings}}
                    @featuredListings={{this.featuredListings}}
                    @context={{@context}}
                  />
                {{else}}
                  <CatalogListView
                    @pageTitle='Product List'
                    @listingQuery={{this.listingQuery}}
                    @realms={{this.realms}}
                    @context={{@context}}
                  />
                {{/if}}
              </ContentContainer>
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
      .title {
        font: bold var(--boxel-font-lg);
        line-height: 1.58;
        letter-spacing: 0.21px;
      }

      /* Layout */
      .catalog-layout {
        --layout-container-background-color: var(--boxel-100);
        --layout-sidebar-background-color: var(--boxel-100);
        --layout-content-padding: var(--boxel-sp-xl);
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
        --content-container-background-color: transparent;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xxl);
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
