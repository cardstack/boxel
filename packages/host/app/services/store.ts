import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import { getOwner } from '@ember/owner';
import Service, { service } from '@ember/service';
import { buildWaiter } from '@ember/test-waiters';

import { isTesting } from '@embroider/macros';

import { formatDistanceToNow } from 'date-fns';
import { task } from 'ember-concurrency';

import cloneDeep from 'lodash/cloneDeep';
import isEqual from 'lodash/isEqual';
import merge from 'lodash/merge';

import { TrackedObject, TrackedMap } from 'tracked-built-ins';

import {
  hasExecutableExtension,
  isCardInstance,
  isSingleCardDocument,
  isCardCollectionDocument,
  Deferred,
  delay,
  mergeRelationships,
  isLocalId,
  realmURL as realmURLSymbol,
  localId as localIdSymbol,
  meta,
  logger,
  formattedError,
  SupportedMimeType,
  RealmPaths,
  type Store as StoreInterface,
  type AddOptions,
  type CreateOptions,
  type Query,
  type QueryResultsMeta,
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
  type ErrorEntry,
} from '@cardstack/runtime-common';

import type { CardDef, BaseDef } from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';

import type { RealmEventContent } from 'https://cardstack.com/base/matrix-event';

import CardStore, { getDeps, type ReferenceCount } from '../lib/gc-card-store';

import { getSearch } from '../resources/search';

import {
  enableRenderTimerStub,
  withTimersBlocked,
} from '../utils/render-timer-stub';

import type { CardSaveSubscriber } from './card-service';
import type CardService from './card-service';
import type CommandService from './command-service';
import type EnvironmentService from './environment-service';

import type HostModeService from './host-mode-service';
import type LoaderService from './loader-service';
import type MessageService from './message-service';
import type NetworkService from './network';
import type OperatorModeStateService from './operator-mode-state-service';
import type RealmService from './realm';
import type RealmServerService from './realm-server';
import type ResetService from './reset';
import type { SearchResource } from '../resources/search';

export { CardErrorJSONAPI, CardSaveSubscriber };

let waiter = buildWaiter('store-service');

const realmEventsLogger = logger('realm:events');
const storeLogger = logger('store');

type PersistOptions = CreateOptions & { clientRequestId?: string };

export default class StoreService extends Service implements StoreInterface {
  @service declare private realm: RealmService;
  @service declare private loaderService: LoaderService;
  @service declare private messageService: MessageService;
  @service declare private cardService: CardService;
  @service declare private commandService: CommandService;
  @service declare private hostModeService: HostModeService;
  @service declare private network: NetworkService;
  @service declare private environmentService: EnvironmentService;
  @service declare private reset: ResetService;
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private realmServer: RealmServerService;
  private subscriptions: Map<string, { unsubscribe: () => void }> = new Map();
  private referenceCount: ReferenceCount = new Map();
  private newReferencePromises: Promise<void>[] = [];
  private autoSaveStates: TrackedMap<string, AutoSaveState> = new TrackedMap();
  private cardApiCache?: typeof CardAPI;
  private gcInterval: number | undefined;
  private ready: Promise<void>;
  private inflightGetCards: Map<string, Promise<CardDef | CardErrorJSONAPI>> =
    new Map();
  private inflightCardMutations: Map<string, Promise<void>> = new Map();
  private inflightCardLoads: Map<string, Deferred<void>> = new Map();
  private store: CardStore;
  protected isRenderStore = false;

  // This is used for tests
  private onSaveSubscriber: CardSaveSubscriber | undefined;
  private autoSaveQueues = new Map<string, { isImmediate?: true }[]>();
  private autoSavePromises = new Map<string, Promise<void>>();

  constructor(owner: Owner) {
    super(owner);
    this.store = this.createCardStore();
    this.reset.register(this);
    this.ready = this.setup();
    registerDestructor(this, () => {
      clearInterval(this.gcInterval);
    });
  }

  protected renderContextBlocksPersistence() {
    return (
      this.isRenderStore && Boolean((globalThis as any).__boxelRenderContext)
    );
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
    this.inflightGetCards = new Map();
    this.inflightCardMutations = new Map();
    this.inflightCardLoads = new Map();
    this.autoSaveQueues = new Map();
    this.autoSavePromises = new Map();
    this.store = this.createCardStore();
    this.ready = this.setup();
  }

  async ensureSetupComplete(): Promise<void> {
    await this.ready;
  }

  resetCache(opts?: { preserveReferences?: boolean }) {
    storeLogger.debug('resetting store cache');
    if (!opts?.preserveReferences) {
      this.referenceCount = new Map();
    }
    this.autoSaveStates = new TrackedMap();
    this.newReferencePromises = [];
    this.inflightGetCards = new Map();
    this.inflightCardMutations = new Map();
    this.inflightCardLoads = new Map();
    this.autoSaveQueues = new Map();
    this.autoSavePromises = new Map();
    this.store = this.createCardStore();
  }

  refreshReferencesForCodeChange(reason?: string) {
    let reasonSuffix = reason ? ` (${reason})` : '';
    storeLogger.debug(`resetting store for code change${reasonSuffix}`);
    this.store.reset();
    this.reestablishReferences.perform();
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
      this.autoSaveStates.delete(id);
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

    if (isLocalId(id)) {
      let instanceOrError = this.peek(id);
      if (instanceOrError) {
        let realmURL = isCardInstance(instanceOrError)
          ? instanceOrError[realmURLSymbol]?.href
          : instanceOrError.realm;
        if (realmURL) {
          this.subscribeToRealm(new URL(realmURL));
        }
      }
    } else {
      this.subscribeToRealm(new URL(id));
      // intentionally not awaiting this. we keep track of the promise in
      // this.newReferencePromises
      this.wireUpNewReference(id);
    }
  }

  loaded(): Promise<void> {
    return this.store.loaded();
  }

  get docsInFlight() {
    return this.store.docsInFlight;
  }

  // This method creates a new instance in the store and return the new card ID
  async create(
    doc: LooseSingleCardDocument,
    opts?: CreateOptions,
  ): Promise<string | CardErrorJSONAPI> {
    return await this.withTestWaiters(async () => {
      if (opts?.realm) {
        doc.data.meta = { ...(doc.data.meta ?? {}), realmURL: opts.realm };
      }
      let cardOrError = await this.getInstance({
        idOrDoc: doc,
        relativeTo: opts?.relativeTo,
        realm: opts?.realm,
        opts: {
          localDir: opts?.localDir,
        },
      });
      if (isCardInstance(cardOrError)) {
        return cardOrError.id;
      }
      return cardOrError;
    });
  }

  save(id: string) {
    this.doAutoSave(id, { isImmediate: true });
  }

  async add<T extends CardDef>(
    instanceOrDoc: T | LooseSingleCardDocument,
    opts?: CreateOptions & { doNotPersist: true },
  ): Promise<T>;
  async add<T extends CardDef>(
    instanceOrDoc: T | LooseSingleCardDocument,
    opts?: CreateOptions & { doNotWaitForPersist: true },
  ): Promise<T>;
  async add<T extends CardDef>(
    instanceOrDoc: T | LooseSingleCardDocument,
    opts?: CreateOptions,
  ): Promise<T | CardErrorJSONAPI>;
  async add<T extends CardDef>(
    instanceOrDoc: T | LooseSingleCardDocument,
    opts?: AddOptions,
  ): Promise<T | CardErrorJSONAPI> {
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
        if (!this.store.get(dep[localIdSymbol])) {
          this.store.set(dep.id ?? dep[localIdSymbol], dep);
        }
      }
    }
    if (opts?.realm) {
      instance[meta] = {
        ...instance[meta],
        ...{ realmURL: opts.realm },
      } as CardResourceMeta;
    }

    let maybeOldInstance = instance.id
      ? this.store.get(instance.id)
      : undefined;
    if (maybeOldInstance) {
      await this.stopAutoSaving(maybeOldInstance);
    }

    this.setIdentityContext(instance);
    await this.startAutoSaving(instance);

    if (this.renderContextBlocksPersistence()) {
      return instance;
    }

    if (opts?.doNotWaitForPersist) {
      // intentionally not awaiting
      this.persistAndUpdate(instance, {
        realm: opts?.realm,
        localDir: opts?.localDir,
      });
    } else if (!opts?.doNotPersist) {
      if (instance.id) {
        this.save(instance.id);
      } else {
        return (await this.persistAndUpdate(instance, {
          realm: opts?.realm,
          localDir: opts?.localDir,
        })) as T | CardErrorJSONAPI;
      }
    }

    return instance;
  }

  // peek will return a stale instance in the case the server has an error for
  // this id
  peek<T extends CardDef>(id: string): T | CardErrorJSONAPI | undefined {
    return this.store.getInstanceOrError(id) as T | undefined;
  }

  // peekError will always return the current server state regarding errors for this id
  peekError(id: string): CardErrorJSONAPI | undefined {
    return this.store.getError(id);
  }

  // peekLive will always return the current server state for both instances and errors
  peekLive<T extends CardDef>(id: string): T | CardErrorJSONAPI | undefined {
    return this.peekError(id) ?? this.peek(id);
  }

  async get<T extends CardDef>(id: string): Promise<T | CardErrorJSONAPI> {
    return await this.getInstance<T>({ idOrDoc: id });
  }

  // Bypass cached state and fetch from source of truth
  async getWithoutCache<T extends CardDef>(
    id: string,
  ): Promise<T | CardErrorJSONAPI> {
    return await this.getInstance<T>({ idOrDoc: id, opts: { noCache: true } });
  }

  async delete(id: string): Promise<void> {
    if (!id) {
      // the card isn't actually saved yet, so do nothing
      return;
    }
    this.unsubscribeFromInstance(id);
    this.store.delete(id);
    await this.cardService.fetchJSON(id, { method: 'DELETE' });
  }

  async patch<T extends CardDef = CardDef>(
    id: string,
    patch: PatchData,
    opts?: { doNotPersist?: true },
  ): Promise<T | CardErrorJSONAPI | undefined>;
  async patch<T extends CardDef = CardDef>(
    id: string,
    patch: PatchData,
    opts?: { doNotWaitForPersist?: true },
  ): Promise<T | CardErrorJSONAPI | undefined>;
  async patch<T extends CardDef = CardDef>(
    id: string,
    patch: PatchData,
    opts?: { doNotPersist?: true; doNotWaitForPersist?: true },
  ): Promise<T | CardErrorJSONAPI | undefined>;
  async patch<T extends CardDef = CardDef>(
    id: string,
    patch: PatchData,
    opts?: { clientRequestId?: string },
  ): Promise<T | CardErrorJSONAPI | undefined>;
  async patch<T extends CardDef = CardDef>(
    id: string,
    patch: PatchData,
    opts?: { doNotWaitForPersist?: true; clientRequestId?: string },
  ): Promise<T | CardErrorJSONAPI | undefined>;
  async patch<T extends CardDef = CardDef>(
    id: string,
    patch: PatchData,
    opts?: {
      doNotPersist?: true;
      doNotWaitForPersist?: true;
      clientRequestId?: string;
    },
  ): Promise<T | CardErrorJSONAPI | undefined> {
    if (this.renderContextBlocksPersistence()) {
      return;
    }
    // eslint-disable-next-line ember/classic-decorator-no-classic-methods
    let instance = await this.get<T>(id);
    if (!instance || !isCardInstance(instance)) {
      return;
    }
    if (opts?.doNotPersist) {
      await this.stopAutoSaving(instance);
    }
    let doc = await this.cardService.serializeCard(instance, {
      omitQueryFields: true,
    });
    if (patch.attributes) {
      doc.data.attributes = merge(doc.data.attributes, patch.attributes);
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
    if (patch.meta) {
      doc.data.meta = merge(doc.data.meta, patch.meta);
    }
    let linkedCards = await this.loadPatchedInstances(
      patch,
      instance.id ? new URL(instance.id) : undefined,
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
        (instance as any)[field] = value;
      }
    }
    let api = await this.cardService.getAPI();
    await api.updateFromSerialized(instance, doc, this.store);
    let shouldPersist = !opts?.doNotPersist;
    let shouldAwaitPersist = shouldPersist && !opts?.doNotWaitForPersist;
    let persistedResult: CardDef | CardErrorJSONAPI | undefined = instance;

    if (opts?.doNotPersist) {
      await this.startAutoSaving(instance);
    } else if (shouldPersist) {
      let persistPromise = this.persistAndUpdate(instance, {
        clientRequestId: opts?.clientRequestId,
      });
      if (shouldAwaitPersist) {
        persistedResult = await persistPromise;
      }
    }

    return persistedResult as T | CardErrorJSONAPI;
  }

  async search(query: Query, realms?: string[]): Promise<CardDef[]> {
    let normalizedRealms = (realms ?? [])
      .map((realm) => new RealmPaths(new URL(realm)).url)
      .filter(Boolean);
    let searchRealms =
      normalizedRealms.length > 0
        ? normalizedRealms
        : this.realmServer.availableRealmURLs;
    if (searchRealms.length === 0) {
      return [];
    }
    return this._search(query, searchRealms);
  }

  private async _search(query: Query, realms: string[]): Promise<CardDef[]> {
    let realmServerURLs = this.realmServer.getRealmServersForRealms(realms);
    // TODO remove this assertion after multi-realm server/federated identity is supported
    this.realmServer.assertOwnRealmServer(realmServerURLs);
    let [realmServerURL] = realmServerURLs;
    let searchURL = new URL('_search', realmServerURL);
    let response = await this.realmServer.maybeAuthedFetch(searchURL.href, {
      method: 'QUERY',
      headers: {
        Accept: SupportedMimeType.CardJson,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...query, realms }),
    });
    if (!response.ok) {
      let responseText = await response.text();
      let err = new Error(
        `status: ${response.status} - ${response.statusText}. ${responseText}`,
      ) as any;
      err.status = response.status;
      err.responseText = responseText;
      err.responseHeaders = response.headers;
      throw err;
    }
    let json = await response.json();
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
              idOrDoc: { data: doc },
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
              )} against realms ${realms.join()}`,
              e,
            );
            return undefined;
          }
        }),
      )
    ).filter(Boolean) as CardDef[];
  }

  getSearchResource<T extends CardDef = CardDef>(
    parent: object,
    getQuery: () => Query | undefined,
    getRealms?: () => string[] | undefined,
    opts?: {
      isLive?: boolean;
      doWhileRefreshing?: (() => void) | undefined;
      seed?: {
        cards: T[];
        searchURL?: string;
        meta?: QueryResultsMeta;
        errors?: ErrorEntry[];
      };
    },
  ): SearchResource<T> {
    if (this.isRenderStore && opts) {
      opts.isLive = false;
    }
    return getSearch<T>(
      parent,
      getOwner(this)!,
      getQuery,
      getRealms,
      opts,
    ) as unknown as SearchResource<T>;
  }

  getSaveState(id: string): AutoSaveState | undefined {
    return this.autoSaveStates.get(id);
  }

  async flush() {
    await this.ready;
    await Promise.allSettled(this.newReferencePromises);
  }

  async flushSaves() {
    await Promise.allSettled(this.autoSavePromises.values());
  }

  getReferenceCount(id: string) {
    return this.referenceCount.get(id) ?? 0;
  }

  isSameId(a: string, b: string): boolean {
    return a === b || this.peek(a) === this.peek(b);
  }

  async waitForCardLoad(cardId: string): Promise<void> {
    let normalizedId = asURL(cardId);
    if (!normalizedId) {
      return;
    }
    let inflightLoad = this.inflightCardLoads.get(normalizedId);
    if (inflightLoad) {
      await inflightLoad.promise;
    }
  }

  private startTrackingCardLoad(
    cardId: string | undefined,
  ): Deferred<void> | undefined {
    if (!cardId) {
      return;
    }
    let normalizedId = asURL(cardId);
    if (!normalizedId) {
      return;
    }
    let deferred = new Deferred<void>();
    this.inflightCardLoads.set(normalizedId, deferred);
    return deferred;
  }

  private finishTrackingCardLoad(
    cardId: string | undefined,
    deferred?: Deferred<void>,
  ) {
    if (!cardId || !deferred) {
      return;
    }
    let normalizedId = asURL(cardId);
    if (!normalizedId) {
      return;
    }
    let current = this.inflightCardLoads.get(normalizedId);
    if (current === deferred) {
      this.inflightCardLoads.delete(normalizedId);
    }
    deferred.fulfill();
  }

  private async wireUpNewReference(url: string) {
    let deferred = new Deferred<void>();
    await this.withTestWaiters(async () => {
      this.newReferencePromises.push(deferred.promise);
      try {
        await this.ready;
        let instanceOrError = this.peekLive(url);
        if (!instanceOrError) {
          instanceOrError = await this.getInstance({
            idOrDoc: url,
          });
          this.setIdentityContext(instanceOrError);
        }
        await this.startAutoSaving(instanceOrError);
        if (!instanceOrError.id) {
          // keep track of urls for cards that are missing
          this.store.addInstanceOrError(url, instanceOrError);
        }
        deferred.fulfill();
      } catch (e) {
        console.error(
          `error encountered wiring up new reference for ${JSON.stringify(url)}`,
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
    let shouldStubTimers =
      this.renderContextBlocksPersistence() && !isTesting();
    let performCreate = async () =>
      (await api.createFromSerialized(resource, doc, relativeTo, {
        store: this.store,
      })) as T;
    let card = shouldStubTimers
      ? await withStubbedRenderTimers(performCreate)
      : await performCreate();
    return card;
  }

  private async setup() {
    let api = await this.cardService.getAPI();
    this.gcInterval = setInterval(
      () => this.store.sweep(api),
      2 * 60_000,
    ) as unknown as number;
  }

  private unsubscribeFromInstance(id: string) {
    let instance = this.store.get(id);
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

  private createCardStore(): CardStore {
    return new CardStore(this.referenceCount, this.network.authedFetch, {
      getSearchResource: (parent, getQuery, getRealms, opts) =>
        this.getSearchResource(parent, getQuery, getRealms, opts),
    });
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
      this.store.reset();
      this.reestablishReferences.perform();
    }

    for (let invalidation of invalidations) {
      if (hasExecutableExtension(invalidation)) {
        // we already dealt with this
        continue;
      }
      let clientRequestId = event.clientRequestId ?? undefined;

      let instance = this.peekLive(invalidation);
      if (instance) {
        if (isCardInstance(instance)) {
          // Do not reload if the event is a result of an instance-editing request that we made. Otherwise we risk
          // overwriting the inputs with past values. This can happen if the user makes edits in the time between
          // the auto save request and the arrival realm event.
          let reloadFile = false;

          if (!clientRequestId) {
            reloadFile = true;
            realmEventsLogger.debug(
              `reloading file resource ${invalidation} because event has no clientRequestId`,
            );
          } else if (this.cardService.clientRequestIds.has(clientRequestId)) {
            if (
              clientRequestId.startsWith('instance:') ||
              clientRequestId.startsWith('editor-with-instance')
            ) {
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
          } else {
            realmEventsLogger.debug(
              `ignoring invalidation ${invalidation} for request id ${clientRequestId}`,
            );
          }
        } else {
          realmEventsLogger.debug(
            `reloading file resource ${invalidation} because it is in an error state`,
          );
          this.loadInstanceTask.perform(invalidation);
        }
      } else {
        realmEventsLogger.debug(
          `ignoring invalidation ${invalidation} because we did not previously try to load it`,
        );
      }
    }
  };

  private loadInstanceTask = task(
    async (idOrDoc: string | LooseSingleCardDocument) => {
      let url = asURL(idOrDoc);
      let reloadTracker = this.startTrackingCardLoad(url);
      try {
        let oldInstance = url ? this.store.get(url) : undefined;
        let instanceOrError = await this.getInstance({
          idOrDoc,
          opts: { noCache: true },
        });
        if (oldInstance) {
          await this.stopAutoSaving(oldInstance);
        }
        this.setIdentityContext(instanceOrError);
        await this.startAutoSaving(instanceOrError);
      } finally {
        this.finishTrackingCardLoad(url, reloadTracker);
      }
    },
  );

  private reestablishReferences = task(async () => {
    let remoteIds = new Set<string>();
    for (let [id, referenceCount] of this.referenceCount) {
      if (referenceCount === 0) {
        continue;
      }
      if (isLocalId(id)) {
        let remoteIdsForLocal = this.store.getRemoteIds(id);
        if (remoteIdsForLocal.length === 0) {
          let error = this.store.getError(id);
          if (error?.meta?.remoteId) {
            remoteIdsForLocal = [error.meta.remoteId];
          }
        }
        for (let remoteId of remoteIdsForLocal) {
          remoteIds.add(remoteId);
        }
      } else {
        remoteIds.add(id);
      }
    }
    await Promise.all(
      [...remoteIds].map((id) => this.getInstance({ idOrDoc: id })),
    );
  });

  private reloadTask = task(async (instance: CardDef) => {
    let reloadTracker = this.startTrackingCardLoad(instance.id);
    let maybeReloadedInstance: CardDef | CardErrorJSONAPI | undefined;
    let isDelete = false;

    try {
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
        await this.stopAutoSaving(instance);
      }
      if (maybeReloadedInstance) {
        this.setIdentityContext(maybeReloadedInstance);
        await this.startAutoSaving(maybeReloadedInstance);
      }
      if (isDelete) {
        await this.stopAutoSaving(instance);
        this.store.delete(instance.id);
      }
    } finally {
      this.finishTrackingCardLoad(instance.id, reloadTracker);
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
      this.doAutoSave(instance);
    }
  };

  private setIdentityContext(instanceOrError: CardDef | CardErrorJSONAPI) {
    let instance = isCardInstance(instanceOrError)
      ? instanceOrError
      : undefined;
    if (!instance && !instanceOrError.id) {
      return;
    }
    this.store.addInstanceOrError(
      instance ? (instance.id ?? instance[localIdSymbol]) : instanceOrError.id!, // we checked above to make sure errors have id's
      instanceOrError,
    );
  }

  private async startAutoSaving(instanceOrError: CardDef | CardErrorJSONAPI) {
    if (!isCardInstance(instanceOrError)) {
      return;
    }
    let instance = instanceOrError;
    // module updates will break the cached api. so don't hang on to this longer
    // than necessary
    this.cardApiCache = await this.cardService.getAPI();
    this.cardApiCache.unsubscribeFromChanges(instance, this.onInstanceUpdated);
    this.cardApiCache.subscribeToChanges(instance, this.onInstanceUpdated);
  }

  private async stopAutoSaving(instanceOrError: CardDef | CardErrorJSONAPI) {
    if (!isCardInstance(instanceOrError)) {
      return;
    }
    let instance = instanceOrError;
    // module updates will break the cached api. so don't hang on to this longer
    // than necessary
    this.cardApiCache = await this.cardService.getAPI();
    this.cardApiCache.unsubscribeFromChanges(instance, this.onInstanceUpdated);
    this.autoSaveStates.delete(instance.id);
    this.autoSaveStates.delete(instance[localIdSymbol]);
  }

  private async getInstance<T extends CardDef>({
    idOrDoc,
    relativeTo,
    realm,
    opts,
  }: {
    idOrDoc: string | LooseSingleCardDocument;
    relativeTo?: URL;
    realm?: string; // used for new cards
    opts?: { noCache?: boolean; localDir?: string };
  }) {
    let deferred: Deferred<CardDef | CardErrorJSONAPI> | undefined;
    let id = asURL(idOrDoc);
    if (id) {
      let working = this.inflightGetCards.get(id);
      if (working) {
        return working as Promise<T>;
      }
      deferred = new Deferred<CardDef | CardErrorJSONAPI>();
      this.inflightGetCards.set(id, deferred.promise);
    }
    try {
      if (!id) {
        if (!this.renderContextBlocksPersistence()) {
          // this is a new card so instantiate it and save it
          let doc = idOrDoc as LooseSingleCardDocument;
          let newInstance = await this.createFromSerialized(
            doc.data,
            doc,
            relativeTo,
          );
          let maybeError = await this.persistAndUpdate(newInstance, {
            realm,
            localDir: opts?.localDir,
          });
          if (!isCardInstance(maybeError)) {
            return maybeError;
          }
          this.store.set(newInstance.id, newInstance);
          deferred?.fulfill(newInstance);
          return newInstance as T;
        } else {
          throw new Error(`cannot save serialized doc in render context`);
        }
      }

      let existingInstance = this.peek(id);
      if (!opts?.noCache && existingInstance) {
        deferred?.fulfill(existingInstance);
        return existingInstance as T;
      }
      if (isLocalId(id)) {
        // we might have lost the local id via a loader refresh, try loading from remote id instead
        let remoteId = this.store.getRemoteIds(id)?.[0];
        if (!remoteId) {
          throw new Error(
            `instance with local id ${id} does not exist in the store`,
          );
        }
        id = remoteId;
      }
      let url = id; // after this point we know we are dealing with a remote id, e.g. url
      let doc = (typeof idOrDoc !== 'string' ? idOrDoc : undefined) as
        | SingleCardDocument
        | undefined;
      if (!doc) {
        let json: CardDocument | undefined;
        if (this.isRenderStore && (globalThis as any).__boxelRenderContext) {
          let result = await this.cardService.getSource(new URL(`${url}.json`));
          if (result.status === 200) {
            json = JSON.parse(result.content);
          } else {
            throw new Error(
              `Received non-200 status fetching instance source ${url}.json: ${result.content}`,
            );
          }
        } else {
          json = await this.cardService.fetchJSON(url);
        }
        if (!isSingleCardDocument(json)) {
          throw new Error(
            `bug: server returned a non card document for ${url}:
        ${JSON.stringify(json, null, 2)}`,
          );
        }
        if (!json.data.id) {
          // card source format is not serialized with the ID, so we add that back in.
          json.data.id = url;
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
      this.store.set(url, instance);
      deferred?.fulfill(instance);
      if (!existingInstance || !isCardInstance(existingInstance)) {
        this.setIdentityContext(instance);
        await this.startAutoSaving(instance);
      }
      return instance as T;
    } catch (error: any) {
      let errorResponse = processCardError(id, error);
      let cardError = errorResponse.errors[0];
      deferred?.fulfill(cardError);
      console.error(
        `error getting instance ${JSON.stringify(idOrDoc, null, 2)}: ${JSON.stringify(error, null, 2)}`,
        error,
      );
      return cardError;
    } finally {
      if (id) {
        this.inflightGetCards.delete(id);
      }
    }
  }

  // this function is used to determine if the instance will be auto-saved or
  // note this is a temporary function that is likely to go away with the
  // creation of completion ephemeral state solution of the store/realm the
  // only use-case for this function is determining if a preview instance in
  // catalog realm (which is a read-only), st a card can be mutable without
  // persisting to the server
  private useEphemeralState(instance: CardDef | undefined): boolean {
    if (!instance) {
      return false;
    }
    let realmURL = instance[realmURLSymbol];
    if (!realmURL) {
      // if a proper cannot derived, I just revert to the default behavior of auto-save
      return false;
    }
    let permissionToWrite = this.realm.permissions(realmURL.href).canWrite;
    return !permissionToWrite;
  }

  private doAutoSave(
    idOrInstance: string | CardDef,
    opts?: { isImmediate?: true },
  ) {
    let instance: CardDef | undefined;
    if (typeof idOrInstance === 'string') {
      instance = this.store.get(idOrInstance);
      if (!instance) {
        return;
      }
    } else {
      instance = idOrInstance;
    }
    if (this.useEphemeralState(instance)) {
      return;
    }
    let autoSaveState = this.initOrGetAutoSaveState(instance);
    let queueName = instance.id ?? instance[localIdSymbol];
    let autoSaveQueue = this.autoSaveQueues.get(queueName);
    if (!autoSaveQueue) {
      autoSaveQueue = [];
      this.autoSaveQueues.set(queueName, autoSaveQueue);
    }
    autoSaveQueue.push({ ...opts });
    autoSaveState.isSaving = true;
    autoSaveState.lastSaveError = undefined;
    this.drainAutoSaveQueue(queueName);
  }

  private async drainAutoSaveQueue(queueName: string) {
    return await this.withTestWaiters(async () => {
      await this.autoSavePromises.get(queueName);

      let instance = this.peek(queueName);
      if (!isCardInstance(instance)) {
        return;
      }
      await this.inflightCardMutations.get(instance[localIdSymbol]);

      let done: () => void;
      this.autoSavePromises.set(
        queueName,
        new Promise<void>((r) => (done = r)),
      );
      let autoSaves = [...(this.autoSaveQueues.get(queueName) ?? [])];
      this.autoSaveQueues.set(queueName, []);
      if (autoSaves && autoSaves.length > 0) {
        let autoSaveState = this.initOrGetAutoSaveState(instance);
        // favor isImmediate saves
        let isImmediate = Boolean(autoSaves.find((a) => a.isImmediate));
        try {
          let maybeError = await this.saveInstance(
            instance,
            isImmediate ? { isImmediate } : undefined,
          );
          autoSaveState.hasUnsavedChanges = false;
          autoSaveState.lastSaved = Date.now();
          autoSaveState.lastSavedErrorMsg = undefined;
          autoSaveState.lastSaveError =
            maybeError && !isCardInstance(maybeError) ? maybeError : undefined;
        } catch (error) {
          // error will already be logged in CardService
          if (autoSaveState) {
            autoSaveState.lastSaveError = error as Error;
          }
        } finally {
          autoSaveState.isSaving = false;
          this.calculateLastSavedMsg(autoSaveState);
          if (isLocalId(queueName) && instance.id) {
            this.autoSaveStates.set(instance.id, autoSaveState);
          }
        }
      }
      done!();
    });
  }

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
    if (this.renderContextBlocksPersistence()) {
      // we skip saving when rendering cards in headless chrome
      return;
    }
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
    opts?: PersistOptions,
  ): Promise<SingleCardDocument> {
    let isSaved = !!doc.data.id;
    let url = resolveDocUrl(doc.data.id, opts?.realm, opts?.localDir);
    let json = await this.cardService.fetchJSON(url, {
      method: isSaved ? 'PATCH' : 'POST',
      body: JSON.stringify(doc, null, 2),
      headers: {
        'Content-Type': SupportedMimeType.CardJson,
      },
      clientRequestId: opts?.clientRequestId,
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
      error.meta.responseHeaders &&
      typeof error.meta.responseHeaders === 'object'
    ) {
      let wafRule = Object.entries(error.meta.responseHeaders).find(
        ([header]) => header.toLowerCase() === 'x-blocked-by-waf-rule',
      )?.[1];
      if (wafRule) {
        return `Request blocked by Web Application Firewall. X-blocked-by-waf-rule response header specifies rule: ${wafRule}`;
      }
    }
    if (error.message) {
      return error.message;
    }
    return 'Unknown error';
  }

  private async persistAndUpdate(
    instance: CardDef,
    opts?: PersistOptions,
  ): Promise<CardDef | CardErrorJSONAPI> {
    return await this.withTestWaiters(async () => {
      let isNew = !instance.id;
      let inflightMutation = this.inflightCardMutations.get(
        instance[localIdSymbol],
      );
      if (inflightMutation) {
        // the local instance is always up-to-date, but things can get messy if
        // we try to update an instance that is in the process of being created on
        // the server, because then it still looks like to the client another
        // POST should be issued when instead we really want to PATCH.
        await inflightMutation;
      }
      let deferred = new Deferred<void>();
      this.inflightCardMutations.set(instance[localIdSymbol], deferred.promise);
      try {
        let doc = await this.cardService.serializeCard(instance, {
          // for a brand new card that has no id yet, we don't know what we are
          // relativeTo because its up to the realm server to assign us an ID, so
          // URL's should be absolute
          useAbsoluteURL: true,
          withIncluded: true,
          omitQueryFields: true,
        });

        // send doc over the wire with absolute URL's. The realm server will convert
        // to relative URL's as it serializes the cards
        let realmURL = instance[realmURLSymbol];
        // in the case where we get no realm URL from the card, we are dealing with
        // a new card instance that does not have a realm URL yet.
        if (!realmURL) {
          let defaultRealmHref =
            opts?.realm ?? this.realm.defaultWritableRealm?.path;
          if (!defaultRealmHref) {
            throw new Error('Could not find a writable realm');
          }
          realmURL = new URL(defaultRealmHref);
        }
        let json = await this.saveCardDocument(doc, {
          realm: realmURL.href,
          localDir: opts?.localDir,
          clientRequestId: opts?.clientRequestId,
        });

        let api = await this.cardService.getAPI();
        // the store state represents the latest state and the server state is
        // potentially out-of-date. As such we only merge the server state that
        // the store does not know about specifically remote ID's and realm
        // meta. the attributes and relationships state from the server are
        // thrown away since the store has a more recent version of these.
        if (needsServerStateMerge(instance, json)) {
          let serverState = cloneDeep(json);
          delete serverState.data.attributes;
          delete serverState.data.relationships;
          await api.updateFromSerialized(instance, serverState, this.store);
        }
        if (isNew) {
          api.setId(instance, json.data.id!);
          this.subscribeToRealm(new URL(instance.id));
          this.operatorModeStateService.handleCardIdAssignment(
            instance[localIdSymbol],
          );
          await this.updateForeignConsumersOf(instance);
          this.setIdentityContext(instance);
          await this.startAutoSaving(instance);
        }
        if (this.onSaveSubscriber) {
          this.onSaveSubscriber(new URL(json.data.id!), json);
        }
        return instance;
      } catch (err) {
        console.error(`Failed to save ${instance.id}: `, err);
        let errorResponse = processCardError(
          instance.id ?? instance[localIdSymbol],
          err,
        );
        let cardError = errorResponse.errors[0];
        this.setIdentityContext(cardError);
        let remoteId = cardError.meta?.remoteId;
        if (remoteId && (!cardError.id || isLocalId(cardError.id))) {
          this.store.addInstanceOrError(remoteId, cardError);
        }
        return cardError;
      } finally {
        deferred.fulfill();
      }
    });
  }

  // in the case we are making a cross realm relationship with a link that
  // hasn't been saved yet, as soon as the link does actually get saved we need
  // to inform the consuming instances that live in different realms of the new
  // link's remote id and have those consumers update in their respective
  // realms.
  private async updateForeignConsumersOf(instance: CardDef) {
    let consumers = this.store.consumersOf(
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
        this.store,
      );
    });
  }

  private subscribeToRealm(url: URL) {
    if (this.hostModeService.isActive) {
      return;
    }

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
        unsubscribe: this.messageService.subscribe(realm, (event) =>
          this.handleInvalidations(event),
        ),
      });
    }
  }

  private async loadPatchedInstances(
    patchData: PatchData,
    relativeTo: URL | undefined,
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

  private async loadRelationshipInstance(
    rel: Relationship,
    relativeTo: URL | undefined,
  ) {
    if (!rel.links?.self) {
      return;
    }
    let id = rel.links.self;
    let instance = await this.getInstance({
      idOrDoc: new URL(id, relativeTo).href,
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

function needsServerStateMerge(
  instance: CardDef,
  serverState: SingleCardDocument,
): boolean {
  return (
    instance.id !== serverState.data.id ||
    !isEqual(instance[meta]?.realmInfo, serverState.data.meta.realmInfo)
  );
}

export function asURL(urlOrDoc: string | LooseSingleCardDocument) {
  return typeof urlOrDoc === 'string'
    ? urlOrDoc.replace(/\.json$/, '')
    : urlOrDoc.data.id;
}

async function withStubbedRenderTimers<T>(cb: () => Promise<T>): Promise<T> {
  if (typeof window === 'undefined' || isTesting()) {
    return await cb();
  }
  // Prevent cards that use timers (e.g. timers-card.gts) from continuing to
  // execute after we capture their HTML during prerender. In the browser we
  // normally let timers run, but in the render route we need deterministic,
  // single-shot renders so runaway timers don't crash indexing.
  let restore = enableRenderTimerStub();
  try {
    return await withTimersBlocked(cb);
  } finally {
    restore();
  }
}

// Resolves either to
// - an instance
// - a directory
function resolveDocUrl(id?: string, realm?: string, local?: string) {
  if (id) {
    return id;
  }
  if (!realm) {
    throw new Error('Cannot resolve target url without a realm');
  }
  let path = new RealmPaths(new URL(realm));
  if (local) {
    return path.directoryURL(local).href;
  }
  return path.url;
}

declare module '@ember/service' {
  interface Registry {
    store: StoreService;
  }
}
