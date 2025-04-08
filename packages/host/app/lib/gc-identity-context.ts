import { isPrimitive, isCardInstance } from '@cardstack/runtime-common';

import {
  type CardDef,
  type IdentityContext,
} from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';

export default class IdentityContextWithGarbageCollection
  implements IdentityContext
{
  #cards = new Map<
    string,
    {
      card: CardDef | undefined;
    }
  >();
  #gcCandidates: Set<string> = new Set();

  constructor(
    private api: typeof CardAPI,
    private subscribers: Map<string, { resources: unknown[] }>,
    private localIds: Map<string, string | null>,
  ) {}

  get(id: string): CardDef | undefined {
    let instance = this.#cards.get(id)?.card;
    let remoteId = this.localIds.get(id);
    this.#gcCandidates.delete(id);
    if (remoteId && !instance) {
      instance = this.#cards.get(remoteId)?.card;
      this.#gcCandidates.delete(remoteId);
    }
    return instance;
  }

  set(id: string, instance: CardDef | undefined): void {
    if (instance) {
      this.#gcCandidates.delete(id);
      this.#gcCandidates.delete(instance[this.api.localId]);
    }
    this.#cards.set(id, { card: instance });
  }

  delete(id: string): void {
    this.#cards.delete(id);
    this.#gcCandidates.delete(id);
    let remoteId = this.localIds.get(id);
    if (remoteId) {
      this.#cards.delete(remoteId);
      this.#gcCandidates.delete(remoteId);
    }
  }

  reset() {
    for (let id of this.#cards.keys()) {
      this.#cards.set(id, { card: undefined });
    }
    this.#gcCandidates.clear();
  }

  get gcCandidates() {
    return [...this.#gcCandidates];
  }

  sweep() {
    let consumptionGraph = this.makeConsumptionGraph();
    for (let { card: instance } of this.#cards.values()) {
      if (!instance) {
        continue;
      }
      if (this.gcVisit(instance[this.api.localId], consumptionGraph)) {
        if (this.#gcCandidates.has(instance[this.api.localId])) {
          console.log(
            `garbage collecting instance ${instance[this.api.localId]} (remote id: ${instance.id}) from store`,
          );
          // brand the instance to make it easier for debugging
          (instance as unknown as any)[
            Symbol.for('__instance_detached_from_store')
          ] = true;
          this.delete(instance[this.api.localId]);
        } else {
          this.#gcCandidates.add(instance[this.api.localId]);
        }
      } else {
        this.#gcCandidates.delete(instance[this.api.localId]);
      }
    }
  }

  gcVisit(
    localId: string,
    consumptionGraph: Map<string, string[]>,
    hasSubscribers = new Map<string, boolean>(),
  ): boolean /* true = eligible for GC, false = not eligible for GC */ {
    let remoteId = this.localIds.get(localId);
    if (!remoteId) {
      // TODO how to subscribe to card with no remote id?
      return true;
    }
    let cached = hasSubscribers.get(remoteId);
    if (cached !== undefined) {
      return cached;
    }

    let subscribers = this.subscribers.get(remoteId);
    if (subscribers && subscribers.resources.length > 0) {
      hasSubscribers.set(remoteId, true);
      return false;
    }
    let consumers = consumptionGraph.get(localId);
    if (!consumers || consumers.length === 0) {
      hasSubscribers.set(remoteId, false);
      return true;
    }

    let result = consumers
      .map((c) => this.gcVisit(c, consumptionGraph, hasSubscribers))
      .some((result) => result);
    hasSubscribers.set(remoteId, result);
    return result;
  }

  // this consumption graph uses local ID's
  private makeConsumptionGraph(): Map<string, string[]> {
    let consumptionGraph = new Map<string, string[]>();
    for (let { card: instance } of this.#cards.values()) {
      if (!instance) {
        continue;
      }
      let deps = getDeps(this.api, instance);
      for (let dep of deps) {
        let consumers = consumptionGraph.get(dep[this.api.localId]);
        if (!consumers) {
          consumers = [];
          consumptionGraph.set(dep[this.api.localId], consumers);
        }
        consumers.push(instance[this.api.localId]);
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
