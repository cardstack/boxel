import type Owner from '@ember/owner';
import Service, { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import type {
  EntryCollectionDocument,
  ResolvedCodeRef,
} from '@cardstack/runtime-common';

import { SectionPagination } from '../utils/search/section-pagination';

import type ResetService from './reset';
import type { SortOption } from '../components/search/constants';
import type { SearchEntry } from '../resources/search-entries';

// A snapshot of the last main-search results, retained across a sheet
// close/reopen so the recreated search resource can be *seeded* with them and
// skip its reopen fetch entirely — no blank "Searching…" flash, and no re-run
// for an unchanged query. These are the resource's own raw `SearchEntry` rows
// (prerendered HTML strings + the wire `item` serialization), so they are
// self-contained and safe to hold across the sheet teardown, and feed straight
// back into a fresh resource. `queryKey` is the serialized wire query the
// snapshot was captured under, so the sheet only reuses it for the same search
// it belongs to (a changed term/filter/sort re-runs normally).
export interface MainResultsSnapshot {
  queryKey: string;
  entries: SearchEntry[];
  meta: EntryCollectionDocument['meta'];
}

// In-memory, session-scoped store for the operator-mode search sheet. Lets the
// query, filters, view, pagination, and last results survive a sheet
// close/reopen within a session — the sheet's `@mode`-gated subtree is still
// destroyed on close, so this service (not the components) holds the state to
// rehydrate from. Deliberately NOT persisted to localStorage: a page reload
// clears it. Cleared on logout/realm reset via the `reset` service, following
// `RecentCardsService`. Scoped to the sheet only — the card choosers never read
// or write it (they don't opt in via `@persist`).
export default class SearchSheetStateService extends Service {
  @service declare private reset: ResetService;

  @tracked searchKey = '';
  @tracked selectedTypes: ResolvedCodeRef[] | undefined;
  @tracked selectedRealms: URL[] = [];
  @tracked activeSort: SortOption | undefined;
  @tracked activeViewId = 'grid';
  @tracked pagination = new SectionPagination();
  @tracked mainSnapshot: MainResultsSnapshot | undefined;
  // The results-list scroll offset, restored on reopen. Memory-only like the
  // rest of this state — a page reload starts back at the top.
  @tracked resultsScrollTop = 0;

  constructor(owner: Owner) {
    super(owner);
    this.reset.register(this);
  }

  resetState() {
    this.searchKey = '';
    this.selectedTypes = undefined;
    this.selectedRealms = [];
    this.activeSort = undefined;
    this.activeViewId = 'grid';
    this.pagination = new SectionPagination();
    this.mainSnapshot = undefined;
    this.resultsScrollTop = 0;
  }
}

declare module '@ember/service' {
  interface Registry {
    'search-sheet-state': SearchSheetStateService;
  }
}
