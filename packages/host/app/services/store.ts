import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import Service, { service } from '@ember/service';
import { buildWaiter } from '@ember/test-waiters';

import { isTesting } from '@embroider/macros';

import { formatDistanceToNow } from 'date-fns';
import { all, restartableTask, task, timeout } from 'ember-concurrency';

import { stringify } from 'qs';

import status from 'statuses';

import { TrackedObject, TrackedWeakMap } from 'tracked-built-ins';

import {
  hasExecutableExtension,
  isCardInstance,
  isSingleCardDocument,
  isCardCollectionDocument,
  Deferred,
  type Store as StoreInterface,
  type Query,
  type PatchData,
  type Relationship,
  type AutoSaveState,
  type CardDocument,
  type SingleCardDocument,
  type LooseSingleCardDocument,
  type LooseCardResource,
  type CardErrorJSONAPI as CardError,
  type CardErrorsJSONAPI as CardErrors,
} from '@cardstack/runtime-common';

import { type CardDef } from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';

import type { RealmEventContent } from 'https://cardstack.com/base/matrix-event';

import IdentityContext, { getDeps } from '../lib/gc-identity-context';

import { type CardSaveSubscriber } from './card-service';

import EnvironmentService from './environment-service';

import type CardService from './card-service';
import type LoaderService from './loader-service';
import type MessageService from './message-service';
import type RealmService from './realm';
import type ResetService from './reset';

import type { CardResource } from '../resources/card-resource';
import type { SearchResource } from '../resources/search';

export { CardError, CardSaveSubscriber };

let waiter = buildWaiter('store-service');

export default class StoreService extends Service implements StoreInterface {
  @service declare private realm: RealmService;
  @service declare private loaderService: LoaderService;
  @service declare private messageService: MessageService;
  @service declare private cardService: CardService;
  @service declare private environmentService: EnvironmentService;
  @service declare private reset: ResetService;
  declare private identityContext: IdentityContext;
  private localIds: Map<string, string | null> = new Map(); // localId => remoteId
  private unsavedConsumers: Map<
    string,
    {
      resource: CardResource | SearchResource;
      isAutoSaved?: boolean;
      setCard?: (card: CardDef | undefined) => void;
      setCardError?: (error: CardError | undefined) => void;
    }
  > = new Map();
  private subscriptions: Map<string, { unsubscribe: () => void }> = new Map();
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
  private _api?: typeof CardAPI;
  private gcInterval: number | undefined;
  private ready: Promise<void>;
  private inflightCards: Map<string, Promise<CardDef | CardError>> = new Map();

  // This is used for tests
  private onSaveSubscriber: CardSaveSubscriber | undefined;

  constructor(owner: Owner) {
    super(owner);
    this.reset.register(this);
    this.ready = this.setup();
    registerDestructor(this, () => {
      clearInterval(this.gcInterval);
    });
  }

  // used for tests only!
  _onSave(subscriber: CardSaveSubscriber) {
    this.onSaveSubscriber = subscriber;
    this.cardService._onSave(subscriber);
  }

  // used for tests only!
  _unregisterSaveSubscriber() {
    this.onSaveSubscriber = undefined;
    this.cardService._unregisterSaveSubscriber();
  }

  resetState() {
    clearInterval(this.gcInterval);
    this.subscriptions = new Map();
    this.onSaveSubscriber = undefined;
    this.subscribers = new Map();
    this.autoSaveStates = new TrackedWeakMap();
    this.inflightCards = new Map();
    this.ready = this.setup();
  }

  // TODO cleanup this.unsavedConsumers
  unloadResource(resource: CardResource) {
    let id = resource.id;
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
          let autoSaveState = this.getSaveState(resource.card);
          if (autoSaveState?.hasUnsavedChanges) {
            this.initiateAutoSaveTask.perform(id, { isImmediate: true });
          }
          let card = this.identityContext.get(id);

          // using this._api in case the unload happens before this.ready is fulfilled
          if (this._api && card) {
            this._api?.unsubscribeFromChanges(card, onCardChange);
          }
        }
        resources.splice(index, 1);
      }
      if (resources.length === 0) {
        this.subscribers.delete(id);
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
    idOrDoc,
    setCard,
    setCardError,
    isLive,
    isAutoSaved,
  }: {
    resource: CardResource | SearchResource;
    idOrDoc: string | LooseSingleCardDocument;
    setCard?: (card: CardDef | undefined) => void;
    setCardError?: (error: CardError | undefined) => void;
    isLive?: boolean;
    isAutoSaved?: boolean;
  }): Promise<{
    instance: CardDef | undefined;
    error: CardError | undefined;
  }> {
    await this.ready;

    let maybeUrl = asURL(idOrDoc);
    let url: string | undefined;
    let localId: string | undefined;
    if (maybeUrl?.startsWith('http')) {
      url = maybeUrl;
    } else {
      localId = maybeUrl;
    }
    if (!url && !localId) {
      throw new Error(`Cannot create subscriber with doc that has no ID`);
    }

    if (localId) {
      let instance = this.identityContext.get(localId);
      if (!instance) {
        throw new Error(
          `Instance with local ID ${localId} does not exist in the store`,
        );
      }
      this.unsavedConsumers.set(localId, {
        resource,
        isAutoSaved,
        setCard,
        setCardError,
      });
      return { instance, error: undefined };
    }
    if (!url) {
      throw new Error(
        `Should never get here, if the identifier is not a local ID, then it must be a URL: ${maybeUrl}`,
      );
    }

    let cardOrError = await this.getInstance({ urlOrDoc: idOrDoc });
    let instance = isCardInstance(cardOrError) ? cardOrError : undefined;
    let error = !isCardInstance(cardOrError) ? cardOrError : undefined;
    if (!isLive) {
      await this.handleUpdatedInstance(undefined, cardOrError);
      return {
        instance,
        error,
      };
    }

    if (!instance) {
      console.warn(`cannot load card ${url}`, cardOrError);
    }

    this.addRealmSubscription({
      url,
      resource,
      instance,
      isAutoSaved,
      setCard,
      setCardError,
    });
    await this.handleUpdatedInstance(undefined, cardOrError);
    return { instance, error };
  }

  // This method creates a new instance in the store and return the new card ID
  async create(
    doc: LooseSingleCardDocument,
    relativeTo: URL | undefined,
    realm?: string,
  ): Promise<string | CardError> {
    await this.ready;
    let token = waiter.beginAsync();
    try {
      await this.ready;
      let cardOrError = await this.getInstance({
        urlOrDoc: doc,
        relativeTo,
        realm,
      });
      if (isCardInstance(cardOrError)) {
        return cardOrError.id;
      }
      return cardOrError;
    } finally {
      waiter.endAsync(token);
    }
  }

  save(id: string) {
    this.initiateAutoSaveTask.perform(id, { isImmediate: true });
  }

  // Instances that are saved via this method are eligible for garbage
  // collection--meaning that it will be detached from the store. This means you
  // MUST consume the instance IMMEDIATELY! it should not live in the state of
  // the consumer.

  // This method adds or creates a new instance to the store and returns an
  // instance eligible for garbage collection.
  async add<T extends CardDef>(
    instanceOrDoc: T | LooseSingleCardDocument,
    opts?: {
      realm?: string;
      relativeTo?: URL | undefined;
      doNotPersist?: true;
    },
  ) {
    await this.ready;
    let instance: T;
    if (!isCardInstance(instanceOrDoc)) {
      instance = await this.createFromSerialized(
        instanceOrDoc.data,
        instanceOrDoc,
        opts?.relativeTo,
      );
    } else {
      instance = instanceOrDoc;
      this.guardAgainstUnknownInstances(instance);
    }
    this.assertLocalIdMapping(instance);
    this.identityContext.set(instance.id, instance);

    if (!opts?.doNotPersist) {
      if (instance.id) {
        this.save(instance.id);
      } else {
        await this.persistAndUpdate(instance, opts?.realm);
      }
    }
    return instance;
  }

  // This method is used for specific scenarios where you just want an instance
  // that is not auto saving and not receiving live updates and is eligible for
  // garbage collection--meaning that it will be detached from the store. This
  // means you MUST consume the instance IMMEDIATELY! it should not live in the
  // state of the consumer.
  async peek<T extends CardDef>(id: string): Promise<T | CardError> {
    await this.ready;
    let cached = this.identityContext.get(id);
    if (cached) {
      return cached as T;
    }
    return await this.getInstance<T>({ urlOrDoc: id });
  }

  async delete(id: string): Promise<void> {
    if (!id) {
      // the card isn't actually saved yet, so do nothing
      return;
    }
    this.identityContext.delete(id);
    await this.cardService.fetchJSON(id, { method: 'DELETE' });
  }

  // This method is used for specific scenarios where you just want an instance
  // that is not auto saving and not receiving live updates and is eligible for
  // garbage collection--meaning that it will be detached from the store. This
  // means you MUST consume the instance IMMEDIATELY! it should not live in the
  // state of the consumer.
  async patch(
    instance: CardDef,
    doc: LooseSingleCardDocument,
    patchData: PatchData,
  ): Promise<void> {
    await this.ready;
    this.assertLocalIdMapping(instance);
    let linkedCards = await this.loadPatchedInstances(
      patchData,
      new URL(instance.id),
    );
    for (let [field, value] of Object.entries(linkedCards)) {
      if (field.includes('.')) {
        let parts = field.split('.');
        let leaf = parts.pop();
        if (!leaf) {
          throw new Error(`bug: error in field name "${field}"`);
        }
        let inner = instance;
        for (let part of parts) {
          inner = (inner as any)[part];
        }
        (inner as any)[leaf.match(/^\d+$/) ? Number(leaf) : leaf] = value;
      } else {
        // TODO this could trigger a save. perhaps instead we could
        // introduce a new option to updateFromSerialized to accept a list of
        // fields to pre-load? which in this case would be any relationships that
        // were patched in
        (instance as any)[field] = value;
      }
    }
    await this.api.updateFromSerialized<typeof CardDef>(
      instance,
      doc,
      this.identityContext,
    );
    await this.persistAndUpdate(instance);
  }

  // This method is used for specific scenarios where you just want instances
  // that are not auto saving and not receiving live updates and are eligible for
  // garbage collection--meaning that it will be detached from the store. This
  // means you MUST consume the instance IMMEDIATELY! they should not live in the
  // state of the consumer.
  async search(query: Query, realmURL: URL): Promise<CardDef[]> {
    await this.ready;
    let json = await this.cardService.fetchJSON(
      `${realmURL}_search?${stringify(query, { strictNullHandling: true })}`,
    );
    if (!isCardCollectionDocument(json)) {
      throw new Error(
        `The realm search response was not a card collection document:
        ${JSON.stringify(json, null, 2)}`,
      );
    }
    let collectionDoc = json;
    return (
      await Promise.all(
        collectionDoc.data.map(async (doc) => {
          try {
            return await this.getInstance({
              urlOrDoc: { data: doc },
              relativeTo: new URL(doc.id),
            });
          } catch (e) {
            console.warn(
              `Skipping ${
                doc.id
              }. Encountered error deserializing from search result for query ${JSON.stringify(
                query,
                null,
                2,
              )} against realm ${realmURL}`,
              e,
            );
            return undefined;
          }
        }),
      )
    ).filter(Boolean) as CardDef[];
  }

  getSaveState(instance: CardDef): AutoSaveState | undefined {
    return this.autoSaveStates.get(instance);
  }

  private get api(): typeof CardAPI {
    if (!this._api) {
      throw new Error(
        `please await this.ready before trying to access this.api`,
      );
    }
    return this._api;
  }

  private assertLocalIdMapping(instance: CardDef) {
    let localId = instance[this.api.localId];
    let existingRemoteId = this.localIds.get(localId);
    if (existingRemoteId && instance.id !== existingRemoteId) {
      throw new Error(
        `the instance ${instance.constructor.name} with local id ${localId} has conflicting remote id: ${instance.id} and ${existingRemoteId}`,
      );
    }
    this.localIds.set(localId, instance.id ?? null);
  }

  private async createFromSerialized<T extends CardDef>(
    resource: LooseCardResource,
    doc: LooseSingleCardDocument | CardDocument,
    relativeTo?: URL | undefined,
  ): Promise<T> {
    await this.ready;
    let card = (await this.api.createFromSerialized(resource, doc, relativeTo, {
      identityContext: this.identityContext,
    })) as T;
    // it's important that we absorb the field async here so that glimmer won't
    // encounter NotLoaded errors, since we don't have the luxury of the indexer
    // being able to inform us of which fields are used or not at this point.
    // (this is something that the card compiler could optimize for us in the
    // future)
    await this.api.recompute(card, {
      recomputeAllFields: true,
      loadFields: true,
    });
    return card;
  }

  private async guardAgainstUnknownInstances(instance: CardDef) {
    if (instance.id && this.identityContext.get(instance.id) !== instance) {
      throw new Error(
        `tried to add ${instance.id} to the store, but the store already has a different instance with this id. Please obtain the instances that already exists from the store`,
      );
    }
    await this.ready;
    let deps = getDeps(this.api, instance);
    for (let dep of deps) {
      if (dep.id && !this.identityContext.get(dep.id)) {
        this.identityContext.set(dep.id, dep);
      } else if (dep.id && this.identityContext.get(dep.id) !== dep) {
        throw new Error(
          `encountered a dependency, ${dep.id}, of ${instance.id} when adding ${instance.id} to the store, but the store already has a different instance with this dependency's id. Please obtain the instances that already exists from the store`,
        );
      }
    }
  }

  private async setup() {
    this._api = await this.cardService.getAPI();
    this.identityContext = new IdentityContext(
      this.api,
      this.subscribers,
      this.localIds,
    );
    this.gcInterval = setInterval(
      () => this.identityContext.sweep(),
      2 * 60_000,
    ) as unknown as number;
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
        let liveInstance = this.identityContext.get(invalidation);
        if (liveInstance) {
          // Do not reload if the event is a result of a request that we made. Otherwise we risk overwriting
          // the inputs with past values. This can happen if the user makes edits in the time between the auto
          // save request and the arrival SSE event.
          if (
            !event.clientRequestId ||
            !this.cardService.clientRequestIds.has(event.clientRequestId)
          ) {
            this.reloadTask.perform(liveInstance);
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
          this.loadInstanceTask.perform(invalidation);
        }
      }
    }
  };

  private loadInstanceTask = restartableTask(
    async (urlOrDoc: string | LooseSingleCardDocument) => {
      let url = asURL(urlOrDoc);
      let oldInstance = url ? this.identityContext.get(url) : undefined;
      let instanceOrError = await this.getInstance({ urlOrDoc });
      await this.handleUpdatedInstance(oldInstance, instanceOrError);
      if (url) {
        this.notifyLiveResources(url, instanceOrError);
      }
    },
  );

  private reloadTask = task(async (instance: CardDef) => {
    let maybeReloadedInstance: CardDef | CardError | undefined;
    let isDelete = false;
    try {
      await this.reloadInstance(instance);
      maybeReloadedInstance = instance;
    } catch (err: any) {
      if (err.status === 404) {
        // in this case the document was invalidated in the index because the
        // file was deleted
        isDelete = true;
      } else {
        let errorResponse = processCardError(instance.id, err);
        maybeReloadedInstance = errorResponse.errors[0];
      }
    }
    await this.handleUpdatedInstance(instance, maybeReloadedInstance);
    if (isDelete) {
      this.identityContext.delete(instance.id);
    }
    this.notifyLiveResources(instance.id, maybeReloadedInstance);
  });

  private async handleUpdatedInstance(
    oldInstance: CardDef | undefined,
    maybeUpdatedInstance: CardDef | CardError | undefined,
  ) {
    let instance: CardDef | undefined;
    if (isCardInstance(maybeUpdatedInstance)) {
      instance = maybeUpdatedInstance;
      this.identityContext.set(instance.id, instance);
    } else if (maybeUpdatedInstance?.id) {
      this.identityContext.set(maybeUpdatedInstance.id, undefined);
    }

    await this.ready;
    if (maybeUpdatedInstance?.id) {
      for (let subscriber of this.subscribers.get(maybeUpdatedInstance.id)
        ?.resources ?? []) {
        if (!subscriber.resourceState.onCardChange) {
          continue;
        }
        let autoSaveState;
        if (oldInstance) {
          this.api.unsubscribeFromChanges(
            oldInstance,
            subscriber.resourceState.onCardChange,
          );
          autoSaveState = this.autoSaveStates.get(oldInstance);
          this.autoSaveStates.delete(oldInstance);
        }
        if (isCardInstance(maybeUpdatedInstance)) {
          this.api.subscribeToChanges(
            maybeUpdatedInstance,
            subscriber.resourceState.onCardChange,
          );
          if (autoSaveState) {
            this.autoSaveStates.set(maybeUpdatedInstance, autoSaveState);
          }
        }
      }
    }
  }

  private notifyLiveResources(
    url: string,
    maybeInstance: CardDef | CardError | undefined,
  ) {
    for (let { setCard, setCardError } of this.subscribers.get(url)
      ?.resources ?? []) {
      if (!setCard || !setCardError) {
        continue;
      }
      if (!maybeInstance) {
        setCard(undefined);
        setCardError(undefined);
      } else if (isCardInstance(maybeInstance)) {
        setCard(maybeInstance);
        setCardError(undefined);
      } else {
        setCard(undefined);
        setCardError(maybeInstance);
      }
    }
  }

  private async getInstance<T extends CardDef>({
    urlOrDoc,
    relativeTo,
    realm,
  }: {
    urlOrDoc: string | LooseSingleCardDocument;
    relativeTo?: URL;
    realm?: string; // used for new cards
  }) {
    let deferred: Deferred<CardDef | CardError> | undefined;
    let url = asURL(urlOrDoc);
    if (url) {
      let working = this.inflightCards.get(url);
      if (working) {
        return working as Promise<T>;
      }
      deferred = new Deferred<CardDef | CardError>();
      this.inflightCards.set(url, deferred.promise);
    }
    try {
      if (!url) {
        // this is a new card so instantiate it and save it
        let doc = urlOrDoc as LooseSingleCardDocument;
        let newInstance = await this.createFromSerialized(
          doc.data,
          doc,
          relativeTo,
        );
        await this.persistAndUpdate(newInstance, realm);
        this.identityContext.set(newInstance.id, newInstance);
        deferred?.fulfill(newInstance);
        return newInstance as T;
      }

      // createFromSerialized would also do this de-duplication, but we want to
      // also avoid the fetchJSON when we already have the stable card.
      let existingInstance = this.identityContext.get(url);
      if (existingInstance) {
        deferred?.fulfill(existingInstance);
        return existingInstance as T;
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
      let instance = await this.createFromSerialized(
        doc.data,
        doc,
        new URL(doc.data.id),
      );
      this.assertLocalIdMapping(instance);
      deferred?.fulfill(instance);
      return instance as T;
    } catch (error: any) {
      let errorResponse = processCardError(url, error);
      let cardError = errorResponse.errors[0];
      deferred?.fulfill(cardError);
      return cardError;
    } finally {
      if (url) {
        this.inflightCards.delete(url);
      }
    }
  }

  private initiateAutoSaveTask = restartableTask(
    async (id: string, opts?: { isImmediate?: true }) => {
      await this.ready;
      let instance = this.identityContext.get(id);
      if (!instance) {
        return;
      }
      let autoSaveState = this.initOrGetAutoSaveState(instance);
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
        await this.saveInstanceTask.perform(instance, opts);

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

  private initOrGetAutoSaveState(instance: CardDef): AutoSaveState {
    let autoSaveState = this.autoSaveStates.get(instance);
    if (!autoSaveState) {
      autoSaveState = new TrackedObject({
        isSaving: false,
        hasUnsavedChanges: false,
        lastSaved: undefined,
        lastSavedErrorMsg: undefined,
        lastSaveError: undefined,
      });
      this.autoSaveStates.set(instance, autoSaveState!);
    }
    return autoSaveState!;
  }

  private saveInstanceTask = restartableTask(
    async (card: CardDef, opts?: { isImmediate?: true }) => {
      if (opts?.isImmediate) {
        await this.persistAndUpdate(card);
      } else {
        // these saves can happen so fast that we'll make sure to wait at
        // least 500ms for human consumption
        await all([this.persistAndUpdate(card), timeout(500)]);
      }
    },
  );

  private async saveCardDocument(
    doc: LooseSingleCardDocument,
    realmUrl: URL,
  ): Promise<SingleCardDocument> {
    let isSaved = !!doc.data.id;
    let json = await this.cardService.fetchJSON(doc.data.id ?? realmUrl, {
      method: isSaved ? 'PATCH' : 'POST',
      body: JSON.stringify(doc, null, 2),
    });
    if (!isSingleCardDocument(json)) {
      throw new Error(
        `bug: arg is not a card document:
        ${JSON.stringify(json, null, 2)}`,
      );
    }
    return json;
  }

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

  private async persistAndUpdate(
    instance: CardDef,
    defaultRealmHref?: string,
  ): Promise<void> {
    let cardChanged = false;
    function onCardChange() {
      cardChanged = true;
    }
    let token = waiter.beginAsync();
    let api: typeof CardAPI | undefined;
    await this.ready;
    try {
      this.api.subscribeToChanges(instance, onCardChange);
      let doc = await this.cardService.serializeCard(instance, {
        // for a brand new card that has no id yet, we don't know what we are
        // relativeTo because its up to the realm server to assign us an ID, so
        // URL's should be absolute
        useAbsoluteURL: true,
      });

      // send doc over the wire with absolute URL's. The realm server will convert
      // to relative URL's as it serializes the cards
      let realmURL = await this.cardService.getRealmURL(instance);
      // in the case where we get no realm URL from the card, we are dealing with
      // a new card instance that does not have a realm URL yet.
      if (!realmURL) {
        defaultRealmHref =
          defaultRealmHref ?? this.realm.defaultWritableRealm?.path;
        if (!defaultRealmHref) {
          throw new Error('Could not find a writable realm');
        }
        realmURL = new URL(defaultRealmHref);
      }
      let json = await this.saveCardDocument(doc, realmURL);
      let isNew = !instance.id;

      // if the card changed while the save was in flight then don't load the
      // server's version of the card--the next auto save will include these
      // unsaved changes.
      if (!cardChanged) {
        // in order to preserve object equality with the unsaved card instance we
        // should always use updateFromSerialized()--this way a newly created
        // instance that does not yet have an id is still the same instance after an
        // ID has been assigned by the server.
        await this.api.updateFromSerialized(instance, json);
      } else if (isNew) {
        // in this case a new card was created, but there is an immediate change
        // that was made--so we save off the new ID for the card so in the next
        // save we'll correlate to the correct card ID
        instance.id = json.data.id;
      }
      if (this.onSaveSubscriber) {
        this.onSaveSubscriber(new URL(json.data.id), json);
      }
      this.assertLocalIdMapping(instance);

      let unsavedConsumer = this.unsavedConsumers.get(
        instance[this.api.localId],
      );
      if (isNew && unsavedConsumer) {
        let { resource, isAutoSaved, setCard, setCardError } = unsavedConsumer;
        this.addRealmSubscription({
          url: instance.id,
          resource,
          instance,
          isAutoSaved,
          setCard,
          setCardError,
        });
      }
    } catch (err) {
      console.error(`Failed to save ${instance.id}: `, err);
      throw err;
    } finally {
      api?.unsubscribeFromChanges(instance, onCardChange);
      waiter.endAsync(token);
    }
  }

  private async reloadInstance(instance: CardDef): Promise<void> {
    // we don't await this in the realm subscription callback, so this test
    // waiter should catch otherwise leaky async in the tests
    await this.withTestWaiters(async () => {
      await this.ready;
      let incomingDoc: SingleCardDocument = (await this.cardService.fetchJSON(
        instance.id,
        undefined,
      )) as SingleCardDocument;

      if (!isSingleCardDocument(incomingDoc)) {
        throw new Error(
          `bug: server returned a non card document for ${instance.id}:
        ${JSON.stringify(incomingDoc, null, 2)}`,
        );
      }
      await this.api.updateFromSerialized<typeof CardDef>(
        instance,
        incomingDoc,
        this.identityContext,
      );
    });
  }

  private addRealmSubscription({
    resource,
    instance,
    url,
    isAutoSaved,
    setCard,
    setCardError,
  }: {
    resource: CardResource | SearchResource;
    instance: CardDef | undefined;
    url: string | undefined;
    isAutoSaved?: boolean;
    setCard?: (card: CardDef | undefined) => void;
    setCardError?: (error: CardError | undefined) => void;
  }) {
    url = url ?? instance?.id;
    if (!url) {
      throw new Error(
        `Cannot add a realm subscription without an instance URL`,
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
      subscriber.resources.push({
        resourceState: {
          resource,
          onCardChange: isAutoSaved
            ? () => {
                if (instance) {
                  // Using the card ID instead, so this function doesn't need to be updated
                  // when the card instance changes.
                  this.initiateAutoSaveTask.perform(url!);
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
  }

  private async loadPatchedInstances(
    patchData: PatchData,
    relativeTo: URL,
  ): Promise<{
    [fieldName: string]: CardDef | CardDef[];
  }> {
    if (!patchData?.relationships) {
      return {};
    }
    let result: { [fieldName: string]: CardDef | CardDef[] } = {};
    await Promise.all(
      Object.entries(patchData.relationships).map(async ([fieldName, rel]) => {
        if (Array.isArray(rel)) {
          let instances: CardDef[] = [];
          await Promise.all(
            rel.map(async (r) => {
              let instance = await this.loadRelationshipInstance(r, relativeTo);
              if (instance) {
                instances.push(instance);
              }
            }),
          );
          result[fieldName] = instances;
        } else {
          let instance = await this.loadRelationshipInstance(rel, relativeTo);
          if (instance) {
            result[fieldName] = instance;
          }
        }
      }),
    );
    return result;
  }

  private async loadRelationshipInstance(rel: Relationship, relativeTo: URL) {
    if (!rel.links.self) {
      return;
    }
    let id = rel.links.self;
    let instance = await this.getInstance({
      urlOrDoc: new URL(id, relativeTo).href,
    });
    return isCardInstance(instance) ? instance : undefined;
  }

  private async withTestWaiters<T>(cb: () => Promise<T>) {
    let token = waiter.beginAsync();
    try {
      let result = await cb();
      // only do this in test env--this makes sure that we also wait for any
      // interior card instance async as part of our ember-test-waiters
      if (isTesting()) {
        await this.cardService.cardsSettled();
      }
      return result;
    } finally {
      waiter.endAsync(token);
    }
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
