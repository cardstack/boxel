import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';

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
import { isCardInstance, Query } from '@cardstack/runtime-common';
import StringField from 'https://cardstack.com/base/string';

import FilterSection from './components/filter-section';
import CardsDisplaySection from './components/cards-display-section';
import ContentContainer from './components/content-container';

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
import { CardsGrid } from '../components/grid';

type ViewOption = 'card' | 'strip' | 'grid';

const CATALOG_VIEW_OPTIONS: ViewItem[] = [
  { id: 'strip', icon: StripIcon },
  { id: 'grid', icon: GridIcon },
];

class Isolated extends Component<typeof Catalog> {
  mockShowcaseCards = [
    {
      name: 'Blog Post App',
    },
    {
      name: 'Black Jack',
    },
  ];

  mockNewToThisWeekCards = [
    {
      name: 'Basic CV',
    },
    {
      name: 'Daily Feed',
    },
    { name: 'Card 3' },
    { name: 'Card 4' },
    { name: 'Card 5' },
    { name: 'Card 6' },
    { name: 'Card 7' },
    { name: 'Card 8' },
  ];
  mockFeaturedCards = [
    {
      name: 'Sprint Tracker',
    },
    {
      name: 'Todo List',
    },
  ];
  mockCards = [
    { name: 'Card 1' },
    { name: 'Card 2' },
    { name: 'Card 3' },
    { name: 'Card 4' },
  ];

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
      tabId: 'skills',
      displayName: 'Skills',
    },
  ];

  @tracked activeTabId: string = this.tabFilterOptions[0].tabId;
  @tracked private selectedView: ViewOption = 'grid';

  @action
  setActiveTab(tabId: string) {
    this.activeTabId = tabId;
  }

  @action private onChangeView(id: ViewOption) {
    this.selectedView = id;
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

  // TODO: Remove this after testing
  @action goToGrid() {
    if (!this.args.context?.actions?.viewCard) {
      throw new Error('viewCard action is not available');
    }
    let gridUrl = new URL('http://localhost:4201/catalog/grid.json');
    this.args.context?.actions?.viewCard(gridUrl);
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

  get listingQuery() {
    return {
      filter: {
        on: {
          module: new URL('./listing/listing', import.meta.url).href,
          name: 'Listing',
        },
        eq: {
          listingType: this.activeTabId,
        },
      },
    };
  }

  get tabTitle() {
    return this.tabFilterOptions.find((tab) => tab.tabId === this.activeTabId)
      ?.displayName;
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
        <FilterSection />
      </:sidebar>
      <:content>
        {{! Note: Content will be display 2 columns: Content Listing Display and Related Listing Cards in the same time }}
        <div class='content-area-container {{this.activeTabId}}'>
          <div class='content-area'>
            {{! Column 1: Card Listing Section }}
            <div class='catalog-content'>
              <ContentContainer class='catalog-listing'>
                {{#if (this.shouldShowTab 'showcase')}}
                  <CardsDisplaySection
                    @cards={{this.startHereListings}}
                    @context={{@context}}
                    class='showcase-cards-display'
                  >
                    <:intro>
                      <div class='intro-title'>
                        <h2>Start Here</h2>
                        <p>The starter stack — Install these first</p>
                      </div>
                      <p class='intro-description'>These are the foundational
                        tools we think every builder should have. Whether you’re
                        just exploring or setting up your workspace for serious
                        work, start with these must-haves.</p>
                    </:intro>
                  </CardsDisplaySection>

                  <CardsDisplaySection
                    @cards={{this.newListings}}
                    @context={{@context}}
                  >
                    <:intro>
                      <div class='intro-title'>
                        <h2>New this Week</h2>
                        <p>Hand-picked by our editors — What’s buzzing right now</p>
                      </div>
                      <p class='intro-description'>These new entries have caught
                        the community’s eye, whether for creative flair, clever
                        utility, or just plain polish.</p>
                    </:intro>
                  </CardsDisplaySection>

                  <CardsDisplaySection
                    @cards={{this.featuredListings}}
                    @context={{@context}}
                    class='featured-cards-display'
                  >
                    <:intro>
                      <div class='intro-title'>
                        <h2>Feature Collection</h2>
                        <p>:Personal Organization</p>
                      </div>
                      <p class='intro-description'>A hand-picked duo of focused,
                        flexible tools for personal</p>
                    </:intro>
                  </CardsDisplaySection>
                {{else}}
                  <ViewSelector
                    @selectedId={{this.selectedView}}
                    @onChange={{this.onChangeView}}
                    @items={{CATALOG_VIEW_OPTIONS}}
                  />

                  <CardsDisplaySection @title={{this.tabTitle}}>
                    <:content>
                      <CardsGrid
                        @query={{this.listingQuery}}
                        @realms={{this.realms}}
                        @selectedView={{this.selectedView}}
                        @context={{@context}}
                      />
                    </:content>
                  </CardsDisplaySection>
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

      /* Mock data display */
      .showcase-cards-display :deep(.cards),
      .featured-cards-display :deep(.cards) {
        --grid-view-height: 390px;
        grid-template-columns: 1fr 1fr;
      }

      h2,
      p {
        margin-block: 0;
        margin-bottom: var(--boxel-sp);
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
      /* End of Mock data display */

      .related-card-listing {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
      }
      .listing-title {
        margin: 0;
        padding: var(--boxel-sp-sm);
        font-weight: 600;
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

      @container content-area-container (inline-size <= 768px) {
        .content-area {
          grid-template-columns: 1fr;
          overflow-y: auto;
        }
        .catalog-content {
          overflow-y: unset;
        }
      }

      @container content-area-container (inline-size <= 500px) {
        .showcase-cards-display :deep(.cards),
        .featured-cards-display :deep(.cards) {
          grid-template-columns: 1fr;
        }
      }

      .go-to-grid {
        font-weight: 600;
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
