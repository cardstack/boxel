import { on } from '@ember/modifier';
import { action } from '@ember/object';
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { restartableTask } from 'ember-concurrency';
import { TrackedArray } from 'tracked-built-ins';

/*
  // TODO: BlogApp should extend AppCard
  // @ts-expect-error: Module '/catalog/app-card' may not be available during compilation
  import { AppCard } from '/catalog/app-card';
*/

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
import { MenuItem } from '@cardstack/boxel-ui/helpers';
import { IconPlus } from '@cardstack/boxel-ui/icons';

import CardsIcon from '@cardstack/boxel-icons/cards';
import ChevronDown from '@cardstack/boxel-icons/chevron-down';

interface SortOption {
  displayName: string;
  sort: Query['sort'];
}
const SORT_OPTIONS: SortOption[] = [
  {
    displayName: 'Published Date',
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
    createNew: 'Blog Post',
    icon: CardsIcon,
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
    icon: CardsIcon,
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
    icon: CardsIcon,
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
    <div class='sort-menu'>
      Sort by
      <BoxelDropdown>
        <:trigger as |bindings|>
          <BoxelButton class='sort-dropdown-trigger' {{bindings}}>
            {{@selected.displayName}}
            <ChevronDown class='sort-dropdown-icon' width='20' height='20' />
          </BoxelButton>
        </:trigger>
        <:content as |dd|>
          <BoxelMenu @closeMenu={{dd.close}} @items={{this.sortOptions}} />
        </:content>
      </BoxelDropdown>
    </div>
    <style scoped>
      .sort-menu {
        display: flex;
        align-items: center;
        gap: 0 var(--boxel-sp-sm);
        text-wrap: nowrap;
      }
      .sort-dropdown-trigger {
        gap: var(--boxel-sp-xs);
        padding-right: var(--boxel-sp-xs);
        padding-left: var(--boxel-sp-xs);
      }
      .sort-dropdown-icon {
        flex-shrink: 0;
      }
      .sort-dropdown-trigger[aria-expanded='true'] .sort-dropdown-icon {
        transform: scaleY(-1);
      }
      .sort-menu :deep(.ember-basic-dropdown-content-wormhole-origin) {
        position: absolute;
      }
    </style>
  </template>

  private get sortOptions() {
    return this.args.options.map((option) => {
      return new MenuItem(option.displayName, 'action', {
        action: () => this.args.onSort(option),
      });
    });
  }
}

class BlogAppTemplate extends Component<typeof BlogApp> {
  <template>
    <section class='blog-app'>
      <div class='sidebar'>
        <header>
          <@fields.thumbnailURL />
          <h1 class='blog-app-title'><@fields.title /></h1>
          <p class='blog-app-description'><@fields.description /></p>
        </header>
        {{#if @context.actions.createCard}}
          <BoxelButton
            class='create-button'
            @kind='primary'
            @size='large'
            {{on 'click' this.createNew}}
          >
            <IconPlus class='create-button-icon' width='13' height='13' />
            New
            {{this.activeFilter.createNew}}
          </BoxelButton>
        {{/if}}
        <FilterList
          class='catalog-filters'
          @filters={{this.filters}}
          @activeFilter={{this.activeFilter}}
          @onChanged={{this.onFilterChange}}
        />
      </div>
      <div class='content'>
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
      .blog-app-title {
        margin: 0;
        font: 600 var(--boxel-font);
        letter-spacing: var(--boxel-lsp-xs);
      }
      .blog-app-description {
        margin: 0;
        font: var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
      }
      .sidebar {
        width: 255px;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
        padding: var(--boxel-sp);
        border-right: 1px solid var(--boxel-400);
      }
      .catalog-filters {
        max-width: 100%;
      }
      .content {
        width: 100%;
        max-width: 100%;
      }
      .content-header {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: var(--boxel-sp-xs) var(--boxel-sp-lg);
        padding: var(--boxel-sp-xl) var(--boxel-sp);
      }
      .content-title {
        flex-grow: 1;
        margin: 0;
        font: 600 var(--boxel-font-lg);
        letter-spacing: var(--boxel-lsp-xxs);
      }

      .create-button {
        gap: var(--boxel-sp-xs);
        font-weight: 600;
      }
      .create-button-icon {
        flex-shrink: 0;
      }

      .cards {
        list-style-type: none;
        margin: 0;
        padding: var(--boxel-sp-xs) var(--boxel-sp);
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

/*
  Using type CardDef instead of AppCard from catalog because of
  the many type issues resulting from the lack types from catalog realm
















































*/
export class BlogApp extends CardDef {
  static displayName = 'Blog App';
  static prefersWideFormat = true;
  static headerColor = '#fff500';
  static isolated = BlogAppTemplate;
}
