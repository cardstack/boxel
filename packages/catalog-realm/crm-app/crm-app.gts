import { CardsGrid } from '../components/grid';
import { CardList } from '../components/card-list';
import { Layout, TitleGroup, type LayoutFilter } from '../components/layout';
import {
  SortMenu,
  type SortOption,
  sortByCardTitleAsc,
} from '../components/sort';
import { SearchInput } from './components/search-input';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import type Owner from '@ember/owner';
import { tracked } from '@glimmer/tracking';
import { TrackedMap } from 'tracked-built-ins';
import { restartableTask } from 'ember-concurrency';
import { format, startOfWeek, endOfWeek } from 'date-fns';
import CRMIcon from '@cardstack/boxel-icons/ship-wheel';

const dateFormat = `yyyy-MM-dd`;

import {
  Component,
  realmURL,
  CardDef,
} from 'https://cardstack.com/base/card-api';

import { not, eq } from '@cardstack/boxel-ui/helpers';
import {
  BoxelButton,
  TabbedHeader,
  ViewSelector,
} from '@cardstack/boxel-ui/components';
import { IconPlus } from '@cardstack/boxel-ui/icons';
import {
  Query,
  CardError,
  SupportedMimeType,
  Filter,
} from '@cardstack/runtime-common';
import ContactIcon from '@cardstack/boxel-icons/contact';
import HeartHandshakeIcon from '@cardstack/boxel-icons/heart-handshake';
import TargetArrowIcon from '@cardstack/boxel-icons/target-arrow';
import CalendarExclamation from '@cardstack/boxel-icons/calendar-exclamation';
import PresentationAnalytics from '@cardstack/boxel-icons/presentation-analytics';
import ListDetails from '@cardstack/boxel-icons/list-details';
import { taskStatusValues } from './shared';
import { URGENCY_TAG_VALUES } from './urgency-tag';
import { DEAL_STATUS_VALUES } from './deal-status';
import DealSummary from './deal-summary';
import { CRMTaskPlanner } from './task-planner';
import type { LooseSingleCardDocument, Sort } from '@cardstack/runtime-common';
import type { TaskSortBy, TaskSortOrder } from './task-planner';
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import {
  Card as CardIcon,
  Grid3x3 as GridIcon,
  Rows4 as StripIcon,
} from '@cardstack/boxel-ui/icons';

type ViewOption = 'card' | 'strip' | 'grid';

interface ViewItem {
  icon: TemplateOnlyComponent<{
    Element: SVGElement;
  }>;
  id: ViewOption;
}

const sortByDueDate: (direction: TaskSortOrder) => Sort = (
  direction: TaskSortOrder,
) => [
  {
    by: 'dueDate',
    direction,
  },
];

const sortByPriority: (direction: TaskSortOrder) => Sort = (
  direction: TaskSortOrder,
) => [
  {
    by: 'priority',
    direction,
  },
];

const TASK_SORT_OPTIONS: SortOption[] = [
  {
    id: 'dueDateDesc',
    displayName: 'Due Date',
    sort: sortByDueDate('desc'),
  },
  {
    id: 'dueDateAsc',
    displayName: 'Due Date',
    sort: sortByDueDate('asc'),
  },
  {
    id: 'priorityDesc',
    displayName: 'Priority',
    sort: sortByPriority('desc'),
  },
  {
    id: 'priorityAsc',
    displayName: 'Priority',
    sort: sortByPriority('asc'),
  },
];

const DEAL_CARD_REF = {
  name: 'Deal',
  module: new URL('./deal', import.meta.url).href,
};

const ACCOUNT_CARD_REF = {
  name: 'Account',
  module: new URL('./account', import.meta.url).href,
};

const TASK_CARD_REF = {
  name: 'CRMTask',
  module: new URL('./task', import.meta.url).href,
};

const CONTACT_CARD_REF = {
  name: 'Contact',
  module: new URL('./contact', import.meta.url).href,
};

const CONTACT_FILTERS: LayoutFilter[] = [
  {
    displayName: 'All Contacts',
    icon: ContactIcon,
    cardTypeName: 'Contact',
    createNewButtonText: 'Create Contact',
    cardRef: CONTACT_CARD_REF,
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
    cardTypeName: 'Lead',
    cardRef: CONTACT_CARD_REF,
    createNewButtonText: 'Create Lead',
  },
  {
    displayName: 'Customers',
    icon: HeartHandshakeIcon,
    cardTypeName: 'Customer',
    cardRef: CONTACT_CARD_REF,
    createNewButtonText: 'Create Customer',
  },
  {
    displayName: 'Representatives',
    icon: PresentationAnalytics,
    cardTypeName: 'Representative',
    cardRef: CONTACT_CARD_REF,
    createNewButtonText: 'Create Representative',
  },
];

const DEAL_FILTERS: LayoutFilter[] = [
  {
    displayName: 'All Deals',
    icon: ContactIcon,
    cardTypeName: 'Deal',
    createNewButtonText: 'Create Deal',
    cardRef: DEAL_CARD_REF,
  },
  ...DEAL_STATUS_VALUES.map((status) => ({
    displayName: status.label,
    icon: status.icon,
    cardTypeName: 'Deal',
    createNewButtonText: 'Create Deal',
    cardRef: DEAL_CARD_REF,
  })),
];
// Map with urgencyTagValues array from crm/account.gts
const ACCOUNT_FILTERS: LayoutFilter[] = [
  {
    displayName: 'All Accounts',
    icon: CalendarExclamation,
    cardTypeName: 'Account',
    createNewButtonText: 'Create Account',
    cardRef: ACCOUNT_CARD_REF,
  },
  ...URGENCY_TAG_VALUES.map((tag) => ({
    displayName: tag.label,
    icon: tag.icon,
    cardTypeName: 'Account', // without cardTypeName, the filter is not applied
    createNewButtonText: 'Create Account',
    cardRef: ACCOUNT_CARD_REF,
  })),
];
const TASK_FILTERS: LayoutFilter[] = [
  {
    displayName: 'All Tasks',
    icon: ListDetails,
    cardTypeName: 'CRM Task',
    createNewButtonText: 'Create Task',
    sortOptions: TASK_SORT_OPTIONS,
    cardRef: TASK_CARD_REF,
  },
  ...taskStatusValues.map((status) => ({
    displayName: status.label,
    icon: status.icon,
    cardTypeName: 'CRM Task',
    createNewButtonText: 'Create Task',
    sortOptions: TASK_SORT_OPTIONS,
    cardRef: TASK_CARD_REF,
  })),
];

const TABS = [
  {
    tabId: 'Account',
    displayName: 'Accounts',
  },
  {
    tabId: 'Contact',
    displayName: 'Contacts',
  },
  {
    tabId: 'Deal',
    displayName: 'Deals',
  },
  {
    tabId: 'Task',
    displayName: 'Tasks',
  },
];

// need to use as typeof AppCard rather than CrmApp otherwise tons of lint errors
class CrmAppTemplate extends Component<typeof CrmApp> {
  //filters
  filterMap: TrackedMap<string, LayoutFilter[]> = new TrackedMap([
    ['Account', ACCOUNT_FILTERS],
    ['Contact', CONTACT_FILTERS],
    ['Deal', DEAL_FILTERS],
    ['Task', TASK_FILTERS],
  ]);
  @tracked private activeFilter: LayoutFilter = ACCOUNT_FILTERS[0];
  @action private onFilterChange(filter: LayoutFilter) {
    this.activeFilter = filter;
    if (this.activeTabId === 'Task') {
      switch (this.activeFilter.displayName) {
        case 'All Tasks':
        case 'Overdue':
        case 'Due this week':
        case 'Unassigned':
          this.activeFilter.selectedSort = {
            id: 'dueDateAsc',
            displayName: 'Due Date',
            sort: sortByDueDate('asc'),
          };
          break;
        case 'Due Today':
        case 'High Priority':
          this.activeFilter.selectedSort = {
            id: 'priorityDesc',
            displayName: 'Priority',
            sort: sortByPriority('desc'),
          };
          break;
        default:
          break;
      }
    }
  }
  //tabs
  @tracked activeTabId: string | undefined = TABS[0].tabId;
  @tracked private selectedView: ViewOption = 'card';

  // Only show strip and grid views for Deal tab for now
  get dealView(): ViewItem[] {
    return [
      { id: 'card', icon: CardIcon },
      { id: 'strip', icon: StripIcon },
      { id: 'grid', icon: GridIcon },
    ];
  }

  get commonViews(): ViewItem[] {
    return [
      { id: 'card', icon: CardIcon },
      { id: 'strip', icon: StripIcon },
      { id: 'grid', icon: GridIcon },
    ];
  }

  get tabViews(): ViewItem[] {
    return this.commonViews;
  }

  @tracked private searchKey = '';

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

    for (let tab of TABS) {
      let tabId = tab.tabId;
      let filters = this.filterMap.get(tabId);
      if (filters) {
        for (let filter of filters) {
          if (filter.cardRef) {
            filter.query = { filter: { type: filter.cardRef } };
            this.filterMap.set(tabId, filters);
          }
        }
      }
    }
  });

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
  }

  get headerColor() {
    return (
      Object.getPrototypeOf(this.args.model).constructor.headerColor ??
      undefined
    );
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
    let doc: LooseSingleCardDocument = {
      data: {
        type: 'card',
        relationships: {
          crmApp: {
            links: {
              self: this.args.model.id ?? null,
            },
          },
        },
        meta: {
          adoptsFrom: ref,
        },
      },
    };
    await this.args.createCard?.(ref, currentRealm, {
      realmURL: currentRealm,
      doc,
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

    const defaultFilter = [
      {
        type: activeFilter.cardRef,
      },
      {
        on: activeFilter.cardRef,
        eq: {
          'crmApp.id': this.args.model.id,
        },
      },
    ];

    // filter field value by Account
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

    // filter field value by Deal
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
          ...defaultFilter,
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
          const endOfThisWeek = endOfWeek(today, { weekStartsOn: 1 });
          const formattedDueThisWeek = format(dueThisWeek, dateFormat);
          const formattedEndOfThisWeek = format(endOfThisWeek, dateFormat);
          taskFilter = [
            {
              range: {
                'dateRange.end': {
                  gte: formattedDueThisWeek,
                  lte: formattedEndOfThisWeek,
                },
              },
            },
          ];
          break;
        case 'High Priority':
          taskFilter = [
            {
              not: { eq: { 'priority.label': 'Lowest' } },
            },
            {
              not: { eq: { 'priority.label': 'Low' } },
            },
            {
              not: { eq: { 'priority.label': 'Medium' } },
            },
          ];
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

  get taskSort() {
    return {
      by: this.selectedSort?.sort?.[0]?.by as TaskSortBy | undefined,
      order: this.selectedSort?.sort?.[0]?.direction,
    };
  }

  get searchPlaceholder() {
    return `Search ${this.activeFilter.displayName}`;
  }

  @action
  private setSearchKey(searchKey: string) {
    this.searchKey = searchKey;
  }

  @action private onChangeView(id: ViewOption) {
    this.selectedView = id;
  }
  @action private onSort(option: SortOption) {
    this.activeFilter.selectedSort = option;
    this.activeFilter = this.activeFilter;
  }

  @action editCard() {
    if (!this.args.model.id) {
      throw new Error('No card id');
    }
    this.args.editCard?.(this.args.model as CardDef);
  }

  <template>
    <TabbedHeader
      class='crm-app-header'
      @tabs={{TABS}}
      @setActiveTab={{this.setActiveTab}}
      @activeTabId={{this.activeTabId}}
      @headerBackgroundColor={{this.headerColor}}
    />

    <Layout
      class='crm-app {{this.activeTabId}}'
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
        {{#if @createCard}}
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
          {{#if this.query}}
            <div class='content-header-deal-summary'>
              <DealSummary
                @context={{@context}}
                @query={{this.query}}
                @realmHrefs={{this.realmHrefs}}
              />
            </div>
          {{/if}}
        {{/if}}
        <div class='search-bar content-header-row-2'>
          <SearchInput
            @placeholder={{this.searchPlaceholder}}
            @value={{this.searchKey}}
            @setSearchKey={{this.setSearchKey}}
          />
        </div>
        <div class='list-controls'>
          {{#if (not (eq this.activeTabId 'Task'))}}
            <ViewSelector
              class='view-menu content-header-row-2'
              @selectedId={{this.selectedView}}
              @onChange={{this.onChangeView}}
              @items={{this.tabViews}}
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
        </div>
      </:contentHeader>
      <:grid>
        {{#if (eq this.activeTabId 'Task')}}
          <CRMTaskPlanner
            @model={{@model}}
            @context={{@context}}
            @realmURL={{this.currentRealm}}
            @editCard={{this.editCard}}
            @searchFilter={{this.searchFilter}}
            @taskFilter={{this.taskFilter}}
            @sort={{this.taskSort}}
          />
        {{else if this.query}}
          {{#if (eq this.selectedView 'card')}}
            <CardList
              @context={{@context}}
              @query={{this.query}}
              @realms={{this.realmHrefs}}
              class='crm-app-grid'
            />
          {{else}}
            <CardsGrid
              @query={{this.query}}
              @realms={{this.realmHrefs}}
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
      .list-controls {
        display: inline-flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp);
        margin-left: auto;
      }
      /* Cards List & Grid Customization */
      /* Deal tab */
      .crm-app.Deal {
        --strip-view-min-width: 1fr;
        --embedded-card-min-height: 200px;
      }
      .crm-app.Task:deep(.content-grid) {
        padding-bottom: 0;
        padding-right: 0;
      }
    </style>
  </template>
}

export class CrmApp extends CardDef {
  static displayName = 'CRM App';
  static prefersWideFormat = true;
  static headerColor = '#4D3FE8';
  static icon = CRMIcon;
  static isolated = CrmAppTemplate;
}
