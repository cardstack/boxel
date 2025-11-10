import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import Service from '@ember/service';
import { service } from '@ember/service';

import {
  buildQuerySearchURL,
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
  type ResourceID,
} from '@cardstack/runtime-common';

import type {
  CardDef,
  Field,
  QueryFieldAccessPayload,
  QueryFieldCoordinator,
} from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';

import type CardService from './card-service';
import type RealmService from './realm';

interface RefreshOptions {
  force?: boolean;
  awaitCompletion?: boolean;
}

type PendingMap = Map<string, Promise<void>>;

export default class QueryFieldCoordinatorService
  extends Service
  implements QueryFieldCoordinator
{
  @service declare cardService: CardService;
  @service declare realm: RealmService;

  #pending = new WeakMap<CardDef, PendingMap>();
  #cardAPI?: Promise<typeof CardAPI>;

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
      await this.#applyResults({
        payload,
        normalizedQuery: undefined,
        signature: undefined,
        searchURL: '',
        results: [],
        included: [],
      });
      return;
    }
    let normalizedQuery = normalizeQueryForSignature(normalized.query);
    let signature = querySignature(normalizedQuery);
    let currentState = api.getQueryFieldState(instance, field.name);
    if (!opts.force && currentState?.signature === signature) {
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
  }: {
    payload: QueryFieldAccessPayload;
    normalizedQuery: Query | undefined;
    signature: string | undefined;
    searchURL: string;
    results: CardResource[];
    included: CardResource[];
  }): Promise<void> {
    let api = await this.#getCardAPI();
    let relationships = this.#buildRelationshipPayload(
      payload.field,
      results,
      searchURL,
    );

    let updateDoc: LooseSingleCardDocument = {
      data: this.#buildResourceForUpdate(
        payload.instance,
        payload.field,
        relationships,
      ),
      ...(included.length > 0 ? { included } : {}),
    };
    await api.updateFromSerialized(payload.instance, updateDoc);
    api.setQueryFieldState(payload.instance, payload.field.name, {
      query: normalizedQuery,
      signature,
      searchURL: relationships[payload.field.name]?.links?.search ?? null,
      relationship: cloneRelationship(relationships[payload.field.name]),
    });
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

  async #setQueryFieldCoordinator(
    coordinator: QueryFieldCoordinator | undefined,
  ): Promise<void> {
    let api = await this.#getCardAPI();
    api.registerQueryFieldCoordinator(coordinator);
  }
}

function cloneRelationship(
  relationship?: Relationship,
): Relationship | undefined {
  if (!relationship) {
    return undefined;
  }
  let cloned: Relationship = {};
  if (relationship.links) {
    cloned.links = { ...relationship.links };
  }
  if (Array.isArray(relationship.data)) {
    cloned.data = relationship.data.map((item) => ({ ...item }));
  } else if (relationship.data && typeof relationship.data === 'object') {
    cloned.data = { ...(relationship.data as ResourceID) };
  } else if (relationship.data === null) {
    cloned.data = null;
  }
  if (relationship.meta) {
    cloned.meta = JSON.parse(JSON.stringify(relationship.meta));
  }
  return cloned;
}
