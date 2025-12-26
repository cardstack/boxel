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
} from '@cardstack/runtime-common';
import {
  getField,
  getSingularRelationship,
  identifyCard,
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
            cards: seedRecords,
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
  let relationship = getSingularRelationship(resource.relationships, fieldName);
  fieldState.seedSearchURL = relationship?.links?.search ?? null;
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
      ? new URL((instance as CardDef).id)
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
