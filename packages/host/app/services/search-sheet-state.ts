import type Owner from '@ember/owner';
import Service, { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import {
  baseRef,
  internalKeyFor,
  searchEntryWireQueryFromQuery,
  type Filter,
  type ResolvedCodeRef,
  type SearchEntryWireQuery,
} from '@cardstack/runtime-common';

import {
  SECTION_DISPLAY_LIMIT_FOCUSED,
  SORT_OPTIONS,
  type SortOption,
} from '../components/search/constants';
import { getSearchEntriesResource } from '../resources/search-entries';
import {
  buildSearchQuery,
  searchScopeForOptions,
} from '../utils/search/query-builder';
import { SectionPagination } from '../utils/search/section-pagination';
import { isSearchKeyEmpty, isURLSearchKey } from '../utils/search/url';

import type NetworkService from './network';
import type SessionService from './session';

// The operator-mode search sheet searches everything the index knows — cards
// (including specs, which the default `not: specRef` path excludes), field
// instances, and files. BaseDef is the common ancestor stamped on both the
// instance and file type chains, so this one ref spans all kinds; `scope: 'all'`
// rides the wire alongside (see `searchScopeForOptions`). Lives here because the
// service derives the sheet's query; the sheet component imports it for the
// picker + result-display logic.
export const SEARCH_SHEET_BASE_FILTER: Filter = { type: baseRef };

// In-memory, session-scoped store for the operator-mode search sheet. It owns
// the sheet's inputs (search key, filters, sort), the query derived from them,
// and — crucially — the live `SearchEntriesResource` itself. The sheet's
// `@mode`-gated subtree is destroyed on close, but this service is not, so the
// resource outlives the close/reopen: reopen is instant (no snapshot, no
// re-seed, no re-fetch), and the resource's realm subscriptions stay live while
// closed, so index/prerender events during the closed window are applied in the
// background. Deliberately NOT persisted to localStorage: a page reload clears
// it. Cleared on logout via the `session` service, following
// `RecentCardsService`. Scoped to the sheet only — the card choosers never read
// or write it (they don't opt in via `@persist`).
export default class SearchSheetStateService extends Service {
  @service declare private session: SessionService;
  @service declare private network: NetworkService;

  @tracked searchKey = '';
  @tracked selectedTypes: ResolvedCodeRef[] | undefined;
  @tracked selectedRealms: URL[] = [];
  @tracked activeSort: SortOption | undefined;
  @tracked activeViewId = 'grid';
  @tracked pagination = new SectionPagination();
  // The results-list scroll offset, restored on reopen. Memory-only like the
  // rest of this state — a page reload starts back at the top.
  @tracked resultsScrollTop = 0;
  // Bumped by an externally-triggered search (e.g. code mode's "Find
  // instances") so the sheet can remount its `SearchPanel` and re-read the
  // freshly-reset filter state. The panel's `selectedRealms`/`activeSort` and
  // its `TypeSummariesResource` selection are init-once (their public shape is
  // frozen), so a trigger while the sheet is already open would otherwise leave
  // stale filter chips displayed over a correctly-rescoped search.
  @tracked searchTriggerEpoch = 0;

  constructor(owner: Owner) {
    super(owner);
    this.session.register(this);
  }

  // Whether the sheet currently has an active search to run. Idle (=> no query,
  // => the resource collapses to an empty shell) when there's no search
  // criteria at all: no term, no type filter, and no realm scope. A type-only
  // or realm-only search is NOT idle — code mode's "Find instances" sets a type
  // with no term and must still search. This is what lets `resetState()`, which
  // clears all three, drive the resource idle.
  get hasActiveSearch(): boolean {
    return (
      !isSearchKeyEmpty(this.searchKey) ||
      (this.selectedTypes?.length ?? 0) > 0 ||
      this.selectedRealms.length > 0
    );
  }

  // The `entry` wire query for the sheet's main search, derived from the
  // service's own inputs (not the panel's asynchronously-restored filter
  // state), so a type-filtered reopen never transiently runs unfiltered. Built
  // through the shared `Query` builder via `searchEntryWireQueryFromQuery`.
  // Undefined leaves the search idle — a URL paste (handled by the sheet
  // separately) or a blank sheet with no criteria. The sheet is the mixed cards
  // + files search (`cardsOnly: false`), fitted rendering (no `htmlQuery`
  // override), so this omits the mini variant the card choosers' own
  // `PanelContent` query derivation applies.
  get mainQuery(): SearchEntryWireQuery | undefined {
    if (isURLSearchKey(this.searchKey) || !this.hasActiveSearch) {
      return undefined;
    }
    let selectedTypeIds = (this.selectedTypes ?? []).map((ref) =>
      internalKeyFor(ref, undefined, this.network.virtualNetwork),
    );
    return {
      ...searchEntryWireQueryFromQuery(
        buildSearchQuery(
          this.searchKey,
          this.activeSort ?? SORT_OPTIONS[0],
          SEARCH_SHEET_BASE_FILTER,
          selectedTypeIds,
          { cardsOnly: false },
        ),
        { scope: searchScopeForOptions({ cardsOnly: false }) },
      ),
      // Empty selection => the resource searches every available realm.
      realms: this.selectedRealms.map((url) => url.href),
      // Cap each realm's results at the focused-section display limit — the
      // most the sheet ever shows in one section. The search still reports the
      // full match count in `meta.page.total` (which drives the result-count
      // summary), so this only trims rows the sheet would never render.
      page: { size: SECTION_DISPLAY_LIMIT_FOCUSED },
    };
  }

  // The one session-scoped search resource, owned by the service (parented to
  // it via `Resource.from`, so destroyed exactly when the service is — one
  // instance per session, not a leak). Lazy: the proxy instantiates on first
  // property read, so a session that never opens search never creates it.
  mainSearch = getSearchEntriesResource(this, () => this.mainQuery);

  resetState() {
    this.searchKey = '';
    this.selectedTypes = undefined;
    this.selectedRealms = [];
    this.activeSort = undefined;
    this.activeViewId = 'grid';
    this.pagination = new SectionPagination();
    this.resultsScrollTop = 0;
    // Drive the resource to its dormant branch: with the key cleared `mainQuery`
    // is undefined, so a read of the resource runs `modify()` with no query,
    // which cancels the task, unsubscribes every realm, and clears rows/meta.
    // `modify()` only runs when the resource is read, though — if reset fires
    // while the sheet is closed (nothing rendering it), the idle query goes
    // unobserved and stale subscriptions keep firing. Touch it here so the idle
    // branch runs immediately. Safe outside render: the idle branch's
    // bookkeeping is synchronous + untracked, and its result-state clears are
    // deferred to a microtask.
    void this.mainSearch.entries;
  }
}

declare module '@ember/service' {
  interface Registry {
    'search-sheet-state': SearchSheetStateService;
  }
}
