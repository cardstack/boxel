import { isDestroyed, registerDestructor } from '@ember/destroyable';
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

import type {
  RealmEventContent,
  PrerenderHtmlEventContent,
} from 'https://cardstack.com/base/matrix-event';

import { knownFileMetaUrls } from '../lib/known-file-meta-urls';
import { normalizeRealms } from '../lib/realm-utils';
import { searchErrorEntry } from '../lib/search-error-entry';

import type LoaderService from '../services/loader-service';
import type NetworkService from '../services/network';
import type RealmServerService from '../services/realm-server';
import type StoreService from '../services/store';

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
  // per-member refresh: the union of invalidated URLs and the max generation
  // seen across the events. Set only for structured, refreshable queries (a
  // prerender_html event can't change their membership, so the visible members
  // need only their HTML refreshed, not a whole-search re-query). An index
  // event supersedes it — the search task consumes or folds it, never drops
  // it silently. Untracked, like `realmsNeedingRefresh`.
  private pendingSelectiveRefresh:
    | { generation: number; urls: Set<string> }
    | undefined;

  // A partial refresh splices fetched-realm rows into the standing result
  // set, so it is only sound once a full run has populated that set. Until
  // then every run fetches all realms (an event arriving during the initial
  // fetch must not narrow it).
  private hasCompletedFullRun = false;

  #previousQuery: SearchEntryWireQuery | undefined;
  #previousRealms: string[] | undefined;
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
    let { query } = named;

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
          // paginated queries, and composite/sparse selections can't refresh
          // in isolation and fall through to the coarse re-run.
          if (
            event.eventName === 'prerender_html' &&
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
    this.#trackSearchLoad(this.search.perform());
  }

  get isLoading() {
    return this.search.isRunning;
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
    try {
      // A prerender_html event queued a selective per-member refresh. Consume
      // it: perform the targeted card+html GETs when no index event is also
      // pending (an index event changes membership and supersedes it) and the
      // query still supports it; otherwise fold the queued realms into the
      // coarse re-run so the update is never dropped.
      let selective = this.pendingSelectiveRefresh;
      this.pendingSelectiveRefresh = undefined;
      if (selective) {
        if (
          this.realmsNeedingRefresh.size === 0 &&
          this.#canSelectivelyRefresh()
        ) {
          let handled = await this.#performSelectiveRefresh(selective, query);
          if (handled) {
            return;
          }
          // A member couldn't be refreshed in isolation (a GET failed or the
          // response was malformed) — fall through to a coarse re-run over
          // the realms the queued invalidations spanned.
          this.#foldSelectiveRealmsIntoRefresh(selective);
        } else {
          this.#foldSelectiveRealmsIntoRefresh(selective);
        }
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
              merged.push(isEqual(entry, replacement) ? entry : replacement);
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
          let next = fresh.map((entry) => {
            let previous = previousById.get(entry.id);
            return previous !== undefined && isEqual(previous, entry)
              ? previous
              : entry;
          });
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
  // through to the coarse re-run — the CS-11763 behavior — so nothing regresses.
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

  #fieldsetIsRefreshable(fields: string[] | undefined): boolean {
    return (
      fields === undefined ||
      fields.every((field) => field === 'html' || field === 'item')
    );
  }

  // Whether the html branch is in play for the fieldset — the default
  // resolution (rendering, falling back to item) or an explicit `html`. When
  // it isn't (an item-only fieldset), a member with no rendering is not a
  // refresh candidate: a prerender_html event brings it nothing.
  #htmlBranchInPlay(fields: string[] | undefined): boolean {
    return fields === undefined || fields.includes('html');
  }

  // Merge a prerender_html event into the queued selective refresh: the union
  // of invalidated URLs and the max generation across events (a member is a
  // candidate when any event carried HTML newer than the one it holds; the GET
  // returns the newest rendering regardless).
  #recordSelectiveRefresh(event: PrerenderHtmlEventContent): void {
    let urls = event.invalidations ?? [];
    if (this.pendingSelectiveRefresh === undefined) {
      this.pendingSelectiveRefresh = {
        generation: event.generation,
        urls: new Set(urls),
      };
    } else {
      this.pendingSelectiveRefresh.generation = Math.max(
        this.pendingSelectiveRefresh.generation,
        event.generation,
      );
      for (let url of urls) {
        this.pendingSelectiveRefresh.urls.add(url);
      }
    }
  }

  // When a selective refresh can't run (superseded by an index event, or a
  // member GET failed), fold the realms the queued invalidations spanned into
  // the coarse re-run so their prerender_html update still lands. A different
  // realm's index event must not swallow this realm's HTML update.
  #foldSelectiveRealmsIntoRefresh(selective: { urls: Set<string> }): void {
    for (let member of this._entries) {
      if (memberMatchesUrls(member, selective.urls)) {
        this.realmsNeedingRefresh.add(member.realmUrl);
      }
    }
  }

  // Refresh only the members a prerender_html event carries newer HTML for,
  // each through a conditional card+html GET keyed on the composite validator
  // the member holds. A `304` keeps the current rendering (identity preserved,
  // so a hydrated row stays live); a `200` swaps in the fresh entry. Membership
  // is stable across a prerender_html event, so this never adds or drops a row
  // and leaves `meta.page.total` untouched. Nothing is written to the store —
  // a member a consumer has hydrated is owned by the store's reactive reload.
  // Returns false to request a coarse fallback when a member can't be refreshed
  // in isolation.
  async #performSelectiveRefresh(
    selective: { generation: number; urls: Set<string> },
    query: SearchEntryWireQuery,
  ): Promise<boolean> {
    let selection = htmlQueryRenderingSelection(this._meta.htmlQuery);
    let htmlInPlay = this.#htmlBranchInPlay(query.fields?.entry);
    let fieldsParam = this.#fieldsParam(query.fields?.entry);

    let candidates = this._entries.filter((member) => {
      if (!memberMatchesUrls(member, selective.urls)) {
        return false;
      }
      if (member.htmlGeneration !== undefined) {
        // A member with a rendering refreshes only when the event carries a
        // newer one than it holds.
        return member.htmlGeneration < selective.generation;
      }
      // No rendering yet: refresh (an upgrade opportunity) only when the html
      // branch is in play.
      return htmlInPlay;
    });
    if (candidates.length === 0) {
      // The common case for an unrelated event: nothing in the visible set
      // moved, so do no work at all.
      return true;
    }

    let replacements = new Map<string, SearchEntry>();
    for (let member of candidates) {
      let result;
      try {
        result = await this.runtimeStore.fetchCardEntry(member.id, {
          kind: memberKind(member),
          format: selection?.format,
          renderType: selection?.renderType,
          fields: fieldsParam,
          ifNoneMatch: memberValidator(member),
        });
      } catch (err) {
        // A restart (a newer event) cancels this task mid-GET — let it
        // propagate rather than treating it as a failed refresh.
        if (didCancel(err)) {
          throw err;
        }
        this.#log.warn(
          `selective refresh GET failed for ${member.id}; falling back to a full re-run`,
          err,
        );
        return false;
      }
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
        return false;
      }
      replacements.set(member.id, refreshed);
    }

    if (replacements.size > 0) {
      // Splice in place: every unchanged member keeps its object identity, so
      // only the members whose rendering actually advanced re-render.
      let next = this._entries.map(
        (member) => replacements.get(member.id) ?? member,
      );
      this._entries.splice(0, this._entries.length, ...next);
    }
    // `realmsNeedingRefresh` is deliberately left as-is: a selective refresh
    // only runs when it was empty, and any index event arriving mid-refresh
    // restarts this task (so its realm survives for the re-run).
    this._errors = undefined;
    return true;
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

// Strip a trailing `.json` so an entry's id (the bare card URL) matches a
// prerender_html invalidation (an instance's `.json` file URL); a file's id
// and invalidation are both bare, so stripping is a no-op there. Comparing the
// normalized forms matches either shape without knowing which a member is.
function stripJsonSuffix(url: string): string {
  return url.replace(/\.json$/, '');
}

function memberMatchesUrls(member: SearchEntry, urls: Set<string>): boolean {
  let normalized = stripJsonSuffix(member.id);
  for (let url of urls) {
    if (stripJsonSuffix(url) === normalized) {
      return true;
    }
  }
  return false;
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
// server's pure-html ETag exactly, so an unchanged rendering returns `304`. A
// member with no rendering carries `none`, and the server folds a realm-info
// hash into an item-bearing response's validator, so it never matches — that's
// intended: a no-rendering member always refetches, which is exactly the
// upgrade a prerender_html event should pick up.
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
) {
  return SearchEntriesResource.from(parent, () => ({
    named: {
      query: getQuery(),
    },
  })) as SearchEntriesResource;
}
