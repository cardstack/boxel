import type {
  BaseDef,
  CardDef,
  CardStore,
  Field,
  StoreSearchResource,
} from './card-api';
import type {
  ErrorEntry,
  FieldDefinition,
  LooseCardResource,
  Query,
  QueryWithInterpolations,
  RuntimeDependencyTrackingContext,
  SerializedError,
  VirtualNetwork,
} from '@cardstack/runtime-common';
import {
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
import {
  bumpFieldLoadingSignal,
  getDataBucket,
  type LinkErrorValue,
  type LinkNotFoundValue,
} from './field-support';

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
  // The sentinel `surfaceSearchResourceErrorState` planted on the most
  // recent transition into an errored state, kept as an identity handle
  // so the clear-on-recovery path can tell `our sentinel` apart from a
  // hand-planted / deserialized / externally-set bucket entry it must
  // leave alone.
  surfacedErrorSentinel?: LinkErrorValue | LinkNotFoundValue;
  // The `searchResource.errors` array reference we acted on the last
  // time surface ran. Tracking this lets surface short-circuit on
  // unchanged errors (the common per-render no-op case) and detect a
  // real transition into / out of the errored state without reading
  // the bucket on every call. Stored as-is — including `undefined` —
  // so the steady-state no-errors render hits the identity check.
  surfacedErrorSource?: readonly unknown[];
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
  // [QF2] TEMPORARY (cs-meta-wedge-diag) — fine-grained bracket of each
  // synchronous sub-call. The QF-DIAG getter probe proved this function
  // never returns for a self-referential query field (Customer.policies)
  // resolved during a link target's synchronous serialize. The last [QF2]
  // breadcrumb before silence names the sub-call that deadlocks. Render-
  // context gated; fires once per (consumer,field) on the creation path.
  let __qf2id = `${(instance as CardDef).id ?? '<unsaved>'}#${field.name}`;
  let __qf2log = (m: string) => {
    if ((globalThis as any).__boxelRenderContext) {
      // eslint-disable-next-line no-console
      console.log(`[QF2] ${m} ${__qf2id}`);
    }
  };
  __qf2log('enter');
  let fieldDefinition = buildFieldDefinition(field);
  __qf2log('fielddef-done');
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

  // FIX (Approach A): freeze query-field resolution during render.meta's
  // synchronous serialize. That phase is a pure read of already-resolved
  // state; it must never trigger (or consult a live, possibly-unresolved)
  // search. Resolving here re-enters the card graph synchronously and, when
  // the field's reverse query resolves back to the card being serialized
  // (e.g. Customer.policies -> the in-flight Policy), deadlocks the render
  // thread for ~150s and the indexer rejects the job. If the field is
  // seed-backed (the indexer wrote its relationship data into the parent
  // doc), fall through and resolve from the seed as usual. Otherwise return
  // empty: the field's authoritative value is computed on its OWN index
  // entry, where it is the top card and IS seeded.
  if ((globalThis as any).__boxelMetaSerializing) {
    let seeded = Boolean(
      fieldState.seedRecords?.length ||
      fieldState.seedCardURLs?.length ||
      fieldState.seedSearchURL,
    );
    if (!seeded) {
      return undefined;
    }
  }

  let searchResource = fieldState.searchResource;
  if (searchResource) {
    __qf2log('reuse');
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
    surfaceSearchResourceErrorState(
      fieldState,
      instance,
      field,
      searchResource,
    );
    return searchResource;
  }

  let seedRecords = fieldState?.seedRecords;
  let seedSearchURL = fieldState?.seedSearchURL;
  let args = () => {
    let vn = store.virtualNetwork;
    if (!vn) {
      throw new Error(
        `query-field-support requires the CardStore to have a VirtualNetwork`,
      );
    }
    __qf2log('resolveQuery-start');
    let __qf2r = resolveQueryAndRealm(instance, field, fieldDefinition, vn);
    __qf2log('resolveQuery-done');
    return __qf2r;
  };

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
  __qf2log(`getres-start isLive=${isLive} seed=${seedRecords?.length ?? 0}`);
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
  __qf2log('getres-done');
  fieldState.searchResource = searchResource;
  __qf2log('track-start');
  trackQueryFieldLoads(store, field.name, fieldState);
  __qf2log('track-done');
  surfaceSearchResourceErrorState(fieldState, instance, field, searchResource);
  __qf2log('surface-done');
  // Bridge `getRelationshipMembershipState(...).isLoading` to this freshly-created resource:
  // a `peek` before it existed entangled nothing, so nudge observers to
  // re-read now that the resource (and its tracked running flag) is available.
  bumpFieldLoadingSignal(instance, field.name);
  __qf2log('ensure-return');

  return searchResource;
}

// Peek at the search resource already created for a query field, without
// triggering creation. Returns `undefined` when the resource hasn't been
// instantiated yet (no consumer has read the field). Pure read — useful for
// callers that want to inspect resolved state without registering as
// reactive consumers of the field.
export function peekQueryFieldSearchResource(
  instance: BaseDef,
  fieldName: string,
): StoreSearchResource | undefined {
  return queryFieldStates.get(instance)?.get(fieldName)?.searchResource;
}

// Mirror the SearchResource's resource-level error state onto the data bucket
// so the field getter and `getRelationshipMembershipState` recognize the same sentinels they
// already handle for direct `linksTo`. Reading `searchResource.errors` here
// also entangles the calling field-getter render with the resource's tracked
// failure channel — a later transition into or out of an errored state
// re-invokes the getter without further plumbing.
//
// Ownership: the clear-on-recovery path acts only on sentinels we planted
// ourselves (tracked by identity via `fieldState.surfacedErrorSentinel`). A
// hand-planted or deserialized sentinel — or any other bucket entry that
// happens to be in a sentinel shape — is left alone, so external producers
// can put state into the bucket without surface racing them and erasing it.
//
// Short-circuit: the `errors` array carries identity across reads when the
// SearchResource hasn't transitioned, so an unchanged snapshot lets surface
// return without touching the bucket. The early-return is also what keeps
// the first call (errors === undefined on a fresh resource, source ===
// undefined on a fresh fieldState) from clobbering a sentinel that was put
// in place before the field was first read.
function surfaceSearchResourceErrorState(
  fieldState: QueryFieldState,
  instance: BaseDef,
  field: Field,
  searchResource: StoreSearchResource,
): void {
  let errors = searchResource.errors;
  if (errors === fieldState.surfacedErrorSource) {
    return;
  }
  // Store the snapshot as-is (including `undefined`) so the next-render
  // identity check matches when `searchResource.errors` is still undefined —
  // coercing to `null` would miss the early-return and force an extra
  // bucket read per render.
  fieldState.surfacedErrorSource = errors;

  let bucket = getDataBucket(instance);
  let existing = bucket.get(field.name);

  if (!errors || errors.length === 0) {
    if (
      fieldState.surfacedErrorSentinel &&
      existing === fieldState.surfacedErrorSentinel
    ) {
      bucket.delete(field.name);
    }
    fieldState.surfacedErrorSentinel = undefined;
    return;
  }

  let sentinel = buildQueryFieldSentinel(instance, field, errors);
  // DIAGNOSTIC LOGGING (CS-11221) — remove after CI passes. Don't read
  // `instance.id` here: the field getter for `id` initializes the bucket
  // via emptyValue, violating the pure-read contract callers depend on.
  console.error('[CS-11221 DIAG] surface plant sentinel', {
    fieldName: field.name,
    ownerType: instance?.constructor?.name,
    sentinelType: sentinel.type,
    errorCount: errors.length,
    firstErrorStatus: errors[0]?.error?.status,
    firstErrorMessage: errors[0]?.error?.message,
  });
  bucket.set(field.name, sentinel);
  fieldState.surfacedErrorSentinel = sentinel;
}

function buildQueryFieldSentinel(
  instance: BaseDef,
  field: Field,
  errors: ErrorEntry[],
): LinkErrorValue | LinkNotFoundValue {
  // A search resource fails as a unit, so we pick the first reported error
  // for the discriminator (404 → `link-not-found`, anything else →
  // `link-error`) and hand the entire SerializedError through as `errorDoc`.
  // Picking the first error mirrors how `lazilyLoadLink` builds its sentinel
  // from the single failing fetch, and keeps the surface uniform across the
  // declared and query-field producers.
  let firstError = errors[0].error;
  let status = firstError.status;
  let isMissing = status === 404;
  let errorDoc: SerializedError = {
    ...firstError,
    additionalErrors: firstError.additionalErrors ?? null,
  };
  let reference = queryFieldErrorReference(instance, field);
  return isMissing
    ? { type: 'link-not-found', reference, errorDoc }
    : { type: 'link-error', reference, errorDoc };
}

function queryFieldErrorReference(instance: BaseDef, field: Field): string {
  // A query field has no single linked-card URL the way a declared `linksTo`
  // does — the resource is the unit of failure. Use the owning card's id
  // (qualified with the field name) when available so the reference is
  // diagnosable in logs and persisted error docs. Unsaved owners fall back to
  // a synthetic identifier; the reference is read by humans / by
  // `getRelationshipMembershipState` consumers but never resolved as a URL.
  let owner = (instance as CardDef).id;
  if (typeof owner === 'string' && owner.length > 0) {
    return `${owner}#${field.name}`;
  }
  return `query-field:${field.name}`;
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
  virtualNetwork: VirtualNetwork,
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
      ? virtualNetwork.toURL((instance as CardDef).id)
      : realmURL,
    virtualNetwork,
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
