import { registerDestructor } from '@ember/destroyable';
import { service } from '@ember/service';
import { buildWaiter } from '@ember/test-waiters';

import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';

import { Resource } from 'ember-resources';

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
  private _cards = new TrackedArray<T>();
  private _cardErrors = new TrackedArray<CardError>();
  @tracked private _isLoaded = false;
  @service declare private store: StoreService;

  modify(_positional: never[], named: Args['named']) {
    let { ids } = named;
    if (!isEqual(ids, this.#ids)) {
      if (this.#ids) {
        for (let id of this.#ids) {
          this.store.dropReference(id);
        }
      }
      this.#ids = ids;
      for (let id of this.#ids ?? []) {
        this.store.addReference(id);
      }
      this.load.perform();
    }
    registerDestructor(this, () => {
      for (let id of this.#ids ?? []) {
        this.store.dropReference(id);
      }
    });
  }

  private load = restartableTask(async () => {
    let token = waiter.beginAsync();
    try {
      // await a micro task to prevent isLoaded from being read and set in same frame
      await Promise.resolve();
      this._isLoaded = false;
      if (!this.#ids || this.#ids.length === 0) {
        this.cards.splice(0);
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
