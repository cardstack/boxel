import { THIS_BINDING, bindingReference } from './binding-reference.ts';
import { codeRefWithAbsoluteIdentifier, type CodeRef } from './code-ref.ts';
import {
  isPrefixForm,
  rri,
  type RealmResourceIdentifier,
} from './realm-identifiers.ts';
import { REALM_TOKEN, resolveTypeReferences } from './type-reference.ts';
import { CARD_INSTANCE_FILE_KEY } from './search-doc-keys.ts';
import { normalizeRelationships } from './relationship-utils.ts';
import { resolveRRIReference } from './url.ts';
import { queryFieldDefaultPageSize } from './search-bounds.ts';
import { internalSortKeyIn } from './internal-sort-keys.ts';
import { InvalidQueryError } from './invalid-query-error.ts';
import type { FieldDefinition } from './definitions.ts';
import type {
  FileMetaResource,
  LooseCardResource,
  Relationship,
  ResourceID,
} from './resource-types.ts';
import {
  assertAuthoredQuerySpelling,
  RERANK_REFUSAL,
  usesNewSyntax,
} from './query-syntax.ts';
import {
  assertQuery,
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

// An operator whose value an interpolation left empty: the field resolves to
// no cards, never to every card of its type. `near` belongs here too: a
// `near: '$this.embedding'` sort on a card with no embedding has nothing to
// rank by, so the field resolves to no cards rather than to an unranked list.
const EMPTY_PREDICATE_KEYS = new Set([
  'near',
  'eq',
  'in',
  'contains',
  'range',
  'any',
  'every',
  'matches',
  'pattern',
  'regex',
]);

// The operators for which an interpolation reading null is the same as one
// reading nothing. There is no text to search for, no glob to match and no
// vector to rank by, so the field resolves to no cards. `eq` is not here: an
// `eq` reading null finds the cards with no value there, as `eq: null` always
// has (kept for compatibility).
const NULL_IS_NOTHING_KEYS = new Set(['near', 'matches', 'pattern', 'regex']);

// The filter and sort members that name an operator, so an interpolated value
// knows which operator it sits under, however deep (`near: { embedding: { to:
// '$this.embedding' } }` is under `near`).
const OPERATOR_KEYS = new Set([
  ...EMPTY_PREDICATE_KEYS,
  'not',
  'boost',
  'linkedFrom',
]);

// An interpolated value as plain data. A card's own list (a `containsMany`) is
// a tracked array on the host, which cannot be cloned or serialized as the
// query is passed along, so lists are copied element by element.
function toPlainValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return Array.from(value, (entry) => toPlainValue(entry));
  }
  return value;
}

export const THIS_INTERPOLATION_PREFIX = '$this.';
// The query's own realm, as a whole value (`realm: '$REALM'`) here and as a
// module's root (`$REALM/product#Product`) in type-reference.ts.
export const THIS_REALM_TOKEN = REALM_TOKEN;

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
  // `rerank` is the engine's form of a sort entry with `top`, as `_expr`
  // is of an expression sort: no field query writes either
  if (Object.prototype.hasOwnProperty.call(queryDefinition ?? {}, 'rerank')) {
    throw new InvalidQueryError(
      `${fieldName}: ${RERANK_REFUSAL}`,
      'unknown-key',
    );
  }
  let internal = internalSortKeyIn(
    (queryDefinition as { sort?: unknown }).sort,
  );
  if (internal) {
    throw new InvalidQueryError(
      `${fieldName}: ${internal.path}: "${internal.by}" is not a sort key`,
      'unknown-key',
    );
  }
  let strict = usesNewSyntax(queryDefinition);
  // An author's definition in the newer spelling anchors its type with a
  // top-level `type`, never the older `on` (ADR 022 §1.7).
  assertAuthoredQuerySpelling(queryDefinition, fieldName);
  // Its type references name modules in the card's realm, written `$REALM/`:
  // the realm in its canonical form, prefix form for a mapped one.
  let typeRealm =
    resource?.id && isPrefixForm(resource.id)
      ? resolveRRIReference(`${THIS_REALM_TOKEN}/`, rri(resource.id))
      : realmURL.href;
  let workingQuery: QueryWithInterpolations;
  try {
    workingQuery = resolveTypeReferences(
      JSON.parse(JSON.stringify(queryDefinition)),
      { realm: typeRealm },
    );
  } catch (err: unknown) {
    if (err instanceof InvalidQueryError) {
      throw new InvalidQueryError(`${fieldName}: ${err.message}`, err.code);
    }
    throw err;
  }
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

  // A card's own value is text, never a reference: one that reads as a
  // binding the query declares ("$sofa.priceMin") stands as its text.
  let declared = new Set(
    queryAny.let && typeof queryAny.let === 'object'
      ? Object.keys(queryAny.let)
      : [],
  );
  let asLiteral = (value: unknown): unknown =>
    declared.size === 0
      ? value
      : Array.isArray(value)
        ? value.map(asLiteral)
        : bindingReference(value, declared)
          ? { $literal: value }
          : value;

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

  const resolveInterpolatedValue = (
    path: string,
    context?: string,
    operator?: string,
  ) => {
    let value = resolvePathValue(resolveInterpolationPath(path));
    let nullIsNothing = Boolean(operator && NULL_IS_NOTHING_KEYS.has(operator));
    if (value === undefined || (value === null && nullIsNothing)) {
      // Under an operator, a value that isn't there is no cards, whatever
      // else the node holds: another path of an `eq` (`{ eq: { a: '$this.x',
      // b: 'y' } }` is not `{ eq: { b: 'y' } }`), another entry of an `in`
      // list, a `minSimilarity`, a `within`.
      if (operator && EMPTY_PREDICATE_KEYS.has(operator)) {
        aborted = true;
      }
      markEmptyPredicate(context);
      return undefined;
    }
    return asLiteral(toPlainValue(value));
  };

  // `operator` is the nearest operator above the node (see OPERATOR_KEYS).
  const interpolateNode = (
    node: any,
    context?: string,
    operator?: string,
  ): any => {
    if (aborted) {
      return undefined;
    }

    if (typeof node === 'string') {
      if (node === THIS_REALM_TOKEN) {
        return realmURL.href;
      }
      let ref = bindingReference(node, [THIS_BINDING]);
      if (ref?.path !== undefined) {
        return resolveInterpolatedValue(ref.path, context, operator);
      }
      return node;
    }

    if (Array.isArray(node)) {
      let result: any[] = [];
      for (let entry of node) {
        let interpolated = interpolateNode(entry, context, operator);
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
        let interpolated = interpolateNode(
          value,
          key,
          OPERATOR_KEYS.has(key) ? key : operator,
        );
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

  // A `let` binding's query reads the card's values as the outer query does.
  // It names its own type, so nothing is anchored here.
  if (queryAny.let && typeof queryAny.let === 'object') {
    for (let binding of Object.values(queryAny.let as Record<string, any>)) {
      let from = binding?.from;
      if (!from || typeof from !== 'object') {
        continue;
      }
      for (let member of ['filter', 'sort', 'page']) {
        if (from[member] === undefined) {
          continue;
        }
        let interpolated = interpolateNode(from[member], member);
        if (interpolated === undefined) {
          delete from[member];
        } else {
          from[member] = interpolated;
        }
      }
    }
  }

  // `realm` (singular) and `realms` (plural) are mutually exclusive in the
  // Query grammar; either may be an interpolation. Absent both, the field
  // targets the realm holding the instance.
  let specifiedRealms: any =
    queryAny.realms ?? queryAny.realm ?? THIS_REALM_TOKEN;
  delete queryAny.realm;
  delete queryAny.realms;

  if (aborted) {
    return null;
  }

  // Expand the authored target into one entry per realm, each carrying where it
  // came from. Realms are interpolated here rather than through
  // `interpolateNode` for two reasons: that pass substitutes values in place,
  // losing which entries were written into the query and which came from the
  // instance's data — a distinction the two need opposite treatment for — and
  // it leaves an interpolation that yields a list as a nested array. Expanding
  // per entry keeps provenance and flattens in one step, so a list mixing
  // literal realms with interpolations behaves as each entry was authored.
  type RealmEntry = { value: unknown; interpolated: boolean };
  const expandRealmEntries = (authored: any): RealmEntry[] => {
    let authoredEntries = Array.isArray(authored) ? authored : [authored];
    let expanded: RealmEntry[] = [];
    for (let entry of authoredEntries) {
      if (!isInterpolationToken(entry)) {
        expanded.push({ value: entry, interpolated: false });
        continue;
      }
      let resolved = resolvePathValue(
        resolveInterpolationPath(entry.slice(THIS_INTERPOLATION_PREFIX.length)),
      );
      if (resolved == null) {
        continue;
      }
      for (let value of Array.isArray(resolved) ? resolved : [resolved]) {
        expanded.push({ value, interpolated: true });
      }
    }
    return expanded;
  };

  // One entry -> zero or more realms. An entry naming a realm resolves to it;
  // an entry naming a resource inside a realm resolves to that realm, which is
  // what lets a field say "search wherever these references live" without the
  // card needing to know the realm layout.
  const resolveOneRealm = ({
    value,
    interpolated,
  }: RealmEntry): string | undefined => {
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(
        interpolated
          ? `query field "${fieldName}" must resolve realm interpolation to non-empty strings`
          : `query field "${fieldName}" must resolve realm to a non-empty string`,
      );
    }
    if (value === THIS_REALM_TOKEN) {
      return realmURL.href;
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
    return interpolated ? undefined : value;
  };

  const resolveRealms = (authored: any): string[] => {
    if (authored == null) {
      return [realmURL.href];
    }
    let entries = expandRealmEntries(authored);
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

  // A top-level `type` narrows the field to that type (a subtype of the
  // field's), so the clauses are anchored on it rather than on the field's
  // type. The field's own type still holds as well: a type outside it would
  // otherwise link cards the field cannot hold, so such a query finds no
  // cards. (Telling the two apart needs the type's ancestry, which this
  // module cannot read.)
  // The query as the strict check reads it: as written, with the card's
  // values in place, naming the type it is anchored on at the top (which is
  // what the anchors added below mean).
  let asChecked: Record<string, any> | undefined = strict
    ? JSON.parse(JSON.stringify(workingQuery))
    : undefined;

  let declaredType =
    queryAny.type && typeof queryAny.type === 'object'
      ? codeRefWithAbsoluteIdentifier(queryAny.type, relativeToBase, undefined)
      : undefined;
  if (declaredType) {
    queryAny.type = declaredType;
  }
  let anchorRef = declaredType ?? targetRef;
  let narrowed =
    declaredType !== undefined && !sameCodeRef(declaredType, targetRef);

  let filter = queryAny.filter as Record<string, any> | undefined;
  if (!filter || Object.keys(filter).length === 0) {
    queryAny.filter = narrowed
      ? { every: [{ type: targetRef }, { type: anchorRef }] }
      : { type: anchorRef };
  } else {
    injectOnIntoLeafFilters(filter, anchorRef);
    if (narrowed) {
      queryAny.filter = { every: [{ type: targetRef }, filter] };
    }
  }

  if (Array.isArray(queryAny.sort)) {
    queryAny.sort = queryAny.sort.map((entry: any) => {
      if (entry && typeof entry === 'object' && !('on' in entry)) {
        return { ...entry, on: anchorRef };
      }
      return entry;
    });
  }

  if (fieldDefinition.type === 'linksTo') {
    let page = queryAny.page ?? {};
    page.size = 1;
    page.number = 0;
    queryAny.page = page;
  } else {
    // A field's page is explicit on every leg: one it names, or the field
    // default. A search's default page is smaller, and a field relying on it
    // would read as a different set from the one it declares.
    let page = queryAny.page ?? {};
    page.size = page.size ?? queryFieldDefaultPageSize();
    page.number = page.number ?? 0;
    // `totalMatchCount` is the field's full count (a rollup reads it as
    // one), so a field's search counts exactly unless the field says
    // otherwise; a search's own default stops at a cap.
    page.total = page.total ?? 'exact';
    queryAny.page = page;
  }

  // A field query in the newer spelling is checked as strictly as any other
  // query in it: a member the grammar lacks is refused, not read without it.
  // It is checked as it will run, with the card's values in place.
  if (asChecked) {
    asChecked.type = anchorRef;
    asChecked.page = JSON.parse(JSON.stringify(queryAny.page));
    try {
      assertQuery(asChecked);
    } catch (err: unknown) {
      if (err instanceof InvalidQueryError) {
        throw new InvalidQueryError(`${fieldName}: ${err.message}`, err.code);
      }
      throw err;
    }
  }

  return { query: workingQuery as Query, realms: resolvedRealms };
}

export interface ResourcePathOptions {
  // The canonical spelling of an id read from a link (ADR 002): a URL in a
  // realm with a registered prefix reads in prefix form. Supplied by the
  // caller, which holds the realm mappings; absent, an id reads as resolved.
  canonicalId?: (id: string) => string;
}

export function getValueForResourcePath(
  resource: LooseCardResource | FileMetaResource,
  path: string,
  opts: ResourcePathOptions = {},
): any {
  let value = getAttributeValueForPath(resource, path);
  if (value !== undefined) {
    return value;
  }
  return getLinkIdForPath(resource, path, opts);
}

// `<link>.id` reads the id of the card a `linksTo` field links to, and of each
// card a `linksToMany` links to as a list. A link with no target reads nothing.
function getLinkIdForPath(
  resource: LooseCardResource | FileMetaResource,
  path: string,
  { canonicalId }: ResourcePathOptions,
): any {
  if (!path.endsWith('.id') || !resource.relationships) {
    return undefined;
  }
  let linkPath = path.slice(0, -'.id'.length);
  let idOf = (relationship: Relationship | undefined): string | undefined => {
    let self = relationship?.links?.self;
    let data = relationship?.data as { id?: unknown } | null | undefined;
    let dataId =
      data && !Array.isArray(data) && typeof data.id === 'string'
        ? data.id
        : undefined;
    let reference = typeof self === 'string' && self ? self : dataId;
    if (!reference) {
      return undefined;
    }
    let resolved = resolveRRIReference(
      reference,
      resource.id ? rri(resource.id) : undefined,
    );
    return canonicalId ? canonicalId(resolved) : resolved;
  };
  let relationships = normalizeRelationships(resource.relationships);
  let single = relationships[linkPath];
  if (single) {
    let id = idOf(single);
    if (id !== undefined) {
      return id;
    }
  }
  let members = Object.keys(relationships)
    .filter((key) => /^\d+$/.test(key.slice(linkPath.length + 1)))
    .filter((key) => key.startsWith(`${linkPath}.`))
    .sort(
      (a, b) =>
        Number(a.slice(linkPath.length + 1)) -
        Number(b.slice(linkPath.length + 1)),
    );
  if (members.length === 0) {
    return undefined;
  }
  return members
    .map((key) => idOf(relationships[key]))
    .filter((id): id is string => id !== undefined);
}

function getAttributeValueForPath(
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

function sameCodeRef(a: CodeRef, b: CodeRef): boolean {
  let key = (ref: CodeRef) =>
    'module' in ref && 'name' in ref
      ? `${ref.module}#${ref.name}`
      : JSON.stringify(ref);
  return key(a) === key(b);
}

function injectOnIntoLeafFilters(
  filter: Record<string, any>,
  targetRef: any,
): void {
  if ('type' in filter) {
    return;
  }
  if ('not' in filter && filter.not && typeof filter.not === 'object') {
    // The `not` itself is anchored: anchoring only what it negates would
    // return every card of every other type ("not a Thing with this kind").
    if (!filter.on) {
      filter.on = targetRef;
    }
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
