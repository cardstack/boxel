import type { Query } from '@cardstack/runtime-common';

// Some models fill in every property the tool schema lists, sending `{}`,
// `[]`, `''` or a `{ module: '', name: '' }` CodeRef for the parts of a query
// they do not mean to use. Those are never a real condition, so drop them
// before the query is validated rather than failing the call on them.
//
// After pruning, a filter left with only `on` (or with `on` and the same
// `type`) names a card type and nothing else, so it becomes a pure type
// filter.
export function pruneEmptyQueryParts(query: Query): Query {
  let result: Record<string, unknown> = { ...query };
  let filter = pruneFilter(query.filter);
  if (filter === undefined) {
    delete result.filter;
  } else {
    result.filter = filter;
  }
  if (Array.isArray(result.sort)) {
    let sort = (result.sort as unknown[]).filter(
      (entry) => isObject(entry) && isNonEmptyString(entry.by),
    );
    if (sort.length === 0) {
      delete result.sort;
    } else {
      result.sort = sort.map((entry) => {
        let { on, ...rest } = entry as Record<string, unknown>;
        return isUsableCodeRef(on) ? { ...rest, on } : rest;
      });
    }
  }
  return result as Query;
}

const CODE_REF_KEYS = new Set(['type', 'on']);
const LIST_KEYS = new Set(['any', 'every']);

function pruneFilter(filter: unknown): Record<string, unknown> | undefined {
  if (!isObject(filter)) {
    return undefined;
  }
  let result: Record<string, unknown> = {};
  for (let [key, value] of Object.entries(filter)) {
    if (CODE_REF_KEYS.has(key)) {
      if (isUsableCodeRef(value)) {
        result[key] = value;
      }
    } else if (LIST_KEYS.has(key)) {
      let items = Array.isArray(value)
        ? value
            .map((item) => pruneFilter(item))
            .filter((item): item is Record<string, unknown> => !!item)
        : [];
      if (items.length > 0) {
        result[key] = items;
      }
    } else if (key === 'not') {
      let inner = pruneFilter(value);
      if (inner) {
        result[key] = inner;
      }
    } else if (key === 'matches') {
      if (isNonEmptyString(value)) {
        result[key] = value;
      }
    } else if (isObject(value)) {
      if (Object.keys(value).length > 0) {
        result[key] = value;
      }
    } else if (value !== undefined && value !== null && value !== '') {
      result[key] = value;
    }
  }

  let keys = Object.keys(result);
  if (keys.length === 0) {
    return undefined;
  }
  let onlyTypeKeys = keys.every((key) => CODE_REF_KEYS.has(key));
  if (onlyTypeKeys) {
    return { type: result.type ?? result.on };
  }
  return result;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
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
