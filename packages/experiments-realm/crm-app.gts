import { SidebarFilter } from './app-helpers/filter';
import { SidebarLayout } from './app-helpers/sidebar-layout';
import { Tab } from './app-helpers/tabs';
import { CardsGrid } from './app-helpers/grid';
import {
  SortMenu,
  SortOption,
  SORT_OPTIONS,
  sortByCardTitle,
} from './app-helpers/sort';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { eq } from '@cardstack/boxel-ui/helpers';
import { tracked } from '@glimmer/tracking';
import { restartableTask } from 'ember-concurrency';
import { TrackedMap } from 'tracked-built-ins';

import { Component, realmURL } from 'https://cardstack.com/base/card-api';

import {
  BoxelButton,
  TabbedHeader,
  BoxelInput,
  ViewSelector,
} from '@cardstack/boxel-ui/components';
import { IconPlus } from '@cardstack/boxel-ui/icons';
// @ts-expect-error path resolution issue
import { AppCard } from '/catalog/app-card';
import {
  Query,
  CardError,
  SupportedMimeType,
  codeRefWithAbsoluteURL,
} from '@cardstack/runtime-common';
import type Owner from '@ember/owner';
import ContactIcon from '@cardstack/boxel-icons/contact';
import HeartHandshakeIcon from '@cardstack/boxel-icons/heart-handshake';
import TargetArrowIcon from '@cardstack/boxel-icons/target-arrow';

type ViewOption = 'card' | 'strip' | 'grid';

const CONTACT_FILTERS: SidebarFilter[] = [
  {
    displayName: 'All Contacts',
    icon: ContactIcon,
    cardTypeName: 'CRM Contact',
    createNewButtonText: 'Create Contact',
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
const DEAL_FILTERS: SidebarFilter[] = [
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
  filterMap: TrackedMap<string, SidebarFilter[]> = new TrackedMap();
  @tracked private activeFilter: SidebarFilter | undefined;
  @action private onFilterChange(filter: SidebarFilter) {
    this.activeFilter = filter;
  }
  //sort
  sortOptions = SORT_OPTIONS;
  //tabs
  @tracked activeTabId?: string = this.args.model.tabs?.[0]?.tabId;
  @tracked tabs = this.args.model.tabs ?? [];
  @tracked private selectedView: ViewOption = 'card';
  @tracked private selectedSort: SortOption = this.sortOptions[0];

  constructor(owner: Owner, args: any) {
    super(owner, args);
    this.filterMap.set('Contact', CONTACT_FILTERS);
    this.filterMap.set('Deal', DEAL_FILTERS);
    this.loadAllFilters.perform();
    this.setActiveFilter();
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
    if (this.activeTabId) {
      return this.filterMap.get(this.activeTabId) ?? [];
    }
    return [];
  }

  @action setActiveFilter() {
    if (this.activeTabId) {
      this.activeFilter = this.filterMap.get(this.activeTabId)?.[0];
    }
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

  //query for tabs and filters
  get query() {
    if (this.loadAllFilters.isIdle && this.activeFilter?.query) {
      return {
        filter: {
          type: this.activeFilter.cardRef,
        },
        sort: this.selectedSort?.sort ?? sortByCardTitle,
      } as Query;
    }
    return;
  }

  @action private onChangeView(id: ViewOption) {
    this.selectedView = id;
  }
  @action private onSort(option: SortOption) {
    this.selectedSort = option;
    this.activeFilter = this.activeFilter;
  }

  <template>
    <TabbedHeader
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

    <SidebarLayout
      @filters={{this.filters}}
      @activeFilter={{this.activeFilter}}
      @onFilterChange={{this.onFilterChange}}
    >
      <:sidebar-header>
        <img
          class='sidebar-header-thumbnail'
          src={{@model.thumbnailURL}}
          width='60'
          height='60'
          alt={{@model.title}}
        />
        <h1 class='sidebar-header-title'><@fields.title /></h1>
        <p class='sidebar-header-description'><@fields.description /></p>
      </:sidebar-header>
      <:content-header>
        <this.activeFilter.icon />
        <h2 class='content-title'>{{this.activeFilter.displayName}}</h2>
        {{#if @context.actions.createCard}}
          <BoxelButton
            class='sidebar-create-button'
            @kind='primary'
            @size='large'
            @disabled={{this.activeFilter.isCreateNewDisabled}}
            @loading={{this.createCard.isRunning}}
            {{on 'click' this.createNew}}
          >
            {{#unless this.createCard.isRunning}}
              <IconPlus
                class='sidebar-create-button-icon'
                width='15'
                height='15'
              />
            {{/unless}}
            {{this.activeFilter.createNewButtonText}}
          </BoxelButton>
        {{/if}}
      </:content-header>
      <:content-subheader>
        <div>
          <BoxelInput @type='search' />
        </div>
        <div class='crm-content-subheader-actions'>
          <ViewSelector
            @selectedId={{this.selectedView}}
            @onChange={{this.onChangeView}}
          />
          <SortMenu
            @options={{this.sortOptions}}
            @selected={{this.selectedSort}}
            @onSort={{this.onSort}}
          />
        </div>
      </:content-subheader>
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
    </SidebarLayout>
    <style scoped>
      .crm-app {
        display: flex;
        width: 100%;
        max-width: 100%;
        height: 100%;
        max-height: 100vh;
        background-color: var(--boxel-light);
        border-top: 1px solid var(--boxel-400);
        overflow: hidden;
      }
      .content-title {
        flex-grow: 1;
        margin: 0;
        font: 600 var(--boxel-font-lg);
        letter-spacing: var(--boxel-lsp-xxs);
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
        --boxel-loading-indicator-size: 15px;
        gap: var(--boxel-sp-xs);
        font-weight: 600;
      }
      .sidebar-create-button-icon {
        flex-shrink: 0;
      }
      .sidebar-create-button :deep(.loading-indicator) {
        margin: 0;
      }
      /* Content subheader */
      .crm-content-subheader-actions {
        display: flex;
        gap: var(--boxel-sp-xxxl);
        align-items: center;
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
