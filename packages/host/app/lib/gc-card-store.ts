import { destroy } from '@ember/destroyable';

import { TrackedMap } from 'tracked-built-ins';

import {
  isPrimitive,
  isCardInstance,
  isFileDefInstance,
  isLocalId,
  localId as localIdSymbol,
  loadCardDocument,
  loadFileMetaDocument,
  type Query,
  type QueryResultsMeta,
  type ErrorEntry,
  type CardErrorJSONAPI,
  type CardError,
  type SingleCardDocument,
  type SingleFileMetaDocument,
} from '@cardstack/runtime-common';

import type {
  CardDef,
  CardStore,
  GetSearchResourceFuncOpts,
  StoreSearchResource,
} from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';
import type { FileDef } from 'https://cardstack.com/base/file-api';

export type ReferenceCount = Map<string, number>;

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
      seed?:
        | {
            cards: T[];
            searchURL?: string;
            realms?: string[];
            meta?: QueryResultsMeta;
            errors?: ErrorEntry[];
          }
        | undefined;
    },
  ): StoreSearchResource<T>;
};

function isCardOrFileInstance(item: unknown): item is StoredInstance {
  return isCardInstance(item) || isFileDefInstance(item);
}

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
  #inFlight: Set<Promise<unknown>> = new Set();
  #loadGeneration = 0; // increments whenever a new load is tracked
  #cardDocsInFlight: Map<string, Promise<SingleCardDocument | CardError>> =
    new Map();
  #fileMetaDocsInFlight: Map<
    string,
    Promise<SingleFileMetaDocument | CardError>
  > = new Map();

  #storeHooks: StoreHooks | undefined;

  constructor(
    referenceCount: ReferenceCount,
    fetch: typeof globalThis.fetch,
    storeHooks?: StoreHooks,
  ) {
    this.#referenceCount = referenceCount;
    this.#fetch = fetch;
    this.#storeHooks = storeHooks;
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

  async loadCardDocument(url: string) {
    let promise = this.#cardDocsInFlight.get(url);
    if (promise) {
      this.trackLoad(promise);
      return await promise;
    }
    promise = loadCardDocument(this.#fetch, url);
    this.#cardDocsInFlight.set(url, promise);
    this.trackLoad(promise);
    try {
      return await promise;
    } finally {
      this.#cardDocsInFlight.delete(url);
    }
  }

  async loadFileMetaDocument(
    url: string,
  ): Promise<SingleFileMetaDocument | CardError> {
    let promise = this.#fileMetaDocsInFlight.get(url);
    if (promise) {
      this.trackLoad(promise);
      return await promise;
    }
    promise = loadFileMetaDocument(this.#fetch, url);
    this.#fileMetaDocsInFlight.set(url, promise);
    this.trackLoad(promise);
    try {
      return await promise;
    } finally {
      this.#fileMetaDocsInFlight.delete(url);
    }
  }

  get cardDocsInFlight() {
    return [...this.#cardDocsInFlight.keys()];
  }

  get fileMetaDocsInFlight() {
    return [...this.#fileMetaDocsInFlight.keys()];
  }

  trackLoad(load: Promise<unknown>) {
    if (this.#inFlight.has(load)) {
      return;
    }
    this.#inFlight.add(load);
    this.#loadGeneration++;
    load.finally(() => {
      this.#inFlight.delete(load);
    });
  }

  async loaded() {
    let observedGeneration = this.#loadGeneration;
    for (;;) {
      if (this.#inFlight.size === 0) {
        // allow microtasks (like settled promise continuations) to enqueue more loads
        await Promise.resolve();
      } else {
        let pendingLoads = Array.from(this.#inFlight);
        await Promise.allSettled(pendingLoads);
      }
      if (
        this.#inFlight.size === 0 &&
        this.#loadGeneration === observedGeneration
      ) {
        return;
      }
      observedGeneration = this.#loadGeneration;
    }
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
    id = id.replace(/\.json$/, '');
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

    let fileMetaInstance = this.#nonTrackedFileMetaInstances.get(remoteId);
    if (fileMetaInstance) {
      this.setFileMetaItem(remoteId, fileMetaInstance);
    }
    this.#nonTrackedFileMetaInstances.delete(remoteId);

    let fileMetaError = this.#nonTrackedFileMetaInstanceErrors.get(remoteId);
    if (fileMetaError) {
      this.addFileMetaInstanceOrError(remoteId, fileMetaError);
    }
    this.#nonTrackedFileMetaInstanceErrors.delete(remoteId);
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
    id = id.replace(/\.json$/, '');
    this.#cardInstances.delete(id);
    this.#cardInstanceErrors.delete(id);
    this.#nonTrackedCardInstances.delete(id);
    this.#nonTrackedCardInstanceErrors.delete(id);
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
    id = id.replace(/\.json$/, '');
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
      // try correlating the last part of the URL with a local ID to handle
      // the scenario where the instance has a newly assigned remote id
      if (!localId) {
        localId = remoteId.split('/').pop()!;
        item = bucket.get(localId) ?? silentBucket.get(localId);
        if (item && type === 'instance' && isCardOrFileInstance(item)) {
          item.id = remoteId;
        }
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
    id = id.replace(/\.json$/, '');
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
    { includeComputeds: true },
  );
  let deps: Array<CardDef | FileDef> = [];
  for (let [fieldName, field] of Object.entries(fields)) {
    let value = (instance as any)[fieldName];
    if (isPrimitive(field.card) || !value || typeof value !== 'object') {
      continue;
    }
    deps.push(...findInstances(value));
  }
  return deps;
}

function findInstances(obj: object): Array<CardDef | FileDef> {
  if (isCardInstance(obj)) {
    return [obj];
  }
  if (isFileDefInstance(obj)) {
    return [obj];
  }
  if (Array.isArray(obj)) {
    return obj.reduce((acc, item) => acc.concat(findInstances(item)), []);
  }
  if (obj && typeof obj === 'object') {
    return Object.values(obj).reduce(
      (acc, value) => acc.concat(findInstances(value)),
      [],
    );
  }
  return [];
}

// only touch the entry in the tracked map if it's different so we don't trigger
// an unnecessary glimmer invalidation
function setIfDifferent(map: Map<string, unknown>, id: string, value: unknown) {
  if (map.get(id) !== value) {
    map.set(id, value);
  }
}
