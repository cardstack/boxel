import type { BaseDef, CardDef, CardStore, Field } from './card-api';
import { getStore } from './card-api';
import type {
  LooseCardResource,
  Query,
  QueryWithInterpolations,
  Relationship,
  ResourceID,
} from '@cardstack/runtime-common';
import {
  assertQuery,
  cloneRelationship,
  getField,
  identifyCard,
  normalizeQueryForSignature,
  parseQuery,
  THIS_INTERPOLATION_PREFIX,
  THIS_REALM_TOKEN,
  realmURL as realmURLSymbol,
  localId as localIdSymbol,
} from '@cardstack/runtime-common';
import {
  buildQuerySearchURL,
  normalizeQueryDefinition,
} from '@cardstack/runtime-common';
import type { FieldDefinition } from '@cardstack/runtime-common/index-structure';
import { logger as runtimeLogger } from '@cardstack/runtime-common';
import { serializeCard } from './card-serialization';
import { initSharedState } from './shared-state';
import { getFields, getDataBucket } from './field-support';

interface QueryFieldState {
  signature?: string;
  query?: Query;
  searchURL?: string | null;
  relationship?: Relationship;
  realm?: string | null;
  stale?: boolean;
  records?: CardDef[];
}

const queryFieldStates = initSharedState(
  'queryFieldStates',
  () => new WeakMap<BaseDef, Map<string, QueryFieldState>>(),
);

const queryFieldResources = initSharedState(
  'queryFieldResources',
  () =>
    new WeakMap<
      BaseDef,
      Map<string, ReturnType<CardStore['getSearchResource']>>
    >(),
);

const log = runtimeLogger('query-field-support');

export function setQueryFieldState(
  instance: BaseDef,
  fieldName: string,
  state: QueryFieldState | undefined,
) {
  let cache = queryFieldStates.get(instance);
  if (!cache) {
    if (!state) {
      return;
    }
    cache = new Map();
    queryFieldStates.set(instance, cache);
  }

  if (state) {
    cache.set(fieldName, state);
  } else {
    cache.delete(fieldName);
    if (cache.size === 0) {
      queryFieldStates.delete(instance);
    }
  }
}

function getQueryFieldState(
  instance: BaseDef,
  fieldName: string,
): QueryFieldState | undefined {
  return queryFieldStates.get(instance)?.get(fieldName);
}

export function ensureQueryFieldSearchResource(
  store: CardStore,
  instance: CardDef,
  field: Field,
  seedRecords?: CardDef[],
): ReturnType<CardStore['getSearchResource']> | undefined {
  if (!field.queryDefinition) {
    log.info(`field ${field.name} is not a query field, skipping`);
    return undefined;
  }
  let fieldDefinition = buildFieldDefinition(field);
  if (!fieldDefinition) {
    log.warn(`field ${field.name} missing fieldDefinition, skipping`);
    return undefined;
  }
  let cachedState = getQueryFieldState(instance, field.name);
  if (seedRecords === undefined && cachedState?.records) {
    seedRecords = cachedState.records;
  }
  let args = () =>
    resolveQueryAndRealm(instance, field, fieldDefinition) ??
    deriveArgsFromCachedState(cachedState);

  if (!args()) {
    log.warn(
      `resolveQueryAndRealm failed and no cached args for ${field.name}; cannot create search resource`,
    );
    setQueryFieldState(instance, field.name, undefined);
    return undefined;
  }

  let resources = queryFieldResources.get(instance);
  if (!resources) {
    resources = new Map();
    queryFieldResources.set(instance, resources);
  }

  let resource = resources.get(field.name);
  if (!resource) {
    log.info(
      `ensureQueryFieldSearchResource: creating resource; field=${field.name}; isLive=${true}; realms derivation starting`,
    );
    let resourceRef: ReturnType<CardStore['getSearchResource']> | undefined;
    let sync = () =>
      syncQueryFieldStateFromResource(instance, field, resourceRef, args);
    log.info(
      `creating search resource for query field ${field.name}; realm=${args()?.realmHref}; searchURL=${args()?.searchURL}; seeds=${seedRecords?.length ?? 0}`,
    );
    resourceRef = store.getSearchResource(
      instance,
      () => args()?.query,
      () => {
        let realm = args()?.realmHref;
        return realm ? [realm] : undefined;
      },
      {
        isLive: true,
        seed:
          seedRecords !== undefined || cachedState?.searchURL !== undefined
            ? {
                cards: seedRecords ?? cachedState?.records ?? [],
                searchURL: cachedState?.searchURL ?? undefined,
              }
            : undefined,
        doWhileRefreshing: sync,
      },
    );
    resource = resourceRef;
    resources.set(field.name, resourceRef);
    sync();
  } else {
    log.info(
      `ensureQueryFieldSearchResource: reusing existing resource for field=${field.name}`,
    );
    syncQueryFieldStateFromResource(instance, field, resource, args);
  }

  return resource;
}

function getQueryFieldStateKeys(instance: BaseDef): string[] {
  return Array.from(queryFieldStates.get(instance)?.keys() ?? []);
}

export function validateRelationshipQuery(
  ownerPrototype: BaseDef | undefined,
  fieldName: string,
  query: QueryWithInterpolations,
): void {
  if (typeof query !== 'object' || query == null) {
    throw new Error(`query field "${fieldName}" must provide a query object`);
  }
  if (!ownerPrototype) {
    return;
  }
  let tokens = new Set<string>();
  collectInterpolationTokens(query, tokens);
  let ownerClass = ownerPrototype.constructor as typeof BaseDef;
  for (let token of tokens) {
    if (token === THIS_REALM_TOKEN) {
      continue;
    }
    if (
      typeof token === 'string' &&
      token.startsWith(THIS_INTERPOLATION_PREFIX)
    ) {
      validateInterpolationPath(ownerClass, fieldName, token);
    }
  }
}

const NUMERIC_SEGMENT = /^\d+$/;

function validateInterpolationPath(
  ownerClass: typeof BaseDef,
  fieldName: string,
  token: string,
): void {
  let path = token.slice(THIS_INTERPOLATION_PREFIX.length);
  if (!path) {
    let ownerName = ownerClass.name ?? 'Card';
    throw new Error(
      `query field "${fieldName}" references unknown path "${token}" on ${ownerName}`,
    );
  }

  let segments = path.split('.');
  let currentCard: typeof BaseDef | undefined = ownerClass;
  let awaitingContainsManyIndex = false;

  for (let i = 0; i < segments.length; i++) {
    let segment = segments[i];
    if (!segment) {
      throw new Error(
        `query field "${fieldName}" references unknown path "${token}" on ${
          currentCard?.name ?? 'Card'
        }`,
      );
    }

    if (awaitingContainsManyIndex) {
      if (!NUMERIC_SEGMENT.test(segment)) {
        throw new Error(
          `query field "${fieldName}" must use a numeric index when referencing "${token}" on ${
            currentCard?.name ?? 'Card'
          }`,
        );
      }
      awaitingContainsManyIndex = false;
      continue;
    }

    if (segment === 'id') {
      if (i < segments.length - 1) {
        throw new Error(
          `query field "${fieldName}" cannot dereference "id" within "${token}"`,
        );
      }
      continue;
    }

    if (!currentCard) {
      throw new Error(
        `query field "${fieldName}" references unknown path "${token}" on Card`,
      );
    }

    let referencedField = getField(currentCard, segment, { untracked: true });
    if (!referencedField) {
      throw new Error(
        `query field "${fieldName}" references unknown path "${token}" on ${
          currentCard?.name ?? 'Card'
        }`,
      );
    }

    if (
      referencedField.fieldType === 'containsMany' &&
      i < segments.length - 1
    ) {
      awaitingContainsManyIndex = true;
    }

    // we intentionally stop validating when a path walks into linksTo/linksToMany:
    // interpolation resolves against the owning card's serialized attributes, so we
    // cannot guarantee relationship-derived values exist at compile time even though
    // the schema allows those paths syntactically.
    currentCard = referencedField.card as typeof BaseDef;
  }
}

export function collectInterpolationTokens(
  value: unknown,
  tokens: Set<string>,
): void {
  if (value == null) {
    return;
  }
  if (typeof value === 'string') {
    if (
      value.startsWith(THIS_INTERPOLATION_PREFIX) ||
      value === THIS_REALM_TOKEN
    ) {
      tokens.add(value);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (let entry of value) {
      collectInterpolationTokens(entry, tokens);
    }
    return;
  }
  if (typeof value === 'object') {
    for (let entry of Object.values(value as Record<string, unknown>)) {
      collectInterpolationTokens(entry, tokens);
    }
  }
}

export function seedQueryFieldState(
  instance: CardDef,
  resource: LooseCardResource,
): void {
  let store = getStore(instance);
  let queryFieldEntries = Object.entries(
    getFields(instance, { includeComputeds: true }),
  ).filter(([, field]) => 'queryDefinition' in field && field.queryDefinition);
  let queryFieldNameSet = new Set(
    queryFieldEntries.map(([fieldName]) => fieldName),
  );

  for (let existingField of getQueryFieldStateKeys(instance)) {
    if (!queryFieldNameSet.has(existingField)) {
      setQueryFieldState(instance, existingField, undefined);
    }
  }

  for (let [fieldName, field] of queryFieldEntries) {
    let relationship = resource.relationships?.[fieldName];
    if (!relationship) {
      setQueryFieldState(instance, fieldName, undefined);
      continue;
    }
    let searchURL = relationship.links?.search ?? null;
    if (!searchURL || typeof searchURL !== 'string') {
      setQueryFieldState(instance, fieldName, undefined);
      continue;
    }

    let relationshipClone = cloneRelationship(relationship);
    let realmFromSearch = realmHrefFromSearchURL(searchURL);
    let normalizedQuery: Query | undefined;
    let signature: string | undefined = searchURL;

    let queryString: string | undefined;
    try {
      let url = new URL(searchURL);
      queryString =
        url.search && url.search.startsWith('?')
          ? url.search.slice(1)
          : url.search;
    } catch {
      if (searchURL.startsWith('?')) {
        queryString = searchURL.slice(1);
      }
    }
    if (queryString) {
      try {
        let parsed = parseQuery(queryString);
        assertQuery(parsed);
        normalizedQuery = normalizeQueryForSignature(parsed as Query);
      } catch {
        normalizedQuery = undefined;
        signature = undefined;
      }
    }

    let seedRecords = extractSeedRecords(instance, field);

    setQueryFieldState(instance, fieldName, {
      query: normalizedQuery,
      signature,
      searchURL,
      relationship: relationshipClone,
      realm: realmFromSearch ?? null,
      stale: false,
      records: seedRecords ? [...seedRecords] : undefined,
    });
  }
}

function realmHrefFromSearchURL(searchURL?: string | null): string | undefined {
  if (!searchURL) {
    return undefined;
  }
  try {
    let parsed = new URL(searchURL);
    if (parsed.pathname.endsWith('/_search')) {
      parsed.pathname = parsed.pathname.replace(/\/_search$/, '/');
      parsed.search = '';
      parsed.hash = '';
      if (!parsed.pathname.endsWith('/')) {
        parsed.pathname = `${parsed.pathname}/`;
      }
      return parsed.href;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function resolveQueryAndRealm(
  instance: CardDef,
  field: Field,
  fieldDefinition: FieldDefinition,
): { realmHref: string; searchURL: string; query: Query } | undefined {
  try {
    let serialized = serializeCard(instance, {
      includeComputeds: true,
      includeUnrenderedFields: true,
      useAbsoluteURL: true,
    });
    let resource = serialized.data as LooseCardResource;
    let realmURL = instance[realmURLSymbol]
      ? new URL(instance[realmURLSymbol].href)
      : resource.meta?.realmURL
        ? new URL(resource.meta.realmURL)
        : instance.id
          ? new URL(instance.id)
          : undefined;
    if (!realmURL) {
      return undefined;
    }
    let normalized = normalizeQueryDefinition({
      fieldDefinition,
      queryDefinition: field.queryDefinition!,
      resource,
      realmURL,
      fieldName: field.name,
    });
    if (!normalized) {
      return undefined;
    }
    return {
      realmHref: normalized.realm,
      searchURL: buildQuerySearchURL(normalized.realm, normalized.query),
      query: normalized.query,
    };
  } catch {
    return undefined;
  }
}

function deriveArgsFromCachedState(
  cachedState: QueryFieldState | undefined,
): { realmHref: string; searchURL: string; query: Query } | undefined {
  if (!cachedState?.searchURL || !cachedState?.query) {
    return undefined;
  }
  try {
    return {
      realmHref:
        cachedState.realm ??
        realmHrefFromSearchURL(cachedState.searchURL) ??
        '',
      searchURL: cachedState.searchURL,
      query: cachedState.query,
    };
  } catch {
    return undefined;
  }
}

function buildFieldDefinition(field: Field): FieldDefinition | undefined {
  let ref = identifyCard(field.card);
  if (!ref) {
    return undefined;
  }
  return {
    type: field.fieldType,
    isPrimitive: false,
    isComputed: !!field.computeVia,
    fieldOrCard: ref,
  };
}

function syncQueryFieldStateFromResource(
  instance: CardDef,
  field: Field,
  resource: ReturnType<CardStore['getSearchResource']> | undefined,
  getArgs: () =>
    | { realmHref: string; searchURL: string; query: Query }
    | undefined,
): void {
  if (!resource) {
    setQueryFieldState(instance, field.name, undefined);
    return;
  }
  let args = getArgs();
  if (!args) {
    setQueryFieldState(instance, field.name, undefined);
    return;
  }
  let relationship = buildRelationshipFromRecords(
    field,
    resource.instances,
    args.searchURL,
  );
  setQueryFieldState(instance, field.name, {
    searchURL: args.searchURL ?? null,
    signature: args.searchURL ?? undefined,
    relationship,
    realm: args.realmHref ?? null,
    stale: false,
    records: [...resource.instances],
  });
}

function buildRelationshipFromRecords(
  field: Field,
  records: CardDef[],
  searchURL?: string,
): Relationship {
  let links: Record<string, string | null> = {};
  if (searchURL) {
    links.search = searchURL;
  }
  if (field.fieldType === 'linksTo') {
    let first = records[0];
    links.self = first?.id ?? null;
    let data = first ? (recordToResource(first) ?? null) : null;
    return {
      links,
      data,
    };
  }
  if (!('self' in links)) {
    links.self = null;
  }
  let data = records
    .map((record) => recordToResource(record))
    .filter((entry): entry is ResourceID => !!entry);
  return {
    links,
    data,
  };
}

function recordToResource(card: CardDef): ResourceID | undefined {
  if (card.id) {
    return { type: 'card', id: card.id };
  }
  let lid = card[localIdSymbol];
  if (lid) {
    return { type: 'card', lid };
  }
  return undefined;
}

function extractSeedRecords(
  instance: CardDef,
  field: Field,
): CardDef[] | undefined {
  let deserialized = getDataBucket(instance);
  if (!deserialized.has(field.name)) {
    return undefined;
  }
  let value = deserialized.get(field.name);
  if (value === undefined) {
    return undefined;
  }
  if (field.fieldType === 'linksTo') {
    if (value == null) {
      return [];
    }
    return [value as CardDef];
  }
  if (field.fieldType === 'linksToMany') {
    if (value == null) {
      return [];
    }
    if (Array.isArray(value)) {
      return (value as CardDef[]).slice();
    }
  }
  return undefined;
}
