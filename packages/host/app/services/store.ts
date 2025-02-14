import Service, { service } from '@ember/service';

import { restartableTask, task } from 'ember-concurrency';

import status from 'statuses';

import {
  hasExecutableExtension,
  isCardInstance,
  isSingleCardDocument,
  type SingleCardDocument,
  type LooseSingleCardDocument,
} from '@cardstack/runtime-common';

import type {
  CardDef,
  IdentityContext,
} from 'https://cardstack.com/base/card-api';

import type CardService from './card-service';
import type LoaderService from './loader-service';
import type MessageService from './message-service';
import type RealmService from './realm';

import type { CardResource } from '../resources/card-resource';

class ResettableIdentityContext implements IdentityContext {
  #cards = new Map<
    string,
    {
      card: CardDef | undefined;
    }
  >();

  get(url: string): CardDef | undefined {
    return this.#cards.get(url)?.card;
  }
  set(url: string, instance: CardDef | undefined): void {
    this.#cards.set(url, { card: instance });
  }
  delete(url: string): void {
    this.#cards.delete(url);
  }
  reset() {
    for (let url of this.#cards.keys()) {
      this.#cards.set(url, { card: undefined });
    }
  }
}

interface CardErrors {
  errors: {
    id?: string; // 404 errors won't necessarily have an id
    status: number;
    title: string;
    message: string;
    realm: string | undefined;
    meta: {
      lastKnownGoodHtml: string | null;
      cardTitle: string | null;
      scopedCssUrls: string[];
      stack: string | null;
    };
  }[];
}

export type CardError = CardErrors['errors'][0];

export default class StoreService extends Service {
  @service private declare realm: RealmService;
  @service private declare loaderService: LoaderService;
  @service private declare messageService: MessageService;
  @service private declare cardService: CardService;
  private subscriptions: Map<string, { unsubscribe: () => void }> = new Map();
  private identityContext = new ResettableIdentityContext();
  private subscribers: Map<
    string,
    {
      // it's possible to have the same card instance used in different
      // resources as the owners of the resources can differ
      resources: {
        resource: CardResource;
        setCard: (card: CardDef | undefined) => void;
        setCardError: (error: CardError | undefined) => void;
      }[];
      realm: string;
    }
  > = new Map();

  unloadResource(resource: CardResource) {
    let id = resource.url;
    if (!id) {
      return;
    }
    let subscriber = this.subscribers.get(id);
    if (subscriber) {
      let { resources, realm } = subscriber;
      const index = resources.findIndex((s) => s.resource === resource);
      if (index > -1) {
        resources.splice(index, 1);
      }
      if (resources.length === 0) {
        this.subscribers.delete(id);
        this.identityContext.delete(id);
      }

      // if there are no more subscribers to this realm then unsubscribe from realm
      let subscription = this.subscriptions.get(realm);
      if (
        subscription &&
        ![...this.subscribers.values()].find((s) => s.realm === realm)
      ) {
        subscription.unsubscribe();
        this.subscriptions.delete(realm);
      }
    }
  }

  async createSubscriber({
    resource,
    urlOrDoc,
    setCard,
    setCardError,
  }: {
    resource: CardResource;
    urlOrDoc: string | LooseSingleCardDocument;
    setCard: (card: CardDef | undefined) => void;
    setCardError: (error: CardError | undefined) => void;
  }): Promise<{
    url: string | undefined;
    card: CardDef | undefined;
    error: CardError | undefined;
  }> {
    let cardOrError = await this.getCard(urlOrDoc);
    let card = isCardInstance(cardOrError) ? cardOrError : undefined;
    let error = !isCardInstance(cardOrError) ? cardOrError : undefined;

    let url = cardOrError.id;
    if (!url || !resource.isLive) {
      this.handleUpdatedCard(undefined, cardOrError);
      // when there is no 'url' it is likely a card error for a doc without an ID
      return { url: url ?? resource.url, card, error };
    }

    if (!isCardInstance(cardOrError)) {
      console.warn(
        `cannot load card ${cardOrError.id ?? resource.url}`,
        cardOrError,
      );
    }

    let realmURL = this.realm.realmOfURL(new URL(url));
    if (!realmURL) {
      console.warn(
        `could not determine realm for card ${url} when trying to subscribe to realm`,
      );
    } else {
      let realm = realmURL.href;
      let subscriber = this.subscribers.get(url);
      if (!subscriber) {
        subscriber = {
          resources: [],
          realm,
        };
        this.subscribers.set(url, subscriber);
      }
      subscriber.resources.push({ resource, setCard, setCardError });
      let subscription = this.subscriptions.get(realm);
      if (!subscription) {
        this.subscriptions.set(realm, {
          unsubscribe: this.messageService.subscribe(
            realm,
            this.handleInvalidations,
          ),
        });
      }
    }
    this.handleUpdatedCard(undefined, cardOrError);
    return { url, card, error };
  }

  private handleInvalidations = ({ type, data: dataStr }: MessageEvent) => {
    if (type !== 'index') {
      return;
    }
    let data = JSON.parse(dataStr);
    if (data.type !== 'incremental') {
      return;
    }
    let invalidations = data.invalidations as string[];

    if (invalidations.find((i) => hasExecutableExtension(i))) {
      // the invalidation included code changes too. in this case we
      // need to flush the loader so that we can pick up any updated
      // code before re-running the card
      this.loaderService.reset();
      // the code changes have destabilized our identity context so we
      // need to rebuild it
      this.identityContext.reset();
    }

    for (let invalidation of invalidations) {
      if (hasExecutableExtension(invalidation)) {
        // we already dealt with this
        continue;
      }
      let subscriber = this.subscribers.get(invalidation);
      if (subscriber) {
        let liveCard = this.identityContext.get(invalidation);
        if (liveCard) {
          // Do not reload if the event is a result of a request that we made. Otherwise we risk overwriting
          // the inputs with past values. This can happen if the user makes edits in the time between the auto
          // save request and the arrival SSE event.
          if (!this.cardService.clientRequestIds.has(data.clientRequestId)) {
            this.reload.perform(liveCard);
          }
        } else if (!this.identityContext.get(invalidation)) {
          // load the card using just the ID because we don't have a running card on hand
          this.loadModel.perform(invalidation);
        }
      }
    }
  };

  private loadModel = restartableTask(
    async (urlOrDoc: string | LooseSingleCardDocument) => {
      let url = asURL(urlOrDoc);
      let oldCard = url ? this.identityContext.get(url) : undefined;
      let cardOrError = await this.getCard(urlOrDoc);
      this.handleUpdatedCard(oldCard, cardOrError);
      if (url) {
        this.notifyLiveResources(url, cardOrError);
      }
    },
  );

  private reload = task(async (card: CardDef) => {
    let maybeReloadedCard: CardDef | CardError | undefined;
    let isDelete = false;
    try {
      await this.cardService.reloadCard(card);
      maybeReloadedCard = card;
    } catch (err: any) {
      if (err.status === 404) {
        // in this case the document was invalidated in the index because the
        // file was deleted
        isDelete = true;
      } else {
        let errorResponse = processCardError(new URL(card.id), err);
        maybeReloadedCard = errorResponse.errors[0];
      }
    }
    await this.handleUpdatedCard(card, maybeReloadedCard);
    if (isDelete) {
      this.identityContext.delete(card.id);
    }
    this.notifyLiveResources(card.id, maybeReloadedCard);
  });

  private handleUpdatedCard(
    oldCard: CardDef | undefined,
    maybeUpdatedCard: CardDef | CardError | undefined,
  ) {
    let instance: CardDef | undefined;
    if (isCardInstance(maybeUpdatedCard)) {
      instance = maybeUpdatedCard;
      this.identityContext.set(instance.id, instance);
    } else if (maybeUpdatedCard?.id) {
      this.identityContext.set(maybeUpdatedCard.id, undefined);
    }

    if (maybeUpdatedCard?.id) {
      for (let subscriber of this.subscribers.get(maybeUpdatedCard.id)
        ?.resources ?? []) {
        subscriber.resource.onCardInstanceChange?.(oldCard, instance);
      }
    }
  }

  private notifyLiveResources(
    url: string,
    maybeCard: CardDef | CardError | undefined,
  ) {
    for (let { setCard, setCardError } of this.subscribers.get(url)
      ?.resources ?? []) {
      if (!maybeCard) {
        setCard(undefined);
        setCardError(undefined);
      } else if (isCardInstance(maybeCard)) {
        setCard(maybeCard);
        setCardError(undefined);
      } else {
        setCard(undefined);
        setCardError(maybeCard);
      }
    }
  }

  private async getCard(urlOrDoc: string | LooseSingleCardDocument) {
    let url = asURL(urlOrDoc);
    try {
      if (!url) {
        // this is a new card so instantiate it and save it
        let doc = urlOrDoc as LooseSingleCardDocument;
        let newCard = await this.cardService.createFromSerialized(
          doc.data,
          doc,
          undefined,
          {
            identityContext: this.identityContext,
          },
        );
        await this.cardService.saveModel(newCard);
        this.identityContext.set(newCard.id, newCard);
        return newCard;
      }

      // createFromSerialized would also do this de-duplication, but we want to
      // also avoid the fetchJSON when we already have the stable card.
      let existingCard = this.identityContext.get(url);
      if (existingCard) {
        return existingCard;
      }
      let doc = (typeof urlOrDoc !== 'string' ? urlOrDoc : undefined) as
        | SingleCardDocument
        | undefined;
      if (!doc) {
        let json = await this.cardService.fetchJSON(url);
        if (!isSingleCardDocument(json)) {
          throw new Error(
            `bug: server returned a non card document for ${url}:
        ${JSON.stringify(json, null, 2)}`,
          );
        }
        doc = json;
      }
      let card = await this.cardService.createFromSerialized(
        doc.data,
        doc,
        new URL(doc.data.id),
        {
          identityContext: this.identityContext,
        },
      );
      return card;
    } catch (error: any) {
      let errorResponse = processCardError(
        url ? new URL(url) : undefined,
        error,
      );
      return errorResponse.errors[0];
    }
  }
}

function processCardError(url: URL | undefined, error: any): CardErrors {
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
              id: url?.href,
              status: 404,
              title: 'Card Not Found',
              message: `The card ${url?.href} does not exist`,
              realm: error.responseHeaders?.get('X-Boxel-Realm-Url'),
              meta: {
                lastKnownGoodHtml: null,
                scopedCssUrls: [],
                stack: null,
                cardTitle: null,
              },
            },
          ],
        };
      default:
        return {
          errors: [
            {
              id: url?.href,
              status: error.status ?? 500,
              title: error.status
                ? status.message[error.status]
                : error.message,
              message: error.status
                ? `Received HTTP ${error.status} from server ${
                    error.responseText ?? ''
                  }`.trim()
                : `${error.message}: ${error.stack}`,
              realm: error.responseHeaders?.get('X-Boxel-Realm-Url'),
              meta: {
                lastKnownGoodHtml: null,
                scopedCssUrls: [],
                stack: null,
                cardTitle: null,
              },
            },
          ],
        };
    }
  }
}

export function asURL(urlOrDoc: string | LooseSingleCardDocument) {
  return typeof urlOrDoc === 'string'
    ? urlOrDoc.replace(/\.json$/, '')
    : urlOrDoc.data.id;
}
