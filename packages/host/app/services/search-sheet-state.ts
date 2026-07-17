import type Owner from '@ember/owner';
import Service, { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import type {
  EntryCollectionDocument,
  RenderableSearchEntryLike,
  ResolvedCodeRef,
} from '@cardstack/runtime-common';

import { SectionPagination } from '../utils/search/section-pagination';

import type ResetService from './reset';
import type { SortOption } from '../components/search/constants';

// A snapshot of the last main-search results, retained across a sheet
// close/reopen so the sheet redisplays them immediately instead of flashing
// blank while its recreated search resource re-runs. The view-models wrap plain
// data + an inert HTML component, so they render safely after the resource that
// produced them is torn down.
export interface MainResultsSnapshot {
  entries: RenderableSearchEntryLike[];
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
  }
}

declare module '@ember/service' {
  interface Registry {
    'search-sheet-state': SearchSheetStateService;
  }
}
