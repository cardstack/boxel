import { isDestroyed, registerDestructor } from '@ember/destroyable';
import { service } from '@ember/service';
import { buildWaiter } from '@ember/test-waiters';
import { tracked } from '@glimmer/tracking';

import { didCancel, restartableTask } from 'ember-concurrency';
import { Resource } from 'ember-modify-based-class-resource';

import isEqual from 'lodash/isEqual';
import { TrackedArray } from 'tracked-built-ins';

import {
  subscribeToRealm,
  isCardResource,
  isCssResource,
  isFileMetaResource,
  isHtmlResource,
  logger as runtimeLogger,
  resourceIdentity,
  rri,
  RealmPaths,
  type CardResource,
  type ErrorEntry,
  type FileMetaResource,
  type HtmlResource,
  type Saved,
  type SearchEntryCollectionDocument,
  type SearchEntryRendering,
  type SearchEntryWireQuery,
} from '@cardstack/runtime-common';

import type { RealmEventContent } from 'https://cardstack.com/base/matrix-event';

import { normalizeRealms } from '../lib/realm-utils';
import { searchErrorEntry } from '../lib/search-error-entry';

import type LoaderService from '../services/loader-service';
import type NetworkService from '../services/network';
import type RealmServerService from '../services/realm-server';
import type StoreService from '../services/store';

const waiter = buildWaiter('search-entries-resource:search-waiter');

// `SearchEntryRendering` is the card-facing rendering view-model (it rides the
// v2 `@context` search surface), so it lives in runtime-common; re-exported
// here because this resource builds it and call sites import it from here.
export type { SearchEntryRendering };

// One v2 search result, joined from the wire document: the `search-entry`
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
  @tracked private _meta: SearchEntryCollectionDocument['meta'] = {
    page: { total: 0 },
  };
  @tracked private _errors: ErrorEntry[] | undefined;

  // Realms whose index moved since the last fetch. A non-empty set scopes the
  // next run to just those realms (the per-realm partial refresh); rows from
  // other realms keep their identity. Only the subscription callback writes
  // it and only the search task reads it, so a plain Set suffices — modify()
  // never consumes it, which is what would create a tracking hazard.
  private realmsNeedingRefresh = new Set<string>();

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
    });
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
          // Only incremental index events re-run the search — the coarse
          // "anything moved in a subscribed realm" trigger.
          if (
            event.eventName !== 'index' ||
            ('indexType' in event && event.indexType !== 'incremental')
          ) {
            return;
          }
          this.#log.info(
            `incremental index event on ${realm}; scheduling partial refresh`,
          );
          this.realmsNeedingRefresh.add(realm);
          this.search.perform();
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
    this.hasCompletedFullRun = false;
    this.loaded = this.search.perform();
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
        let doc = await this.store.searchEntries(query, realmsToFetch);
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

  // The `css` resources base64-embed their whole stylesheet in the href; the
  // loader import is what registers each scoped stylesheet with the document,
  // so entries are paint-ready when exposed.
  private async loadStylesheets(doc: SearchEntryCollectionDocument) {
    let hrefs = (doc.included ?? [])
      .filter(isCssResource)
      .map((resource) => resource.attributes.href);
    await Promise.all(
      hrefs.map((href) => this.loaderService.loader.import(href)),
    );
  }

  private buildEntries(doc: SearchEntryCollectionDocument): SearchEntry[] {
    let htmlById = new Map<string, HtmlResource>();
    let cssHrefById = new Map<string, string>();
    let itemsByIdentity = new Map<
      string,
      CardResource<Saved> | FileMetaResource
    >();
    for (let resource of doc.included ?? []) {
      if (isHtmlResource(resource)) {
        htmlById.set(resource.id, resource);
      } else if (isCssResource(resource)) {
        cssHrefById.set(resource.id, resource.attributes.href);
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
      let renderings = (entry.relationships.html?.data ?? [])
        .map((ref) => htmlById.get(ref.id))
        .filter(Boolean)
        .map((html) => buildRendering(html!, cssHrefById));
      let itemRef = entry.relationships.item?.data;
      let item = itemRef
        ? itemsByIdentity.get(resourceIdentity(itemRef.type, itemRef.id))
        : undefined;
      return {
        id: entry.id,
        realmUrl: realmUrlFor(entry.id),
        html: renderings,
        ...(item ? { item } : {}),
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
    ...(attributes.iconHtml ? { iconHtml: attributes.iconHtml } : {}),
    isError: Boolean(attributes.isError),
    format: attributes.format,
    ...(attributes.renderType ? { renderType: attributes.renderType } : {}),
    cssUrls: relationships.styles.data
      .map(({ id }) => cssHrefById.get(id))
      .filter((href): href is string => Boolean(href)),
  };
}

// The one v2 host live-search resource: issues the `search-entry` wire query
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
