import { on } from '@ember/modifier';
import { action, get } from '@ember/object';
import type Owner from '@ember/owner';
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { restartableTask } from 'ember-concurrency';
import { TrackedArray } from 'tracked-built-ins';

import {
  CardDef,
  Component,
  realmURL,
  type CardContext,
  type Format,
} from 'https://cardstack.com/base/card-api';

import {
  baseRealm,
  CardError,
  getCard,
  SupportedMimeType,
  type Query,
  type Sort,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';

import {
  BoxelButton,
  BoxelDropdown,
  Menu as BoxelMenu,
  CardContainer,
  FieldContainer,
  FilterList,
  Pill,
  ViewSelector,
} from '@cardstack/boxel-ui/components';
import { eq, MenuItem, not } from '@cardstack/boxel-ui/helpers';
import { DropdownArrowFilled, IconPlus } from '@cardstack/boxel-ui/icons';

import ArrowDown from '@cardstack/boxel-icons/arrow-down';
import ArrowUp from '@cardstack/boxel-icons/arrow-up';
import IconComponent from '@cardstack/boxel-icons/captions';
import CategoriesIcon from '@cardstack/boxel-icons/hierarchy-3';
import BlogPostIcon from '@cardstack/boxel-icons/newspaper';
import BlogAppIcon from '@cardstack/boxel-icons/notebook';
import AuthorIcon from '@cardstack/boxel-icons/square-user';

import type { BlogPost } from './blog-post';

type ViewOption = 'card' | 'strip' | 'grid';

interface SortOption {
  id: string;
  displayName: string;
  sort: Sort;
}
const sortByCardTitle: Sort = [
  {
    on: {
      module: `${baseRealm.url}card-api`,
      name: 'CardDef',
    },
    by: 'title',
    direction: 'asc',
  },
];
const SORT_OPTIONS: SortOption[] = [
  {
    id: 'datePubDesc',
    displayName: 'Date Published',
    sort: [
      {
        by: 'createdAt',
        direction: 'desc',
      },
    ],
  },
  {
    id: 'lastUpdatedDesc',
    displayName: 'Last Updated',
    sort: [
      {
        by: 'lastModified',
        direction: 'desc',
      },
    ],
  },
  {
    id: 'cardTitleAsc',
    displayName: 'A-Z',
    sort: sortByCardTitle,
  },
];

interface SidebarFilter {
  displayName: string;
  icon: typeof IconComponent;
  cardTypeName: string;
  createNewButtonText?: string;
  isCreateNewDisabled?: boolean;
  cardRef?: ResolvedCodeRef;
  query?: Query;
  sortOptions?: SortOption[];
  selectedSort?: SortOption;
  showAdminData?: boolean;
}
const FILTERS: SidebarFilter[] = [
  {
    displayName: 'Blog Posts',
    icon: BlogPostIcon,
    cardTypeName: 'Blog Post',
    createNewButtonText: 'Post',
    showAdminData: true,
    sortOptions: SORT_OPTIONS,
  },
  {
    displayName: 'Author Bios',
    icon: AuthorIcon,
    cardTypeName: 'Author Bio',
    createNewButtonText: 'Author',
  },
  {
    displayName: 'Categories',
    icon: CategoriesIcon,
    cardTypeName: 'Category',
    createNewButtonText: 'Category',
    isCreateNewDisabled: true, // TODO: Category cards
  },
];

interface SortMenuSignature {
  Args: {
    options: SortOption[];
    onSort: (option: SortOption) => void;
    selected: SortOption;
  };
}
class SortMenu extends GlimmerComponent<SortMenuSignature> {
  <template>
    <div class='sort'>
      Sort by
      <BoxelDropdown>
        <:trigger as |bindings|>
          <BoxelButton class='sort-trigger' {{bindings}}>
            <span class='sort-trigger-content'>
              {{@selected.displayName}}
              {{#if (eq (get @selected.sort '0.direction') 'desc')}}
                <ArrowDown width='16' height='16' />
              {{else}}
                <ArrowUp width='16' height='16' />
              {{/if}}
            </span>
            <DropdownArrowFilled
              class='sort-trigger-icon'
              width='10'
              height='10'
            />
          </BoxelButton>
        </:trigger>
        <:content as |dd|>
          <BoxelMenu
            class='sort-menu'
            @closeMenu={{dd.close}}
            @items={{this.sortOptions}}
          />
        </:content>
      </BoxelDropdown>
    </div>
    <style scoped>
      .sort {
        display: flex;
        align-items: center;
        gap: 0 var(--boxel-sp-sm);
        text-wrap: nowrap;
      }
      .sort :deep(.ember-basic-dropdown-content-wormhole-origin) {
        position: absolute; /* This prevents layout shift when menu opens */
      }

      .sort-trigger {
        --boxel-button-border-color: var(--boxel-450);
        width: 190px;
        justify-content: space-between;
        gap: var(--boxel-sp-xs);
        padding-right: var(--boxel-sp-xs);
        padding-left: var(--boxel-sp-xs);
        border-radius: var(--boxel-border-radius);
      }
      .sort-trigger[aria-expanded='true'] .sort-dropdown-icon {
        transform: scaleY(-1);
      }
      .sort-trigger-content {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-xxxs);
      }
      .sort-trigger-icon {
        flex-shrink: 0;
      }

      .sort-menu {
        --boxel-menu-item-content-padding: var(--boxel-sp-xs);
        width: 190px;
      }
    </style>
  </template>

  private get sortOptions() {
    return this.args.options.map((option) => {
      return new MenuItem(option.displayName, 'action', {
        action: () => this.args.onSort(option),
        icon: option.sort?.[0].direction === 'desc' ? ArrowDown : ArrowUp,
        selected: option.id === this.args.selected.id,
      });
    });
  }
}

export const toISOString = (datetime: Date) => datetime.toISOString();

export const formatDatetime = (
  datetime: Date,
  opts: Intl.DateTimeFormatOptions,
) => {
  const Format = new Intl.DateTimeFormat('en-US', opts);
  return Format.format(datetime);
};

interface CardAdminViewSignature {
  Args: {
    cardId: string;
  };
  Element: HTMLElement;
}
class BlogAdminData extends GlimmerComponent<CardAdminViewSignature> {
  <template>
    {{#if this.resource.card}}
      <div class='blog-admin' ...attributes>
        {{#let this.resource.card as |card|}}
          <FieldContainer
            class='admin-data'
            @label='Publish Date'
            @vertical={{true}}
          >
            {{#if card.publishDate}}
              <time timestamp={{toISOString card.publishDate}}>
                {{this.formattedDate card.publishDate}}
              </time>
            {{else}}
              N/A
            {{/if}}
          </FieldContainer>
          <FieldContainer class='admin-data' @label='Status' @vertical={{true}}>
            <Pill class='status-pill'>{{card.status}}</Pill>
          </FieldContainer>
        {{/let}}
      </div>
    {{/if}}
    <style scoped>
      .blog-admin {
        display: inline-flex;
        flex-direction: column;
        gap: var(--boxel-sp);
      }
      .admin-data {
        --boxel-label-font: 600 var(--boxel-font-sm);
      }
      .status-pill {
        --pill-background-color: var(--boxel-200);
        font-weight: 400;
      }
    </style>
  </template>

  @tracked resource = getCard<BlogPost>(new URL(this.args.cardId));

  formattedDate = (datetime: Date) => {
    return formatDatetime(datetime, {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour12: true,
      hour: 'numeric',
      minute: '2-digit',
    });
  };
}

interface BlogCardsGridSignature {
  Args: {
    query: Query;
    format: Format;
    realms: URL[];
    selectedView: ViewOption;
    context?: CardContext;
    displayAdminData?: boolean;
  };
  Element: HTMLElement;
}
class BlogCardsGrid extends GlimmerComponent<BlogCardsGridSignature> {
  <template>
    <ul
      class='blog-cards {{@selectedView}}-view'
      data-test-cards-grid-cards
      ...attributes
    >
      {{#let
        (component @context.prerenderedCardSearchComponent)
        as |PrerenderedCardSearch|
      }}
        <PrerenderedCardSearch
          @query={{@query}}
          @format={{@format}}
          @realms={{@realms}}
        >
          <:loading>
            Loading...
          </:loading>
          <:response as |cards|>
            {{#each cards key='url' as |card|}}
              <li
                class='{{@selectedView}}-view-container'
                {{@context.cardComponentModifier
                  cardId=card.url
                  format='data'
                  fieldType=undefined
                  fieldName=undefined
                }}
              >
                <CardContainer
                  class='card'
                  @displayBoundaries={{not (eq @selectedView 'card')}}
                >
                  <card.component />
                </CardContainer>
                {{#if @displayAdminData}}
                  <BlogAdminData @cardId={{card.url}} />
                {{/if}}
              </li>
            {{/each}}
          </:response>
        </PrerenderedCardSearch>
      {{/let}}
    </ul>
    <style scoped>
      .blog-cards {
        display: grid;
        grid-template-columns: repeat(
          auto-fill,
          minmax(var(--grid-card-min-width), var(--grid-card-max-width))
        );
        grid-auto-rows: var(--grid-card-height);
        gap: var(--boxel-sp);
        list-style-type: none;
        margin: 0;
        padding: var(--boxel-sp-6xs);
      }
      .card-view {
        --grid-card-height: 347px;
        grid-template-columns: minmax(750px, 1fr);
      }
      .strip-view {
        --grid-card-min-width: 49%;
        --grid-card-max-width: 1fr;
        --grid-card-height: 180px;
      }
      .grid-view {
        --grid-card-min-width: 224px;
        --grid-card-max-width: 1fr;
        --grid-card-height: max-content;
      }
      .grid-view-container {
        aspect-ratio: 5/6;
      }
      .card-view-container {
        display: grid;
        grid-template-columns: 1fr 247px;
        gap: var(--boxel-sp-lg);
      }
      .card {
        container-name: fitted-card;
        container-type: size;
      }
      .card-view-container :deep(article) {
        border-radius: var(--boxel-border-radius);
        box-shadow: inset 0 0 0 1px var(--boxel-light-500);
      }
    </style>
  </template>
}

class BlogAppTemplate extends Component<typeof BlogApp> {
  <template>
    <section class='blog-app'>
      <aside class='sidebar'>
        <header class='sidebar-header' aria-label='blog-header'>
          <img
            class='sidebar-header-thumbnail'
            src={{@model.thumbnailURL}}
            width='60'
            height='60'
            alt={{@model.title}}
          />
          <h1 class='sidebar-header-title'><@fields.title /></h1>
          <p class='sidebar-header-description'><@fields.description /></p>
        </header>
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
              <IconPlus class='create-button-icon' width='15' height='15' />
            {{/unless}}
            New
            {{this.activeFilter.createNewButtonText}}
          </BoxelButton>
        {{/if}}
        <FilterList
          class='sidebar-filters'
          @filters={{this.filters}}
          @activeFilter={{this.activeFilter}}
          @onChanged={{this.onFilterChange}}
        />
      </aside>
      <section class='content'>
        <header
          class='content-header'
          aria-label={{this.activeFilter.displayName}}
        >
          <h2 class='content-title'>{{this.activeFilter.displayName}}</h2>
          <ViewSelector
            @selectedId={{this.selectedView}}
            @onChange={{this.onChangeView}}
          />
          {{#if this.activeFilter.sortOptions.length}}
            {{#if this.selectedSort}}
              <SortMenu
                @options={{this.activeFilter.sortOptions}}
                @selected={{this.selectedSort}}
                @onSort={{this.onSort}}
              />
            {{/if}}
          {{/if}}
        </header>
        {{#if this.query}}
          <div class='content-scroll-container'>
            <BlogCardsGrid
              class='content-grid'
              @selectedView={{this.selectedView}}
              @context={{@context}}
              @format={{if (eq this.selectedView 'card') 'embedded' 'fitted'}}
              @query={{this.query}}
              @realms={{this.realms}}
              @displayAdminData={{this.showAdminData}}
            />
          </div>
        {{/if}}
      </section>
    </section>
    <style scoped>
      .blog-app {
        --layout-padding: var(--boxel-sp-lg);
        --sidebar-width: 255px;
        --content-max-width: 1040px;
        --layout-background-color: var(--boxel-light);
        display: flex;
        width: 100%;
        max-width: 100%;
        height: 100%;
        max-height: 100vh;
        background-color: var(--layout-background-color);
        overflow: hidden;
      }
      .sidebar {
        width: var(--sidebar-width);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
        padding: var(--layout-padding);
        border-right: 1px solid var(--boxel-400);
      }
      .content {
        max-width: 100%;
        flex-grow: 1;
        display: grid;
        grid-template-rows: max-content 1fr;
      }

      /* these help hide overlay button visibility through gaps during scroll */
      .sidebar,
      .content-header {
        position: relative;
        z-index: 1;
        background-color: var(--layout-background-color);
        border-top: 1px solid var(--boxel-400);
      }

      .sidebar-header {
        display: grid;
        grid-template-columns: max-content 1fr;
        column-gap: var(--boxel-sp-xs);
      }
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

      /* TODO: fix filter component styles in boxel-ui */
      .sidebar-filters {
        width: auto;
        margin: 0;
        gap: var(--boxel-sp-4xs);
      }
      .sidebar-filters > :deep(button) {
        margin: 0;
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-sm);
        font: 600 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
      }
      .sidebar-filters > :deep(button > svg) {
        width: var(--boxel-icon-sm);
        height: var(--boxel-icon-sm);
      }

      .content-header {
        min-height: calc(60px + 2 * var(--layout-padding));
        padding: var(--layout-padding);
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--boxel-sp-xs) var(--boxel-sp-lg);
      }
      .content-grid {
        max-width: var(--content-max-width);
        padding-left: var(--layout-padding);
        padding-bottom: var(--layout-padding);
      }
      .content-title {
        flex-grow: 1;
        margin: 0;
        font: 600 var(--boxel-font-lg);
        letter-spacing: var(--boxel-lsp-xxs);
      }
      .content-scroll-container {
        padding-right: var(--layout-padding);
        overflow: auto;
      }
    </style>
  </template>

  filters: SidebarFilter[] = new TrackedArray(FILTERS);

  @tracked private selectedView: ViewOption = 'card';
  @tracked private activeFilter: SidebarFilter = this.filters[0];

  constructor(owner: Owner, args: any) {
    super(owner, args);
    this.loadCardTypes.perform();
  }

  private get selectedSort() {
    if (!this.activeFilter.sortOptions?.length) {
      return;
    }
    return this.activeFilter.selectedSort ?? this.activeFilter.sortOptions[0];
  }

  private get showAdminData() {
    return this.activeFilter.showAdminData && this.selectedView === 'card';
  }

  private get realms() {
    return [this.args.model[realmURL]!];
  }

  private get query() {
    if (this.loadCardTypes.isIdle && this.activeFilter.query) {
      return {
        ...this.activeFilter.query,
        sort: this.selectedSort?.sort ?? sortByCardTitle,
      };
    }
    return undefined;
  }

  private loadCardTypes = restartableTask(async () => {
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

    for (let filter of this.filters) {
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
    }
  });

  @action private onChangeView(id: ViewOption) {
    this.selectedView = id;
  }

  @action private onSort(option: SortOption) {
    this.activeFilter.selectedSort = option;
    this.activeFilter = this.activeFilter;
  }

  @action private onFilterChange(filter: SidebarFilter) {
    this.activeFilter = filter;
  }

  @action private createNew() {
    this.createCard.perform();
  }

  private createCard = restartableTask(async () => {
    let ref = this.activeFilter.cardRef;
    if (!ref) {
      return;
    }
    let currentRealm = this.realms[0];
    await this.args.context?.actions?.createCard?.(ref, currentRealm, {
      realmURL: currentRealm,
    });
  });
}

// TODO: BlogApp should extend AppCard
// Using type CardDef instead of AppCard from catalog because of
// the many type issues resulting from the lack types from catalog realm
export class BlogApp extends CardDef {
  static displayName = 'Blog App';
  static icon = BlogAppIcon;
  static prefersWideFormat = true;
  static headerColor = '#fff500';
  static isolated = BlogAppTemplate;
}
