import type {
  BaseDef,
  CardDef,
  CardStore,
  Field,
  StoreSearchResource,
} from './card-api';
import type {
  LooseCardResource,
  Query,
  QueryWithInterpolations,
} from '@cardstack/runtime-common';
import {
  getField,
  identifyCard,
  THIS_INTERPOLATION_PREFIX,
  THIS_REALM_TOKEN,
  realmURL as realmURLSymbol,
  parseSearchURL,
} from '@cardstack/runtime-common';
import {
  buildQuerySearchURL,
  codeRefWithAbsoluteURL,
} from '@cardstack/runtime-common';
import type { FieldDefinition } from '@cardstack/runtime-common/index-structure';
import { logger as runtimeLogger } from '@cardstack/runtime-common';
import { initSharedState } from './shared-state';

interface QueryFieldState {
  seedSearchURL?: string | null;
  seedRecords?: CardDef[];
  seedRealms?: string[];
  searchResource?: StoreSearchResource;
}

const queryFieldStates = initSharedState(
  'queryFieldStates',
  () => new WeakMap<BaseDef, Map<string, QueryFieldState>>(),
);

const log = runtimeLogger('query-field-support');

export function ensureQueryFieldSearchResource(
  store: CardStore,
  instance: BaseDef,
  field: Field,
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
  let queryFieldState = queryFieldStates.get(instance);
  let fieldState = queryFieldState?.get(field.name);
  let searchResource = fieldState?.searchResource;
  if (searchResource) {
    log.info(
      `ensureQueryFieldSearchResource: reusing existing resource from fieldState for field=${field.name}`,
    );
    return searchResource;
  }

  let seedRecords = fieldState?.seedRecords;
  let seedSearchURL = fieldState?.seedSearchURL;

  let args = () => resolveQueryAndRealm(instance, field, fieldDefinition);

  log.info(
    `ensureQueryFieldSearchResource: creating resource; field=${field.name}; isLive=${true}; seedRecord=${seedRecords?.length ?? 0} realms derivation starting`,
  );
  searchResource = store.getSearchResource(
    instance,
    () => args()?.query,
    () => {
      let realm = args()?.realmHref;
      return realm ? [realm] : undefined;
    },
    {
      isLive: true,
      seed: seedRecords
        ? {
            cards: seedRecords ?? undefined,
            searchURL: seedSearchURL ?? undefined,
            realms: fieldState?.seedRealms,
          }
        : undefined,
    },
  );
  if (!queryFieldState) {
    queryFieldState = new Map<string, QueryFieldState>();
    queryFieldStates.set(instance, queryFieldState);
  }
  if (!fieldState) {
    fieldState = {};
    queryFieldState.set(field.name, fieldState);
  }
  fieldState.searchResource = searchResource;

  return searchResource;
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
  fieldState.seedRecords = value;
  fieldState.seedSearchURL =
    resource.relationships?.[fieldName]?.links?.search ?? null;
  fieldState.seedRealms = fieldState.seedSearchURL
    ? [parseSearchURL(new URL(fieldState.seedSearchURL)).realm.href]
    : [];
}

function resolveQueryAndRealm(
  instance: BaseDef,
  field: Field,
  fieldDefinition: FieldDefinition,
): { realmHref: string; searchURL: string; query: Query } | undefined {
  let realmURL: URL | undefined = (instance as any)[realmURLSymbol];

  // Inline query normalization without serialize/normalizeQueryDefinition
  let workingQuery: Query = JSON.parse(
    JSON.stringify(field.queryDefinition ?? {}),
  );
  let queryAny = workingQuery as Record<string, any>;
  let aborted = false;
  let EMPTY_PREDICATE_KEYS = new Set([
    'eq',
    'contains',
    'range',
    'any',
    'every',
  ]);

  const markEmptyPredicate = (context?: string) => {
    if (context && EMPTY_PREDICATE_KEYS.has(context)) {
      aborted = true;
    }
  };

  const resolvePathValue = (path: string) => {
    return instance[path];
  };

  const interpolateNode = (node: any, context?: string): any => {
    if (aborted) {
      return undefined;
    }
    if (typeof node === 'string') {
      if (node === THIS_REALM_TOKEN) {
        return realmURL!.href;
      }
      if (node.startsWith(THIS_INTERPOLATION_PREFIX)) {
        let path = node.slice(THIS_INTERPOLATION_PREFIX.length);
        let value = resolvePathValue(path);
        if (value === undefined) {
          markEmptyPredicate(context);
          return undefined;
        }
        return value;
      }
      return node;
    }
    if (Array.isArray(node)) {
      let result: any[] = [];
      for (let entry of node) {
        let interpolated = interpolateNode(entry, context);
        if (interpolated !== undefined) {
          result.push(interpolated);
        }
      }
      if (result.length === 0) {
        markEmptyPredicate(context);
        return undefined;
      }
      return result;
    }
    if (node && typeof node === 'object') {
      let result: Record<string, any> = {};
      for (let [key, value] of Object.entries(node)) {
        let interpolated = interpolateNode(value, key);
        if (interpolated !== undefined) {
          result[key] = interpolated;
        }
      }
      if (Object.keys(result).length === 0) {
        markEmptyPredicate(context);
        return undefined;
      }
      return result;
    }
    return node;
  };

  if (queryAny.filter) {
    let interpolatedFilter = interpolateNode(queryAny.filter, 'filter');
    if (interpolatedFilter === undefined) {
      delete queryAny.filter;
    } else {
      queryAny.filter = interpolatedFilter;
    }
  }
  if (queryAny.sort) {
    let interpolatedSort = interpolateNode(queryAny.sort, 'sort');
    if (interpolatedSort === undefined) {
      delete queryAny.sort;
    } else {
      queryAny.sort = interpolatedSort;
    }
  }
  if (queryAny.page) {
    let interpolatedPage = interpolateNode(queryAny.page, 'page');
    if (interpolatedPage === undefined) {
      delete queryAny.page;
    } else {
      queryAny.page = interpolatedPage;
    }
  }
  if (aborted) {
    return undefined;
  }

  let specifiedRealm: any = queryAny.realm ?? THIS_REALM_TOKEN;
  const resolveRealm = (value: any): string => {
    if (value == null) {
      return realmURL!.href;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) {
        return realmURL!.href;
      }
      if (value.length > 1) {
        throw new Error(
          `query field "${field.name}" only supports a single realm but received multiple entries`,
        );
      }
      return resolveRealm(value[0]);
    }
    if (typeof value !== 'string') {
      throw new Error(
        `query field "${field.name}" must resolve realm to a string`,
      );
    }
    if (value.length === 0) {
      throw new Error(
        `query field "${field.name}" must resolve realm to a non-empty string`,
      );
    }
    if (value === THIS_REALM_TOKEN) {
      return realmURL!.href;
    }
    if (value.startsWith(THIS_INTERPOLATION_PREFIX)) {
      let interpolated = resolvePathValue(
        value.slice(THIS_INTERPOLATION_PREFIX.length),
      );
      if (typeof interpolated === 'string' && interpolated.length > 0) {
        return interpolated;
      }
      throw new Error(
        `query field "${field.name}" must resolve realm interpolation "${value}" to a non-empty string`,
      );
    }
    return value;
  };
  let resolvedRealm = resolveRealm(specifiedRealm);
  delete queryAny.realm;

  // Apply defaults for target and paging (mirrors normalizeQueryDefinition)
  let targetRef = codeRefWithAbsoluteURL(
    fieldDefinition.fieldOrCard,
    (instance as CardDef).id ? new URL((instance as CardDef).id) : realmURL,
  );

  let filter = queryAny.filter as Record<string, any> | undefined;
  if (!filter || Object.keys(filter).length === 0) {
    queryAny.filter = { type: targetRef };
  } else if (!filter.on) {
    filter.on = targetRef;
  }

  if (Array.isArray(queryAny.sort)) {
    queryAny.sort = queryAny.sort.map((entry: any) => {
      if (entry && typeof entry === 'object' && !('on' in entry)) {
        return { ...entry, on: targetRef };
      }
      return entry;
    });
  }

  if (fieldDefinition.type === 'linksTo') {
    let page = queryAny.page ?? {};
    page.size = 1;
    page.number = 0;
    queryAny.page = page;
  } else if (queryAny.page) {
    let page = queryAny.page;
    if (page.size != null || page.number != null) {
      page.number = page.number ?? 0;
      queryAny.page = page;
    } else {
      delete queryAny.page;
    }
  }

  // Final query object after interpolation
  let normalizedQuery = queryAny as Query;

  return {
    realmHref: resolvedRealm,
    searchURL: buildQuerySearchURL(resolvedRealm, normalizedQuery),
    query: normalizedQuery,
  };
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
