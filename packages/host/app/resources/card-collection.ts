import { registerDestructor } from '@ember/destroyable';
import { service } from '@ember/service';
import { buildWaiter } from '@ember/test-waiters';

import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';

import { Resource } from 'ember-modify-based-class-resource';

import isEqual from 'lodash/isEqual';

import { TrackedArray } from 'tracked-built-ins';

import {
  isCardInstance,
  type CardErrorJSONAPI as CardError,
} from '@cardstack/runtime-common';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import type StoreService from '../services/store';

interface Args {
  named: {
    ids: string[] | undefined;
  };
}

let waiter = buildWaiter('card-collection-resource');

export class CardCollectionResource<
  T extends CardDef = CardDef,
> extends Resource<Args> {
  #ids: string[] | undefined;
  #hasRegisteredDestructor = false;
  #referenceCounts = new Map<string, number>();
  private _cards = new TrackedArray<T>();
  private _cardErrors = new TrackedArray<CardError>();
  @tracked private _isLoaded = false;
  @service declare private store: StoreService;

  modify(_positional: never[], named: Args['named']) {
    let { ids } = named;
    let normalizedIds = ids ? [...ids] : undefined;
    if (!isEqual(normalizedIds, this.#ids)) {
      this.#ids = normalizedIds;
      this.reconcileReferences(normalizedIds);
      this.load.perform();
    }
    if (!this.#hasRegisteredDestructor) {
      this.#hasRegisteredDestructor = true;
      registerDestructor(this, () => {
        for (let [id, count] of this.#referenceCounts) {
          for (let i = 0; i < count; i++) {
            this.store.dropReference(id);
          }
        }
        this.#referenceCounts.clear();
      });
    }
  }

  private load = restartableTask(async () => {
    let token = waiter.beginAsync();
    try {
      // await a micro task to prevent isLoaded from being read and set in same frame
      await Promise.resolve();
      this._isLoaded = false;
      if (!this.#ids || this.#ids.length === 0) {
        this.cards.splice(0);
        this.cardErrors.splice(0);
      }
      await this.store.flush();
      this.cards.splice(
        0,
        this.cards.length,
        ...((this.#ids ?? [])
          .map((id) => this.store.peek(id))
          .filter((i) => isCardInstance(i)) as T[]),
      );
      this.cardErrors.splice(
        0,
        this.cards.length,
        ...((this.#ids ?? [])
          .map((id) => this.store.peek(id))
          .filter((i) => i && !isCardInstance(i)) as CardError[]),
      );
    } finally {
      waiter.endAsync(token);
      this._isLoaded = true;
    }
  });

  get cards() {
    return this._cards;
  }

  get cardErrors() {
    return this._cardErrors;
  }

  get isLoaded() {
    return this._isLoaded;
  }

  get ids() {
    return this.#ids;
  }

  private reconcileReferences(targetIds: string[] | undefined) {
    let targetCounts = this.countReferences(targetIds);

    for (let [id, currentCount] of this.#referenceCounts) {
      let targetCount = targetCounts.get(id) ?? 0;
      if (currentCount > targetCount) {
        this.dropReference(id, currentCount - targetCount);
      }
    }

    for (let [id, targetCount] of targetCounts) {
      let currentCount = this.#referenceCounts.get(id) ?? 0;
      if (targetCount > currentCount) {
        this.addReference(id, targetCount - currentCount);
      }
    }
  }

  private countReferences(ids: string[] | undefined) {
    let counts = new Map<string, number>();
    if (!ids) {
      return counts;
    }
    for (let id of ids) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }

  private addReference(id: string, count = 1) {
    if (!id || count <= 0) {
      return;
    }
    for (let i = 0; i < count; i++) {
      this.store.addReference(id);
    }
    this.#referenceCounts.set(id, (this.#referenceCounts.get(id) ?? 0) + count);
  }

  private dropReference(id: string, count = 1) {
    if (!id || count <= 0) {
      return;
    }
    let currentCount = this.#referenceCounts.get(id);
    if (!currentCount) {
      return;
    }
    for (let i = 0; i < Math.min(count, currentCount); i++) {
      this.store.dropReference(id);
    }
    let remaining = currentCount - count;
    if (remaining <= 0) {
      this.#referenceCounts.delete(id);
    } else {
      this.#referenceCounts.set(id, remaining);
    }
  }
}

// WARNING! please don't import this directly into your component's module.
// Rather please instead use:
// ```
//   import { consume } from 'ember-provide-consume-context';
//   import { type getCardCollection, GetCardCollectionContextName } from '@cardstack/runtime-common';
//    ...
//   @consume(GetCardCollectionContextName) private declare getCardCollection: getCardCollection;
// ```
// If you need to use `getCardCollection()` in something that is not a Component, then
// let's talk.
export function getCardCollection<T extends CardDef = CardDef>(
  parent: object,
  ids: () => string[] | undefined,
) {
  return CardCollectionResource.from(parent, () => ({
    named: {
      ids: ids(),
    },
  })) as CardCollectionResource<T>;
}
