import { registerDestructor } from '@ember/destroyable';
import { service } from '@ember/service';

import { tracked } from '@glimmer/tracking';

import { Resource } from 'ember-resources';

import isEqual from 'lodash/isEqual';

import { isCardInstance } from '@cardstack/runtime-common';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import type StoreService from '../services/store';

interface Args {
  named: {
    ids: string[] | undefined;
  };
}

export class CardCollectionResource<
  T extends CardDef = CardDef,
> extends Resource<Args> {
  #ids: string[] | undefined;
  @tracked isLoaded = false;
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
      (async () => {
        this.isLoaded = false;
        await this.store.flush();
        this.isLoaded = true;
      })();
    }
    registerDestructor(this, () => {
      for (let id of this.#ids ?? []) {
        this.store.dropReference(id);
      }
    });
  }

  get cards() {
    return (this.#ids ?? [])
      .map((id) => this.store.peek(id))
      .filter((i) => isCardInstance(i)) as T[];
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
