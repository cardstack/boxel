import type { BaseDef, CardDef, Field } from './card-api';
import type {
  LooseCardResource,
  Query,
  Relationship,
} from '@cardstack/runtime-common';
import {
  assertQuery,
  cloneRelationship,
  getField,
  normalizeQueryForSignature,
  parseQuery,
  querySignature,
  THIS_INTERPOLATION_PREFIX,
  THIS_REALM_TOKEN,
} from '@cardstack/runtime-common';
import { initSharedState } from './shared-state';

export interface QueryFieldAccessPayload {
  instance: CardDef;
  fieldName: string;
  field: Field;
}

interface QueryFieldState {
  signature?: string;
  query?: Query;
  searchURL?: string | null;
  relationship?: Relationship;
  realm?: string | null;
  stale?: boolean;
}

export interface QueryFieldCoordinator {
  handleQueryFieldAccess(payload: QueryFieldAccessPayload): void;
}

let queryFieldCoordinator: QueryFieldCoordinator | undefined;

export function registerQueryFieldCoordinator(
  coordinator: QueryFieldCoordinator | undefined,
) {
  queryFieldCoordinator = coordinator;
}

export function notifyQueryFieldAccess(instance: CardDef, field: Field) {
  if (!field.queryDefinition || !queryFieldCoordinator) {
    return;
  }
  if (isQueryFieldEvaluationInProgress(instance, field.name)) {
    return;
  }
  queryFieldCoordinator.handleQueryFieldAccess({
    instance,
    fieldName: field.name,
    field,
  });
}

const queryFieldEvaluationGuards = new WeakMap<BaseDef, Map<string, number>>();
const queryFieldStates = initSharedState(
  'queryFieldStates',
  () => new WeakMap<BaseDef, Map<string, QueryFieldState>>(),
);

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

export function getQueryFieldState(
  instance: BaseDef,
  fieldName: string,
): QueryFieldState | undefined {
  return queryFieldStates.get(instance)?.get(fieldName);
}

function getQueryFieldStateKeys(instance: BaseDef): string[] {
  return Array.from(queryFieldStates.get(instance)?.keys() ?? []);
}

export function beginQueryFieldEvaluation(
  instance: BaseDef,
  fieldName: string,
): () => void {
  let guards = queryFieldEvaluationGuards.get(instance);
  if (!guards) {
    guards = new Map();
    queryFieldEvaluationGuards.set(instance, guards);
  }
  let current = guards.get(fieldName) ?? 0;
  guards.set(fieldName, current + 1);
  return () => {
    let existing = guards?.get(fieldName);
    if (existing === undefined) {
      return;
    }
    if (existing <= 1) {
      guards?.delete(fieldName);
      if (guards && guards.size === 0) {
        queryFieldEvaluationGuards.delete(instance);
      }
    } else {
      guards?.set(fieldName, existing - 1);
    }
  };
}

export function markQueryFieldStaleInternal(
  instance: BaseDef,
  fieldName: string,
  notifyCardTracking: (instance: BaseDef) => void,
): boolean {
  let state = getQueryFieldState(instance, fieldName);
  if (!state || state.stale) {
    return false;
  }
  setQueryFieldState(instance, fieldName, {
    ...state,
    stale: true,
  });
  notifyCardTracking(instance);
  return true;
}

export function isQueryFieldEvaluationInProgress(
  instance: BaseDef,
  fieldName: string,
): boolean {
  return (queryFieldEvaluationGuards.get(instance)?.get(fieldName) ?? 0) > 0;
}

export function validateRelationshipQuery(
  ownerPrototype: BaseDef | undefined,
  fieldName: string,
  query: Query,
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
      let path = token.slice(THIS_INTERPOLATION_PREFIX.length);
      let [head] = path.split('.');
      let referencedField = getField(ownerClass, head, { untracked: true });
      if (!referencedField) {
        let ownerName = ownerClass.name ?? 'Card';
        throw new Error(
          `query field "${fieldName}" references unknown path "${token}" on ${ownerName}`,
        );
      }
    }
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
  let queryFieldsMeta =
    ((resource.meta as any)?.queryFields as Record<string, unknown>) ?? {};

  for (let existingField of getQueryFieldStateKeys(instance)) {
    if (!(existingField in queryFieldsMeta)) {
      setQueryFieldState(instance, existingField, undefined);
    }
  }

  for (let [fieldName] of Object.entries(queryFieldsMeta)) {
    let field = getField(instance, fieldName);
    if (!field || !('queryDefinition' in field) || !field.queryDefinition) {
      setQueryFieldState(instance, fieldName, undefined);
      continue;
    }

    let relationship = resource.relationships?.[fieldName];
    if (!relationship) {
      setQueryFieldState(instance, fieldName, undefined);
      continue;
    }

    let relationshipClone = cloneRelationship(relationship);
    let searchURL = relationshipClone?.links?.search ?? null;
    let realmFromSearch = realmHrefFromSearchURL(searchURL);
    let normalizedQuery: Query | undefined;
    let signature: string | undefined;

    if (typeof searchURL === 'string' && searchURL.length > 0) {
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
          signature = querySignature(normalizedQuery);
        } catch {
          normalizedQuery = undefined;
          signature = undefined;
        }
      }
    }

    setQueryFieldState(instance, fieldName, {
      query: normalizedQuery,
      signature,
      searchURL,
      relationship: relationshipClone,
      realm: realmFromSearch ?? null,
      stale: false,
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
