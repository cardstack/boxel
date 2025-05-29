import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { TrackedArray } from 'tracked-built-ins';

import CardsIcon from '@cardstack/boxel-icons/cards';

import {
  FilterList,
  SortDropdown,
  ViewSelector,
} from '@cardstack/boxel-ui/components';
import { cn, eq } from '@cardstack/boxel-ui/helpers';
import {
  Card as CardViewIcon,
  Grid3x3 as GridViewIcon,
  Rows4 as StripViewIcon,
  type Icon,
} from '@cardstack/boxel-ui/icons';

import {
  baseRealm,
  type Format,
  type Query,
  type Sort,
  type PrerenderedCardComponentSignature,
} from '@cardstack/runtime-common';

import type { CardContext, BoxComponent } from '../card-api';

import CardList from './card-list';

export interface ViewOption {
  id: string;
  icon: Icon;
}

export interface SortOption {
  displayName: string;
  sort: Sort;
}

export interface FilterOption {
  displayName: string;
  icon?: Icon | string;
  query?: Query;
  cards?: BoxComponent & BoxComponent[];
  format?: Format;
  filters?: FilterOption[];
  sortOptions?: SortOption[];
  viewOptions?: ViewOption[];
  activeFilter?: FilterOption;
  activeSort?: SortOption;
  activeView?: ViewOption;
  hideAddButton?: boolean;
}

export const SORT_OPTIONS: SortOption[] = [
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
    displayName: 'Date Created',
    sort: [
      {
        by: 'createdAt',
        direction: 'desc',
      },
    ],
  },
];

export const VIEW_OPTIONS = [
  { id: 'card', icon: CardViewIcon },
  { id: 'strip', icon: StripViewIcon },
  { id: 'grid', icon: GridViewIcon },
];

interface Signature {
  Args: {
    context?: CardContext;
    format: Format;
    realms: string[];
    isLive?: boolean;
    filterOptions?: FilterOption[];
    sortOptions?: SortOption[];
    viewOptions?: ViewOption[];
    activeFilter?: FilterOption;
    activeSort?: SortOption;
    activeView?: ViewOption;
    onChangeFilter?: (filter: FilterOption) => void;
    onChangeSort?: (sort: SortOption) => void;
    onChangeView?: (viewId: string) => void;
  };
  Blocks: { content: []; contentHeader: []; sidebar: []; cards: [] };
  Element: HTMLElement;
}

export default class CardsGridLayout extends Component<Signature> {
  <template>
    <section
      class={{cn
        'boxel-cards-grid-layout'
        strip-view=(eq this.activeView 'strip')
        card-view=(eq this.activeView 'card')
      }}
      ...attributes
    >
      <aside class='sidebar scroll-container' tabindex='0'>
        {{#if this.filterOptions.length}}
          <FilterList
            @filters={{this.filterOptions}}
            @activeFilter={{this.activeFilter}}
            @onChanged={{this.onChangeFilter}}
          />
        {{/if}}
        {{yield to='sidebar'}}
      </aside>
      <section class='content scroll-container' tabindex='0'>
        <header
          class='content-header'
          aria-label={{this.activeFilter.displayName}}
        >
          <h2 class='content-title'>
            {{this.activeFilter.displayName}}
          </h2>
          {{#if this.viewOptions.length}}
            <ViewSelector
              @items={{this.viewOptions}}
              @onChange={{this.onSelectView}}
              @selectedId={{this.activeView}}
            />
          {{/if}}
          {{#if this.sortOptions.length}}
            <SortDropdown
              @options={{this.sortOptions}}
              @onSelect={{this.onSelectSort}}
              @selectedOption={{this.activeSort}}
            />
          {{/if}}
          {{yield to='contentHeader'}}
        </header>
        <CardList
          class='{{this.activeFilter.displayName}}-list'
          @context={{@context}}
          @prerenderedCardSearchQuery={{this.prerenderedCardSearchQuery}}
          @cards={{this.activeFilter.cards}}
          @viewOption={{this.activeView}}
          data-test-cards-grid-cards
        >
          <:cards>
            {{#if (has-block 'cards')}}
              {{yield to='cards'}}
            {{/if}}
          </:cards>
        </CardList>
        {{yield to='content'}}
      </section>
    </section>

    <style scoped>
      .boxel-cards-grid-layout {
        --padding: var(--boxel-cards-grid-layout-padding, var(--boxel-sp-lg));
        --boxel-card-list-padding: var(
          --boxel-cards-grid-padding,
          0 var(--padding)
        );
        --sidebar-min-width: var(--boxel-cards-grid-sidebar-min-width, 11rem);
        --sidebar-max-width: var(--boxel-cards-grid-sidebar-max-width, 22rem);

        position: relative;
        display: flex;
        width: 100%;
        max-width: 100%;
        height: 100%;
        max-height: 100vh;
        overflow: hidden;
      }
      .scroll-container {
        overflow: hidden;
      }
      .scroll-container:hover,
      .scroll-container:focus {
        overflow-y: auto;
      }
      .sidebar {
        position: relative;
        max-width: 100%;
        width: var(--sidebar-max-width);
        min-width: var(--sidebar-min-width);
        padding: var(--boxel-cards-grid-layout-sidebar-padding, var(--padding));
      }
      .content {
        position: relative;
        flex-grow: 1;
        display: grid;
        grid-template-rows: auto 1fr;
        gap: var(--boxel-sp-lg);
        width: 100%;
        max-width: 100%;
      }
      .content-header {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        column-gap: var(--boxel-sp-lg);
        row-gap: var(--boxel-sp-xs);
        padding: var(--padding);
      }
      .content-title {
        flex-grow: 1;
        margin-block: 0;
        font: 600 var(--boxel-font-lg);
        letter-spacing: var(--boxel-lsp-xxs);
      }
    </style>
  </template>

  private filterOptions: FilterOption[] = new TrackedArray(
    this.args.filterOptions ?? [
      {
        displayName: 'All Cards',
        icon: CardsIcon,
        query: {
          filter: {
            not: {
              eq: {
                _cardType: 'Cards Grid',
              },
            },
          },
        },
      },
    ],
  );

  @tracked private activeSort?: SortOption =
    this.args.activeSort ?? this.sortOptions?.[0];
  @tracked private activeFilter?: FilterOption =
    this.args.activeFilter ?? this.filterOptions?.[0];
  @tracked private _activeView: string =
    this.args.activeView?.id ?? this.viewOptions[0]?.id;

  private get activeView() {
    return this.activeFilter?.activeView?.id ?? this._activeView;
  }

  private get viewOptions(): ViewOption[] {
    return (
      this.activeFilter?.viewOptions ?? this.args.viewOptions ?? VIEW_OPTIONS
    );
  }

  private get sortOptions(): SortOption[] {
    return (
      this.activeFilter?.sortOptions ?? this.args.sortOptions ?? SORT_OPTIONS
    );
  }

  @action onSelectSort(option: SortOption) {
    this.activeSort = option;
    this.args.onChangeSort?.(option);
  }

  @action onSelectView(viewId: string) {
    this._activeView = viewId;
    this.args.onChangeView?.(viewId);
  }

  @action onChangeFilter(filter: FilterOption) {
    this.activeFilter = filter;
    this.args.onChangeFilter?.(filter);
  }

  private get query(): Query | undefined {
    if (!this.activeFilter?.query) {
      return undefined;
    }
    return {
      ...this.activeFilter.query,
      sort: this.activeSort?.sort,
    };
  }

  private get prerenderedCardSearchQuery():
    | PrerenderedCardComponentSignature['Args']
    | undefined {
    if (!this.query) {
      return undefined;
    }
    return {
      query: this.query,
      realms: this.args.realms,
      format: this.args.format,
      isLive: this.args.isLive,
    };
  }
}
