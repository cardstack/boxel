import GlimmerComponent from '@glimmer/component';

import { type CardContext } from 'https://cardstack.com/base/card-api';

import {
  type Query,
  type RenderableSearchEntryLike,
  type SearchEntryWireQuery,
  searchEntryWireQueryFromQuery,
} from '@cardstack/runtime-common';

interface CardListSignature {
  Args: {
    query: Query;
    realms: string[];
    context?: CardContext;
  };
  Blocks: {
    meta: [card: RenderableSearchEntryLike];
  };
  Element: HTMLElement;
}
export class CardList extends GlimmerComponent<CardListSignature> {
  // The `entry`-rooted query, adapted from the incoming `Query`.
  // `embedded` is bound through the query's `htmlQuery` field (the way to
  // select a prerendered format); a bare `eq.format` would be read as an
  // `item.` field path and rejected.
  get searchResultsQuery(): SearchEntryWireQuery {
    let query = searchEntryWireQueryFromQuery(this.args.query);
    return {
      ...query,
      realms: this.args.realms,
      filter: {
        ...query.filter,
        eq: { ...query.filter?.eq, htmlQuery: { eq: { format: 'embedded' } } },
      },
    };
  }
  <template>
    <ul class='card-list' ...attributes>
      {{#let
        (component @context.searchResultsComponent)
        as |SearchResults|
      }}
        <SearchResults @query={{this.searchResultsQuery}} as |results|>
          {{#if results.isLoading}}
            Loading...
          {{/if}}
          {{#each results.entries key='id' as |card|}}
            <li class='card-list-item'>
              <card.component class='card' />
              {{#if (has-block 'meta')}}
                {{yield card to='meta'}}
              {{/if}}
            </li>
          {{/each}}
        </SearchResults>
      {{/let}}
    </ul>
    <style scoped>
      .card-list {
        display: grid;
        gap: var(--boxel-sp);
        list-style-type: none;
        margin: 0;
        padding: var(--boxel-sp-6xs);
      }
      .card-list-item {
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp) var(--boxel-sp-lg);
      }
      .card {
        height: auto;
        min-height: var(--embedded-card-min-height, 345px);
        max-width: var(--embedded-card-max-width, 100%);
      }
      .bordered-items > .card-list-item > * {
        border-radius: var(--boxel-border-radius);
        box-shadow: inset 0 0 0 1px var(--boxel-light-500);
      }
    </style>
  </template>
}
