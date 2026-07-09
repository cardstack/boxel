import { destroy } from '@ember/destroyable';

import { TrackedMap } from 'tracked-built-ins';

import {
  isPrimitive,
  isCardInstance,
  isFileDefInstance,
  isBaseInstance,
  isLocalId,
  localId as localIdSymbol,
  loadCardDocument,
  loadFileMetaDocument,
  trackRuntimeFileDependency,
  trackRuntimeInstanceDependency,
  logger,
  type Query,
  type QueryResultsMeta,
  type RuntimeDependencyTrackingContext,
  type ErrorEntry,
  type CardErrorJSONAPI,
  type CardError,
  type SingleCardDocument,
  type SingleFileMetaDocument,
  type VirtualNetwork,
} from '@cardstack/runtime-common';

import type {
  BaseDef,
  CardDef,
  CardStore,
  GetSearchResourceFuncOpts,
  QueryLoadInfo,
  QueryLoadMeta,
  StoreSearchResource,
} from '@cardstack/base/card-api';
import type * as CardAPI from '@cardstack/base/card-api';
import type { FileDef } from '@cardstack/base/file-api';

export type ReferenceCount = Map<string, number>;

const loadTrackingLogger = logger('store-load-tracking');

type LocalId = string;
type InstanceGraph = Map<LocalId, Set<LocalId>>;
type StoredInstance = CardDef | FileDef;

type StoreHooks = {
  getSearchResource<T extends CardDef | FileDef = CardDef>(
    parent: object,
    getQuery: () => Query | undefined,
    getRealms?: () => string[] | undefined,
    opts?: {
      isLive?: boolean;
      doWhileRefreshing?: (() => void) | undefined;
      dependencyTracking?: RuntimeDependencyTrackingContext;
      seed?:
        | {
            cards: T[];
            searchURL?: string;
            realms?: string[];
            meta?: QueryResultsMeta;
            errors?: ErrorEntry[];
            queryErrors?: Array<{
              realm: string;
              type: string;
              message: string;
              status?: number;
            }>;
          }
        | undefined;
    },
  ): StoreSearchResource<T>;
};

// we use this 2 way mapping between local ID and remote ID because if we end up
// trying to search thru all the entries in a single direction Map to find the
// opposing id, it will trigger a glimmer invalidation on all the cards in the
// identity map
class IDResolver {
  #remoteIds = new Map<string, string[]>(); // localId => remoteId[]
  #oldRemoteIds = new Map<string, string[]>(); // localId => remoteId[]
  #localIds = new Map<string, string>(); // remoteId => localId

  addIdPair(localId: string, remoteId: string) {
    let existingLocalId = this.getLocalId(remoteId);
    if (existingLocalId && localId !== existingLocalId) {
      throw new Error(
        `the instance with [remote id: ${remoteId} local id: ${localId}] has conflicting instance id in store: [remote id: ${remoteId} local id: ${existingLocalId}]`,
      );
    }
    let remoteIds = this.#remoteIds.get(localId);
    if (!remoteIds) {
      remoteIds = [];
      this.#remoteIds.set(localId, remoteIds);
    }
    remoteIds.push(remoteId);
    this.#localIds.set(remoteId, localId);
  }

  getRemoteIds(localId: string) {
    return (
      this.#remoteIds.get(localId) ?? this.#oldRemoteIds.get(localId) ?? []
    );
  }

  getLocalId(remoteId: string) {
    return this.#localIds.get(remoteId);
  }

  removeByRemoteId(remoteId: string) {
    let localId = this.getLocalId(remoteId);
    if (localId) {
      for (let id of this.getRemoteIds(localId)) {
        this.#localIds.delete(id);
      }
      this.#remoteIds.delete(localId);
    }
    this.#localIds.delete(remoteId);
  }

  findRemoteId(searchString: string) {
    return [...this.#localIds.keys()].find((remoteId) =>
      remoteId.includes(searchString),
    );
  }

  reset() {
    // we roll over the old local ID mappings so we can still ask about it after
    // a loader refresh, but we segregate these so that we don't try to reverse
    // lookup on the local ID's since they won't exist any more.
    for (let [localId, remoteIds] of this.#remoteIds) {
      this.#oldRemoteIds.set(localId, remoteIds);
    }
    this.#localIds = new Map();
    this.#remoteIds = new Map();
  }
}

export default class CardStoreWithGarbageCollection implements CardStore {
  // importantly these properties are not tracked so that we are able
  // to deserialize an instance without glimmer rendering the inner workings of
  // the deserialization process.
  #nonTrackedCardInstances = new Map<string, CardDef>();
  #nonTrackedCardInstanceErrors = new Map<string, CardErrorJSONAPI>();

  #cardInstances = new TrackedMap<string, CardDef>();
  #cardInstanceErrors = new TrackedMap<string, CardErrorJSONAPI>();
  #nonTrackedFileMetaInstances = new Map<string, FileDef>();
  #nonTrackedFileMetaInstanceErrors = new Map<string, CardErrorJSONAPI>();
  #fileMetaInstances = new TrackedMap<string, FileDef>();
  #fileMetaInstanceErrors = new TrackedMap<string, CardErrorJSONAPI>();
  #gcCandidates: Set<LocalId> = new Set();
  #referenceCount: ReferenceCount;
  #idResolver = new IDResolver();
  #fetch: typeof globalThis.fetch;
  #virtualNetwork: VirtualNetwork;
  #inFlight: Set<Promise<unknown>> = new Set();
  #loadGeneration = 0; // increments whenever a new load is tracked
  #nextLoadId = 1;
  #loadIds: WeakMap<Promise<unknown>, number> = new WeakMap();
  #cardDocsInFlight: Map<string, Promise<SingleCardDocument | CardError>> =
    new Map();
  #fileMetaDocsInFlight: Map<
    string,
    Promise<SingleFileMetaDocument | CardError>
  > = new Map();

  // CS-10872: in-flight query loads with metadata, used by the
  // prerenderer's render-timeout error path to surface "what query
  // fields were still loading" in the persisted error document.
  // Keyed by a monotonic token so the same query can appear multiple
  // times (e.g. seed + live-refresh) without collapsing.
  #queryLoadsInFlight: Map<number, { meta: QueryLoadMeta; startedAt: number }> =
    new Map();
  #nextQueryLoadToken = 1;
  // Bounded "top-slowest" history of completed query loads. Same
  // intent as the loader's recent-evaluations: when the timeout diag
  // reads this after the fact, we still know which query-field or
  // standalone search ate the most wall time during the attempt.
  #recentQueryLoads: Array<{ meta: QueryLoadMeta; ms: number }> = [];
  // Per-URL startedAt for linked-field (card doc) and file-meta
  // loads. Lets the timeout diagnostic report per-item ageMs, so a
  // single slow linksTo target is distinguishable from many small
  // ones piling up in a fan-out.
  #cardDocStartedAt: Map<string, number> = new Map();
  #fileMetaStartedAt: Map<string, number> = new Map();
  // Bounded "top-slowest" history of completed doc loads.
  #recentCardDocLoads: Array<{ url: string; ms: number }> = [];
  #recentFileMetaLoads: Array<{ url: string; ms: number }> = [];
  static #MAX_DIAGNOSTIC_HISTORY = 20;

  #storeHooks: StoreHooks | undefined;

  constructor(
    referenceCount: ReferenceCount,
    fetch: typeof globalThis.fetch,
    virtualNetwork: VirtualNetwork,
    storeHooks?: StoreHooks,
  ) {
    this.#referenceCount = referenceCount;
    this.#fetch = fetch;
    this.#virtualNetwork = virtualNetwork;
    this.#storeHooks = storeHooks;
  }

  get virtualNetwork(): VirtualNetwork {
    return this.#virtualNetwork;
  }

  getCard(id: string): CardDef | undefined {
    return this.getCardItem('instance', id) as CardDef | undefined;
  }

  getFileMeta(id: string): FileDef | undefined {
    return this.getFileMetaItem('instance', id) as FileDef | undefined;
  }

  getRemoteIds(localId: string) {
    return this.#idResolver.getRemoteIds(localId);
  }

  setCard(id: string, instance: CardDef): void {
    this.setCardItem(id, instance);
  }

  setFileMeta(id: string, instance: FileDef): void {
    this.setFileMetaItem(id, instance);
  }

  setCardNonTracked(id: string, instance: CardDef): void {
    this.setCardItem(id, instance, true);
  }

  setFileMetaNonTracked(id: string, instance: FileDef): void {
    this.setFileMetaItem(id, instance, true);
  }

  async loadCardDocument(
    url: string,
    opts?: { dependencyTrackingContext?: RuntimeDependencyTrackingContext },
  ) {
    trackRuntimeInstanceDependency(url, opts?.dependencyTrackingContext);
    let promise = this.#cardDocsInFlight.get(url);
    if (promise) {
      this.trackLoad(promise);
      return await promise;
    }
    promise = loadCardDocument(this.#fetch, url, this.#virtualNetwork);
    this.#cardDocsInFlight.set(url, promise);
    this.#cardDocStartedAt.set(url, Date.now());
    this.trackLoad(promise);
    try {
      return await promise;
    } finally {
      let startedAt = this.#cardDocStartedAt.get(url);
      this.#cardDocsInFlight.delete(url);
      this.#cardDocStartedAt.delete(url);
      if (typeof startedAt === 'number') {
        this.#recordDiagnosticHistory(this.#recentCardDocLoads, {
          url,
          ms: Date.now() - startedAt,
        });
      }
    }
  }

  async loadFileMetaDocument(
    url: string,
    opts?: { dependencyTrackingContext?: RuntimeDependencyTrackingContext },
  ): Promise<SingleFileMetaDocument | CardError> {
    trackRuntimeFileDependency(url, opts?.dependencyTrackingContext);
    let promise = this.#fileMetaDocsInFlight.get(url);
    if (promise) {
      this.trackLoad(promise);
      return await promise;
    }
    promise = loadFileMetaDocument(this.#fetch, url, this.#virtualNetwork);
    this.#fileMetaDocsInFlight.set(url, promise);
    this.#fileMetaStartedAt.set(url, Date.now());
    this.trackLoad(promise);
    try {
      return await promise;
    } finally {
      let startedAt = this.#fileMetaStartedAt.get(url);
      this.#fileMetaDocsInFlight.delete(url);
      this.#fileMetaStartedAt.delete(url);
      if (typeof startedAt === 'number') {
        this.#recordDiagnosticHistory(this.#recentFileMetaLoads, {
          url,
          ms: Date.now() - startedAt,
        });
      }
    }
  }

  get cardDocsInFlight() {
    return [...this.#cardDocsInFlight.keys()];
  }

  get fileMetaDocsInFlight() {
    return [...this.#fileMetaDocsInFlight.keys()];
  }

  // CS-10872: per-item age for linked-field / file-meta loads. Used
  // by the prerender timeout diagnostic so operators can see which
  // URL has been hanging the longest, not just "there are 5 pending".
  cardDocLoadsInFlight(): Array<{ url: string; ageMs: number }> {
    let now = Date.now();
    let out: Array<{ url: string; ageMs: number }> = [];
    for (let [url, startedAt] of this.#cardDocStartedAt) {
      out.push({ url, ageMs: now - startedAt });
    }
    return out;
  }
  fileMetaDocLoadsInFlight(): Array<{ url: string; ageMs: number }> {
    let now = Date.now();
    let out: Array<{ url: string; ageMs: number }> = [];
    for (let [url, startedAt] of this.#fileMetaStartedAt) {
      out.push({ url, ageMs: now - startedAt });
    }
    return out;
  }
  recentCardDocLoads(): Array<{ url: string; ms: number }> {
    return [...this.#recentCardDocLoads];
  }
  recentFileMetaLoads(): Array<{ url: string; ms: number }> {
    return [...this.#recentFileMetaLoads];
  }
  recentQueryLoads(): Array<{ meta: QueryLoadMeta; ms: number }> {
    return this.#recentQueryLoads.map(({ meta, ms }) => ({ meta, ms }));
  }

  #recordDiagnosticHistory<T extends { ms: number }>(
    history: T[],
    entry: T,
  ): void {
    history.push(entry);
    if (
      history.length > CardStoreWithGarbageCollection.#MAX_DIAGNOSTIC_HISTORY
    ) {
      history.sort((a, b) => b.ms - a.ms);
      history.length = CardStoreWithGarbageCollection.#MAX_DIAGNOSTIC_HISTORY;
    }
  }

  trackLoad(load: Promise<unknown>) {
    if (this.#inFlight.has(load)) {
      loadTrackingLogger.debug('trackLoad skipped duplicate promise');
      return;
    }
    let loadId = this.#nextLoadId++;
    this.#loadIds.set(load, loadId);
    this.#inFlight.add(load);
    this.#loadGeneration++;
    loadTrackingLogger.debug(
      `trackLoad start id=${loadId} generation=${this.#loadGeneration} pending=${this.#inFlight.size}`,
    );
    void load
      .finally(() => {
        this.#inFlight.delete(load);
        loadTrackingLogger.debug(
          `trackLoad settled id=${loadId} pending=${this.#inFlight.size}`,
        );
      })
      .catch((error) => {
        loadTrackingLogger.debug(
          `trackLoad rejected id=${loadId} error=${String(error)}`,
        );
      });
  }

  trackQueryLoad(load: Promise<unknown>, meta: QueryLoadMeta): () => void {
    let token = this.#nextQueryLoadToken++;
    let startedAt = Date.now();
    this.#queryLoadsInFlight.set(token, { meta, startedAt });
    let released = false;
    let release = () => {
      if (released) return;
      released = true;
      this.#queryLoadsInFlight.delete(token);
      this.#recordDiagnosticHistory(this.#recentQueryLoads, {
        meta,
        ms: Date.now() - startedAt,
      });
    };
    // Swallow the chained promise's rejection — `load` may be an
    // ember-concurrency TaskInstance that rejects with TaskCancelation
    // when the owning component unmounts. Our only interest is that
    // `release()` runs on settle; failing to catch here would surface
    // the cancelation as an unhandled promise rejection and fail
    // unrelated tests that tear down SearchResource mid-load.
    load.finally(release).catch(() => {});
    return release;
  }

  queryLoadsInFlight(): QueryLoadInfo[] {
    let now = Date.now();
    let out: QueryLoadInfo[] = [];
    for (let { meta, startedAt } of this.#queryLoadsInFlight.values()) {
      out.push({ ...meta, ageMs: now - startedAt });
    }
    return out;
  }

  async loaded() {
    loadTrackingLogger.debug(
      `loaded() begin generation=${this.#loadGeneration} pending=${this.#inFlight.size}`,
    );
    let observedGeneration = this.#loadGeneration;
    for (;;) {
      if (this.#inFlight.size === 0) {
        // allow microtasks (like settled promise continuations) to enqueue more loads
        loadTrackingLogger.debug(
          'loaded() no pending loads, waiting one microtask',
        );
        await Promise.resolve();
      } else {
        let pendingLoads = Array.from(this.#inFlight);
        let pendingIds = pendingLoads
          .map((pendingLoad) => this.#loadIds.get(pendingLoad))
          .filter((id): id is number => id != null);
        loadTrackingLogger.debug(
          `loaded() waiting for pending loads ids=[${pendingIds.join(',')}] count=${pendingLoads.length}`,
        );
        await Promise.allSettled(pendingLoads);
      }
      if (
        this.#inFlight.size === 0 &&
        this.#loadGeneration === observedGeneration
      ) {
        loadTrackingLogger.debug(
          `loaded() complete generation=${this.#loadGeneration}`,
        );
        return;
      }
      loadTrackingLogger.debug(
        `loaded() continuing; generation moved ${observedGeneration} -> ${this.#loadGeneration}, pending=${this.#inFlight.size}`,
      );
      observedGeneration = this.#loadGeneration;
    }
  }

  get loadGeneration() {
    return this.#loadGeneration;
  }

  addCardInstanceOrError(
    id: string,
    instanceOrError: CardDef | CardErrorJSONAPI,
  ) {
    this.setCardItem(id, instanceOrError);
  }

  getCardInstanceOrError<T extends CardDef>(id: string) {
    // favor instances over errors so that we can get stale values when the
    // server goes into an error state
    return (this.getCardItem('instance', id) ??
      this.getCardItem('error', id)) as T | CardErrorJSONAPI | undefined;
  }

  // All hydrated (non-error) card instances currently in the identity map.
  // Reads the tracked `#cardInstances` map, so a caller that consumes the
  // result inside an autotracked computation re-runs when an instance is
  // added or removed — the candidate set for the client-side search filter.
  // Field-level edits to an already-present instance don't change the map;
  // those are surfaced separately by StoreService's mutation-version signal.
  //
  // A single instance is keyed under both its local and remote id (see
  // setCardItem), so the map yields it more than once; collapse to a unique
  // set so the candidate pool never contains the same card twice.
  allCardInstances(): CardDef[] {
    let result = new Set<CardDef>();
    for (let instance of this.#cardInstances.values()) {
      if (isCardInstance(instance)) {
        result.add(instance);
      }
    }
    return [...result];
  }

  // The file-meta counterpart of `allCardInstances`, reading the tracked
  // `#fileMetaInstances` map so file-meta searches get the same client-side
  // candidate set as card searches. Deduped to a unique set for the same
  // reason — an instance can appear under more than one key.
  allFileMetaInstances(): FileDef[] {
    let result = new Set<FileDef>();
    for (let instance of this.#fileMetaInstances.values()) {
      if (isFileDefInstance(instance)) {
        result.add(instance);
      }
    }
    return [...result];
  }

  addFileMetaInstanceOrError(
    id: string,
    instanceOrError: FileDef | CardErrorJSONAPI,
  ) {
    this.setFileMetaItem(id, instanceOrError);
  }

  getFileMetaInstanceOrError<T extends FileDef>(id: string) {
    return (this.getFileMetaItem('instance', id) ??
      this.getFileMetaItem('error', id)) as T | CardErrorJSONAPI | undefined;
  }

  getCardError(id: string) {
    return this.getCardItem('error', id);
  }

  getFileMetaError(id: string) {
    return this.getFileMetaItem('error', id);
  }

  delete(id: string): void {
    // A `.json` url addresses the file-meta identity, never a card: card ids
    // never carry an extension, while file-meta keeps its `.json`. The two
    // share a stem (e.g. the card `…/realm` and its `…/realm.json` file — every
    // card has a backing `.json`), so deleting the file must remove only the
    // file-meta row. Stripping `.json` and running the card-identity logic
    // below on the result would evict the same-named card.
    if (/\.json$/.test(id)) {
      this.#gcCandidates.delete(id);
      this.deleteFileMeta(id);
      return;
    }
    let localId = isLocalId(id) ? id : undefined;
    let remoteId = !isLocalId(id) ? id : undefined;

    if (localId) {
      let remoteIds = this.#idResolver.getRemoteIds(localId);
      this.#gcCandidates.delete(localId);
      this.deleteFromAll(localId);
      if (remoteIds.length) {
        for (let id of remoteIds) {
          this.deleteFromAll(id);
          this.#idResolver.removeByRemoteId(id);
        }
      }
    }
    if (remoteId) {
      localId = this.#idResolver.getLocalId(remoteId);
      if (localId) {
        let otherRemoteIds = this.#idResolver
          .getRemoteIds(localId)
          .filter((i) => i !== remoteId);
        this.deleteFromAll(localId);
        this.#gcCandidates.delete(localId);
        for (let id of otherRemoteIds) {
          this.deleteFromAll(id);
          this.#idResolver.removeByRemoteId(id);
        }
      }
      this.deleteFromAll(remoteId);
      this.#idResolver.removeByRemoteId(remoteId);
    }
  }

  reset() {
    this.#cardInstances.clear();
    this.#clearEphemeralErrors(this.#cardInstanceErrors);
    this.#nonTrackedCardInstances.clear();
    this.#clearEphemeralErrors(this.#nonTrackedCardInstanceErrors);
    this.#fileMetaInstances.clear();
    this.#clearEphemeralErrors(this.#fileMetaInstanceErrors);
    this.#nonTrackedFileMetaInstances.clear();
    this.#clearEphemeralErrors(this.#nonTrackedFileMetaInstanceErrors);
    this.#gcCandidates.clear();
    this.#cardDocsInFlight.clear();
    this.#fileMetaDocsInFlight.clear();
    this.#inFlight.clear();
    this.#loadGeneration = 0;
    // CS-10872: diagnostic trackers follow the same lifecycle as the
    // in-flight maps. If a loader/cache reset happens mid-render
    // (triggered by a `clearCache: true` clearCache retry, for
    // example), stale in-flight entries and recent-history rows must
    // not survive into the next render's timeout diagnostics.
    this.#queryLoadsInFlight.clear();
    this.#cardDocStartedAt.clear();
    this.#fileMetaStartedAt.clear();
    this.#recentQueryLoads.length = 0;
    this.#recentCardDocLoads.length = 0;
    this.#recentFileMetaLoads.length = 0;
    this.#idResolver.reset();
  }

  #clearEphemeralErrors(bucket: Map<string, CardErrorJSONAPI>) {
    for (let id of [...bucket.keys()]) {
      let error = bucket.get(id);
      if (!error) {
        bucket.delete(id);
        continue;
      }
      if (!this.#shouldPreserveError(error)) {
        bucket.delete(id);
      }
    }
  }

  #shouldPreserveError(error: CardErrorJSONAPI): boolean {
    return Boolean(error.meta?.remoteId);
  }

  get gcCandidates() {
    return [...this.#gcCandidates];
  }

  sweep(api: typeof CardAPI) {
    let dependencyGraph = this.makeDependencyGraph(api);
    let reachable = new Set<string>();
    let visited = new WeakSet<StoredInstance>();
    let rootLocalIds: string[] = [];

    for (let instance of this.#cardInstances.values()) {
      if (!instance || visited.has(instance)) {
        continue;
      }
      visited.add(instance);
      if (isCardInstance(instance)) {
        let localId = instance[localIdSymbol];
        if (this.hasReferences(localId)) {
          rootLocalIds.push(localId);
        }
      }
    }

    for (let instance of this.#fileMetaInstances.values()) {
      if (!instance) {
        continue;
      }
      if (isFileDefInstance(instance)) {
        let fileId = instance.id;
        if (fileId && this.hasReferences(fileId)) {
          reachable.add(fileId);
        }
      }
    }

    let stack = [...rootLocalIds];
    while (stack.length > 0) {
      let current = stack.pop()!;
      if (reachable.has(current)) {
        continue;
      }
      reachable.add(current);
      let dependencies = dependencyGraph.get(current);
      if (!dependencies) {
        continue;
      }
      for (let dep of dependencies) {
        stack.push(dep);
      }
    }

    visited = new WeakSet<StoredInstance>();
    for (let instance of this.#cardInstances.values()) {
      if (!instance || visited.has(instance)) {
        continue;
      }
      visited.add(instance);
      let gcId: string | undefined;
      let extraDeleteIds: string[] = [];
      if (isCardInstance(instance)) {
        gcId = instance[localIdSymbol];
        if (instance.id) {
          extraDeleteIds.push(instance.id);
        }
      }
      if (!gcId) {
        continue; // we should alwyays have a gcId by this point, but this helps TypeScript know that
      }
      if (!reachable.has(gcId)) {
        if (this.#gcCandidates.has(gcId)) {
          destroy(instance);
          (instance as unknown as any)[
            Symbol.for('__instance_detached_from_store')
          ] = true;
          this.delete(gcId);
          for (let id of extraDeleteIds) {
            this.delete(id);
          }
        } else {
          this.#gcCandidates.add(gcId);
        }
      } else {
        this.#gcCandidates.delete(gcId);
      }
    }

    for (let instance of this.#fileMetaInstances.values()) {
      if (!instance) {
        continue;
      }
      let gcId = instance.id;
      if (!gcId) {
        continue;
      }
      if (!reachable.has(gcId)) {
        if (this.#gcCandidates.has(gcId)) {
          destroy(instance);
          (instance as unknown as any)[
            Symbol.for('__instance_detached_from_store')
          ] = true;
          this.delete(gcId);
        } else {
          this.#gcCandidates.add(gcId);
        }
      } else {
        this.#gcCandidates.delete(gcId);
      }
    }
  }

  makeTracked(remoteId: string) {
    // File-meta is keyed by the full URL; card buckets by the stripped id.
    let fileMetaId = remoteId;
    remoteId = remoteId.replace(/\.json$/, '');
    let instance = this.#nonTrackedCardInstances.get(remoteId);
    if (instance) {
      this.setCardItem(remoteId, instance);
    }
    this.#nonTrackedCardInstances.delete(remoteId);

    let error = this.#nonTrackedCardInstanceErrors.get(remoteId);
    if (error) {
      this.addCardInstanceOrError(remoteId, error);
    }
    this.#nonTrackedCardInstanceErrors.delete(remoteId);

    let fileMetaInstance = this.#nonTrackedFileMetaInstances.get(fileMetaId);
    if (fileMetaInstance) {
      this.setFileMetaItem(fileMetaId, fileMetaInstance);
    }
    this.#nonTrackedFileMetaInstances.delete(fileMetaId);

    let fileMetaError = this.#nonTrackedFileMetaInstanceErrors.get(fileMetaId);
    if (fileMetaError) {
      this.addFileMetaInstanceOrError(fileMetaId, fileMetaError);
    }
    this.#nonTrackedFileMetaInstanceErrors.delete(fileMetaId);
  }

  consumersOf(api: typeof CardAPI, instance: CardDef) {
    let consumptionGraph = this.makeConsumptionGraph(api);
    let consumers = consumptionGraph.get(instance[localIdSymbol]);
    return [...(consumers ?? [])]
      .map((id) => this.getCard(id))
      .filter(Boolean) as CardDef[];
  }

  dependenciesOf(api: typeof CardAPI, instance: CardDef) {
    let dependencyGraph = this.makeDependencyGraph(api);
    let deps = dependencyGraph.get(instance[localIdSymbol]);
    return [...(deps ?? [])]
      .map((id) => this.getCard(id))
      .filter(Boolean) as CardDef[];
  }

  private deleteFromAll(id: string) {
    // `.json` deletes are routed to `deleteFileMeta` (a same-named card must
    // not be evicted), so `id` here never carries a `.json` extension — the
    // only ids that reach this are card ids/localIds and non-`.json` file urls
    // (e.g. `…/x.png`). For those the card id and the file-meta key are
    // identical, so one key clears both bucket sets.
    this.#cardInstances.delete(id);
    this.#cardInstanceErrors.delete(id);
    this.#nonTrackedCardInstances.delete(id);
    this.#nonTrackedCardInstanceErrors.delete(id);
    this.#fileMetaInstances.delete(id);
    this.#fileMetaInstanceErrors.delete(id);
    this.#nonTrackedFileMetaInstances.delete(id);
    this.#nonTrackedFileMetaInstanceErrors.delete(id);
  }

  // Delete only the file-meta buckets, keyed by the full URL (extension
  // included). Used for `.json` deletes so a same-named card — e.g. the realm
  // config card `…/realm` vs its `…/realm.json` file — is left intact.
  private deleteFileMeta(id: string) {
    this.#fileMetaInstances.delete(id);
    this.#fileMetaInstanceErrors.delete(id);
    this.#nonTrackedFileMetaInstances.delete(id);
    this.#nonTrackedFileMetaInstanceErrors.delete(id);
  }

  private getCardItem(type: 'instance', id: string): CardDef | undefined;
  private getCardItem(type: 'error', id: string): CardErrorJSONAPI | undefined;
  private getCardItem(
    type: 'instance' | 'error',
    id: string,
  ): CardDef | CardErrorJSONAPI | undefined {
    id = id.replace(/\.json$/, '');
    let { item, localId } = this.tryFindingCardItem(type, id);

    if (!item && isLocalId(id)) {
      let maybeRemoteId = this.#idResolver.findRemoteId(id);
      if (maybeRemoteId) {
        ({ item, localId } = this.tryFindingCardItem(type, maybeRemoteId));
      }
    }

    if (localId) {
      this.#gcCandidates.delete(localId);
    }
    return item;
  }

  private getFileMetaItem(type: 'instance', id: string): FileDef | undefined;
  private getFileMetaItem(
    type: 'error',
    id: string,
  ): CardErrorJSONAPI | undefined;
  private getFileMetaItem(
    type: 'instance' | 'error',
    id: string,
  ): FileDef | CardErrorJSONAPI | undefined {
    // File-meta rows are keyed by their full URL, extension included — unlike
    // card ids, which never carry one. Stripping `.json` here would collapse a
    // `…/x.json` FileDef onto the card id `…/x`, so a `.json` file that is also
    // a card (e.g. a realm config) would misread as the other identity.
    let bucket =
      type === 'instance'
        ? this.#fileMetaInstances
        : this.#fileMetaInstanceErrors;
    let silentBucket =
      type === 'instance'
        ? this.#nonTrackedFileMetaInstances
        : this.#nonTrackedFileMetaInstanceErrors;
    let item = bucket.get(id) ?? silentBucket.get(id);
    if (item) {
      this.#gcCandidates.delete(id);
    }
    return item;
  }

  private tryFindingCardItem(
    type: 'instance' | 'error',
    localOrRemoteId: string,
  ): {
    item: CardDef | CardErrorJSONAPI | undefined;
    localId: string | undefined;
  } {
    let bucket =
      type === 'instance' ? this.#cardInstances : this.#cardInstanceErrors;
    let silentBucket =
      type === 'instance'
        ? this.#nonTrackedCardInstances
        : this.#nonTrackedCardInstanceErrors;
    let localId = isLocalId(localOrRemoteId) ? localOrRemoteId : undefined;
    let remoteId = !isLocalId(localOrRemoteId) ? localOrRemoteId : undefined;
    let item: CardDef | CardErrorJSONAPI | undefined;
    if (remoteId) {
      if (localId) {
        remoteId = this.#idResolver.getRemoteIds(localId)?.[0];
      }

      localId = this.#idResolver.getLocalId(remoteId);
      // Correlate the last segment of the remote URL with a local ID to find an
      // instance that was created locally and has since been given a remote id
      // the resolver doesn't know about yet. This is a pure lookup: it does NOT
      // reconcile the instance's `id` to the remote id, because it runs inside
      // render-time reads (`store.peek`) and writing the tracked `id` mid-render
      // trips Glimmer's backtracking re-render assertion. Identity reconciliation
      // happens when the store learns the remote id out of band — at the realm
      // invalidation event (StoreService.handleInvalidations) and the
      // save/deserialize flow (api.setId / updateFromSerialized).
      if (!localId) {
        localId = remoteId.split('/').pop()!;
        item = bucket.get(localId) ?? silentBucket.get(localId);
      }
    }

    item =
      item ??
      (localId
        ? (bucket.get(localId) ?? silentBucket.get(localId))
        : undefined) ??
      (remoteId
        ? (bucket.get(remoteId) ?? silentBucket.get(remoteId))
        : undefined);
    return { item, localId };
  }

  private setCardItem(
    id: string,
    item: CardDef | CardErrorJSONAPI,
    notTracked?: true,
  ) {
    id = id.replace(/\.json$/, '');
    let cardBucket = notTracked
      ? this.#nonTrackedCardInstances
      : this.#cardInstances;
    let errorBucket = notTracked
      ? this.#nonTrackedCardInstanceErrors
      : this.#cardInstanceErrors;
    let isRemoteId = !isLocalId(id);
    if (isRemoteId) {
      if (isCardInstance(item)) {
        this.#idResolver.addIdPair(item[localIdSymbol], id);
      } else {
        // Non-card instances (e.g. FileDef) never carry a local ID on the item.
        // We only attempt a tail match against ids already present in buckets.
        let tailId = id.split('/').pop()!;
        let bucketItem = cardBucket.get(tailId) ?? errorBucket.get(tailId);
        if (bucketItem) {
          this.#idResolver.addIdPair(tailId, id);
        }
      }
    }
    let instance = isCardInstance(item) ? item : undefined;
    let error = !isCardInstance(item) ? item : undefined;
    if (error && isRemoteId && error.id && isLocalId(error.id)) {
      this.#idResolver.addIdPair(error.id, id);
    }
    let localId = isLocalId(id) ? id : undefined;
    let remoteIds = isRemoteId ? [id] : [];
    if (localId) {
      remoteIds = this.#idResolver.getRemoteIds(localId);
    }
    if (remoteIds.length > 0) {
      localId =
        (instance && isCardInstance(instance)
          ? instance[localIdSymbol]
          : undefined) ?? this.#idResolver.getLocalId(remoteIds[0]);

      let maybeOldLocalId = remoteIds[0].split('/').pop()!;
      errorBucket.delete(maybeOldLocalId);
    }

    if (localId) {
      this.#gcCandidates.delete(localId);
    }

    // make entries for both the local ID and the remote ID in the identity map
    if (instance) {
      // instances always have a local ID
      if (localId) {
        setIfDifferent(cardBucket, localId, instance);
        errorBucket.delete(localId);
      }
      if (remoteIds.length > 0) {
        for (let remoteId of remoteIds) {
          setIfDifferent(cardBucket, remoteId, instance);
          errorBucket.delete(remoteId);
        }
      }
    }

    if (error) {
      if (localId) {
        setIfDifferent(errorBucket, localId, error);
      }
      if (remoteIds.length > 0) {
        for (let remoteId of remoteIds) {
          setIfDifferent(errorBucket, remoteId, error);
        }
      }
    }
  }

  private setFileMetaItem(
    id: string,
    item: StoredInstance | CardErrorJSONAPI,
    notTracked?: true,
  ) {
    // Key by the full URL (extension included). See getFileMetaItem: collapsing
    // `…/x.json` onto `…/x` would collide with the card id `…/x`.
    let instanceBucket = notTracked
      ? this.#nonTrackedFileMetaInstances
      : this.#fileMetaInstances;
    let errorBucket = notTracked
      ? this.#nonTrackedFileMetaInstanceErrors
      : this.#fileMetaInstanceErrors;
    let instance = isFileDefInstance(item) ? item : undefined;
    let error = !isFileDefInstance(item) ? item : undefined;

    if (instance) {
      setIfDifferent(instanceBucket, id, instance);
      errorBucket.delete(id);
      this.#gcCandidates.delete(id);
    }

    if (error) {
      setIfDifferent(errorBucket, id, error);
    }
  }

  private hasReferences(id: string): boolean {
    let idsToCheck = new Set<string>([id]);
    let localId = isLocalId(id) ? id : this.#idResolver.getLocalId(id);
    if (localId) {
      idsToCheck.add(localId);
      for (let remoteId of this.#idResolver.getRemoteIds(localId)) {
        idsToCheck.add(remoteId);
      }
    }
    let referenceCount = 0;
    for (let refId of idsToCheck) {
      referenceCount += this.#referenceCount.get(refId) ?? 0;
    }
    return referenceCount > 0;
  }

  private makeConsumptionGraph(api: typeof CardAPI): InstanceGraph {
    let consumptionGraph: InstanceGraph = new Map();
    for (let instance of this.#cardInstances.values()) {
      if (!instance || !isCardInstance(instance)) {
        continue;
      }
      let deps = getDeps(api, instance);
      for (let dep of deps) {
        if (!isCardInstance(dep)) {
          continue;
        }
        let consumers = consumptionGraph.get(dep[localIdSymbol]);
        if (!consumers) {
          consumers = new Set();
          consumptionGraph.set(dep[localIdSymbol], consumers);
        }
        consumers.add(instance[localIdSymbol]);
      }
    }
    return consumptionGraph;
  }

  private makeDependencyGraph(api: typeof CardAPI): InstanceGraph {
    let dependencyGraph: InstanceGraph = new Map();
    for (let instance of this.#cardInstances.values()) {
      if (!instance || !isCardInstance(instance)) {
        continue;
      }
      let deps = getDeps(api, instance);
      dependencyGraph.set(
        instance[localIdSymbol],
        new Set(
          deps
            .map((dep) => (isCardInstance(dep) ? dep[localIdSymbol] : dep.id))
            .filter(Boolean) as string[],
        ),
      );
    }
    return dependencyGraph;
  }

  getSearchResource<T extends CardDef | FileDef = CardDef>(
    parent: object,
    getQuery: () => Query | undefined,
    getRealms?: () => string[] | undefined,
    opts?: GetSearchResourceFuncOpts,
  ) {
    if (!this.#storeHooks?.getSearchResource) {
      return {
        instances: [],
        instancesByRealm: [],
        isLoading: false,
        meta: { page: { total: 0 } },
        errors: undefined,
      } as StoreSearchResource<T>;
    }
    return this.#storeHooks.getSearchResource(
      parent,
      getQuery,
      getRealms,
      opts,
    );
  }
}

export function getDeps(
  api: typeof CardAPI,
  instance: CardDef,
): Array<CardDef | FileDef> {
  let fields = api.getFields(
    Reflect.getPrototypeOf(instance)!.constructor as typeof CardDef,
    { includeComputeds: false },
  );
  let deps: Array<CardDef | FileDef> = [];
  for (let [fieldName, field] of Object.entries(fields)) {
    let value = api.peekAtField(instance, fieldName);
    if (isPrimitive(field.card) || !value || typeof value !== 'object') {
      continue;
    }
    deps.push(...findInstances(api, value));
  }
  return deps;
}

function findInstances(
  api: typeof CardAPI,
  obj: unknown,
  visited = new WeakSet<object>(),
): Array<CardDef | FileDef> {
  if (!obj || typeof obj !== 'object') {
    return [];
  }
  if (visited.has(obj)) {
    return [];
  }
  visited.add(obj);
  if (isCardInstance(obj)) {
    return [obj];
  }
  if (isFileDefInstance(obj)) {
    return [obj];
  }
  // A sentinel in the bucket (not-loaded / link-error / link-not-found) is
  // never an instance and never owns instance references — skip the recursion
  // so its `errorDoc` and `reference` fields are not walked as a generic object.
  if (api.isNonPresentLink(obj)) {
    return [];
  }
  if (isBaseDefInstance(obj)) {
    let deps: Array<CardDef | FileDef> = [];
    let fields = api.getFields(obj, { includeComputeds: false });
    for (let [fieldName, field] of Object.entries(fields)) {
      let value = api.peekAtField(obj, fieldName);
      if (isPrimitive(field.card) || !value || typeof value !== 'object') {
        continue;
      }
      deps.push(...findInstances(api, value, visited));
    }
    return deps;
  }
  if (Array.isArray(obj)) {
    return obj.reduce(
      (acc, item) =>
        item && typeof item === 'object'
          ? acc.concat(findInstances(api, item, visited))
          : acc,
      [] as Array<CardDef | FileDef>,
    );
  }
  if (obj && typeof obj === 'object') {
    return Object.values(obj).reduce(
      (acc, value) =>
        value && typeof value === 'object'
          ? acc.concat(findInstances(api, value, visited))
          : acc,
      [] as Array<CardDef | FileDef>,
    );
  }
  return [];
}

function isBaseDefInstance(value: object): value is BaseDef {
  return isBaseInstance in value;
}

// only touch the entry in the tracked map if it's different so we don't trigger
// an unnecessary glimmer invalidation
function setIfDifferent(map: Map<string, unknown>, id: string, value: unknown) {
  if (map.get(id) !== value) {
    map.set(id, value);
  }
}
