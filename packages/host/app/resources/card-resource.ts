// the name of this file is annoying, we name it card-resource because when
// named 'card.ts' the browser sourcemap conflates this module with the card
// controller, also named 'card.ts'.

import { registerDestructor } from '@ember/destroyable';
import { service } from '@ember/service';

import { Resource } from 'ember-modify-based-class-resource';

import { isCardInstance } from '@cardstack/runtime-common';

import type StoreService from '../services/store';

interface Args {
  named: {
    id: string | undefined;
  };
}

export class CardResource extends Resource<Args> {
  #id: string | undefined;
  #hasRegisteredDestructor = false;
  @service declare private store: StoreService;

  modify(_positional: never[], named: Args['named']) {
    let { id } = named;
    if (id !== this.#id) {
      if (this.#id) {
        this.store.dropReference(this.#id);
      }
      this.#id = id;
      this.store.addReference(this.#id);
    }
    if (!this.#hasRegisteredDestructor) {
      this.#hasRegisteredDestructor = true;
      registerDestructor(this, () => {
        if (this.#id) {
          this.store.dropReference(this.#id);
        }
      });
    }
  }

  // Note that this will return a stale instance when the server state for this
  // id becomes an error. use this.cardError to see the live server state for
  // this instance.
  get card() {
    if (!this.#id) {
      return undefined;
    }
    let maybeCard = this.store.peek(this.#id);
    return maybeCard && isCardInstance(maybeCard) ? maybeCard : undefined;
  }

  get cardError() {
    if (!this.#id) {
      return undefined;
    }
    let maybeError = this.store.peekError(this.#id);
    return maybeError && !isCardInstance(maybeError) ? maybeError : undefined;
  }

  get id() {
    return this.#id;
  }

  get isLoaded() {
    if (!this.#id) {
      return false;
    }
    return Boolean(this.store.peek(this.#id));
  }

  get autoSaveState() {
    if (!this.#id) {
      return undefined;
    }
    return this.store.getSaveState(this.#id);
  }
}

// WARNING! please don't import this directly into your component's module.
// Rather please instead use:
// ```
//   import { consume } from 'ember-provide-consume-context';
//   import { type getCard, GetCardContextName } from '@cardstack/runtime-common';
//    ...
//   @consume(GetCardContextName) private declare getCard: getCard;
// ```
// If you need to use `getCard()` in something that is not a Component, then
// let's talk.
export function getCard(parent: object, id: () => string | undefined) {
  return CardResource.from(parent, () => ({
    named: {
      id: id(),
    },
  }));
}
