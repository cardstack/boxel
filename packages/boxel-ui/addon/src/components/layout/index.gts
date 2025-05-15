// import { baseRealm, type Format, type Sort, type Query } from '@cardstack/runtime-common';
import CardsIcon from '@cardstack/boxel-icons/cards'; // TODO: copy icon
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { TrackedArray } from 'tracked-built-ins';

import cn from '../../helpers/cn.ts';
import { eq } from '../../helpers/truth-helpers.ts';
import IconGrid from '../../icons/icon-grid.gts';
import IconList from '../../icons/icon-list.gts';
import CardList from '../card-list/index.gts';
import FilterList, { type Filter } from '../filter-list/index.gts';
import SortDropdown, { type SortOption } from '../sort-dropdown/index.gts';
import ViewSelector, { type ViewItem } from '../view-selector/index.gts';

interface Signature {
  Args: {
    // Format
    context: any;
    filters?: Filter[];
    format: any;
    isLive?: boolean;
    // CardContext
    realms: URL[];
    sortOptions?: SortOption[];
    viewOptions?: ViewItem[];
  };
  Element: HTMLElement;
}

const defaultViewOptions: ViewItem[] = [
  { id: 'strip', icon: IconList },
  { id: 'grid', icon: IconGrid },
];

const defaultSortOptions: SortOption[] = [
  {
    displayName: 'A-Z',
    sort: [
      {
        on: {
          module: `https://cardstack.com/base/card-api`, // baseRealm.url
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

export default class BoxelLayout extends Component<Signature> {
  <template>
    <section
      class={{cn 'boxel-layout' strip-view=(eq this.activeView 'strip')}}
      ...attributes
    >
      <aside class='sidebar'>
        <FilterList
          @filters={{this.filters}}
          @activeFilter={{this.activeFilter}}
          @onChanged={{this.onChangeFilter}}
        />
      </aside>
      <section class='content'>
        <header
          class='content-header'
          aria-label={{this.activeFilter.displayName}}
        >
          <div class='title'>
            {{this.activeFilter.displayName}}
          </div>
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
        </header>
        {{#if this.query}}
          <CardList
            @format={{@format}}
            @context={{@context}}
            @query={{this.query}}
            @realms={{@realms}}
            @isLive={{@isLive}}
            data-test-cards-grid-cards
          />
        {{/if}}
      </section>
    </section>

    <style scoped>
      .boxel-layout {
        display: flex;
        gap: var(--boxel-sp-xl);
        width: 100%;
        max-width: 100%;
        height: 100%;
        max-height: 100vh;
        overflow: hidden;
      }
      .sidebar {
        position: relative;
      }
      .content {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
        width: 100%;
        max-width: 100%;
        overflow-y: auto;
      }
    </style>
  </template>

  private filters: Filter[] = new TrackedArray([
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
    this.args.sortOptions ?? defaultSortOptions,
  );
  private viewOptions: ViewItem[] = new TrackedArray(
    this.args.viewOptions ?? defaultViewOptions,
  );

  @tracked private activeSort?: SortOption = this.sortOptions[0];
  @tracked private activeFilter?: Filter = this.filters[0];
  @tracked private activeView?: ViewItem['id'] = this.viewOptions[0]?.id;

  @action onSelectSort(option: SortOption) {
    this.activeSort = option;
    // this.activeFilter = this.activeFilter;
  }

  @action onSelectView(view: ViewItem['id']) {
    this.activeView = view;
  }

  @action onChangeFilter(filter: Filter) {
    this.activeFilter = filter;
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
