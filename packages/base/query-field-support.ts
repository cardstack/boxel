import type {
  BaseDef,
  CardDef,
  CardStore,
  Field,
  StoreSearchResource,
} from './card-api';
import type {
  FieldDefinition,
  LooseCardResource,
  Query,
  QueryWithInterpolations,
  RuntimeDependencyTrackingContext,
} from '@cardstack/runtime-common';
import {
  cardIdToURL,
  getField,
  getSingularRelationship,
  identifyCard,
  isCardInstance,
  THIS_INTERPOLATION_PREFIX,
  THIS_REALM_TOKEN,
  realmURL as realmURLSymbol,
  parseSearchURL,
} from '@cardstack/runtime-common';
import {
  buildQuerySearchURL,
  normalizeQueryDefinition,
} from '@cardstack/runtime-common';
import { logger as runtimeLogger } from '@cardstack/runtime-common';
import { runtimeQueryDependencyContext } from '@cardstack/runtime-common';
import { initSharedState } from './shared-state';

interface QueryFieldState {
  seedSearchURL?: string | null;
  seedRecords?: CardDef[];
  // When the parent doc carries `relationships.{field}.data` IDs but
  // no resolved cards in `included` (the server's
  // skipQueryBackedExpansion path), captureQueryFieldSeedData stashes
  // the IDs here. The SearchResource consumes them in prerender mode
  // to load each card by URL instead of running a live re-query —
  // turning the cascade of `_federated-search` QUERY calls into a
  // batch of stable per-card GETs.
  seedCardURLs?: string[];
  seedRealms?: string[];
  seedErrors?: Array<{
    realm: string;
    type: string;
    message: string;
    status?: number;
  }>;
  searchResource?: StoreSearchResource;
  renderCycleBarrier?: Promise<void>;
}

const queryFieldSeedFromSearchSymbol = Symbol.for(
  'cardstack-query-field-seed-from-search',
);

const queryFieldStates = initSharedState(
  'queryFieldStates',
  () => new WeakMap<BaseDef, Map<string, QueryFieldState>>(),
);

const log = runtimeLogger('query-field-support');

export function ensureQueryFieldSearchResource(
  store: CardStore,
  instance: BaseDef,
  field: Field,
  dependencyTrackingContext?: RuntimeDependencyTrackingContext,
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
  let trackingContext =
    dependencyTrackingContext ??
    runtimeQueryDependencyContext({
      queryField: field.name,
      consumer: (instance as CardDef).id,
      source: 'query-field-support:ensure-search-resource',
    });

  let queryFieldState = queryFieldStates.get(instance);
  if (!queryFieldState) {
    queryFieldState = new Map<string, QueryFieldState>();
    queryFieldStates.set(instance, queryFieldState);
  }
  let fieldState = queryFieldState.get(field.name);
  if (!fieldState) {
    fieldState = {};
    queryFieldState.set(field.name, fieldState);
  }
  let searchResource = fieldState.searchResource;
  if (searchResource) {
    // Intentionally do NOT call `trackQueryFieldLoads` here. The barrier
    // it registers exists to plug a one-shot timing race at resource
    // creation, between the field getter returning and the resource's
    // `modify` lifecycle running `store.trackLoad` for the real search.
    // On the reuse path that race no longer applies — the resource
    // already exists and its own `modify`-driven trackLoad is the
    // authoritative signal for render-stability. Re-arming the barrier
    // on every read creates a feedback loop: the barrier registers a
    // tracked load, its resolution invalidates the read-tracker that
    // drove the read, Glimmer reads again, a fresh barrier registers,
    // and so on. With N query-field consumers in a single render the
    // loop saturates the JS thread for minutes per card.
    log.debug(
      `ensureQueryFieldSearchResource: reusing existing resource from fieldState for field=${field.name}`,
    );
    return searchResource;
  }

  let seedRecords = fieldState?.seedRecords;
  let seedSearchURL = fieldState?.seedSearchURL;
  let args = () => resolveQueryAndRealm(instance, field, fieldDefinition);

  // Inside a prerender the parent doc's `relationships.{field}.data` is
  // the authoritative cardinality for this field — the indexer just
  // wrote it. A live re-query would fire a `_federated-search`
  // round-trip per field per loaded card to re-validate what the
  // parent doc already serialized. With N query-backed `linksToMany`
  // fields fanning out across M loaded cards that cascade is O(N*M)
  // extra fetches. It is also an internal-inconsistency vector: if
  // the live re-query returns a different set than the parent doc's
  // serialized relationships, the rendered HTML iterates a different
  // set than the parent doc describes. `isLive: false` in prerender
  // keeps the SearchResource resolved from the seed and exits; the
  // SPA path is unchanged.
  let inPrerender = Boolean((globalThis as any).__boxelRenderContext);
  let isLive = !inPrerender;

  log.info(
    `ensureQueryFieldSearchResource: creating resource; field=${field.name}; isLive=${isLive}; seedRecord=${seedRecords?.length ?? 0} realms derivation starting`,
  );
  searchResource = store.getSearchResource(
    instance,
    () => args()?.query,
    () => {
      let realm = args()?.realmHref;
      return realm ? [realm] : undefined;
    },
    {
      isLive,
      dependencyTracking: trackingContext,
      seed: seedRecords
        ? {
            cards: seedRecords,
            searchURL: seedSearchURL ?? undefined,
            realms: fieldState?.seedRealms,
            queryErrors: fieldState?.seedErrors,
            cardURLs: fieldState?.seedCardURLs,
          }
        : undefined,
    },
  );
  fieldState.searchResource = searchResource;
  trackQueryFieldLoads(store, field.name, fieldState);

  return searchResource;
}

function trackQueryFieldLoads(
  store: CardStore,
  fieldName: string,
  fieldState: QueryFieldState,
) {
  if (!fieldState.renderCycleBarrier) {
    // Query resources can kick off their load after the getter returns
    // (via resource modify scheduling). This microtask barrier keeps
    // render-route settle from completing in the same frame before query
    // loads can join.
    log.debug(`tracking query field render barrier for field=${fieldName}`);
    let barrier = waitForNextMicrotaskTurn();
    fieldState.renderCycleBarrier = barrier;
    store.trackLoad(barrier);
    void barrier.finally(() => {
      if (fieldState.renderCycleBarrier === barrier) {
        fieldState.renderCycleBarrier = undefined;
      }
    });
  }
}

function waitForNextMicrotaskTurn(): Promise<void> {
  return Promise.resolve().then(() => Promise.resolve());
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
export function captureQueryFieldSeedData(
  instance: BaseDef,
  fieldName: string,
  value: CardDef[],
  resource: LooseCardResource,
) {
  let queryFieldState = queryFieldStates.get(instance);
  if (!queryFieldState) {
    queryFieldState = new Map();
    queryFieldStates.set(instance, queryFieldState);
  }
  let fieldState = queryFieldState.get(fieldName);
  if (!fieldState) {
    fieldState = {};
    queryFieldState.set(fieldName, fieldState);
  }
  // Query-field deserialize can contain unresolved placeholders in some paths;
  // only persist concrete card instances as seed records.
  fieldState.seedRecords = value.filter((entry) => isCardInstance(entry));
  let relationship = getSingularRelationship(resource.relationships, fieldName);
  let seedComesFromSearch = Boolean(
    (resource as any)[queryFieldSeedFromSearchSymbol],
  );
  let relationshipHasUnhydratedTargets =
    fieldState.seedRecords.length === 0 &&
    (Array.isArray(relationship?.data)
      ? relationship.data.length > 0
      : Boolean(relationship?.data));
  // Empty query-backed relationships arriving on search result resources are
  // not guaranteed to be fully resolved (for example nested query fields on
  // each result). In that case we should still run the client-side query
  // fallback instead of treating the empty seed as authoritative.
  //
  // Likewise, when relationship data advertises one-or-more targets but none
  // of those targets are hydrated instances in this document, we should not
  // suppress fallback search based on links.search alone.
  let shouldTreatEmptySeedAsUnresolved =
    fieldState.seedRecords.length === 0 &&
    (seedComesFromSearch || relationshipHasUnhydratedTargets);
  // Capture the relationship's serialized IDs as a fallback the
  // SearchResource consumes when the parent doc didn't include the
  // resolved cards — the prerender-mode server skip leaves
  // `relationship.data` populated but `included` empty, and the host
  // materializes each listed ID via a per-URL GET instead of running
  // a live `_federated-search`.
  //
  // Trust the IDs whenever the umbrella carries `links.search`:
  // `applyQueryResults` is the only writer of that key, so its
  // presence is the unambiguous signal that the indexer (not the
  // user's raw source file) resolved this field. The IDs in
  // `relationship.data` are resource pointers the indexer wrote
  // alongside `links.search`, so they're authoritative regardless
  // of whether the document also inlined the resolved instances in
  // `included[]` — query-backed fields on `_federated-search`
  // responses intentionally skip that inline in prerender mode.
  //
  // A raw source's empty `data: []` lacks `links.search` and must
  // NOT be treated as an authoritative empty seed — the
  // SearchResource needs to fall through to a live query to
  // populate the field for the first time.
  let relationshipIsIndexerResolved = Boolean(relationship?.links?.search);
  let seedCardURLsUntrustworthy = !relationshipIsIndexerResolved;
  if (seedCardURLsUntrustworthy) {
    fieldState.seedCardURLs = undefined;
  } else if (Array.isArray(relationship?.data)) {
    fieldState.seedCardURLs = relationship.data
      .map((entry) => {
        let id = (entry as { id?: unknown })?.id;
        return typeof id === 'string' ? id : undefined;
      })
      .filter((id): id is string => Boolean(id));
  } else if (
    relationship?.data &&
    typeof (relationship.data as { id?: unknown }).id === 'string'
  ) {
    fieldState.seedCardURLs = [(relationship.data as { id: string }).id];
  } else {
    fieldState.seedCardURLs = undefined;
  }
  fieldState.seedSearchURL = shouldTreatEmptySeedAsUnresolved
    ? null
    : (relationship?.links?.search ?? null);
  fieldState.seedRealms = fieldState.seedSearchURL
    ? [parseSearchURL(new URL(fieldState.seedSearchURL)).realm.href]
    : [];
  fieldState.seedErrors = (relationship?.meta as any)?.errors ?? undefined;
}

function resolveQueryAndRealm(
  instance: BaseDef,
  field: Field,
  fieldDefinition: FieldDefinition,
): { realmHref: string; searchURL: string; query: Query } | undefined {
  let realmURL: URL | undefined = (instance as any)[realmURLSymbol];
  if (!realmURL) {
    return undefined;
  }

  let fieldPath = field.name.includes('.')
    ? field.name.slice(0, field.name.lastIndexOf('.'))
    : undefined;

  let normalized = normalizeQueryDefinition({
    fieldDefinition,
    queryDefinition: field.queryDefinition ?? {},
    realmURL,
    fieldName: field.name,
    fieldPath,
    resolvePathValue: (path) => resolveInstancePathValue(instance, path),
    relativeTo: (instance as CardDef).id
      ? cardIdToURL((instance as CardDef).id)
      : realmURL,
  });

  if (!normalized) {
    return undefined;
  }

  return {
    realmHref: normalized.realm,
    searchURL: buildQuerySearchURL(normalized.realm, normalized.query),
    query: normalized.query,
  };
}

function resolveInstancePathValue(instance: BaseDef, path: string): any {
  let segments = path.split('.');
  let current: any = instance;
  for (let segment of segments) {
    if (current == null) {
      return undefined;
    }
    if (Array.isArray(current)) {
      let index = Number(segment);
      if (!Number.isInteger(index)) {
        return undefined;
      }
      current = current[index];
      continue;
    }
    if (typeof current === 'object' && segment in current) {
      current = (current as any)[segment];
      continue;
    }
    return undefined;
  }
  return current;
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
