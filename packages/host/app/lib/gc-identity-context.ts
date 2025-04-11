import { TrackedMap } from 'tracked-built-ins';

import {
  isPrimitive,
  isCardInstance,
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

export default class IdentityContextWithGarbageCollection
  implements IdentityContext
{
  #cards = new TrackedMap<string, CardDef>();
  #cardErrors = new TrackedMap<string, CardError>();
  #gcCandidates: Set<LocalId> = new Set();
  #api: typeof CardAPI;
  #referenceCount: ReferenceCount;
  #localIds: Map<string, string | null>;

  constructor({
    api,
    referenceCount,
    localIds,
  }: {
    api: typeof CardAPI;
    referenceCount: ReferenceCount;
    localIds: Map<string, string | null>;
  }) {
    this.#api = api;
    this.#referenceCount = referenceCount;
    this.#localIds = localIds;
  }

  get(id: string): CardDef | undefined {
    return this.getItem('instance', id);
  }

  set(id: string, instance: CardDef): void {
    this.setItem(id, instance);
  }

  addInstanceOrError(id: string, instanceOrError: CardDef | CardError) {
    this.setItem(id, instanceOrError);
  }

  getInstanceOrError(id: string) {
    return this.getItem('instance', id) ?? this.getItem('error', id);
  }

  delete(id: string): void {
    this.#cards.delete(id);
    this.#cardErrors.delete(id);
    this.#gcCandidates.delete(id);
    let [localId] =
      [...this.#localIds.entries()].find(([_local, remote]) => remote === id) ??
      [];
    if (localId) {
      this.#cards.delete(localId);
      this.#cardErrors.delete(localId);
      this.#gcCandidates.delete(localId);
    }
  }

  reset() {
    this.#cards.clear();
    this.#cardErrors.clear();
    this.#gcCandidates.clear();
  }

  get gcCandidates() {
    return [...this.#gcCandidates];
  }

  sweep() {
    let consumptionGraph = this.makeConsumptionGraph();
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
        this.isEligibleForGC(
          instance[this.#api.localId],
          consumptionGraph,
          cache,
        )
      ) {
        if (this.#gcCandidates.has(instance[this.#api.localId])) {
          console.log(
            `garbage collecting instance ${instance[this.#api.localId]} (remote id: ${instance.id}) from store`,
          );
          // brand the instance to make it easier for debugging
          (instance as unknown as any)[
            Symbol.for('__instance_detached_from_store')
          ] = true;
          this.delete(instance[this.#api.localId]);
          if (instance.id) {
            this.delete(instance.id);
          }
        } else {
          this.#gcCandidates.add(instance[this.#api.localId]);
        }
      } else {
        this.#gcCandidates.delete(instance[this.#api.localId]);
      }
    }
  }

  private getItem(type: 'instance', id: string): CardDef | undefined;
  private getItem(type: 'error', id: string): CardError | undefined;
  private getItem(
    type: 'instance' | 'error',
    id: string,
  ): CardDef | CardError | undefined {
    let bucket = type === 'instance' ? this.#cards : this.#cardErrors;
    let item = bucket.get(id);
    let remoteId = this.#localIds.get(id);
    if (!item && remoteId) {
      item = bucket.get(remoteId);
    }
    if (item && isLocalId(id)) {
      this.#gcCandidates.delete(id);
    } else if (item && id === item.id) {
      let [localId] =
        [...this.#localIds.entries()].find(
          ([_local, remote]) => remote === id,
        ) ?? [];
      if (localId) {
        this.#gcCandidates.delete(localId);
      }
    }
    return item ?? undefined;
  }

  private setItem(id: string, item: CardDef | CardError) {
    let instance = isCardInstance(item) ? item : undefined;
    let error = !isCardInstance(item) ? item : undefined;
    let localId: string | undefined;

    if (instance) {
      localId = instance[this.#api.localId];
    } else if (error) {
      localId = ([...this.#localIds.entries()].find(
        ([_local, remote]) => remote === id,
      ) ?? [])[0];
    }

    if (item) {
      this.#gcCandidates.delete(id);
      if (localId) {
        this.#gcCandidates.delete(localId);
      }
    }

    // make entries for both the local ID and the remote ID in the identity map
    if (instance) {
      this.#cards.set(id, instance);
      this.#cardErrors.delete(id);
      if (item && id === localId) {
        this.#cards.set(instance.id, instance);
        this.#cardErrors.delete(instance.id);
      } else if (instance && id === instance.id) {
        this.#cards.set(instance[this.#api.localId], instance);
        this.#cardErrors.delete(instance[this.#api.localId]);
      }
    }

    if (error) {
      this.#cardErrors.set(id, error);
      this.#cards.delete(id);
      let remoteId = this.#localIds.get(id);
      if (isLocalId(id) && remoteId) {
        this.#cardErrors.set(remoteId, error);
        this.#cards.delete(remoteId);
      } else if (!isLocalId(id) && localId) {
        this.#cardErrors.set(localId, error);
        this.#cards.delete(localId);
      }
    }
  }

  private isEligibleForGC(
    localId: string,
    consumptionGraph: InstanceGraph,
    cache: Map<LocalId, boolean>,
  ): boolean {
    let remoteId = this.#localIds.get(localId);
    let cached = cache.get(localId);
    if (cached !== undefined) {
      return cached;
    }

    let referenceCount =
      (remoteId ? (this.#referenceCount.get(remoteId) ?? 0) : 0) +
      (localId ? (this.#referenceCount.get(localId) ?? 0) : 0);
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

  private makeConsumptionGraph(): InstanceGraph {
    let consumptionGraph: InstanceGraph = new Map();
    for (let instance of this.#cards.values()) {
      if (!instance) {
        continue;
      }
      let deps = getDeps(this.#api, instance);
      for (let dep of deps) {
        let consumers = consumptionGraph.get(dep[this.#api.localId]);
        if (!consumers) {
          consumers = new Set();
          consumptionGraph.set(dep[this.#api.localId], consumers);
        }
        consumers.add(instance[this.#api.localId]);
      }
    }
    return consumptionGraph;
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

function isLocalId(id: string) {
  return !id.startsWith('http');
}
