import { CardsGrid } from './components/grid';
import { Layout, TitleGroup, type LayoutFilter } from './components/layout';
import {
  SortMenu,
  type SortOption,
  sortByCardTitleAsc,
} from './components/sort';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import type Owner from '@ember/owner';
import { tracked } from '@glimmer/tracking';
import { TrackedMap } from 'tracked-built-ins';
import { restartableTask } from 'ember-concurrency';

import { Component, realmURL } from 'https://cardstack.com/base/card-api';

import { eq } from '@cardstack/boxel-ui/helpers';
import {
  BoxelButton,
  TabbedHeader,
  BoxelInput,
  ViewSelector,
} from '@cardstack/boxel-ui/components';
import { IconPlus } from '@cardstack/boxel-ui/icons';
// @ts-expect-error path resolution issue
import { AppCard, Tab } from '/catalog/app-card';
import {
  Query,
  CardError,
  SupportedMimeType,
  codeRefWithAbsoluteURL,
} from '@cardstack/runtime-common';
import ContactIcon from '@cardstack/boxel-icons/contact';
import HeartHandshakeIcon from '@cardstack/boxel-icons/heart-handshake';
import TargetArrowIcon from '@cardstack/boxel-icons/target-arrow';

type ViewOption = 'card' | 'strip' | 'grid';

const CONTACT_FILTERS: LayoutFilter[] = [
  {
    displayName: 'All Contacts',
    icon: ContactIcon,
    cardTypeName: 'CRM Contact',
    createNewButtonText: 'Create Contact',
    sortOptions: [
      {
        id: 'cardTitleAsc',
        displayName: 'A-Z',
        sort: sortByCardTitleAsc,
      },
    ],
  },
  {
    displayName: 'Leads',
    icon: TargetArrowIcon,
    cardTypeName: 'CRM Lead',
    createNewButtonText: 'Create Lead',
  },
  {
    displayName: 'Customers',
    icon: HeartHandshakeIcon,
    cardTypeName: 'CRM Customer',
    createNewButtonText: 'Create Customer',
  },
];
const DEAL_FILTERS: LayoutFilter[] = [
  {
    displayName: 'All Deals',
    icon: ContactIcon,
    cardTypeName: 'CRM Deal',
    createNewButtonText: 'Create Deal',
  },
];

// need to use as typeof AppCard rather than CrmApp otherwise tons of lint errors
class CrmAppTemplate extends Component<typeof AppCard> {
  //filters
  filterMap: TrackedMap<string, LayoutFilter[]> = new TrackedMap([
    ['Contact', CONTACT_FILTERS],
    ['Deal', DEAL_FILTERS],
  ]);
  @tracked private activeFilter: LayoutFilter = CONTACT_FILTERS[0];
  @action private onFilterChange(filter: LayoutFilter) {
    this.activeFilter = filter;
  }
  //tabs
  @tracked activeTabId: string = this.args.model.tabs[0].tabId;
  @tracked tabs = this.args.model.tabs;
  @tracked private selectedView: ViewOption = 'card';

  constructor(owner: Owner, args: any) {
    super(owner, args);
    this.loadAllFilters.perform();
  }

  private loadAllFilters = restartableTask(async () => {
    let url = `${this.realms[0]}_types`;
    let response = await fetch(url, {
      headers: {
        Accept: SupportedMimeType.CardTypeSummary,
      },
    });
    if (!response.ok) {
      let err = await CardError.fromFetchResponse(url, response);
      throw err;
    }
    let cardTypeSummaries = (await response.json()).data as {
      id: string;
      attributes: { displayName: string; total: number };
    }[];

    for (let tab of this.tabs) {
      let filters = this.filterMap.get(tab.tabId);
      if (filters) {
        for (let filter of filters) {
          let summary = cardTypeSummaries.find(
            (s) => s.attributes.displayName === filter.cardTypeName,
          );
          if (!summary) {
            return;
          }
          const lastIndex = summary.id.lastIndexOf('/');
          let cardRef = {
            module: summary.id.substring(0, lastIndex),
            name: summary.id.substring(lastIndex + 1),
          };
          filter.cardRef = cardRef;
          filter.query = { filter: { type: cardRef } };
          this.filterMap.set(tab.tabId, filters);
        }
      }
    }
  });

  get filters() {
    return this.filterMap.get(this.activeTabId)!;
  }

  @action setActiveFilter() {
    this.activeFilter = this.filterMap.get(this.activeTabId)![0];
  }

  //Tabs
  @action setActiveTab(id: string) {
    this.activeTabId = id;
    this.setActiveFilter();
  }
  get headerColor() {
    return (
      Object.getPrototypeOf(this.args.model).constructor.headerColor ??
      undefined
    );
  }
  get activeTab() {
    return (
      this.tabs.find((t: Tab) => t.tabId === this.activeTabId) ?? this.tabs[0]
    );
  }

  get activeTabRef() {
    if (!this.activeTab?.ref?.name || !this.activeTab.ref.module) {
      return;
    }
    if (!this.currentRealm) {
      return;
    }
    return codeRefWithAbsoluteURL(this.activeTab.ref, this.currentRealm);
  }
  setTabs(tabs: Tab[]) {
    this.args.model.tabs = tabs ?? [];
  }

  //misc
  get currentRealm() {
    return this.args.model[realmURL];
  }
  private get realms() {
    return [this.currentRealm!];
  }

  //create
  @action private createNew() {
    this.createCard.perform();
  }

  private createCard = restartableTask(async () => {
    let ref = this.activeFilter?.cardRef;
    if (!ref) {
      return;
    }
    let currentRealm = this.realms[0];
    await this.args.context?.actions?.createCard?.(ref, currentRealm, {
      realmURL: currentRealm,
    });
  });

  private get selectedSort() {
    if (!this.activeFilter.sortOptions?.length) {
      return;
    }
    return this.activeFilter.selectedSort ?? this.activeFilter.sortOptions[0];
  }

  //query for tabs and filters
  get query() {
    if (this.loadAllFilters.isIdle && this.activeFilter?.query) {
      return {
        filter: {
          type: this.activeFilter.cardRef,
        },
        sort: this.selectedSort?.sort ?? sortByCardTitleAsc,
      } as Query;
    }
    return;
  }

  @action private onChangeView(id: ViewOption) {
    this.selectedView = id;
  }
  @action private onSort(option: SortOption) {
    this.activeFilter.selectedSort = option;
    this.activeFilter = this.activeFilter;
  }

  <template>
    <TabbedHeader
      class='crm-app-header'
      @tabs={{@model.tabs}}
      @setActiveTab={{this.setActiveTab}}
      @activeTabId={{this.activeTab.tabId}}
      @headerBackgroundColor={{this.headerColor}}
    >
      <:headerIcon>
        {{#if @model.headerIcon.base64}}
          <@fields.headerIcon />
        {{/if}}
      </:headerIcon>
    </TabbedHeader>

    <Layout
      class='crm-app'
      @filters={{this.filters}}
      @activeFilter={{this.activeFilter}}
      @onFilterChange={{this.onFilterChange}}
    >
      <:sidebar>
        <TitleGroup
          @title={{@model.title}}
          @tagline={{@model.description}}
          @thumbnailURL={{@model.thumbnailURL}}
          @element='header'
          aria-label='Sidebar Header'
        />
      </:sidebar>
      <:contentHeader>
        <h2 class='content-title content-header-row-1'>
          <this.activeFilter.icon
            class='content-title-icon'
            width='35'
            height='35'
          />
          {{this.activeFilter.displayName}}
        </h2>
        {{#if @context.actions.createCard}}
          <BoxelButton
            class='sidebar-create-button content-header-row-1'
            @kind='primary'
            @size='large'
            @disabled={{this.activeFilter.isCreateNewDisabled}}
            @loading={{this.createCard.isRunning}}
            {{on 'click' this.createNew}}
          >
            {{#unless this.createCard.isRunning}}
              <IconPlus
                class='sidebar-create-button-icon'
                width='13'
                height='13'
              />
            {{/unless}}
            {{this.activeFilter.createNewButtonText}}
          </BoxelButton>
        {{/if}}
        <div class='search-bar content-header-row-2'>
          <BoxelInput @type='search' />
        </div>
        <ViewSelector
          class='view-menu content-header-row-2'
          @selectedId={{this.selectedView}}
          @onChange={{this.onChangeView}}
        />
        {{#if this.activeFilter.sortOptions.length}}
          {{#if this.selectedSort}}
            <SortMenu
              class='content-header-row-2'
              @options={{this.activeFilter.sortOptions}}
              @selected={{this.selectedSort}}
              @onSort={{this.onSort}}
            />
          {{/if}}
        {{/if}}
      </:contentHeader>
      <:grid>
        {{#if this.query}}
          <CardsGrid
            @query={{this.query}}
            @realms={{this.realms}}
            @selectedView={{this.selectedView}}
            @context={{@context}}
            @format={{if (eq this.selectedView 'card') 'embedded' 'fitted'}}
          />
        {{/if}}
      </:grid>
    </Layout>
    <style scoped>
      /* hide overlay button visibility during scroll */
      .crm-app-header {
        position: relative;
        z-index: 1;
      }
      .crm-app-header :deep(.app-title-group) {
        display: none;
      }
      .crm-app {
        --create-button-width: 172px;
        --create-button-height: 40px;
        --search-bar-max-width: 395px;
        display: flex;
        width: 100%;
        max-width: 100%;
        height: 100%;
        max-height: 100vh;
        background-color: var(--boxel-light);
        overflow: hidden;
      }
      .content-header-row-1 {
        margin-top: var(--boxel-sp-xs);
      }
      .content-header-row-2 {
        margin-top: var(--boxel-sp-lg);
      }
      .content-title {
        flex-grow: 1;
        width: calc(100% - var(--boxel-sp-lg) - var(--create-button-width));
        min-width: 50%;
        margin-bottom: 0;
        font: 600 var(--boxel-font-lg);
        font-size: 1.5rem;
        letter-spacing: var(--boxel-lsp-xs);
      }
      .content-title-icon {
        vertical-align: bottom;
        margin-right: var(--boxel-sp-4xs);
      }
      /* Sidebar header */
      .sidebar-header-thumbnail {
        grid-row: 1 / 3;
        padding: var(--boxel-sp-6xs);
        border: 1px solid var(--boxel-450);
        border-radius: var(--boxel-border-radius-xl);
      }
      .sidebar-header-title {
        align-self: end;
        margin: 0;
        font: 600 var(--boxel-font);
        letter-spacing: var(--boxel-lsp-xs);
      }
      .sidebar-header-description {
        grid-column: 2;
        margin: 0;
        font: var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
      }
      /* Create button */
      .sidebar-create-button {
        --icon-color: currentColor;
        --boxel-loading-indicator-size: 13px;
        --boxel-button-min-height: var(--create-button-height);
        --boxel-button-min-width: var(--create-button-width);
        gap: var(--boxel-sp-xs);
        font-weight: 600;
      }
      .sidebar-create-button-icon {
        flex-shrink: 0;
      }
      .sidebar-create-button :deep(.loading-indicator) {
        margin: 0;
      }
      /* Content header */
      .search-bar {
        flex-grow: 1;
        max-width: var(--search-bar-max-width);
      }
      .view-menu {
        margin-left: auto;
      }
    </style>
  </template>
}

export class CrmApp extends AppCard {
  static displayName = 'Crm App';
  static prefersWideFormat = true;
  static headerColor = '#4D3FE8';
  static isolated = CrmAppTemplate;
}
