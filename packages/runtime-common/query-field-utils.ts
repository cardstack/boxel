import { codeRefWithAbsoluteURL } from './code-ref';
import type { FieldDefinition } from './definitions';
import type {
  LooseCardResource,
  Relationship,
  ResourceID,
} from './resource-types';
import {
  buildQueryParamValue,
  normalizeQueryForSignature,
  type Query,
  type QueryWithInterpolations,
} from './query';

const EMPTY_PREDICATE_KEYS = new Set([
  'eq',
  'contains',
  'range',
  'any',
  'every',
]);

export const THIS_INTERPOLATION_PREFIX = '$this.';
export const THIS_REALM_TOKEN = '$thisRealm';

export interface NormalizeQueryDefinitionParams {
  fieldDefinition: FieldDefinition;
  queryDefinition: QueryWithInterpolations;
  realmURL: URL;
  fieldName: string;
  fieldPath?: string;
  resolvePathValue: (path: string) => any;
  resource?: LooseCardResource;
  relativeTo?: URL;
}

export interface NormalizedQueryDefinitionResult {
  query: Query;
  realm: string;
}

export function normalizeQueryDefinition({
  fieldDefinition,
  queryDefinition,
  realmURL,
  fieldName,
  fieldPath,
  resolvePathValue,
  resource,
  relativeTo,
}: NormalizeQueryDefinitionParams): NormalizedQueryDefinitionResult | null {
  let workingQuery: QueryWithInterpolations = JSON.parse(
    JSON.stringify(queryDefinition),
  );
  let queryAny = workingQuery as Record<string, any>;
  let aborted = false;
  let basePath =
    fieldPath ??
    (fieldName.includes('.')
      ? fieldName.slice(0, fieldName.lastIndexOf('.'))
      : '');
  if (!basePath && resource?.relationships) {
    let matchingKey = Object.keys(resource.relationships).find((key) =>
      key.endsWith(`.${fieldName}`),
    );
    if (matchingKey) {
      basePath = matchingKey.slice(0, matchingKey.lastIndexOf('.'));
    }
  }

  let resolveInterpolationPath = (path: string) => {
    if (!basePath) {
      return path;
    }
    return path.startsWith(`${basePath}.`) ? path : `${basePath}.${path}`;
  };

  const markEmptyPredicate = (context?: string) => {
    if (context && EMPTY_PREDICATE_KEYS.has(context)) {
      aborted = true;
    }
  };

  const resolveInterpolatedValue = (path: string, context?: string) => {
    let value = resolvePathValue(resolveInterpolationPath(path));
    if (value === undefined) {
      markEmptyPredicate(context);
      return undefined;
    }
    return value;
  };

  const interpolateNode = (node: any, context?: string): any => {
    if (aborted) {
      return undefined;
    }

    if (typeof node === 'string') {
      if (node === THIS_REALM_TOKEN) {
        return realmURL.href;
      }
      if (node.startsWith(THIS_INTERPOLATION_PREFIX)) {
        return resolveInterpolatedValue(
          node.slice(THIS_INTERPOLATION_PREFIX.length),
          context,
        );
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

  let specifiedRealm: any = queryAny.realm ?? THIS_REALM_TOKEN;
  let interpolatedRealm = interpolateNode(specifiedRealm, 'realm');
  if (interpolatedRealm !== undefined) {
    specifiedRealm = interpolatedRealm;
  }
  delete queryAny.realm;

  if (aborted) {
    return null;
  }

  const resolveRealm = (value: any): string => {
    if (value == null) {
      return realmURL.href;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) {
        return realmURL.href;
      }
      if (value.length > 1) {
        throw new Error(
          `query field "${fieldName}" only supports a single realm but received multiple entries`,
        );
      }
      return resolveRealm(value[0]);
    }
    if (typeof value !== 'string') {
      throw new Error(
        `query field "${fieldName}" must resolve realm to a string`,
      );
    }
    if (value.length === 0) {
      throw new Error(
        `query field "${fieldName}" must resolve realm to a non-empty string`,
      );
    }
    if (value === THIS_REALM_TOKEN) {
      return realmURL.href;
    }
    if (value.startsWith(THIS_INTERPOLATION_PREFIX)) {
      let interpolated = resolvePathValue(
        resolveInterpolationPath(value.slice(THIS_INTERPOLATION_PREFIX.length)),
      );
      if (typeof interpolated === 'string' && interpolated.length > 0) {
        return interpolated;
      }
      throw new Error(
        `query field "${fieldName}" must resolve realm interpolation "${value}" to a non-empty string`,
      );
    }
    return value;
  };

  let resolvedRealm = resolveRealm(specifiedRealm);

  let relativeToURL =
    relativeTo ?? (resource?.id ? new URL(resource.id) : realmURL);
  let targetRef = codeRefWithAbsoluteURL(
    fieldDefinition.fieldOrCard,
    relativeToURL,
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

  return { query: workingQuery as Query, realm: resolvedRealm };
}

export function getValueForResourcePath(
  resource: LooseCardResource,
  path: string,
): any {
  let root: any = {
    ...(resource.attributes ?? {}),
    id: resource.id,
  };
  let segments = path.split('.');
  let current: any = root;
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
    if (
      typeof current === 'object' &&
      'attributes' in current &&
      typeof (current as any).attributes === 'object' &&
      (current as any).attributes !== null &&
      segment in (current as any).attributes
    ) {
      current = (current as any).attributes[segment];
      continue;
    }
    return undefined;
  }
  return current;
}

export function buildQuerySearchURL(realmHref: string, query: Query): string {
  let baseHref = realmHref.endsWith('/') ? realmHref : `${realmHref}/`;
  let searchURL = new URL('./_search', baseHref);
  searchURL.searchParams.set('realms', baseHref);
  let normalizedQuery = normalizeQueryForSignature(query);
  searchURL.searchParams.set('query', buildQueryParamValue(normalizedQuery));
  return searchURL.href;
}

export function cloneRelationship(
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
