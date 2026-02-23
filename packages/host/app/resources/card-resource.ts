// the name of this file is annoying, we name it card-resource because when
// named 'card.ts' the browser sourcemap conflates this module with the card
// controller, also named 'card.ts'.

import { registerDestructor } from '@ember/destroyable';
import { service } from '@ember/service';

import { Resource } from 'ember-modify-based-class-resource';

import { isCardInstance, isFileDefInstance } from '@cardstack/runtime-common';

import type { StoreReadType } from '@cardstack/runtime-common';

import type { BaseDef } from 'https://cardstack.com/base/card-api';

import type StoreService from '../services/store';

interface Args {
  named: {
    id: string | undefined;
    type?: StoreReadType;
  };
}

export class CardResource extends Resource<Args> {
  #id: string | undefined;
  #type: StoreReadType | undefined;
  #hasRegisteredDestructor = false;
  #hasReference = false;
  @service declare private store: StoreService;

  modify(_positional: never[], named: Args['named']) {
    let { id, type } = named;
    if (id !== this.#id || type !== this.#type) {
      this.dropReferenceIfHeld();
      this.#id = id;
      this.#type = type;
      if (this.#id) {
        this.store.addReference(this.#id, { type: this.#type });
        this.#hasReference = true;
      }
    }
    if (!this.#hasRegisteredDestructor) {
      this.#hasRegisteredDestructor = true;
      registerDestructor(this, () => {
        this.dropReferenceIfHeld();
      });
    }
  }

  private dropReferenceIfHeld() {
    if (this.#id && this.#hasReference) {
      this.store.dropReference(this.#id);
      this.#hasReference = false;
    }
  }

  private get readType(): StoreReadType {
    return this.#type ?? 'card';
  }

  private get fallbackReadType(): StoreReadType {
    return this.readType === 'file-meta' ? 'card' : 'file-meta';
  }

  private peekForType(type: StoreReadType): unknown {
    if (!this.#id) {
      return undefined;
    }
    return type === 'file-meta'
      ? (this.store.peek(this.#id, { type: 'file-meta' }) as unknown)
      : (this.store.peek(this.#id) as unknown);
  }

  private peekErrorForType(type: StoreReadType) {
    if (!this.#id) {
      return undefined;
    }
    return type === 'file-meta'
      ? this.store.peekError(this.#id, { type: 'file-meta' })
      : this.store.peekError(this.#id);
  }

  // Note that this will return a stale instance when the server state for this
  // id becomes an error. use this.cardError to see the live server state for
  // this instance.
  get card(): BaseDef | undefined {
    if (!this.#id) {
      return undefined;
    }
    let maybeCard =
      this.peekForType(this.readType) ??
      this.peekForType(this.fallbackReadType);
    return isCardInstance(maybeCard) || isFileDefInstance(maybeCard)
      ? (maybeCard as BaseDef)
      : undefined;
  }

  get cardError() {
    if (!this.#id) {
      return undefined;
    }

    let primaryError = this.peekErrorForType(this.readType);
    if (primaryError && !isCardInstance(primaryError)) {
      return primaryError;
    }

    let primaryInstance = this.peekForType(this.readType);
    if (this.readType === 'card' && isCardInstance(primaryInstance)) {
      return undefined;
    }
    if (this.readType === 'file-meta' && isFileDefInstance(primaryInstance)) {
      return undefined;
    }

    let maybeError = this.peekErrorForType(this.fallbackReadType);
    return maybeError && !isCardInstance(maybeError) ? maybeError : undefined;
  }

  get id() {
    return this.#id;
  }

  get isLoaded() {
    if (!this.#id) {
      return false;
    }
    let maybeInstanceOrError =
      this.peekForType(this.readType) ??
      this.peekForType(this.fallbackReadType);
    return Boolean(maybeInstanceOrError);
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
export function getCard(
  parent: object,
  id: () => string | undefined,
  opts?: { type?: StoreReadType },
) {
  return CardResource.from(parent, () => ({
    named: {
      id: id(),
      type: opts?.type,
    },
  }));
}
