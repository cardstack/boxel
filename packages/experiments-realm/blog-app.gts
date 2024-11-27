import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { restartableTask } from 'ember-concurrency';
import { TrackedArray } from 'tracked-built-ins';

import {
  CardDef,
  Component,
  realmURL,
} from 'https://cardstack.com/base/card-api';

import {
  CardError,
  getCard,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import {
  type SortOption,
  sortByCardTitleAsc,
  SortMenu,
} from './components/sort';
import { type ViewOption, CardsGrid } from './components/grid';
import { TitleGroup, Layout, type LayoutFilter } from './components/layout';

import {
  BoxelButton,
  FieldContainer,
  Pill,
  ViewSelector,
} from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';
import { IconPlus } from '@cardstack/boxel-ui/icons';

import CategoriesIcon from '@cardstack/boxel-icons/hierarchy-3';
import BlogPostIcon from '@cardstack/boxel-icons/newspaper';
import BlogAppIcon from '@cardstack/boxel-icons/notebook';
import AuthorIcon from '@cardstack/boxel-icons/square-user';

import type { BlogPost } from './blog-post';

export const SORT_OPTIONS: SortOption[] = [
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
    sort: sortByCardTitleAsc,
  },
];

const FILTERS: LayoutFilter[] = [
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

export const toISOString = (datetime: Date) => datetime.toISOString();

export const formatDatetime = (
  datetime: Date,
  opts: Intl.DateTimeFormatOptions,
) => {
  const Format = new Intl.DateTimeFormat('en-US', opts);
  return Format.format(datetime);
};

const or = function (item1: any, item2: any) {
  if (Boolean(item1)) {
    return item1;
  } else if (Boolean(item2)) {
    return item2;
  }
  return;
};

interface CardAdminViewSignature {
  Args: {
    cardId: string;
  };
  Element: HTMLElement;
}
class BlogAdminData extends GlimmerComponent<CardAdminViewSignature> {
  <template>
    {{#if this.resource.cardError}}
      Error: Could not load additional info
    {{else if this.resource.card}}
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

class BlogAppTemplate extends Component<typeof BlogApp> {
  <template>
    <Layout
      @filters={{this.filters}}
      @activeFilter={{this.activeFilter}}
      @onFilterChange={{this.onFilterChange}}
    >
      <:sidebar>
        <TitleGroup
          @title={{or @model.title ''}}
          @tagline={{or @model.description ''}}
          @thumbnailURL={{or @model.thumbnailURL ''}}
          @element='header'
          aria-label='Sidebar Header'
        />
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
            New
            {{this.activeFilter.createNewButtonText}}
          </BoxelButton>
        {{/if}}
      </:sidebar>
      <:contentHeader>
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
      </:contentHeader>
      <:grid>
        {{#if this.query}}
          <div class='content-scroll-container'>
            <CardsGrid
              @selectedView={{this.selectedView}}
              @context={{@context}}
              @format={{if (eq this.selectedView 'card') 'embedded' 'fitted'}}
              @query={{this.query}}
              @realms={{this.realms}}
            >
              <:adminData as |card|>
                {{#if this.showAdminData}}
                  <BlogAdminData @cardId={{card.url}} />
                {{/if}}
              </:adminData>
            </CardsGrid>
          </div>
        {{/if}}
      </:grid>
    </Layout>
    <style scoped>
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

      .content-title {
        flex-grow: 1;
        margin: 0;
        font: 600 var(--boxel-font-lg);
        letter-spacing: var(--boxel-lsp-xxs);
      }
    </style>
  </template>

  filters: LayoutFilter[] = new TrackedArray(FILTERS);

  @tracked private selectedView: ViewOption = 'card';
  @tracked private activeFilter: LayoutFilter = this.filters[0];

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
        sort: this.selectedSort?.sort ?? sortByCardTitleAsc,
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

  @action private onFilterChange(filter: LayoutFilter) {
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
