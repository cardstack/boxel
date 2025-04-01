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
  ) {}

  get(url: string): CardDef | undefined {
    let instance = this.#cards.get(url)?.card;
    this.#gcCandidates.delete(url);
    return instance;
  }

  set(url: string, instance: CardDef | undefined): void {
    if (instance) {
      this.#gcCandidates.delete(url);
    }
    this.#cards.set(url, { card: instance });
  }

  delete(url: string): void {
    this.#cards.delete(url);
    this.#gcCandidates.delete(url);
  }

  reset() {
    for (let url of this.#cards.keys()) {
      this.#cards.set(url, { card: undefined });
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
      if (this.gcVisit(instance.id, consumptionGraph)) {
        if (this.#gcCandidates.has(instance.id)) {
          console.log(`garbage collecting instance ${instance.id} from store`);
          // brand the instance to make it easier for debugging
          (instance as unknown as any).__instance_detached_from_store = true;
          this.delete(instance.id);
        } else {
          this.#gcCandidates.add(instance.id);
        }
      } else {
        this.#gcCandidates.delete(instance.id);
      }
    }
  }

  gcVisit(
    id: string,
    consumptionGraph: Map<string, string[]>,
    hasSubscribers = new Map<string, boolean>(),
  ): boolean {
    let cached = hasSubscribers.get(id);
    if (cached !== undefined) {
      return cached;
    }

    let subscribers = this.subscribers.get(id);
    if (subscribers && subscribers.resources.length > 0) {
      hasSubscribers.set(id, true);
      return false;
    }
    let consumers = consumptionGraph.get(id);
    if (!consumers || consumers.length === 0) {
      hasSubscribers.set(id, false);
      return true;
    }

    let result = consumers
      .map((c) => this.gcVisit(c, consumptionGraph, hasSubscribers))
      .some((result) => result);
    hasSubscribers.set(id, result);
    return result;
  }

  private makeConsumptionGraph(): Map<string, string[]> {
    let consumptionGraph = new Map<string, string[]>();
    for (let { card: instance } of this.#cards.values()) {
      if (!instance) {
        continue;
      }
      let deps = getDeps(this.api, instance);
      for (let dep of deps) {
        let consumers = consumptionGraph.get(dep.id);
        if (!consumers) {
          consumers = [];
          consumptionGraph.set(dep.id, consumers);
        }
        consumers.push(instance.id);
      }
    }
    return consumptionGraph;
  }
}

function getDeps(api: typeof CardAPI, instance: CardDef): CardDef[] {
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
