import { isDestroyed, isDestroying } from '@ember/destroyable';
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
  type RenderableSearchEntry,
} from '../../resources/renderable-search-entries';

import type { HydrationMode } from './hydratable-card';

import type { MainResultsSnapshot } from '../../services/search-sheet-state';
import type StoreService from '../../services/store';

// The card-facing signature plus two host-only, optional extras used by the
// search sheet to persist and rehydrate its results across a close/reopen.
// They stay off the public `SearchResultsComponentSignature` (the `@context`
// contract cards see) and are absent for every other consumer — the card
// choosers, playground, and card authors — so their behavior is unchanged.
interface HostSearchResultsSignature {
  Element: SearchResultsComponentSignature['Element'];
  Args: SearchResultsComponentSignature['Args'] & {
    // A prior run's snapshot to adopt on mount instead of fetching, when it
    // belongs to the current query (forwarded to the search resource).
    seed?: MainResultsSnapshot;
    // Invoked with a fresh snapshot whenever the results settle, so the caller
    // can persist it for a later reopen.
    onSnapshot?: (snapshot: MainResultsSnapshot) => void;
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

  // Created once per component: the underlying search resource owns its realm
  // subscriptions and re-runs through the reactive query thunk, while the
  // view-model layer memoizes render-stable entries on top. The query varies
  // through the thunk, never by rebuilding this.
  private renderables = getRenderableSearchEntries(
    this,
    () => this.args.query,
    () => this.mode,
    () => this.overlays,
    () => this.args.seed,
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

  // Coalesces snapshot captures so a burst of renders schedules a single write.
  #snapshotCaptureScheduled = false;

  // When the caller opts in via `@onSnapshot`, hand it a snapshot of the raw
  // rows every time the results settle, so it can persist them for a later
  // reopen. Deferred into a microtask (like `SearchEntriesResource.modify`):
  // the callback typically mutates tracked state the render just consumed, so a
  // synchronous write would trip Glimmer's backtracking assertion. Guards: no
  // callback (the choosers), still loading (a transient empty re-run must not
  // be captured), or an idle query (no key to snapshot by). Re-runs when the
  // loading state or the raw rows change.
  private captureSnapshot = modifier(
    (_element: Element, [_isLoading, _rawEntries]: [boolean, unknown]) => {
      if (!this.args.onSnapshot || this.renderables.isLoading) {
        return;
      }
      if (this.args.query === undefined) {
        return;
      }
      if (this.#snapshotCaptureScheduled) {
        return;
      }
      this.#snapshotCaptureScheduled = true;
      void Promise.resolve().then(() => {
        this.#snapshotCaptureScheduled = false;
        if (isDestroyed(this) || isDestroying(this)) {
          return;
        }
        let query = this.args.query;
        if (!this.args.onSnapshot || this.renderables.isLoading || !query) {
          return;
        }
        this.args.onSnapshot({
          queryKey: JSON.stringify(query),
          entries: [...this.renderables.rawEntries],
          meta: this.renderables.meta,
        });
      });
    },
  );

  <template>
    <div
      class='search-results'
      {{this.inflateFullItems this.renderables.entries}}
      {{this.captureSnapshot
        this.renderables.isLoading
        this.renderables.rawEntries
      }}
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
