// the name of this file is annoying, we name it card-resource because when
// named 'card.ts' the browser sourcemap conflates this module with the card
// controller, also named 'card.ts'.

import { registerDestructor } from '@ember/destroyable';
import { getOwner } from '@ember/owner';
import { tracked } from '@glimmer/tracking';

import { restartableTask, dropTask } from 'ember-concurrency';

import { Resource } from 'ember-resources';

import { type LooseSingleCardDocument } from '@cardstack/runtime-common';

import type { CardDef } from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';

import { type CardError } from '../services/store';

import { asURL } from '../services/store';

import type CardService from '../services/card-service';

import type StoreService from '../services/store';

interface Args {
  named: {
    // using string type here so that URL's that have the same href but are
    // different instances don't result in re-running the resource
    urlOrDoc: string | LooseSingleCardDocument | undefined;
    isLive: boolean;
    // this is not always constructed within a container so we pass in our services
    storeService: StoreService;
    cardService: CardService;
    relativeTo?: URL;
    isAutoSave: boolean;
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
  #isAutoSave = false;

  onCardInstanceChange?: (
    oldCard: CardDef | undefined,
    newCard: CardDef | undefined,
  ) => void;

  modify(_positional: never[], named: Args['named']) {
    let {
      urlOrDoc,
      isLive,
      isAutoSave,
      storeService,
      cardService,
      relativeTo,
    } = named;
    this.store = storeService;
    this.cardService = cardService;
    this.#url = urlOrDoc ? asURL(urlOrDoc) : undefined;
    this.#isLive = isLive;
    this.#isAutoSave = isAutoSave;

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

  get isAutoSave() {
    return this.#isAutoSave;
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

  private load = dropTask(
    async (
      urlOrDoc: string | LooseSingleCardDocument | undefined,
      relativeTo?: URL,
    ) => {
      let url: string | undefined;
      let card: CardDef | undefined;
      let error: CardError | undefined;

      if (urlOrDoc) {
        this.#api = await this.cardService.getAPI();
        ({ url, card, error } = await this.store.createSubscriber({
          resource: this,
          urlOrDoc,
          relativeTo,
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
}

export function getCard(
  parent: object,
  urlOrDoc: () => string | LooseSingleCardDocument | undefined,
  opts?: {
    relativeTo?: URL; // used for new cards
    isLive?: () => boolean;
    isAutoSave?: () => boolean;
  },
) {
  return CardResource.from(parent, () => ({
    named: {
      urlOrDoc: urlOrDoc(),
      isLive: opts?.isLive ? opts.isLive() : true,
      relativeTo: opts?.relativeTo,
      isAutoSave: opts?.isAutoSave ? opts.isAutoSave() : false,
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
