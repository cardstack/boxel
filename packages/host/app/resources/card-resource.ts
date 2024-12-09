// the name of this file is annoying, we name it card-resource because when
// named 'card.ts' the browser sourcemap conflates this module with the card
// controller, also named 'card.ts'.

import { registerDestructor } from '@ember/destroyable';
import { getOwner } from '@ember/owner';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';
import { task } from 'ember-concurrency';
import { Resource } from 'ember-resources';

import status from 'statuses';

import {
  Loader,
  isSingleCardDocument,
  apiFor,
  loaderFor,
  hasExecutableExtension,
} from '@cardstack/runtime-common';

import type MessageService from '@cardstack/host/services/message-service';

import type {
  CardDef,
  IdentityContext,
} from 'https://cardstack.com/base/card-api';

import type * as CardAPI from 'https://cardstack.com/base/card-api';

import type CardService from '../services/card-service';
import type LoaderService from '../services/loader-service';

export interface CardError {
  errors: {
    id: string;
    status: number;
    title: string;
    message: string;
    realm: string | undefined;
    meta: {
      lastKnownGoodHtml: string | null;
      scopedCssUrls: string[];
      stack: string | null;
    };
  }[];
}

interface Args {
  named: {
    // using string type here so that URL's that have the same href but are
    // different instances don't result in re-running the resource
    url: string | undefined;
    loader: Loader;
    isLive: boolean;
    // this is not always constructed within a container so we pass in our services
    cardService: CardService;
    messageService: MessageService;
    resetLoader: () => void;
    onCardInstanceChange?: (
      oldCard: CardDef | undefined,
      newCard: CardDef | undefined,
    ) => void;
  };
}

class LiveCardIdentityContext implements IdentityContext {
  #cards = new Map<
    string,
    {
      card: CardDef;
      subscribers: Set<object>;
    }
  >();

  get(url: string): CardDef | undefined {
    return this.#cards.get(url)?.card;
  }
  set(url: string, instance: CardDef): void {
    this.#cards.set(url, { card: instance, subscribers: new Set() });
  }
  delete(url: string): void {
    this.#cards.delete(url);
  }

  subscribers(url: string): Set<object> | undefined {
    return this.#cards.get(url)?.subscribers;
  }
}

const liveCards: WeakMap<Loader, LiveCardIdentityContext> = new WeakMap();
const realmSubscriptions: Map<
  string,
  WeakMap<CardResource, { unsubscribe: () => void }>
> = new Map();

export class CardResource extends Resource<Args> {
  url: string | undefined;
  @tracked loaded: Promise<void> | undefined;
  @tracked cardError: CardError['errors'][0] | undefined;
  @tracked private _card: CardDef | undefined;
  @tracked private _api: typeof CardAPI | undefined;
  @tracked private staleCard: CardDef | undefined;
  private declare cardService: CardService;
  private declare messageService: MessageService;
  private declare loaderService: LoaderService;
  private declare resetLoader: () => void;
  private _loader: Loader | undefined;
  private onCardInstanceChange?: (
    oldCard: CardDef | undefined,
    newCard: CardDef | undefined,
  ) => void;

  modify(_positional: never[], named: Args['named']) {
    if (this.url) {
      // unsubscribe from previous URL
      this.unsubscribeFromRealm();
    }

    let {
      url,
      loader,
      isLive,
      onCardInstanceChange,
      messageService,
      cardService,
      resetLoader,
    } = named;
    this.messageService = messageService;
    this.cardService = cardService;
    this.url = url;
    this._loader = loader;
    this.onCardInstanceChange = onCardInstanceChange;
    this.cardError = undefined;
    this.resetLoader = resetLoader;
    if (isLive && this.url) {
      this.loaded = this.loadLiveModel.perform(new URL(this.url));
    } else if (this.url) {
      this.loaded = this.loadStaticModel.perform(new URL(this.url));
    }

    registerDestructor(this, () => {
      if (this.card) {
        this.removeLiveCardEntry(this.card);
      }
      this.unsubscribeFromRealm();
    });
  }

  get card() {
    if (this.loadLiveModel.isRunning || this.loadStaticModel.isRunning) {
      return this.staleCard;
    }
    return this._card;
  }

  get api() {
    if (!this._api) {
      throw new Error(
        `API hasn't been loaded yet in CardResource--await this.loaded()`,
      );
    }
    return this._api;
  }

  private get loader() {
    if (!this._loader) {
      throw new Error(
        `bug: should never get here, loader is obtained via owner`,
      );
    }
    return this._loader;
  }

  private loadStaticModel = restartableTask(async (url: URL) => {
    let card = await this.getCard(url);
    await this.updateCardInstance(card);
  });

  private loadLiveModel = restartableTask(async (url: URL) => {
    let identityContext = liveCards.get(this.loader);
    if (!identityContext) {
      identityContext = new LiveCardIdentityContext();
      liveCards.set(this.loader, identityContext);
    }
    let card = await this.getCard(url, identityContext);
    if (!card) {
      if (this.cardError) {
        console.warn(`cannot load card ${this.cardError.id}`, this.cardError);
      }
      this.clearCardInstance();
      return;
    }
    let subscribers = identityContext.subscribers(card.id)!;
    subscribers.add(this);
    await this.updateCardInstance(card);
  });

  private subscribeToRealm(card: CardDef) {
    let realmURL = card[this.api.realmURL];
    if (!realmURL) {
      throw new Error(`could not determine realm for card ${card.id}`);
    }
    let realmSubscribers = realmSubscriptions.get(realmURL.href);
    if (!realmSubscribers) {
      realmSubscribers = new WeakMap();
      realmSubscriptions.set(realmURL.href, realmSubscribers);
    }
    if (realmSubscribers.has(this)) {
      return;
    }
    realmSubscribers.set(this, {
      // TODO figure out how to go in an out of errors via SSE
      unsubscribe: this.messageService.subscribe(
        realmURL.href,
        ({ type, data: dataStr }) => {
          if (type !== 'index') {
            return;
          }
          let data = JSON.parse(dataStr);
          if (data.type !== 'incremental') {
            return;
          }
          let invalidations = data.invalidations as string[];
          let card = this.url
            ? liveCards.get(this.loader)?.get(this.url)
            : undefined;

          if (!card) {
            // the initial card static load has not actually completed yet
            // (perhaps the loader just changed). in this case we ignore this
            // message.
            return;
          }

          if (invalidations.includes(card.id)) {
            // Do not reload if the event is a result of a request that we made. Otherwise we risk overwriting
            // the inputs with past values. This can happen if the user makes edits in the time between the auto
            // save request and the arrival SSE event.
            if (!this.cardService.clientRequestIds.has(data.clientRequestId)) {
              if (invalidations.find((i) => hasExecutableExtension(i))) {
                // the invalidation included code changes too. in this case we
                // need to flush the loader so that we can pick up any updated
                // code before re-running the card
                this.resetLoader();
              }
              this.reload.perform(card);
            }
          }
        },
      ),
    });
  }

  private async getCard(
    url: URL,
    identityContext?: IdentityContext,
  ): Promise<CardDef | undefined> {
    if (typeof url === 'string') {
      url = new URL(url);
    }
    // createFromSerialized would also do this de-duplication, but we want to
    // also avoid the fetchJSON when we already have the stable card.
    let existingCard = identityContext?.get(url.href);
    if (existingCard) {
      return existingCard;
    }
    this.cardError = undefined;
    try {
      let json = await this.cardService.fetchJSON(url);
      if (!isSingleCardDocument(json)) {
        throw new Error(
          `bug: server returned a non card document for ${url}:
        ${JSON.stringify(json, null, 2)}`,
        );
      }
      let card = await this.cardService.createFromSerialized(
        json.data,
        json,
        new URL(json.data.id),
        {
          identityContext,
        },
      );
      return card;
    } catch (error: any) {
      let errorResponse: CardError;
      try {
        errorResponse = JSON.parse(error.responseText) as CardError;
      } catch (parseError) {
        switch (error.status) {
          // tailor HTTP responses as necessary for better user feedback
          case 404:
            errorResponse = {
              errors: [
                {
                  id: url.href,
                  status: 404,
                  title: 'Card Not Found',
                  message: `The card ${url.href} does not exist`,
                  realm: error.responseHeaders?.get('X-Boxel-Realm-Url'),
                  meta: {
                    lastKnownGoodHtml: null,
                    scopedCssUrls: [],
                    stack: null,
                  },
                },
              ],
            };
            break;
          default:
            errorResponse = {
              errors: [
                {
                  id: url.href,
                  status: error.status,
                  title: status.message[error.status] ?? `HTTP ${error.status}`,
                  message: `Received HTTP ${error.status} from server ${
                    error.responseText ?? ''
                  }`.trim(),
                  realm: error.responseHeaders?.get('X-Boxel-Realm-Url'),
                  meta: {
                    lastKnownGoodHtml: null,
                    scopedCssUrls: [],
                    stack: null,
                  },
                },
              ],
            };
        }
      }
      this.cardError = errorResponse.errors[0];
      return;
    }
  }

  // TODO deal with live update of card that goes into and out of an error state
  private reload = task(async (card: CardDef) => {
    try {
      await this.cardService.reloadCard(card);
    } catch (err: any) {
      if (err.status !== 404) {
        throw err;
      }
      // in this case the document was invalidated in the index because the
      // file was deleted
      this.clearCardInstance();
      return;
    }
  });

  private unsubscribeFromRealm = () => {
    for (let realmSubscribers of realmSubscriptions.values()) {
      let entry = realmSubscribers.get(this);
      if (!entry) {
        continue;
      }
      entry.unsubscribe();
      realmSubscribers.delete(this);
    }
  };

  private async updateCardInstance(maybeCard: CardDef | undefined) {
    if (maybeCard) {
      this._api = await apiFor(maybeCard);
    } else {
      this._api = undefined;
    }
    if (this.onCardInstanceChange) {
      this.onCardInstanceChange(this._card, maybeCard);
    }
    if (maybeCard) {
      this.subscribeToRealm(maybeCard);
    }

    // clean up the live card entry if the new card is undefined or if it's
    // using a different loader
    if (
      this._card &&
      (!maybeCard || loaderFor(maybeCard) !== loaderFor(this._card))
    ) {
      this.removeLiveCardEntry(this._card);
    }
    this._card = maybeCard;
    this.staleCard = maybeCard;
  }

  private removeLiveCardEntry(card: CardDef) {
    let loader = loaderFor(card);
    let subscribers = liveCards.get(loader)?.subscribers(card.id);
    if (subscribers && subscribers.has(this)) {
      subscribers.delete(this);
    }
    if (subscribers && subscribers.size === 0) {
      liveCards.get(loader)!.delete(card.id);
    }
  }

  private clearCardInstance() {
    if (this.onCardInstanceChange) {
      this.onCardInstanceChange(this._card, undefined);
    }
    this._api = undefined;
    this._card = undefined;
    this.staleCard = undefined;
  }
}

export function getCard(
  parent: object,
  url: () => string | undefined,
  opts?: {
    isLive?: () => boolean;
    onCardInstanceChange?: () => (
      oldCard: CardDef | undefined,
      newCard: CardDef | undefined,
    ) => void;
  },
) {
  let loaderService = (getOwner(parent) as any).lookup(
    'service:loader-service',
  ) as LoaderService;
  return CardResource.from(parent, () => ({
    named: {
      url: url(),
      isLive: opts?.isLive ? opts.isLive() : true,
      onCardInstanceChange: opts?.onCardInstanceChange
        ? opts.onCardInstanceChange()
        : undefined,
      loader: loaderService.loader,
      resetLoader: loaderService.reset.bind(loaderService),
      messageService: (getOwner(parent) as any).lookup(
        'service:message-service',
      ) as MessageService,
      cardService: (getOwner(parent) as any).lookup(
        'service:card-service',
      ) as CardService,
    },
  }));
}
