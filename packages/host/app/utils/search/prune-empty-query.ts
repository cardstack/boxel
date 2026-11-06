import { isEqual } from 'lodash-es';

import {
  MATCH_RELEVANCE_SORT_KEY,
  type Query,
} from '@cardstack/runtime-common';

// Some models fill in every property the tool schema lists, sending `{}`,
// `[]`, `''` or a `{ module: '', name: '' }` CodeRef for the parts of a query
// they do not mean to use. Those are never a real condition, so drop them
// before the query is validated rather than failing the call on them.
//
// After pruning, a filter left with only `on` (or with `on` and the same
// `type`) names a card type and nothing else, so it becomes a pure type
// filter. A sort entry that names no field (`by` left blank) is dropped too:
// there is nothing to sort by.
//
// A part that is not empty but has the wrong shape — a `filter` that is a
// string, a `matches` that is a list, a card type given by name — is not a
// part left unfilled. It is kept, so validation refuses it and says what to
// write instead; dropping it would widen the search, often to everything.
export function pruneEmptyQueryParts(query: Query): Query {
  let result: Record<string, unknown> = { ...query };
  let filter = pruneFilterPart(query.filter);
  if (filter === undefined) {
    delete result.filter;
  } else {
    result.filter = filter;
  }
  for (let key of ['sort', 'page'] as const) {
    if (key in result && isEmpty(result[key])) {
      delete result[key];
    }
  }
  if (Array.isArray(result.sort)) {
    // A relevance sort ranks by the query's search terms; with none left
    // (a model often sends an empty `matches`), the engine rejects it.
    let hasTerms = hasPositiveMatches(isObject(filter) ? filter : undefined);
    let sort = (result.sort as unknown[]).filter(
      (entry) =>
        !isEmpty(entry) &&
        !(
          isObject(entry) &&
          (isEmpty(entry.by) ||
            (!hasTerms && entry.by === MATCH_RELEVANCE_SORT_KEY))
        ),
    );
    if (sort.length === 0) {
      delete result.sort;
    } else {
      result.sort = sort.map((entry) => {
        if (!isObject(entry)) {
          return entry;
        }
        let { on, ...rest } = entry;
        // Relevance is not a field of any card type, so it takes no anchor;
        // the engine rejects `_matchRelevance` with `on` in every realm.
        if (rest.by === MATCH_RELEVANCE_SORT_KEY) {
          return rest;
        }
        return isBlankCodeRef(on) ? rest : { ...rest, on };
      });
    }
  }
  return result as Query;
}

const CODE_REF_KEYS = new Set(['type', 'on']);
const LIST_KEYS = new Set(['any', 'every']);

// A filter pruned of its empty parts, or a non-empty value that is not a
// filter object, kept as it is for validation to refuse.
function pruneFilterPart(value: unknown): unknown {
  if (isObject(value)) {
    return pruneFilter(value);
  }
  return isEmpty(value) ? undefined : value;
}

function pruneFilter(
  filter: Record<string, unknown>,
): Record<string, unknown> | undefined {
  let result: Record<string, unknown> = {};
  for (let [key, value] of Object.entries(filter)) {
    if (CODE_REF_KEYS.has(key)) {
      if (!isBlankCodeRef(value)) {
        result[key] = value;
      }
    } else if (LIST_KEYS.has(key)) {
      if (Array.isArray(value)) {
        let items = value
          .map((item) => pruneFilterPart(item))
          .filter((item) => item !== undefined);
        if (items.length > 0) {
          result[key] = items;
        }
      } else if (!isEmpty(value)) {
        result[key] = value;
      }
    } else if (key === 'not') {
      let inner = pruneFilterPart(value);
      if (inner !== undefined) {
        result[key] = inner;
      }
    } else if (key === 'matches') {
      if (!isEmpty(value)) {
        result[key] = value;
      }
    } else if (!isEmpty(value)) {
      result[key] = value;
    }
  }

  let keys = Object.keys(result);
  if (keys.length === 0) {
    return undefined;
  }
  // A ref of the wrong shape stays under the key the model wrote, so the
  // refusal names that key. So does an `on` that names a different type from
  // `type`: neither one is the filter's single card type.
  let onlyOneUsableType =
    keys.every(
      (key) => CODE_REF_KEYS.has(key) && isUsableCodeRef(result[key]),
    ) &&
    (keys.length === 1 || isEqual(result.on, result.type));
  if (onlyOneUsableType) {
    return { type: result.type ?? result.on };
  }
  return result;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// A part a model fills in for a schema property it does not mean to use.
function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true;
  }
  if (typeof value === 'string') {
    return value.trim().length === 0;
  }
  if (Array.isArray(value)) {
    return value.every(isEmpty);
  }
  if (isObject(value)) {
    return Object.keys(value).length === 0;
  }
  return false;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

// A code ref a model fills in for a card type it does not mean to set:
// `{ module: '', name: '' }`, or nothing at all. A string, or a ref with only
// one of its fields filled in, is not blank; it is kept for validation to
// refuse.
function isBlankCodeRef(value: unknown): boolean {
  if (isEmpty(value)) {
    return true;
  }
  if (!isObject(value) || 'type' in value) {
    return false;
  }
  return Object.values(value).every(isEmpty);
}

function isUsableCodeRef(value: unknown): boolean {
  if (!isObject(value)) {
    return false;
  }
  // A nested ref ({ type: 'exportedCard' | 'fieldOf' ... }) carries its own
  // shape; leave it for validation.
  if ('type' in value) {
    return true;
  }
  return isNonEmptyString(value.module) && isNonEmptyString(value.name);
}

// Whether the filter searches for any text, outside a `not`.
function hasPositiveMatches(
  filter: Record<string, unknown> | undefined,
): boolean {
  if (!filter) {
    return false;
  }
  if (isNonEmptyString(filter.matches)) {
    return true;
  }
  for (let key of LIST_KEYS) {
    let items = filter[key];
    if (
      Array.isArray(items) &&
      items.some((item) => hasPositiveMatches(item as Record<string, unknown>))
    ) {
      return true;
    }
  }
  return false;
}
