import GlimmerComponent from '@glimmer/component';
import { type CardContext } from 'https://cardstack.com/base/card-api';
import {
  searchEntryWireQueryFromQuery,
  type Query,
  type SearchEntryWireQuery,
} from '@cardstack/runtime-common';

// 🧩 PATTERN: Generic CardsGrid with view selector.
//
// One reusable component for browse views — query in, fitted cards out,
// CSS handles per-view layout (card/strip/grid).

interface CardsGridSignature {
  Args: {
    query: Query;
    realms: string[];
    selectedView: 'card' | 'strip' | 'grid';
    context?: CardContext;
  };
  Element: HTMLUListElement;
}

export class CardsGrid extends GlimmerComponent<CardsGridSignature> {
  // Convert the incoming legacy Query into a search-entry query: attach
  // the realms to search and pin the fitted format. Search-entry queries
  // are live by default, so there's no @isLive to set.
  get searchQuery(): SearchEntryWireQuery {
    let q = searchEntryWireQueryFromQuery(this.args.query);
    return {
      ...q,
      realms: this.args.realms,
      filter: {
        ...q.filter,
        eq: { ...q.filter?.eq, htmlQuery: { eq: { format: 'fitted' } } },
      },
    };
  }

  <template>
    <ul
      class='cards {{@selectedView}}-view'
      data-test-cards-grid-cards
      ...attributes
    >
      <@context.searchResultsComponent
        @query={{this.searchQuery}}
        @mode='hover'
        as |results|
      >
        {{#if results.isLoading}}
          <li class='loading'>Loading…</li>
        {{/if}}
        {{#each results.entries key='id' as |entry|}}
          <li class='{{@selectedView}}-view-container'>
            <entry.component class='card' />
          </li>
        {{else}}
          <li class='empty'>No cards found.</li>
        {{/each}}
      </@context.searchResultsComponent>
    </ul>

    <style scoped>
      .cards {
        list-style: none;
        padding: 0;
        margin: 0;
      }
      .cards.card-view  { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; }
      .cards.strip-view { display: flex; flex-direction: column; gap: 0.5rem; }
      .cards.grid-view  { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 0.75rem; }
    </style>
  </template>
}

// === Usage ============================================================
//
//   import { CardsGrid } from './grid';
//   import { Listing } from './listing';
//
//   const listingModule = new URL('./listing', import.meta.url).href;
//
//   <CardsGrid
//     @query={{hash filter=(hash on=(hash module=listingModule name='Listing'))}}
//     @realms={{this.allRealms}}
//     @selectedView='card'
//     @context={{@context}}
//   />
