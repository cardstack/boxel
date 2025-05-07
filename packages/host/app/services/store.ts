import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import Service, { service } from '@ember/service';
import { buildWaiter } from '@ember/test-waiters';

import { isTesting } from '@embroider/macros';

import { formatDistanceToNow } from 'date-fns';
import { task, timeout } from 'ember-concurrency';

import mergeWith from 'lodash/mergeWith';

import { stringify } from 'qs';

import { TrackedObject, TrackedMap } from 'tracked-built-ins';

import {
  hasExecutableExtension,
  isCardInstance,
  isSingleCardDocument,
  isCardCollectionDocument,
  Deferred,
  delay,
  mergeRelationships,
  realmURL as realmURLSymbol,
  localId as localIdSymbol,
  meta,
  logger,
  formattedError,
  type Store as StoreInterface,
  type Query,
  type PatchData,
  type Relationship,
  type AutoSaveState,
  type CardDocument,
  type SingleCardDocument,
  type CardResourceMeta,
  type LooseSingleCardDocument,
  type LooseCardResource,
  type CardErrorJSONAPI,
  type CardErrorsJSONAPI,
} from '@cardstack/runtime-common';

import {
  type CardDef,
  type BaseDef,
} from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';

import type { RealmEventContent } from 'https://cardstack.com/base/matrix-event';

import IdentityContext, {
  getDeps,
  isLocalId,
  type ReferenceCount,
} from '../lib/gc-identity-context';

import { type CardSaveSubscriber } from './card-service';

import EnvironmentService from './environment-service';

import type CardService from './card-service';
import type LoaderService from './loader-service';
import type MessageService from './message-service';
import type OperatorModeStateService from './operator-mode-state-service';
import type RealmService from './realm';
import type ResetService from './reset';

export { CardErrorJSONAPI, CardSaveSubscriber };

let waiter = buildWaiter('store-service');

const realmEventsLogger = logger('realm:events');
const storeLogger = logger('store');

export default class StoreService extends Service implements StoreInterface {
  @service declare private realm: RealmService;
  @service declare private loaderService: LoaderService;
  @service declare private messageService: MessageService;
  @service declare private cardService: CardService;
  @service declare private environmentService: EnvironmentService;
  @service declare private reset: ResetService;
  @service declare private operatorModeStateService: OperatorModeStateService;
  private subscriptions: Map<string, { unsubscribe: () => void }> = new Map();
  private referenceCount: ReferenceCount = new Map();
  private newReferencePromises: Promise<void>[] = [];
  private autoSaveStates: TrackedMap<string, AutoSaveState> = new TrackedMap();
  private cardApiCache?: typeof CardAPI;
  private gcInterval: number | undefined;
  private ready: Promise<void>;
  private inflightCards: Map<string, Promise<CardDef | CardErrorJSONAPI>> =
    new Map();
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

    storeLogger.debug(
      `dropping reference to ${id}, current reference count: ${this.referenceCount.get(id)}`,
    );
    if (currentReferenceCount <= 0) {
      if (currentReferenceCount < 0) {
        let message = `current reference count for ${id} is negative: ${this.referenceCount.get(id)}`;
        storeLogger.error(message);
        console.trace(message); // this will helps us to understand who dropped the reference that made it negative
      }
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
        let instance = this.identityContext.get(id);
        if (instance) {
          if (isLocalId(id)) {
            this.autoSaveStates.delete(instance.id);
          } else {
            this.autoSaveStates.delete(instance[localIdSymbol]);
          }
        }
      })();

      this.unsubscribeFromInstance(id);
    }
  }

  addReference(id: string | undefined) {
    if (!id) {
      return;
    }
    // synchronously update the reference count so we don't run into race
    // conditions requiring a mutex
    let currentReferenceCount = this.referenceCount.get(id) ?? 0;
    currentReferenceCount += 1;
    this.referenceCount.set(id, currentReferenceCount);
    storeLogger.debug(
      `adding reference to ${id}, current reference count: ${this.referenceCount.get(id)}`,
    );

    // intentionally not awaiting this. we keep track of the promise in
    // this.newReferencePromises
    this.wireUpNewReference(id);
  }

  // This method creates a new instance in the store and return the new card ID
  async create(
    doc: LooseSingleCardDocument,
    relativeTo: URL | undefined,
    realm?: string,
  ): Promise<string | CardErrorJSONAPI> {
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

  async add<T extends CardDef>(
    instanceOrDoc: T | LooseSingleCardDocument,
    opts: {
      realm?: string;
      relativeTo?: URL | undefined;
      // if you don't save then there is no possibility for error, hence a
      // simpler return type
      doNotPersist: true;
    },
  ): Promise<T>;
  async add<T extends CardDef>(
    instanceOrDoc: T | LooseSingleCardDocument,
    opts?: {
      realm?: string;
      relativeTo?: URL | undefined;
    },
  ): Promise<T | CardErrorJSONAPI>;
  async add<T extends CardDef>(
    instanceOrDoc: T | LooseSingleCardDocument,
    opts?: {
      // TODO: apparently this is getting abused by the catalog actions and we
      // are using this to tell the store the folder _within_ the realm to
      // upload an instance to, this is not always the actual realm...
      realm?: string;
      relativeTo?: URL | undefined;
      doNotPersist?: true;
    },
  ): Promise<T | CardErrorJSONAPI> {
    // need to figure out the actual realm because opts.realm is being abused
    let realmURL = opts?.realm
      ? this.realm.realmOfURL(new URL(opts.realm))?.href
      : undefined;
    let instance: T;
    if (!isCardInstance(instanceOrDoc)) {
      instance = await this.createFromSerialized(
        instanceOrDoc.data,
        instanceOrDoc,
        opts?.relativeTo,
      );
    } else {
      instance = instanceOrDoc;
      let api = await this.cardService.getAPI();
      let deps = getDeps(api, instance);
      for (let dep of deps) {
        if (!this.identityContext.get(dep[localIdSymbol])) {
          this.identityContext.set(dep.id ?? dep[localIdSymbol], dep);
        }
      }
    }
    if (realmURL) {
      instance[meta] = {
        ...instance[meta],
        ...{ realmURL },
      } as CardResourceMeta;
    }

    let maybeOldInstance = instance.id
      ? this.identityContext.get(instance.id)
      : undefined;
    if (maybeOldInstance) {
      await this.updateInstanceChangeSubscription(
        'stop-tracking',
        maybeOldInstance,
      );
    }

    await this.updateInstanceChangeSubscription('start-tracking', instance);

    if (!opts?.doNotPersist) {
      if (instance.id) {
        this.save(instance.id);
      } else {
        return (await this.persistAndUpdate(instance, opts?.realm)) as
          | T
          | CardErrorJSONAPI;
      }
    }

    return instance;
  }

  // peek will return a stale instance in the case the server has an error for
  // this id
  peek<T extends CardDef>(id: string): T | CardErrorJSONAPI | undefined {
    return this.identityContext.getInstanceOrError(id) as T | undefined;
  }

  // peekError will always return the current server state regarding errors for this id
  peekError(id: string): CardErrorJSONAPI | undefined {
    return this.identityContext.getError(id);
  }

  // peekLive will always return the current server state for both instances and errors
  peekLive<T extends CardDef>(id: string): T | CardErrorJSONAPI | undefined {
    return this.peekError(id) ?? this.peek(id);
  }

  async get<T extends CardDef>(id: string): Promise<T | CardErrorJSONAPI> {
    return await this.getInstance<T>({ urlOrDoc: id });
  }

  async delete(id: string): Promise<void> {
    if (!id) {
      // the card isn't actually saved yet, so do nothing
      return;
    }
    this.unsubscribeFromInstance(id);
    this.identityContext.delete(id);
    await this.cardService.fetchJSON(id, { method: 'DELETE' });
  }

  async patch<T extends CardDef = CardDef>(
    id: string,
    patch: PatchData,
  ): Promise<T | CardErrorJSONAPI | undefined> {
    // eslint-disable-next-line ember/classic-decorator-no-classic-methods
    let instance = await this.get<T>(id);
    if (!instance || !isCardInstance(instance)) {
      return;
    }
    let doc = await this.cardService.serializeCard(instance);
    if (patch.attributes) {
      doc.data.attributes = mergeWith(doc.data.attributes, patch.attributes);
    }
    if (patch.relationships) {
      let mergedRel = mergeRelationships(
        doc.data.relationships,
        patch.relationships,
      );
      if (mergedRel && Object.keys(mergedRel).length !== 0) {
        doc.data.relationships = mergedRel;
      }
    }
    let linkedCards = await this.loadPatchedInstances(
      patch,
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
    await api.updateFromSerialized(instance, doc, this.identityContext);
    return (await this.persistAndUpdate(instance)) as T | CardErrorJSONAPI;
  }

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
              relativeTo: new URL(doc.id!), // all results will have id's
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

  getReferenceCount(id: string) {
    return this.referenceCount.get(id) ?? 0;
  }

  private async wireUpNewReference(id: string) {
    let deferred = new Deferred<void>();
    await this.withTestWaiters(async () => {
      this.newReferencePromises.push(deferred.promise);
      try {
        await this.ready;
        let instanceOrError = this.peek(id);
        if (isLocalId(id)) {
          if (instanceOrError) {
            let realmURL = isCardInstance(instanceOrError)
              ? instanceOrError[realmURLSymbol]?.href
              : instanceOrError.realm;
            if (realmURL) {
              this.subscribeToRealm(new URL(realmURL));
            }
          }
          deferred.fulfill();
          return;
        }

        if (!instanceOrError) {
          instanceOrError = await this.getInstance({
            urlOrDoc: id,
          });
        }
        this.subscribeToRealm(new URL(id));
        await this.updateInstanceChangeSubscription(
          'start-tracking',
          instanceOrError,
        );

        if (!instanceOrError.id) {
          // keep track of urls for cards that are missing
          this.identityContext.addInstanceOrError(id, instanceOrError);
        }
        deferred.fulfill();
      } catch (e) {
        console.error(
          `error encountered wiring up new reference for ${JSON.stringify(id)}`,
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

  private async setup() {
    let api = await this.cardService.getAPI();
    this.gcInterval = setInterval(
      () => this.identityContext.sweep(api),
      2 * 60_000,
    ) as unknown as number;
  }

  private unsubscribeFromInstance(id: string) {
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
      let instance = this.peekLive(invalidation);
      if (instance && isCardInstance(instance)) {
        // Do not reload if the event is a result of an instance-editing request that we made. Otherwise we risk
        // overwriting the inputs with past values. This can happen if the user makes edits in the time between
        // the auto save request and the arrival realm event.

        let clientRequestId = event.clientRequestId;
        let reloadFile = false;

        if (!clientRequestId) {
          reloadFile = true;
          realmEventsLogger.debug(
            `reloading file resource ${invalidation} because event has no clientRequestId`,
          );
        } else if (this.cardService.clientRequestIds.has(clientRequestId)) {
          if (clientRequestId.startsWith('instance:')) {
            realmEventsLogger.debug(
              `ignoring invalidation for card ${invalidation} because request id ${clientRequestId} is ours and an instance type`,
            );
          } else {
            reloadFile = true;
            realmEventsLogger.debug(
              `reloading file resource ${invalidation} because request id ${clientRequestId} is not instance type`,
            );
          }
        } else {
          reloadFile = true;
          realmEventsLogger.debug(
            `reloading file resource ${invalidation} because request id ${clientRequestId} is not contained within known clientRequestIds`,
            Array.from(this.cardService.clientRequestIds.values()),
          );
        }

        if (reloadFile) {
          this.reloadTask.perform(instance);
        }
      } else {
        // load the card using just the ID because we don't have a running card on hand
        realmEventsLogger.debug(
          `reloading file resource ${invalidation} because it is not found in the identity context`,
        );
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
        await this.updateInstanceChangeSubscription(
          'stop-tracking',
          oldInstance,
        );
      }
      await this.updateInstanceChangeSubscription(
        'start-tracking',
        instanceOrError,
      );
    },
  );

  private reloadTask = task(async (instance: CardDef) => {
    let maybeReloadedInstance: CardDef | CardErrorJSONAPI | undefined;
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
      await this.updateInstanceChangeSubscription('stop-tracking', instance);
    }
    if (maybeReloadedInstance) {
      await this.updateInstanceChangeSubscription(
        'start-tracking',
        maybeReloadedInstance,
      );
    }
    if (isDelete) {
      await this.updateInstanceChangeSubscription('stop-tracking', instance);
      this.identityContext.delete(instance.id);
    }
  });

  private onInstanceUpdated = (instance: BaseDef, fieldName: string) => {
    if (fieldName === 'id') {
      // id updates are internal and do not trigger autosaves
      return;
    }
    if (isCardInstance(instance)) {
      let autoSaveState = this.initOrGetAutoSaveState(instance);
      autoSaveState.hasUnsavedChanges = true;
      this.initiateAutoSaveTask.perform(instance);
    }
  };

  private async updateInstanceChangeSubscription(
    operation: 'start-tracking' | 'stop-tracking',
    instanceOrError: CardDef | CardErrorJSONAPI,
  ) {
    let instance = isCardInstance(instanceOrError)
      ? instanceOrError
      : undefined;
    if (!instance && !instanceOrError.id) {
      return;
    }
    if (operation === 'start-tracking') {
      this.identityContext.addInstanceOrError(
        instance
          ? (instance.id ?? instance[localIdSymbol])
          : instanceOrError.id!, // we checked above to make sure errors have id's
        instanceOrError,
      );
    }
    // module updates will break the cached api. so don't hang on to this longer
    // than necessary
    this.cardApiCache = await this.cardService.getAPI();
    if (instance) {
      this.cardApiCache.unsubscribeFromChanges(
        instance,
        this.onInstanceUpdated,
      );
      if (operation === 'stop-tracking') {
        this.autoSaveStates.delete(instance.id);
        this.autoSaveStates.delete(instance[localIdSymbol]);
      } else if (operation === 'start-tracking') {
        this.cardApiCache.subscribeToChanges(instance, this.onInstanceUpdated);
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
    let deferred: Deferred<CardDef | CardErrorJSONAPI> | undefined;
    let url = asURL(urlOrDoc);
    if (url) {
      let working = this.inflightCards.get(url);
      if (working) {
        return working as Promise<T>;
      }
      deferred = new Deferred<CardDef | CardErrorJSONAPI>();
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
        let maybeError = await this.persistAndUpdate(newInstance, realm);
        if (!isCardInstance(maybeError)) {
          return maybeError;
        }
        this.identityContext.set(newInstance.id, newInstance);
        deferred?.fulfill(newInstance);
        return newInstance as T;
      }

      let existingInstance = this.peek(url);
      if (!opts?.noCache && existingInstance) {
        deferred?.fulfill(existingInstance);
        return existingInstance as T;
      }
      if (isLocalId(url)) {
        throw new Error(
          `instance with local id ${url} does not exist in the store`,
        );
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
        new URL(doc.data.id!), // instances from the server will have id's
      );
      // in case the url is an alias for the id (like index card without the
      // "/index") we also add this
      this.identityContext.set(url, instance);
      deferred?.fulfill(instance);
      if (!existingInstance || !isCardInstance(existingInstance)) {
        await this.updateInstanceChangeSubscription('start-tracking', instance);
      }
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
    async (idOrInstance: string | CardDef, opts?: { isImmediate?: true }) => {
      let instance: CardDef | undefined;
      if (typeof idOrInstance === 'string') {
        instance = this.identityContext.get(idOrInstance);
        if (!instance) {
          return;
        }
      } else {
        instance = idOrInstance;
      }
      let isNew = !instance.id;
      let autoSaveState = this.initOrGetAutoSaveState(instance);
      try {
        autoSaveState.isSaving = true;
        autoSaveState.lastSaveError = undefined;
        if (!opts?.isImmediate) {
          await timeout(this.environmentService.autoSaveDelayMs);
        }
        if (!opts?.isImmediate) {
          await timeout(25);
        }
        let maybeError = await this.saveInstance(instance, opts);
        autoSaveState.hasUnsavedChanges = false;
        autoSaveState.lastSaved = Date.now();
        autoSaveState.lastSavedErrorMsg = undefined;
        autoSaveState.lastSaveError =
          maybeError && !isCardInstance(maybeError) ? maybeError : undefined;
      } catch (error) {
        // error will already be logged in CardService
        autoSaveState.lastSaveError = error as Error;
      } finally {
        autoSaveState.isSaving = false;
        this.calculateLastSavedMsg(autoSaveState);
        if (isNew && instance.id) {
          this.autoSaveStates.set(instance.id, autoSaveState);
        }
      }
    },
  );

  private initOrGetAutoSaveState(instance: CardDef): AutoSaveState {
    let autoSaveState = this.autoSaveStates.get(
      instance.id ?? instance[localIdSymbol],
    );
    if (!autoSaveState) {
      autoSaveState = new TrackedObject({
        isSaving: false,
        hasUnsavedChanges: false,
        lastSaved: undefined,
        lastSavedErrorMsg: undefined,
        lastSaveError: undefined,
      });
      this.autoSaveStates.set(instance[localIdSymbol], autoSaveState);
    }
    if (instance.id && !this.autoSaveStates.get(instance.id)) {
      this.autoSaveStates.set(instance.id, autoSaveState);
    }
    return autoSaveState;
  }

  private async saveInstance(instance: CardDef, opts?: { isImmediate?: true }) {
    if (opts?.isImmediate) {
      return await this.persistAndUpdate(instance);
    } else {
      // these saves can happen so fast that we'll make sure to wait at
      // least 500ms for human consumption
      let [result] = await Promise.all([
        this.persistAndUpdate(instance),
        delay(500),
      ]);
      return result;
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

  private getErrorMessage(error: CardErrorJSONAPI | Error) {
    if (
      'meta' in error &&
      typeof error.meta === 'object' &&
      'responseHeaders' in error.meta &&
      typeof error.meta.responseHeaders === 'object' &&
      error.meta.responseHeaders['x-blocked-by-waf-rule']
    ) {
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
  ): Promise<CardDef | CardErrorJSONAPI> {
    return await this.withTestWaiters(async () => {
      let cardChanged = false;
      function onCardChange() {
        cardChanged = true;
      }
      let api: typeof CardAPI | undefined;
      let isNew = !instance.id;
      try {
        api = await this.cardService.getAPI();
        api.subscribeToChanges(instance, onCardChange);
        let doc = await this.cardService.serializeCard(instance, {
          // for a brand new card that has no id yet, we don't know what we are
          // relativeTo because its up to the realm server to assign us an ID, so
          // URL's should be absolute
          useAbsoluteURL: true,
          withIncluded: true,
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

        // if the card changed while the save was in flight then don't merge the
        // server state--the next auto save will include these
        // unsaved changes. also if there are new foreign links we'll hold off
        // on merging the server state until we have received the new foreign
        // link ID's from the other realm(s) (handled in this.updateForeignConsumersOf())
        if (!cardChanged && !this.hasNewForeignLinks(instance)) {
          await api.updateFromSerialized(instance, json, this.identityContext);
        } else if (isNew) {
          // in this case a new card was created, but there is an immediate change
          // that was made--so we save off the new ID for the card so in the next
          // save we'll correlate to the correct card ID
          api.setId(instance, json.data.id!); // resources from the server will always have ID's
        }
        if (this.onSaveSubscriber) {
          this.onSaveSubscriber(new URL(json.data.id!), json);
        }

        if (isNew) {
          this.subscribeToRealm(new URL(instance.id));
          this.operatorModeStateService.handleCardIdAssignment(
            instance[localIdSymbol],
          );
          await this.updateForeignConsumersOf(instance);
          await this.updateInstanceChangeSubscription(
            'start-tracking',
            instance,
          );
        }
        return instance;
      } catch (err) {
        console.error(`Failed to save ${instance.id}: `, err);
        let errorResponse = processCardError(
          instance.id ?? instance[localIdSymbol],
          err,
        );
        let cardError = errorResponse.errors[0];
        await this.updateInstanceChangeSubscription(
          'start-tracking',
          cardError,
        );
        return cardError;
      } finally {
        api?.unsubscribeFromChanges(instance, onCardChange);
      }
    });
  }

  private async hasNewForeignLinks(instance: CardDef) {
    let instanceRealm = instance[realmURLSymbol]?.href;
    if (!instanceRealm) {
      return;
    }
    let deps = this.identityContext.dependenciesOf(
      await this.cardService.getAPI(),
      instance,
    );
    return Boolean(
      deps.find(
        (c) =>
          !c.id &&
          c[realmURLSymbol]?.href &&
          c[realmURLSymbol].href !== instanceRealm,
      ),
    );
  }

  // in the case we are making a cross realm relationship with a link that
  // hasn't been saved yet, as soon as the link does actually get saved we need
  // to inform the consuming instances that live in different realms of the new
  // link's remote id and have those consumers update in their respective
  // realms.
  private async updateForeignConsumersOf(instance: CardDef) {
    let consumers = this.identityContext.consumersOf(
      await this.cardService.getAPI(),
      instance,
    );
    let instanceRealm = instance[realmURLSymbol]?.href;
    if (!instanceRealm) {
      return;
    }

    for (let consumer of consumers) {
      let consumerRealm = consumer[realmURLSymbol]?.href;
      if (consumerRealm !== instanceRealm && consumer.id) {
        this.save(consumer.id);
      }
    }
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
    if (!rel.links?.self) {
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

function processCardError(
  url: string | undefined,
  error: any,
): CardErrorsJSONAPI {
  try {
    let errorResponse = JSON.parse(error.responseText);
    return formattedError(url, error, errorResponse.errors?.[0]);
  } catch (parseError) {
    switch (error.status) {
      // tailor HTTP responses as necessary for better user feedback
      case 404:
        return formattedError(url, error, {
          status: 404,
          title: 'Card Not Found',
          message: `The card ${url} does not exist`,
        });
      default:
        return formattedError(url, error, undefined);
    }
  }
}

export function asURL(urlOrDoc: string | LooseSingleCardDocument) {
  return typeof urlOrDoc === 'string'
    ? urlOrDoc.replace(/\.json$/, '')
    : urlOrDoc.data.id;
}
