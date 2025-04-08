import { isPrimitive, isCardInstance } from '@cardstack/runtime-common';

import {
  type CardDef,
  type IdentityContext,
} from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';

const ELIGIBLE_FOR_GC = true;
const NOT_ELIGIBLE_FOR_GC = false;

export type Subscriber = Map<string, { resources: unknown[] }>;

export default class IdentityContextWithGarbageCollection
  implements IdentityContext
{
  #cards = new Map<string, CardDef | null>();
  #gcCandidates: Set<string> = new Set(); // this is a set of local id's
  #api: typeof CardAPI;
  #remoteIdSubscribers: Subscriber;
  #localIdSubscribers: Subscriber;
  #localIds: Map<string, string | null>;

  constructor({
    api,
    remoteIdSubscribers,
    localIdSubscribers,
    localIds,
  }: {
    api: typeof CardAPI;
    remoteIdSubscribers: Subscriber;
    localIdSubscribers: Subscriber;
    localIds: Map<string, string | null>;
  }) {
    this.#api = api;
    this.#remoteIdSubscribers = remoteIdSubscribers;
    this.#localIdSubscribers = localIdSubscribers;
    this.#localIds = localIds;
  }

  get(id: string): CardDef | undefined {
    let instance = this.#cards.get(id);
    let remoteId = this.#localIds.get(id);
    if (!instance && remoteId) {
      instance = this.#cards.get(remoteId);
    }

    if (instance && id === instance[this.#api.localId]) {
      this.#gcCandidates.delete(id);
    } else if (instance && id === instance.id) {
      let [localId] =
        [...this.#localIds.entries()].find(
          ([_local, remote]) => remote === id,
        ) ?? [];
      if (localId) {
        this.#gcCandidates.delete(localId);
      }
    }
    return instance ?? undefined;
  }

  set(id: string, instance: CardDef | null): void {
    if (instance) {
      this.#gcCandidates.delete(id);
      this.#gcCandidates.delete(instance[this.#api.localId]);
    }
    // make entries for both the local ID and the remote ID in the identity map
    this.#cards.set(id, instance);
    if (instance && id === instance[this.#api.localId]) {
      this.#cards.set(instance.id, instance);
    } else if (instance && id === instance.id) {
      this.#cards.set(instance[this.#api.localId], instance);
    }
    if (!instance) {
      let [localId] =
        [...this.#localIds.entries()].find(
          ([_local, remote]) => remote === id,
        ) ?? [];
      if (localId) {
        this.#cards.set(localId, instance);
      }
    }
  }

  delete(id: string): void {
    this.#cards.delete(id);
    this.#gcCandidates.delete(id);
    let [localId] =
      [...this.#localIds.entries()].find(([_local, remote]) => remote === id) ??
      [];
    if (localId) {
      this.#cards.delete(localId);
      this.#gcCandidates.delete(localId);
    }
  }

  reset() {
    this.#cards.clear();
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
      if (this.gcVisit(instance[this.#api.localId], consumptionGraph, cache)) {
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

  gcVisit(
    localId: string,
    consumptionGraph: Map<string, Set<string>>,
    cache: Map<string, boolean>,
  ): boolean /* true = eligible for GC, false = not eligible for GC */ {
    let remoteId = this.#localIds.get(localId);
    let cached = cache.get(localId);
    if (cached !== undefined) {
      return cached;
    }

    let subscribers = [
      ...((remoteId
        ? this.#remoteIdSubscribers.get(remoteId)?.resources
        : undefined) ?? []),
      ...(this.#localIdSubscribers.get(localId)?.resources ?? []),
    ];
    if (subscribers.length > 0) {
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
      .map((c) => this.gcVisit(c, consumptionGraph, cache))
      .every((result) => result);
    cache.set(localId, result);
    return result;
  }

  // this consumption graph uses local ID's
  private makeConsumptionGraph(): Map<string, Set<string>> {
    let consumptionGraph = new Map<string, Set<string>>();
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
