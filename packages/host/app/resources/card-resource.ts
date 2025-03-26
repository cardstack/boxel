// the name of this file is annoying, we name it card-resource because when
// named 'card.ts' the browser sourcemap conflates this module with the card
// controller, also named 'card.ts'.

import { registerDestructor, destroy } from '@ember/destroyable';
import { getOwner } from '@ember/owner';
import { buildWaiter } from '@ember/test-waiters';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';

import { Resource } from 'ember-resources';

import { type LooseSingleCardDocument } from '@cardstack/runtime-common';

import type { CardDef } from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';

import { type CardError } from '../services/store';

import { asURL } from '../services/store';

import type CardService from '../services/card-service';

import type StoreService from '../services/store';

let waiter = buildWaiter('card-resource');

interface Args {
  named: {
    // using string type here so that URL's that have the same href but are
    // different instances don't result in re-running the resource
    urlOrDoc: string | LooseSingleCardDocument | undefined;
    isLive: boolean;

    // TODO the fact this is not always constructed in a container is super
    // problematic since only components should be consuming this. After we have
    // refactored this so that it is not consumed by things outside of a
    // container, then start injecting our services instead of passing them in.

    // this is not always constructed within a container so we pass in our
    // services
    storeService: StoreService;
    cardService: CardService;
    relativeTo?: URL;
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
        urlOrDoc: string | LooseSingleCardDocument | undefined;
        relativeTo: URL | undefined;
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
    let {
      urlOrDoc,
      isLive,
      isAutoSaved,
      storeService,
      cardService,
      relativeTo,
    } = named;
    this.store = storeService;
    this.cardService = cardService;
    this.#url = urlOrDoc ? asURL(urlOrDoc) : undefined;
    this.#isLive = isLive;
    this.#isAutoSaved = isAutoSaved;

    if (
      urlOrDoc !== this._loading?.urlOrDoc ||
      relativeTo !== this._loading?.relativeTo
    ) {
      this._loading = {
        promise: this.load.perform(urlOrDoc, relativeTo),
        urlOrDoc,
        relativeTo,
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

  // if there was an error creating a card, then we won't have a URL
  async getNewCardURL(): Promise<string | undefined> {
    if (this.url) {
      return this.url;
    }
    await this._loading?.promise;
    return this.url;
  }

  private load = restartableTask(
    async (
      urlOrDoc: string | LooseSingleCardDocument | undefined,
      relativeTo?: URL,
    ) => {
      let url: string | undefined;
      let card: CardDef | undefined;
      let error: CardError | undefined;

      let token = waiter.beginAsync();
      try {
        if (urlOrDoc) {
          this.#api = await this.cardService.getAPI();
          ({ url, card, error } = await this.store.createSubscriber({
            resource: this,
            urlOrDoc,
            relativeTo,
            isAutoSaved: this.isAutoSaved,
            isLive: this.isLive,
            setCard: (card) => {
              if (card !== this.card) {
                this._card = card;
              }
            },
            setCardError: (error) => (this._error = error),
          }));
        }
        this.#url = url;
        this._card = card;
        this._error = error;
        this._isLoaded = true;
      } finally {
        waiter.endAsync(token);
      }
    },
  );

  // TODO refactor this out
  get api() {
    if (!this.#api) {
      throw new Error(
        `API hasn't been loaded yet in CardResource--await this.loaded()`,
      );
    }
    return this.#api;
  }

  // There are scenarios where we have a resource and we literally don't care
  // about the life time because we need to grab a property off of it (like
  // using a Spec when creating a new card). in that case we can throw away the
  // resource and just get the underlying card. This means that the card will
  // now be detached from the store.
  async detachFromStore() {
    await this._loading?.promise;
    try {
      return this.card ?? this.cardError;
    } finally {
      destroy(this);
    }
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
  urlOrDoc: () => string | LooseSingleCardDocument | undefined,
  opts?: {
    relativeTo?: URL; // used for new cards
    isLive?: boolean;
    isAutoSaved?: boolean;
  },
) {
  return CardResource.from(parent, () => ({
    named: {
      urlOrDoc: urlOrDoc(),
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
