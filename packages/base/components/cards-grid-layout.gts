import {
  baseRealm,
  type Format,
  type Sort,
  type Query,
} from '@cardstack/runtime-common';
import CardsIcon from '@cardstack/boxel-icons/cards'; // TODO: copy icon
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { TrackedArray } from 'tracked-built-ins';

import {
  FilterList,
  SortDropdown,
  ViewSelector,
  type Filter,
  SortOption,
  type ViewItem,
} from '@cardstack/boxel-ui/components';
import { cn, eq } from '@cardstack/boxel-ui/helpers';

import type { CardContext } from '../card-api';

import CardList from './card-list';

const SORT_OPTIONS: SortOption[] = [
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

interface Signature {
  Args: {
    activeFilter?: Filter;
    activeSort?: SortOption;
    context?: CardContext;
    filters?: Filter[];
    format: Format;
    isLive?: boolean;
    onChangeFilter?: (filter?: Filter) => void;
    onSelectSort?: (sort: SortOption) => void;
    onSelectView?: (viewId: string) => void;
    realms: string[];
    selectedView?: ViewItem;
    sortOptions?: SortOption[];
    viewOptions?: ViewItem[];
  };
  Blocks: { content: []; contentHeader: []; sidebar: [] };
  Element: HTMLElement;
}

export default class CardsGridLayout extends Component<Signature> {
  <template>
    <section
      class={{cn
        'boxel-cards-grid-layout'
        strip-view=(eq this.activeView 'strip')
      }}
      ...attributes
    >
      <aside class='sidebar scroll-container' tabindex='0'>
        <FilterList
          @filters={{this.filters}}
          @activeFilter={{this.activeFilter}}
          @onChanged={{this.onChangeFilter}}
        />
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
          <ViewSelector
            @items={{this.viewOptions}}
            @onChange={{this.onSelectView}}
            @selectedId={{this.activeView}}
          />
          <SortDropdown
            @options={{this.sortOptions}}
            @onSelect={{this.onSelectSort}}
            @selectedOption={{this.activeSort}}
          />
          {{yield to='contentHeader'}}
        </header>
        {{#if this.query}}
          <CardList
            @format={{@format}}
            @viewOption={{this.activeView}}
            @context={{@context}}
            @query={{this.query}}
            @realms={{@realms}}
            @isLive={{@isLive}}
            data-test-cards-grid-cards
          />
        {{/if}}
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
        display: flex;
        flex-direction: column;
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

  private filters: Filter[] =
    this.args.filters ??
    new TrackedArray([
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
    ]);
  private sortOptions: SortOption[] = new TrackedArray(
    this.args.sortOptions ?? SORT_OPTIONS,
  );
  private viewOptions: ViewItem[] = new TrackedArray(this.args.viewOptions);

  @tracked private activeSort?: SortOption =
    this.args.activeSort ?? this.sortOptions[0];
  @tracked private activeFilter?: Filter =
    this.args.activeFilter ?? this.filters[0];
  @tracked private activeView: string =
    this.args.selectedView?.id ?? this.viewOptions[0]?.id;

  @action onSelectSort(option: SortOption) {
    this.activeSort = option;
    this.args.onSelectSort?.(option);
  }

  @action onSelectView(viewId: string) {
    this.activeView = viewId;
    this.args.onSelectView?.(viewId);
  }

  @action onChangeFilter(filter: Filter) {
    this.activeFilter = filter;
    this.args.onChangeFilter?.(filter);
  }

  private get query() {
    if (!this.activeFilter) {
      return undefined;
    }
    return {
      ...this.activeFilter.query,
      sort: this.activeSort?.sort,
    };
  }
}
