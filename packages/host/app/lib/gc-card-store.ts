import { destroy } from '@ember/destroyable';

import { TrackedMap } from 'tracked-built-ins';

import {
  isPrimitive,
  isCardInstance,
  isLocalId,
  localId as localIdSymbol,
  loadDocument,
  type Query,
  type QueryResultsMeta,
  type ErrorEntry,
  type CardErrorJSONAPI,
  type CardError,
  type SingleCardDocument,
} from '@cardstack/runtime-common';

import type {
  CardDef,
  CardStore,
  GetSearchResourceFuncOpts,
  StoreSearchResource,
} from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';

export type ReferenceCount = Map<string, number>;

type LocalId = string;
type InstanceGraph = Map<LocalId, Set<LocalId>>;

type StoreHooks = {
  getSearchResource<T extends CardDef = CardDef>(
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
  #nonTrackedCards = new Map<string, CardDef>();
  #nonTrackedCardErrors = new Map<string, CardErrorJSONAPI>();

  #cards = new TrackedMap<string, CardDef>();
  #cardErrors = new TrackedMap<string, CardErrorJSONAPI>();
  #gcCandidates: Set<LocalId> = new Set();
  #referenceCount: ReferenceCount;
  #idResolver = new IDResolver();
  #fetch: typeof globalThis.fetch;
  #inFlight: Set<Promise<unknown>> = new Set();
  #loadGeneration = 0; // increments whenever a new load is tracked
  #docsInFlight: Map<string, Promise<SingleCardDocument | CardError>> =
    new Map();

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

  get(id: string): CardDef | undefined {
    return this.getItem('instance', id);
  }

  getRemoteIds(localId: string) {
    return this.#idResolver.getRemoteIds(localId);
  }

  set(id: string, instance: CardDef): void {
    this.setItem(id, instance);
  }

  setNonTracked(id: string, instance: CardDef): void {
    this.setItem(id, instance, true);
  }

  async loadDocument(url: string) {
    let promise = this.#docsInFlight.get(url);
    if (promise) {
      this.trackLoad(promise);
      return await promise;
    }
    promise = loadDocument(this.#fetch, url);
    this.#docsInFlight.set(url, promise);
    this.trackLoad(promise);
    try {
      return await promise;
    } finally {
      this.#docsInFlight.delete(url);
    }
  }

  get docsInFlight() {
    return [...this.#docsInFlight.keys()];
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

  addInstanceOrError(id: string, instanceOrError: CardDef | CardErrorJSONAPI) {
    this.setItem(id, instanceOrError);
  }

  getInstanceOrError(id: string) {
    // favor instances over errors so that we can get stale values when the
    // server goes into an error state
    return this.getItem('instance', id) ?? this.getItem('error', id);
  }

  getError(id: string) {
    return this.getItem('error', id);
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
    this.#cards.clear();
    this.#clearEphemeralErrors(this.#cardErrors);
    this.#nonTrackedCards.clear();
    this.#clearEphemeralErrors(this.#nonTrackedCardErrors);
    this.#gcCandidates.clear();
    this.#docsInFlight.clear();
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
    let visited = new WeakSet<CardDef>();
    let rootLocalIds: string[] = [];

    for (let instance of this.#cards.values()) {
      if (!instance) {
        continue;
      }
      if (visited.has(instance)) {
        continue;
      }
      visited.add(instance);
      let localId = instance[localIdSymbol];
      if (this.hasReferences(localId)) {
        rootLocalIds.push(localId);
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

    visited = new WeakSet<CardDef>();
    for (let instance of this.#cards.values()) {
      if (!instance) {
        continue;
      }
      if (visited.has(instance)) {
        continue;
      }
      visited.add(instance);
      let localId = instance[localIdSymbol];
      if (!reachable.has(localId)) {
        if (this.#gcCandidates.has(localId)) {
          console.log(
            `garbage collecting instance ${localId} (remote id: ${instance.id}) from store`,
          );
          destroy(instance);
          // brand the instance to make it easier for debugging
          (instance as unknown as any)[
            Symbol.for('__instance_detached_from_store')
          ] = true;
          this.delete(localId);
          if (instance.id) {
            this.delete(instance.id);
          }
        } else {
          console.debug(
            `instance [local id:${localId} remote id: ${instance.id}] is now eligible for garbage collection`,
          );
          this.#gcCandidates.add(localId);
        }
      } else {
        this.#gcCandidates.delete(localId);
      }
    }
  }

  makeTracked(remoteId: string) {
    remoteId = remoteId.replace(/\.json$/, '');
    let instance = this.#nonTrackedCards.get(remoteId);
    if (instance) {
      this.set(remoteId, instance);
    }
    this.#nonTrackedCards.delete(remoteId);

    let error = this.#nonTrackedCardErrors.get(remoteId);
    if (error) {
      this.addInstanceOrError(remoteId, error);
    }
    this.#nonTrackedCardErrors.delete(remoteId);
  }

  consumersOf(api: typeof CardAPI, instance: CardDef) {
    let consumptionGraph = this.makeConsumptionGraph(api);
    let consumers = consumptionGraph.get(instance[localIdSymbol]);
    return [...(consumers ?? [])]
      .map((id) => this.get(id))
      .filter(Boolean) as CardDef[];
  }

  dependenciesOf(api: typeof CardAPI, instance: CardDef) {
    let dependencyGraph = this.makeDependencyGraph(api);
    let deps = dependencyGraph.get(instance[localIdSymbol]);
    return [...(deps ?? [])]
      .map((id) => this.get(id))
      .filter(Boolean) as CardDef[];
  }

  private deleteFromAll(id: string) {
    id = id.replace(/\.json$/, '');
    this.#cards.delete(id);
    this.#cardErrors.delete(id);
    this.#nonTrackedCards.delete(id);
    this.#nonTrackedCardErrors.delete(id);
  }

  private getItem(type: 'instance', id: string): CardDef | undefined;
  private getItem(type: 'error', id: string): CardErrorJSONAPI | undefined;
  private getItem(
    type: 'instance' | 'error',
    id: string,
  ): CardDef | CardErrorJSONAPI | undefined {
    id = id.replace(/\.json$/, '');
    let { item, localId } = this.tryFindingItem(type, id);

    if (!item && isLocalId(id)) {
      let maybeRemoteId = this.#idResolver.findRemoteId(id);
      if (maybeRemoteId) {
        ({ item, localId } = this.tryFindingItem(type, maybeRemoteId));
      }
    }

    if (localId) {
      this.#gcCandidates.delete(localId);
    }
    return item;
  }

  private tryFindingItem(type: 'instance' | 'error', localOrRemoteId: string) {
    let bucket = type === 'instance' ? this.#cards : this.#cardErrors;
    let silentBucket =
      type === 'instance' ? this.#nonTrackedCards : this.#nonTrackedCardErrors;
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
        if (item && type === 'instance') {
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

  private setItem(
    id: string,
    item: CardDef | CardErrorJSONAPI,
    notTracked?: true,
  ) {
    id = id.replace(/\.json$/, '');
    let cardBucket = notTracked ? this.#nonTrackedCards : this.#cards;
    let errorBucket = notTracked
      ? this.#nonTrackedCardErrors
      : this.#cardErrors;
    if (!isLocalId(id) && isCardInstance(item)) {
      this.#idResolver.addIdPair(item[localIdSymbol], id);
    } else if (!isLocalId(id)) {
      let maybeLocalId = id.split('/').pop()!;
      let item = cardBucket.get(maybeLocalId) ?? errorBucket.get(maybeLocalId);
      if (item) {
        this.#idResolver.addIdPair(maybeLocalId, id);
      }
    }
    let instance = isCardInstance(item) ? item : undefined;
    let error = !isCardInstance(item) ? item : undefined;
    if (error && !isLocalId(id) && error.id && isLocalId(error.id)) {
      this.#idResolver.addIdPair(error.id, id);
    }
    let localId = isLocalId(id) ? id : undefined;
    let remoteIds = !isLocalId(id) ? [id] : [];
    if (localId) {
      remoteIds = this.#idResolver.getRemoteIds(localId);
    }
    if (remoteIds.length > 0) {
      localId =
        (instance ? instance[localIdSymbol] : undefined) ??
        this.#idResolver.getLocalId(remoteIds[0]);

      let maybeOldLocalId = remoteIds[0].split('/').pop()!;
      errorBucket.delete(maybeOldLocalId);
    }

    if (localId) {
      this.#gcCandidates.delete(localId);
    }

    // make entries for both the local ID and the remote ID in the identity map
    if (instance) {
      // instances always have a local ID
      setIfDifferent(cardBucket, localId!, instance);
      errorBucket.delete(localId!);
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

  private hasReferences(localId: string): boolean {
    let referenceCount = this.#referenceCount.get(localId) ?? 0;
    for (let remoteId of this.#idResolver.getRemoteIds(localId)) {
      referenceCount += this.#referenceCount.get(remoteId) ?? 0;
    }
    return referenceCount > 0;
  }

  private makeConsumptionGraph(api: typeof CardAPI): InstanceGraph {
    let consumptionGraph: InstanceGraph = new Map();
    for (let instance of this.#cards.values()) {
      if (!instance) {
        continue;
      }
      let deps = getDeps(api, instance);
      for (let dep of deps) {
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
    for (let instance of this.#cards.values()) {
      if (!instance) {
        continue;
      }
      let deps = getDeps(api, instance);
      dependencyGraph.set(
        instance[localIdSymbol],
        new Set(deps.map((d) => d[localIdSymbol])),
      );
    }
    return dependencyGraph;
  }

  getSearchResource<T extends CardDef = CardDef>(
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

export function getDeps(api: typeof CardAPI, instance: CardDef): CardDef[] {
  let fields = api.getFields(
    Reflect.getPrototypeOf(instance)!.constructor as typeof CardDef,
    { includeComputeds: true },
  );
  let deps: CardDef[] = [];
  for (let [fieldName, field] of Object.entries(fields)) {
    let value = (instance as any)[fieldName];
    if (isPrimitive(field.card) || !value || typeof value !== 'object') {
      continue;
    }
    deps.push(...findCardInstances(value));
  }
  return deps;
}

function findCardInstances(obj: object): CardDef[] {
  if (isCardInstance(obj)) {
    return [obj];
  }
  if (Array.isArray(obj)) {
    return obj.reduce((acc, item) => acc.concat(findCardInstances(item)), []);
  }
  if (obj && typeof obj === 'object') {
    return Object.values(obj).reduce(
      (acc, value) => acc.concat(findCardInstances(value)),
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
