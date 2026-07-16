import {
  isDestroyed,
  isDestroying,
  registerDestructor,
} from '@ember/destroyable';
import type Owner from '@ember/owner';
import { getOwner } from '@ember/owner';
import Service, { service } from '@ember/service';
import { buildWaiter } from '@ember/test-waiters';
import { isTesting } from '@embroider/macros';
import { tracked } from '@glimmer/tracking';

import { formatDistanceToNow } from 'date-fns';
import { task } from 'ember-concurrency';

import { cloneDeep } from 'lodash-es';
import { isEqual } from 'lodash-es';
import { merge, mergeWith } from 'lodash-es';

import { TrackedObject, TrackedMap } from 'tracked-built-ins';

import {
  baseFileRef,
  baseRef,
  CardError,
  hasExecutableExtension,
  isCardError,
  isCardInstance,
  isFileDefInstance,
  isFileMetaResource,
  isSingleCardDocument,
  isSingleFileMetaDocument,
  isEntryCollectionDocument,
  isSparseItemResource,
  resolveFileDefCodeRef,
  searchEntryWireQueryFromQuery,
  getTypeRefsFromFilter,
  X_BOXEL_JOB_PRIORITY_HEADER,
  userInitiatedPriority,
  Deferred,
  delay,
  mergeRelationships,
  isLocalId,
  realmURL as realmURLSymbol,
  localId as localIdSymbol,
  meta,
  rri,
  logger,
  formattedError,
  stringifyErrorForLog,
  applySearchPageBound,
  assertRealmsBound,
  isJsonContentType,
  SEARCH_CONCURRENCY_CAP,
  SupportedMimeType,
  RealmPaths,
  type CardAPIForMatching,
  clearReplacedArrayFieldMeta,
  type Store as StoreInterface,
  type AddOptions,
  type CreateOptions,
  type Query,
  type QueryResultsMeta,
  type RuntimeDependencyTrackingContext,
  type PatchData,
  type Relationship,
  type AutoSaveState,
  type CardDocument,
  type SingleCardDocument,
  type SingleFileMetaDocument,
  type CardResourceMeta,
  type LooseSingleCardDocument,
  type LooseCardResource,
  type CardErrorJSONAPI,
  type CardErrorsJSONAPI,
  type ErrorEntry,
  type RenderError,
  type FileMetaResource,
  type LooseLinkableResource,
  type LooseSingleResourceDocument,
  type StoreReadType,
  type CardResource,
  type SearchEntryResults,
  type SearchEntryScope,
  type SearchEntryWireQuery,
  type EntrySingleDocument,
  isEntrySingleDocument,
  type PrerenderedHtmlFormat,
  type ResolvedCodeRef,
  type RealmIdentifier,
  type RealmResourceIdentifier,
  type Saved,
  type VirtualNetwork,
} from '@cardstack/runtime-common';

import CardStore, { getDeps, type ReferenceCount } from '../lib/gc-card-store';

import {
  consumingRealmHeader,
  duringPrerenderHeaders,
  jobIdHeader,
  loggingCorrelationIdHeader,
} from '../lib/prerender-fetch-headers';
import { searchCacheKey } from '../lib/search-cache-key';
import { searchInFlightKey } from '../lib/search-in-flight-key';
import { errorJsonApiToErrorEntry } from '../lib/window-error-handler';
import { getSearch } from '../resources/search';

import { FileDefAttributesExtractor } from '../utils/file-def-attributes-extractor';
import {
  enableRenderTimerStub,
  withTimersBlocked,
} from '../utils/render-timer-stub';

import type { CardSaveSubscriber } from './card-service';
import type CardService from './card-service';
import type EnvironmentService from './environment-service';

import type HostModeService from './host-mode-service';
import type LoaderService from './loader-service';
import type MessageService from './message-service';
import type NetworkService from './network';
import type OperatorModeStateService from './operator-mode-state-service';
import type RealmService from './realm';
import type RealmServerService from './realm-server';
import type ResetService from './reset';
import type ToolService from './tool-service';
import type { SearchResource } from '../resources/search';
import type * as CardAPI from '@cardstack/base/card-api';
import type { CardDef, BaseDef } from '@cardstack/base/card-api';
import type { FileDef } from '@cardstack/base/file-api';
import type { RealmEventContent } from '@cardstack/base/matrix-event';

export { CardErrorJSONAPI, CardSaveSubscriber };

let waiter = buildWaiter('store-service');

const realmEventsLogger = logger('realm:events');
const storeLogger = logger('store');

// Companion to `jobIdHeader()` (re-exported from
// `../lib/prerender-fetch-headers`). Policy is two-state, gated by
// `__boxelRenderContext`, not by the presence of
// `__boxelJobPriority`:
//
// 1. Inside a prerender tab: forward the worker job's priority as-is.
//    The render-runner injects `__boxelJobPriority` alongside
//    `__boxelJobId` on each visit — a low priority is meaningful
//    (the originating job is system-initiated background work)
//    and must be preserved, not upgraded. Sub-`prerenderModule`
//    calls fired by the federated search for a `lookupDefinition`
//    cache miss inherit this priority so they don't outrun the
//    parent. If `__boxelJobPriority` is missing here (older
//    render-runner build, test fixture, etc.) treat as 0 — the
//    lowest tier, the safe default for prerender-context work.
//
// 2. Outside a prerender tab (the host SPA in a real user's browser):
//    stamp `userInitiatedPriority`. User clicks driving a
//    search are by definition user-initiated work and should outrank
//    background indexing on the realm-server's PagePool. Without
//    this, a user search whose definition lookup misses the modules
//    cache would fire its sub-prerender at background priority and
//    queue behind concurrent indexing fan-out.
//
// External (non-host) HTTP callers — anything that doesn't run in
// the host SPA's JS runtime — bypass this helper entirely and set
// `X-Boxel-Job-Priority` directly on their request if they care.
// This helper covers the host SPA only.
//
// Both globals are checked with `=== true` / strict-number rather
// than truthy coercion: `__boxelRenderContext` is typed as a
// boolean and a stray truthy string from a future code path
// shouldn't silently flip the policy from "user-priority" to
// "preserve 0."
// Pure resolver — exported for the unit test in
// `tests/integration/job-priority-header-test.ts`. See the comment
// above for the policy rationale; the function is the literal
// translation of that policy to numbers.
export function resolveOutboundJobPriority({
  duringPrerender,
  jobPriority,
}: {
  duringPrerender: unknown;
  jobPriority: unknown;
}): number {
  let valid =
    typeof jobPriority === 'number' &&
    Number.isSafeInteger(jobPriority) &&
    jobPriority >= 0
      ? jobPriority
      : undefined;
  if (duringPrerender === true) {
    return valid ?? 0;
  }
  return valid ?? userInitiatedPriority;
}

function jobPriorityHeader(): Record<string, string> {
  let g = globalThis as unknown as {
    __boxelRenderContext?: boolean;
    __boxelJobPriority?: number;
  };
  return {
    [X_BOXEL_JOB_PRIORITY_HEADER]: String(
      resolveOutboundJobPriority({
        duringPrerender: g.__boxelRenderContext,
        jobPriority: g.__boxelJobPriority,
      }),
    ),
  };
}
const queryFieldSeedFromSearchSymbol = Symbol.for(
  'cardstack-query-field-seed-from-search',
);

type PersistOptions = CreateOptions & { clientRequestId?: string };
type DependencyTrackingOptions = {
  dependencyTrackingContext?: RuntimeDependencyTrackingContext;
};
type TrackedCreateOptions = CreateOptions & DependencyTrackingOptions;
type TrackedAddOptions = AddOptions & DependencyTrackingOptions;

export default class StoreService extends Service implements StoreInterface {
  @service declare private realm: RealmService;
  @service declare private loaderService: LoaderService;
  @service declare private messageService: MessageService;
  @service declare private cardService: CardService;
  @service declare private toolService: ToolService;
  @service declare private hostModeService: HostModeService;
  @service declare private network: NetworkService;
  @service declare private environmentService: EnvironmentService;
  @service declare private reset: ResetService;
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private realmServer: RealmServerService;
  private subscriptions: Map<string, { unsubscribe: () => void }> = new Map();
  private cardInvalidationSubscribers: Map<string, Set<() => void>> = new Map();
  private referenceCount: ReferenceCount = new Map();
  private newReferencePromises: Promise<void>[] = [];
  private autoSaveStates: TrackedMap<string, AutoSaveState> = new TrackedMap();
  // Bumped whenever a hydrated card instance's fields change (edit / save).
  // Adds and deletes are already observable through the tracked identity map
  // (see `allCardInstances`); this signal covers the in-place mutations that
  // leave the map's membership unchanged, so a reactive consumer like the
  // client-side search filter recomputes on edits too — not only on the
  // server search re-running.
  @tracked private _instanceMutationVersion = 0;
  private cardApiCache?: typeof CardAPI;
  private gcInterval: number | undefined;
  private ready: Promise<void>;
  private inflightGetCards: Map<string, Promise<CardDef | CardErrorJSONAPI>> =
    new Map();
  private inflightGetFileMeta: Map<
    string,
    Promise<FileDef | CardErrorJSONAPI>
  > = new Map();
  private inflightCardMutations: Map<string, Promise<void>> = new Map();
  private inflightCardLoads: Map<string, Deferred<void>> = new Map();
  // Coalesce concurrent same-(realms, query) `_federated-search` HTTP
  // calls during a prerender. Gated on `__boxelRenderContext` so live
  // user searches stay uncoalesced — write-then-read freshness story
  // unchanged outside prerender. Entries self-clear on `.finally()` via
  // identity check.
  private inflightSearch: Map<string, Promise<SearchEntryResults>> = new Map();
  // Resolved-doc cache for same-realm `_federated-search` calls during
  // a prerender. Layered *above* `inflightSearch`: a cache hit skips
  // the network round-trip entirely; a miss falls through to the
  // in-flight Map and the cache is populated on resolve. Keyed by
  // (jobId, consumingRealm, query) — gated to same-realm-only so a
  // cross-realm read can't freeze a value while a peer realm-server
  // replica swaps mid-job.
  //
  // Lifetime: the entire indexing job. One job typically spans many
  // card renders in the same prerender tab (each navigation activates
  // and deactivates the render route but all those visits share one
  // `__boxelJobId`); the cache must survive those route bounces so
  // earlier renders' work is reusable by later ones. Only clear when
  // the job actually changes — `fetchSearchDoc` does this at
  // fetch-entry via the jobId-change check, and `resetState` /
  // `resetCache` do it on harder service resets. The render route's
  // `deactivate` deliberately does NOT clear this cache. See
  // `search-cache-key.ts` for the digest and the realm-server's
  // `job-scoped-search-cache.ts` for the server-side prior art on
  // storing resolved docs rather than promises (avoids tail-latency
  // stalls on slow first populate).
  private searchCache: Map<string, SearchEntryResults> = new Map();
  // The jobId the `searchCache` entries belong to. When a request
  // arrives carrying a different `__boxelJobId` we drop the cache
  // before serving — belt-and-braces beside `resetState()` and the
  // render-route deactivate clear, in case a prerender tab is reused
  // across jobs without driving either of those paths.
  private searchCacheJobId: string | undefined = undefined;
  // Monotonic counter bumped on every clear of `searchCache` (every
  // path that empties the map: `clearSearchCache`, `resetState`,
  // `resetCache`, the jobId-change clear at fetch-entry). A
  // `fetchSearchDoc` call captures this at entry and checks it before
  // populating on resolve — if the cache was intentionally cleared
  // while the request was in flight, the resolved doc must not
  // repopulate against the new generation. Mirrors the identity
  // check on the in-flight Map but for the resolved-doc layer where
  // we can't compare against a stored Promise.
  private searchCacheGeneration = 0;
  private store: CardStore;
  protected isRenderStore = false;

  // This is used for tests
  private onSaveSubscriber: CardSaveSubscriber | undefined;
  private autoSaveQueues = new Map<string, { isImmediate?: true }[]>();
  private autoSavePromises = new Map<string, Promise<void>>();

  constructor(owner: Owner) {
    super(owner);
    this.store = this.createCardStore();
    this.reset.register(this);
    this.ready = this.setup();
    registerDestructor(this, () => {
      clearInterval(this.gcInterval);
    });
  }

  protected renderContextBlocksPersistence() {
    return (
      this.isRenderStore && Boolean((globalThis as any).__boxelRenderContext)
    );
  }

  // used for tests only!
  _onSave(subscriber: CardSaveSubscriber) {
    this.onSaveSubscriber = subscriber;
    this.cardService._onSave(subscriber);
  }

  // used for tests only!
  _unregisterSaveSubscriber() {
    this.onSaveSubscriber = undefined;
    this.cardService._unregisterSaveSubscriber();
  }

  resetState() {
    clearInterval(this.gcInterval);
    this.subscriptions = new Map();
    this.cardInvalidationSubscribers = new Map();
    this.onSaveSubscriber = undefined;
    this.referenceCount = new Map();
    this.newReferencePromises = [];
    this.autoSaveStates = new TrackedMap();
    this.inflightGetCards = new Map();
    this.inflightGetFileMeta = new Map();
    this.inflightCardMutations = new Map();
    this.inflightCardLoads = new Map();
    this.inflightSearch = new Map();
    this.searchCache = new Map();
    this.searchCacheJobId = undefined;
    this.searchCacheGeneration++;
    this.autoSaveQueues = new Map();
    this.autoSavePromises = new Map();
    this.store = this.createCardStore();
    this.ready = this.setup();
  }

  async ensureSetupComplete(): Promise<void> {
    await this.ready;
  }

  // Drop every pending in-flight search entry. Callers awaiting an
  // existing promise still get their answer (the underlying HTTP is
  // already in motion); only *new* same-key callers after the drop
  // miss the map and re-fetch. Wire this to anything the host
  // recognizes as an invalidation boundary — render-route deactivate
  // is the obvious one inside a prerender tab.
  clearInFlightSearch(): void {
    this.inflightSearch.clear();
  }

  // Drop every resolved-doc search-cache entry. Used for hard resets
  // (`resetState`, `resetCache`) and by tests; NOT called from the
  // render route's per-visit deactivate, because the cache is meant
  // to survive across renders within a single indexing job. Cross-job
  // invalidation is handled by `fetchSearchDoc`'s entry-time
  // jobId-change clear, which fires the first time a new
  // `__boxelJobId` is observed.
  clearSearchCache(): void {
    this.searchCache.clear();
    this.searchCacheJobId = undefined;
    this.searchCacheGeneration++;
  }

  resetCache(opts?: { preserveReferences?: boolean }) {
    storeLogger.debug('resetting store cache');
    if (!opts?.preserveReferences) {
      this.referenceCount = new Map();
    }
    this.cardApiCache = undefined;
    this.autoSaveStates = new TrackedMap();
    this.newReferencePromises = [];
    this.inflightGetCards = new Map();
    this.inflightGetFileMeta = new Map();
    this.inflightCardMutations = new Map();
    this.inflightCardLoads = new Map();
    this.inflightSearch = new Map();
    this.searchCache = new Map();
    this.searchCacheJobId = undefined;
    this.searchCacheGeneration++;
    this.autoSaveQueues = new Map();
    this.autoSavePromises = new Map();
    this.store = this.createCardStore();
  }

  refreshReferencesForCodeChange(reason?: string) {
    let reasonSuffix = reason ? ` (${reason})` : '';
    storeLogger.debug(`resetting store for code change${reasonSuffix}`);
    this.store.reset();
    this.reestablishReferences.perform();
  }

  // Notify-on-delete for callers that hold a card by direct JS reference rather
  // than by linksTo. `consumersOf` only walks linksTo refs, so a direct holder
  // (e.g. MatrixService's `_systemCard`) would otherwise stay pinned to a
  // now-evicted instance until the next reload. Subscribers fire from both
  // delete paths — `delete()` (in-tab UI) and the `reloadTask` 404 branch
  // (matrix-auth-room invalidation for cross-tab / cross-machine deletes).
  subscribeToCardInvalidation(id: string, cb: () => void): () => void {
    let normalizedId = asURL(id, this.network.virtualNetwork);
    let subscribers = this.cardInvalidationSubscribers.get(normalizedId);
    if (!subscribers) {
      subscribers = new Set();
      this.cardInvalidationSubscribers.set(normalizedId, subscribers);
    }
    subscribers.add(cb);
    return () => {
      let current = this.cardInvalidationSubscribers.get(normalizedId);
      if (!current) {
        return;
      }
      current.delete(cb);
      if (current.size === 0) {
        this.cardInvalidationSubscribers.delete(normalizedId);
      }
    };
  }

  private notifyCardInvalidationSubscribers(id: string) {
    let normalizedId = asURL(id, this.network.virtualNetwork);
    let subscribers = this.cardInvalidationSubscribers.get(normalizedId);
    if (!subscribers) {
      return;
    }
    // Snapshot to tolerate unsubscribe-from-callback without skipping siblings.
    // Subscribers may be async — catch rejections that escape the synchronous
    // try/catch so a failure in one handler does not become an unhandled
    // promise rejection or starve sibling handlers.
    for (let cb of [...subscribers]) {
      try {
        let maybePromise = cb() as unknown;
        if (
          maybePromise &&
          typeof (maybePromise as PromiseLike<unknown>).then === 'function'
        ) {
          (maybePromise as Promise<unknown>).catch((err) =>
            console.error(
              `card invalidation subscriber for ${normalizedId} rejected`,
              err,
            ),
          );
        }
      } catch (err) {
        console.error(
          `card invalidation subscriber for ${normalizedId} threw`,
          err,
        );
      }
    }
  }

  dropReference(id: string | undefined) {
    if (!id) {
      return;
    }
    id = asURL(id, this.network.virtualNetwork);
    let currentReferenceCount = this.referenceCount.get(id) ?? 0;
    currentReferenceCount -= 1;
    this.referenceCount.set(id, currentReferenceCount);

    storeLogger.debug(
      `dropping reference to ${id}, current reference count: ${this.referenceCount.get(id)}`,
    );
    if (currentReferenceCount <= 0) {
      if (currentReferenceCount < 0) {
        let message = `current reference count for ${id} is negative: ${this.referenceCount.get(id)}`;
        storeLogger.error(message);
        console.trace(message); // this will helps us to understand who dropped the reference that made it negative
      }
      this.referenceCount.delete(id);
      this.autoSaveStates.delete(id);
      this.unsubscribeFromInstance(id);
    }
  }

  addReference(id: string | undefined, opts?: { type?: StoreReadType }) {
    if (!id) {
      return;
    }
    id = asURL(id, this.network.virtualNetwork);
    let readType: StoreReadType = opts?.type ?? 'card';
    // synchronously update the reference count so we don't run into race
    // conditions requiring a mutex
    let currentReferenceCount = this.referenceCount.get(id) ?? 0;
    currentReferenceCount += 1;
    this.referenceCount.set(id, currentReferenceCount);
    storeLogger.debug(
      `adding reference to ${id}, current reference count: ${this.referenceCount.get(id)}`,
    );

    if (isLocalId(id)) {
      let instanceOrError = this.peek(id);
      if (instanceOrError) {
        let realmURL = isCardInstance(instanceOrError)
          ? instanceOrError[realmURLSymbol]?.href
          : instanceOrError.realm;
        if (realmURL) {
          this.subscribeToRealm(new URL(realmURL));
        }
      }
    } else {
      this.subscribeToRealm(rri(id));
      // intentionally not awaiting this. we keep track of the promise in
      // this.newReferencePromises
      this.wireUpNewReference(id, readType);
    }
  }

  loaded(): Promise<void> {
    return this.store.loaded();
  }

  get loadGeneration(): number {
    return this.store.loadGeneration;
  }

  trackLoad(load: Promise<unknown>): void {
    this.store.trackLoad(load);
  }

  // CS-10872: pass-through so SearchResource / other callers can tag
  // their load promises with the metadata we want to see in a timeout
  // error document ("what query fields were still pending").
  trackQueryLoad(
    load: Promise<unknown>,
    meta: import('@cardstack/base/card-api').QueryLoadMeta,
  ): (() => void) | void {
    return (
      this.store as unknown as {
        trackQueryLoad?: (
          l: Promise<unknown>,
          m: import('@cardstack/base/card-api').QueryLoadMeta,
        ) => (() => void) | void;
      }
    ).trackQueryLoad?.(load, meta);
  }

  queryLoadsInFlight(): import('@cardstack/base/card-api').QueryLoadInfo[] {
    return (
      (
        this.store as unknown as {
          queryLoadsInFlight?: () => import('@cardstack/base/card-api').QueryLoadInfo[];
        }
      ).queryLoadsInFlight?.() ?? []
    );
  }

  // CS-10872: pass-throughs for the per-item diagnostic accessors.
  // Each returns [] when the underlying store doesn't implement the
  // hook (older test doubles, in-memory stores in node-side tests).
  cardDocLoadsInFlight(): Array<{ url: string; ageMs: number }> {
    return (
      (
        this.store as unknown as {
          cardDocLoadsInFlight?: () => Array<{ url: string; ageMs: number }>;
        }
      ).cardDocLoadsInFlight?.() ?? []
    );
  }
  fileMetaDocLoadsInFlight(): Array<{ url: string; ageMs: number }> {
    return (
      (
        this.store as unknown as {
          fileMetaDocLoadsInFlight?: () => Array<{
            url: string;
            ageMs: number;
          }>;
        }
      ).fileMetaDocLoadsInFlight?.() ?? []
    );
  }
  recentCardDocLoads(): Array<{ url: string; ms: number }> {
    return (
      (
        this.store as unknown as {
          recentCardDocLoads?: () => Array<{ url: string; ms: number }>;
        }
      ).recentCardDocLoads?.() ?? []
    );
  }
  recentFileMetaLoads(): Array<{ url: string; ms: number }> {
    return (
      (
        this.store as unknown as {
          recentFileMetaLoads?: () => Array<{ url: string; ms: number }>;
        }
      ).recentFileMetaLoads?.() ?? []
    );
  }
  recentQueryLoads(): Array<{
    meta: import('@cardstack/base/card-api').QueryLoadMeta;
    ms: number;
  }> {
    return (
      (
        this.store as unknown as {
          recentQueryLoads?: () => Array<{
            meta: import('@cardstack/base/card-api').QueryLoadMeta;
            ms: number;
          }>;
        }
      ).recentQueryLoads?.() ?? []
    );
  }

  get cardDocsInFlight() {
    return this.store.cardDocsInFlight;
  }

  get fileMetaDocsInFlight() {
    return this.store.fileMetaDocsInFlight;
  }

  // This method creates a new instance in the store and return the new card ID
  async create(
    doc: LooseSingleCardDocument,
    opts?: TrackedCreateOptions,
  ): Promise<string | CardErrorJSONAPI> {
    return await this.withTestWaiters(async () => {
      if (opts?.realm) {
        doc.data.meta = {
          ...(doc.data.meta ?? {}),
          realmURL: opts.realm as RealmIdentifier,
        };
      }
      let cardOrError = await this.getCardInstance({
        idOrDoc: doc,
        relativeTo: opts?.relativeTo,
        realm: opts?.realm,
        opts: {
          localDir: opts?.localDir,
          dependencyTrackingContext: opts?.dependencyTrackingContext,
        },
      });
      if (isCardInstance(cardOrError)) {
        return cardOrError.id;
      }
      return cardOrError;
    });
  }

  save(id: string) {
    this.doAutoSave(id, { isImmediate: true });
  }

  async add<T extends CardDef>(
    instanceOrDoc: T | LooseSingleCardDocument,
    opts?: TrackedCreateOptions & { doNotPersist: true },
  ): Promise<T>;
  async add<T extends CardDef>(
    instanceOrDoc: T | LooseSingleCardDocument,
    opts?: TrackedCreateOptions & { doNotWaitForPersist: true },
  ): Promise<T>;
  async add<T extends CardDef>(
    instanceOrDoc: T | LooseSingleCardDocument,
    opts?: TrackedCreateOptions,
  ): Promise<T | CardErrorJSONAPI>;
  async add<T extends CardDef>(
    instanceOrDoc: T | LooseSingleCardDocument,
    opts?: TrackedAddOptions,
  ): Promise<T | CardErrorJSONAPI> {
    let instance: T;
    if (!isCardInstance(instanceOrDoc)) {
      instance = await this.createFromSerialized(
        instanceOrDoc.data,
        instanceOrDoc,
        opts?.relativeTo,
        opts?.dependencyTrackingContext,
      );
    } else {
      instance = instanceOrDoc;
      let api = await this.cardService.getAPI();
      let deps = getDeps(api, instance);
      for (let dep of deps) {
        if (isCardInstance(dep)) {
          if (!this.store.getCard(dep[localIdSymbol])) {
            this.store.setCard(dep.id ?? dep[localIdSymbol], dep);
          }
          continue;
        }
        if (isFileDefInstance(dep) && dep.id) {
          if (!this.store.getFileMeta(dep.id)) {
            this.store.setFileMeta(dep.id, dep);
          }
        }
      }
    }
    if (opts?.realm) {
      instance[meta] = {
        ...instance[meta],
        ...{ realmURL: opts.realm },
      } as CardResourceMeta;
    }

    let maybeOldInstance = instance.id
      ? this.store.getCard(instance.id)
      : undefined;
    if (maybeOldInstance) {
      await this.stopAutoSaving(maybeOldInstance);
    }

    this.setIdentityContext(instance);
    await this.startAutoSaving(instance);

    if (this.renderContextBlocksPersistence()) {
      return instance;
    }

    if (opts?.doNotWaitForPersist) {
      // intentionally not awaiting
      this.persistAndUpdate(instance, {
        realm: opts?.realm,
        localDir: opts?.localDir,
      });
    } else if (!opts?.doNotPersist) {
      if (instance.id) {
        this.save(instance.id);
      } else {
        return (await this.persistAndUpdate(instance, {
          realm: opts?.realm,
          localDir: opts?.localDir,
        })) as T | CardErrorJSONAPI;
      }
    }

    return instance;
  }

  // peek will return a stale instance in the case the server has an error for
  // this id
  peek<T extends CardDef>(
    id: string,
    opts?: { type?: 'card' },
  ): T | CardErrorJSONAPI | undefined;
  peek<T extends FileDef>(
    id: string,
    opts: { type: 'file-meta' },
  ): T | CardErrorJSONAPI | undefined;
  peek<T extends CardDef | FileDef>(
    id: string,
    opts?: { type?: StoreReadType },
  ): T | CardErrorJSONAPI | undefined {
    id = asURL(id, this.network.virtualNetwork);
    let readType = opts?.type ?? 'card';
    if (readType === 'file-meta') {
      return this.store.getFileMetaInstanceOrError<T & FileDef>(id);
    }
    return this.store.getCardInstanceOrError<T & CardDef>(id);
  }

  // All hydrated (non-error) card instances currently in the Store. The result
  // is the candidate set for the client-side search filter; reading it inside
  // an autotracked computation re-runs when an instance is added or removed.
  allCardInstances(): CardDef[] {
    return this.store.allCardInstances();
  }

  // The file-meta counterpart of `allCardInstances`, so a file-meta search
  // gets the same client-side candidate set as a card search.
  allFileMetaInstances(): FileDef[] {
    return this.store.allFileMetaInstances();
  }

  // Tracked counter bumped on every in-place field edit/save of a hydrated
  // card. Reading it inside an autotracked computation makes that computation
  // recompute when any Store card mutates — used by the client-side search
  // filter to re-derive its result set without a server round-trip. Adds and
  // removes are already covered by the tracked identity map behind
  // `allCardInstances`.
  get instanceMutationVersion(): number {
    return this._instanceMutationVersion;
  }

  // The slice of the card-api module the client-side filter matcher and sort
  // comparator need (see runtime-common's instance-filter-matcher). Loaded
  // through the same loader-scoped cache the rest of the Store uses.
  async getMatchAPI(): Promise<CardAPIForMatching> {
    let api = await this.cardService.getAPI();
    return {
      getQueryableValue: api.getQueryableValue,
      formatQueryValue: api.formatQueryValue,
      peekAtField: api.peekAtField,
      isNonPresentLink: api.isNonPresentLink,
      getCardMeta: api.getCardMeta as CardAPIForMatching['getCardMeta'],
      primitive: api.primitive,
      virtualNetwork: this.network.virtualNetwork,
    };
  }

  // peekError will always return the current server state regarding errors for this id
  peekError(id: string, opts?: { type?: 'card' }): CardErrorJSONAPI | undefined;
  peekError(
    id: string,
    opts: { type: 'file-meta' },
  ): CardErrorJSONAPI | undefined;
  peekError(
    id: string,
    opts?: { type?: StoreReadType },
  ): CardErrorJSONAPI | undefined {
    id = asURL(id, this.network.virtualNetwork);
    let readType = opts?.type ?? 'card';
    if (readType === 'file-meta') {
      return this.store.getFileMetaError(id);
    }
    return this.store.getCardError(id);
  }

  async get<T extends CardDef>(
    id: string,
    opts?: {
      type?: 'card';
      dependencyTrackingContext?: RuntimeDependencyTrackingContext;
    },
  ): Promise<T | CardErrorJSONAPI>;
  async get<T extends FileDef>(
    id: string,
    opts: {
      type: 'file-meta';
      dependencyTrackingContext?: RuntimeDependencyTrackingContext;
    },
  ): Promise<T | CardErrorJSONAPI>;
  async get<T extends CardDef | FileDef>(
    id: string,
    opts?: {
      type?: StoreReadType;
      dependencyTrackingContext?: RuntimeDependencyTrackingContext;
    },
  ): Promise<T | CardErrorJSONAPI> {
    let readType = opts?.type ?? 'card';
    if (readType === 'file-meta') {
      return await this.getFileMetaInstance<T & FileDef>({
        idOrDoc: id,
        opts: { dependencyTrackingContext: opts?.dependencyTrackingContext },
      });
    }
    return await this.getCardInstance<T & CardDef>({
      idOrDoc: id,
      opts: { dependencyTrackingContext: opts?.dependencyTrackingContext },
    });
  }

  // Bypass cached state and fetch from source of truth
  async getWithoutCache<T extends CardDef>(
    id: string,
    opts?: { type?: 'card' },
  ): Promise<T | CardErrorJSONAPI>;
  async getWithoutCache<T extends FileDef>(
    id: string,
    opts: { type: 'file-meta' },
  ): Promise<T | CardErrorJSONAPI>;
  async getWithoutCache<T extends CardDef | FileDef>(
    id: string,
    opts?: { type?: StoreReadType },
  ): Promise<T | CardErrorJSONAPI> {
    let readType = opts?.type ?? 'card';
    if (readType === 'file-meta') {
      return await this.getFileMetaInstance<T & FileDef>({
        idOrDoc: id,
        opts: { noCache: true },
      });
    }
    return await this.getCardInstance<T & CardDef>({
      idOrDoc: id,
      opts: { noCache: true },
    });
  }

  async serializeFileDefAsDocument(
    fileDef: FileDef,
  ): Promise<SingleFileMetaDocument> {
    let api = await this.cardService.getAPI();
    return api.serializeFileDef(fileDef, {}) as SingleFileMetaDocument;
  }

  async delete(id: string): Promise<void> {
    id = asURL(id, this.network.virtualNetwork);
    if (!id) {
      // the card isn't actually saved yet, so do nothing
      return;
    }
    // Snapshot the consumers BEFORE removing the deleted instance from the
    // store, then rewrite each consumer's slot to a link-not-found sentinel so
    // the placeholder render takes over without a navigation. This is the same
    // rewrite the realm-invalidation path performs when a delete originates
    // elsewhere — but that path keys off the deleted id still being loaded when
    // its invalidation event arrives, and the eager eviction below removes it
    // first. So for a delete initiated in this session the invalidation handler
    // has nothing to reload, and without this the consumer's render stays stale
    // on the now-orphaned card object until a reload.
    let instance = this.store.getCard(id);
    let api = instance ? await this.cardService.getAPI() : undefined;
    let consumers =
      api && instance ? this.store.consumersOf(api, instance) : [];
    this.unsubscribeFromInstance(id);
    this.store.delete(id);
    if (api) {
      for (let consumer of consumers) {
        api.notifyLinksToTargetDeleted(consumer, id);
      }
    }
    await this.cardService.fetchJSON(id, { method: 'DELETE' });
    // Notify direct-reference holders (e.g. MatrixService's `_systemCard`)
    // only AFTER the server DELETE completes — these subscribers typically
    // re-evaluate by calling `store.get(id)`, which is cache-first and would
    // otherwise refetch the still-extant file and miss the deletion.
    this.notifyCardInvalidationSubscribers(id);
  }

  async patch<T extends CardDef = CardDef>(
    id: string,
    patch: PatchData,
    opts?: { doNotPersist?: true },
  ): Promise<T | CardErrorJSONAPI | undefined>;
  async patch<T extends CardDef = CardDef>(
    id: string,
    patch: PatchData,
    opts?: { doNotWaitForPersist?: true },
  ): Promise<T | CardErrorJSONAPI | undefined>;
  async patch<T extends CardDef = CardDef>(
    id: string,
    patch: PatchData,
    opts?: { doNotPersist?: true; doNotWaitForPersist?: true },
  ): Promise<T | CardErrorJSONAPI | undefined>;
  async patch<T extends CardDef = CardDef>(
    id: string,
    patch: PatchData,
    opts?: { clientRequestId?: string },
  ): Promise<T | CardErrorJSONAPI | undefined>;
  async patch<T extends CardDef = CardDef>(
    id: string,
    patch: PatchData,
    opts?: { doNotWaitForPersist?: true; clientRequestId?: string },
  ): Promise<T | CardErrorJSONAPI | undefined>;
  async patch<T extends CardDef = CardDef>(
    id: string,
    patch: PatchData,
    opts?: {
      doNotPersist?: true;
      doNotWaitForPersist?: true;
      clientRequestId?: string;
    },
  ): Promise<T | CardErrorJSONAPI | undefined> {
    if (this.renderContextBlocksPersistence()) {
      return;
    }
    // eslint-disable-next-line ember/classic-decorator-no-classic-methods
    let instance = await this.get<T>(id);
    if (!instance || !isCardInstance(instance)) {
      return;
    }
    if (opts?.doNotPersist) {
      await this.stopAutoSaving(instance);
    }
    // Resolve any linked-card relationships first. This can require a
    // network fetch, and a sibling task elsewhere may mutate other fields on
    // this same live instance while we wait. Snapshotting the instance below
    // (for the merge + write-back further down) only after this resolves
    // keeps that snapshot from going stale and reverting the sibling's write.
    let linkedCards = await this.loadPatchedInstances(patch, instance.id);
    for (let [field, value] of Object.entries(linkedCards)) {
      if (field.includes('.')) {
        let parts = field.split('.');
        let leaf = parts.pop();
        if (!leaf) {
          throw new Error(`bug: error in field name "${field}"`);
        }
        let inner = instance;
        for (let part of parts) {
          inner = (inner as any)[part];
        }
        (inner as any)[leaf.match(/^\d+$/) ? Number(leaf) : leaf] = value;
      } else {
        (instance as any)[field] = value;
      }
    }
    let doc = await this.cardService.serializeCard(instance, {
      omitQueryFields: true,
    });
    if (patch.attributes) {
      doc.data.attributes = mergeWith(
        doc.data.attributes,
        patch.attributes,
        (_dest, src) => (Array.isArray(src) ? src : undefined),
      );
      clearReplacedArrayFieldMeta(doc.data.meta, patch.attributes);
    }
    if (patch.relationships) {
      let mergedRel = mergeRelationships(
        doc.data.relationships,
        patch.relationships,
      );
      if (mergedRel && Object.keys(mergedRel).length !== 0) {
        doc.data.relationships = mergedRel;
      }
    }
    if (patch.meta) {
      doc.data.meta = merge(doc.data.meta, patch.meta);
    }
    let api = await this.cardService.getAPI();
    await api.updateFromSerialized(instance, doc, this.store);
    let shouldPersist = !opts?.doNotPersist;
    let shouldAwaitPersist = shouldPersist && !opts?.doNotWaitForPersist;
    let persistedResult: CardDef | CardErrorJSONAPI | undefined = instance;

    if (opts?.doNotPersist) {
      await this.startAutoSaving(instance);
    } else if (shouldPersist) {
      let persistPromise = this.persistAndUpdate(instance, {
        clientRequestId: opts?.clientRequestId,
      });
      if (shouldAwaitPersist) {
        persistedResult = await persistPromise;
      }
    }

    return persistedResult as T | CardErrorJSONAPI;
  }

  // Instances only: the query runs against the search requesting full
  // `item` serializations, the results hydrate into the store, and the caller
  // gets instances back. For the raw entry wire format (HTML
  // renderings, field-limited serializations, the document itself) use
  // `searchEntries` — that surface lives on this service only, never on the
  // `Store` interface cards receive.
  async search<T extends CardDef | FileDef = CardDef>(
    query: Query,
    realms?: string[],
  ): Promise<T[]>;
  async search<T extends CardDef | FileDef = CardDef>(
    query: Query,
    realms: string[] | undefined,
    opts: {
      includeMeta: true;
      dependencyTrackingContext?: RuntimeDependencyTrackingContext;
      cardInitiated?: boolean;
    },
  ): Promise<{ instances: T[]; meta: QueryResultsMeta }>;
  async search<T extends CardDef | FileDef = CardDef>(
    query: Query,
    realms?: string[],
    opts?: {
      includeMeta?: boolean;
      dependencyTrackingContext?: RuntimeDependencyTrackingContext;
      // Set only by the card `@context` surfaces (getCards + the card-facing
      // store). Applies the caps that protect against untrusted card code —
      // page size, realms fan-out, and the concurrency throttle — none of which
      // constrain the host app's own direct search calls.
      cardInitiated?: boolean;
    },
  ): Promise<T[] | { instances: T[]; meta: QueryResultsMeta }> {
    if ('asData' in query && query.asData) {
      throw new Error(
        `store.search returns instances only — use store.searchEntries for the raw entry wire format`,
      );
    }
    let searchRealms = this.normalizeSearchRealms(realms);
    if (searchRealms.length === 0) {
      return opts?.includeMeta
        ? { instances: [], meta: { page: { total: 0 } } }
        : [];
    }
    if (opts?.cardInitiated) {
      // Enforce the card-facing caps on the resolved request. The realms cap
      // runs on the normalized list, so a card that omits realms — which
      // defaults to every realm visible to the user — is still bounded. These
      // throw a SearchBoundError the caller surfaces as a search error.
      assertRealmsBound(searchRealms);
      query = applySearchPageBound(query);
    }
    let run = () =>
      this.fetchAndHydrateSearchResults<T>(
        query,
        searchRealms,
        opts?.dependencyTrackingContext,
      );
    let result = opts?.cardInitiated
      ? await this.performThrottledSearch(run)
      : await run();
    return opts?.includeMeta ? result : result.instances;
  }

  // The raw wire format: heterogeneous `entry` resources with the
  // `html` / `item` branches the query's `fields[entry]` selects.
  // Nothing is hydrated into the store.
  async searchEntries(
    query: SearchEntryWireQuery,
    realms?: string[],
  ): Promise<SearchEntryResults> {
    let searchRealms = this.normalizeSearchRealms(realms);
    if (searchRealms.length === 0) {
      return { data: [], meta: { page: { total: 0 } } };
    }
    return await this.fetchSearchEntryDoc(query, searchRealms);
  }

  // Selective inflate for a `<SearchResults>` consumer of `searchEntries`:
  // deposit one full `item` serialization into the store so a by-URL read (or
  // the hydration GET) resolves it without a round-trip. A sparse `item` (one
  // carrying `meta.sparseFields`) is never deposited — it would misrepresent
  // the instance and could clobber a correctly-loaded full one — so the call
  // is a no-op for it; likewise an item carrying an error doc (`meta.error`),
  // which stands in for a card that failed to render and is not a real
  // instance. `entry`s carry no serialization to deposit. Idempotent:
  // depositing is skipped when the instance is already resident.
  async inflateSearchEntryItem(
    resource: CardResource<Saved> | FileMetaResource,
  ): Promise<void> {
    // Read `meta.error` before the guard: `isSparseItemResource`'s negative
    // narrowing would otherwise reduce `resource` to `never` in the second
    // operand.
    if (resource.meta.error != null || isSparseItemResource(resource)) {
      return;
    }
    await this.addResourceFromSearchData(resource);
  }

  private normalizeSearchRealms(realms: string[] | undefined): string[] {
    let normalizedRealms = (realms ?? [])
      .map((realm) => new RealmPaths(new URL(realm)).url)
      .filter(Boolean);
    return normalizedRealms.length > 0
      ? normalizedRealms
      : this.realmServer.availableRealmIdentifiers;
  }

  // Client-side concurrency throttle for card-initiated (`@context`) item-leg
  // searches. `getSearchResource` — the function bound as `getCards` on the
  // card `@context` — routes its search through this task; the host app's own
  // direct `store.search` / `getSearch` callers do not, so the trusted host is
  // never throttled. `enqueue` + `maxConcurrency` queues (never drops) excess
  // card searches, so a card firing many searches at once (e.g. a per-keystroke
  // grid) can't fan a burst of concurrent `_federated-search` requests at the
  // realm-server. The server's per-request bounds (page / realms / time) are
  // the un-overridable backstop; this keeps well-behaved cards from tripping
  // them in the first place.
  private searchThrottle = task(
    { maxConcurrency: SEARCH_CONCURRENCY_CAP, enqueue: true },
    async (run: () => Promise<unknown>): Promise<unknown> => {
      return await run();
    },
  );

  // Run a card-`@context` search under the concurrency throttle. The value is,
  // at runtime, the ember-concurrency task instance, so awaiting it inside a
  // caller's own (restartable) task links cancellation — a superseded search
  // frees its slot. Typed as a plain Promise because callers only ever await
  // the result; they don't drive the task instance directly.
  performThrottledSearch<R>(run: () => Promise<R>): Promise<R> {
    return this.searchThrottle.perform(run) as unknown as Promise<R>;
  }

  // The store handed to cards as `@context.store`, bound to the realm the
  // `@context` was provided with (`getCurrentRealm`). It behaves exactly like
  // the store service except `search` runs card-initiated — under the page,
  // realms, and concurrency caps — and a search that names no realm targets the
  // current realm instead of every realm the user can see. So a card can't
  // dodge the caps (or fan out to all realms) by reaching for
  // `@context.store.search` directly instead of `getCards`. Every other method
  // delegates straight through. The host app injects the store service itself,
  // never this view, so host search is unconstrained. `searchEntries` isn't on
  // the card-facing `Store` interface, so the html leg needs no handling here.
  cardFacingStore(getCurrentRealm: () => string | undefined): StoreInterface {
    let store = this;
    return new Proxy(store, {
      get(target, prop) {
        if (prop === 'search') {
          return (query: Query, realmURLs?: string[]) => {
            let current = getCurrentRealm();
            let realms = realmURLs ?? (current ? [current] : ([] as string[]));
            return target.search(query, realms, { cardInitiated: true });
          };
        }
        let value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as unknown as StoreInterface;
  }

  private async fetchAndHydrateSearchResults<
    T extends CardDef | FileDef = CardDef,
  >(
    query: Query,
    realms: string[],
    dependencyTrackingContext?: RuntimeDependencyTrackingContext,
  ): Promise<{ instances: T[]; meta: QueryResultsMeta }> {
    let collectionDoc = await this.fetchSearchDoc(query, realms);

    // Hydrate each result into the store. The data-only entry doc
    // carries one full `item` (`card`/`file-meta`) serialization per entry in
    // `included`, reached through the entry's `item` relationship.
    let items = this.itemResourcesFromSearchEntries(collectionDoc);
    let instances = (
      await Promise.all(
        items.map(async (resource) => {
          try {
            return await this.addResourceFromSearchData<T>(
              resource,
              dependencyTrackingContext,
            );
          } catch (error) {
            storeLogger.warn(
              `Failed to hydrate resource from search results (id: ${'id' in resource ? resource.id : 'unknown'})`,
              error,
            );
            return undefined;
          }
        }),
      )
    ).filter(Boolean) as T[];

    return { instances, meta: collectionDoc.meta };
  }

  // The instances path's resolved-document layer: the `Query` runs against
  // the search requesting full `item` serializations, and the resulting
  // entry document (one `item` per entry in `included`) is what the
  // hydration pipeline and the caches below consume.
  // Sits between `store.search` and `_federated-search`.
  //
  // Two layers of dedup, both prerender-gated:
  //
  //   1. Resolved-doc cache (`searchCache`). Keyed by
  //      (jobId, consumingRealm, query). Same-realm-only so a
  //      cross-realm read can't freeze a value while a peer
  //      realm-server replica swaps mid-job. Hit → return cached doc
  //      synchronously, no network. Miss → fall through.
  //   2. In-flight Map (`inflightSearch`). Concurrent same-(realms,
  //      query) callers share one pending fetch. Sequential repeats
  //      that don't hit layer 1 still pay the round-trip; layer 1 is
  //      what closes the sequential-repeat window.
  //
  // Outside a prerender both layers are bypassed so live-SPA
  // write-then-read flows keep their current freshness semantics.
  private async fetchSearchDoc(
    query: Query,
    realms: string[],
  ): Promise<SearchEntryResults> {
    let inPrerender = Boolean((globalThis as any).__boxelRenderContext);
    let jobId = inPrerender
      ? ((globalThis as any).__boxelJobId as string | undefined)
      : undefined;
    let consumingRealm = inPrerender
      ? ((globalThis as any).__boxelConsumingRealm as string | undefined)
      : undefined;

    // Belt-and-braces jobId-change clear at fetch-entry. `resetState`
    // and the render-route deactivate hook are the primary paths; this
    // catches a prerender tab reused across jobs without either firing.
    if (typeof jobId === 'string' && jobId !== this.searchCacheJobId) {
      this.searchCache.clear();
      this.searchCacheJobId = jobId;
      this.searchCacheGeneration++;
    }

    // Resolved-doc cache eligibility: prerender + jobId + same-realm.
    // Cross-realm reads bypass — see field comment.
    let cacheKey: string | undefined;
    if (
      inPrerender &&
      typeof jobId === 'string' &&
      typeof consumingRealm === 'string' &&
      realms.length === 1 &&
      realms[0] === consumingRealm
    ) {
      cacheKey = searchCacheKey(jobId, consumingRealm, query);
      if (cacheKey !== undefined) {
        let cached = this.searchCache.get(cacheKey);
        if (cached !== undefined) {
          return cached;
        }
      }
    }
    // Snapshot the generation *after* the entry-time clear so a
    // concurrent clear arriving during the await below is observable
    // as a generation drift and we skip the populate. Mirrors the
    // identity check used by the in-flight Map below.
    let captureGeneration = this.searchCacheGeneration;

    let inflightKey = inPrerender
      ? searchInFlightKey(realms, query)
      : undefined;
    let doc: SearchEntryResults;
    if (inflightKey !== undefined) {
      let existing = this.inflightSearch.get(inflightKey);
      if (existing) {
        doc = await existing;
      } else {
        let pending = this.fetchSearchDocUncoalesced(query, realms).finally(
          () => {
            // Identity-check before deletion: a concurrent
            // `clearInFlightSearch()` could in principle have removed
            // (and a later caller re-set) this slot while we were
            // in-flight. Only clean up if the map still points at *this*
            // pending promise.
            if (this.inflightSearch.get(inflightKey) === pending) {
              this.inflightSearch.delete(inflightKey);
            }
          },
        );
        this.inflightSearch.set(inflightKey, pending);
        doc = await pending;
      }
    } else {
      doc = await this.fetchSearchDocUncoalesced(query, realms);
    }

    // Populate only if the cache generation hasn't moved under us. A
    // route deactivate (clearSearchCache) or `resetState` between
    // fetch-entry and resolve would bump the generation; in that case
    // the resolved doc belongs to a now-stale window and must not
    // repopulate the cleared cache. The caller still receives `doc`
    // — only the *cache write* is suppressed.
    if (
      cacheKey !== undefined &&
      this.searchCacheGeneration === captureGeneration
    ) {
      this.searchCache.set(cacheKey, doc);
    }
    return doc;
  }

  private async fetchSearchDocUncoalesced(
    query: Query,
    realms: string[],
  ): Promise<SearchEntryResults> {
    // Search spans card instances and files. A query with a positive
    // *concrete* type ref already selects a kind (a card type -> instances, a
    // FileDef type -> files), so it passes through with the default 'all'
    // scope and its filter discriminates. An otherwise-unscoped query is
    // pinned to 'cards' so the common "search for cards" case doesn't surface
    // a card's dual-indexed `.json` file row (or plain files) — the choke
    // point that replaces the former per-call-site card anchor, while leaving
    // file/typed searches (e.g. SearchResource's file-meta queries) untouched.
    //
    // A BaseDef ref is *not* kind-selecting — it terminates both kinds' type
    // chains, so it matches every row — and is pinned to 'cards' like an
    // untyped query. Known gap: a mixed `any:` whose one branch is card-typed
    // and another untyped counts as positively typed, so its untyped branch
    // can still match file rows in 'all' scope; no caller composes that shape
    // today.
    let typeRefs = query.filter
      ? getTypeRefsFromFilter(query.filter)
      : undefined;
    let hasPositiveType =
      typeRefs?.some((r) => !r.negated && !isEqual(r.ref, baseRef)) ?? false;
    let scope: SearchEntryScope | undefined = hasPositiveType
      ? undefined
      : 'cards';
    return await this.fetchSearchEntryDoc(
      searchEntryWireQueryFromQuery(query, {
        fields: ['item'],
        ...(scope ? { scope } : {}),
      }),
      realms,
    );
  }

  // Extract the per-entry `item` (`card`/`file-meta`) serializations from a
  // data-only entry document, in entry order: each entry's `item`
  // relationship names a `(type, id)` resolved against `included`.
  private itemResourcesFromSearchEntries(
    doc: SearchEntryResults,
  ): (CardResource<Saved> | FileMetaResource)[] {
    let byKey = new Map<string, CardResource<Saved> | FileMetaResource>();
    for (let included of doc.included ?? []) {
      if (included.type === 'card' || included.type === 'file-meta') {
        byKey.set(`${included.type}:${included.id}`, included);
      }
    }
    let items: (CardResource<Saved> | FileMetaResource)[] = [];
    for (let entry of doc.data) {
      let ref = entry.relationships.item?.data;
      if (!ref) {
        continue;
      }
      let item = byKey.get(`${ref.type}:${ref.id}`);
      if (item) {
        items.push(item);
      }
    }
    return items;
  }

  private async fetchSearchEntryDoc(
    query: SearchEntryWireQuery,
    realms: string[],
  ): Promise<SearchEntryResults> {
    let realmServerURLs = this.realmServer.getRealmServersForRealms(realms);
    // TODO remove this assertion after multi-realm server/federated identity is supported
    this.realmServer.assertOwnRealmServer(realmServerURLs);
    let [realmServerURL] = realmServerURLs;
    let searchURL = new URL('_federated-search', realmServerURL);
    let response = await this.realmServer.maybeAuthedFetchForRealms(
      searchURL.href,
      realms,
      {
        method: 'QUERY',
        headers: {
          Accept: SupportedMimeType.CardJson,
          'Content-Type': 'application/json',
          ...duringPrerenderHeaders(),
          ...consumingRealmHeader(),
          ...jobIdHeader(),
          ...jobPriorityHeader(),
          ...loggingCorrelationIdHeader(),
        },
        body: JSON.stringify({ ...query, realms }),
      },
    );
    if (!response.ok) {
      let responseText = await response.text();
      let err = new Error(
        `status: ${response.status} - ${response.statusText}. ${responseText}`,
      ) as any;
      err.status = response.status;
      err.responseText = responseText;
      err.responseHeaders = response.headers;
      throw err;
    }
    let json = await response.json();
    if (!isEntryCollectionDocument(json)) {
      throw new Error(
        `The realm search response was not a valid entry collection document:
        ${JSON.stringify(json, null, 2)}`,
      );
    }
    return json;
  }

  // Conditional single-instance card+html GET: fetch one `entry` sourced by
  // URL (the single-instance counterpart of `_search`), with the rendering
  // selection spelled as query params and the client's held composite
  // validator as `If-None-Match`. A `304` means the client's rendering is
  // current; a `200` returns the fresh entry (with an `item` fallback when no
  // rendering exists). The live-search selective refresh uses this to bring one
  // member's HTML up to date without re-querying the whole search. Nothing is
  // hydrated into the store.
  async fetchCardEntry(
    url: string,
    opts: {
      kind: StoreReadType;
      format?: PrerenderedHtmlFormat;
      renderType?: ResolvedCodeRef;
      // `html` | `item` | `html,item`; omit for the default resolution (the
      // selected rendering, falling back to `item` where none matched).
      fields?: string;
      ifNoneMatch?: string;
    },
  ): Promise<
    { notModified: true } | { notModified: false; doc: EntrySingleDocument }
  > {
    let requestURL = new URL(url);
    if (opts.format) {
      requestURL.searchParams.set('format', opts.format);
    }
    if (opts.renderType) {
      requestURL.searchParams.set(
        'renderType',
        `${opts.renderType.module}/${opts.renderType.name}`,
      );
    }
    if (opts.fields) {
      requestURL.searchParams.set('fields', opts.fields);
    }
    let headers: Record<string, string> = {
      Accept:
        opts.kind === 'file-meta'
          ? SupportedMimeType.FileMetaHtml
          : SupportedMimeType.CardHtml,
      ...duringPrerenderHeaders(),
      ...consumingRealmHeader(),
      ...jobIdHeader(),
      ...jobPriorityHeader(),
      ...loggingCorrelationIdHeader(),
    };
    if (opts.ifNoneMatch) {
      headers['If-None-Match'] = opts.ifNoneMatch;
    }
    let response = await this.network.authedFetch(requestURL.href, {
      method: 'GET',
      headers,
    });
    if (response.status === 304) {
      return { notModified: true };
    }
    if (!response.ok) {
      let responseText = await response.text();
      let err = new Error(
        `status: ${response.status} - ${response.statusText}. ${responseText}`,
      ) as any;
      err.status = response.status;
      err.responseText = responseText;
      err.responseHeaders = response.headers;
      throw err;
    }
    // The response content-type is the negotiated `application/vnd.card+html`
    // (not `+json`), but the body is a JSON:API document — parse the text.
    let json = JSON.parse(await response.text());
    if (!isEntrySingleDocument(json)) {
      throw new Error(
        `The card+html response was not a valid entry single document:
        ${JSON.stringify(json, null, 2)}`,
      );
    }
    return { notModified: false, doc: json };
  }

  getSearchResource<T extends CardDef | FileDef = CardDef>(
    parent: object,
    getQuery: () => Query | undefined,
    getRealms?: () => string[] | undefined,
    opts?: {
      isLive?: boolean;
      doWhileRefreshing?: (() => void) | undefined;
      dependencyTracking?: RuntimeDependencyTrackingContext;
      // Set by the `@context` providers (the card-facing `getCards`): run the
      // search under the card caps and default a no-realm search to
      // `getDefaultRealm`. Left unset by non-`@context` callers (query-field
      // support, the render-store hook), which stay unconstrained.
      cardInitiated?: boolean;
      getDefaultRealm?: () => string | undefined;
      seed?: {
        cards: T[];
        searchURL?: string;
        meta?: QueryResultsMeta;
        errors?: ErrorEntry[];
        queryErrors?: Array<{
          realm: string;
          type: string;
          message: string;
          status?: number;
        }>;
        cardURLs?: string[];
      };
    },
  ): SearchResource<T> {
    if (this.isRenderStore && opts) {
      opts.isLive = false;
    }
    // `cardInitiated` + `getDefaultRealm` ride through `opts`: the `@context`
    // providers pass them (card-facing `getCards`); other callers don't and stay
    // unconstrained.
    return getSearch<T>(parent, getOwner(this)!, getQuery, getRealms, {
      ...opts,
      storeService: this,
    }) as unknown as SearchResource<T>;
  }

  getSaveState(id: string): AutoSaveState | undefined {
    id = asURL(id, this.network.virtualNetwork);
    return this.autoSaveStates.get(id);
  }

  async flush() {
    await this.ready;
    await Promise.allSettled(this.newReferencePromises);
  }

  async flushSaves() {
    await Promise.allSettled(this.autoSavePromises.values());
  }

  getReferenceCount(id: string) {
    id = asURL(id, this.network.virtualNetwork);
    return this.referenceCount.get(id) ?? 0;
  }

  isSameId(a: string, b: string): boolean {
    return a === b || this.peek(a) === this.peek(b);
  }

  async waitForCardLoad(cardId: string): Promise<void> {
    let normalizedId = asURL(cardId, this.network.virtualNetwork);
    if (!normalizedId) {
      return;
    }
    let inflightLoad = this.inflightCardLoads.get(normalizedId);
    if (inflightLoad) {
      await inflightLoad.promise;
    }
  }

  private startTrackingCardLoad(
    cardId: string | undefined,
  ): Deferred<void> | undefined {
    if (!cardId) {
      return;
    }
    let normalizedId = asURL(cardId, this.network.virtualNetwork);
    if (!normalizedId) {
      return;
    }
    let deferred = new Deferred<void>();
    this.inflightCardLoads.set(normalizedId, deferred);
    return deferred;
  }

  private finishTrackingCardLoad(
    cardId: string | undefined,
    deferred?: Deferred<void>,
  ) {
    if (!cardId || !deferred) {
      return;
    }
    let normalizedId = asURL(cardId, this.network.virtualNetwork);
    if (!normalizedId) {
      return;
    }
    let current = this.inflightCardLoads.get(normalizedId);
    if (current === deferred) {
      this.inflightCardLoads.delete(normalizedId);
    }
    deferred.fulfill();
  }

  private async wireUpNewReference(
    url: string,
    readType: StoreReadType = 'card',
  ) {
    let deferred = new Deferred<void>();
    await this.withTestWaiters(async () => {
      this.newReferencePromises.push(deferred.promise);
      try {
        await this.ready;
        if (readType === 'file-meta') {
          let instanceOrError = await this.getFileMetaInstance<FileDef>({
            idOrDoc: url,
          });
          this.setIdentityContext(
            instanceOrError as FileDef | CardErrorJSONAPI,
            'file-meta',
          );
          deferred.fulfill();
          return;
        }
        // Check file-meta map as well as card map — file-meta instances
        // are loaded into their own map by store.get(id, { type: 'file-meta' })
        let fileMetaInstance =
          this.peekError(url, { type: 'file-meta' }) ??
          this.peek(url, { type: 'file-meta' });
        if (fileMetaInstance) {
          // File-meta instances don't need auto-saving or card wiring
          deferred.fulfill();
          return;
        }
        let instanceOrError = this.peekError(url) ?? this.peek(url);
        if (!instanceOrError) {
          instanceOrError = await this.getCardInstance({
            idOrDoc: url,
          });
          this.setIdentityContext(instanceOrError);
        }
        await this.startAutoSaving(instanceOrError);
        if (!instanceOrError.id) {
          // keep track of urls for cards that are missing
          this.store.addCardInstanceOrError(url, instanceOrError);
        }
        deferred.fulfill();
      } catch (e) {
        console.error(
          `error encountered wiring up new reference for ${JSON.stringify(url)}`,
          e,
        );
        deferred.reject(e);
      }
    });
  }

  /**
   * Low-level deserialization that throws on validation errors.
   *
   * Most callers should use `add()` or `create()` instead — those methods
   * handle persistence, identity mapping, and auto-saving. This method
   * bypasses all of that and calls `card-api.createFromSerialized` directly.
   *
   * `store.add()` relaxes serialization errors: `Field.validate()` failures
   * during deserialization are caught internally and logged as console warnings
   * rather than thrown. This is correct for the UI but not for validation use
   * cases where errors must propagate. Use this method only when you need
   * validation errors to throw (e.g., the software-factory's instantiate-card
   * command which validates that a card instance can be deserialized).
   */
  async __dangerousCreateFromSerialized<T extends CardDef>(
    resource: LooseCardResource,
    doc: LooseSingleCardDocument | CardDocument,
    relativeTo?: URL | undefined,
    dependencyTrackingContext?: RuntimeDependencyTrackingContext,
  ): Promise<T> {
    return this.createFromSerialized(
      resource,
      doc,
      relativeTo,
      dependencyTrackingContext,
    );
  }

  private async createFromSerialized<T extends CardDef>(
    resource: LooseCardResource,
    doc: LooseSingleCardDocument | CardDocument,
    relativeTo?: RealmResourceIdentifier | URL | undefined,
    dependencyTrackingContext?: RuntimeDependencyTrackingContext,
  ): Promise<T> {
    let api = await this.cardService.getAPI();
    let shouldStubTimers =
      this.renderContextBlocksPersistence() && !isTesting();
    let performCreate = async () =>
      (await api.createFromSerialized(resource, doc, relativeTo, {
        store: this.store,
        dependencyTrackingContext,
      })) as T;
    let card = shouldStubTimers
      ? await withStubbedRenderTimers(performCreate)
      : await performCreate();
    return card;
  }

  private async setup() {
    let api = await this.cardService.getAPI();
    if (isDestroyed(this) || isDestroying(this)) {
      return;
    }
    this.gcInterval = setInterval(
      () => this.store.sweep(api),
      2 * 60_000,
    ) as unknown as number;
  }

  private unsubscribeFromInstance(id: string) {
    let instance = this.store.getCard(id);
    if (instance && this.cardApiCache) {
      this.cardApiCache.unsubscribeFromChanges(
        instance,
        this.onInstanceUpdated,
      );
    }

    // if there are no more subscribers to this realm then unsubscribe from realm
    let realmHref = !isLocalId(id)
      ? [...this.subscriptions.keys()].find((realmURL) =>
          id.startsWith(realmURL),
        )
      : undefined;
    if (!realmHref) {
      return;
    }

    let subscription = this.subscriptions.get(realmHref);
    if (
      subscription &&
      ![...this.referenceCount.entries()].find(
        ([referenceId, count]) =>
          !isLocalId(referenceId) &&
          count > 0 &&
          referenceId.startsWith(realmHref),
      )
    ) {
      subscription.unsubscribe();
      this.subscriptions.delete(realmHref);
    }
  }

  private createCardStore(): CardStore {
    return new CardStore(
      this.referenceCount,
      this.network.authedFetch,
      this.network.virtualNetwork,
      {
        getSearchResource: (parent, getQuery, getRealms, opts) =>
          this.getSearchResource(parent, getQuery, getRealms, opts),
      },
    );
  }

  private handleInvalidations = (event: RealmEventContent) => {
    if (event.eventName !== 'index') {
      return;
    }

    if (event.indexType !== 'incremental') {
      return;
    }
    let invalidations = event.invalidations as string[];

    if (
      invalidations.find(
        (i) =>
          hasExecutableExtension(i) &&
          this.loaderService.loader.isModuleLoaded(i),
      )
    ) {
      // the invalidation included code changes to modules that are already
      // loaded. in this case we need to flush the loader so that we can pick
      // up the updated code before re-running the card. net-new modules that
      // have never been loaded don't require a loader reset.
      this.loaderService.resetLoader();
      this.store.reset();
      this.reestablishReferences.perform();
    }

    for (let invalidation of invalidations) {
      if (hasExecutableExtension(invalidation)) {
        // we already dealt with this
        continue;
      }
      let fileMetaInstance =
        this.peekError(invalidation, { type: 'file-meta' }) ??
        this.peek(invalidation, { type: 'file-meta' });
      if (fileMetaInstance) {
        realmEventsLogger.debug(
          `reloading file-meta resource ${invalidation} because it was previously loaded`,
        );
        this.reloadFileMetaTask.perform(invalidation);
      }
      let clientRequestId = event.clientRequestId ?? undefined;

      let instance = this.peekError(invalidation) ?? this.peek(invalidation);
      if (instance) {
        if (isCardInstance(instance)) {
          // The invalidation id is the canonical remote id for this card. When
          // the server has just assigned a remote id to a locally-created
          // instance, this event is the first the store hears of it: the
          // instance is still keyed by its local id with an unset/local `id`.
          // Reconcile the identity now — this event is precisely when we learn a
          // remote id exists for the local id. We only learn the identity here,
          // not the new content: the instance keeps its original local content
          // until `reloadInstance` (below) fetches the server state, but its
          // `id` must be the remote id first so that fetch targets the right
          // URL. Doing it here, in the event handler, keeps `store.peek` a pure
          // read — reconciling during a render-time peek would mutate the
          // tracked `id` mid-render and trip a backtracking re-render assertion.
          if (
            invalidation.split('/').pop() === instance[localIdSymbol] &&
            instance.id !== rri(invalidation)
          ) {
            instance.id = rri(invalidation);
          }
          // Do not reload if the event is a result of an instance-editing request that we made. Otherwise we risk
          // overwriting the inputs with past values. This can happen if the user makes edits in the time between
          // the auto save request and the arrival realm event.
          let reloadFile = false;

          if (!clientRequestId) {
            reloadFile = true;
            realmEventsLogger.debug(
              `reloading file resource ${invalidation} because event has no clientRequestId`,
            );
          } else if (this.cardService.clientRequestIds.has(clientRequestId)) {
            if (
              clientRequestId.startsWith('instance:') ||
              clientRequestId.startsWith('editor-with-instance')
            ) {
              realmEventsLogger.debug(
                `ignoring invalidation for card ${invalidation} because request id ${clientRequestId} is ours and an instance type`,
              );
            } else {
              reloadFile = true;
              realmEventsLogger.debug(
                `reloading file resource ${invalidation} because request id ${clientRequestId} is not instance type`,
              );
            }
          } else {
            reloadFile = true;
            realmEventsLogger.debug(
              `reloading file resource ${invalidation} because request id ${clientRequestId} is not contained within known clientRequestIds`,
              Array.from(this.cardService.clientRequestIds.values()),
            );
          }

          if (reloadFile) {
            this.reloadTask.perform(instance);
          } else {
            realmEventsLogger.debug(
              `ignoring invalidation ${invalidation} for request id ${clientRequestId}`,
            );
          }
        } else {
          realmEventsLogger.debug(
            `reloading file resource ${invalidation} because it is in an error state`,
          );
          this.loadInstanceTask.perform(invalidation);
        }
      } else {
        realmEventsLogger.debug(
          `ignoring invalidation ${invalidation} because we did not previously try to load it`,
        );
      }
    }

    // A realm's name/icon is injected into every card's `meta.realmInfo` at
    // request time, but changing it (by editing the RealmConfig card at
    // realm.json) only invalidates the config card itself — not the cards that
    // display it. The realm index card (CardsGrid) renders the realm name as
    // its title, so reload it when the config card is re-indexed to refresh
    // that title without a browser reload. Scoped to the config card so we
    // don't reload on every unrelated card edit. Instance invalidations carry
    // the card id without `.json`, so the RealmConfig card at
    // `<realm>/realm.json` appears here as `<realm>/realm`.
    let realmConfigCardId = `${event.realmURL}realm`;
    if (invalidations.includes(realmConfigCardId)) {
      let indexCardId = `${event.realmURL}index`;
      let indexCard = this.peek(indexCardId);
      if (indexCard && isCardInstance(indexCard)) {
        realmEventsLogger.debug(
          `reloading index card ${indexCardId} because the realm config card was re-indexed`,
        );
        this.reloadTask.perform(indexCard);
      }
    }
  };

  private loadInstanceTask = task(
    async (idOrDoc: string | LooseSingleCardDocument) => {
      let url = asURL(idOrDoc, this.network.virtualNetwork);
      let reloadTracker = this.startTrackingCardLoad(url);
      try {
        let oldInstance = url ? this.store.getCard(url) : undefined;
        let instanceOrError = await this.getCardInstance({
          idOrDoc,
          opts: { noCache: true },
        });
        if (oldInstance) {
          await this.stopAutoSaving(oldInstance);
        }
        this.setIdentityContext(instanceOrError);
        await this.startAutoSaving(instanceOrError);
      } finally {
        this.finishTrackingCardLoad(url, reloadTracker);
      }
    },
  );

  private reestablishReferences = task(async () => {
    let remoteIds = new Set<string>();
    for (let [id, referenceCount] of this.referenceCount) {
      if (referenceCount === 0) {
        continue;
      }
      if (isLocalId(id)) {
        let remoteIdsForLocal = this.store.getRemoteIds(id);
        if (remoteIdsForLocal.length === 0) {
          let error = this.store.getCardError(id);
          if (error?.meta?.remoteId) {
            remoteIdsForLocal = [error.meta.remoteId];
          }
        }
        for (let remoteId of remoteIdsForLocal) {
          remoteIds.add(remoteId);
        }
      } else {
        remoteIds.add(id);
      }
    }
    await Promise.all(
      [...remoteIds].map((id) => this.getCardInstance({ idOrDoc: id })),
    );
  });

  private reloadTask = task(async (instance: CardDef) => {
    let reloadTracker = this.startTrackingCardLoad(instance.id);
    let maybeReloadedInstance: CardDef | CardErrorJSONAPI | undefined;
    let isDelete = false;

    try {
      try {
        await this.reloadInstance(instance);
        maybeReloadedInstance = instance;
      } catch (err: any) {
        if (err.status === 404) {
          // in this case the document was invalidated in the index because the
          // file was deleted
          isDelete = true;
        } else {
          let errorResponse = processCardError(instance.id, err);
          maybeReloadedInstance = errorResponse.errors[0];
        }
      }
      if (!isCardInstance(maybeReloadedInstance)) {
        await this.stopAutoSaving(instance);
      }
      if (maybeReloadedInstance) {
        this.setIdentityContext(maybeReloadedInstance);
        await this.startAutoSaving(maybeReloadedInstance);
      }
      if (isDelete) {
        await this.stopAutoSaving(instance);
        // Snapshot the consumers BEFORE removing the deleted instance from
        // the store. `consumersOf` walks the loaded cards and reads their
        // linksTo refs — every consumer that has the now-deleted card in
        // its bucket needs its slot rewritten to a link-not-found sentinel
        // so the placeholder render takes over the slot without a
        // navigation. Without this, the consumer's render stays stale on
        // the now-orphaned card object until something else forces a
        // re-render.
        let api = await this.cardService.getAPI();
        let consumers = this.store.consumersOf(api, instance);
        this.store.delete(instance.id);
        for (let consumer of consumers) {
          api.notifyLinksToTargetDeleted(consumer, instance.id);
        }
        // Notify direct-reference holders after the local eviction so their
        // re-evaluation does not return the cached pre-delete instance.
        // (The server is already gone — we got here from a 404 reload.)
        this.notifyCardInvalidationSubscribers(instance.id);
      }
    } finally {
      this.finishTrackingCardLoad(instance.id, reloadTracker);
    }
  });

  private reloadFileMetaTask = task(async (url: string) => {
    await this.withTestWaiters(async () => {
      let instanceOrError = await this.getFileMetaInstance<FileDef>({
        idOrDoc: url,
        opts: { noCache: true },
      });
      this.setIdentityContext(
        instanceOrError as FileDef | CardErrorJSONAPI,
        'file-meta',
      );
    });
  });

  private onInstanceUpdated = (instance: BaseDef, fieldName: string) => {
    if (fieldName === 'id') {
      // id updates are internal and do not trigger autosaves
      return;
    }
    if (isCardInstance(instance)) {
      this._instanceMutationVersion++;
      let autoSaveState = this.initOrGetAutoSaveState(instance);
      autoSaveState.hasUnsavedChanges = true;
      this.doAutoSave(instance);
    }
  };

  private setIdentityContext(
    instanceOrError: CardDef | FileDef | CardErrorJSONAPI,
    readType: StoreReadType = 'card',
  ) {
    if (readType === 'file-meta') {
      let id = (instanceOrError as { id?: string }).id;
      if (!id) {
        return;
      }
      this.store.addFileMetaInstanceOrError(
        id,
        instanceOrError as FileDef | CardErrorJSONAPI,
      );
      return;
    }

    let instance = isCardInstance(instanceOrError)
      ? instanceOrError
      : undefined;
    if (!instance && !instanceOrError.id) {
      return;
    }
    this.store.addCardInstanceOrError(
      instance ? (instance.id ?? instance[localIdSymbol]) : instanceOrError.id!, // we checked above to make sure errors have id's
      instanceOrError as CardDef | CardErrorJSONAPI,
    );
  }

  protected async createFileMetaFromSerialized(
    resource: LooseLinkableResource<FileMetaResource>,
    doc: LooseSingleResourceDocument<FileMetaResource>,
    relativeTo: RealmResourceIdentifier | URL | undefined,
    dependencyTrackingContext?: RuntimeDependencyTrackingContext,
  ): Promise<FileDef> {
    let api = await this.cardService.getAPI();
    let instance = (await api.createFromSerialized(resource, doc, relativeTo, {
      store: this.store,
      dependencyTrackingContext,
    })) as unknown as FileDef;
    this.setIdentityContext(instance, 'file-meta');
    return instance;
  }

  // Internal method for hydrating a resource from search response data.
  // This avoids N+1 queries when search results include card or file-meta resources.
  // Not part of the public API since it's meant for internal search result processing.
  private async addResourceFromSearchData<T extends CardDef | FileDef>(
    resource: CardResource<Saved> | FileMetaResource,
    dependencyTrackingContext?: RuntimeDependencyTrackingContext,
  ): Promise<T | undefined> {
    if (!resource.id) {
      throw new Error('resource must have an id');
    }
    // One-shot boundary canonicalization: search `item` resources carry the
    // index's URL-form ids, while instance and file-meta GET responses arrive
    // canonical (RRI prefix form for mapped realms). Fold the id to canonical
    // form here so an instance's identity — and everything keyed off it, like
    // the markdown pill slots — doesn't depend on which path hydrated it.
    let canonicalId = this.network.virtualNetwork.unresolveURL(resource.id);
    if (canonicalId !== resource.id) {
      (resource as { id: string }).id = canonicalId;
    }

    // Handle file-meta resources
    if (isFileMetaResource(resource)) {
      let existingInstance = this.peek(resource.id, { type: 'file-meta' });
      if (existingInstance && isFileDefInstance(existingInstance)) {
        return existingInstance as T;
      }
      let doc = { data: resource };
      return this.createFileMetaFromSerialized(
        resource,
        doc,
        resource.id,
        dependencyTrackingContext,
      ) as Promise<T>;
    }

    // Handle card resources
    let existingInstance = this.peek(resource.id);
    if (existingInstance && isCardInstance(existingInstance)) {
      return existingInstance as T;
    }
    // Mark resources that came from `_search` so query-field seed handling can
    // distinguish unresolved empty seeds from explicit empty card-GET results.
    (resource as any)[queryFieldSeedFromSearchSymbol] = true;
    return this.add({ data: resource } as SingleCardDocument, {
      doNotPersist: true,
      relativeTo: resource.id,
      dependencyTrackingContext,
    }) as Promise<T>;
  }

  private async startAutoSaving(instanceOrError: CardDef | CardErrorJSONAPI) {
    if (!isCardInstance(instanceOrError)) {
      return;
    }
    if (this.renderContextBlocksPersistence()) {
      // Persistence is blocked in this context, so the change subscription that
      // drives autosave can never produce a save. Skipping it avoids the
      // per-instance subscribe/unsubscribe churn — and the `getFields`
      // dependency-graph walk each one triggers — for every instance a render
      // loads.
      return;
    }
    let instance = instanceOrError;
    // module updates will break the cached api. so don't hang on to this longer
    // than necessary
    this.cardApiCache = await this.cardService.getAPI();
    this.cardApiCache.unsubscribeFromChanges(instance, this.onInstanceUpdated);
    this.cardApiCache.subscribeToChanges(instance, this.onInstanceUpdated);
  }

  private async stopAutoSaving(instanceOrError: CardDef | CardErrorJSONAPI) {
    if (!isCardInstance(instanceOrError)) {
      return;
    }
    let instance = instanceOrError;
    // module updates will break the cached api. so don't hang on to this longer
    // than necessary
    this.cardApiCache = await this.cardService.getAPI();
    this.cardApiCache.unsubscribeFromChanges(instance, this.onInstanceUpdated);
    this.autoSaveStates.delete(instance.id);
    this.autoSaveStates.delete(instance[localIdSymbol]);
  }

  private async getCardInstance<T extends CardDef>({
    idOrDoc,
    relativeTo,
    realm,
    opts,
  }: {
    idOrDoc: string | LooseSingleCardDocument;
    relativeTo?: RealmResourceIdentifier | URL;
    realm?: string; // used for new cards
    opts?: {
      noCache?: boolean;
      localDir?: string;
      dependencyTrackingContext?: RuntimeDependencyTrackingContext;
    };
  }): Promise<T | CardErrorJSONAPI> {
    let deferred: Deferred<T | CardErrorJSONAPI> | undefined;
    let id = asURL(idOrDoc, this.network.virtualNetwork);
    if (id) {
      let working = this.inflightGetCards.get(id);
      if (working) {
        return working as Promise<T | CardErrorJSONAPI>;
      }
      deferred = new Deferred<T | CardErrorJSONAPI>();
      this.inflightGetCards.set(
        id,
        deferred.promise as Promise<CardDef | CardErrorJSONAPI>,
      );
    }
    try {
      if (!id) {
        if (!this.renderContextBlocksPersistence()) {
          // this is a new card so instantiate it and save it
          let doc = idOrDoc as LooseSingleCardDocument;
          let newInstance = await this.createFromSerialized(
            doc.data,
            doc,
            relativeTo,
            opts?.dependencyTrackingContext,
          );
          let maybeError = await this.persistAndUpdate(newInstance, {
            realm,
            localDir: opts?.localDir,
          });
          if (!isCardInstance(maybeError)) {
            return maybeError;
          }
          this.store.setCard(newInstance.id, newInstance);
          deferred?.fulfill(newInstance as T);
          return newInstance as T;
        } else {
          throw new Error(`cannot save serialized doc in render context`);
        }
      }

      let existingInstance = this.peek(id);
      if (!opts?.noCache && existingInstance) {
        deferred?.fulfill(existingInstance as T | CardErrorJSONAPI);
        return existingInstance as T;
      }
      let vn = this.network.virtualNetwork;
      if (isLocalId(id) && !vn.isRegisteredPrefix(id)) {
        // we might have lost the local id via a loader refresh, try loading from remote id instead
        let remoteId = this.store.getRemoteIds(id)?.[0];
        if (!remoteId) {
          throw new Error(
            `instance with local id ${id} does not exist in the store`,
          );
        }
        id = remoteId;
      }
      // Resolve registered prefix IDs (e.g. @cardstack/skills/...) to actual
      // URLs so they can be used for fetching.
      let url = vn.isRegisteredPrefix(id) ? vn.toURL(id).href : id;
      let doc = (typeof idOrDoc !== 'string' ? idOrDoc : undefined) as
        | SingleCardDocument
        | undefined;
      if (!doc) {
        let json: CardDocument | undefined;
        if (this.isRenderStore && (globalThis as any).__boxelRenderContext) {
          let result = await this.cardService.getSource(
            vn.toURL(`${url}.json`),
          );
          if (result.status === 200) {
            // A relationship link can point at a non-card URL (e.g. an
            // image); gate on Content-Type so the binary body never
            // reaches JSON.parse.
            if (!isJsonContentType(result.contentType)) {
              throw new Error(
                `Could not load ${url} as a card: the response (content type ${
                  result.contentType ?? 'unknown'
                }) is not a card document. If this is a relationship link, it likely points at a non-card URL (e.g. an image) rather than a card.`,
              );
            }
            try {
              json = JSON.parse(result.content);
            } catch {
              // Content-Type claimed JSON but the body didn't parse
              // (e.g. truncated source) — still surface a clean error.
              throw new Error(
                `Could not load ${url} as a card: its source (content type ${
                  result.contentType ?? 'unknown'
                }) is not valid JSON.`,
              );
            }
          } else {
            throw new Error(
              `Received non-200 status fetching instance source ${url}.json: ${result.content}`,
            );
          }
        } else {
          json = await this.cardService.fetchJSON(url);
        }
        if (!isSingleCardDocument(json)) {
          // The URL turned out to be a binary file (e.g. an uploaded
          // image). The realm-server returns a file-meta JSON document
          // in that case; reroute to the file-meta load path so the
          // caller gets a FileDef instead of a hard failure.
          if (isSingleFileMetaDocument(json)) {
            // URL was a binary file; reroute to the file-meta bucket.
            let fileMeta = await this.getFileMetaInstance<FileDef>({
              idOrDoc: url,
              opts: {
                noCache: opts?.noCache,
                dependencyTrackingContext: opts?.dependencyTrackingContext,
              },
            });
            // Resolve inflightGetCards so concurrent callers don't hang.
            deferred?.fulfill(fileMeta as unknown as T | CardErrorJSONAPI);
            return fileMeta as unknown as T;
          }
          throw new Error(
            `bug: server returned a non card document for ${url}:
        ${JSON.stringify(json, null, 2)}`,
          );
        }
        if (
          !json.data.id ||
          !isResolvableInstanceId(json.data.id, this.network.virtualNetwork)
        ) {
          // Normalize the instance id to the canonical URL form when the
          // server-returned doc is missing one, or when it carries a bare
          // local id that doesn't resolve to a realm location (e.g. a
          // system card with a hardcoded literal `data.id`). Without this,
          // the bare id would be assigned to `instance.id` and later
          // collide with the canonical URL form during re-deserialization
          // (card-api.gts's "cannot change the id" guard).
          json.data.id = rri(url);
        }
        if (!json.data.meta?.realmURL) {
          // Source-mode loads in render context don't include realm metadata.
          // Query-backed relationship fields require realmURL to build their
          // fallback search query.
          let realmURL = this.realm.realmOf(rri(url));
          if (realmURL) {
            json.data.meta = {
              ...(json.data.meta ?? {}),
              realmURL: realmURL as RealmIdentifier,
            };
          }
        }
        doc = json;
      }
      let instance = await this.createFromSerialized(
        doc.data,
        doc,
        doc.data.id!, // normalized above to a URL/RRI by isResolvableInstanceId
        opts?.dependencyTrackingContext,
      );
      // in case the url is an alias for the id (like index card without the
      // "/index") we also add this
      this.store.setCard(url, instance);
      deferred?.fulfill(instance as T);
      if (!existingInstance || !isCardInstance(existingInstance)) {
        this.setIdentityContext(instance);
        await this.startAutoSaving(instance);
      }
      return instance as T;
    } catch (error: any) {
      let errorResponse = processCardError(id, error);
      let cardError = errorResponse.errors[0];
      deferred?.fulfill(cardError);
      this.setIdentityContext(cardError);
      let status = cardError?.status ?? error?.status;
      let isSystemCardDefault = isSystemCardDefaultId(
        id,
        idOrDoc,
        cardError?.id,
      );
      // suppress logging of 404s for system card defaults during tests
      let shouldLogAsError = !(
        isTesting() &&
        status === 404 &&
        isSystemCardDefault
      );
      let message = `error getting instance ${JSON.stringify(idOrDoc, null, 2)}: ${stringifyErrorForLog(error)}`;
      if (shouldLogAsError) {
        storeLogger.error(message);
      } else {
        storeLogger.debug(message);
      }
      return cardError;
    } finally {
      if (id) {
        this.inflightGetCards.delete(id);
      }
    }
  }

  private async getFileMetaInstance<T extends FileDef>({
    idOrDoc,
    opts,
  }: {
    idOrDoc: string | LooseSingleCardDocument;
    opts?: {
      noCache?: boolean;
      dependencyTrackingContext?: RuntimeDependencyTrackingContext;
    };
  }): Promise<T | CardErrorJSONAPI> {
    let deferred: Deferred<T | CardErrorJSONAPI> | undefined;
    let id = asURL(idOrDoc, this.network.virtualNetwork);
    if (!id) {
      throw new Error('file-meta reads require a URL id');
    }
    let working = this.inflightGetFileMeta.get(id);
    if (working) {
      return working as Promise<T | CardErrorJSONAPI>;
    }
    deferred = new Deferred<T | CardErrorJSONAPI>();
    this.inflightGetFileMeta.set(
      id,
      deferred.promise as Promise<FileDef | CardErrorJSONAPI>,
    );
    try {
      let existingInstance = this.peek(id, { type: 'file-meta' });
      if (!opts?.noCache && existingInstance) {
        deferred.fulfill(existingInstance as T | CardErrorJSONAPI);
        return existingInstance as T | CardErrorJSONAPI;
      }
      let vn = this.network.virtualNetwork;
      if (isLocalId(id) && !vn.isRegisteredPrefix(id)) {
        throw new Error(`file-meta reads do not support local ids (${id})`);
      }
      let url = vn.isRegisteredPrefix(id) ? vn.toURL(id).href : id;
      let fileMetaDoc: SingleFileMetaDocument | CardError;
      if (this.isRenderStore && (globalThis as any).__boxelRenderContext) {
        fileMetaDoc = await this.extractFileMetaDirectly(url);
      } else {
        fileMetaDoc = await this.store.loadFileMetaDocument(url, {
          dependencyTrackingContext: opts?.dependencyTrackingContext,
        });
      }
      if (isCardError(fileMetaDoc)) {
        throw fileMetaDoc;
      }
      let api = await this.cardService.getAPI();
      let fileInstance = await api.createFromSerialized(
        fileMetaDoc.data,
        fileMetaDoc,
        fileMetaDoc.data.id ?? new URL(url),
        {
          store: this.store,
          dependencyTrackingContext: opts?.dependencyTrackingContext,
        },
      );
      this.setIdentityContext(fileInstance as unknown as FileDef, 'file-meta');
      // The realm may serve the doc id in canonical prefix form (e.g.
      // `@cardstack/skills/...`) while the caller asked by URL. Register the
      // requested id as an alias — mirroring the card path — so later lookups
      // by either form find this instance instead of silently missing.
      if (fileMetaDoc.data.id && fileMetaDoc.data.id !== id) {
        this.store.setFileMeta(id, fileInstance as unknown as FileDef);
      }
      deferred.fulfill(fileInstance as T);
      return fileInstance as T;
    } catch (error: any) {
      let errorResponse = processCardError(id, error);
      let cardError = errorResponse.errors[0];
      deferred.fulfill(cardError);
      console.error(
        `error getting file-meta instance ${JSON.stringify(idOrDoc, null, 2)}: ${JSON.stringify(error, null, 2)}`,
        error,
      );
      return cardError;
    } finally {
      this.inflightGetFileMeta.delete(id);
    }
  }

  private async extractFileMetaDirectly(
    url: string,
  ): Promise<SingleFileMetaDocument | CardError> {
    let fileDefCodeRef = resolveFileDefCodeRef(
      new URL(url),
      this.network.virtualNetwork,
    );
    let extractor = new FileDefAttributesExtractor({
      loaderService: this.loaderService,
      network: this.network,
      fileURL: url,
      fileDefCodeRef,
      baseFileDefCodeRef: baseFileRef,
      contentHash: undefined,
      contentSize: undefined,
      buildError: (errorUrl, error) => {
        let errorJSONAPI = formattedError(errorUrl, error).errors[0];
        return errorJsonApiToErrorEntry(errorJSONAPI) as RenderError;
      },
    });
    let result = await extractor.extract();
    if (result.status === 'error' || !result.resource) {
      let msg = result.error?.error?.message ?? 'File extract failed';
      return new CardError(msg, { status: 500 });
    }
    return { data: result.resource };
  }

  // this function is used to determine if the instance will be auto-saved or
  // note this is a temporary function that is likely to go away with the
  // creation of completion ephemeral state solution of the store/realm the
  // only use-case for this function is determining if a preview instance in
  // catalog realm (which is a read-only), st a card can be mutable without
  // persisting to the server
  private useEphemeralState(instance: CardDef | undefined): boolean {
    if (!instance) {
      return false;
    }
    let realmURL = instance[realmURLSymbol];
    if (!realmURL) {
      // if a proper cannot derived, I just revert to the default behavior of auto-save
      return false;
    }
    let permissionToWrite = this.realm.permissions(realmURL.href).canWrite;
    return !permissionToWrite;
  }

  private doAutoSave(
    idOrInstance: string | CardDef,
    opts?: { isImmediate?: true },
  ) {
    let instance: CardDef | undefined;
    if (typeof idOrInstance === 'string') {
      let maybeInstance = this.peek(idOrInstance);
      if (!isCardInstance(maybeInstance)) {
        return;
      }
      instance = maybeInstance;
    } else {
      instance = idOrInstance;
    }
    if (this.useEphemeralState(instance)) {
      return;
    }
    let autoSaveState = this.initOrGetAutoSaveState(instance);
    let queueName = instance.id ?? instance[localIdSymbol];
    let autoSaveQueue = this.autoSaveQueues.get(queueName);
    if (!autoSaveQueue) {
      autoSaveQueue = [];
      this.autoSaveQueues.set(queueName, autoSaveQueue);
    }
    autoSaveQueue.push({ ...opts });
    autoSaveState.isSaving = true;
    autoSaveState.lastSaveError = undefined;
    this.drainAutoSaveQueue(queueName);
  }

  private async drainAutoSaveQueue(queueName: string) {
    return await this.withTestWaiters(async () => {
      await this.autoSavePromises.get(queueName);

      let instance = this.peek(queueName);
      if (!isCardInstance(instance)) {
        return;
      }
      await this.inflightCardMutations.get(instance[localIdSymbol]);

      let done: () => void;
      this.autoSavePromises.set(
        queueName,
        new Promise<void>((r) => (done = r)),
      );
      let autoSaves = [...(this.autoSaveQueues.get(queueName) ?? [])];
      this.autoSaveQueues.set(queueName, []);
      if (autoSaves && autoSaves.length > 0) {
        let autoSaveState = this.initOrGetAutoSaveState(instance);
        // favor isImmediate saves
        let isImmediate = Boolean(autoSaves.find((a) => a.isImmediate));
        try {
          let maybeError = await this.saveInstance(
            instance,
            isImmediate ? { isImmediate } : undefined,
          );
          autoSaveState.hasUnsavedChanges = false;
          autoSaveState.lastSaved = Date.now();
          autoSaveState.lastSavedErrorMsg = undefined;
          autoSaveState.lastSaveError =
            maybeError && !isCardInstance(maybeError) ? maybeError : undefined;
        } catch (error) {
          // error will already be logged in CardService
          if (autoSaveState) {
            autoSaveState.lastSaveError = error as Error;
          }
        } finally {
          autoSaveState.isSaving = false;
          this.calculateLastSavedMsg(autoSaveState);
          if (isLocalId(queueName) && instance.id) {
            this.autoSaveStates.set(instance.id, autoSaveState);
          }
        }
      }
      done!();
    });
  }

  private initOrGetAutoSaveState(instance: CardDef): AutoSaveState {
    let autoSaveState = this.autoSaveStates.get(
      instance.id ?? instance[localIdSymbol],
    );
    if (!autoSaveState) {
      autoSaveState = new TrackedObject({
        isSaving: false,
        hasUnsavedChanges: false,
        lastSaved: undefined,
        lastSavedErrorMsg: undefined,
        lastSaveError: undefined,
      });
      this.autoSaveStates.set(instance[localIdSymbol], autoSaveState);
    }
    if (instance.id && !this.autoSaveStates.get(instance.id)) {
      this.autoSaveStates.set(instance.id, autoSaveState);
    }
    return autoSaveState;
  }

  private async saveInstance(instance: CardDef, opts?: { isImmediate?: true }) {
    if (this.renderContextBlocksPersistence()) {
      // we skip saving when rendering cards in headless chrome
      return;
    }
    if (opts?.isImmediate) {
      return await this.persistAndUpdate(instance);
    } else {
      // these saves can happen so fast that we'll make sure to wait at
      // least 500ms for human consumption
      let [result] = await Promise.all([
        this.persistAndUpdate(instance),
        delay(500),
      ]);
      return result;
    }
  }

  private async saveCardDocument(
    doc: LooseSingleCardDocument,
    opts?: PersistOptions,
  ): Promise<SingleCardDocument> {
    let isSaved = !!doc.data.id;
    let url = resolveDocUrl(doc.data.id, opts?.realm, opts?.localDir);
    let json = await this.cardService.fetchJSON(url, {
      method: isSaved ? 'PATCH' : 'POST',
      body: JSON.stringify(doc, null, 2),
      headers: {
        'Content-Type': SupportedMimeType.CardJson,
      },
      clientRequestId: opts?.clientRequestId,
    });
    if (!isSingleCardDocument(json)) {
      throw new Error(
        `bug: arg is not a card document:
        ${JSON.stringify(json, null, 2)}`,
      );
    }
    return json;
  }

  private calculateLastSavedMsg(autoSaveState: AutoSaveState) {
    let savedMessage: string | undefined;
    if (autoSaveState.lastSaveError) {
      savedMessage = `Failed to save: ${this.getErrorMessage(
        autoSaveState.lastSaveError,
      )}`;
    } else if (autoSaveState.lastSaved) {
      savedMessage = `Saved ${formatDistanceToNow(autoSaveState.lastSaved, {
        addSuffix: true,
      })}`;
    }
    if (autoSaveState.lastSavedErrorMsg != savedMessage) {
      autoSaveState.lastSavedErrorMsg = savedMessage;
    }
  }

  private getErrorMessage(error: CardErrorJSONAPI | Error) {
    if (
      'meta' in error &&
      typeof error.meta === 'object' &&
      'responseHeaders' in error.meta &&
      error.meta.responseHeaders &&
      typeof error.meta.responseHeaders === 'object'
    ) {
      let wafRule = Object.entries(error.meta.responseHeaders).find(
        ([header]) => header.toLowerCase() === 'x-blocked-by-waf-rule',
      )?.[1];
      if (wafRule) {
        return `Request blocked by Web Application Firewall. X-blocked-by-waf-rule response header specifies rule: ${wafRule}`;
      }
    }
    if (error.message) {
      return error.message;
    }
    return 'Unknown error';
  }

  private async persistAndUpdate(
    instance: CardDef,
    opts?: PersistOptions,
  ): Promise<CardDef | CardErrorJSONAPI> {
    return await this.withTestWaiters(async () => {
      let isNew = !instance.id;
      let inflightMutation = this.inflightCardMutations.get(
        instance[localIdSymbol],
      );
      if (inflightMutation) {
        // the local instance is always up-to-date, but things can get messy if
        // we try to update an instance that is in the process of being created on
        // the server, because then it still looks like to the client another
        // POST should be issued when instead we really want to PATCH.
        await inflightMutation;
      }
      let deferred = new Deferred<void>();
      this.inflightCardMutations.set(instance[localIdSymbol], deferred.promise);
      try {
        let doc = await this.cardService.serializeCard(instance, {
          // for a brand new card that has no id yet, we don't know what we are
          // relativeTo because its up to the realm server to assign us an ID, so
          // URL's should be absolute
          useAbsoluteURL: true,
          withIncluded: true,
          omitQueryFields: true,
        });

        // send doc over the wire with absolute URL's. The realm server will convert
        // to relative URL's as it serializes the cards
        let realmURL = instance[realmURLSymbol];
        // in the case where we get no realm URL from the card, we are dealing with
        // a new card instance that does not have a realm URL yet.
        if (!realmURL) {
          let defaultRealmHref =
            opts?.realm ?? this.realm.defaultWritableRealm?.path;
          if (!defaultRealmHref) {
            throw new Error('Could not find a writable realm');
          }
          realmURL = new URL(defaultRealmHref);
        }
        let json = await this.saveCardDocument(doc, {
          realm: realmURL.href,
          localDir: opts?.localDir,
          clientRequestId: opts?.clientRequestId,
        });

        let api = await this.cardService.getAPI();
        // the store state represents the latest state and the server state is
        // potentially out-of-date. As such we only merge the server state that
        // the store does not know about specifically remote ID's and realm
        // meta. the attributes and relationships state from the server are
        // thrown away since the store has a more recent version of these.
        if (needsServerStateMerge(instance, json)) {
          let serverState = cloneDeep(json);
          delete serverState.data.attributes;
          delete serverState.data.relationships;
          await api.updateFromSerialized(instance, serverState, this.store);
        }
        if (isNew) {
          api.setId(instance, json.data.id!);
          this.subscribeToRealm(rri(instance.id));
          this.operatorModeStateService.handleCardIdAssignment(
            instance[localIdSymbol],
          );
          await this.updateForeignConsumersOf(instance);
          this.setIdentityContext(instance);
          await this.startAutoSaving(instance);
        }
        if (this.onSaveSubscriber) {
          this.onSaveSubscriber(
            this.network.virtualNetwork.toURL(json.data.id!),
            json,
          );
        }
        return instance;
      } catch (err) {
        console.error(`Failed to save ${instance.id}: `, err);
        let errorResponse = processCardError(
          instance.id ?? instance[localIdSymbol],
          err,
        );
        let cardError = errorResponse.errors[0];
        this.setIdentityContext(cardError);
        let remoteId = cardError.meta?.remoteId;
        if (remoteId && (!cardError.id || isLocalId(cardError.id))) {
          this.store.addCardInstanceOrError(remoteId, cardError);
        }
        return cardError;
      } finally {
        deferred.fulfill();
      }
    });
  }

  // in the case we are making a cross realm relationship with a link that
  // hasn't been saved yet, as soon as the link does actually get saved we need
  // to inform the consuming instances that live in different realms of the new
  // link's remote id and have those consumers update in their respective
  // realms.
  private async updateForeignConsumersOf(instance: CardDef) {
    let consumers = this.store.consumersOf(
      await this.cardService.getAPI(),
      instance,
    );
    let instanceRealm = instance[realmURLSymbol]?.href;
    if (!instanceRealm) {
      return;
    }

    for (let consumer of consumers) {
      let consumerRealm = consumer[realmURLSymbol]?.href;
      if (consumerRealm !== instanceRealm && consumer.id) {
        this.save(consumer.id);
      }
    }
  }

  private async reloadInstance(instance: CardDef): Promise<void> {
    // we don't await this in the realm subscription callback, so this test
    // waiter should catch otherwise leaky async in the tests
    await this.withTestWaiters(async () => {
      let api = await this.cardService.getAPI();
      let incomingDoc: SingleCardDocument = (await this.cardService.fetchJSON(
        instance.id,
        undefined,
      )) as SingleCardDocument;

      if (!isSingleCardDocument(incomingDoc)) {
        throw new Error(
          `bug: server returned a non card document for ${instance.id}:
        ${JSON.stringify(incomingDoc, null, 2)}`,
        );
      }
      await api.updateFromSerialized<typeof CardDef>(
        instance,
        incomingDoc,
        this.store,
      );
    });
  }

  private subscribeToRealm(url: RealmResourceIdentifier | URL) {
    if (this.hostModeService.isActive) {
      return;
    }

    let realmURL = this.realm.realmOf(url);
    if (!realmURL) {
      console.warn(
        `could not determine realm for card ${url instanceof URL ? url.href : url} when trying to subscribe to realm`,
      );
      return;
    }
    let subscription = this.subscriptions.get(realmURL);
    if (!subscription) {
      this.subscriptions.set(realmURL, {
        unsubscribe: this.messageService.subscribe(realmURL, (event) =>
          this.handleInvalidations(event),
        ),
      });
    }
  }

  private async loadPatchedInstances(
    patchData: PatchData,
    relativeTo: RealmResourceIdentifier | URL | undefined,
  ): Promise<{
    [fieldName: string]: CardDef | CardDef[];
  }> {
    if (!patchData?.relationships) {
      return {};
    }
    let result: { [fieldName: string]: CardDef | CardDef[] } = {};
    await Promise.all(
      Object.entries(patchData.relationships).map(async ([fieldName, rel]) => {
        if (Array.isArray(rel)) {
          let instances: CardDef[] = [];
          await Promise.all(
            rel.map(async (r) => {
              let instance = await this.loadRelationshipInstance(r, relativeTo);
              if (instance) {
                instances.push(instance);
              }
            }),
          );
          result[fieldName] = instances;
        } else {
          let instance = await this.loadRelationshipInstance(rel, relativeTo);
          if (instance) {
            result[fieldName] = instance;
          }
        }
      }),
    );
    return result;
  }

  private async loadRelationshipInstance(
    rel: Relationship,
    relativeTo: RealmResourceIdentifier | URL | undefined,
  ) {
    if (!rel.links?.self) {
      return;
    }
    let id = rel.links.self;
    let instance = await this.getCardInstance({
      idOrDoc: this.network.virtualNetwork.resolveURL(id, relativeTo).href,
    });
    return isCardInstance(instance) ? instance : undefined;
  }

  private async withTestWaiters<T>(cb: () => Promise<T>) {
    let token = waiter.beginAsync();
    try {
      let result = await cb();
      // only do this in test env--this makes sure that we also wait for any
      // interior card instance async as part of our ember-test-waiters
      if (isTesting()) {
        await this.cardService.cardsSettled();
      }
      return result;
    } finally {
      waiter.endAsync(token);
    }
  }
}

function processCardError(
  url: string | undefined,
  error: any,
): CardErrorsJSONAPI {
  let httpStatus = typeof error?.status === 'number' ? error.status : undefined;
  let errorResponse: CardErrorsJSONAPI;
  try {
    let parsed = JSON.parse(error.responseText);
    errorResponse = formattedError(url, error, parsed.errors?.[0]);
  } catch (parseError) {
    switch (error.status) {
      // tailor HTTP responses as necessary for better user feedback
      case 404:
        errorResponse = formattedError(url, error, {
          status: 404,
          title: 'Card Not Found',
          message: `The card ${url} does not exist`,
        });
        break;
      default:
        errorResponse = formattedError(url, error, undefined);
    }
  }
  // The realm server responds with an HTTP 404 only when the card document
  // itself is missing. A card that exists but can't be served — e.g. because a
  // module it imports is missing — comes back as a 5xx whose JSON:API body
  // still carries the dependency's propagated 404. Trust the HTTP status as
  // the authoritative not-found signal so a broken dependency surfaces as the
  // error it is rather than masquerading as a missing card.
  if (httpStatus != null && httpStatus !== 404) {
    let cardError = errorResponse.errors[0];
    if (cardError?.status === 404) {
      cardError.status = httpStatus;
    }
  }
  return errorResponse;
}

function needsServerStateMerge(
  instance: CardDef,
  serverState: SingleCardDocument,
): boolean {
  return (
    instance.id !== serverState.data.id ||
    !isEqual(instance[meta]?.realmInfo, serverState.data.meta.realmInfo)
  );
}

// A doc's `data.id` can usually be resolved against either a registered
// prefix (e.g. `@cardstack/base/foo`) or a URL form. Bare local ids that
// match neither (e.g. a system card with a hardcoded literal `id` field)
// can't be assigned to `instance.id` without later colliding with the
// canonical URL form when the same doc is re-deserialized. Callers that
// receive an id over the wire should pass it through this gate; if it
// returns false the caller substitutes the canonical URL form before
// deserialization.
function isResolvableInstanceId(id: string, vn: VirtualNetwork): boolean {
  return (
    vn.isRegisteredPrefix(id) ||
    id.startsWith('http://') ||
    id.startsWith('https://')
  );
}

export function asURL(urlOrDoc: string, vn: VirtualNetwork): string;
export function asURL(
  urlOrDoc: LooseSingleCardDocument,
  vn: VirtualNetwork,
): string | undefined;
export function asURL(
  urlOrDoc: string | LooseSingleCardDocument,
  vn: VirtualNetwork,
): string | undefined;
export function asURL(
  urlOrDoc: string | LooseSingleCardDocument,
  vn: VirtualNetwork,
) {
  if (typeof urlOrDoc !== 'string') {
    return urlOrDoc.data.id;
  }
  let id = urlOrDoc.replace(/\.json$/, '');
  // Locals stay as-is; remotes resolve through the VN to a normalized URL.
  // Keying stays in URL form so it matches gc-card-store, which keys instances
  // by their (URL-form) data.id. Flipping the store's canonical key to RRI is
  // deferred — it needs gc-card-store keyed the same way and the URL
  // normalization `toURL` provides here (see CS-11730).
  return isLocalId(id) ? id : vn.toURL(id).href;
}

function isSystemCardDefaultId(
  id: string | undefined,
  idOrDoc: string | LooseSingleCardDocument,
  errorId: string | undefined,
): boolean {
  let candidates = [
    id,
    typeof idOrDoc === 'string' ? idOrDoc : idOrDoc?.data?.id,
    errorId,
  ].filter(Boolean) as string[];
  return candidates.some((candidate) =>
    candidate.includes('/SystemCard/default'),
  );
}

async function withStubbedRenderTimers<T>(cb: () => Promise<T>): Promise<T> {
  if (typeof window === 'undefined' || isTesting()) {
    return await cb();
  }
  // Prevent cards that use timers (e.g. timers-card.gts) from continuing to
  // execute after we capture their HTML during prerender. In the browser we
  // normally let timers run, but in the render route we need deterministic,
  // single-shot renders so runaway timers don't crash indexing.
  let restore = enableRenderTimerStub();
  try {
    return await withTimersBlocked(cb);
  } finally {
    restore();
  }
}

// Resolves either to
// - an instance
// - a directory
function resolveDocUrl(id?: string, realm?: string, local?: string) {
  if (id) {
    return id;
  }
  if (!realm) {
    throw new Error('Cannot resolve target url without a realm');
  }
  let path = new RealmPaths(new URL(realm));
  if (local) {
    return path.directoryURL(local).href;
  }
  return path.url;
}

declare module '@ember/service' {
  interface Registry {
    store: StoreService;
  }
}
