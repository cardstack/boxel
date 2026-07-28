import { service } from '@ember/service';
import Component from '@glimmer/component';

import { modifier } from 'ember-modifier';

import {
  logger as runtimeLogger,
  type SearchResultsComponentSignature,
  type SearchResultsYield,
} from '@cardstack/runtime-common';

import {
  getRenderableSearchEntries,
  RenderableSearchEntries,
  type RenderableSearchEntry,
} from '../../resources/renderable-search-entries';

import type { HydrationMode } from './hydratable-card';
import type { SearchEntriesResource } from '../../resources/search-entries';

import type StoreService from '../../services/store';

// The card-facing signature plus one host-only, optional extra: the search
// sheet hands in a service-owned search resource so its results survive the
// sheet's close/reopen (the resource outlives the component). It stays off the
// public `SearchResultsComponentSignature` (the `@context` contract cards see)
// and is absent for every other consumer — the card choosers, playground, and
// card authors — so their behavior is unchanged.
interface HostSearchResultsSignature {
  Element: SearchResultsComponentSignature['Element'];
  Args: SearchResultsComponentSignature['Args'] & {
    // A pre-built search resource (owned by the caller, e.g. the search-sheet
    // service) to render instead of the component's own. When present the
    // component varies nothing through `@query` — the resource's owner drives
    // it. When absent the component creates and owns its resource as before.
    resource?: SearchEntriesResource;
  };
  Blocks: SearchResultsComponentSignature['Blocks'];
}

// The one search component family. Consumes the heterogeneous `entry`
// stream from `getSearchEntriesResource` (through the shared render-stable
// view-model layer) and renders it transparently — prerendered HTML inert (the
// fast path, hydrated lazily on interaction) or the live serialization. Used
// with a block it yields a `results` object (`entries` / `isLoading` / `meta` /
// `errors`); used without one it renders the default stream of
// `entry.component`s itself. Additive: it supersedes the `prerendered-card-search`
// component and the live `SearchContent` tree as call sites migrate.
export default class SearchResults extends Component<HostSearchResultsSignature> {
  @service declare private store: StoreService;
  #log = runtimeLogger('search-results');

  private get mode(): HydrationMode {
    return this.args.mode ?? 'hover';
  }

  private get overlays(): boolean {
    return this.args.overlays ?? true;
  }

  // Created once per component: the view-model layer memoizes render-stable
  // entries on top of a search resource. With `@resource` it wraps the
  // caller-owned resource (whose subscriptions and re-runs outlive this
  // component); otherwise it creates and owns one, parented here, varying only
  // through the reactive `@query` thunk. Whether `@resource` is passed is fixed
  // for a given consumer (the sheet always, the choosers never), so branching
  // once at construction is sound.
  private renderables = this.args.resource
    ? new RenderableSearchEntries(
        this.args.resource,
        () => this.mode,
        () => this.overlays,
      )
    : getRenderableSearchEntries(
        this,
        () => this.args.query,
        () => this.mode,
        () => this.overlays,
      );

  private get results(): SearchResultsYield {
    return {
      entries: this.renderables.entries,
      isLoading: this.renderables.isLoading,
      meta: this.renderables.meta,
      errors: this.renderables.errors,
    };
  }

  // Selective Store inflate: deposit only full `item` serializations so a
  // by-URL read (or the hydration GET) resolves without a round-trip. Sparse
  // items and `entry`s are never deposited (the store method no-ops on a
  // sparse item); an item carrying an error doc is skipped here too — it stands
  // in for a card that failed to render and must not enter the Store. A
  // render-side effect keyed on the live entry set, so it deposits an
  // item-bearing row whenever one lands on a re-run.
  private inflateFullItems = modifier(
    (_element: Element, [entries]: [RenderableSearchEntry[]]) => {
      for (let entry of entries) {
        if (entry.item && !entry.itemErrorDoc) {
          // Fire-and-forget; a deposit failure (e.g. a malformed resource)
          // must not reject unhandled mid-render — the row still renders
          // (resolving its instance on demand) and the next re-run retries.
          this.store
            .inflateSearchEntryItem(entry.item)
            .catch((err: unknown) => {
              this.#log.error(`failed to inflate entry item ${entry.id}`, err);
            });
        }
      }
    },
  );

  <template>
    <div
      class='search-results'
      {{this.inflateFullItems this.renderables.entries}}
      data-test-search-results
      ...attributes
    >
      {{#if (has-block)}}
        {{yield this.results}}
      {{else}}
        {{#each this.results.entries key='id' as |entry|}}
          <entry.component data-test-search-result={{entry.id}} />
        {{/each}}
      {{/if}}
    </div>
    <style scoped>
      .search-results {
        display: contents;
      }
    </style>
  </template>
}
