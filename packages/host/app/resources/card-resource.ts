// the name of this file is annoying, we name it card-resource because when
// named 'card.ts' the browser sourcemap conflates this module with the card
// controller, also named 'card.ts'.

import { registerDestructor } from '@ember/destroyable';
import { getOwner } from '@ember/owner';
import { buildWaiter } from '@ember/test-waiters';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';

import { Resource } from 'ember-resources';

import type { CardDef } from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';

import { type CardError } from '../services/store';

import type CardService from '../services/card-service';

import type StoreService from '../services/store';

let waiter = buildWaiter('card-resource');

interface Args {
  named: {
    // using string type here so that URL's that have the same href but are
    // different instances don't result in re-running the resource
    url: string | undefined;
    isLive: boolean;

    // TODO the fact this is not always constructed in a container is super
    // problematic since only components should be consuming this. After we have
    // refactored this so that it is not consumed by things outside of a
    // container, then start injecting our services instead of passing them in.

    // this is not always constructed within a container so we pass in our
    // services
    storeService: StoreService;
    cardService: CardService;
    isAutoSaved: boolean;
  };
}

export class CardResource extends Resource<Args> {
  // we use a separate tracked property for the card instead of directly
  // punching thru to the store, since using a TrackedMap in the store's
  // IdentityContext would result in a Resource.modify() cycle as the
  // IdentityContext is mutated as part of loading the card.
  @tracked private _card: CardDef | undefined;
  // and just being symmetric with the card error as well
  @tracked private _error: CardError | undefined;
  @tracked private _isLoaded = false;
  private _loading:
    | {
        promise: Promise<void>;
        url: string | undefined;
      }
    | undefined;
  declare private store: StoreService;
  declare private cardService: CardService;
  #url: string | undefined;
  #isLive = false;
  #api: typeof CardAPI | undefined;
  #isAutoSaved = false;

  onCardInstanceChange?: (
    oldCard: CardDef | undefined,
    newCard: CardDef | undefined,
  ) => void;

  modify(_positional: never[], named: Args['named']) {
    let { url, isLive, isAutoSaved, storeService, cardService } = named;
    if (!url) {
      return;
    }

    this.store = storeService;
    this.cardService = cardService;
    this.#url = url;
    this.#isLive = isLive;
    this.#isAutoSaved = isAutoSaved;

    if (url !== this._loading?.url) {
      this._loading = {
        promise: this.load.perform(url),
        url,
      };
    }

    registerDestructor(this, () => {
      this.store.unloadResource(this);
    });
  }

  get isLive() {
    return this.#isLive;
  }

  get isAutoSaved() {
    return this.#isAutoSaved;
  }

  get card() {
    return this._card;
  }

  get url() {
    return this.#url;
  }

  get cardError() {
    return this._error;
  }

  get isLoaded() {
    return this._isLoaded;
  }

  get autoSaveState() {
    return this._card ? this.store.getAutoSaveState(this._card) : undefined;
  }

  // This is deprecated. consumers of this resource need to be reactive such
  // that they can deal with a resource that doesn't have a card yet.
  get loaded() {
    return this._loading?.promise;
  }

  private load = restartableTask(async (url: string) => {
    let card: CardDef | undefined;
    let error: CardError | undefined;

    let token = waiter.beginAsync();
    try {
      this.#api = await this.cardService.getAPI();
      ({ card, error } = await this.store.createSubscriber({
        resource: this,
        urlOrDoc: url,
        isAutoSaved: this.isAutoSaved,
        isLive: this.isLive,
        setCard: (card) => {
          if (card !== this.card) {
            this._card = card;
          }
        },
        setCardError: (error) => (this._error = error),
      }));
      this._loading = undefined;
      this.#url = url;
      this._card = card;
      this._error = error;
      this._isLoaded = true;
    } finally {
      waiter.endAsync(token);
    }
  });

  // TODO refactor this out
  get api() {
    if (!this.#api) {
      throw new Error(
        `API hasn't been loaded yet in CardResource--await this.loaded()`,
      );
    }
    return this.#api;
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
  url: () => string | undefined,
  opts?: {
    relativeTo?: URL; // used for new cards
    isLive?: boolean;
    isAutoSaved?: boolean;
  },
) {
  return CardResource.from(parent, () => ({
    named: {
      url: url(),
      isLive: opts?.isLive != null ? opts.isLive : true,
      relativeTo: opts?.relativeTo,
      isAutoSaved: opts?.isAutoSaved != null ? opts.isAutoSaved : false,
      storeService: (getOwner(parent) as any).lookup(
        'service:store',
      ) as StoreService,
      // TODO refactor this out
      cardService: (getOwner(parent) as any).lookup(
        'service:card-service',
      ) as CardService,
    },
  }));
}
