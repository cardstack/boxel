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
  isCardInstance,
  type SingleCardDocument,
  type LooseSingleCardDocument,
} from '@cardstack/runtime-common';

import type MessageService from '@cardstack/host/services/message-service';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import type * as CardAPI from 'https://cardstack.com/base/card-api';

import type CardService from '../services/card-service';
import type LoaderService from '../services/loader-service';
import type RealmService from '../services/realm';
import type RealmSubscriptionService from '../services/realm-subscription';

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

interface Args {
  named: {
    // using string type here so that URL's that have the same href but are
    // different instances don't result in re-running the resource
    urlOrDoc: string | LooseSingleCardDocument | undefined;
    isLive: boolean;
    relativeTo?: URL; // used for new cards
    // this is not always constructed within a container so we pass in our services
    cardService: CardService;
    realmSubscriptionService: RealmSubscriptionService;
    messageService: MessageService;
    resetLoader: () => void;
    onCardInstanceChange?: (
      oldCard: CardDef | undefined,
      newCard: CardDef | undefined,
    ) => void;
  };
}

export class CardResource extends Resource<Args> {
  url: string | undefined;
  @tracked loaded: Promise<void> | undefined;
  @tracked cardError: CardError | undefined;
  @service private declare realm: RealmService;
  @tracked private _card: CardDef | undefined;
  @tracked private _api: typeof CardAPI | undefined;
  @tracked private staleCard: CardDef | undefined;
  private relativeTo: URL | undefined;
  private isLive = false;
  private declare realmSubscription: RealmSubscriptionService;
  private declare cardService: CardService;
  private declare messageService: MessageService;
  private declare loaderService: LoaderService;
  private declare resetLoader: () => void;
  private onCardInstanceChange?: (
    oldCard: CardDef | undefined,
    newCard: CardDef | undefined,
  ) => void;

  modify(_positional: never[], named: Args['named']) {
    let {
      urlOrDoc,
      isLive,
      onCardInstanceChange,
      messageService,
      cardService,
      realmSubscriptionService,
      resetLoader,
      relativeTo,
    } = named;
    this.relativeTo = relativeTo;
    this.messageService = messageService;
    this.cardService = cardService;
    this.realmSubscription = realmSubscriptionService;
    this.url = urlOrDoc ? asURL(urlOrDoc) : undefined;
    this.onCardInstanceChange = onCardInstanceChange;
    this.cardError = undefined;
    this.resetLoader = resetLoader;
    this.isLive = isLive;
    if (urlOrDoc) {
      this.loaded = this.loadModel.perform(urlOrDoc);
    }

    registerDestructor(this, () => {
      this.realmSubscription.unloadResource(this);
    });
  }

  get card() {
    if (this.loadModel.isRunning || this.loadModel.isRunning) {
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

  loadModel = restartableTask(
    async (urlOrDoc: string | LooseSingleCardDocument) => {
      let cardOrError = await this.getCard(urlOrDoc);
      await this.updateCardInstance(cardOrError);
      if (!isCardInstance(cardOrError)) {
        console.warn(`cannot load card ${cardOrError.id}`, cardOrError);
      }
    },
  );

  private async getCard(urlOrDoc: string | LooseSingleCardDocument) {
    let url = asURL(urlOrDoc);
    let identityContext = this.realmSubscription.identityContext;
    try {
      if (!url) {
        // this is a new card so instantiate it and save it
        let doc = urlOrDoc as LooseSingleCardDocument;
        let newCard = await this.cardService.createFromSerialized(
          doc.data,
          doc,
          this.relativeTo,
          {
            identityContext,
          },
        );
        await this.cardService.saveModel(newCard);
        if (identityContext) {
          identityContext.set(newCard.id, newCard);
        }
        return newCard;
      }

      // createFromSerialized would also do this de-duplication, but we want to
      // also avoid the fetchJSON when we already have the stable card.
      let existingCard = identityContext?.get(url);
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
          identityContext,
        },
      );
      if (identityContext && !identityContext.get(url)) {
        identityContext.set(url, card);
      }
      return card;
    } catch (error: any) {
      if (url && identityContext) {
        identityContext.set(url, undefined);
      }
      let errorResponse = processCardError(
        url ? new URL(url) : undefined,
        error,
      );
      return errorResponse.errors[0];
    }
  }

  reload = task(async (card: CardDef) => {
    try {
      await this.cardService.reloadCard(card);
      this.setCardOrError(card);
    } catch (err: any) {
      if (err.status !== 404) {
        this.realmSubscription.identityContext.set(card.id, undefined);
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

  async updateCardInstance(maybeCard: CardDef | CardError) {
    let instance: CardDef | undefined;
    if (isCardInstance(maybeCard)) {
      instance = maybeCard;
      this.url = maybeCard.id;
      this._api = await apiFor(maybeCard);
    }
    if (this.onCardInstanceChange) {
      this.onCardInstanceChange(this._card, instance);
    }
    if (this.isLive) {
      this.realmSubscription.subscribeFor(this);
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
  urlOrDoc: () => string | LooseSingleCardDocument | undefined,
  opts?: {
    relativeTo?: URL; // used for new cards
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
      urlOrDoc: urlOrDoc(),
      isLive: opts?.isLive ? opts.isLive() : true,
      relativeTo: opts?.relativeTo,
      onCardInstanceChange: opts?.onCardInstanceChange
        ? opts.onCardInstanceChange()
        : undefined,
      resetLoader: loaderService.reset.bind(loaderService),
      realmSubscriptionService: (getOwner(parent) as any).lookup(
        'service:realm-subscription',
      ) as RealmSubscriptionService,
      messageService: (getOwner(parent) as any).lookup(
        'service:message-service',
      ) as MessageService,
      cardService: (getOwner(parent) as any).lookup(
        'service:card-service',
      ) as CardService,
    },
  }));
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
