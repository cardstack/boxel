import {
  isDestroyed,
  isDestroying,
  registerDestructor,
} from '@ember/destroyable';
import { getOwner } from '@ember/owner';
import { service } from '@ember/service';
import { buildWaiter } from '@ember/test-waiters';
import { tracked } from '@glimmer/tracking';

import { didCancel, restartableTask } from 'ember-concurrency';
import { Resource } from 'ember-modify-based-class-resource';

import { isEqual } from 'lodash-es';
import { TrackedArray } from 'tracked-built-ins';

import {
  subscribeToRealm,
  Deferred,
  htmlQueryRenderingSelection,
  isCardResource,
  isCssResource,
  isFileMetaResource,
  isHtmlResource,
  isIconResource,
  logger as runtimeLogger,
  resourceIdentity,
  rri,
  wireFilterHasMatches,
  RealmPaths,
  type CardResource,
  type ErrorEntry,
  type FileMetaResource,
  type HtmlResource,
  type IconResource,
  type ResolvedCodeRef,
  type Saved,
  type StoreReadType,
  type EntryCollectionDocument,
  type SearchEntryRendering,
  type SearchEntryWireQuery,
} from '@cardstack/runtime-common';

import { knownFileMetaUrls } from '../lib/known-file-meta-urls';
import { normalizeRealms } from '../lib/realm-utils';
import { searchErrorEntry } from '../lib/search-error-entry';

import type LoaderService from '../services/loader-service';
import type NetworkService from '../services/network';
import type RealmServerService from '../services/realm-server';
import type { MainResultsSnapshot } from '../services/search-sheet-state';
import type StoreService from '../services/store';
import type {
  RealmEventContent,
  PrerenderHtmlEventContent,
} from '@cardstack/base/matrix-event';

const waiter = buildWaiter('search-entries-resource:search-waiter');

// `SearchEntryRendering` is the card-facing rendering view-model (it rides the
// `@context` search surface), so it lives in runtime-common; re-exported
// here because this resource builds it and call sites import it from here.
export type { SearchEntryRendering };

// One search result, joined from the wire document: the `entry`
// resource plus the `html` renderings and/or `item` serialization it
// references in `included`. An empty `html` array means the entry matched but
// no rendering satisfies the query's htmlQuery yet — the invalidation re-run
// refreshes it when the rendering lands. The `item` is the raw wire
// serialization (sparse when it carries `meta.sparseFields`), never a store
// instance: entries live outside the store and are owned by the re-run; a
// row a consumer has hydrated is owned by the store's reactive reload
// instead.
export interface SearchEntry {
  id: string;
  realmUrl: string;
  html: SearchEntryRendering[];
  item?: CardResource<Saved> | FileMetaResource;
  // The result's card-type descriptor, resolved from the deduped `icon`
  // resource (absent when the row's native type carries none). Lives on the
  // entry, not the rendering, so a no-HTML row still exposes it: the type's
  // icon HTML, display name, and code ref.
  iconHtml?: string;
  displayName?: string;
  codeRef?: ResolvedCodeRef;
  // The two generations the row was served at (from response `meta`),
  // independent channels: the index-data generation and the generation the
  // chosen rendering was produced at (absent when the row carries no
  // rendering). The selective refresh reads them to decide whether a
  // `prerender_html` event carries newer HTML for this member and to
  // reconstruct the composite validator it sends as `If-None-Match`.
  indexGeneration?: number;
  htmlGeneration?: number;
}

interface Args {
  named: {
    query: SearchEntryWireQuery | undefined;
    // A snapshot of a prior run's results to adopt on the first modify instead
    // of fetching, when it belongs to this exact query. Used by the search
    // sheet to rehydrate on reopen with no re-run; other consumers omit it.
    seed?: MainResultsSnapshot;
  };
}

export class SearchEntriesResource extends Resource<Args> {
  @service declare private loaderService: LoaderService;
  @service declare private network: NetworkService;
  @service declare private realmServer: RealmServerService;
  @service declare private store: StoreService;

  private realmsToSearch: string[] = [];
  private subscriptions: { realm: string; unsubscribe: () => void }[] = [];
  private _entries = new TrackedArray<SearchEntry>();
  @tracked private _meta: EntryCollectionDocument['meta'] = {
    page: { total: 0 },
  };
  @tracked private _errors: ErrorEntry[] | undefined;

  // Realms whose index moved since the last fetch. A non-empty set scopes the
  // next run to just those realms (the per-realm partial refresh); rows from
  // other realms keep their identity. Only the subscription callback writes
  // it and only the search task reads it, so a plain Set suffices — modify()
  // never consumes it, which is what would create a tracking hazard.
  private realmsNeedingRefresh = new Set<string>();

  // The coalesced prerender_html invalidations queued for a selective
  // per-member refresh: invalidated URL → the highest generation an event
  // carried for it (generations are per-realm counters, so they are never
  // compared across URLs from different realms). Set only for structured,
  // refreshable queries (a prerender_html event can't change their
  // membership, so the visible members need only their HTML refreshed, not a
  // whole-search re-query). An index event supersedes it — the search task
  // consumes or folds it, never drops it silently. Untracked, like
  // `realmsNeedingRefresh`.
  private pendingSelectiveRefresh: Map<string, number> | undefined;

  // Bumped by every search-task run (and on teardown) so an in-flight
  // `#computeSelectiveRefresh` from a superseded run stops issuing GETs: the
  // task body's awaits are cancellable, but a plain async method keeps
  // executing after its caller was cancelled, and without this check it
  // would keep fetching members the replacement run already owns.
  #refreshEpoch = 0;

  // A partial refresh splices fetched-realm rows into the standing result
  // set, so it is only sound once a full run has populated that set. Until
  // then every run fetches all realms (an event arriving during the initial
  // fetch must not narrow it).
  private hasCompletedFullRun = false;

  #previousQuery: SearchEntryWireQuery | undefined;
  #previousRealms: string[] | undefined;
  // One-shot: a handed-in seed is adopted at most once, on the first modify of
  // this instance. Once spent, every later query change — including re-typing a
  // key that was used before — takes the normal fetch path, never the seed.
  #seedConsumed = false;
  #idleClearScheduled = false;
  #log = runtimeLogger('search-entries-resource');
  // Kept private for tests/internal load bookkeeping.
  // @ts-ignore read only via the test cast.
  private loaded: Promise<void> | undefined;

  constructor(owner: object) {
    super(owner);
    registerDestructor(this, () => {
      this.search.cancelAll();
      for (let subscription of this.subscriptions) {
        subscription.unsubscribe();
      }
      this.subscriptions = [];
      this.realmsNeedingRefresh.clear();
      this.pendingSelectiveRefresh = undefined;
      this.#refreshEpoch++;
    });
  }

  // The store whose readiness signal the active render context awaits. During a
  // prerender the render route settles on the *render* store's `loaded()` /
  // `loadGeneration` (`routes/render.ts` `#waitForRenderLoadStability`), while a
  // component's injected `store` service is the live SPA store — so the search
  // fetch and its load-tracking must run against the render store for the
  // prerender to wait for results before HTML capture. Outside a prerender
  // (the live SPA) this is the injected store. Mirrors how
  // `prerendered-card-search` and the v1 `SearchResource` route render-context
  // work through the render store.
  private get runtimeStore(): StoreService {
    // Strict `=== true` to match the prerender header / job-priority helpers
    // (`prerender-fetch-headers.ts`, `resolveOutboundJobPriority`): store
    // selection and header emission must agree, so a search routed to the
    // render store is also sent with prerender headers.
    if ((globalThis as any).__boxelRenderContext === true) {
      let renderStore = getOwner(this)?.lookup('service:render-store') as
        | StoreService
        | undefined;
      if (renderStore) {
        return renderStore;
      }
    }
    return this.store;
  }

  // Register an in-flight search with the render store's readiness signal. The
  // prerender settle loop awaits `store.loaded()` and watches `loadGeneration`;
  // `trackLoad` bumps the generation the moment a search starts and keeps the
  // load pending until it resolves, so a prerender of a card rendering this
  // surface waits for results before HTML capture. The html-only branch
  // deposits nothing into the store, so without this nothing else would move
  // the generation. Mirrors the v1 `SearchResource`. The `@ember/test-waiter`
  // inside the task stays — it backs `settled()`, an orthogonal signal. Also
  // kept on `this.loaded` for the test/internal bookkeeping.
  #trackSearchLoad(load: Promise<void>): void {
    this.loaded = load;
    this.runtimeStore.trackLoad(load);
  }

  modify(_positional: never[], named: Args['named']) {
    let { query, seed } = named;

    if (query === undefined) {
      // Clear stale state so live subscriptions don't re-fire the old query.
      // The untracked bookkeeping clears synchronously; the tracked result
      // state must not — modify() runs inside a tracked computation (a
      // property access on the resource proxy, typically mid-render), so a
      // synchronous read-then-write of `_entries` would trip Glimmer's
      // mutation-after-consumption assertion and self-invalidate this
      // resource's cache on every access.
      this.#previousQuery = undefined;
      this.#previousRealms = undefined;
      this.realmsNeedingRefresh.clear();
      this.pendingSelectiveRefresh = undefined;
      // An in-flight selective refresh must stop issuing GETs for the
      // cleared query, same as on teardown.
      this.#refreshEpoch++;
      this.hasCompletedFullRun = false;
      this.search.cancelAll();
      for (let subscription of this.subscriptions) {
        subscription.unsubscribe();
      }
      this.subscriptions = [];
      if (!this.#idleClearScheduled) {
        this.#idleClearScheduled = true;
        void Promise.resolve().then(() => {
          this.#idleClearScheduled = false;
          // Apply only if still idle and alive — a query may have arrived
          // (or the resource been torn down) between schedule and flush.
          if (this.#previousQuery !== undefined || isDestroyed(this)) {
            return;
          }
          if (this._entries.length > 0) {
            this._entries.splice(0, this._entries.length);
          }
          if (this._meta.page.total !== 0 || this._meta.htmlQuery) {
            this._meta = { page: { total: 0 } };
          }
          if (this._errors !== undefined) {
            this._errors = undefined;
          }
        });
      }
      return;
    }

    let realms = normalizeRealms(
      query.realms && query.realms.length > 0
        ? query.realms
        : this.realmServer.availableRealmIdentifiers,
    );
    this.realmsToSearch = realms;

    let realmsChanged = !isEqual(realms, this.#previousRealms);
    if (this.subscriptions.length === 0 || realmsChanged) {
      for (let subscription of this.subscriptions) {
        subscription.unsubscribe();
      }
      this.subscriptions = realms.map((realm) => ({
        realm,
        unsubscribe: subscribeToRealm(realm, (event: RealmEventContent) => {
          if (this.#previousQuery === undefined) {
            return;
          }
          // Two triggers re-run a subscribed search: an incremental index
          // event (the search doc — and so membership — changed) and a
          // prerender_html event (fresh HTML / corrected full-text membership
          // landed on its own channel after the index pass).
          let isIncrementalIndex =
            event.eventName === 'index' &&
            (!('indexType' in event) || event.indexType === 'incremental');
          if (!isIncrementalIndex && event.eventName !== 'prerender_html') {
            return;
          }

          // A prerender_html event can't change a structured query's
          // membership — only its members' renderings. So for a structured,
          // refreshable query, refresh just the members the event carries
          // newer HTML for, through a conditional card+html GET, instead of
          // re-querying the whole realm. Full-text (matches) queries,
          // paginated queries, composite/sparse selections, and a malformed
          // event (no usable generation to judge staleness by) can't refresh
          // in isolation and fall through to the coarse re-run.
          if (
            event.eventName === 'prerender_html' &&
            typeof event.generation === 'number' &&
            this.#canSelectivelyRefresh()
          ) {
            this.#log.info(
              `prerender_html event on ${realm}; scheduling selective per-member refresh`,
            );
            this.#recordSelectiveRefresh(event);
            this.#trackSearchLoad(this.search.perform());
            return;
          }

          this.#log.info(
            `${event.eventName === 'prerender_html' ? 'prerender_html' : 'incremental index'} event on ${realm}; scheduling partial refresh`,
          );
          this.realmsNeedingRefresh.add(realm);
          this.#trackSearchLoad(this.search.perform());
        }),
      }));
    }

    let queryChanged = !isEqual(query, this.#previousQuery);
    if (!queryChanged && !realmsChanged) {
      return;
    }

    // Snapshot, don't alias: a caller that mutates a long-lived query object
    // in place would otherwise be compared against itself and never re-run.
    this.#previousQuery = structuredClone(query);
    this.#previousRealms = realms;
    // A query/realm change owns the whole result set again.
    this.realmsNeedingRefresh.clear();
    this.pendingSelectiveRefresh = undefined;
    this.hasCompletedFullRun = false;

    // Seed-and-skip: on the first modify of a freshly-mounted resource, if a
    // snapshot for this exact query was handed in (the search sheet reopening
    // with an unchanged search), adopt its rows and skip the fetch — no re-run,
    // no "Searching…" flash. Subscriptions were already (re)established above,
    // so a live index event still refreshes these rows while the sheet is open.
    // One-shot via `#seedConsumed`, and gated on the query match, so any later
    // query change — including re-typing the same key after changing it — falls
    // through to the fetch below. The result state is applied out of this render
    // (a microtask, the same escape hatch the fetch path uses): mutating the
    // tracked `_entries` / `_meta` synchronously here would trip Glimmer's
    // backtracking assertion. The rows land right after this render, before
    // paint, so there is no visible empty frame — and, crucially, no fetch.
    if (
      !this.#seedConsumed &&
      seed !== undefined &&
      seed.queryKey === JSON.stringify(query)
    ) {
      this.#seedConsumed = true;
      let seeded = seed;
      // Mark the run complete synchronously (a plain field, so no tracked
      // mutation mid-render) so `isLoading` reads false immediately — the
      // seeded rows are presented as settled, not loading. The tracked result
      // state itself must still be applied out of this render (a microtask, the
      // same escape hatch the fetch path uses): mutating `_entries` / `_meta`
      // synchronously here would trip Glimmer's backtracking assertion. The
      // rows land right after this render, before paint — no fetch, no flash.
      this.hasCompletedFullRun = true;
      void Promise.resolve().then(() => {
        if (isDestroyed(this) || isDestroying(this)) {
          return;
        }
        this._entries.splice(0, this._entries.length, ...seeded.entries);
        this._meta = seeded.meta;
        this._errors = undefined;
      });
      return;
    }

    // Start the search out of the render that triggered this modify. A consumer
    // reads the task's `isRunning` (through `isLoading`) during render, so a
    // synchronous `perform()` here — which flips `isRunning` — would mutate a
    // value already consumed in the same computation, tripping Glimmer's
    // backtracking assertion (a `<SearchResults>` mounting with a query already
    // set — a chooser or the playground — hits this). Register the load
    // synchronously (via a Deferred) so a prerender still waits for the search,
    // but defer the task start a microtask so its `isRunning` write lands after
    // the render. `isLoading` below still reports loading across that gap.
    let loaded = new Deferred<void>();
    this.#trackSearchLoad(loaded.promise);
    void Promise.resolve().then(() => {
      if (isDestroyed(this) || isDestroying(this)) {
        loaded.fulfill();
        return;
      }
      this.search.perform().then(
        () => loaded.fulfill(),
        () => loaded.fulfill(),
      );
    });
  }

  get isLoading() {
    // In flight when the task is running, and also across the microtask gap
    // between a query being set in modify() and the deferred task actually
    // starting — otherwise a just-set query briefly reads as
    // settled-with-no-results (which e.g. makes the playground autogenerate a
    // blank instance). `#previousQuery` / `hasCompletedFullRun` are plain
    // fields — reading them here, and writing them in modify(), never mutates
    // tracked state mid-render (that would backtrack); the tracked `isRunning`
    // dependency drives recomputation.
    return (
      this.search.isRunning ||
      (this.#previousQuery !== undefined && !this.hasCompletedFullRun)
    );
  }

  get entries(): SearchEntry[] {
    return this._entries;
  }

  get meta() {
    return this._meta;
  }

  get errors() {
    return this._errors;
  }

  private search = restartableTask(async () => {
    let query = this.#previousQuery;
    if (query === undefined) {
      return;
    }
    let token = waiter.beginAsync();
    this.#refreshEpoch++;
    try {
      // A prerender_html event queued a selective per-member refresh. Perform
      // the targeted card+html GETs when no index event is also pending (an
      // index event changes membership and supersedes it) and the query still
      // supports it; otherwise fold the queued invalidations into the coarse
      // re-run. The queue is consumed only at the point its content is
      // applied or folded — never at task start — so a restart that cancels
      // this run mid-GET (any later realm event re-performs this restartable
      // task) leaves it queued for the replacement run instead of dropping
      // it. The compute is pure and the mutations happen here in the task
      // body, whose awaits are cancellation points — a cancelled run can
      // never splice its (now superseded) result into the entries.
      let selective = this.pendingSelectiveRefresh;
      if (selective) {
        if (
          this.realmsNeedingRefresh.size === 0 &&
          this.#canSelectivelyRefresh()
        ) {
          let refresh = await this.#computeSelectiveRefresh(selective, query);
          if (refresh !== 'fallback') {
            if (refresh.size > 0) {
              // Splice in place, preserving object identity for every member
              // whose visible content didn't change (a 200 can advance only
              // the stamps), so unchanged rows never re-render or lose
              // hydration.
              let next = this._entries.map((member) => {
                let replacement = refresh.get(member.id);
                return replacement === undefined
                  ? member
                  : adoptFresh(member, replacement);
              });
              this._entries.splice(0, this._entries.length, ...next);
              this._errors = undefined;
            }
            // Membership is stable across a prerender_html event, so the
            // standing set, order, and `meta` all remain correct. The queued
            // invalidations are exactly what was just applied — an event
            // arriving mid-run would have restarted this task before this
            // line.
            this.pendingSelectiveRefresh = undefined;
            return;
          }
          // A member couldn't be refreshed in isolation (a GET failed or the
          // response was malformed) — fall through to a coarse re-run over
          // the realms the queued invalidations spanned.
        }
        this.pendingSelectiveRefresh = undefined;
        this.#foldSelectiveRealmsIntoRefresh(selective);
      }

      // A paginated query never takes the realm-scoped path: with the held
      // rows page-limited, no whole-set total can be reconstituted from a
      // realm-subset fetch — the full re-run keeps `meta` server-accurate.
      let isPartialRefresh =
        this.hasCompletedFullRun &&
        this.realmsNeedingRefresh.size > 0 &&
        query.page === undefined;
      let realmsToFetch = isPartialRefresh
        ? [...this.realmsNeedingRefresh]
        : this.realmsToSearch;

      try {
        let doc = await this.runtimeStore.searchEntries(query, realmsToFetch);
        await this.loadStylesheets(doc);
        let fresh = this.buildEntries(doc);

        if (isPartialRefresh) {
          // Merge in place: rows from unfetched realms keep their position
          // and identity; a refreshed row that survives keeps its position
          // (and its identity when nothing about it changed); vanished rows
          // drop out; new rows append. Live updates must not reshuffle the
          // visible list, and unchanged rows must stay render-stable.
          let refreshedRealms = new Set(realmsToFetch);
          let freshById = new Map(fresh.map((entry) => [entry.id, entry]));
          let merged: SearchEntry[] = [];
          for (let entry of this._entries) {
            if (!refreshedRealms.has(entry.realmUrl)) {
              merged.push(entry);
              continue;
            }
            let replacement = freshById.get(entry.id);
            if (replacement !== undefined) {
              merged.push(adoptFresh(entry, replacement));
              freshById.delete(entry.id);
            }
          }
          merged.push(...freshById.values());
          this._entries.splice(0, this._entries.length, ...merged);
          // Unpaginated (a partial refresh precondition), so the standing
          // entry count is the exact whole-set total; the response's total
          // only speaks for the fetched realm subset.
          this._meta = {
            ...this._meta,
            page: { total: this._entries.length },
          };
        } else {
          // Server order is authoritative on a full run, but an unchanged
          // row keeps its object identity so live re-runs don't force every
          // row to re-render.
          let previousById = new Map(
            this._entries.map((entry) => [entry.id, entry]),
          );
          let next = fresh.map((entry) =>
            adoptFresh(previousById.get(entry.id), entry),
          );
          this._entries.splice(0, this._entries.length, ...next);
          this._meta = doc.meta;
          this.hasCompletedFullRun = true;
        }

        this.realmsNeedingRefresh.clear();
        this._errors = undefined;
      } catch (err) {
        if (didCancel(err)) {
          throw err;
        }
        this.#log.error(`search-entries fetch failed`, err);
        this._errors = [searchErrorEntry(err)];
        if (!isPartialRefresh) {
          this._entries.splice(0, this._entries.length);
          this._meta = { page: { total: 0 } };
        }
        // On a failed partial refresh the stale rows stay (with the error
        // surfaced) and the realms stay marked, so the next event retries
        // them.
      }
    } finally {
      waiter.endAsync(token);
    }
  });

  // Whether the current query supports a selective per-member refresh on a
  // prerender_html event, rather than a whole-search re-query. Requires a
  // standing result set to splice into, and a query whose members can be
  // refreshed one URL at a time through the card+html GET: not paginated (the
  // held rows are page-limited, so no splice), not full-text (matches
  // membership can change), and with a rendering selection / fieldset the GET
  // can spell as query params. When false the prerender_html event falls
  // through to the coarse re-run, which handles every case.
  #canSelectivelyRefresh(): boolean {
    let query = this.#previousQuery;
    if (query === undefined || !this.hasCompletedFullRun) {
      return false;
    }
    if (query.page !== undefined) {
      return false;
    }
    if (wireFilterHasMatches(query.filter)) {
      return false;
    }
    // A composite htmlQuery has no ?format=/?renderType= spelling.
    if (
      this._meta.htmlQuery !== undefined &&
      htmlQueryRenderingSelection(this._meta.htmlQuery) === undefined
    ) {
      return false;
    }
    // The GET's ?fields= serves only html / item / html,item; a sparse
    // item.<field> selection has no query-string spelling.
    return this.#fieldsetIsRefreshable(query.fields?.entry);
  }

  // Refreshable = the html branch is in play (the default resolution or an
  // explicit `html`) and any other selection is `item`. An item-only fieldset
  // is NOT refreshable even though the GET could spell it: without the html
  // branch the search runs the live-search projection, which excludes rows
  // with an effective error — and a render error lands on the
  // prerendered_html channel, so such a query's membership can flip on the
  // very event being routed. It takes the coarse re-run instead.
  #fieldsetIsRefreshable(fields: string[] | undefined): boolean {
    return (
      fields === undefined ||
      (fields.includes('html') &&
        fields.every((field) => field === 'html' || field === 'item'))
    );
  }

  // Merge a prerender_html event into the queued selective refresh, taking
  // the max generation per URL (a member is a candidate when an event carried
  // HTML newer than the one it holds; the GET returns the newest rendering
  // regardless).
  #recordSelectiveRefresh(event: PrerenderHtmlEventContent): void {
    let pending = (this.pendingSelectiveRefresh ??= new Map());
    for (let url of event.invalidations ?? []) {
      pending.set(url, Math.max(pending.get(url) ?? 0, event.generation));
    }
  }

  // When a selective refresh can't run (superseded by an index event, or a
  // member GET failed), fold the realms the queued invalidations spanned into
  // the coarse re-run so their prerender_html update still lands. A different
  // realm's index event must not swallow this realm's HTML update.
  #foldSelectiveRealmsIntoRefresh(invalidations: Map<string, number>): void {
    for (let member of this._entries) {
      if (invalidationGenerationFor(member, invalidations) !== undefined) {
        this.realmsNeedingRefresh.add(member.realmUrl);
      }
    }
  }

  // Compute the replacements for the members a prerender_html event carries
  // newer HTML for, each through a conditional card+html GET keyed on the
  // composite validator the member holds: a `304` keeps the current rendering
  // (the member is skipped, so its identity — and any hydration — survives),
  // a `200` yields the fresh entry. Pure with respect to the resource's
  // result state: the task body applies the returned map, so a run cancelled
  // mid-GET can never splice a superseded result (this method keeps executing
  // after its caller is cancelled — a plain async method has no cancellation
  // points — which is also why it re-checks `#refreshEpoch` between GETs).
  // Nothing is written to the store — a member a consumer has hydrated is
  // owned by the store's reactive reload. Returns 'fallback' to request a
  // coarse re-run when a member can't be refreshed in isolation.
  async #computeSelectiveRefresh(
    invalidations: Map<string, number>,
    query: SearchEntryWireQuery,
  ): Promise<Map<string, SearchEntry> | 'fallback'> {
    let epoch = this.#refreshEpoch;
    let selection = htmlQueryRenderingSelection(this._meta.htmlQuery);
    let fieldsParam = this.#fieldsParam(query.fields?.entry);

    // A member with a rendering is a candidate only when an event names it at
    // a newer generation than it holds; one with no rendering yet is always a
    // candidate (the upgrade opportunity this event may be announcing).
    // Content that changes WITHOUT a generation advance (a generation reused
    // after a failed commit) is invisible to this gate — and equally to the
    // composite validator, which would `304` such a member anyway — so those
    // heal on the next generation advance rather than here.
    let candidates = this._entries.filter((member) => {
      let eventGeneration = invalidationGenerationFor(member, invalidations);
      if (eventGeneration === undefined) {
        return false;
      }
      return (
        member.htmlGeneration === undefined ||
        member.htmlGeneration < eventGeneration
      );
    });

    let replacements = new Map<string, SearchEntry>();
    for (let member of candidates) {
      if (epoch !== this.#refreshEpoch || isDestroyed(this)) {
        // A newer run (or teardown) superseded this one: stop fetching. The
        // returned value is discarded — the cancelled caller never resumes.
        return replacements;
      }
      // The whole per-member pipeline falls back on any failure — the GET,
      // the stylesheet imports, and the rebuild alike — so a member that
      // can't be refreshed in isolation always reaches the coarse re-run.
      try {
        let result = await this.runtimeStore.fetchCardEntry(member.id, {
          kind: memberKind(member),
          format: selection?.format,
          renderType: selection?.renderType,
          fields: fieldsParam,
          ifNoneMatch: memberValidator(member),
        });
        if (result.notModified) {
          continue;
        }
        // Reuse the collection builders: wrap the single doc so the refreshed
        // member is shaped exactly as the search would have returned it.
        let collectionDoc: EntryCollectionDocument = {
          data: [result.doc.data],
          included: result.doc.included,
          meta: { page: { total: 1 } },
        };
        await this.loadStylesheets(collectionDoc);
        let [refreshed] = this.buildEntries(collectionDoc);
        if (refreshed === undefined) {
          return 'fallback';
        }
        replacements.set(member.id, refreshed);
      } catch (err) {
        this.#log.warn(
          `selective refresh failed for ${member.id}; falling back to a full re-run`,
          err,
        );
        return 'fallback';
      }
    }
    return replacements;
  }

  // The ?fields= value mirroring the query's entry fieldset (validated
  // refreshable by `#fieldsetIsRefreshable`); undefined for the default
  // resolution.
  #fieldsParam(fields: string[] | undefined): string | undefined {
    return fields === undefined ? undefined : fields.join(',');
  }

  // The `css` resources base64-embed their whole stylesheet in the href; the
  // loader import is what registers each scoped stylesheet with the document,
  // so entries are paint-ready when exposed.
  private async loadStylesheets(doc: EntryCollectionDocument) {
    let hrefs = (doc.included ?? [])
      .filter(isCssResource)
      .map((resource) => resource.attributes.href);
    await Promise.all(
      hrefs.map((href) => this.loaderService.loader.import(href)),
    );
  }

  private buildEntries(doc: EntryCollectionDocument): SearchEntry[] {
    let htmlById = new Map<string, HtmlResource>();
    let cssHrefById = new Map<string, string>();
    let iconById = new Map<string, IconResource['attributes']>();
    let itemsByIdentity = new Map<
      string,
      CardResource<Saved> | FileMetaResource
    >();
    for (let resource of doc.included ?? []) {
      if (isHtmlResource(resource)) {
        htmlById.set(resource.id, resource);
      } else if (isCssResource(resource)) {
        cssHrefById.set(resource.id, resource.attributes.href);
      } else if (isIconResource(resource)) {
        iconById.set(resource.id, resource.attributes);
      } else if (isCardResource(resource) || isFileMetaResource(resource)) {
        itemsByIdentity.set(
          resourceIdentity(resource.type, resource.id),
          resource,
        );
      }
    }

    // One RealmPaths per searched realm per build — not per entry.
    let realmPaths = this.realmsToSearch.map(
      (realm) => new RealmPaths(new URL(realm)),
    );
    let realmUrlFor = (id: string): string => {
      let idRRI = rri(id);
      for (let paths of realmPaths) {
        if (paths.inRealm(idRRI)) {
          return paths.url;
        }
      }
      return new RealmPaths(this.network.virtualNetwork.toURL(id)).url;
    };

    return doc.data.map((entry) => {
      let htmlResources = (entry.relationships.html?.data ?? [])
        .map((ref) => htmlById.get(ref.id))
        .filter(Boolean) as HtmlResource[];
      let renderings = htmlResources.map((html) =>
        buildRendering(html, cssHrefById),
      );
      // The chosen rendering's generation (all of a row's renderings share the
      // per-row `prerendered_html.generation`, so the first is authoritative).
      let htmlGeneration = htmlResources[0]?.meta?.generation;
      let itemRef = entry.relationships.item?.data;
      let item = itemRef
        ? itemsByIdentity.get(resourceIdentity(itemRef.type, itemRef.id))
        : undefined;
      let iconRef = entry.relationships.icon?.data;
      let icon = iconRef ? iconById.get(iconRef.id) : undefined;
      // Remember which result URLs are files. A file row's `file-meta`
      // serialization is HTML-only / never stored, so the operator-mode
      // click + overlay path (`lib/stack-item.ts`,
      // `operator-mode-overlays.gts`) can't classify it as a file from the
      // Store — it consults this registry instead. A file is an `item` of
      // type `file-meta`, or an html-backed row whose rendering carries no
      // render type (files render natively; card renderings always name one).
      // Mirrors what the v1 `PrerenderedCard` wrapper registered.
      let isFile =
        itemRef?.type === 'file-meta' ||
        (renderings.length > 0 && !renderings[0].renderType);
      if (isFile) {
        knownFileMetaUrls.add(entry.id);
      }
      return {
        id: entry.id,
        realmUrl: realmUrlFor(entry.id),
        html: renderings,
        ...(item ? { item } : {}),
        ...(icon
          ? {
              iconHtml: icon.iconHtml,
              displayName: icon.displayName,
              codeRef: icon.codeRef,
            }
          : {}),
        ...(entry.meta?.generation !== undefined
          ? { indexGeneration: entry.meta.generation }
          : {}),
        ...(htmlGeneration !== undefined ? { htmlGeneration } : {}),
      };
    });
  }
}

function buildRendering(
  html: HtmlResource,
  cssHrefById: Map<string, string>,
): SearchEntryRendering {
  let { attributes, relationships } = html;
  return {
    id: html.id,
    ...(attributes.html !== undefined ? { html: attributes.html } : {}),
    cardType: attributes.cardType,
    isError: Boolean(attributes.isError),
    format: attributes.format,
    ...(attributes.renderType ? { renderType: attributes.renderType } : {}),
    cssUrls: relationships.styles.data
      .map(({ id }) => cssHrefById.get(id))
      .filter((href): href is string => Boolean(href)),
  };
}

// Render-stability identity. The generation stamps are freshness metadata the
// refresh machinery reads — no template consumes them — so a row whose
// visible content is unchanged keeps its object identity even when a
// re-index bumped its stamps: the fresh stamps are copied onto the retained
// object instead (plain untracked fields, so the mutation re-renders
// nothing). Without this, the invalidation fan-out — which re-indexes
// dependents whose content is often byte-identical — would remount every
// dependent row (and drop its hydration) on every edit.
function adoptFresh(
  previous: SearchEntry | undefined,
  fresh: SearchEntry,
): SearchEntry {
  if (previous === undefined || !contentEquals(previous, fresh)) {
    return fresh;
  }
  if (fresh.indexGeneration !== undefined) {
    previous.indexGeneration = fresh.indexGeneration;
  } else {
    delete previous.indexGeneration;
  }
  if (fresh.htmlGeneration !== undefined) {
    previous.htmlGeneration = fresh.htmlGeneration;
  } else {
    delete previous.htmlGeneration;
  }
  return previous;
}

function contentEquals(a: SearchEntry, b: SearchEntry): boolean {
  let {
    indexGeneration: _aIndexGeneration,
    htmlGeneration: _aHtmlGeneration,
    ...aContent
  } = a;
  let {
    indexGeneration: _bIndexGeneration,
    htmlGeneration: _bHtmlGeneration,
    ...bContent
  } = b;
  return isEqual(aContent, bContent);
}

// A prerender_html invalidation names the underlying file (`books/1.json`),
// which can back TWO result rows: the card instance (id `books/1` — instance
// ids never carry the extension) and the file-meta row (id `books/1.json` —
// every file gets a file entry, card JSON included). Stripping a trailing
// `.json` from both sides lets the one invalidation reach both rows without
// knowing which kind a member is: the instance row needs the invalidation
// normalized, and the file row then needs its own id normalized the same way
// to keep matching. For every other file kind (`notes.md`, `book.gts`) the
// strip is a no-op and the comparison is exact.
function stripJsonSuffix(url: string): string {
  return url.replace(/\.json$/, '');
}

// The highest generation among the queued invalidation URLs that name this
// member, or undefined when none do.
function invalidationGenerationFor(
  member: SearchEntry,
  invalidations: Map<string, number>,
): number | undefined {
  let normalized = stripJsonSuffix(member.id);
  let result: number | undefined;
  for (let [url, generation] of invalidations) {
    if (stripJsonSuffix(url) === normalized) {
      result = result === undefined ? generation : Math.max(result, generation);
    }
  }
  return result;
}

// `card` vs `file-meta` for the card+html GET's Accept header — the same
// classification `RenderableSearchEntry.type` makes: a file is an `item` of
// type `file-meta`, or an html-backed row whose rendering carries no render
// type (files render natively; card renderings always name one).
function memberKind(member: SearchEntry): StoreReadType {
  if (member.item) {
    return member.item.type === 'file-meta' ? 'file-meta' : 'card';
  }
  if (member.html.length > 0 && !member.html[0].renderType) {
    return 'file-meta';
  }
  return 'card';
}

// The composite validator the member holds, in the `card+html` GET's ETag
// spelling — `"<indexGeneration>:<htmlGeneration|none>"` (see
// `buildEntryHtmlEtag`). For a member that holds a rendering this matches the
// server's pure-html ETag exactly, so an unchanged rendering returns `304`.
// The server folds a realm-info hash — which the client can't reconstruct —
// into an ITEM-bearing response's validator, so those never match: a member
// with no rendering (the item fallback) always refetches, which is exactly
// the upgrade a prerender_html event should pick up, and an `html,item`
// fieldset's members refetch on every qualifying event (`adoptFresh` keeps
// their row identity when the content comes back unchanged).
function memberValidator(member: SearchEntry): string {
  let indexSegment = member.indexGeneration ?? 0;
  let htmlSegment =
    member.htmlGeneration !== undefined
      ? String(member.htmlGeneration)
      : 'none';
  return `"${indexSegment}:${htmlSegment}"`;
}

// The one host live-search resource: issues the `entry` wire query
// through `StoreService.searchEntries`, subscribes to each searched realm,
// and re-runs on incremental index events with a per-realm partial refresh.
// Realms ride in the query's `realms` member; omitted, every available realm
// is searched.
//
// Create exactly once per owner — a class field or a one-time assignment,
// never inside a getter or during render. Every call builds an independent
// resource with its own realm subscriptions and fetches; per-render calls
// pile up live instances on the parent until the parent is destroyed. Vary
// the search through the `getQuery` thunk (it is re-read reactively), not by
// constructing new resources.
export function getSearchEntriesResource(
  parent: object,
  getQuery: () => SearchEntryWireQuery | undefined,
  getSeed: () => MainResultsSnapshot | undefined = () => undefined,
) {
  return SearchEntriesResource.from(parent, () => ({
    named: {
      query: getQuery(),
      seed: getSeed(),
    },
  })) as SearchEntriesResource;
}
