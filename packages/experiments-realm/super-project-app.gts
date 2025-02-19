import { CardList } from './components/card-list';
import { CardListWithoutPrerendered } from './components/card-list-without-prerendered';
import { Layout, TitleGroup, type LayoutFilter } from './components/layout';
import { sortByCardTitleAsc } from './components/sort';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { tracked } from '@glimmer/tracking';
import { TrackedMap } from 'tracked-built-ins';
import { restartableTask } from 'ember-concurrency';

import {
  Component,
  realmURL,
  CardDef,
} from 'https://cardstack.com/base/card-api';

import { Query, CardError, SupportedMimeType } from '@cardstack/runtime-common';
import CalendarExclamation from '@cardstack/boxel-icons/calendar-exclamation';
import {
  Card as CardIcon,
  Grid3x3 as GridIcon,
  Rows4 as StripIcon,
} from '@cardstack/boxel-ui/icons';
import type { TemplateOnlyComponent } from '@ember/component/template-only';

type ViewOption = 'card' | 'strip' | 'grid';

interface ViewItem {
  icon: TemplateOnlyComponent<{
    Element: SVGElement;
  }>;
  id: ViewOption;
}

const ACCOUNT_FILTERS: LayoutFilter[] = [
  {
    displayName: 'All Super Project Accounts',
    icon: CalendarExclamation,
    cardTypeName: 'Super Project Account',
    createNewButtonText: 'Create Account',
  },
  // Add any additional filters based on your needs
];

class SuperProjectAppTemplate extends Component<typeof SuperProjectApp> {
  //filters
  filterMap: TrackedMap<string, LayoutFilter[]> = new TrackedMap([
    ['Super Project Account', ACCOUNT_FILTERS],
  ]);
  @tracked private activeFilter: LayoutFilter = ACCOUNT_FILTERS[0];
  @action private onFilterChange(filter: LayoutFilter) {
    this.activeFilter = filter;
  }

  get commonViews(): ViewItem[] {
    return [
      { id: 'card', icon: CardIcon },
      { id: 'strip', icon: StripIcon },
      { id: 'grid', icon: GridIcon },
    ];
  }

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
    let cardTypeSummaries = (await response.json()).data;
    console.log('cardTypeSummaries:', cardTypeSummaries);

    let filters = this.filterMap.get('Super Project Account');
    console.log('filters:', filters);

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
        this.filterMap.set('Super Project Account', filters);
      }
    }
  });

  get filters() {
    return this.filterMap.get('Super Project Account')!;
  }

  //misc
  get currentRealm() {
    return this.args.model[realmURL];
  }
  private get realms() {
    return [this.currentRealm!];
  }

  //query for filters
  get query() {
    const { loadAllFilters, activeFilter } = this;

    if (!loadAllFilters.isIdle || !activeFilter?.query) {
      return;
    }

    const defaultFilter = [
      {
        type: activeFilter.cardRef,
      },
      {
        on: activeFilter.cardRef,
        eq: {
          'superProjectApp.id': this.args.model.id,
        },
      },
    ];

    const query = {
      filter: {
        on: activeFilter.cardRef,
        every: [...defaultFilter],
      },
      sort: sortByCardTitleAsc,
    } as Query;

    return query;
  }

  <template>
    <Layout
      class='super-project-app'
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
      </:contentHeader>
      <:grid>
        {{#if this.query}}
          <h2>1. Original CardList (with PrerenderedCardSearch)</h2>
          <h3>Issue of this Method: Couldn't show query data inside
            embedded/other formats</h3>
          <ul>
            <li>Pros:
              <ul>
                <li>Better performance for static content due to prerendered
                  HTML</li>
                <li>Faster initial page load</li>
                <li>Has meta function support for additional data</li>
              </ul>
            </li>
            <li>Cons:
              <ul>
                <li>Cannot handle dynamic queries in embedded formats</li>
              </ul>
            </li>
          </ul>
          <CardList
            @context={{@context}}
            @query={{this.query}}
            @realms={{this.realms}}
            class='super-project-app-grid'
          />

          <hr />

          <h2>2. CardListWithoutPrerendered (using getCards API)</h2>
          <ul>
            <li>Pros:
              <ul>
                <li>Works consistently across all formats (embedded, isolated)</li>
                <li>Handles dynamic queries effectively</li>
                <li>Real-time data updates possible</li>
              </ul>
            </li>
            <li>Cons:
              <ul>
                <li>Slightly slower initial load compared to prerendered content
                  when a lot of cards are loaded</li>
                <li>Higher server load due to direct queries</li>
                <li>Currently lacks meta function support</li>
              </ul>
            </li>
          </ul>
          <CardListWithoutPrerendered
            @context={{@context}}
            @query={{this.query}}
            @realms={{this.realms}}
            class='super-project-app-grid'
          />
        {{/if}}
      </:grid>
    </Layout>
    <style scoped>
      .super-project-app {
        display: flex;
        width: 100%;
        max-width: 100%;
        height: 100%;
        max-height: 100vh;
        background-color: var(--boxel-light);
        overflow: hidden;
      }

      .super-project-app-grid {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xl);
      }
      hr {
        margin: var(--boxel-sp-xl) 0;
      }
    </style>
  </template>
}

export class SuperProjectApp extends CardDef {
  static displayName = 'Super Project App';
  static prefersWideFormat = true;
  static isolated = SuperProjectAppTemplate;
}
