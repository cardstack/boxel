// the name of this file is annoying, we name it card-resource because when
// named 'card.ts' the browser sourcemap conflates this module with the card
// controller, also named 'card.ts'.

import { registerDestructor } from '@ember/destroyable';
import { getOwner } from '@ember/owner';
import { buildWaiter } from '@ember/test-waiters';
import { isTesting } from '@embroider/macros';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';
import { task } from 'ember-concurrency';
import { Resource } from 'ember-resources';

import {
  Loader,
  isSingleCardDocument,
  apiFor,
  loaderFor,
  type SingleCardDocument,
} from '@cardstack/runtime-common';

import type MessageService from '@cardstack/host/services/message-service';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import type * as CardAPI from 'https://cardstack.com/base/card-api';

import type CardService from '../services/card-service';
import type LoaderService from '../services/loader-service';

interface CardError {
  id: string;
  error: Error;
}

interface Args {
  named: {
    // using string type here so that URL's that have the same href but are
    // different instances don't result in re-running the resource
    url: string | undefined;
    loader: Loader;
    isLive: boolean;
    cachedOnly: boolean;
    // this is not always constructed within a container so we pass in our services
    cardService: CardService;
    messageService: MessageService;
    onCardInstanceChange?: (
      oldCard: CardDef | undefined,
      newCard: CardDef | undefined,
    ) => void;
  };
}

const waiter = buildWaiter('card-resource:load-card-waiter');
const liveCards: WeakMap<
  Loader,
  Map<
    string,
    {
      card: CardDef;
      realmURL: URL;
      subscribers: Set<object>;
    }
  >
> = new WeakMap();
const realmSubscriptions: Map<
  string,
  WeakMap<CardResource, { unsubscribe: () => void }>
> = new Map();

export class CardResource extends Resource<Args> {
  url: string | undefined;
  @tracked loaded: Promise<void> | undefined;
  @tracked cardError: CardError | undefined;
  @tracked private _card: CardDef | undefined;
  @tracked private _api: typeof CardAPI | undefined;
  @tracked private staleCard: CardDef | undefined;
  private declare cardService: CardService;
  private declare messageService: MessageService;
  private cachedOnly: boolean | undefined;
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
      cachedOnly,
      onCardInstanceChange,
      messageService,
      cardService,
    } = named;
    this.messageService = messageService;
    this.cardService = cardService;
    this.url = url;
    this.cachedOnly = cachedOnly;
    this._loader = loader;
    this.onCardInstanceChange = onCardInstanceChange;

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
      throw new Error(`loader has not yet been set for CardResource`);
    }
    return this._loader;
  }

  private loadStaticModel = restartableTask(async (url: URL) => {
    let card = await this.getCard(url);
    await this.updateCardInstance(card);
  });

  private loadLiveModel = restartableTask(async (url: URL) => {
    let cardsForLoader = liveCards.get(this.loader);
    if (!cardsForLoader) {
      cardsForLoader = new Map();
      liveCards.set(this.loader, cardsForLoader);
    }
    let entry = cardsForLoader.get(url.href);
    if (entry) {
      entry.subscribers.add(this);
      await this.updateCardInstance(entry.card);
      return;
    }
    if (this.cachedOnly) {
      this.clearCardInstance();
      return;
    }

    let card = await this.getCard(url);
    if (!card) {
      if (this.cardError) {
        console.warn(
          `cannot load card ${this.cardError.id}`,
          this.cardError.error,
        );
      }
      this.clearCardInstance();
      return;
    }
    let realmURL = await this.cardService.getRealmURL(card, this.loader);
    if (!realmURL) {
      throw new Error(`bug: cannot determine realm URL for card ${card.id}`);
    }

    cardsForLoader.set(card.id, {
      card,
      realmURL,
      subscribers: new Set([this]),
    });
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
      unsubscribe: this.messageService.subscribe(
        `${realmURL}_message`,
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
            ? liveCards.get(this.loader)?.get(this.url)?.card
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
              this.reload.perform(card);
            }
          }
        },
      ),
    });
  }

  private async getCard(url: URL): Promise<CardDef | undefined> {
    if (typeof url === 'string') {
      url = new URL(url);
    }
    this.cardError = undefined;
    try {
      let json = await this.cardService.fetchJSON(url, undefined, this.loader);
      if (!isSingleCardDocument(json)) {
        throw new Error(
          `bug: server returned a non card document for ${url}:
        ${JSON.stringify(json, null, 2)}`,
        );
      }
      let card = await this.cardService.createFromSerialized(
        json.data,
        json,
        url,
        this.loader,
      );
      return card;
    } catch (error: any) {
      this.cardError = {
        id: url.href,
        error,
      };
      return;
    }
  }

  private reload = task(async (card: CardDef) => {
    // we don't await this in the realm subscription callback, so this test
    // waiter should catch otherwise leaky async in the tests
    await this.withTestWaiters(async () => {
      let incomingDoc: SingleCardDocument;
      try {
        incomingDoc = (await this.cardService.fetchJSON(
          card.id,
          undefined,
          loaderFor(card),
        )) as SingleCardDocument;
      } catch (err: any) {
        if (err.status !== 404) {
          throw err;
        }
        // in this case the document was invalidated in the index because the
        // file was deleted
        this.clearCardInstance();
        return;
      }

      if (!isSingleCardDocument(incomingDoc)) {
        throw new Error(
          `bug: server returned a non card document for ${card.id}:
        ${JSON.stringify(incomingDoc, null, 2)}`,
        );
      }
      await this.api.updateFromSerialized<typeof CardDef>(card, incomingDoc);
    });
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

  private async withTestWaiters<T>(cb: () => Promise<T>) {
    let token = waiter.beginAsync();
    try {
      let result = await cb();
      // only do this in test env--this makes sure that we also wait for any
      // interior card instance async as part of our ember-test-waiters
      if (isTesting()) {
        await this.cardService.cardsSettled(this.loader);
      }
      return result;
    } finally {
      waiter.endAsync(token);
    }
  }

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
    let liveCardEntry = liveCards.get(loader)?.get(card.id);
    if (liveCardEntry && liveCardEntry.subscribers.has(this)) {
      liveCardEntry.subscribers.delete(this);
    }
    if (liveCardEntry?.subscribers.size === 0) {
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
    loader?: () => Loader;
    cachedOnly?: () => boolean;
    onCardInstanceChange?: () => (
      oldCard: CardDef | undefined,
      newCard: CardDef | undefined,
    ) => void;
  },
) {
  return CardResource.from(parent, () => ({
    named: {
      url: url(),
      isLive: opts?.isLive ? opts.isLive() : true,
      cachedOnly: opts?.cachedOnly ? opts.cachedOnly() : false,
      onCardInstanceChange: opts?.onCardInstanceChange
        ? opts.onCardInstanceChange()
        : undefined,
      loader: opts?.loader
        ? opts.loader()
        : (
            (getOwner(parent) as any).lookup(
              'service:loader-service',
            ) as LoaderService
          ).loader,
      messageService: (getOwner(parent) as any).lookup(
        'service:message-service',
      ) as MessageService,
      cardService: (getOwner(parent) as any).lookup(
        'service:card-service',
      ) as CardService,
    },
  }));
}

export function trackCard<T extends Object>(
  owner: T,
  card: CardDef,
  realmURL: URL,
): CardDef {
  if (!card.id) {
    throw new Error(`cannot set live card model on an unsaved card`);
  }
  let loader = loaderFor(card);
  let cardsForLoader = liveCards.get(loader);
  if (!cardsForLoader) {
    cardsForLoader = new Map();
    liveCards.set(loader, cardsForLoader);
  }
  let alreadyTracked = cardsForLoader.get(card.id);
  if (alreadyTracked) {
    return alreadyTracked.card;
  }
  if (!realmURL) {
    throw new Error(`bug: cannot determine realm for card ${card.id}`);
  }
  cardsForLoader.set(card.id, {
    card,
    realmURL,
    subscribers: new Set([owner]),
  });
  return card;
}
