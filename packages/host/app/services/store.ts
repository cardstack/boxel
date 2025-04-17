import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import Service, { service } from '@ember/service';
import { buildWaiter } from '@ember/test-waiters';

import { isTesting } from '@embroider/macros';

import { formatDistanceToNow } from 'date-fns';
import { task, timeout } from 'ember-concurrency';

import { stringify } from 'qs';

import status from 'statuses';

import { TrackedObject, TrackedMap } from 'tracked-built-ins';

import {
  hasExecutableExtension,
  isCardInstance,
  isSingleCardDocument,
  isCardCollectionDocument,
  Deferred,
  delay,
  realmURL as realmURLSymbol,
  localId as localIdSymbol,
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

import {
  type CardDef,
  type BaseDef,
} from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';

import type { RealmEventContent } from 'https://cardstack.com/base/matrix-event';

import IdentityContext, {
  getDeps,
  type ReferenceCount,
} from '../lib/gc-identity-context';

import { type CardSaveSubscriber } from './card-service';

import EnvironmentService from './environment-service';

import type CardService from './card-service';
import type LoaderService from './loader-service';
import type MessageService from './message-service';
import type RealmService from './realm';
import type ResetService from './reset';

export { CardError, CardSaveSubscriber };

let waiter = buildWaiter('store-service');

export default class StoreService extends Service implements StoreInterface {
  @service declare private realm: RealmService;
  @service declare private loaderService: LoaderService;
  @service declare private messageService: MessageService;
  @service declare private cardService: CardService;
  @service declare private environmentService: EnvironmentService;
  @service declare private reset: ResetService;
  private subscriptions: Map<string, { unsubscribe: () => void }> = new Map();
  private referenceCount: ReferenceCount = new Map();
  private newReferencePromises: Promise<void>[] = [];
  private autoSaveStates: TrackedMap<string, AutoSaveState> = new TrackedMap();
  private cardApiCache?: typeof CardAPI;
  private gcInterval: number | undefined;
  private ready: Promise<void>;
  private inflightCards: Map<string, Promise<CardDef | CardError>> = new Map();
  private identityContext = new IdentityContext(this.referenceCount);

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
    this.referenceCount = new Map();
    this.newReferencePromises = [];
    this.autoSaveStates = new TrackedMap();
    this.inflightCards = new Map();
    this.identityContext = new IdentityContext(this.referenceCount);
    this.ready = this.setup();
  }

  dropReference(id: string | undefined) {
    if (!id) {
      return;
    }
    let currentReferenceCount = this.referenceCount.get(id) ?? 0;
    currentReferenceCount -= 1;
    this.referenceCount.set(id, currentReferenceCount);

    console.debug(
      `dropping reference to ${id}, current reference count: ${this.referenceCount.get(id)}`,
    );
    if (currentReferenceCount <= 0) {
      this.referenceCount.delete(id);
      let autoSaveState = this.autoSaveStates.get(id);
      if (autoSaveState?.hasUnsavedChanges) {
        this.initiateAutoSaveTask.perform(id, { isImmediate: true });
      }
      // await for a microtask to prevent rerender dirty tag error so we don't
      // get in trouble because we read this.autosaveStates in the same frame as
      // we mutate this.autosaveStates
      (async () => {
        await Promise.resolve();
        this.autoSaveStates.delete(id);
      })();

      let instance = this.identityContext.get(id);
      if (instance) {
        if (this.cardApiCache && instance) {
          this.cardApiCache?.unsubscribeFromChanges(
            instance,
            this.onInstanceUpdated,
          );

          // if there are no more subscribers to this realm then unsubscribe from realm
          let realm = instance[this.cardApiCache.realmURL];
          if (!realm) {
            return;
          }

          let subscription = this.subscriptions.get(realm.href);
          if (
            subscription &&
            ![...this.referenceCount.entries()].find(
              ([id, count]) =>
                id.startsWith('http') &&
                count > 0 &&
                this.realm.realmOfURL(new URL(id))?.href === realm!.href,
            )
          ) {
            subscription.unsubscribe();
            this.subscriptions.delete(realm.href);
          }
        }
      }
    }
  }

  addReference(idOrDoc: string | SingleCardDocument | undefined) {
    if (!idOrDoc) {
      return;
    }
    let id = asURL(idOrDoc);
    if (!id) {
      throw new Error(`Cannot add reference with no id`);
    }
    // synchronously update the reference count so we don't run into race
    // conditions requiring a mutex
    let currentReferenceCount = this.referenceCount.get(id) ?? 0;
    currentReferenceCount += 1;
    this.referenceCount.set(id, currentReferenceCount);
    console.debug(
      `adding reference to ${id}, current reference count: ${this.referenceCount.get(id)}`,
    );

    // intentionally not awaiting this. we keep track of the promise in
    // this.newReferencePromises
    this.wireUpNewReference(idOrDoc);
  }

  // This method creates a new instance in the store and return the new card ID
  async create(
    doc: LooseSingleCardDocument,
    relativeTo: URL | undefined,
    realm?: string,
  ): Promise<string | CardError> {
    return await this.withTestWaiters(async () => {
      let cardOrError = await this.getInstance({
        urlOrDoc: doc,
        relativeTo,
        realm,
      });
      if (isCardInstance(cardOrError)) {
        return cardOrError.id;
      }
      return cardOrError;
    });
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
    this.identityContext.set(instance.id ?? instance[localIdSymbol], instance);

    if (!opts?.doNotPersist) {
      if (instance.id) {
        this.save(instance.id);
      } else {
        await this.persistAndUpdate(instance, opts?.realm);
      }
    }
    return instance;
  }

  peek<T extends CardDef>(id: string): T | CardError | undefined {
    return this.identityContext.getInstanceOrError(id) as T | undefined;
  }

  // This method is used for specific scenarios where you just want an instance
  // that is not auto saving and not receiving live updates and is eligible for
  // garbage collection--meaning that it will be detached from the store. This
  // means you MUST consume the instance IMMEDIATELY! it should not live in the
  // state of the consumer.
  async get<T extends CardDef>(id: string): Promise<T | CardError> {
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
    this.guardAgainstUnknownInstances(instance);
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
    let api = await this.cardService.getAPI();
    await api.updateFromSerialized<typeof CardDef>(
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

  getSaveState(id: string): AutoSaveState | undefined {
    return this.autoSaveStates.get(id);
  }

  async flush() {
    await this.ready;
    return await Promise.allSettled(this.newReferencePromises);
  }

  private async wireUpNewReference(idOrDoc: string | SingleCardDocument) {
    let deferred = new Deferred<void>();
    await this.withTestWaiters(async () => {
      this.newReferencePromises.push(deferred.promise);
      let maybeUrl: string | undefined;
      let isDoc = typeof idOrDoc !== 'string';
      try {
        await this.ready;
        maybeUrl = asURL(idOrDoc);
        if (!maybeUrl?.startsWith('http')) {
          deferred.fulfill();
          return;
        }
        if (!maybeUrl) {
          throw new Error(`Cannot wire up a reference without an id`);
        }
        let url = maybeUrl;
        let urlOrDoc = idOrDoc;
        let instanceOrError = this.peek(url);
        if (!instanceOrError || isDoc) {
          instanceOrError = await this.getInstance({
            urlOrDoc,
            opts: { noCache: isDoc },
          });
        }
        this.subscribeToRealm(new URL(url));
        await this.trackSavedInstance('start-tracking', instanceOrError);

        if (!instanceOrError.id) {
          // keep track of urls for cards that are missing
          this.identityContext.addInstanceOrError(url, instanceOrError);
        }
        deferred.fulfill();
      } catch (e) {
        console.error(
          `error encountered wiring up new reference for ${JSON.stringify(idOrDoc)}`,
          e,
        );
        deferred.reject(e);
      }
    });
  }

  private async createFromSerialized<T extends CardDef>(
    resource: LooseCardResource,
    doc: LooseSingleCardDocument | CardDocument,
    relativeTo?: URL | undefined,
  ): Promise<T> {
    let api = await this.cardService.getAPI();
    let card = (await api.createFromSerialized(resource, doc, relativeTo, {
      identityContext: this.identityContext,
    })) as T;
    // it's important that we absorb the field async here so that glimmer won't
    // encounter NotLoaded errors, since we don't have the luxury of the indexer
    // being able to inform us of which fields are used or not at this point.
    // (this is something that the card compiler could optimize for us in the
    // future)
    await api.recompute(card, {
      recomputeAllFields: true,
      loadFields: true,
    });
    return card;
  }

  private async guardAgainstUnknownInstances(instance: CardDef) {
    let api = await this.cardService.getAPI();
    let deps = getDeps(api, instance);
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
    let api = await this.cardService.getAPI();
    this.gcInterval = setInterval(
      () => this.identityContext.sweep(api),
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
      this.loaderService.resetLoader();
      this.identityContext.reset();
    }

    for (let invalidation of invalidations) {
      if (hasExecutableExtension(invalidation)) {
        // we already dealt with this
        continue;
      }
      let instance = this.identityContext.get(invalidation);
      if (instance) {
        // Do not reload if the event is a result of a request that we made. Otherwise we risk overwriting
        // the inputs with past values. This can happen if the user makes edits in the time between the auto
        // save request and the arrival realm event.
        if (
          !event.clientRequestId ||
          !this.cardService.clientRequestIds.has(event.clientRequestId)
        ) {
          console.debug(`store reloading ${invalidation}`);
          if (!event.clientRequestId) {
            console.debug('because event has null clientRequestId');
          } else if (
            !this.cardService.clientRequestIds.has(event.clientRequestId)
          ) {
            console.debug(
              `because clientRequestId ${event.clientRequestId} is not found in`,
              Array.from(this.cardService.clientRequestIds.values()),
            );
          }

          this.reloadTask.perform(instance);
        } else {
          if (this.cardService.clientRequestIds.has(event.clientRequestId)) {
            if (event.clientRequestId.startsWith('editor:')) {
              console.debug(
                `store reloading ${invalidation} because of source clientRequestId ${event.clientRequestId}`,
              );

              this.reloadTask.perform(instance);
            } else {
              console.debug(
                'ignoring invalidation for card because clientRequestId is ours',
                event,
              );
            }
          }
        }
      } else if (!this.identityContext.get(invalidation)) {
        // load the card using just the ID because we don't have a running card on hand
        this.loadInstanceTask.perform(invalidation);
      }
    }
  };

  private loadInstanceTask = task(
    async (urlOrDoc: string | LooseSingleCardDocument) => {
      let url = asURL(urlOrDoc);
      let oldInstance = url ? this.identityContext.get(url) : undefined;
      let instanceOrError = await this.getInstance({
        urlOrDoc,
        opts: { noCache: true },
      });
      if (oldInstance) {
        await this.trackSavedInstance('stop-tracking', oldInstance);
      }
      await this.trackSavedInstance('start-tracking', instanceOrError);
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
    if (!isCardInstance(maybeReloadedInstance)) {
      await this.trackSavedInstance('stop-tracking', instance);
    }
    if (maybeReloadedInstance) {
      await this.trackSavedInstance('start-tracking', maybeReloadedInstance);
    }
    if (isDelete) {
      await this.trackSavedInstance('stop-tracking', instance);
      this.identityContext.delete(instance.id);
    }
  });

  private onInstanceUpdated = (instance: BaseDef) => {
    if (
      isCardInstance(instance) &&
      'id' in instance &&
      typeof instance.id === 'string'
    ) {
      let autoSaveState = this.initOrGetAutoSaveState(instance.id);
      autoSaveState.hasUnsavedChanges = true;
      this.initiateAutoSaveTask.perform(instance.id);
    }
  };

  private async trackSavedInstance(
    operation: 'start-tracking' | 'stop-tracking',
    instanceOrError: CardDef | CardError,
  ) {
    if (!instanceOrError.id) {
      return;
    }

    let instance = isCardInstance(instanceOrError)
      ? instanceOrError
      : undefined;
    if (operation === 'start-tracking') {
      this.identityContext.addInstanceOrError(
        instanceOrError.id,
        instanceOrError,
      );
    }
    // module updates will break the cached api. so don't hang on to this longer
    // than necessary
    this.cardApiCache = await this.cardService.getAPI();
    let autoSaveState = instance
      ? this.autoSaveStates.get(instance.id)
      : undefined;
    if (operation === 'stop-tracking' && instance) {
      this.cardApiCache.unsubscribeFromChanges(
        instance,
        this.onInstanceUpdated,
      );
      this.autoSaveStates.delete(instance.id);
    } else if (operation === 'start-tracking' && instance) {
      this.cardApiCache.subscribeToChanges(instance, this.onInstanceUpdated);
      if (autoSaveState) {
        this.autoSaveStates.set(instance.id, autoSaveState);
      }
    }
  }

  private async getInstance<T extends CardDef>({
    urlOrDoc,
    relativeTo,
    realm,
    opts,
  }: {
    urlOrDoc: string | LooseSingleCardDocument;
    relativeTo?: URL;
    realm?: string; // used for new cards
    opts?: { noCache?: boolean };
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

      if (!opts?.noCache) {
        let existingInstance = this.peek(url);
        if (existingInstance) {
          deferred?.fulfill(existingInstance);
          return existingInstance as T;
        }
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
      // in case the url is an alias for the id (like index card without the
      // "/index") we also add this
      this.identityContext.set(url, instance);
      deferred?.fulfill(instance);
      return instance as T;
    } catch (error: any) {
      let errorResponse = processCardError(url, error);
      let cardError = errorResponse.errors[0];
      deferred?.fulfill(cardError);
      console.error(
        `error getting instance ${JSON.stringify(urlOrDoc, null, 2)}`,
        error,
      );
      return cardError;
    } finally {
      if (url) {
        this.inflightCards.delete(url);
      }
    }
  }

  private initiateAutoSaveTask = task(
    async (id: string, opts?: { isImmediate?: true }) => {
      let instance = this.identityContext.get(id);
      if (!instance) {
        return;
      }
      let autoSaveState = this.initOrGetAutoSaveState(id);
      try {
        autoSaveState.isSaving = true;
        autoSaveState.lastSaveError = undefined;
        if (!opts?.isImmediate) {
          await timeout(this.environmentService.autoSaveDelayMs);
        }
        if (!opts?.isImmediate) {
          await timeout(25);
        }
        await this.saveInstance(instance, opts);
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

  private initOrGetAutoSaveState(url: string): AutoSaveState {
    let autoSaveState = this.autoSaveStates.get(url);
    if (!autoSaveState) {
      autoSaveState = new TrackedObject({
        isSaving: false,
        hasUnsavedChanges: false,
        lastSaved: undefined,
        lastSavedErrorMsg: undefined,
        lastSaveError: undefined,
      });
      this.autoSaveStates.set(url, autoSaveState!);
    }
    return autoSaveState!;
  }

  private async saveInstance(card: CardDef, opts?: { isImmediate?: true }) {
    if (opts?.isImmediate) {
      await this.persistAndUpdate(card);
    } else {
      // these saves can happen so fast that we'll make sure to wait at
      // least 500ms for human consumption
      await Promise.all([this.persistAndUpdate(card), delay(500)]);
    }
  }

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
    await this.withTestWaiters(async () => {
      let cardChanged = false;
      function onCardChange() {
        cardChanged = true;
      }
      let api: typeof CardAPI | undefined;
      try {
        api = await this.cardService.getAPI();
        api.subscribeToChanges(instance, onCardChange);
        let doc = await this.cardService.serializeCard(instance, {
          // for a brand new card that has no id yet, we don't know what we are
          // relativeTo because its up to the realm server to assign us an ID, so
          // URL's should be absolute
          useAbsoluteURL: true,
        });

        // send doc over the wire with absolute URL's. The realm server will convert
        // to relative URL's as it serializes the cards
        let realmURL = instance[realmURLSymbol];
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
          await api.updateFromSerialized(instance, json, this.identityContext);
        } else if (isNew) {
          // in this case a new card was created, but there is an immediate change
          // that was made--so we save off the new ID for the card so in the next
          // save we'll correlate to the correct card ID
          instance.id = json.data.id;
        }
        if (this.onSaveSubscriber) {
          this.onSaveSubscriber(new URL(json.data.id), json);
        }

        if (isNew) {
          // now that we have a remote ID make a realm subscription
          this.subscribeToRealm(new URL(instance.id));
        }
      } catch (err) {
        console.error(`Failed to save ${instance.id}: `, err);
        throw err;
      } finally {
        api?.unsubscribeFromChanges(instance, onCardChange);
      }
    });
  }

  private async reloadInstance(instance: CardDef): Promise<void> {
    // we don't await this in the realm subscription callback, so this test
    // waiter should catch otherwise leaky async in the tests
    await this.withTestWaiters(async () => {
      let api = await this.cardService.getAPI();
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
      await api.updateFromSerialized<typeof CardDef>(
        instance,
        incomingDoc,
        this.identityContext,
      );
    });
  }

  private subscribeToRealm(url: URL) {
    let realmURL = this.realm.realmOfURL(url);
    if (!realmURL) {
      console.warn(
        `could not determine realm for card ${url.href} when trying to subscribe to realm`,
      );
      return;
    }
    let realm = realmURL.href;
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
