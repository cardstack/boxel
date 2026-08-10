import { codeRefWithAbsoluteIdentifier, type CodeRef } from './code-ref.ts';
import { rri, type RealmResourceIdentifier } from './realm-identifiers.ts';
import { CARD_INSTANCE_FILE_KEY } from './search-doc-keys.ts';
import type { FieldDefinition } from './definitions.ts';
import type {
  FileMetaResource,
  LooseCardResource,
  Relationship,
  ResourceID,
} from './resource-types.ts';
import {
  buildQueryParamValue,
  isAnyFilter,
  isCardTypeFilter,
  isEveryFilter,
  isNotFilter,
  normalizeQueryForSignature,
  type Filter,
  type Query,
  type QueryWithInterpolations,
} from './query.ts';

const EMPTY_PREDICATE_KEYS = new Set([
  'eq',
  'in',
  'contains',
  'range',
  'any',
  'every',
]);

export const THIS_INTERPOLATION_PREFIX = '$this.';
export const THIS_REALM_TOKEN = '$REALM';

function isInterpolationToken(value: unknown): boolean {
  return (
    typeof value === 'string' && value.startsWith(THIS_INTERPOLATION_PREFIX)
  );
}

export interface NormalizeQueryDefinitionParams {
  fieldDefinition: FieldDefinition;
  queryDefinition: QueryWithInterpolations;
  realmURL: URL;
  fieldName: string;
  fieldPath?: string;
  resolvePathValue: (path: string) => any;
  resource?: LooseCardResource | FileMetaResource;
  relativeTo?: RealmResourceIdentifier | URL;
  // Map a value in `realms` onto the realm that holds it. A realm identifier
  // maps to itself; a resource identifier (`@scope/name/Foo/1`) maps to its
  // realm. Supplied by the caller because the realm mappings live in a
  // VirtualNetwork, which neither this module nor a card definition may reach
  // — see `resolveInstanceURL` in card-api. Returning undefined drops the
  // entry, so an unrecognized realm can't silently widen the search.
  resolveRealmForReference?: (reference: string) => string | undefined;
}

export interface NormalizedQueryDefinitionResult {
  query: Query;
  // Every realm the query targets. A query-backed field that filters on
  // absolute references is cross-realm by nature, so this is a set rather than
  // the containing realm alone.
  realms: string[];
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
  resolveRealmForReference,
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

  // `realm` (singular) and `realms` (plural) are mutually exclusive in the
  // Query grammar; either may be an interpolation. Absent both, the field
  // targets the realm holding the instance.
  let specifiedRealms: any =
    queryAny.realms ?? queryAny.realm ?? THIS_REALM_TOKEN;
  // Whether the target was authored as an interpolation — i.e. whatever the
  // instance's data holds — rather than as realm names written into the query.
  // Recorded before interpolation substitutes values, because afterwards a
  // reference id and a realm href are both just strings, and the two need
  // opposite treatment when the resolver can't place them.
  let realmsAreInterpolated =
    isInterpolationToken(specifiedRealms) ||
    (Array.isArray(specifiedRealms) &&
      specifiedRealms.some(isInterpolationToken));
  let interpolatedRealms = interpolateNode(
    specifiedRealms,
    queryAny.realms ? 'realms' : 'realm',
  );
  if (interpolatedRealms !== undefined) {
    specifiedRealms = interpolatedRealms;
  }
  delete queryAny.realm;
  delete queryAny.realms;

  if (aborted) {
    return null;
  }

  // One entry -> zero or more realms. An entry naming a realm resolves to it;
  // an entry naming a resource inside a realm resolves to that realm, which is
  // what lets a field say "search wherever these references live" without the
  // card needing to know the realm layout.
  const resolveOneRealm = (value: any): string | undefined => {
    if (typeof value !== 'string' || value.length === 0) {
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
        return resolveOneRealm(interpolated);
      }
      throw new Error(
        `query field "${fieldName}" must resolve realm interpolation "${value}" to a non-empty string`,
      );
    }
    if (!resolveRealmForReference) {
      return value;
    }
    let resolved = resolveRealmForReference(value);
    if (resolved) {
      return resolved;
    }
    // The resolver only knows the realms this process holds mappings for, which
    // is not every realm that exists. A realm written into the query is honored
    // as written — a field may target a peer this process has never heard of,
    // and that worked before. Values that arrived by interpolation are the
    // instance's own data, so an unplaceable one is dropped rather than
    // mistaken for a realm to search.
    //
    // Provenance decides this, not spelling: a realm href may legitimately be
    // written without a trailing slash (`buildQuerySearchURL` and
    // `parseRealmsParam` both normalize that), so shape says nothing about
    // whether a string names a realm or a resource.
    return realmsAreInterpolated ? undefined : value;
  };

  const resolveRealms = (value: any): string[] => {
    if (value == null) {
      return [realmURL.href];
    }
    let entries = Array.isArray(value) ? value : [value];
    if (entries.length === 0) {
      return [realmURL.href];
    }
    let seen = new Set<string>();
    for (let entry of entries) {
      let resolved = resolveOneRealm(entry);
      if (resolved) {
        seen.add(resolved);
      }
    }
    // Every entry resolved to a realm this network doesn't know. Falling back
    // to the containing realm would quietly search the wrong place, so treat it
    // the same as an empty predicate: the field has no realm to search.
    return [...seen];
  };

  let resolvedRealms = resolveRealms(specifiedRealms);
  if (resolvedRealms.length === 0) {
    return null;
  }

  // Resolve in RRI space: the resource's canonical id (prefix form for mapped
  // realms, URL otherwise) is a valid base for relative code-ref resolution,
  // and the resulting ref keeps its canonical spelling — which the search
  // index and the client-side filter matcher both tolerate.
  let relativeToBase: RealmResourceIdentifier | URL =
    relativeTo ?? (resource?.id ? rri(resource.id) : realmURL);
  let targetRef = codeRefWithAbsoluteIdentifier(
    fieldDefinition.fieldOrCard,
    relativeToBase,
    undefined,
  );

  let filter = queryAny.filter as Record<string, any> | undefined;
  if (!filter || Object.keys(filter).length === 0) {
    queryAny.filter = { type: targetRef };
  } else {
    injectOnIntoLeafFilters(filter, targetRef);
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

  return { query: workingQuery as Query, realms: resolvedRealms };
}

export function getValueForResourcePath(
  resource: LooseCardResource | FileMetaResource,
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

// The seed URL a query-backed relationship advertises as `links.search`. It is
// addressed to the first realm — a search endpoint on any realm can fan out —
// while `realms` names every realm the query covers, so the client rebuilding
// this query lands on the same set.
export function buildQuerySearchURL(
  realmHrefs: string | string[],
  query: Query,
): string {
  let hrefs = (Array.isArray(realmHrefs) ? realmHrefs : [realmHrefs]).map(
    (href) => (href.endsWith('/') ? href : `${href}/`),
  );
  let baseHref = hrefs[0];
  let searchURL = new URL('./_search', baseHref);
  searchURL.searchParams.set('realms', hrefs.join(','));
  // A query-backed field resolves to linked instances, so it asks the
  // entry engine for a data-only projection: each entry carries its
  // full `item` (`card`/`file-meta`) serialization, no prerendered HTML.
  searchURL.searchParams.set('fields[entry]', 'item');
  let normalizedQuery = normalizeQueryForSignature(query);
  searchURL.searchParams.set('query', buildQueryParamValue(normalizedQuery));
  return searchURL.href;
}

function injectOnIntoLeafFilters(
  filter: Record<string, any>,
  targetRef: any,
): void {
  if ('type' in filter) {
    return;
  }
  if ('not' in filter && filter.not && typeof filter.not === 'object') {
    injectOnIntoLeafFilters(filter.not, targetRef);
    return;
  }
  if ('any' in filter && Array.isArray(filter.any)) {
    for (let child of filter.any) {
      if (child && typeof child === 'object') {
        injectOnIntoLeafFilters(child, targetRef);
      }
    }
    return;
  }
  if ('every' in filter && Array.isArray(filter.every)) {
    for (let child of filter.every) {
      if (child && typeof child === 'object') {
        injectOnIntoLeafFilters(child, targetRef);
      }
    }
    return;
  }
  if (!filter.on) {
    filter.on = targetRef;
  }
}

export interface TypeRefResult {
  ref: CodeRef;
  negated: boolean;
}

export function getTypeRefsFromFilter(
  filter: Filter,
): TypeRefResult[] | undefined {
  // Any filter with an explicit 'on' scoping (e.g. specRef in chooseCard)
  if ('on' in filter && filter.on) {
    return [{ ref: filter.on, negated: false }];
  }
  // Top-level CardTypeFilter { type: CodeRef } (e.g. linksTo)
  if (isCardTypeFilter(filter)) {
    return [{ ref: filter.type, negated: false }];
  }
  // NotFilter: recurse and flip negated flag on all results
  if (isNotFilter(filter)) {
    const inner = getTypeRefsFromFilter(filter.not);
    return inner
      ? inner.map((r) => ({ ref: r.ref, negated: !r.negated }))
      : undefined;
  }
  // EveryFilter: recurse into all children and collect
  if (isEveryFilter(filter)) {
    const results = filter.every.flatMap(
      (sub: Filter) => getTypeRefsFromFilter(sub) ?? [],
    );
    return results.length > 0 ? results : undefined;
  }
  // AnyFilter: recurse into all children and collect
  if (isAnyFilter(filter)) {
    const results = filter.any.flatMap(
      (sub: Filter) => getTypeRefsFromFilter(sub) ?? [],
    );
    return results.length > 0 ? results : undefined;
  }
  return undefined;
}

// The dedup filter for a mixed (`scope: 'all'`) entry search: keep card
// instances and plain files, drop a card's dual-indexed `.json` file row (the
// card already appears via its `instance` row). The `_isCardInstanceFile` key
// is stamped only on that file row, so `eq: false` (absent-as-false) keeps
// every other row and drops it. Restricting to a single kind is better done
// with the wire `scope` member (`'cards'`/`'files'`), which pins
// `boxel_index.type` directly; this filter is only for the both-kinds case that
// still wants each card once.
export function excludeCardInstanceFileRows(): Filter {
  return { eq: { [CARD_INSTANCE_FILE_KEY]: false } };
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
