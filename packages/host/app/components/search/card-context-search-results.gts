import Component from '@glimmer/component';

import { consume } from 'ember-provide-consume-context';

import {
  CardSearchDefaultRealmContextName,
  type SearchResultsComponentSignature,
} from '@cardstack/runtime-common';

import SearchResults from './search-results';

// The component the host provides on `@context.searchResultsComponent`. It is
// `<SearchResults>` with card-facing scoping baked in: a no-realm search
// targets the current realm (consumed from `CardSearchDefaultRealmContextName`,
// the realm the `@context` was provided with) instead of fanning out to every
// readable realm — the server-wide-blast-radius footgun of the raw all-realms
// fallback. Host-owned call sites (choosers, playground, the search sheet) use
// `<SearchResults>` directly and keep the all-realms default.
//
// A separate wrapper (rather than currying args onto `<SearchResults>` at the
// provider) is what lets the card surface opt in while the host surface stays
// unconstrained: cards render whatever `searchResultsComponent` resolves to and
// never pass `@cardInitiated` themselves.
export default class CardContextSearchResults extends Component<SearchResultsComponentSignature> {
  @consume(CardSearchDefaultRealmContextName)
  declare private defaultRealm: (() => string | undefined) | undefined;

  // Stable identity across renders (a class field, not a getter) so the
  // resource created once inside `<SearchResults>` keeps reading the same thunk;
  // the current realm itself is re-read lazily on each search.
  private getDefaultRealm = () => this.defaultRealm?.();

  <template>
    {{#if (has-block)}}
      <SearchResults
        @query={{@query}}
        @mode={{@mode}}
        @overlays={{@overlays}}
        @cardInitiated={{true}}
        @getDefaultRealm={{this.getDefaultRealm}}
        ...attributes
        as |results|
      >
        {{yield results}}
      </SearchResults>
    {{else}}
      <SearchResults
        @query={{@query}}
        @mode={{@mode}}
        @overlays={{@overlays}}
        @cardInitiated={{true}}
        @getDefaultRealm={{this.getDefaultRealm}}
        ...attributes
      />
    {{/if}}
  </template>
}
