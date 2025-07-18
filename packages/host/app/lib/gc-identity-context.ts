import { TrackedMap } from 'tracked-built-ins';

import {
  isPrimitive,
  isCardInstance,
  isNotLoadedError,
  isLocalId,
  localId as localIdSymbol,
  type CardErrorJSONAPI as CardError,
} from '@cardstack/runtime-common';

import {
  type CardDef,
  type IdentityContext,
} from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';

const ELIGIBLE_FOR_GC = true;
const NOT_ELIGIBLE_FOR_GC = false;

export type ReferenceCount = Map<string, number>;

type LocalId = string;
type InstanceGraph = Map<LocalId, Set<LocalId>>;

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

export default class IdentityContextWithGarbageCollection
  implements IdentityContext
{
  // importantly these properties are not tracked so that we are able
  // to deserialize an instance without glimmer rendering the inner workings of
  // the deserialization process.
  #nonTrackedCards = new Map<string, CardDef>();
  #nonTrackedCardErrors = new Map<string, CardError>();

  #cards = new TrackedMap<string, CardDef>();
  #cardErrors = new TrackedMap<string, CardError>();
  #gcCandidates: Set<LocalId> = new Set();
  #referenceCount: ReferenceCount;
  #idResolver = new IDResolver();

  constructor(referenceCount: ReferenceCount) {
    this.#referenceCount = referenceCount;
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

  addInstanceOrError(id: string, instanceOrError: CardDef | CardError) {
    this.setItem(id, instanceOrError);
    if (!isCardInstance(instanceOrError)) {
      this.#idResolver.removeByRemoteId(id);
    }
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
    this.#nonTrackedCards.clear();
    this.#gcCandidates.clear();
    this.#idResolver.reset();
  }

  get gcCandidates() {
    return [...this.#gcCandidates];
  }

  sweep(api: typeof CardAPI) {
    let consumptionGraph = this.makeConsumptionGraph(api);
    let cache = new Map<string, boolean>();
    let visited = new WeakSet<CardDef>();
    for (let instance of this.#cards.values()) {
      if (!instance) {
        continue;
      }
      if (visited.has(instance)) {
        continue;
      }
      visited.add(instance);
      if (
        this.isEligibleForGC(instance[localIdSymbol], consumptionGraph, cache)
      ) {
        if (this.#gcCandidates.has(instance[localIdSymbol])) {
          console.log(
            `garbage collecting instance ${instance[localIdSymbol]} (remote id: ${instance.id}) from store`,
          );
          // brand the instance to make it easier for debugging
          (instance as unknown as any)[
            Symbol.for('__instance_detached_from_store')
          ] = true;
          this.delete(instance[localIdSymbol]);
          if (instance.id) {
            this.delete(instance.id);
          }
        } else {
          console.debug(
            `instance [local id:${instance[localIdSymbol]} remote id: ${instance.id}] is now eligible for garbage collection`,
          );
          this.#gcCandidates.add(instance[localIdSymbol]);
        }
      } else {
        this.#gcCandidates.delete(instance[localIdSymbol]);
      }
    }
  }

  makeTracked(remoteId: string) {
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
    this.#cards.delete(id);
    this.#cardErrors.delete(id);
    this.#nonTrackedCards.delete(id);
    this.#nonTrackedCardErrors.delete(id);
  }

  private getItem(type: 'instance', id: string): CardDef | undefined;
  private getItem(type: 'error', id: string): CardError | undefined;
  private getItem(
    type: 'instance' | 'error',
    id: string,
  ): CardDef | CardError | undefined {
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
    let item: CardDef | CardError | undefined;
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

  private setItem(id: string, item: CardDef | CardError, notTracked?: true) {
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

  private isEligibleForGC(
    localId: string,
    consumptionGraph: InstanceGraph,
    cache: Map<LocalId, boolean>,
  ): boolean {
    let remoteIds = this.#idResolver.getRemoteIds(localId);
    let cached = cache.get(localId);
    if (cached !== undefined) {
      return cached;
    }

    let referenceCount =
      remoteIds.reduce(
        (sum, id) => sum + (this.#referenceCount.get(id) ?? 0),
        0,
      ) + (localId ? (this.#referenceCount.get(localId) ?? 0) : 0);
    if (referenceCount > 0) {
      cache.set(localId, NOT_ELIGIBLE_FOR_GC);
      return NOT_ELIGIBLE_FOR_GC;
    }
    let consumers = consumptionGraph.get(localId);
    if (!consumers || consumers.size === 0) {
      cache.set(localId, ELIGIBLE_FOR_GC);
      return ELIGIBLE_FOR_GC;
    }

    // you are eligible for GC if all your consumers are also eligible for GC
    let result = [...consumers]
      .map((c) => this.isEligibleForGC(c, consumptionGraph, cache))
      .every((result) => result);
    cache.set(localId, result);
    return result;
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
}

export function getDeps(api: typeof CardAPI, instance: CardDef): CardDef[] {
  let fields = api.getFields(
    Reflect.getPrototypeOf(instance)!.constructor as typeof CardDef,
    { includeComputeds: true },
  );
  let deps: CardDef[] = [];
  for (let [fieldName, field] of Object.entries(fields)) {
    let value: any;
    try {
      value = (instance as any)[fieldName];
    } catch (e) {
      if (isNotLoadedError(e)) {
        continue;
      }
      throw e;
    }
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
