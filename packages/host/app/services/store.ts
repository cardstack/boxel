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
import { keepLatestTask, task, didCancel, timeout } from 'ember-concurrency';

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
  loadCardDef,
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
  ri,
  rri,
  logger,
  formattedError,
  stringifyErrorForLog,
  applySearchPageBound,
  assertRealmsBound,
  isJsonContentType,
  QUERY_FIELD_SEARCH_CONCURRENCY_CAP,
  SEARCH_CONCURRENCY_CAP,
  SKIP_INDEX_WAIT_HEADER,
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
  humanReadable,
  type RealmIdentifier,
  type RealmResourceIdentifier,
  type Saved,
  type VirtualNetwork,
} from '@cardstack/runtime-common';

import CardStore, { getDeps, type ReferenceCount } from '../lib/gc-card-store';

import {
  consumingRealmHeader,
  duringPrerenderHeaders,
  headlessCommandWriteHeaders,
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
import type ClientTelemetryService from './client-telemetry';
import type EnvironmentService from './environment-service';

import type HostModeService from './host-mode-service';
import type LoaderService from './loader-service';
import type MessageService from './message-service';
import type NetworkService from './network';
import type OperatorModeStateService from './operator-mode-state-service';
import type RealmService from './realm';
import type RealmServerService from './realm-server';
import type SessionService from './session';
import type ToolService from './tool-service';
import type { SearchResource } from '../resources/search';
import type * as CardAPI from '@cardstack/base/card-api';
import type { CardDef, BaseDef } from '@cardstack/base/card-api';
import type { FileDef } from '@cardstack/base/file-api';
import type {
  CoalescedIndexWrite,
  IncrementalIndexEventContent,
  RealmEventContent,
} from '@cardstack/base/matrix-event';

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

// A request id minted for a write whose content this tab sent — a card saved
// from an open instance — as opposed to a source edit or a bot's patch, whose
// resulting state this tab does not already hold.
function isInstanceWriteRequestId(clientRequestId: string): boolean {
  return (
    clientRequestId.startsWith('instance:') ||
    clientRequestId.startsWith('editor-with-instance')
  );
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

// Which of a store service's search concurrency lanes a throttled search takes:
// the card `@context` surface's, or query-field resolution's.
export type SearchThrottleLane = 'card' | 'query-field';

// What an index event said the state of a card would be, carried alongside the
// reload it scheduled so a second delivery of that event can recognize it as
// already answered. Both members are optional because both are optional on the
// event, and an absent one is no information rather than a claim.
type ReloadTarget = { generation?: number; version?: string };
type DependencyTrackingOptions = {
  dependencyTrackingContext?: RuntimeDependencyTrackingContext;
};
// Opt-in per-field hydration timing, threaded straight through to
// `card-api.createFromSerialized`. The prerender's render route supplies the
// collector so a visit can attribute its `buildModelMs.hydrate` stage across
// the card's fields; every other caller omits it and pays nothing.
type HydrateTimingOptions = {
  hydrateFieldsMs?: Record<string, number>;
};
type TrackedCreateOptions = CreateOptions &
  DependencyTrackingOptions &
  HydrateTimingOptions;
type TrackedAddOptions = AddOptions &
  DependencyTrackingOptions &
  HydrateTimingOptions;

// How many times a search the realm-server shed (a 429 from its search
// admission gate) is retried before the shed surfaces as an error. Three
// retries at the server's one-second Retry-After span a burst that clears
// within a few seconds, and give up on a server that stays saturated.
const MAX_SHED_SEARCH_RETRIES = 3;
const MAX_SHED_RETRY_AFTER_SECONDS = 5;

// The wait a shed response asks for, in ms, with jitter so the clients a burst
// shed together don't all come back together. A missing or unparseable header
// (the HTTP-date form, say) counts as one second.
function shedRetryDelayMs(retryAfter: string | null): number {
  let seconds = Number(retryAfter);
  if (!Number.isFinite(seconds) || seconds < 0) {
    seconds = 1;
  }
  seconds = Math.min(seconds, MAX_SHED_RETRY_AFTER_SECONDS);
  return seconds * 1000 + Math.random() * 250;
}

export default class StoreService extends Service implements StoreInterface {
  @service declare private realm: RealmService;
  @service declare private loaderService: LoaderService;
  @service declare private messageService: MessageService;
  @service declare private cardService: CardService;
  @service declare private toolService: ToolService;
  @service declare private hostModeService: HostModeService;
  @service declare private network: NetworkService;
  @service declare private environmentService: EnvironmentService;
  @service declare private session: SessionService;
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private realmServer: RealmServerService;
  private subscriptions: Map<string, { unsubscribe: () => void }> = new Map();
  private cardInvalidationSubscribers: Map<string, Set<() => void>> = new Map();
  private cardReloadSubscribers: Set<(instance: CardDef) => void> = new Set();
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
  // The cards whose own create is on the wire — a save creating the card, or a
  // batch minting cards this store holds — keyed by local id. Distinct from
  // `inflightCardMutations`: an entry here exists only between the write being
  // sent and its response being applied, so whoever waits on one is waiting on
  // a request, never on a lock. See `#serializeForSave`.
  private inflightCardCreates: Map<string, Promise<void>> = new Map();
  private inflightCardLoads: Map<string, Deferred<void>> = new Map();
  // The index state a reload now in flight will bring a card to, keyed by the
  // instance's local id — the one id that survives the realm assigning a
  // remote one, which the invalidation loop itself can do.
  //
  // The rules in `#indexStateAlreadyHeld` read the instance, and an instance
  // does not reflect a reload until that reload returns. Two deliveries of one
  // event inside that window would both compare against the pre-reload
  // instance, so both would reload — and the second lands after the first,
  // over anything typed in between. That is the loss this filter exists to
  // prevent, so the question the rules ask is "does the store hold this state,
  // or has it already gone to fetch it".
  //
  // Not a memory of events seen: an entry describes one reload and is released
  // when that reload settles, whatever it settles into. A reload that fails
  // leaves nothing behind, so the next event retries.
  #reloadTargets: Map<string, ReloadTarget> = new Map();
  // The fields of an instance the user has edited that the realm has not yet
  // acknowledged, each stamped with the `#localEditSeq` of its latest edit.
  // A reload merges server state into the instance around these fields, so an
  // edit in progress survives server state arriving underneath it — whoever
  // wrote that state, and however the event naming it was attributed. The
  // local edit is newer than anything the realm holds for that field, and the
  // pending autosave is what will tell the realm about it.
  //
  // An entry clears when a save that began after the edit succeeds; a failed
  // save leaves it, so the edit keeps winning until one lands.
  #localEdits: WeakMap<CardDef, Map<string, number>> = new WeakMap();
  #localEditSeq = 0;
  // The top-level fields an optimistic operation has changed on the live
  // instance while its chain is still pending, keyed by the instance's local
  // id. A reload never keeps these as local edits: the value holds the
  // operation's effect, which the realm has not confirmed, and the ledger
  // re-applies every unsent operation onto whatever the reload leaves — so
  // keeping it would apply the operation twice. While an operation is pending
  // on a field, the operation owns it. Released when the card's chain drains.
  #optimisticFields: Map<string, Set<string>> = new Map();
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
    this.session.register(this);
    this.ready = this.setup();
    registerDestructor(this, () => {
      clearInterval(this.gcInterval);
    });
  }

  protected renderContextBlocksPersistence() {
    // In the dedicated prerender app (marked by the render route), block ALL
    // persistence on EVERY store: a write from the prerender deadlocks the
    // from-scratch index (the render holds the sole worker while the write
    // takes the realm write lock and awaits a reindex that needs that worker),
    // and the deadlocking writes come from the regular StoreService — not the
    // render store — so an `isRenderStore` term cannot catch them.
    //
    // Everywhere else (notably host tests, which run in-browser index renders
    // alongside an interactive app whose saves must keep working), only the
    // render store during an active render is blocked. Gating the interactive
    // store on __boxelRenderContext alone breaks it: card-prerender sets that
    // global around every test-realm index render, silently dropping app saves
    // that coincide with one.
    //
    // The command-runner route is the one place in the prerender app that
    // drops `__boxelPrerenderApp`, because a command is expected to write and
    // its writes index deferred rather than waiting on the worker the tab is
    // holding.
    if ((globalThis as any).__boxelPrerenderApp) {
      return true;
    }
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
    this.cardReloadSubscribers = new Set();
    this.onSaveSubscriber = undefined;
    this.referenceCount = new Map();
    this.newReferencePromises = [];
    this.autoSaveStates = new TrackedMap();
    this.inflightGetCards = new Map();
    this.inflightGetFileMeta = new Map();
    this.inflightCardMutations = new Map();
    this.inflightCardCreates = new Map();
    this.inflightCardLoads = new Map();
    this.#reloadTargets = new Map();
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

  // Bind the store to the indexing job now in progress. The render route calls
  // this before it hydrates a card, which is the only point early enough to
  // matter: a render whose link targets are all resident never loads anything,
  // so the store would otherwise never see that the job had moved on.
  //
  // The service keeps in-flight maps of its own, outside the card store, and
  // they hand a caller a promise without re-reading the realm. A `getCard` or
  // a `loadModel` issued under the previous scope and still pending across the
  // boundary would answer a caller in the new scope with an instance built
  // from a document read before the write — exactly what dropping residency
  // exists to prevent, arriving by a different route. Dropping the entries
  // stops the adoption: the pending work still settles, and the new scope
  // issues its own read. Only on an actual crossing, so that two visits
  // within one job keep their dedup.
  //
  // What the drop does not stop is the settling read's own `setCard`, which
  // plants its pre-boundary instance into the new scope's residency — it
  // removes the map entry, not the write that lands after it. Reaching that
  // needs a read still in flight when the next visit builds its model, which
  // is what `#waitForRenderLoadStability` stands between; it is the residual
  // this design leaves, not something the drop closes.
  observeIndexingJob(): void {
    if (!this.store.observeIndexingJob()) {
      return;
    }
    this.inflightGetCards = new Map();
    this.inflightGetFileMeta = new Map();
    this.inflightCardLoads = new Map();
    this.#reloadTargets = new Map();
    this.inflightSearch = new Map();
    // `inflightCardMutations` and `inflightCardCreates` are deliberately kept:
    // a render context blocks persistence, so there is nothing of this job's
    // in them, and dropping a save that somehow were in flight would lose the
    // only handle on it.
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
    this.inflightCardCreates = new Map();
    this.inflightCardLoads = new Map();
    this.#reloadTargets = new Map();
    this.inflightSearch = new Map();
    this.searchCache = new Map();
    this.searchCacheJobId = undefined;
    this.searchCacheGeneration++;
    this.autoSaveQueues = new Map();
    this.autoSavePromises = new Map();
    this.store = this.createCardStore();
  }

  refreshReferencesForCodeChange(
    reason?: string,
    opts?: { triggerModule?: string; realm?: string },
  ) {
    let reasonSuffix = reason ? ` (${reason})` : '';
    storeLogger.debug(`resetting store for code change${reasonSuffix}`);
    let telemetry = this.#clientTelemetry();
    let start = telemetry?.isEnabled ? performance.now() : undefined;
    this.store.reset();
    let refetch = this.reestablishReferences.perform();
    if (telemetry?.isEnabled && start !== undefined) {
      let triggerModules = opts?.triggerModule ? [opts.triggerModule] : [];
      // A code-mode save re-establishes the graph without waiting for the
      // realm's index event, so this pass is otherwise invisible on the
      // dashboard — a session editing a module in a realm the store holds no
      // instances from does all of its rebuilding here.
      let report = (cardsReloaded: number) =>
        telemetry.recordEvent({
          event_type: 'rebuild',
          rebuild_source: 'write',
          realm: opts?.realm ?? null,
          duration_ms: Math.round(performance.now() - start),
          trigger_modules: triggerModules,
          trigger_module: triggerModules[0] ?? '',
          modules_refetched: 0,
          cards_reloaded: cardsReloaded,
          coalesced_events: 0,
        });
      refetch.then(
        (cardsReloaded) => report(cardsReloaded ?? 0),
        (e) => {
          // A cancelled re-establishment (the owner tearing down mid-flight)
          // is not a rebuild worth reporting — but a genuine failure is a
          // rebuild the tab paid for, and the one most worth seeing. Reporting
          // it must not also swallow it: reading a task instance's promise
          // marks its errors handled, which mutes ember-concurrency's
          // uncaught-error reporting, so the rethrow restores the surface as
          // an unhandled rejection.
          if (didCancel(e)) {
            return;
          }
          report(0);
          throw e;
        },
      );
    }
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
  recentCardDocLoads(): Array<{
    url: string;
    ms: number;
    outcome?: 'ok' | 'error';
    generation?: number;
  }> {
    return (
      (
        this.store as unknown as {
          recentCardDocLoads?: () => Array<{
            url: string;
            ms: number;
            outcome?: 'ok' | 'error';
            generation?: number;
          }>;
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
    let adoptsFrom = doc.data.meta?.adoptsFrom;
    let waiterLabel = `create ${
      adoptsFrom ? humanReadable(adoptsFrom) : '<unknown type>'
    } in ${opts?.realm ?? '<default realm>'}`;
    return await this.withTestWaiters(waiterLabel, async () => {
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
        opts?.hydrateFieldsMs,
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

    // A headless command running while the prerender app's persistence block
    // is still raised is an impossible state, and the only one this path
    // reports rather than absorbs. The command route drops the block on entry
    // precisely so a command's writes can land; with the block still up the
    // save resolves to an instance carrying no id, `SaveCardTool` returns it
    // as saved, and every caller downstream — `boxel run-command` included —
    // reads a card that does not exist as a success. `create` already throws
    // on the same state.
    //
    // A card render is deliberately NOT an error. The prerenderer is not an
    // avenue for mutations, and a card whose template or computed writes to
    // the store is doing what it was designed to do — it just cannot have
    // that write here, because it would aim at a realm whose sole indexing
    // worker this render is occupying. Dropping the write renders the card;
    // throwing would fail the render and index the card as an error.
    if (
      !opts?.doNotPersist &&
      (globalThis as any).__boxelPrerenderApp &&
      (globalThis as any).__boxelHeadlessCommand
    ) {
      throw new Error(
        `cannot persist instance ${
          instance.id ?? instance[localIdSymbol]
        }: a headless command is running with the prerender app's persistence block still raised`,
      );
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
        skipIndexWait: opts?.skipIndexWait,
      });
    } else if (!opts?.doNotPersist) {
      // An existing card in a realm the user cannot write to is left alone:
      // `useEphemeralState` is the store's only write-permission check and it
      // guards `doAutoSave`, which this path no longer goes through, while
      // `persistAndUpdate` has no guard of its own. Returning the instance
      // keeps the mutation in memory and the durable document untouched, which
      // is what the autosave path did.
      //
      // Scoped to cards that already exist, mirroring what this branch used to
      // do: a card with no id yet was always persisted directly, and generally
      // has no realm to check against anyway.
      if (instance.id && this.useEphemeralState(instance)) {
        return instance;
      }
      // Await durable persistence for both new and existing cards. Existing
      // cards used to queue a fire-and-forget autosave here, which let `add()`
      // (and callers like SaveCardCommand) resolve before serialization and
      // the realm PATCH completed, allowing a "saved" result to be reported
      // while the durable resource still held the pre-mutation state and any
      // late persistence error never reached the caller. Callers that want
      // optimistic behavior must opt in explicitly with `doNotWaitForPersist`.
      //
      // Wrapped in `trackingSaveState` so the save indicator reflects this save
      // too. Bypassing the autosave queue would otherwise leave `lastSaved` and
      // `lastSaveError` reporting only whatever the queue last did.
      let stateKey = instance.id ?? instance[localIdSymbol];
      return (await this.trackingSaveState(instance, stateKey, () =>
        this.persistAndUpdate(instance, {
          realm: opts?.realm,
          localDir: opts?.localDir,
          skipIndexWait: opts?.skipIndexWait,
        }),
      )) as T | CardErrorJSONAPI;
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
      isQueryTaintedField: api.isQueryTaintedField,
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

  // `opts.type` is host-only: the card-facing `Store` interface declares
  // `delete(id)` alone, so card code reaches the card route and nothing else.
  async delete(id: string, opts?: { type?: StoreReadType }): Promise<void> {
    id = asURL(id, this.network.virtualNetwork);
    if (!id) {
      // the card isn't actually saved yet, so do nothing
      return;
    }
    if (opts?.type === 'file-meta') {
      // A file is deleted through its source route: the card+json DELETE
      // only knows how to remove card instances.
      this.store.delete(id);
      await this.cardService.deleteSource(new URL(id));
      this.notifyCardInvalidationSubscribers(id);
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
    opts?: {
      includeMeta?: false;
      dependencyTrackingContext?: RuntimeDependencyTrackingContext;
      cardInitiated?: boolean;
      throttled?: boolean;
      isObsolete?: () => boolean;
      scope?: SearchEntryScope;
    },
  ): Promise<T[]>;
  async search<T extends CardDef | FileDef = CardDef>(
    query: Query,
    realms: string[] | undefined,
    opts: {
      includeMeta: true;
      dependencyTrackingContext?: RuntimeDependencyTrackingContext;
      cardInitiated?: boolean;
      throttled?: boolean;
      isObsolete?: () => boolean;
      scope?: SearchEntryScope;
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
      // Run under the query-field concurrency lane without the other card caps,
      // for a caller whose result set must not be reshaped but whose volume
      // still has to be bounded — query-field resolution, which fires a search
      // per query field per deserialized card. Ignored with `cardInitiated`,
      // which takes the card lane instead.
      throttled?: boolean;
      // Asked once, when a queued search reaches the front of the throttle.
      // Waiting is where a consumer can go away — the resource that wanted this
      // result restarts on a new query, or is torn down — and a search that
      // answers nobody should hand its slot to the live ones behind it rather
      // than spend it on a fetch and a hydration. Only the queued path consults
      // it; an unthrottled search never waits long enough for the answer to
      // change.
      isObsolete?: () => boolean;
      // Pin which index rows the search returns: 'cards' (instance rows),
      // 'files' (FileDef rows), or 'all' (both). When omitted, the scope is
      // inferred from the filter — an untyped query defaults to 'cards'. Prefer
      // passing this explicitly over shaping the filter to coax a scope.
      // Note: 'all' returns a card's instance row *and* its dual-indexed
      // `.json` file row, so an untyped `scope: 'all'` search yields each card
      // twice unless the caller dedups (e.g. `excludeCardInstanceFileRows()`).
      scope?: SearchEntryScope;
    },
  ): Promise<T[] | { instances: T[]; meta: QueryResultsMeta }> {
    if ('asData' in query && query.asData) {
      throw new Error(
        `store.search returns instances only — use store.searchEntries for the raw entry wire format`,
      );
    }
    // Host callers resolve an absent/empty realm list to every realm the user
    // can see. Card `@context` callers arrive with the current realm already
    // resolved into `realms` (see cardFacingStore / SearchResource); an empty
    // list there means the card's current realm is unknown, so search nothing
    // rather than fan out to every realm.
    let searchRealms = opts?.cardInitiated
      ? this.normalizeRealmPaths(realms)
      : this.normalizeSearchRealms(realms);
    if (searchRealms.length === 0) {
      return opts?.includeMeta
        ? { instances: [], meta: { page: { total: 0 } } }
        : [];
    }
    if (opts?.cardInitiated) {
      // Enforce the card-facing caps on the resolved request: the realms cap on
      // the (already current-realm-resolved) list, and the page cap on the
      // query. These throw a SearchBoundError the caller surfaces as a search
      // error.
      assertRealmsBound(searchRealms);
      query = applySearchPageBound(query);
    }
    let run = () =>
      this.fetchAndHydrateSearchResults<T>(
        query,
        searchRealms,
        opts?.dependencyTrackingContext,
        opts?.scope,
      );
    let lane: SearchThrottleLane | undefined = opts?.cardInitiated
      ? 'card'
      : opts?.throttled
        ? 'query-field'
        : undefined;
    let result = lane
      ? await this.performThrottledSearch(async () => {
          if (opts?.isObsolete?.()) {
            return { instances: [] as T[], meta: { page: { total: 0 } } };
          }
          return await run();
        }, lane)
      : await run();
    return opts?.includeMeta ? result : result.instances;
  }

  // The raw wire format: heterogeneous `entry` resources with the
  // `html` / `item` branches the query's `fields[entry]` selects.
  // Nothing is hydrated into the store.
  async searchEntries(
    query: SearchEntryWireQuery,
    realms?: string[],
    opts?: {
      // Set by the card-facing `searchResultsComponent` surface, mirroring
      // `store.search`: an empty realm list means the card's current realm is
      // unknown, so search nothing rather than fanning out to every realm.
      // Host callers leave it unset and keep the all-realms fallback.
      cardInitiated?: boolean;
    },
  ): Promise<SearchEntryResults> {
    let searchRealms = opts?.cardInitiated
      ? this.normalizeRealmPaths(realms)
      : this.normalizeSearchRealms(realms);
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

  // Canonicalize a realm list to RealmPaths URLs, dropping unparseable entries.
  // No fallback: an empty input yields an empty list (the card path relies on
  // this to mean "search nothing" rather than "search everything").
  private normalizeRealmPaths(realms: string[] | undefined): string[] {
    return (realms ?? [])
      .map((realm) => new RealmPaths(ri(realm)).url)
      .filter(Boolean);
  }

  // The host default: an absent/empty realm list means every realm the user can
  // see.
  private normalizeSearchRealms(realms: string[] | undefined): string[] {
    let normalizedRealms = this.normalizeRealmPaths(realms);
    return normalizedRealms.length > 0
      ? normalizedRealms
      : this.realmServer.availableRealmIdentifiers;
  }

  // This store service's ceilings on concurrent item-leg searches, one lane per
  // caller. The tasks are class fields, so each store service carries its own
  // pair — the interactive app's and a render store's are separate ceilings,
  // not one shared tab-wide number. Within one lane the ceiling bounds the
  // store and not a single card: every search routed into it competes for the
  // same slots. The host app's own direct `store.search` / `getSearch` calls
  // take neither lane, so the trusted host is never throttled.
  //
  // `enqueue` + `maxConcurrency` queues excess searches rather than dropping
  // them, so nothing a card asked for goes unanswered — a burst becomes a
  // queue. The request count is unchanged; what is bounded is how many of them
  // are in flight, which is what a connection, a round trip, and the
  // realm-server's per-request heap all scale with. The server's per-request
  // bounds (page / realms / time) are the un-overridable backstop; this keeps
  // well-behaved cards from tripping them in the first place.
  //
  // The card lane serves the card `@context` surface (`getCards` and the
  // card-facing store, via `cardInitiated`).
  private cardSearchThrottle = task(
    { maxConcurrency: SEARCH_CONCURRENCY_CAP, enqueue: true },
    async (run: () => Promise<unknown>): Promise<unknown> => {
      return await run();
    },
  );

  // The query-field lane serves query-field resolution (via `throttled`), which
  // fires a search per query field per deserialized card — the larger fan-out
  // of the two, and one that feeds itself, since each result it hydrates
  // resolves its own query fields in turn. `enqueue` is a single FIFO with no
  // priority, and a slot is held across the hydration as well as the fetch, so
  // on a shared lane a search a card asks for after a page starts loading
  // would wait out that whole drain. Its own lane keeps the fan-out from
  // holding the slots the card lane needs.
  private queryFieldSearchThrottle = task(
    { maxConcurrency: QUERY_FIELD_SEARCH_CONCURRENCY_CAP, enqueue: true },
    async (run: () => Promise<unknown>): Promise<unknown> => {
      return await run();
    },
  );

  // Run `run` in `lane` under that lane's concurrency ceiling (`enqueue` +
  // maxConcurrency), so no more than its cap hit the realm-server at once and
  // the rest queue. Called from `search` when `cardInitiated` or `throttled`.
  // Typed as a plain Promise since the caller only awaits the result. Public so
  // a test can exercise the throttle with controllable work.
  performThrottledSearch<R>(
    run: () => Promise<R>,
    lane: SearchThrottleLane,
  ): Promise<R> {
    let throttle =
      lane === 'card' ? this.cardSearchThrottle : this.queryFieldSearchThrottle;
    return throttle.perform(run) as unknown as Promise<R>;
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
          return (
            query: Query,
            realmURLs?: string[],
            opts?: { scope?: SearchEntryScope },
          ) => {
            let current = getCurrentRealm();
            let realms = realmURLs ?? (current ? [current] : ([] as string[]));
            return target.search(query, realms, {
              cardInitiated: true,
              scope: opts?.scope,
            });
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
    scope?: SearchEntryScope,
  ): Promise<{ instances: T[]; meta: QueryResultsMeta }> {
    let collectionDoc = await this.fetchSearchDoc(query, realms, scope);

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
    scope?: SearchEntryScope,
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

    // Resolve to the scope that actually goes on the wire *before* keying, so
    // the cache and in-flight coalescer key on the request we send rather than
    // the caller's spelling of it. `{ type: ref }` and `{ type: ref, scope:
    // 'all' }` are a byte-identical `_federated-search` body — both resolve to
    // the undefined wire default — and so must share one key; keying on the raw
    // `scope` would split them and defeat the dedup.
    let wireScope = this.resolveWireScope(query, scope);

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
      cacheKey = searchCacheKey(jobId, consumingRealm, query, wireScope);
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
      ? searchInFlightKey(realms, query, wireScope)
      : undefined;
    let doc: SearchEntryResults;
    if (inflightKey !== undefined) {
      let existing = this.inflightSearch.get(inflightKey);
      if (existing) {
        doc = await existing;
      } else {
        let pending = this.fetchSearchDocUncoalesced(
          query,
          realms,
          wireScope,
        ).finally(() => {
          // Identity-check before deletion: a concurrent
          // `clearInFlightSearch()` could in principle have removed
          // (and a later caller re-set) this slot while we were
          // in-flight. Only clean up if the map still points at *this*
          // pending promise.
          if (this.inflightSearch.get(inflightKey) === pending) {
            this.inflightSearch.delete(inflightKey);
          }
        });
        this.inflightSearch.set(inflightKey, pending);
        doc = await pending;
      }
    } else {
      doc = await this.fetchSearchDocUncoalesced(query, realms, wireScope);
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

  // Resolve the caller's optional explicit scope + the query's filter shape to
  // the single scope that goes on the wire. A pure function of
  // `(query, explicitScope)`, so `fetchSearchDoc` can call it above the caching
  // layer and key on the result — see the note there.
  //
  // An explicit scope from the caller always wins — it is the sanctioned way to
  // ask for cards, files, or both, rather than shaping the filter to coax the
  // inference below.
  //
  // Search spans card instances and files. A query with a positive *concrete*
  // type ref already selects a kind (a card type -> instances, a FileDef type
  // -> files), so it passes through with the default 'all' scope and its filter
  // discriminates. An otherwise-unscoped query is pinned to 'cards' so the
  // common "search for cards" case doesn't surface a card's dual-indexed
  // `.json` file row (or plain files) — the choke point that replaces the
  // former per-call-site card anchor, while leaving file/typed searches (e.g.
  // SearchResource's file-meta queries) untouched.
  //
  // A BaseDef ref is *not* kind-selecting — it terminates both kinds' type
  // chains, so it matches every row — and is pinned to 'cards' like an untyped
  // query. Known gap: a mixed `any:` whose one branch is card-typed and another
  // untyped counts as positively typed, so its untyped branch can still match
  // file rows in 'all' scope; no caller composes that shape today.
  //
  // 'all' is the wire default (undefined scope), so an explicit 'all' maps to
  // undefined just like the inferred positive-type case — which is what lets
  // `{ type: ref }` and `{ type: ref, scope: 'all' }` share one cache key.
  private resolveWireScope(
    query: Query,
    explicitScope?: SearchEntryScope,
  ): SearchEntryScope | undefined {
    let typeRefs = query.filter
      ? getTypeRefsFromFilter(query.filter)
      : undefined;
    let hasPositiveType =
      typeRefs?.some((r) => !r.negated && !isEqual(r.ref, baseRef)) ?? false;
    return explicitScope !== undefined
      ? explicitScope === 'all'
        ? undefined
        : explicitScope
      : hasPositiveType
        ? undefined
        : 'cards';
  }

  private async fetchSearchDocUncoalesced(
    query: Query,
    realms: string[],
    // Already resolved to the wire scope by `fetchSearchDoc` (via
    // `resolveWireScope`) so the value keyed on and the value sent match.
    wireScope?: SearchEntryScope,
  ): Promise<SearchEntryResults> {
    return await this.fetchSearchEntryDoc(
      searchEntryWireQueryFromQuery(query, {
        fields: ['item'],
        ...(wireScope ? { scope: wireScope } : {}),
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
    let response: Response;
    for (let attempt = 0; ; attempt++) {
      response = await this.realmServer.maybeAuthedFetchForRealms(
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
      // A 429 is the realm-server shedding load: it is running its maximum
      // number of concurrent searches and turned this one away before doing
      // any work on it. The condition is transient by construction (slots free
      // as searches finish), so wait the interval it names and try again,
      // rather than surfacing a burst as a broken query field. Bounded so a
      // server that stays saturated still fails, just later.
      if (response.status !== 429 || attempt >= MAX_SHED_SEARCH_RETRIES) {
        break;
      }
      await timeout(shedRetryDelayMs(response.headers.get('Retry-After')));
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
      // support, the render-store hook), which are not subject to the caps.
      cardInitiated?: boolean;
      // Set by query-field resolution: take a slot in this store's query-field
      // search lane, leaving the rest of the card caps off. See
      // `queryFieldSearchThrottle`. Forced off for a render store, which must
      // not wait on a queue mid-render.
      throttled?: boolean;
      getDefaultRealm?: () => string | undefined;
      seed?: {
        cards: T[];
        // Declared on this hop too, for the reason `totalUnknown` is below:
        // the identity is what stops a seed being re-applied over a set a
        // search has since re-derived, and a field-by-field forward that
        // dropped it would restore that re-application silently.
        identity?: string;
        // What orders a handed-over set against one the resource already
        // holds: the generation, and the realm whose counter it belongs to.
        generation?: number;
        realm?: string;
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
        // Declared here as well as on the card-facing type, because this hop
        // is where the seed is handed to the resource. The flag exists to stop
        // a match count being inferred from the rows; leaving it off the
        // signature would let a future refactor forward the seed field by
        // field and silently restore that inference.
        totalUnknown?: boolean;
      };
    },
  ): SearchResource<T> {
    if (this.isRenderStore && opts) {
      // A render store renders as a function of the document it was handed, and
      // both corrections exist because `__boxelRenderContext` — which is what
      // the query-field caller derives these from — is a window rather than a
      // property of this store: `withRenderContext` raises and drops it around
      // each render, so a resource built between two windows would read as
      // neither non-live nor unqueued. Queueing one is the case
      // `throttled: !inPrerender` means to exclude, since the render then waits
      // on a queue drained at the cap.
      opts.isLive = false;
      opts.throttled = false;
    }
    // `cardInitiated` + `getDefaultRealm` + `throttled` ride through `opts`:
    // the `@context` providers pass the first two (card-facing `getCards`),
    // query-field resolution passes the third, and a host-internal caller
    // passes none of them and stays unconstrained.
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
    let waiterLabel = `wireUpNewReference ${url}`;
    await this.withTestWaiters(waiterLabel, async () => {
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
    hydrateFieldsMs?: Record<string, number>,
  ): Promise<T> {
    let api = await this.cardService.getAPI();
    let shouldStubTimers =
      this.renderContextBlocksPersistence() && !isTesting();
    let performCreate = async () =>
      (await api.createFromSerialized(resource, doc, relativeTo, {
        store: this.store,
        dependencyTrackingContext,
        ...(hydrateFieldsMs ? { hydrateFieldsMs } : {}),
      })) as T;
    // Time the deserialize and report it (no-op when telemetry is disabled).
    let telemetry = this.#clientTelemetry();
    let deserializeStart = telemetry?.isEnabled ? performance.now() : undefined;
    let card = shouldStubTimers
      ? await withStubbedRenderTimers(performCreate)
      : await performCreate();
    if (telemetry?.isEnabled && deserializeStart !== undefined) {
      telemetry.recordDeserialize({
        durationMs: performance.now() - deserializeStart,
        doc,
        resource,
      });
    }
    return card;
  }

  // Defensive lookup of the telemetry service — never forces the hooked path
  // to depend on telemetry being present or healthy.
  #clientTelemetry(): ClientTelemetryService | undefined {
    // Never instantiate the instrument inside a prerender tab: it self-gates
    // from arming, but the lookup would still construct it on the hot render
    // path. Mirrors the guard in the initializer and the timing middleware.
    if (
      (globalThis as { __boxelRenderContext?: unknown }).__boxelRenderContext
    ) {
      return undefined;
    }
    try {
      return getOwner(this)?.lookup('service:client-telemetry') as
        | ClientTelemetryService
        | undefined;
    } catch {
      return undefined;
    }
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
        resolvesQueryFieldsEagerly: () => this.resolvesQueryFieldsEagerly(),
        receivesIndexEventsFor: (id) => this.receivesIndexEventsFor(id),
        getSearchResource: (parent, getQuery, getRealms, opts) =>
          this.getSearchResource(parent, getQuery, getRealms, opts),
      },
    );
  }

  // A query-backed relationship resolves when its owner deserializes here, so a
  // card's membership — and every `computeVia` reducing over it — is current
  // without a template having to read the field first.
  //
  // Two stores are excluded, because both must render as a pure function of the
  // document they were handed: the render store, and every store inside the
  // dedicated prerender app (where the deserializing store is the regular one,
  // which an `isRenderStore` term alone would miss). `__boxelRenderContext` is
  // deliberately not part of the test — card-prerender sets it around index
  // renders that run alongside an interactive app, whose own query fields must
  // keep resolving through those windows.
  //
  // A command runs with `__boxelPrerenderApp` dropped, so its query fields do
  // resolve eagerly — matching what a command gets on a tab that has never
  // served a render.
  protected resolvesQueryFieldsEagerly(): boolean {
    if ((globalThis as any).__boxelPrerenderApp) {
      return false;
    }
    return !this.isRenderStore;
  }

  // Whether this store would hear that `id` was re-indexed — the signal
  // `handleInvalidations` turns into a reload of what it is holding. It hears
  // it only for the realms it subscribed to, and it subscribes per referenced
  // instance (`addReference`), so the realms whatever is on screen was read
  // from are covered while one reached only by following a link out of them is
  // not. Host mode subscribes to nothing, so nothing there qualifies. A local
  // id names an instance no realm has indexed, and a reference the realm
  // mappings can't place names one this store could not be told about either
  // way.
  protected receivesIndexEventsFor(id: string): boolean {
    // A render store is only ever asked this outside a render scope, where the
    // scoping that makes its residency trustworthy is not in force. It renders
    // as a pure function of the documents it was handed, so it claims nothing
    // there.
    if (this.isRenderStore) {
      return false;
    }
    if (isLocalId(id)) {
      return false;
    }
    // Folded to the same spelling `addReference` subscribed under, so a
    // reference arriving as one of an id's other aliases still finds the
    // subscription taken out for it.
    //
    // Deliberately this lookup and not `realmForId`: the question is not which
    // realm holds the id, it is whether this store subscribed to that realm,
    // and only the spelling `subscribeToRealm` resolved can answer it. A realm
    // whose registry key is an alias — the base realm, keyed by its virtual
    // url while ids fold to the serving one — resolves through neither, so it
    // is absent from `subscriptions` and answers false here. That is the
    // property being reported rather than a gap in it: naming such a realm by
    // a spelling this lookup does resolve would claim coverage that no
    // subscription backs, and the store would reuse instances nothing reloads.
    let realmURL = this.realm.realmOf(
      rri(asURL(id, this.network.virtualNetwork)),
    );
    return realmURL != null && this.subscriptions.has(realmURL);
  }

  private handleInvalidations = (event: RealmEventContent) => {
    if (event.eventName !== 'index') {
      return;
    }

    let telemetry = this.#clientTelemetry();
    let processingStart = telemetry?.isEnabled ? performance.now() : undefined;
    // The raw event, minus its invalidation list — that list is tracked
    // separately (bounded) as invalidated_ids, and can be large.
    let eventArgs = () => {
      let { invalidations: _invalidations, ...rest } = event as unknown as {
        invalidations?: unknown;
        [key: string]: unknown;
      };
      return rest;
    };

    if (event.indexType === 'full') {
      // A full reindex carries no per-file invalidation list, so there is
      // nothing to reload by name. A realm that reindexes on request does
      // broadcast the URLs it visited as an incremental event first, but one
      // reindexing at startup announces itself with this event alone — so this
      // can be the only word a card being held as awaiting-index ever gets
      // that the row it is waiting for now exists.
      let reloadsTriggered = this.reloadAwaitingIndexInstances(event.realmURL);
      // Report the pass as a thin realm-event so the dashboard still sees it.
      telemetry?.recordEvent({
        event_type: 'realm-event',
        realm: event.realmURL,
        index_type: 'full',
        invalidations_count: 0,
        invalidated_ids: [],
        reloads_triggered: reloadsTriggered,
        own_write: false,
        processing_ms: 0,
        event_args: eventArgs(),
      });
      return;
    }

    if (event.indexType !== 'incremental') {
      return;
    }
    let invalidations = event.invalidations as string[];
    let ownWrite = [
      event.clientRequestId,
      ...(event.coalescedWrites ?? []).map((write) => write.clientRequestId),
    ].some((id) => !!id && this.cardService.clientRequestIds.has(id));

    // The invalidation triggers a rebuild when it touches an already-loaded
    // executable module: the loader must be flushed so the updated code is
    // picked up before the open card graph re-runs. Net-new modules that were
    // never loaded don't need one. `isModuleLoaded` alone can't answer that,
    // because a loader the code change already flushed carries no loaded
    // modules and so reports every module as net-new. Two flushes beat this
    // event to the punch: a rebuild already in flight (fold every further
    // executable invalidation into it), and the flush a local write or an open
    // editor performed for this very module the moment it was rewritten.
    let executableInvalidations = invalidations.filter(hasExecutableExtension);
    let alreadyFlushed = new Set(
      executableInvalidations.filter((i) =>
        this.loaderService.wasModuleFlushedForCodeChange(i),
      ),
    );
    let needsRebuild =
      executableInvalidations.length > 0 &&
      (this.rebuildForCodeChange.isRunning ||
        alreadyFlushed.size > 0 ||
        executableInvalidations.some((i) =>
          this.loaderService.loader.isModuleLoaded(i),
        ));

    let reloadsTriggered = 0;
    if (needsRebuild) {
      // Coalesce the rebuild. `keepLatestTask` keeps at most one rebuild in
      // flight and one pending, so a burst of executable invalidations arriving
      // faster than a rebuild completes collapses into at most 2 rebuilds; the
      // final rebuild re-fetches current server state, so the end result
      // reflects the latest generation. This is scheduling only and does not
      // touch reactivity: an isolated change triggers a single reset and
      // re-render.
      if (telemetry?.isEnabled) {
        this.#accumulatePendingRebuild(
          event.realmURL,
          executableInvalidations,
          alreadyFlushed,
        );
      }
      this.rebuildForCodeChange.perform();
      // The rebuild subsumes the per-invalidation reloads below: store.reset
      // empties the graph and reestablishReferences re-fetches every live
      // reference, so running that loop too would only re-fetch cards the
      // rebuild is about to discard.
    } else {
      reloadsTriggered = this.#reloadInvalidatedInstances(event, invalidations);
    }

    if (telemetry?.isEnabled) {
      telemetry.recordEvent({
        event_type: 'realm-event',
        realm: event.realmURL,
        index_type: 'incremental',
        invalidations_count: invalidations.length,
        invalidated_ids: invalidations.slice(0, 50),
        reloads_triggered: reloadsTriggered,
        own_write: ownWrite,
        processing_ms:
          processingStart !== undefined
            ? Math.round(performance.now() - processingStart)
            : 0,
        event_args: eventArgs(),
      });
    }
  };

  // Whether a card named by a pass that indexed several publishes has to be
  // re-read. The pass is announced once for all of them, so the event's own
  // `clientRequestId` names just one writer; the rule the single-writer event
  // gets from it is asked of every writer that changed this card instead.
  //
  // Skipped only when every writer that changed the card is one of ours, of
  // the kind whose content we sent, and says it wrote this card verbatim —
  // which is when this tab holds what the card says, or something newer typed
  // while the write was in flight. A second writer changing the same card in
  // the same pass means the index holds whichever landed last, which this tab
  // cannot know it holds. A card no writer changed is a dependent, whose state
  // the realm computed.
  #sharedPassNeedsReload(
    writes: CoalescedIndexWrite[],
    invalidation: string,
  ): boolean {
    let changedBy = writes.filter(
      (write) => write.changed === null || write.changed.includes(invalidation),
    );
    if (changedBy.length === 0) {
      realmEventsLogger.debug(
        `reloading card ${invalidation} because no write in its shared pass changed it directly`,
      );
      return true;
    }
    let stranger = changedBy.find(
      ({ clientRequestId, changed, clientAuthored }) =>
        !clientRequestId ||
        !this.cardService.clientRequestIds.has(clientRequestId) ||
        !isInstanceWriteRequestId(clientRequestId) ||
        !(clientAuthored ?? changed ?? []).includes(invalidation),
    );
    if (stranger) {
      realmEventsLogger.debug(
        `reloading card ${invalidation} because request ${stranger.clientRequestId ?? 'with no id'} in its shared pass changed it and did not carry our content for it`,
      );
      return true;
    }
    realmEventsLogger.debug(
      `ignoring invalidation for card ${invalidation} because every write in its shared pass that changed it is ours and carried its content`,
    );
    return false;
  }

  // Reload the individual cards / file-meta resources named by an incremental
  // invalidation that did not trigger a full rebuild. Returns the number of
  // reloads kicked off (for realm-event telemetry).
  #reloadInvalidatedInstances(
    event: IncrementalIndexEventContent,
    invalidations: string[],
  ): number {
    let reloadsTriggered = 0;
    for (let invalidation of invalidations) {
      if (hasExecutableExtension(invalidation)) {
        // Executable modules have no card instance to reload here; when an
        // already-loaded one changed, the coalesced rebuild handled it.
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
        reloadsTriggered++;
      }
      let clientRequestId = event.clientRequestId ?? undefined;
      let clientAuthored = event.clientAuthored;

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

          if (event.coalescedWrites) {
            reloadFile = this.#sharedPassNeedsReload(
              event.coalescedWrites,
              invalidation,
            );
          } else if (!clientRequestId) {
            reloadFile = true;
            realmEventsLogger.debug(
              `reloading file resource ${invalidation} because event has no clientRequestId`,
            );
          } else if (this.cardService.clientRequestIds.has(clientRequestId)) {
            if (isInstanceWriteRequestId(clientRequestId)) {
              // Our own write, of the kind whose content we sent — so this
              // instance already holds what the card says, and may hold
              // something newer that was typed while the write was in flight.
              // Re-reading it is how that edit gets lost.
              //
              // One request can write several cards, though, and only some of
              // them carry what we sent: the rest took state the realm
              // computed, which we do not hold and which nothing else will
              // bring us. A writer that says which is which narrows the skip
              // to those cards; one that says nothing leaves the whole pass
              // skipped, which is what a single-card write means by it.
              if (clientAuthored && !clientAuthored.includes(invalidation)) {
                reloadFile = true;
                realmEventsLogger.debug(
                  `reloading card ${invalidation} because request id ${clientRequestId} is ours but did not carry this card's content`,
                );
              } else {
                realmEventsLogger.debug(
                  `ignoring invalidation for card ${invalidation} because request id ${clientRequestId} is ours and an instance type`,
                );
              }
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

          let alreadyHeld: string | undefined;
          if (reloadFile) {
            alreadyHeld = this.#indexStateAlreadyHeld(
              event,
              invalidation,
              instance,
            );
            if (alreadyHeld) {
              reloadFile = false;
            }
          }

          if (reloadFile) {
            // Record what this reload will bring before starting it, so a
            // duplicate arriving while it is in flight has something to
            // compare against. See `#reloadTargets`.
            let target: ReloadTarget | undefined;
            if (
              typeof event.generation === 'number' ||
              event.versions?.[invalidation] !== undefined
            ) {
              target = {
                generation: event.generation,
                version: event.versions?.[invalidation],
              };
              this.#reloadTargets.set(instance[localIdSymbol], target);
            }
            this.reloadTask.perform(instance, target);
            reloadsTriggered++;
          } else {
            // One line per skip, naming the rule that decided it.
            realmEventsLogger.debug(
              alreadyHeld
                ? `ignoring invalidation ${invalidation} because ${alreadyHeld}`
                : `ignoring invalidation ${invalidation} for request id ${clientRequestId}`,
            );
          }
        } else {
          realmEventsLogger.debug(
            `reloading file resource ${invalidation} because it is in an error state`,
          );
          this.loadInstanceTask.perform(invalidation);
          reloadsTriggered++;
        }
      } else if (this.hasInflightCardLoad(invalidation)) {
        // The invalidation landed while this id's first read was still in
        // flight, so there is nothing in the store to reload yet. That read
        // may well be the one that 404s — the index row this event announces
        // did not exist when it was issued — and its awaiting-index
        // placeholder would then be stale the moment it is installed, with no
        // further event coming for it. Reload once the read settles.
        // Deliberately not counted as a reload: whether one happens depends on
        // what the read settles into, and the counter is read synchronously
        // here for the realm-event telemetry.
        realmEventsLogger.debug(
          `deferring reload of ${invalidation} until its in-flight load settles`,
        );
        this.reloadAfterInflightLoad.perform(invalidation);
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
        reloadsTriggered++;
      }
    }

    return reloadsTriggered;
  }

  // Does this event describe a state of `invalidation` that the store already
  // holds, or has already gone to fetch? Returns why when it does, so the
  // decision says itself in the log, and `undefined` when it cannot tell —
  // which reloads, as it did before.
  //
  // Not reloading matters for more than the round trip it saves. A reload
  // overwrites the in-memory instance with server state, so each one is a
  // window in which an edit typed since the write is discarded. That is the
  // window own-request suppression above exists to close; these two rules
  // close cases it cannot reach.
  //
  // `generation` orders, and the two numbers it compares are not quite the
  // same number. The one in hand is the card's own row generation, stamped
  // onto the card+json GET; the one on the event is the generation of the pass
  // that broadcast it. They coincide for a card that pass rewrote, since a
  // pass stamps every row it writes with its own — and there an event at or
  // below the generation in hand describes a pass this card has already been
  // read past, which is what makes a duplicate delivery, and an event
  // overtaken by a newer one, a no-op without keeping any memory of the events
  // already seen.
  //
  // They come apart for a card invalidated by the earlier half of a mixed
  // batch. `performIndex` runs once per module/instance group, each its own
  // batch at its own generation, while `invalidations` accumulates across both
  // and the one broadcast carries the union stamped with the closing pass's
  // number — so a card the module flush invalidated keeps the flush's lower
  // generation, and every event naming it reads as newer. This rule then never
  // fires for it and it reloads as it did before. A missed skip and never a
  // wrong one, which is the direction to fail in, and back-to-back duplicates
  // are still bounded by the in-flight target below — but the comparison is
  // not exact, so nothing should be built on it as though it were.
  //
  // `version` says something narrower and in a different currency: the file
  // the realm holds for this card is the file this tab's own last write
  // produced. It is worth being exact about what that licenses, because a
  // card's *document* can move while its file stands still. A commit that
  // rewrites a card with the bytes it already held still reports a version for
  // it, and if that same commit changed something the card links to, the pass
  // re-indexes the card as a dependent and it arrives in `invalidations` as
  // well — so the two can intersect on a card nobody edited. Skipping is still
  // right there, because what a document adds to the file is computed values,
  // which this client recomputes from the live graph rather than trusting what
  // it was served, and a link closure whose members carry their own
  // invalidations and reload on those. Neither is state only the realm has.
  //
  // What the version is really for is answering after the request-id memory is
  // gone, which is why it sits beside the generation rule rather than
  // duplicating it. `clientRequestIds` is a `LimitedSet(250)`, so a tab that
  // has written that many times since has evicted the id its own echo carries,
  // and the echo then arrives indistinguishable from a stranger's —
  // unrecognized request id, higher generation — and reloads over whatever has
  // been typed since. A version is a property of the card rather than of a
  // request, so it outlives that.
  //
  // Each rule answers in one direction only. An absent generation on either
  // side, an absent `versions` map, an absent recorded version — all mean no
  // information, and no information reloads. Three degradations rest on that:
  // a realm too old to report a generation; a `versions` map dropped whole —
  // rather than truncated — because the event it rides in would not otherwise
  // fit, since a subscriber cannot tell a partial map from a complete one and
  // a missing key must never read as "this card was not written"; and the
  // broadcast a failed indexing pass sends, which names the URLs it was handed
  // and carries neither member, so nothing here can suppress the re-read that
  // finds whatever it swapped in.
  #indexStateAlreadyHeld(
    event: IncrementalIndexEventContent,
    invalidation: string,
    instance: CardDef,
  ): string | undefined {
    let held = instance[meta];
    // What a reload already in flight will bring, which is as good an answer
    // as holding it: the fetch is out, and a second one would only land on top
    // of it. See `#reloadTargets`.
    let incoming = this.#reloadTargets.get(instance[localIdSymbol]);
    let generation = Math.max(
      typeof held?.generation === 'number' ? held.generation : -Infinity,
      typeof incoming?.generation === 'number'
        ? incoming.generation
        : -Infinity,
    );
    if (
      typeof event.generation === 'number' &&
      Number.isFinite(generation) &&
      event.generation <= generation
    ) {
      return `the store is at index generation ${generation}, at or past this event's ${event.generation}`;
    }
    // Read by the spelling this loop is already holding. `versions` spells a
    // card the way `invalidations` does — the realm href with a trailing
    // `.json` removed — so the two join by construction. That is deliberately
    // not how a write response spells it: response ids are canonicalized to
    // registered-prefix form, which is also what `instance.id` and the
    // identity map carry, so a lookup by `instance.id` would miss on every
    // prefix-mapped realm and pass on the rest.
    let version = event.versions?.[invalidation];
    if (
      version !== undefined &&
      (version === held?.version || version === incoming?.version)
    ) {
      return `the store is at version ${version}`;
    }
    return undefined;
  }

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

  // Is a first read of `id` still in flight? `inflightGetCards` is keyed by the
  // normalized URL, which is the form an invalidation carries.
  private hasInflightCardLoad(id: string): boolean {
    let url = asURL(id, this.network.virtualNetwork);
    if (url && this.inflightGetCards.has(url)) {
      return true;
    }
    // A lazy link edge fetches through the card store rather than this read
    // map, so an id whose first read is a link resolution appears nowhere
    // above. Without this it reads as an id nothing ever tried to load, and
    // the invalidation is dropped — leaving the document that fetch is about
    // to return, read before the write this event announces, as what the store
    // keeps.
    return this.#cardDocLoadInFlight(id) !== undefined;
  }

  #cardDocLoadInFlight(id: string): Promise<unknown> | undefined {
    return (
      this.store as unknown as {
        cardDocLoadInFlight?: (url: string) => Promise<unknown> | undefined;
      }
    ).cardDocLoadInFlight?.(id);
  }

  // Wait out whichever read of `id` was in flight, then decide what the store
  // is left holding.
  //
  // An awaiting-index placeholder is the store's promise that the card will
  // appear on its own, and the event that would have kept the promise is the
  // one already being handled — it arrived too early to find anything to
  // reload.
  //
  // A settled link resolution leaves something stronger and staler: an
  // instance built from a document fetched before the write this event
  // announces, which every later edge to that target is then entitled to
  // reuse. No further event names that id, so this is the only occasion to
  // re-read it.
  private reloadAfterInflightLoad = task(async (id: string) => {
    let url = asURL(id, this.network.virtualNetwork);
    let inflight = url ? this.inflightGetCards.get(url) : undefined;
    if (inflight) {
      await inflight;
    }
    let docLoad = this.#cardDocLoadInFlight(id);
    if (docLoad) {
      // The deserialize that consumes this document is chained onto it, so
      // settle the microtask queue before reading what it produced.
      await docLoad.catch(() => {});
      await Promise.resolve();
    }
    if (this.peekError(id)?.awaitingIndex) {
      this.loadInstanceTask.perform(id);
      return;
    }
    // Only when the read actually produced something. A link resolution that
    // 404s plants its sentinel and leaves the store empty for this id, and
    // re-reading an id the store holds nothing for would fetch a row that is
    // still absent.
    if (docLoad && this.peek(id)) {
      storeLogger.debug(
        `reloading ${id} because its link resolution settled across an invalidation`,
      );
      this.loadInstanceTask.perform(id);
    }
  });

  // Re-read every card being held as awaiting-index in `realmURL`. Their whole
  // state is "a row for me is coming", and a from-scratch pass is one way it
  // arrives without any event naming the card.
  private reloadAwaitingIndexInstances(realmURL: string): number {
    let reloaded = 0;
    for (let [id, error] of this.store.cardErrorEntries()) {
      if (!error.awaitingIndex) {
        continue;
      }
      if (this.realm.realmOf(rri(id)) !== realmURL) {
        continue;
      }
      realmEventsLogger.debug(
        `reloading ${id} because a full index of ${realmURL} may have landed the row it is waiting for`,
      );
      this.loadInstanceTask.perform(id);
      reloaded++;
    }
    // A read still in flight has recorded nothing for the sweep above to find,
    // and the placeholder it is about to install would be stale the moment it
    // lands — this pass is the very thing it would then be waiting for, and
    // no later event is coming to say so. Same treatment the incremental
    // branch gives an invalidation that names a card mid-read.
    for (let id of this.inflightGetCards.keys()) {
      if (this.realm.realmOf(rri(id)) !== realmURL) {
        continue;
      }
      realmEventsLogger.debug(
        `deferring reload of ${id} until its in-flight load settles, because a full index of ${realmURL} landed while it was reading`,
      );
      this.reloadAfterInflightLoad.perform(id);
    }
    return reloaded;
  }

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
    return remoteIds.size;
  });

  // Telemetry metadata for the pending/in-flight coalesced rebuild, merged
  // across every executable invalidation that collapses into it. Drained when
  // the rebuild task begins so the emitted `rebuild` event describes exactly
  // the code changes that rebuild picked up. Only populated when telemetry is
  // enabled; the coalescing itself does not depend on it.
  #pendingRebuild:
    | {
        realm: string;
        triggerModules: Set<string>;
        modulesRefetched: Set<string>;
        events: number;
      }
    | undefined = undefined;

  #accumulatePendingRebuild(
    realm: string,
    executableInvalidations: string[],
    alreadyFlushed: Set<string>,
  ) {
    let pending = (this.#pendingRebuild ??= {
      realm,
      triggerModules: new Set<string>(),
      modulesRefetched: new Set<string>(),
      events: 0,
    });
    // The most recent event's realm labels the rebuild; a burst is
    // overwhelmingly single-realm, and the final generation wins regardless.
    pending.realm = realm;
    pending.events++;
    for (let module of executableInvalidations) {
      pending.triggerModules.add(module);
      // A module the code change already flushed was loaded and the rebuild
      // will re-fetch it, even though the flushed loader no longer reports it.
      if (
        alreadyFlushed.has(module) ||
        this.loaderService.loader.isModuleLoaded(module)
      ) {
        pending.modulesRefetched.add(module);
      }
    }
  }

  // Coalesced client rebuild: flush the loader, reset the store, and re-fetch
  // every live card reference. `keepLatest` bounds a write burst to one
  // in-flight rebuild plus one pending — intermediate events collapse into the
  // pending slot — so a burst of rapid executable invalidations costs at most 2
  // rebuilds regardless of its length. The final rebuild re-fetches current
  // server state, so the end state reflects the latest generation. This is
  // scheduling only: each rebuild is the full load-bearing reset, not a partial
  // one.
  private rebuildForCodeChange = keepLatestTask(async () => {
    let telemetry = this.#clientTelemetry();
    let pending = this.#pendingRebuild;
    this.#pendingRebuild = undefined;
    let rebuildStart =
      telemetry?.isEnabled && pending ? performance.now() : undefined;

    // When this reset actually replaces the loader — it is debounce-eligible,
    // so it may not — it also drops the flush records that armed this rebuild:
    // a plain replacement supersedes them. Records that outlive a debounced
    // reset cost at most one extra rebuild later, whose own reset drops them.
    // A code-change flush landing *during* the re-fetch below writes fresh
    // records against the new loader, so the invalidation still to come for
    // that write finds them.
    this.loaderService.resetLoader();
    this.store.reset();
    let cardsReloaded: number | undefined;
    try {
      cardsReloaded = await this.reestablishReferences.perform();
    } finally {
      // A rebuild that failed partway is still a rebuild the tab paid for, and
      // the one most worth seeing on the dashboard.
      if (telemetry?.isEnabled && pending && rebuildStart !== undefined) {
        let triggerModules = [...pending.triggerModules].slice(0, 20);
        telemetry.recordEvent({
          event_type: 'rebuild',
          rebuild_source: 'realm-event',
          realm: pending.realm,
          duration_ms: Math.round(performance.now() - rebuildStart),
          trigger_modules: triggerModules,
          trigger_module: triggerModules[0] ?? '',
          modules_refetched: pending.modulesRefetched.size,
          cards_reloaded: cardsReloaded ?? 0,
          coalesced_events: pending.events,
        });
      }
    }
  });

  private reloadTask = task(
    async (instance: CardDef, reloadTarget?: ReloadTarget) => {
      let reloadTracker = this.startTrackingCardLoad(instance.id);
      let maybeReloadedInstance: CardDef | CardErrorJSONAPI | undefined;
      let isDelete = false;

      try {
        try {
          maybeReloadedInstance = await this.reloadInstance(instance);
        } catch (err: any) {
          let cardError = processCardError(instance.id, err).errors[0];
          if (cardError?.awaitingIndex) {
            // The realm holds this card's source and has not indexed it yet.
            // That is a statement about the index, not about the instance this
            // tab is already running — so keep it exactly as it is, autosave and
            // all, and let the index event that follows bring the fresh state.
            // Treating it as a deletion would evict a card that still exists;
            // recording it as an error would stand a placeholder in front of one
            // the user is working in.
            maybeReloadedInstance = instance;
          } else if (err.status === 404) {
            // in this case the document was invalidated in the index because the
            // file was deleted
            isDelete = true;
          } else {
            maybeReloadedInstance = cardError;
          }
        }
        // Detach the original instance's autosave subscription when it's been
        // superseded: either the reload errored, or the card's type changed and
        // reloadInstance built a fresh instance of the new type and swapped it
        // into the identity map. When the reload updated the same object in
        // place (the common case), keep its subscription.
        if (
          !isCardInstance(maybeReloadedInstance) ||
          maybeReloadedInstance !== instance
        ) {
          await this.stopAutoSaving(instance);
        }
        if (maybeReloadedInstance) {
          this.setIdentityContext(maybeReloadedInstance);
          await this.startAutoSaving(maybeReloadedInstance);
        }
        if (!isDelete && maybeReloadedInstance === instance) {
          // The same object, refreshed in place: whatever a reader computed on
          // top of its previous state is gone, and only this case leaves that
          // reader still holding the card it computed against.
          this.notifyCardReloadSubscribers(instance);
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
        // Released only if it is still this reload's: a newer event may have
        // scheduled its own while this one was in flight, and that one is what
        // the rules should go on reading.
        let localId = instance[localIdSymbol];
        if (reloadTarget && this.#reloadTargets.get(localId) === reloadTarget) {
          this.#reloadTargets.delete(localId);
        }
        this.finishTrackingCardLoad(instance.id, reloadTracker);
      }
    },
  );

  private reloadFileMetaTask = task(async (url: string) => {
    let waiterLabel = `reloadFileMeta ${url}`;
    await this.withTestWaiters(waiterLabel, async () => {
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
      this.#recordLocalEdit(instance, fieldName);
      let autoSaveState = this.initOrGetAutoSaveState(instance);
      autoSaveState.hasUnsavedChanges = true;
      this.doAutoSave(instance);
    }
  };

  // A nested path (`address.street`, `items.2`) records its top-level field:
  // that is the unit a card document carries, and so the unit a merge can
  // keep or take.
  #recordLocalEdit(instance: CardDef, fieldName: string) {
    let edits = this.#localEdits.get(instance);
    if (!edits) {
      edits = new Map();
      this.#localEdits.set(instance, edits);
    }
    edits.set(fieldName.split('.')[0], ++this.#localEditSeq);
  }

  // Clears the edits a successful save carried: those made before it
  // serialized the instance, i.e. stamped at or below `sentSeq`.
  #acknowledgeLocalEdits(instance: CardDef, sentSeq: number) {
    let edits = this.#localEdits.get(instance);
    if (!edits) {
      return;
    }
    for (let [fieldName, seq] of edits) {
      if (seq <= sentSeq) {
        edits.delete(fieldName);
      }
    }
  }

  // The fields a reload keeps as the user has them: those with an edit the
  // realm has not acknowledged, less any an optimistic operation still owns.
  #pinnedFields(instance: CardDef): Set<string> {
    let pinned = new Set(this.#localEdits.get(instance)?.keys() ?? []);
    for (let field of this.#optimisticFields.get(instance[localIdSymbol]) ??
      []) {
      pinned.delete(field);
    }
    return pinned;
  }

  // Which top-level fields an operation's local run changed, compared against
  // the source it ran over. A relationship key names its field before any
  // `.<n>` member suffix.
  #recordOptimisticFields(
    instance: CardDef,
    basis: LooseCardResource,
    result: LooseCardResource,
  ) {
    let changed = new Set<string>();
    for (let member of ['attributes', 'relationships'] as const) {
      let before = (basis[member] ?? {}) as Record<string, unknown>;
      let after = (result[member] ?? {}) as Record<string, unknown>;
      for (let key of new Set([
        ...Object.keys(before),
        ...Object.keys(after),
      ])) {
        if (!isEqual(before[key], after[key])) {
          changed.add(key.split('.')[0]);
        }
      }
    }
    if (changed.size === 0) {
      return;
    }
    let localId = instance[localIdSymbol];
    let fields = this.#optimisticFields.get(localId);
    if (!fields) {
      fields = new Set();
      this.#optimisticFields.set(localId, fields);
    }
    for (let field of changed) {
      fields.add(field);
    }
  }

  // The card's operation chain has drained: no optimistic effect on it is
  // unconfirmed any more, so its fields are the user's to keep again.
  releaseOptimisticFields(localId: string) {
    this.#optimisticFields.delete(localId);
  }

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
    // An awaiting-index error says the realm has not caught up with a card it
    // holds. It is never a statement about a card this tab is already running:
    // a newly created instance is live in the store under its local id, and
    // editable there, long before the realm has indexed it. Recording the error
    // would make `peekError` report it, and every render site reads that to
    // decide whether to stand a placeholder in front of the card — so a card
    // the user is working in would be replaced by one. `getCard` correlates a
    // remote URL back to a locally-created instance, so this holds from the
    // moment the server assigns an id.
    if (
      !instance &&
      (instanceOrError as CardErrorJSONAPI).awaitingIndex &&
      this.store.getCard(instanceOrError.id!)
    ) {
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
      // A card this tab is already running outranks the realm's report that it
      // has not indexed it yet — see `setIdentityContext`. A cache-bypassing
      // read is the one that gets here with an instance already in hand.
      let running =
        cardError?.awaitingIndex && id ? this.store.getCard(id) : undefined;
      if (running) {
        deferred?.fulfill(running as T);
        return running as T;
      }
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
      // Only retract this call's own entry: a scope boundary clears the map
      // mid-flight, so a newer caller's entry can be sitting under this id.
      if (
        id &&
        deferred &&
        this.inflightGetCards.get(id) === deferred.promise
      ) {
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
      let errorResponse = processCardError(id, error, 'file-meta');
      let cardError = errorResponse.errors[0];
      deferred.fulfill(cardError);
      console.error(
        `error getting file-meta instance ${JSON.stringify(idOrDoc, null, 2)}: ${JSON.stringify(error, null, 2)}`,
        error,
      );
      return cardError;
    } finally {
      // Guarded for the same reason as the card read above.
      if (this.inflightGetFileMeta.get(id) === deferred.promise) {
        this.inflightGetFileMeta.delete(id);
      }
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
    // The render/index store renders read-only and must never persist. A save
    // here would deadlock the from-scratch index: the render holds the sole
    // worker while the write takes the realm write lock and awaits a reindex
    // that needs that worker. (Canonicalizing card.id to RRI can make a
    // freshly-deserialized instance look dirty — a field resolved against the
    // RRI base differs from its on-disk URL form — which is what surfaces this
    // otherwise-latent write on the index path.)
    if (this.isRenderStore) {
      return;
    }
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
    let waiterLabel = `drainAutoSaveQueue ${queueName}`;
    return await this.withTestWaiters(waiterLabel, async () => {
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
        // favor isImmediate saves
        let isImmediate = Boolean(autoSaves.find((a) => a.isImmediate));
        try {
          await this.trackingSaveState(instance, queueName, () =>
            this.saveInstance(
              instance,
              isImmediate ? { isImmediate } : undefined,
            ),
          );
        } catch {
          // Swallowed on purpose: an autosave is not something a caller awaited,
          // so a throw here has nowhere to go but an unhandled rejection. The
          // error is already logged in CardService and recorded on the save
          // state for the indicator to surface. `add()` awaits its own save and
          // therefore lets the throw propagate.
        }
      }
      done!();
    });
  }

  // Runs a save and folds its outcome into the instance's `AutoSaveState` —
  // the state `getSaveState` exposes and the save indicator renders. Shared by
  // the autosave queue and by `add()`'s awaited persist, so a save reports
  // itself the same way regardless of which path issued it; before this was
  // factored out, only the queue updated the indicator.
  //
  // `isSaving` is expected to already be true: the queue sets it when work is
  // enqueued, which is earlier than this runs.
  private async trackingSaveState(
    instance: CardDef,
    stateKey: string,
    save: () => Promise<CardDef | CardErrorJSONAPI | undefined | void>,
  ) {
    let autoSaveState = this.initOrGetAutoSaveState(instance);
    try {
      let maybeError = await save();
      autoSaveState.hasUnsavedChanges = false;
      autoSaveState.lastSaved = Date.now();
      autoSaveState.lastSavedErrorMsg = undefined;
      autoSaveState.lastSaveError =
        maybeError && !isCardInstance(maybeError) ? maybeError : undefined;
      return maybeError;
    } catch (error) {
      // error will already be logged in CardService
      autoSaveState.lastSaveError = error as Error;
      throw error;
    } finally {
      autoSaveState.isSaving = false;
      this.calculateLastSavedMsg(autoSaveState);
      // A card saved under its local id gains a remote id during the save, so
      // republish the same state object under that id — otherwise a later
      // lookup by remote id would mint a fresh, empty state.
      if (isLocalId(stateKey) && instance.id) {
        this.autoSaveStates.set(instance.id, autoSaveState);
      }
    }
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
        // Marks a write issued by a headless command, which makes the realm
        // index it deferred and answer from the document it serialized rather
        // than from the index. The command's tab holds a prerender render slot
        // until it returns, and the index read the realm would otherwise do
        // awaits a job needing that slot. See DURING_PRERENDER_HEADER.
        ...headlessCommandWriteHeaders(),
        // Caller opted out of blocking this save on the realm's in-flight
        // incremental indexing (see SKIP_INDEX_WAIT_HEADER). Same deferred-
        // index + serialized-echo response the header above asks for, but
        // driven by an explicit per-save option rather than the prerender
        // context. Defaults to waiting when unset.
        ...(opts?.skipIndexWait === true
          ? { [SKIP_INDEX_WAIT_HEADER]: '1' }
          : {}),
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
    let waiterLabel = `persistAndUpdate ${instance.id ?? instance[localIdSymbol]}`;
    return await this.withTestWaiters(waiterLabel, async () => {
      // Sampled before the mutation lock is taken, so a save that queues behind
      // an in-flight create of the same instance counts as a create as well: it
      // PATCHes the card the create named, then re-runs the identity assignment
      // against that same id.
      let isNew = !instance.id;
      return await this.withCardMutationLock(
        instance[localIdSymbol],
        async () => {
          let endCreate: (() => void) | undefined;
          try {
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
            let doc: LooseSingleCardDocument;
            let sentSeq: number;
            ({ doc, sentSeq, endCreate } =
              await this.#serializeForSave(instance));
            let json = await this.saveCardDocument(doc, {
              realm: realmURL.href,
              localDir: opts?.localDir,
              clientRequestId: opts?.clientRequestId,
              skipIndexWait: opts?.skipIndexWait,
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
              await this.assignRemoteIdentity(instance, json.data.id!);
            }
            this.#recordWrittenVersion(instance, json);
            this.#acknowledgeLocalEdits(instance, sentSeq);
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
            endCreate?.();
          }
        },
      );
    });
  }

  // A save sends, as cards to create, the linked cards that have no id yet.
  // Having no id is also what a card looks like while its own create is on the
  // wire: the realm may already hold its file, and only the response carrying
  // the id has yet to arrive. Sending such a card again asks the realm to
  // create a card it already stores, which it refuses, failing the whole save.
  //
  // So the save waits for each of those creates to answer and serializes
  // again, by which time the card holds its id and goes out as a plain link.
  // What it waits on is a request, not a lock: an entry in
  // `inflightCardCreates` exists only once its create has done all of its own
  // waiting, so two new cards linking to each other cannot end up waiting on
  // one another. A create that fails still settles its entry, leaving the card
  // without an id — and a card with no id and no create on the wire is one to
  // create alongside this save, as any unsaved link is.
  //
  // The check and, for a create, the registration of this save's own entry
  // happen in one synchronous step with nothing awaited between them and the
  // send. A create that registers in between would otherwise be missed by a
  // save that checked before it, and both would go out.
  //
  // Covers a card's own create — this path, and a batch minting cards it was
  // handed — and not a linked card created as a side-load of another write.
  // That card takes its id from the realm's index event rather than from the
  // write's response, so there is no response here that would hand it one.
  //
  // `sentSeq` is the edit sequence sampled before the serialization that is
  // returned: every edit stamped up to it is in that document.
  async #serializeForSave(instance: CardDef): Promise<{
    doc: LooseSingleCardDocument;
    sentSeq: number;
    endCreate?: () => void;
  }> {
    for (;;) {
      let sentSeq = this.#localEditSeq;
      let doc = await this.cardService.serializeCard(instance, {
        // for a brand new card that has no id yet, we don't know what we are
        // relativeTo because its up to the realm server to assign us an ID, so
        // URL's should be absolute
        useAbsoluteURL: true,
        withLocalResourcesIncluded: true,
        omitQueryFields: true,
      });
      let pendingCreates = (doc.included ?? []).flatMap((resource) => {
        let pending =
          !resource.id && 'lid' in resource && resource.lid
            ? this.inflightCardCreates.get(resource.lid)
            : undefined;
        return pending ? [pending] : [];
      });
      if (pendingCreates.length === 0) {
        return {
          doc,
          sentSeq,
          ...(doc.data.id
            ? {}
            : { endCreate: this.beginCreates([instance[localIdSymbol]]) }),
        };
      }
      await Promise.all(pendingCreates);
    }
  }

  // Marks the cards named by these local ids as having a create on the wire,
  // for a save linking to one of them to wait on; the returned function ends
  // that, and must be called once the write's response has been applied or
  // has failed. Called only once the write has done all of its own waiting
  // and is about to be sent — see `#serializeForSave`.
  beginCreates(localIds: readonly string[]): () => void {
    let sent = new Deferred<void>();
    for (let localId of localIds) {
      this.inflightCardCreates.set(localId, sent.promise);
    }
    return () => {
      for (let localId of localIds) {
        if (this.inflightCardCreates.get(localId) === sent.promise) {
          this.inflightCardCreates.delete(localId);
        }
      }
      sent.fulfill();
    };
  }

  // Serializes mutations of one instance, keyed by its local id, so a save
  // issued while a create of the same instance is still in flight waits for
  // the realm-assigned id and issues a PATCH rather than a second POST.
  //
  // The map entry is overwritten rather than chained: callers that arrive
  // while a mutation is in flight all await that same promise and are then
  // released together, so each mutation is serialized against the one in
  // flight when it arrived, not against its queued peers. Entries are never
  // deleted; a settled promise left in the map costs the next caller a
  // microtask and nothing else.
  private async withCardMutationLock<T>(
    localId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    let inflightMutation = this.inflightCardMutations.get(localId);
    if (inflightMutation) {
      await inflightMutation;
    }
    let deferred = new Deferred<void>();
    this.inflightCardMutations.set(localId, deferred.promise);
    try {
      return await fn();
    } finally {
      deferred.fulfill();
    }
  }

  // Runs a batch write under the same per-instance lock a save takes, for every
  // card the caller is already holding that the batch is about to mint. An
  // autosave of one of those cards that starts while the batch is in flight
  // waits for it and then PATCHes the card the batch named, rather than posting
  // a second one.
  //
  // Nested rather than acquired as a set: each lock is a queue for one local id
  // and the batch is the only thing that holds more than one, so there is no
  // second holder to deadlock against — and folding keeps this the same
  // primitive a save takes rather than a second kind of lock.
  //
  // Each id is taken once. A caller naming the same card twice would otherwise
  // have the inner acquisition wait on the deferred the outer one is still
  // holding, and a batch that names one card twice is a batch that deadlocks
  // before the realm ever gets to refuse it for saying the same card is two
  // cards.
  async withMutationLocks<T>(
    localIds: readonly string[],
    fn: () => Promise<T>,
  ): Promise<T> {
    let [first, ...rest] = [...new Set(localIds)];
    if (first === undefined) {
      return await fn();
    }
    return await this.withCardMutationLock(first, () =>
      this.withMutationLocks(rest, fn),
    );
  }

  // Fires whenever this store re-reads a card from its realm and keeps the
  // same instance — which is what a foreign write looks like from outside the
  // store.
  //
  // Distinct from `subscribeToCardInvalidation`, which fires only when a card
  // is deleted. A reader holding something computed on top of the card's
  // previous state — the optimistic ledger's unsent entries — needs to know
  // that state is gone, and a deletion notice never tells it.
  //
  // Not fired for a reload that replaced the instance (the card's type
  // changed) or that resolved to an error: in neither case is there a card
  // whose earlier state a subscriber could still be reasoning about.
  onCardReloaded(cb: (instance: CardDef) => void): () => void {
    this.cardReloadSubscribers.add(cb);
    return () => {
      this.cardReloadSubscribers.delete(cb);
    };
  }

  private notifyCardReloadSubscribers(instance: CardDef) {
    // Snapshotted so a subscriber unsubscribing from its own callback does not
    // mutate the set being walked, and isolated so one subscriber's throw does
    // not cost the others their notice.
    for (let subscriber of [...this.cardReloadSubscribers]) {
      try {
        subscriber(instance);
      } catch (err) {
        console.error(`card reload subscriber threw for ${instance.id}`, err);
      }
    }
  }

  // The version this session believes the card's stored bytes carry, and the
  // recording of a new one.
  //
  // The same channel `#recordWrittenVersion` uses for a card+json write, and
  // for the same reason: a version reaches an instance from a response that
  // carries one and from nowhere else, since nothing here can compute a hash
  // of bytes it did not write. Exposed so an operation's write result feeds
  // the reload-suppression rules the way a save's does — an operation that
  // wrote a card without recording its version leaves its own echo looking
  // like a stranger's.
  operationVersionOf(instance: CardDef): string | undefined {
    return instance[meta]?.version;
  }

  recordOperationVersion(instance: CardDef, version: string) {
    this.#recordWrittenVersion(instance, {
      data: { meta: { version } },
    } as SingleCardDocument);
  }

  // Put a source document an operation produced onto a held instance.
  //
  // `updateFromSerialized` writes the instance's data bucket directly and
  // announces nothing to change subscribers, so this does not mark the card
  // dirty or schedule a save — the same reason a reload does not. That is the
  // point: the write is already on its way to the realm as an operation, and
  // an autosave racing it would send the card a second time.
  //
  // The realm-managed members of `meta` are carried across by hand. A
  // serialization built from an instance rebuilds `meta` from scratch —
  // `adoptsFrom`, the realm, the per-field metadata — and the deserializer
  // assigns what it is handed wholesale, so applying one would otherwise drop
  // the `version` and `generation` this store holds. Those are exactly what
  // the next operation names as its base and what the index event rules read
  // to decide whether to re-read the card, so losing them here would turn
  // every optimistic write after the first into an unconfirmable one.
  async applyOperationSource(
    instance: CardDef,
    resource: LooseCardResource,
    basis: LooseCardResource,
  ): Promise<void> {
    let api = await this.cardService.getAPI();
    let held = instance[meta];
    this.#recordOptimisticFields(instance, basis, resource);
    await api.updateFromSerialized(
      instance,
      { data: resource } as LooseSingleCardDocument,
      this.store,
    );
    // The served metadata underneath, the serialization's on top. A
    // serialization rebuilds `meta` from scratch and produces only what it can
    // derive from the instance — `adoptsFrom`, the realm, and the per-field
    // metadata, which the mutation legitimately moves. Everything else the card
    // was served with (`realmInfo`, `lastModified`, `resourceCreatedAt`,
    // `screenshots`, and the `version` / `generation` the next operation and
    // the store's own event rules read) is absent from it, so assigning it
    // wholesale would drop realm branding and modification times until
    // something re-read the card.
    instance[meta] = {
      ...held,
      ...instance[meta],
    } as CardResourceMeta;
  }

  // Re-read a card from its realm, discarding whatever this tab holds for it
  // apart from fields the user has edited that the realm has not yet
  // acknowledged and no pending operation has changed. An optimistic
  // application is always discarded: a field an operation changed is never
  // kept, even when the user also typed into it (see `#optimisticFields`).
  //
  // The rollback an optimistic operation takes when the realm reports it ran
  // from a different base. Routed through the same task an index event's
  // reload takes, so a rollback and an invalidation leave the store in the
  // same place — the autosave re-subscription and the identity bookkeeping
  // included.
  async reloadForRollback(instance: CardDef): Promise<void> {
    await this.reloadTask.perform(instance);
  }

  // Pairs every card a committed batch minted with the instance this store was
  // already holding for it, and promotes that instance the way a save does.
  //
  // A pair naming a card the store never held is skipped rather than refused: a
  // batch mints cards from plain data as readily as from an instance, and one
  // nothing here is holding has no identity to assign. What is refused is a
  // pairing that contradicts one the store already made — the identity map
  // throws on it, and doing so from inside an event handler would surface it
  // far from the batch that caused it, so it is caught here where the caller is
  // still waiting.
  async adoptMintedIdentities(
    minted: readonly { lid: string; id: string }[],
  ): Promise<void> {
    // Every pairing is judged before any is made, so which cards get promoted
    // does not depend on where in the list a conflict happened to sit.
    let conflicts: { lid: string; id: string; held: CardDef }[] = [];
    let pairs: { lid: string; id: string }[] = [];
    for (let { lid, id } of minted) {
      let held = this.store.getCard(rri(id));
      if (held && held[localIdSymbol] !== lid) {
        conflicts.push({ lid, id, held });
      } else {
        pairs.push({ lid, id });
      }
    }

    // The batch committed, so every card it wrote exists and every pairing the
    // store can honor is one the realm already agrees with. Promoting them is
    // not a partial success to be undone — it is the rest of the batch, and
    // withholding it would leave those instances unaddressable over a quarrel
    // about a different card.
    for (let { lid, id } of pairs) {
      let instance = this.store.getCard(lid);
      if (!instance || instance.id) {
        continue;
      }
      await this.assignRemoteIdentity(instance, rri(id));
    }

    if (conflicts.length === 0) {
      return;
    }

    // A conflicting card is the one case where the realm's own event cannot
    // put things right on its own. The write names that card as carrying this
    // client's content — which it does, for the local id the batch sent — so
    // the event is read as one to skip, while the instance this store actually
    // holds for that URL belongs to a different local id and is now stale with
    // nothing coming to refresh it. Re-reading it here is what closes that.
    for (let { held } of conflicts) {
      // Only one that has a URL of its own can be re-read. An instance filed
      // under a remote id without holding one has nothing to fetch, and its
      // being in that state is the disagreement being reported rather than
      // something a read would settle.
      if (held.id) {
        this.reloadTask.perform(held);
      }
    }
    let [{ id, lid, held }] = conflicts;
    throw new Error(
      `the batch committed, but its card ${id} cannot be paired with local id ${lid}: this store already holds that card under local id ${held[localIdSymbol]}. The realm has the write, the batch's other cards are paired, and this tab's copy of that card is being re-read.`,
    );
  }

  // Promotes an instance the realm has just named from local-id-only to fully
  // addressable. The steps are ordered and every one of them is required, so
  // any code path that learns a new instance's remote id routes through here
  // rather than repeating them:
  //
  //   1. the instance takes the remote id;
  //   2. the store subscribes to its realm's index events;
  //   3. a stack showing the instance switches the URL bar to the remote id;
  //   4. consumers in *other* realms re-save so their links to this instance
  //      resolve to the remote id instead of the local one;
  //   5. the identity map indexes the instance under both ids, so lookups by
  //      either return this same object;
  //   6. autosave takes over subsequent edits.
  //
  // Runs while the create that named the instance still holds its entry in
  // `inflightCardCreates`, and a save of a card linking to this one may be
  // waiting on that entry while holding its own mutation lock. So nothing here
  // may wait on another card's save: `updateForeignConsumersOf` starts the
  // consumers' saves without awaiting them for exactly that reason.
  private async assignRemoteIdentity(
    instance: CardDef,
    remoteId: RealmResourceIdentifier,
  ) {
    let api = await this.cardService.getAPI();
    api.setId(instance, remoteId);
    this.subscribeToRealm(rri(instance.id));
    this.operatorModeStateService.handleCardIdAssignment(
      instance[localIdSymbol],
    );
    await this.updateForeignConsumersOf(instance);
    this.setIdentityContext(instance);
    await this.startAutoSaving(instance);
  }

  // Keep the version a card+json write reported — the fingerprint of the bytes
  // the realm stored. A card+json read reports one too, and
  // `_updateFromSerialized` assigns a served `meta` onto the instance wholesale,
  // so a read lands one without passing through here; this records the write's,
  // which no read is guaranteed to follow. `#indexStateAlreadyHeld` reads
  // whichever is held.
  //
  // Recorded rather than left to the server-state merge above, which runs only
  // when the identity or the realm info moved and so skips the ordinary save.
  // A response carrying no version (a realm old enough not to report one)
  // clears whatever was held instead of leaving it: a version that no longer
  // describes the bytes the realm holds would suppress a reload that is needed.
  #recordWrittenVersion(instance: CardDef, json: SingleCardDocument) {
    let held = instance[meta];
    let version = json.data.meta?.version;
    if (version === held?.version) {
      return;
    }
    instance[meta] = { ...held, version } as CardResourceMeta;
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
        // Not awaited: the consumer's save may be waiting on this card's
        // create, which is still in flight — see `assignRemoteIdentity`.
        this.save(consumer.id);
      }
    }
  }

  // Returns the refreshed instance. Usually this is the same object as the
  // one passed in (updated in place), but when the card's type changed it is a
  // freshly-built instance of the new type — see below.
  private async reloadInstance(instance: CardDef): Promise<CardDef> {
    // we don't await this in the realm subscription callback, so this test
    // waiter should catch otherwise leaky async in the tests
    let waiterLabel = `reloadInstance ${instance.id}`;
    return await this.withTestWaiters(waiterLabel, async () => {
      let api = await this.cardService.getAPI();
      // Fields pinned when the read goes out stay pinned for this reload even
      // if a save acknowledges them while it is in flight: the realm may have
      // answered the read before that save wrote.
      let pinnedAtRead = this.#pinnedFields(instance);
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

      // Scenario: a saved card instance changes its type — its JSON
      // `meta.adoptsFrom` is edited to point at a different card definition
      // (e.g. a realm index card re-pointed from CardsGrid to a custom index
      // card). A card instance's JavaScript class is fixed at construction, so
      // applying the new JSON to the existing object with `updateFromSerialized`
      // would leave the old class in place and keep rendering the old type.
      // Resolve the incoming type and, when it is not exactly the instance's
      // class, rebuild from the new type. The comparison is exact (not a
      // subtype check) so that re-pointing from a subclass to one of its
      // ancestors also rebuilds instead of keeping the subclass instance.
      let newDef: typeof BaseDef;
      try {
        newDef = await loadCardDef(incomingDoc.data.meta.adoptsFrom, {
          loader: this.loaderService.loader,
          // `instance.id` is canonical RRI for a mapped realm, which `new URL`
          // cannot parse; `toURL` resolves an RRI to its real URL and passes a
          // URL-form id through unchanged.
          relativeTo: this.network.virtualNetwork.toURL(instance.id),
        });
      } catch (err: any) {
        // `loadCardDef` throws a 404 CardError when the resolved module lacks
        // the export. That's a "this client can't resolve the new type" error
        // state for the card, not a deletion — `reloadTask` reserves a 404 for
        // a genuinely removed instance (the 404 that `fetchJSON` throws above).
        // Keep the error's detail but drop the 404 so it surfaces as an error
        // state rather than a phantom delete.
        if (isCardError(err) && err.status === 404) {
          err.status = 422;
        }
        throw err;
      }

      let currentDef = Reflect.getPrototypeOf(instance)?.constructor as
        | typeof BaseDef
        | undefined;
      if (currentDef !== newDef) {
        // Rebuild as the new type, reusing the existing local id so the
        // identity map — and everything keyed by it, references included —
        // keeps resolving this card to the rebuilt instance (the id-resolver
        // also rejects a second local id for an already-known remote id).
        // Construct directly rather than via `createFromSerialized`, whose
        // cached-instance reuse would keep the old object when the new type is
        // one of its ancestors; `updateFromSerialized` then deserializes into
        // the new instance and swaps it into the identity map.
        let rebuilt = new (newDef as typeof CardDef)({
          id: instance.id,
          [localIdSymbol]: instance[localIdSymbol],
        });
        await api.updateFromSerialized<typeof CardDef>(
          rebuilt,
          incomingDoc,
          this.store,
        );
        return rebuilt;
      }

      // Asked again as each field is written rather than once here, so a
      // field the user starts editing while the read or the deserialization is
      // still running is kept too.
      let kept = new Set<string>();
      await api.updateFromSerialized<typeof CardDef>(
        instance,
        incomingDoc,
        this.store,
        undefined,
        (fieldName) => {
          let keep =
            this.#pinnedFields(instance).has(fieldName) ||
            (pinnedAtRead.has(fieldName) &&
              !this.#optimisticFields
                .get(instance[localIdSymbol])
                ?.has(fieldName));
          if (keep) {
            kept.add(fieldName);
          }
          return keep;
        },
      );
      if (kept.size > 0) {
        realmEventsLogger.debug(
          `reload of ${instance.id} keeps local edits to ${[...kept].join(', ')}`,
        );
        // The instance now holds the user's edits over the realm's state, and
        // a save already on the wire was serialized before that state arrived,
        // so it carries the old values of the fields this reload just took.
        // One more save, queued behind it, writes the merged card.
        this.doAutoSave(instance);
      }
      return instance;
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

  // `label` names the individual store operation the token stands for. Every
  // store operation opens its token on the one `store-service` waiter from
  // this one call site, so without a label a `settled()` that never resolves
  // reports only that some store work is outstanding — with a stack that is
  // this method for all of them.
  private async withTestWaiters<T>(label: string, cb: () => Promise<T>) {
    let token = waiter.beginAsync(undefined, label);
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

// `readType` names what the failed read asked the realm for. A realm serves
// card instances and file metadata out of one URL namespace, so the URL alone
// cannot say which of the two a 404 is about — only the caller knows, and the
// not-found wording below is written from it.
function processCardError(
  url: string | undefined,
  error: any,
  readType: StoreReadType = 'card',
): CardErrorsJSONAPI {
  let httpStatus = typeof error?.status === 'number' ? error.status : undefined;
  let errorResponse: CardErrorsJSONAPI;
  let body = errorResponseBody(error);
  if (body) {
    errorResponse = formattedError(url, error, body.errors?.[0]);
  } else {
    switch (error.status) {
      // tailor HTTP responses as necessary for better user feedback
      case 404:
        errorResponse = formattedError(
          url,
          error,
          notFoundError(url, readType),
        );
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

// The raw response body of a failed read, when one survived to here. Only a
// failure thrown straight from a fetch wrapper carries `responseText`: a realm
// error response is rebuilt into a `CardError` from the JSON:API document it
// carried, which keeps the status and message but not the body text. The
// bodiless and the unparseable case both come back `undefined`, which is what
// routes a read to the status-tailored fallback in `processCardError`.
function errorResponseBody(error: any): { errors?: any[] } | undefined {
  if (typeof error?.responseText !== 'string') {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(error.responseText);
  } catch {
    return undefined;
  }
  return parsed != null && typeof parsed === 'object'
    ? (parsed as { errors?: any[] })
    : undefined;
}

function notFoundError(
  url: string | undefined,
  readType: StoreReadType,
): Partial<CardErrorJSONAPI> {
  let { title, noun } =
    readType === 'file-meta'
      ? { title: 'File Not Found', noun: 'file' }
      : { title: 'Card Not Found', noun: 'card' };
  return {
    status: 404,
    title,
    message: `The ${noun} ${url} does not exist`,
  };
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
  let id =
    typeof urlOrDoc === 'string' ? urlOrDoc.replace(/\.json$/, '') : undefined;
  if (id === undefined) {
    id = (urlOrDoc as LooseSingleCardDocument).data.id;
    if (id == null) {
      return undefined;
    }
  }
  // The store keys every instance by the single canonical form that folds ALL
  // spellings — RRI `card.id`, a link's virtual/url-mapped alias, and the real
  // URL — onto one key (`toRealURLHref`), so a lookup by any of them lands on
  // the same entry. `unresolveURL` cannot serve as the key: it leaves a
  // virtual/url-mapped alias unchanged, so that spelling would split from the
  // RRI and orphan an inflight-load deferred. gc-card-store and render-service
  // key the same way. Locals stay as-is.
  return isLocalId(id) ? id : vn.keyForIdentifier(id);
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
  let path = new RealmPaths(ri(realm));
  if (local) {
    return path.directoryRRI(local);
  }
  return path.url;
}

declare module '@ember/service' {
  interface Registry {
    store: StoreService;
  }
}
