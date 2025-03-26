import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import Service, { service } from '@ember/service';

import { formatDistanceToNow } from 'date-fns';
import { all, restartableTask, task, timeout } from 'ember-concurrency';

import status from 'statuses';

import { TrackedObject, TrackedWeakMap } from 'tracked-built-ins';

import {
  hasExecutableExtension,
  isCardInstance,
  isSingleCardDocument,
  type LooseCardResource,
  type AutoSaveState,
  type SingleCardDocument,
  type LooseSingleCardDocument,
  type CardErrorJSONAPI as CardError,
  type CardErrorsJSONAPI as CardErrors,
} from '@cardstack/runtime-common';

import {
  type CardDef,
  type IdentityContext,
} from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';

import type { RealmEventContent } from 'https://cardstack.com/base/matrix-event';

import EnvironmentService from './environment-service';

import type CardService from './card-service';
import type LoaderService from './loader-service';
import type MessageService from './message-service';
import type RealmService from './realm';

import type { CardResource } from '../resources/card-resource';
import type { SearchResource } from '../resources/search';

export { CardError };

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

export default class StoreService extends Service {
  @service declare private realm: RealmService;
  @service declare private loaderService: LoaderService;
  @service declare private messageService: MessageService;
  @service declare private cardService: CardService;
  @service declare private environmentService: EnvironmentService;
  private subscriptions: Map<string, { unsubscribe: () => void }> = new Map();
  private identityContext = new ResettableIdentityContext();
  private subscribers: Map<
    string,
    {
      // it's possible to have the same card instance used in different
      // resources as the owners of the resources can differ
      resources: {
        resourceState: {
          resource: CardResource | SearchResource;
          onCardChange?: () => void;
        };
        setCard?: (card: CardDef | undefined) => void;
        setCardError?: (error: CardError | undefined) => void;
      }[];
      realm: string;
    }
  > = new Map();
  private autoSaveStates: TrackedWeakMap<CardDef, AutoSaveState> =
    new TrackedWeakMap();
  private cardApiCache?: typeof CardAPI;
  private garbageCollection: Map<string, number> = new Map();

  constructor(owner: Owner) {
    super(owner);
    registerDestructor(this, () => {
      for (let timeout of this.garbageCollection.values()) {
        clearTimeout(timeout);
      }
    });
  }

  unloadResource(resource: CardResource) {
    let id = resource.url;
    if (!id) {
      return;
    }
    let subscriber = this.subscribers.get(id);
    if (subscriber) {
      let { resources, realm } = subscriber;
      const index = resources.findIndex(
        (s) => s.resourceState.resource === resource,
      );

      if (index > -1) {
        let { onCardChange } = resources[index].resourceState;
        if (onCardChange && resource.card) {
          let autoSaveState = this.getAutoSaveState(resource.card);
          if (autoSaveState?.hasUnsavedChanges) {
            this.initiateAutoSaveTask.perform(id, { isImmediate: true });
          }
          let card = this.identityContext.get(id);

          if (this.cardApiCache && card) {
            this.cardApiCache?.unsubscribeFromChanges(card, onCardChange);
          }
        }
        resources.splice(index, 1);
      }
      if (resources.length === 0) {
        this.subscribers.delete(id);
        // intentionally not removing the instance immediately from the identity map. as of
        // the StackItem refactor our resources lifetimes are very
        // narrow/efficient, and it's not unlikely that a resource for a stack
        // item will be unloaded when switching from edit to view modes as it
        // will be dereferenced during the switch over.
        this.markForGarbageCollection(id!);
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

  private markForGarbageCollection(id: string) {
    clearTimeout(this.garbageCollection.get(id));
    this.garbageCollection.set(
      id,
      setTimeout(
        () => this.identityContext.delete(id!),
        5 * 6000,
      ) as unknown as number,
    );
  }

  async createSubscriber({
    resource,
    urlOrDoc,
    setCard,
    setCardError,
    relativeTo,
    isLive,
    isAutoSaved,
  }: {
    resource: CardResource | SearchResource;
    urlOrDoc: string | LooseSingleCardDocument;
    setCard?: (card: CardDef | undefined) => void;
    setCardError?: (error: CardError | undefined) => void;
    relativeTo?: URL;
    isLive?: boolean;
    isAutoSaved?: boolean;
  }): Promise<{
    url: string | undefined;
    card: CardDef | undefined;
    error: CardError | undefined;
  }> {
    let cardOrError = await this.getCard(urlOrDoc, relativeTo);
    let card = isCardInstance(cardOrError) ? cardOrError : undefined;
    let error = !isCardInstance(cardOrError) ? cardOrError : undefined;

    let url = cardOrError.id;
    if (!url || !isLive) {
      await this.handleUpdatedCard(undefined, cardOrError);
      // when there is no 'url' it is likely a card error for a doc without an ID
      return {
        url: url ?? ('url' in resource ? resource.url : undefined),
        card,
        error,
      };
    }

    if (!isCardInstance(cardOrError)) {
      console.warn(`cannot load card ${url}`, cardOrError);
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
      subscriber.resources.push({
        resourceState: {
          resource,
          onCardChange: isAutoSaved
            ? () => {
                if (card) {
                  // Using the card ID instead, so this function doesn't need to be updated
                  // when the card instance changes.
                  this.initiateAutoSaveTask.perform(card.id);
                }
              }
            : undefined,
        },
        setCard,
        setCardError,
      });
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
    await this.handleUpdatedCard(undefined, cardOrError);
    return { url, card, error };
  }

  // This method is used for specific scenarios where you just want an instance
  // that is not necessarily part of the identity map and is detached from the
  // store, such that it is not auto saving and not receiving live updates. This
  // may include things like tests, freestyle usage guide, etc.
  async getInstanceDetachedFromStore(
    url: string,
  ): Promise<CardDef | CardError> {
    let cached = this.identityContext.get(url);
    if (cached) {
      return cached;
    }
    try {
      let doc = await this.cardService.fetchJSON(url);
      if (!doc) {
        return {
          id: url,
          status: 404,
          title: 'Card Not Found',
          message: `The card ${url} does not exist`,
          realm: undefined,
          meta: {
            lastKnownGoodHtml: null,
            scopedCssUrls: [],
            stack: null,
            cardTitle: null,
          },
        };
      }
      let instance = await this.cardService.createFromSerialized(
        doc.data as LooseCardResource,
        doc,
        new URL(url),
      );
      this.identityContext.set(url, instance);
      this.markForGarbageCollection(url);
      return instance;
    } catch (error: any) {
      let errorResponse = processCardError(url, error);
      return errorResponse.errors[0];
    }
  }

  private handleInvalidations = (event: RealmEventContent) => {
    if (event.eventName !== 'index') {
      return;
    }

    if (event.indexType !== 'incremental') {
      return;
    }
    let invalidations = event.invalidations as string[];

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
          if (
            !event.clientRequestId ||
            !this.cardService.clientRequestIds.has(event.clientRequestId)
          ) {
            this.reload.perform(liveCard);
          } else {
            if (this.cardService.clientRequestIds.has(event.clientRequestId)) {
              console.debug(
                'ignoring invalidation for card because clientRequestId is ours',
                event,
              );
            }
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
      await this.handleUpdatedCard(oldCard, cardOrError);
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
        let errorResponse = processCardError(card.id, err);
        maybeReloadedCard = errorResponse.errors[0];
      }
    }
    await this.handleUpdatedCard(card, maybeReloadedCard);
    if (isDelete) {
      this.identityContext.delete(card.id);
    }
    this.notifyLiveResources(card.id, maybeReloadedCard);
  });

  private async handleUpdatedCard(
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
      if (!this.cardApiCache) {
        this.cardApiCache = await this.cardService.getAPI();
      }
      for (let subscriber of this.subscribers.get(maybeUpdatedCard.id)
        ?.resources ?? []) {
        if (!subscriber.resourceState.onCardChange) {
          continue;
        }
        let autoSaveState;
        if (oldCard) {
          this.cardApiCache.unsubscribeFromChanges(
            oldCard,
            subscriber.resourceState.onCardChange,
          );
          autoSaveState = this.autoSaveStates.get(oldCard);
          this.autoSaveStates.delete(oldCard);
        }
        if (isCardInstance(maybeUpdatedCard)) {
          this.cardApiCache.subscribeToChanges(
            maybeUpdatedCard,
            subscriber.resourceState.onCardChange,
          );
          if (autoSaveState) {
            this.autoSaveStates.set(maybeUpdatedCard, autoSaveState);
          }
        }
      }
    }
  }

  private notifyLiveResources(
    url: string,
    maybeCard: CardDef | CardError | undefined,
  ) {
    for (let { setCard, setCardError } of this.subscribers.get(url)
      ?.resources ?? []) {
      if (!setCard || !setCardError) {
        continue;
      }
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

  private async getCard(
    urlOrDoc: string | LooseSingleCardDocument,
    relativeTo?: URL,
  ) {
    let url = asURL(urlOrDoc);
    try {
      if (!url) {
        // this is a new card so instantiate it and save it
        let doc = urlOrDoc as LooseSingleCardDocument;
        let newCard = await this.cardService.createFromSerialized(
          doc.data,
          doc,
          relativeTo,
          {
            identityContext: this.identityContext,
          },
        );
        await this.cardService.saveModel(newCard);
        this.identityContext.set(newCard.id, newCard);
        return newCard;
      }
      clearTimeout(this.garbageCollection.get(url));

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
      let errorResponse = processCardError(url, error);
      return errorResponse.errors[0];
    }
  }

  getAutoSaveState(card: CardDef): AutoSaveState | undefined {
    return this.autoSaveStates.get(card);
  }

  save(id: string) {
    this.initiateAutoSaveTask.perform(id, { isImmediate: true });
  }

  private initiateAutoSaveTask = restartableTask(
    async (id: string, opts?: { isImmediate?: true }) => {
      let card = this.identityContext.get(id);
      if (!card) {
        return;
      }
      let autoSaveState = this.initOrGetAutoSaveState(card);
      autoSaveState.hasUnsavedChanges = true;
      if (!opts?.isImmediate) {
        await timeout(this.environmentService.autoSaveDelayMs);
      }
      try {
        autoSaveState.isSaving = true;
        autoSaveState.lastSaveError = undefined;

        if (!opts?.isImmediate) {
          await timeout(25);
        }
        await this.saveCard.perform(card, opts);

        autoSaveState.hasUnsavedChanges = false;
        autoSaveState.lastSaved = Date.now();
        autoSaveState.lastSaveError = undefined;
        autoSaveState.lastSavedErrorMsg = undefined;
      } catch (error) {
        // error will already be logged in CardService
        autoSaveState.lastSaveError = error as Error;
      } finally {
        autoSaveState.isSaving = false;
        this.calculateLastSavedMsg(autoSaveState);
      }
    },
  );

  private initOrGetAutoSaveState(card: CardDef): AutoSaveState {
    let autoSaveState = this.autoSaveStates.get(card);
    if (!autoSaveState) {
      autoSaveState = new TrackedObject({
        isSaving: false,
        hasUnsavedChanges: false,
        lastSaved: undefined,
        lastSavedErrorMsg: undefined,
        lastSaveError: undefined,
      });
      this.autoSaveStates.set(card, autoSaveState!);
    }
    return autoSaveState!;
  }

  private saveCard = restartableTask(
    async (card: CardDef, opts?: { isImmediate?: true }) => {
      if (opts?.isImmediate) {
        await this.cardService.saveModel(card);
      } else {
        // these saves can happen so fast that we'll make sure to wait at
        // least 500ms for human consumption
        await all([this.cardService.saveModel(card), timeout(500)]);
      }
    },
  );

  private calculateLastSavedMsg(autoSaveState: AutoSaveState) {
    let savedMessage: string | undefined;
    if (autoSaveState.lastSaveError) {
      savedMessage = `Failed to save: ${this.getErrorMessage(
        autoSaveState.lastSaveError,
      )}`;
    } else if (autoSaveState.lastSaved) {
      savedMessage = `Saved ${formatDistanceToNow(autoSaveState.lastSaved, {
        addSuffix: true,
      })}`;
    }
    if (autoSaveState.lastSavedErrorMsg != savedMessage) {
      autoSaveState.lastSavedErrorMsg = savedMessage;
    }
  }

  private getErrorMessage(error: Error) {
    if ((error as any).responseHeaders?.get('x-blocked-by-waf-rule')) {
      return 'Rejected by firewall';
    }
    if (error.message) {
      return error.message;
    }
    return 'Unknown error';
  }
}

function processCardError(url: string | undefined, error: any): CardErrors {
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
              id: url,
              status: 404,
              title: 'Card Not Found',
              message: `The card ${url} does not exist`,
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
              id: url,
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
