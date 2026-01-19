import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { restartableTask } from 'ember-concurrency';

import {
  CardDef,
  Component,
  realmURL,
  field,
  contains,
  StringField,
  type CardContext,
} from 'https://cardstack.com/base/card-api';

import {
  type LooseSingleCardDocument,
  ResolvedCodeRef,
  TypedFilter,
} from '@cardstack/runtime-common';
import {
  type SortOption,
  sortByCardTitleAsc,
  SortMenu,
} from '../components/sort';
import { CardList } from '../components/card-list';
import { CardsGrid } from '../components/grid';
import { TitleGroup, Layout, type LayoutFilter } from '../components/layout';

import {
  BasicFitted,
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
import type { User } from './user';

type ViewOption = 'card' | 'strip' | 'grid';

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
    context?: CardContext<BlogPost>;
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
          <FieldContainer
            class='admin-data'
            @label='Last Updated'
            @vertical={{true}}
          >
            {{#if card.lastUpdated}}
              <time timestamp={{toISOString card.lastUpdated}}>
                {{this.formattedDate card.lastUpdated}}
              </time>
            {{else}}
              N/A
            {{/if}}
          </FieldContainer>
          <FieldContainer
            class='admin-data'
            @label='Word Count'
            @vertical={{true}}
          >
            {{if card.wordCount card.wordCount 0}}
          </FieldContainer>
          <FieldContainer class='admin-data' @label='Editor' @vertical={{true}}>
            {{this.editors}}
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

  @tracked resource = this.args.context
    ? this.args.context.getCard(this, () => this.args.cardId)
    : undefined;

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

  get editors() {
    return this.resource?.card && this.resource.card.editors.length > 0
      ? this.resource.card.editors
          .map((editor: User) =>
            editor.email ? `${editor.name} (${editor.email})` : editor.name,
          )
          .join(',')
      : 'N/A';
  }
}

class BlogAppTemplate extends Component<typeof BlogApp> {
  <template>
    <Layout
      @filters={{this.filters}}
      @activeFilter={{this.activeFilter}}
      @onFilterChange={{this.onFilterChange}}
      class='blog-app'
    >
      <:sidebar>
        <TitleGroup
          @title={{or @model.cardTitle ''}}
          @tagline={{or @model.cardDescription ''}}
          @thumbnailURL={{or @model.cardThumbnailURL ''}}
          @icon={{@model.constructor.icon}}
          @element='header'
          aria-label='Sidebar Header'
        />
        {{#if @createCard}}
          <BoxelButton
            class='sidebar-create-button'
            @kind='primary'
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
          {{#if (eq this.selectedView 'card')}}
            <CardList
              @context={{@context}}
              @query={{this.query}}
              @realms={{this.realmHrefs}}
              class='blog-app-card-list {{this.gridClass}}'
            >
              <:meta as |card|>
                {{#if this.showAdminData}}
                  <BlogAdminData
                    @cardId={{card.url}}
                    @context={{this.context}}
                  />
                {{/if}}
              </:meta>
            </CardList>
          {{else}}
            <CardsGrid
              @selectedView={{this.selectedView}}
              @context={{@context}}
              @query={{this.query}}
              @realms={{this.realmHrefs}}
              class={{this.gridClass}}
            />
          {{/if}}
        {{/if}}
      </:grid>
    </Layout>
    <style scoped>
      .blog-app {
        --grid-view-height: max-content;
      }
      .blog-app :where(.grid-view-container) {
        aspect-ratio: 5 / 6;
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

      .content-title {
        flex-grow: 1;
        margin: 0;
        font: 600 var(--boxel-font-lg);
        letter-spacing: var(--boxel-lsp-xxs);
      }
      .blog-app-card-list {
        --embedded-card-max-width: 715px;
      }
      .categories-grid {
        --embedded-card-min-height: 150px;
      }
    </style>
  </template>

  @tracked private selectedView: ViewOption = 'card';
  @tracked private activeFilter: LayoutFilter;
  @tracked private filters: LayoutFilter[] = [];

  constructor(owner: Owner, args: any) {
    super(owner, args);
    this.setFilters();
    this.activeFilter = this.filters[0];
  }

  private get context() {
    return this.args.context as CardContext<BlogPost>;
  }

  private get gridClass() {
    let displayName = this.activeFilter.displayName;
    let gridName =
      displayName === 'Blog Posts'
        ? 'blog-posts-grid'
        : displayName === 'Author Bios'
        ? 'author-bios-grid'
        : displayName === 'Categories'
        ? 'categories-grid'
        : '';
    return gridName ? `bordered-items ${gridName}` : '';
  }

  private setFilters() {
    let blogId = this.args.model.id;

    let makeQuery = (codeRef: ResolvedCodeRef) => {
      if (!blogId) {
        throw new Error('Missing blog id');
      }

      return {
        filter: {
          on: codeRef,
          eq: { 'blog.id': blogId },
        },
      };
    };

    this.filters =
      this.args.model.filters?.map((filter) => {
        if (!filter.query && filter.cardRef) {
          return {
            ...filter,
            query: makeQuery(filter.cardRef),
          };
        }
        return filter;
      }) ?? [];
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

  private get realmHrefs() {
    return this.realms.map((url) => url.href);
  }

  private get query() {
    return {
      ...this.activeFilter.query,
      sort: this.selectedSort?.sort ?? sortByCardTitleAsc,
    };
  }

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
    if (!this.activeFilter?.query?.filter) {
      throw new Error('Missing active filter');
    }
    let ref = (this.activeFilter.query.filter as TypedFilter).on;

    if (!ref) {
      throw new Error('Missing card ref');
    }
    let currentRealm = this.realms[0];
    let doc: LooseSingleCardDocument = {
      data: {
        type: 'card',
        relationships: {
          blog: {
            links: {
              self: this.args.model.id!,
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
}

// TODO: BlogApp should extend AppCard
// Using type CardDef instead of AppCard from catalog because of
// the many type issues resulting from the lack types from catalog realm
export class BlogApp extends CardDef {
  @field website = contains(StringField);
  static displayName = 'Blog App';
  static icon = BlogAppIcon;
  static prefersWideFormat = true;
  static headerColor = '#fff500';

  static sortOptionList: SortOption[] = [
    {
      id: 'datePubDesc',
      displayName: 'Date Published',
      sort: [
        {
          on: {
            module: new URL('./blog-post', import.meta.url).href,
            name: 'BlogPost',
          },
          by: 'publishDate',
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

  static filterList: LayoutFilter[] = [
    {
      displayName: 'Blog Posts',
      icon: BlogPostIcon,
      cardTypeName: 'Blog Post',
      createNewButtonText: 'Post',
      showAdminData: true,
      sortOptions: BlogApp.sortOptionList,
      cardRef: {
        name: 'BlogPost',
        module: new URL('./blog-post', import.meta.url).href,
      },
    },
    {
      displayName: 'Author Bios',
      icon: AuthorIcon,
      cardTypeName: 'Author',
      createNewButtonText: 'Author',
      cardRef: {
        name: 'Author',
        module: new URL('./author', import.meta.url).href,
      },
    },
    {
      displayName: 'Categories',
      icon: CategoriesIcon,
      cardTypeName: 'Category',
      createNewButtonText: 'Category',
      cardRef: {
        name: 'BlogCategory',
        module: new URL('./blog-category', import.meta.url).href,
      },
    },
  ];

  get filters(): LayoutFilter[] {
    if (this.constructor && 'filterList' in this.constructor) {
      return this.constructor.filterList as LayoutFilter[];
    }
    return BlogApp.filterList;
  }

  static isolated = BlogAppTemplate;
  static fitted = class Fitted extends Component<typeof this> {
    <template>
      <BasicFitted
        class='fitted-blog'
        @thumbnailURL={{@model.cardThumbnailURL}}
        @iconComponent={{@model.constructor.icon}}
        @primary={{@model.cardTitle}}
        @secondary={{@model.website}}
      />
      <style scoped>
        .fitted-blog :deep(.card-description) {
          display: none;
        }

        @container fitted-card ((2.0 < aspect-ratio) and (400px <= width ) and (height < 115px)) {
          .fitted-blog {
            padding: var(--boxel-sp-xxxs);
            align-items: center;
          }
          .fitted-blog :deep(.thumbnail-section) {
            border: 1px solid var(--boxel-450);
            border-radius: var(--boxel-border-radius-lg);
            width: 40px;
            height: 40px;
            overflow: hidden;
          }
          .fitted-blog :deep(.card-thumbnail) {
            width: 100%;
            height: 100%;
          }
          .fitted-blog :deep(.card-type-icon) {
            width: 20px;
            height: 20px;
          }
          .fitted-blog :deep(.info-section) {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: var(--boxel-sp-xs);
          }
          .fitted-blog :deep(.card-title) {
            -webkit-line-clamp: 2;
            font: 600 var(--boxel-font-sm);
            letter-spacing: var(--boxel-lsp-xs);
          }
          .fitted-blog :deep(.card-display-name) {
            margin: 0;
            overflow: hidden;
          }
        }
      </style>
    </template>
  };
}
