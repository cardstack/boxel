import { on } from '@ember/modifier';
import { action } from '@ember/object';
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { restartableTask } from 'ember-concurrency';
import { TrackedArray } from 'tracked-built-ins';

// TODO: BlogApp should extend AppCard
// // @ts-expect-error: Module '/catalog/app-card' may not be available during compilation
// import { AppCard } from '/catalog/app-card';

import {
  CardDef,
  Component,
  realmURL,
} from 'https://cardstack.com/base/card-api';

import { baseRealm, type Query } from '@cardstack/runtime-common';

import {
  BoxelButton,
  BoxelDropdown,
  Menu as BoxelMenu,
  CardContainer,
  type Filter,
  FilterList,
  ViewSelector,
} from '@cardstack/boxel-ui/components';
import { eq, MenuItem } from '@cardstack/boxel-ui/helpers';
import { DropdownArrowFilled, IconPlus } from '@cardstack/boxel-ui/icons';
import ArrowDown from '@cardstack/boxel-icons/arrow-down';
import ArrowUp from '@cardstack/boxel-icons/arrow-up';
import CategoriesIcon from '@cardstack/boxel-icons/hierarchy-3';
import BlogPostIcon from '@cardstack/boxel-icons/newspaper';
import AuthorIcon from '@cardstack/boxel-icons/square-user';

interface SortOption {
  displayName: string;
  sort: Query['sort'];
}
const SORT_OPTIONS: SortOption[] = [
  {
    displayName: 'Date Published',
    sort: [
      {
        by: 'createdAt',
        direction: 'desc',
      },
    ],
  },
  {
    displayName: 'Last Updated',
    sort: [
      {
        by: 'lastModified',
        direction: 'desc',
      },
    ],
  },
  {
    displayName: 'A-Z',
    sort: [
      {
        on: {
          module: `${baseRealm.url}card-api`,
          name: 'CardDef',
        },
        by: 'title',
        direction: 'asc',
      },
    ],
  },
];

const FILTERS: Filter[] = [
  {
    displayName: 'Blog Posts',
    createNew: 'Post',
    icon: BlogPostIcon,
    query: {
      filter: {
        eq: {
          _cardType: 'Post',
        },
      },
    },
  },
  {
    displayName: 'Author Bios',
    createNew: 'Author',
    icon: AuthorIcon,
    query: {
      filter: {
        eq: {
          _cardType: 'Author Bio',
        },
      },
    },
  },
  {
    displayName: 'Categories',
    createNew: 'Category',
    icon: CategoriesIcon,
    query: {
      filter: {
        eq: {
          _cardType: 'Category', // TODO: does not exist
        },
      },
    },
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
              {{#if (eq @selected.sort.0.direction 'desc')}}
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
        selected: option.displayName === this.args.selected.displayName,
      });
    });
  }
}

class BlogAppTemplate extends Component<typeof BlogApp> {
  <template>
    <section class='blog-app'>
      <div class='blog-app-column sidebar'>
        <header class='sidebar-header'>
          <img
            class='sidebar-header-thumbnail'
            src={{@model.thumbnailURL}}
            width='60'
            height='60'
          />
          <h1 class='sidebar-header-title'><@fields.title /></h1>
          <p class='sidebar-header-description'><@fields.description /></p>
        </header>
        {{#if @context.actions.createCard}}
          <BoxelButton
            class='sidebar-create-button'
            @kind='primary'
            @size='large'
            {{on 'click' this.createNew}}
          >
            <IconPlus class='create-button-icon' width='12' height='12' />
            New
            {{this.activeFilter.createNew}}
          </BoxelButton>
        {{/if}}
        <FilterList
          class='sidebar-filters'
          @filters={{this.filters}}
          @activeFilter={{this.activeFilter}}
          @onChanged={{this.onFilterChange}}
        />
      </div>
      <div class='blog-app-column content'>
        <header class='content-header'>
          <h2 class='content-title'>{{this.activeFilter.displayName}}</h2>
          <ViewSelector
            @selectedId={{this.selectedView}}
            @onChange={{this.onChangeView}}
          />
          <SortMenu
            @options={{this.sortOptions}}
            @selected={{this.selectedSort}}
            @onSort={{this.onSort}}
          />
        </header>

        <ul class='cards' data-test-cards-grid-cards>
          {{#let
            (component @context.prerenderedCardSearchComponent)
            as |PrerenderedCardSearch|
          }}
            <PrerenderedCardSearch
              @query={{this.query}}
              @format='fitted'
              @realms={{this.realms}}
            >
              <:loading>
                Loading...
              </:loading>
              <:response as |cards|>
                {{#each cards as |card|}}
                  <li
                    class='card'
                    {{@context.cardComponentModifier
                      cardId=card.url
                      format='data'
                      fieldType=undefined
                      fieldName=undefined
                    }}
                  >
                    <CardContainer @displayBoundaries='true'>
                      {{card.component}}
                    </CardContainer>
                  </li>
                {{/each}}
              </:response>
            </PrerenderedCardSearch>
          {{/let}}
        </ul>
      </div>
    </section>
    <style scoped>
      .blog-app {
        display: flex;
        width: 100%;
        max-width: 100%;
        height: 100%;
        max-height: 100vh;
        background-color: var(--boxel-light);
        border-top: 1px solid var(--boxel-400);
        overflow: hidden;
      }
      .blog-app-column {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
        padding: var(--boxel-sp-lg);
        max-width: 100%;
      }
      .blog-app-column + .blog-app-column {
        border-left: 1px solid var(--boxel-400);
      }
      .sidebar {
        width: 255px;
      }
      .content {
        flex-grow: 1;
      }

      .sidebar-header {
        display: grid;
        grid-template-columns: auto 1fr;
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
        gap: var(--boxel-sp-xs);
        font-weight: 600;
      }
      .sidebar-create-button-icon {
        flex-shrink: 0;
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
        height: 60px;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--boxel-sp-xs) var(--boxel-sp-lg);
      }
      .content-title {
        flex-grow: 1;
        margin: 0;
        font: 600 var(--boxel-font-lg);
        letter-spacing: var(--boxel-lsp-xxs);
      }
      .cards {
        list-style-type: none;
        margin: 0;
        padding: 0;
      }
    </style>
  </template>

  filters: Filter[] = new TrackedArray(FILTERS);
  sortOptions = SORT_OPTIONS;

  @tracked private selectedView: string | undefined;
  @tracked private selectedSort: SortOption = this.sortOptions[0];
  @tracked private activeFilter = this.filters[0];

  private get realms() {
    return [this.args.model[realmURL]!];
  }

  private get query() {
    return { ...this.activeFilter.query, sort: this.selectedSort.sort };
  }

  @action private onChangeView(id: string) {
    this.selectedView = id;
  }

  @action private onSort(option: SortOption) {
    this.selectedSort = option;
    this.activeFilter = this.activeFilter;
  }

  @action private onFilterChange(filter: Filter) {
    this.activeFilter = filter;
  }

  @action private createNew() {
    this.createCard.perform();
  }

  private createCard = restartableTask(async () => {
    let cardType = this.activeFilter.query.filter.type!;
    let currentRealm = this.realms[0];
    await this.args.context?.actions?.createCard?.(cardType, currentRealm, {
      realmURL: currentRealm,
    });
  });
}

//  Using type CardDef instead of AppCard from catalog because of
//  the many type issues resulting from the lack types from catalog realm
export class BlogApp extends CardDef {
  static displayName = 'Blog App';
  static prefersWideFormat = true;
  static headerColor = '#fff500';
  static isolated = BlogAppTemplate;
}
