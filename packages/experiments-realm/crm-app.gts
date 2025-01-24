import { CardsGrid } from './components/grid';
import { CardList } from './components/card-list';
import { Layout, TitleGroup, type LayoutFilter } from './components/layout';
import {
  SortMenu,
  type SortOption,
  sortByCardTitleAsc,
} from './components/sort';
import { SearchInput } from './components/search-input';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import type Owner from '@ember/owner';
import { tracked } from '@glimmer/tracking';
import { TrackedMap } from 'tracked-built-ins';
import { restartableTask } from 'ember-concurrency';
import { format, startOfWeek } from 'date-fns';
import { debounce } from 'lodash';

const dateFormat = `yyyy-MM-dd`;

import { Component, realmURL } from 'https://cardstack.com/base/card-api';

import { not, eq } from '@cardstack/boxel-ui/helpers';
import {
  BoxelButton,
  TabbedHeader,
  ViewSelector,
} from '@cardstack/boxel-ui/components';
import { IconPlus } from '@cardstack/boxel-ui/icons';
import { AppCard, Tab } from './app-card';
import {
  Query,
  CardError,
  SupportedMimeType,
  Filter,
  getCards,
} from '@cardstack/runtime-common';
import ContactIcon from '@cardstack/boxel-icons/contact';
import HeartHandshakeIcon from '@cardstack/boxel-icons/heart-handshake';
import TargetArrowIcon from '@cardstack/boxel-icons/target-arrow';
import CalendarExclamation from '@cardstack/boxel-icons/calendar-exclamation';
import PresentationAnalytics from '@cardstack/boxel-icons/presentation-analytics';
import ListDetails from '@cardstack/boxel-icons/list-details';
import { urgencyTagValues } from './crm/account';
import { dealStatusValues } from './crm/deal';
import { taskStatusValues } from './crm/shared';
import type { Deal } from './crm/deal';
import DealSummary from './crm/deal-summary';
import { CRMTaskPlannerIsolated } from './crm/task-planner';

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
  {
    displayName: 'Representatives',
    icon: PresentationAnalytics,
    cardTypeName: 'CRM Representative',
    createNewButtonText: 'Create Representative',
  },
];
const DEAL_FILTERS: LayoutFilter[] = [
  {
    displayName: 'All Deals',
    icon: ContactIcon,
    cardTypeName: 'CRM Deal',
    createNewButtonText: 'Create Deal',
  },
  ...dealStatusValues.map((status) => ({
    displayName: status.label,
    icon: status.icon,
    cardTypeName: 'CRM Deal',
    createNewButtonText: status.buttonText,
  })),
];
// Map with urgencyTagValues array from crm/account.gts
const ACCOUNT_FILTERS: LayoutFilter[] = [
  {
    displayName: 'All Accounts',
    icon: CalendarExclamation,
    cardTypeName: 'CRM Account',
    createNewButtonText: 'Create Account',
  },
  ...urgencyTagValues.map((tag) => ({
    displayName: tag.label,
    icon: tag.icon,
    cardTypeName: 'CRM Account', // without cardTypeName, the filter is not applied
    createNewButtonText: tag.buttonText,
  })),
];
const TASK_FILTERS: LayoutFilter[] = [
  {
    displayName: 'All Tasks',
    icon: ListDetails,
    cardTypeName: 'CRM Task',
    createNewButtonText: 'Create Task',
  },
  ...taskStatusValues.map((status) => ({
    displayName: status.label,
    icon: status.icon,
    cardTypeName: 'CRM Task',
    createNewButtonText: 'Create Task',
  })),
];

// need to use as typeof AppCard rather than CrmApp otherwise tons of lint errors
class CrmAppTemplate extends Component<typeof AppCard> {
  //filters
  filterMap: TrackedMap<string, LayoutFilter[]> = new TrackedMap([
    ['Contact', CONTACT_FILTERS],
    ['Deal', DEAL_FILTERS],
    ['Account', ACCOUNT_FILTERS],
    ['Task', TASK_FILTERS],
  ]);
  private taskPlannerAPI: CRMTaskPlannerIsolated | undefined;
  @tracked private activeFilter: LayoutFilter = CONTACT_FILTERS[0];
  @action private onFilterChange(filter: LayoutFilter) {
    this.activeFilter = filter;
    this.loadDealCards.perform();
    if (this.activeTabId === 'Task') {
      this.taskPlannerAPI?.loadCards.perform();
    }
  }
  //tabs
  @tracked activeTabId: string | undefined = this.args.model.tabs?.[0]?.tabId;
  @tracked tabs = this.args.model.tabs;
  @tracked private selectedView: ViewOption = 'card';
  @tracked private searchKey = '';
  @tracked private deals: Deal[] = [];

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

    for (let tab of this.tabs ?? []) {
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

  private loadDealCards = restartableTask(async () => {
    if (!this.query || this.activeTabId !== 'Deal') {
      return;
    }

    const result = getCards(this.query, this.realmHrefs, {
      isLive: true,
    });

    await result.loaded;
    this.deals = result.instances as Deal[];
    return result;
  });

  private setupTaskPlanner = (taskPlanner: CRMTaskPlannerIsolated) => {
    this.taskPlannerAPI = taskPlanner;
  };

  private debouncedLoadTaskCards = debounce(() => {
    if (this.activeTabId === 'Task') {
      this.taskPlannerAPI?.loadCards.perform();
    }
  }, 300);

  get filters() {
    return this.filterMap.get(this.activeTabId!)!;
  }

  @action setActiveFilter() {
    this.activeFilter = this.filterMap.get(this.activeTabId!)![0];
  }

  //Tabs
  @action setActiveTab(id: string) {
    this.activeTabId = id;
    this.searchKey = '';
    this.setActiveFilter();
    this.loadDealCards.perform();
  }
  get headerColor() {
    return (
      Object.getPrototypeOf(this.args.model).constructor.headerColor ??
      undefined
    );
  }
  get activeTab() {
    return (
      this.tabs?.find((t: Tab) => t.tabId === this.activeTabId) ??
      this.tabs?.[0]
    );
  }

  get activeTabClass() {
    return this.activeTab?.tabId ? this.activeTab.tabId.toLowerCase() : '';
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
  get realmHrefs() {
    return [this.currentRealm!.href];
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
    const { loadAllFilters, activeFilter, activeTabId } = this;

    if (!loadAllFilters.isIdle || !activeFilter?.query) return;

    const defaultFilter = {
      type: activeFilter.cardRef,
    };

    // filter field value by CRM Account
    const accountFilter =
      activeTabId === 'Account' && activeFilter.displayName !== 'All Accounts'
        ? [
            {
              on: activeFilter.cardRef,
              eq: {
                'urgencyTag.label': activeFilter.displayName,
              },
            },
          ]
        : [];

    // filter field value by CRM Deal
    const dealFilter =
      activeTabId === 'Deal' && activeFilter.displayName !== 'All Deals'
        ? [
            {
              on: activeFilter.cardRef,
              eq: {
                'status.label': activeFilter.displayName,
              },
            },
          ]
        : [];

    return {
      filter: {
        on: activeFilter.cardRef,
        every: [
          defaultFilter,
          ...accountFilter,
          ...dealFilter,
          ...this.searchFilter,
          ...this.taskFilter,
        ],
      },
      sort: this.selectedSort?.sort ?? sortByCardTitleAsc,
    } as Query;
  }

  get searchFilter(): Filter[] {
    return this.searchKey
      ? [
          {
            any: [
              {
                on: this.activeFilter.cardRef,
                contains: { name: this.searchKey },
              },
            ],
          },
        ]
      : [];
  }

  get taskFilter(): Filter[] {
    let taskFilter: Filter[] = [];
    if (
      this.activeTabId === 'Task' &&
      this.activeFilter.displayName !== 'All Tasks'
    ) {
      const today = new Date();
      switch (this.activeFilter.displayName) {
        case 'Overdue':
          const formattedDate = format(today, dateFormat);
          taskFilter = [{ range: { 'dateRange.end': { lt: formattedDate } } }];
          break;
        case 'Due Today':
          const formattedDueToday = format(today, dateFormat);
          taskFilter = [{ eq: { 'dateRange.end': formattedDueToday } }];
          break;
        case 'Due this week':
          const dueThisWeek = startOfWeek(today, { weekStartsOn: 1 });
          const formattedDueThisWeek = format(dueThisWeek, dateFormat);
          taskFilter = [
            { range: { 'dateRange.start': { gt: formattedDueThisWeek } } },
          ];
          break;
        case 'High Priority':
          taskFilter = [{ eq: { 'priority.label': 'High' } }];
          break;
        case 'Unassigned':
          taskFilter = [{ eq: { 'assignee.id': null } }];
          break;
        default:
          break;
      }
    }
    return taskFilter;
  }

  get searchPlaceholder() {
    return `Search ${this.activeFilter.displayName}`;
  }

  @action
  private setSearchKey(searchKey: string) {
    this.searchKey = searchKey;
    this.debouncedLoadTaskCards();
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
      class='crm-app {{this.activeTabClass}}'
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
        {{#if (eq this.activeTabId 'Deal')}}
          <div class='content-header-deal-summary'>
            <DealSummary @deals={{this.deals}} />
          </div>
        {{/if}}
        <div class='search-bar content-header-row-2'>
          <SearchInput
            @placeholder={{this.searchPlaceholder}}
            @value={{this.searchKey}}
            @setSearchKey={{this.setSearchKey}}
          />
        </div>
        {{#if (not (eq this.activeTabId 'Task'))}}
          <ViewSelector
            class='view-menu content-header-row-2'
            @selectedId={{this.selectedView}}
            @onChange={{this.onChangeView}}
          />
        {{/if}}
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
        {{#if (eq this.activeTabId 'Task')}}
          <CRMTaskPlannerIsolated
            @model={{@model}}
            @context={{@context}}
            @fields={{@fields}}
            @set={{@set}}
            @fieldName={{@fieldName}}
            {{! @glint-ignore  Arguments are extended in CRMTaskPlannerIsolated but still not recognized }}
            @searchFilter={{this.searchFilter}}
            @taskFilter={{this.taskFilter}}
            @setupTaskPlanner={{this.setupTaskPlanner}}
          />
        {{else if this.query}}
          {{#if (eq this.selectedView 'card')}}
            <CardList
              @context={{@context}}
              @query={{this.query}}
              @realms={{this.realms}}
              class='crm-app-grid'
            />
          {{else}}
            <CardsGrid
              @query={{this.query}}
              @realms={{this.realms}}
              @selectedView={{this.selectedView}}
              @context={{@context}}
              class='crm-app-grid'
            />
          {{/if}}
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
      .content-header-deal-summary {
        width: 100%;
        margin-top: var(--boxel-sp-lg);
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
      /* Cards grid crm */
      /* contact tab */
      .crm-app.contact {
        --grid-view-min-width: 300px;
      }
      /* deal tab */
      .crm-app.deal {
        --strip-view-min-width: 1fr;
      }
    </style>
  </template>
}

export class CrmApp extends AppCard {
  static displayName = 'CRM App';
  static prefersWideFormat = true;
  static headerColor = '#4D3FE8';
  static isolated = CrmAppTemplate;
}
