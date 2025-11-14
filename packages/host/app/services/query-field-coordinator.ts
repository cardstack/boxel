import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import Service from '@ember/service';
import { service } from '@ember/service';

import {
  buildQuerySearchURL,
  cloneRelationship,
  identifyCard,
  isCardCollectionDocument,
  localId,
  meta,
  normalizeQueryDefinition,
  normalizeQueryForSignature,
  querySignature,
  realmURL as realmURLSymbol,
  type CardResource,
  type CardResourceMeta,
  type FieldDefinition,
  type LooseCardResource,
  type LooseSingleCardDocument,
  type Query,
  type Relationship,
} from '@cardstack/runtime-common';

import type {
  CardDef,
  Field,
  QueryFieldAccessPayload,
  QueryFieldCoordinator,
} from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';
import type { RealmEventContent } from 'https://cardstack.com/base/matrix-event';

import type CardService from './card-service';
import type MessageService from './message-service';
import type RealmService from './realm';

interface RefreshOptions {
  force?: boolean;
  awaitCompletion?: boolean;
}

type PendingMap = Map<string, Promise<void>>;
type FieldHandle = { instance: CardDef; fieldName: string };
type FieldRealmEntry = { realm?: string; handle?: FieldHandle };
type RealmRegistration = {
  unsubscribe: () => void;
  fields: Set<FieldHandle>;
};

export default class QueryFieldCoordinatorService
  extends Service
  implements QueryFieldCoordinator
{
  @service declare cardService: CardService;
  @service declare realm: RealmService;
  @service declare messageService: MessageService;

  #pending = new WeakMap<CardDef, PendingMap>();
  #cardAPI?: Promise<typeof CardAPI>;
  #fieldRealms = new WeakMap<CardDef, Map<string, FieldRealmEntry>>();
  #realmRegistrations = new Map<string, RealmRegistration>();

  constructor(owner: Owner) {
    super(owner);
    void this.#setQueryFieldCoordinator(this);
    registerDestructor(this, () => {
      void this.#setQueryFieldCoordinator(undefined);
    });
  }

  handleQueryFieldAccess(payload: QueryFieldAccessPayload): void {
    void this.#scheduleRefresh(payload, { force: false });
  }

  async refreshQueryField(card: CardDef, fieldName: string): Promise<void> {
    let api = await this.#getCardAPI();
    let fields = api.getFields(card) as Record<string, Field>;
    let field = fields[fieldName];
    if (!field || !field.queryDefinition) {
      throw new Error(
        `field "${fieldName}" on ${card.constructor.name} is not a query-backed field`,
      );
    }
    await this.#scheduleRefresh(
      { instance: card, fieldName, field },
      { force: true, awaitCompletion: true },
    );
  }

  #scheduleRefresh(
    payload: QueryFieldAccessPayload,
    opts: RefreshOptions,
  ): Promise<void> | void {
    let map = this.#pending.get(payload.instance);
    if (!map) {
      map = new Map();
      this.#pending.set(payload.instance, map);
    }
    let inflight = map.get(payload.fieldName);
    if (inflight) {
      return opts.awaitCompletion ? inflight : undefined;
    }
    let promise = this.#performRefresh(payload, opts).finally(() => {
      map?.delete(payload.fieldName);
    });
    map.set(payload.fieldName, promise);
    if (opts.awaitCompletion) {
      return promise;
    }
    promise.catch((e) => {
      console.warn(`query field refresh failed for "${payload.fieldName}"`, e);
    });
    return undefined;
  }

  async #performRefresh(
    payload: QueryFieldAccessPayload,
    opts: RefreshOptions,
  ): Promise<void> {
    let api = await this.#getCardAPI();
    let releaseGuard = api.beginQueryFieldEvaluation(
      payload.instance,
      payload.fieldName,
    );
    try {
      await this.#refreshIfNeeded(payload, opts);
    } finally {
      releaseGuard();
    }
  }

  async #refreshIfNeeded(
    payload: QueryFieldAccessPayload,
    opts: RefreshOptions,
  ): Promise<void> {
    let api = await this.#getCardAPI();
    let { instance, field } = payload;
    if (!field.queryDefinition) {
      this.#registerFieldRealm(instance, field.name, undefined);
      return;
    }
    let serialized = await this.cardService.serializeCard(instance, {
      withIncluded: true,
    });
    let resource = serialized.data;
    if (!resource.meta?.adoptsFrom) {
      return;
    }
    let cardRealmURL = this.#getCardRealmURL(instance, resource);
    if (!cardRealmURL) {
      return;
    }
    let fieldDefinition = this.#buildFieldDefinition(field);
    if (!fieldDefinition) {
      return;
    }
    let normalized = normalizeQueryDefinition({
      fieldDefinition,
      queryDefinition: field.queryDefinition,
      resource,
      realmURL: cardRealmURL,
      fieldName: field.name,
    });
    if (!normalized) {
      this.#registerFieldRealm(instance, field.name, undefined);
      await this.#applyResults({
        payload,
        normalizedQuery: undefined,
        signature: undefined,
        searchURL: '',
        results: [],
        included: [],
        realmHref: undefined,
      });
      return;
    }
    this.#registerFieldRealm(instance, field.name, normalized.realm);
    let normalizedQuery = normalizeQueryForSignature(normalized.query);
    let signature = querySignature(normalizedQuery);
    let currentState = api.getQueryFieldState(instance, field.name);
    if (
      !opts.force &&
      currentState &&
      !currentState.stale &&
      currentState.signature === signature
    ) {
      return;
    }
    let { cards, included } = await this.#executeQuery(
      normalized.realm,
      normalized.query,
    );
    await this.#applyResults({
      payload,
      normalizedQuery,
      signature,
      searchURL: buildQuerySearchURL(normalized.realm, normalized.query),
      results: cards,
      included,
      realmHref: normalized.realm,
    });
  }

  async #executeQuery(
    realmHref: string,
    query: Query,
  ): Promise<{ cards: CardResource[]; included: CardResource[] }> {
    let json = await this.cardService.fetchJSON(`${realmHref}_search`, {
      method: 'QUERY',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(query),
    });
    if (!isCardCollectionDocument(json)) {
      throw new Error(
        `query field refresh expected a collection document from ${realmHref} but received ${JSON.stringify(
          json,
        )}`,
      );
    }
    let deduped = this.#dedupeResults(json.data);
    return {
      cards: deduped,
      included: [
        ...deduped,
        ...((json.included as CardResource[] | undefined) ?? []),
      ],
    };
  }

  async #applyResults({
    payload,
    normalizedQuery,
    signature,
    searchURL,
    results,
    included,
    realmHref,
  }: {
    payload: QueryFieldAccessPayload;
    normalizedQuery: Query | undefined;
    signature: string | undefined;
    searchURL: string;
    results: CardResource[];
    included: CardResource[];
    realmHref: string | undefined;
  }): Promise<void> {
    let api = await this.#getCardAPI();
    let relationships = this.#buildRelationshipPayload(
      payload.field,
      results,
      searchURL,
    );
    let trackedFields = this.#fieldRealms.get(payload.instance);
    if (trackedFields) {
      for (let [fieldName] of trackedFields) {
        if (fieldName === payload.field.name) {
          continue;
        }
        let otherState = api.getQueryFieldState(payload.instance, fieldName);
        if (otherState?.relationship) {
          relationships[fieldName] = cloneRelationship(
            otherState.relationship,
          )!;
        }
      }
    }

    let nextState = {
      query: normalizedQuery,
      signature,
      searchURL: relationships[payload.field.name]?.links?.search ?? null,
      relationship: cloneRelationship(relationships[payload.field.name]),
      realm: realmHref ?? null,
      stale: false,
    };

    api.setQueryFieldState(payload.instance, payload.field.name, nextState);

    let updateDoc: LooseSingleCardDocument = {
      data: this.#buildResourceForUpdate(
        payload.instance,
        payload.field,
        relationships,
      ),
      ...(included.length > 0 ? { included } : {}),
    };
    await api.updateFromSerialized(payload.instance, updateDoc);
  }

  #buildFieldDefinition(field: Field): FieldDefinition | undefined {
    let codeRef = identifyCard(field.card);
    if (!codeRef) {
      return undefined;
    }
    return {
      type: field.fieldType,
      isPrimitive: false,
      isComputed: !!field.computeVia,
      fieldOrCard: codeRef,
    };
  }

  #buildResourceForUpdate(
    instance: CardDef,
    field: Field,
    relationships: Record<string, Relationship>,
  ): LooseCardResource {
    let metaSource = instance[meta] as CardResourceMeta & {
      queryFields?: Record<string, unknown>;
    };
    if (!metaSource?.adoptsFrom) {
      throw new Error(
        `cannot refresh query field "${field.name}" without card identity`,
      );
    }
    let queryMeta = JSON.parse(JSON.stringify(field.queryDefinition ?? {}));
    let existingQueryFields = metaSource.queryFields ?? {};
    let updatedMeta = {
      ...metaSource,
      queryFields: {
        ...existingQueryFields,
        [field.name]: queryMeta,
      },
    } as CardResourceMeta;
    return {
      type: 'card',
      ...(instance.id ? { id: instance.id } : { lid: instance[localId] }),
      meta: updatedMeta,
      relationships,
    };
  }

  #buildRelationshipPayload(
    field: Field,
    results: CardResource[],
    searchURL: string,
  ): Record<string, Relationship> {
    let relationships: Record<string, Relationship> = {};
    if (field.fieldType === 'linksTo') {
      let first = results[0];
      let links: Record<string, string | null> = {
        ...(searchURL ? { search: searchURL } : {}),
        self: first?.id ?? null,
      };
      let base: Relationship = { links };
      if (searchURL) {
        base.data = first && first.id ? { type: 'card', id: first.id } : null;
      }
      relationships[field.name] = base;
      return relationships;
    }

    let filtered = results.filter(
      (card): card is CardResource & { id: string } =>
        typeof card.id === 'string',
    );
    let baseLinks: Record<string, string | null> = {
      ...(searchURL ? { search: searchURL } : {}),
    };
    if (!('self' in baseLinks)) {
      baseLinks.self = null;
    }
    relationships[field.name] = {
      links: baseLinks,
      ...(searchURL
        ? {
            data: filtered.map((card) => ({
              type: 'card',
              id: card.id,
            })),
          }
        : {}),
    };

    filtered.forEach((card, index) => {
      relationships[`${field.name}.${index}`] = {
        links: {
          self: card.id,
        },
        data: {
          type: 'card',
          id: card.id,
        },
      };
    });

    return relationships;
  }

  #getCardRealmURL(
    card: CardDef,
    resource: LooseCardResource,
  ): URL | undefined {
    if (card[realmURLSymbol]) {
      return new URL(card[realmURLSymbol].href);
    }
    if (resource.meta?.realmURL) {
      return new URL(resource.meta.realmURL);
    }
    if (card.id) {
      try {
        let url = new URL(card.id);
        return this.realm.realmOfURL(url) ?? new URL(`${url.origin}/`);
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  #dedupeResults(cards: CardResource[]): CardResource[] {
    let seen = new Set<string>();
    let deduped: CardResource[] = [];
    for (let card of cards) {
      if (!card?.id || seen.has(card.id)) {
        continue;
      }
      seen.add(card.id);
      deduped.push(card);
    }
    return deduped;
  }

  #getCardAPI(): Promise<typeof CardAPI> {
    if (!this.#cardAPI) {
      this.#cardAPI = this.cardService.getAPI();
    }
    return this.#cardAPI;
  }

  unregisterInstance(instance: CardDef): void {
    let fields = this.#fieldRealms.get(instance);
    if (!fields) {
      return;
    }
    for (let entry of fields.values()) {
      if (entry.realm) {
        this.#removeFieldHandle(entry.realm, entry.handle);
      }
    }
    this.#fieldRealms.delete(instance);
  }

  async #setQueryFieldCoordinator(
    coordinator: QueryFieldCoordinator | undefined,
  ): Promise<void> {
    let api = await this.#getCardAPI();
    api.registerQueryFieldCoordinator(coordinator);
  }

  #registerFieldRealm(
    instance: CardDef,
    fieldName: string,
    realmHref: string | undefined,
  ): void {
    let entries = this.#fieldRealms.get(instance);
    if (!entries) {
      if (!realmHref) {
        return;
      }
      entries = new Map();
      this.#fieldRealms.set(instance, entries);
    }

    let existing = entries.get(fieldName);
    let normalizedRealm = realmHref
      ? this.#normalizeRealmHref(realmHref)
      : undefined;
    if (existing?.realm === normalizedRealm) {
      return;
    }

    if (existing?.realm) {
      this.#removeFieldHandle(existing.realm, existing.handle);
    }

    if (!normalizedRealm) {
      entries.delete(fieldName);
      if (entries.size === 0) {
        this.#fieldRealms.delete(instance);
      }
      return;
    }

    let handle: FieldHandle = { instance, fieldName };
    let registration = this.#realmRegistrations.get(normalizedRealm);
    if (!registration) {
      let unsubscribe = this.messageService.subscribe(
        normalizedRealm,
        (event) => {
          void this.#handleRealmEvent(normalizedRealm, event);
        },
      );
      registration = { unsubscribe, fields: new Set() };
      this.#realmRegistrations.set(normalizedRealm, registration);
    }
    registration.fields.add(handle);
    entries.set(fieldName, { realm: normalizedRealm, handle });
  }

  #removeFieldHandle(realmHref: string, handle: FieldHandle | undefined): void {
    if (!handle) {
      return;
    }
    let registration = this.#realmRegistrations.get(realmHref);
    if (!registration) {
      return;
    }
    registration.fields.delete(handle);
    if (registration.fields.size === 0) {
      registration.unsubscribe();
      this.#realmRegistrations.delete(realmHref);
    }
  }

  async #handleRealmEvent(
    realmHref: string,
    event: RealmEventContent,
  ): Promise<void> {
    if (event.eventName !== 'index' || event.indexType !== 'incremental') {
      return;
    }
    let registration = this.#realmRegistrations.get(realmHref);
    if (!registration || registration.fields.size === 0) {
      return;
    }
    let api = await this.#getCardAPI();
    for (let handle of Array.from(registration.fields)) {
      let entry = this.#fieldRealms.get(handle.instance)?.get(handle.fieldName);
      if (!entry || entry.realm !== realmHref) {
        registration.fields.delete(handle);
        continue;
      }
      let marked = api.markQueryFieldStale(handle.instance, handle.fieldName);
      if (!marked) {
        registration.fields.delete(handle);
        continue;
      }
    }

    if (registration.fields.size === 0) {
      registration.unsubscribe();
      this.#realmRegistrations.delete(realmHref);
    }
  }

  #normalizeRealmHref(realmHref: string): string {
    let url = new URL(realmHref);
    if (!url.pathname.endsWith('/')) {
      url.pathname = `${url.pathname}/`;
    }
    url.search = '';
    url.hash = '';
    return url.href;
  }
}
