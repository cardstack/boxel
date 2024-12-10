// the name of this file is annoying, we name it card-resource because when
// named 'card.ts' the browser sourcemap conflates this module with the card
// controller, also named 'card.ts'.

import { registerDestructor } from '@ember/destroyable';
import { getOwner } from '@ember/owner';
import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';
import { task } from 'ember-concurrency';
import { Resource } from 'ember-resources';

import status from 'statuses';

import {
  isSingleCardDocument,
  apiFor,
  hasExecutableExtension,
  isCardInstance,
} from '@cardstack/runtime-common';

import type MessageService from '@cardstack/host/services/message-service';

import type {
  CardDef,
  IdentityContext,
} from 'https://cardstack.com/base/card-api';

import type * as CardAPI from 'https://cardstack.com/base/card-api';

import type CardService from '../services/card-service';
import type LoaderService from '../services/loader-service';
import type RealmService from '../services/realm';

interface CardErrors {
  errors: {
    id?: string; // 404 errors won't necessarily have an id
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

export type CardError = CardErrors['errors'][0];

interface Args {
  named: {
    // using string type here so that URL's that have the same href but are
    // different instances don't result in re-running the resource
    url: string | undefined;
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
      card: CardDef | undefined; // undefined means that the card is in an error state
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
  update(
    url: string,
    instance: CardDef | undefined,
    subscribers?: Set<object>,
  ) {
    let entry = this.#cards.get(url);
    if (!entry) {
      entry = { card: instance, subscribers: new Set() };
      this.#cards.set(url, entry);
    } else {
      entry.card = instance;
    }
    if (subscribers) {
      for (let subscriber of subscribers) {
        entry.subscribers.add(subscriber);
      }
    }
  }
  hasError(url: string) {
    return this.#cards.has(url) && !this.#cards.get(url)?.card;
  }
  subscribers(url: string): Set<object> | undefined {
    return this.#cards.get(url)?.subscribers;
  }
}

let liveCardIdentityContext = new LiveCardIdentityContext();
let realmSubscriptions: Map<
  string,
  WeakMap<CardResource, { unsubscribe: () => void }>
> = new Map();

export function testOnlyResetLiveCardState() {
  liveCardIdentityContext = new LiveCardIdentityContext();
  realmSubscriptions = new Map();
}

export class CardResource extends Resource<Args> {
  url: string | undefined;
  @tracked loaded: Promise<void> | undefined;
  @tracked cardError: CardError | undefined;
  @service private declare realm: RealmService;
  @tracked private _card: CardDef | undefined;
  @tracked private _api: typeof CardAPI | undefined;
  @tracked private staleCard: CardDef | undefined;
  private declare cardService: CardService;
  private declare messageService: MessageService;
  private declare loaderService: LoaderService;
  private declare resetLoader: () => void;
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
      isLive,
      onCardInstanceChange,
      messageService,
      cardService,
      resetLoader,
    } = named;
    this.messageService = messageService;
    this.cardService = cardService;
    this.url = url?.replace(/\.json$/, '');
    this.onCardInstanceChange = onCardInstanceChange;
    this.cardError = undefined;
    this.resetLoader = resetLoader;
    if (isLive && this.url) {
      this.loaded = this.loadLiveModel.perform(new URL(this.url));
    } else if (this.url) {
      this.loaded = this.loadStaticModel.perform(new URL(this.url));
    }

    registerDestructor(this, () => {
      if (this.url) {
        this.removeLiveCardEntry(this.url);
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

  private loadStaticModel = restartableTask(async (url: URL) => {
    let cardOrError = await this.getCard(url);
    await this.updateCardInstance(cardOrError);
  });

  private loadLiveModel = restartableTask(async (url: URL) => {
    let cardOrError = await this.getCard(url, liveCardIdentityContext);
    await this.updateCardInstance(cardOrError);
    if (isCardInstance(cardOrError)) {
      let subscribers = liveCardIdentityContext.subscribers(cardOrError.id)!;
      subscribers.add(this);
    } else {
      console.warn(`cannot load card ${cardOrError.id}`, cardOrError);
      this.subscribeToRealm(url.href);
    }
  });

  private subscribeToRealm(cardOrId: CardDef | string) {
    let card: CardDef | undefined;
    let id: string;
    let realmURL: URL | undefined;
    if (typeof cardOrId === 'string') {
      id = cardOrId;
      realmURL = this.realm.realmOfURL(new URL(id));
    } else {
      card = cardOrId;
      id = card.id;
      realmURL = card[this.api.realmURL];
    }
    if (!realmURL) {
      console.warn(
        `could not determine realm for card ${id} when trying to subscribe to realm`,
      );
      return;
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
            ? liveCardIdentityContext.get(this.url)
            : undefined;

          if (!card) {
            if (this.url && liveCardIdentityContext.hasError(this.url)) {
              if (invalidations.find((i) => hasExecutableExtension(i))) {
                // the invalidation included code changes too. in this case we
                // need to flush the loader so that we can pick up any updated
                // code before re-running the card
                this.resetLoader();
              }
              // we've already established a subscription--we're in it, just
              // load the updated instance
              this.loadStaticModel.perform(new URL(this.url));
            }
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
                // code before re-running the card as well as clear out the
                // identity context as the card has a new implementation
                this.resetLoader();
                let subscribers = liveCardIdentityContext.subscribers(card.id);
                liveCardIdentityContext.delete(card.id);
                this.loadStaticModel.perform(new URL(card.id));
                liveCardIdentityContext.update(
                  card.id,
                  this._card,
                  subscribers,
                );
              } else {
                this.reload.perform(card);
              }
            }
          }
        },
      ),
    });
  }

  private async getCard(url: URL, identityContext?: LiveCardIdentityContext) {
    if (typeof url === 'string') {
      url = new URL(url);
    }
    // createFromSerialized would also do this de-duplication, but we want to
    // also avoid the fetchJSON when we already have the stable card.
    let existingCard = identityContext?.get(url.href);
    if (existingCard) {
      return existingCard;
    }
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
      if (identityContext && identityContext.hasError(url.href)) {
        liveCardIdentityContext.update(url.href, card);
      }
      return card;
    } catch (error: any) {
      if (identityContext) {
        liveCardIdentityContext.update(url.href, undefined);
      }
      let errorResponse = processCardError(url, error);
      return errorResponse.errors[0];
    }
  }

  private reload = task(async (card: CardDef) => {
    try {
      await this.cardService.reloadCard(card);
      this.setCardOrError(card);
    } catch (err: any) {
      if (err.status !== 404) {
        liveCardIdentityContext.update(card.id, undefined);
        let errorResponse = processCardError(new URL(card.id), err);
        this.setCardOrError(errorResponse.errors[0]);
        return;
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

  private async updateCardInstance(maybeCard: CardDef | CardError) {
    let instance: CardDef | undefined;
    if (isCardInstance(maybeCard)) {
      instance = maybeCard;
      this._api = await apiFor(maybeCard);
    }
    if (this.onCardInstanceChange) {
      this.onCardInstanceChange(this._card, instance);
    }
    if (maybeCard.id) {
      this.subscribeToRealm(maybeCard.id);
    }
    this.setCardOrError(maybeCard);
  }

  private setCardOrError(cardOrError: CardDef | CardError) {
    if (isCardInstance(cardOrError)) {
      this._card = cardOrError;
      this.staleCard = cardOrError;
      this.cardError = undefined;
    } else {
      this.cardError = cardOrError;
      this._card = undefined;
      this.staleCard = undefined;
    }
  }

  private removeLiveCardEntry(id: string) {
    let subscribers = liveCardIdentityContext.subscribers(id);
    if (subscribers && subscribers.has(this)) {
      subscribers.delete(this);
    }
    if (subscribers && subscribers.size === 0) {
      liveCardIdentityContext.delete(id);
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

function processCardError(url: URL, error: any): CardErrors {
  try {
    let errorResponse = JSON.parse(error.responseText) as CardErrors;
    return errorResponse;
  } catch (parseError) {
    switch (error.status) {
      // tailor HTTP responses as necessary for better user feedback
      case 404:
        return {
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
      default:
        return {
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
}
