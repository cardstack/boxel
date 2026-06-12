import { assertQuery, InvalidQueryError, type Query } from './query.ts';
import {
  fanOutRealmSearch,
  SearchRequestError,
  type SearchOpts,
} from './search-utils.ts';
import type {
  SearchEntryCollectionDocument,
  SearchEntryIncludedResource,
} from './document-types.ts';
import {
  CssResourceType,
  HtmlResourceType,
  SearchEntryResourceType,
  htmlResourceId,
  type CardResource,
  type CardResourceType,
  type FileMetaResource,
  type FileMetaResourceType,
  type HtmlQuery,
  type HtmlResource,
  type Relationship,
  type Saved,
  type SearchEntryResource,
} from './resource-types.ts';
import type { CodeRef, ResolvedCodeRef } from './code-ref.ts';
import {
  isValidPrerenderedHtmlFormat,
  PRERENDERED_HTML_FORMATS,
  type PrerenderedHtmlFormat,
} from './prerendered-html-format.ts';
import { isCodeRef } from './card-document-shape.ts';
import { generalSortFields } from './index-query-engine.ts';
import { ensureTrailingSlash } from './paths.ts';

// ---------------------------------------------------------------------------
// The v2 search-entry query.
//
// A v2 request is one query rooted on `search-entry`. Entry MEMBERSHIP is
// addressed through `item.` (the card/file serialization) with the standard
// operator-keyed filter grammar (`eq` / `contains` / `in` / `range` / `any` /
// `every` / `not` / `matches`) — only the addressing changes:
//
//   - the type anchor is `item.on` (a node carrying only the anchor is the
//     pure card-type filter),
//   - field paths inside the operators are reached through `item.`
//     (`eq: { "item.status": "ready" }`),
//   - sort keys are `item.` paths, with `item.on` as a sort entry's own
//     anchor (a card-field sort without one inherits the filter's anchor).
//
// RENDERING SELECTION is bound through `htmlQuery` — a synthesized,
// single-valued field of `search-entry` (the `html` has-many is computed from
// it). It is bound with an ordinary `eq` in the filter's top-level node, and
// being single-valued it can be bound exactly once: binding it in a nested
// node, under `not`, or through any other operator is an unsatisfiable
// binding and is rejected. Its value is a boolean sub-query over the bare
// rendering dimensions (`format` / `renderType`): `eq` leaves composed with
// `every` / `any` / `not`, with real boolean semantics — `not(not(q))`
// selects exactly what `q` selects. It selects which renderings populate the
// `html` has-many; it never affects entry membership. Omitted, the default
// `{ eq: { format: "fitted" } }` applies; an unconstrained htmlQuery ("give
// me everything") is unsupported and rejected. When no `renderType` predicate
// appears anywhere in the htmlQuery, only each result's own native type
// (`types[0]`) is in play — an explicit predicate opens the full
// adoption-chain universe.
//
// `fields[search-entry]` is the sparse fieldset selecting which branches the
// response carries: `html`, `item` (the full serialization), or
// `item.<field>` entries (a field-limited serialization that ships
// `meta.sparseFields` and never enters the Store). No fieldset means the
// default resolution policy: the selected renderings, falling back to `item`
// where none match. A fieldset that excludes `html` makes the htmlQuery
// inert.
//
// The parser translates the wire query into the legacy `Query` the SQL core
// consumes (`item.` prefixes stripped) plus the captured htmlQuery and the
// parsed fieldset.
// ---------------------------------------------------------------------------

const ITEM_PREFIX = 'item.';
const ITEM_ANCHOR = 'item.on';
const HTML_QUERY = 'htmlQuery';

export const DEFAULT_HTML_QUERY = {
  eq: { format: 'fitted' },
} as const satisfies HtmlQuery;

const SEARCH_ENTRY_QUERY_MEMBERS = [
  'filter',
  'sort',
  'page',
  'realms',
  'fields',
  'cardUrls',
];

// The operator members whose value is an object keyed by field paths.
const FIELD_KEYED_OPERATORS = ['eq', 'contains', 'in', 'range'];

// Which form of the `item` serialization the fieldset selects.
export type SearchEntryItemSelection =
  | { kind: 'none' }
  | { kind: 'full' }
  | { kind: 'sparse'; fields: string[] };

export interface SearchEntryFieldset {
  html: boolean;
  item: SearchEntryItemSelection;
  // True only in the default (no `fields` member) mode: the `item` branch
  // appears per result, only where no rendering matched (and the empty `html`
  // relationship is omitted). An explicit fieldset always pins the branches
  // instead.
  itemAsFallback: boolean;
}

// The parsed form of a v2 request: the legacy `Query` for the SQL core (the
// `item.` addressing stripped), the applied (bound or defaulted) htmlQuery,
// and the parsed sparse fieldset. The compat layer constructs this directly
// from a legacy request — it does not round-trip through the wire grammar.
export interface SearchEntryQuery {
  itemQuery: Query;
  htmlQuery: HtmlQuery;
  fieldset: SearchEntryFieldset;
  realms?: string[];
  cardUrls?: string[];
}

function invalidQuery(message: string): SearchRequestError {
  return new SearchRequestError('invalid-query', `Invalid query: ${message}`);
}

function invalidHtmlQuery(message: string): SearchRequestError {
  return new SearchRequestError('invalid-render', message);
}

// The htmlQuery binding captured out of the filter's top-level `eq`. The
// value is validated by `assertHtmlQuery` after the walk.
interface HtmlQueryCapture {
  htmlQuery?: unknown;
}

function stripItemPrefix(fieldPath: string, pointer: string): string {
  if (
    !fieldPath.startsWith(ITEM_PREFIX) ||
    fieldPath.length <= ITEM_PREFIX.length
  ) {
    throw invalidQuery(
      `${pointer}: field paths must be addressed through item. (got "${fieldPath}")`,
    );
  }
  return fieldPath.slice(ITEM_PREFIX.length);
}

// Validates a bound htmlQuery value: one connective or `eq` leaf per node,
// leaves constrain at least one rendering dimension. An unconstrained query
// (an empty leaf or an empty connective) is unsupported — there is no "give
// me everything" spelling.
export function assertHtmlQuery(
  value: unknown,
  pointer = HTML_QUERY,
): asserts value is HtmlQuery {
  if (typeof value !== 'object' || value == null || Array.isArray(value)) {
    throw invalidHtmlQuery(`${pointer}: htmlQuery must be an object`);
  }
  let keys = Object.keys(value);
  if (keys.length !== 1) {
    throw invalidHtmlQuery(
      `${pointer}: an htmlQuery node must have exactly one of eq, every, any, not`,
    );
  }
  let [key] = keys;
  let inner = (value as Record<string, unknown>)[key];
  switch (key) {
    case 'eq': {
      if (typeof inner !== 'object' || inner == null || Array.isArray(inner)) {
        throw invalidHtmlQuery(`${pointer}/eq: eq must be an object`);
      }
      let leaf = inner as Record<string, unknown>;
      let leafKeys = Object.keys(leaf);
      if (leafKeys.length === 0) {
        throw invalidHtmlQuery(
          `${pointer}/eq: an unconstrained htmlQuery is unsupported — constrain format and/or renderType`,
        );
      }
      for (let leafKey of leafKeys) {
        if (leafKey === 'format') {
          if (
            typeof leaf.format !== 'string' ||
            !isValidPrerenderedHtmlFormat(leaf.format)
          ) {
            throw invalidHtmlQuery(
              `${pointer}/eq/format: format must be one of ${PRERENDERED_HTML_FORMATS.join(', ')}`,
            );
          }
        } else if (leafKey === 'renderType') {
          if (!isCodeRef(leaf.renderType)) {
            throw invalidHtmlQuery(
              `${pointer}/eq/renderType: renderType must be a CodeRef`,
            );
          }
        } else {
          throw invalidHtmlQuery(
            `${pointer}/eq: unknown rendering dimension "${leafKey}" — the dimensions are format and renderType`,
          );
        }
      }
      return;
    }
    case 'every':
    case 'any': {
      if (!Array.isArray(inner) || inner.length === 0) {
        throw invalidHtmlQuery(
          `${pointer}/${key}: ${key} must be a non-empty array`,
        );
      }
      inner.forEach((entry, i) =>
        assertHtmlQuery(entry, `${pointer}/${key}[${i}]`),
      );
      return;
    }
    case 'not': {
      assertHtmlQuery(inner, `${pointer}/not`);
      return;
    }
    default:
      throw invalidHtmlQuery(
        `${pointer}: unknown htmlQuery member "${key}" — an htmlQuery node has exactly one of eq, every, any, not`,
      );
  }
}

// Whether any renderType predicate appears in the htmlQuery (negated ones
// count). When none does, only each result's own native type is in play; an
// explicit predicate opens the full adoption-chain universe.
// The formats an htmlQuery names in its eq leaves (any polarity), deduped —
// the identities at which an errored row's failed renderings surface. An
// htmlQuery constraining only renderType names none; the default format
// stands in.
export function htmlQueryFormats(query: HtmlQuery): PrerenderedHtmlFormat[] {
  let formats = new Set<PrerenderedHtmlFormat>();
  let walk = (node: HtmlQuery) => {
    if ('eq' in node) {
      if (node.eq.format !== undefined) {
        formats.add(node.eq.format);
      }
    } else if ('every' in node) {
      node.every.forEach(walk);
    } else if ('any' in node) {
      node.any.forEach(walk);
    } else {
      walk(node.not);
    }
  };
  walk(query);
  if (formats.size === 0) {
    formats.add(DEFAULT_HTML_QUERY.eq.format);
  }
  return [...formats];
}

export function htmlQueryHasRenderTypePredicate(query: HtmlQuery): boolean {
  if ('eq' in query) {
    return query.eq.renderType !== undefined;
  }
  if ('every' in query) {
    return query.every.some(htmlQueryHasRenderTypePredicate);
  }
  if ('any' in query) {
    return query.any.some(htmlQueryHasRenderTypePredicate);
  }
  return htmlQueryHasRenderTypePredicate(query.not);
}

// ---------------------------------------------------------------------------
// htmlQuery evaluation. The engine enumerates each row's candidate renderings
// and evaluates the htmlQuery per candidate — proper boolean semantics over
// the rendering universe, so negation composes (involution holds). The
// renderType CodeRefs in the query are resolved to their `<module>/<name>`
// keys once (`resolveHtmlQuery`), then the pure evaluator runs per candidate.
// ---------------------------------------------------------------------------

// One candidate rendering of a row: a (format, renderType) point in the
// row's rendering set. A file rendering carries no renderTypeKey (files
// render natively), so a renderType predicate never matches it — positively
// or under an even number of negations.
export interface RenderingCandidate {
  format: PrerenderedHtmlFormat;
  renderTypeKey?: string;
}

export type ResolvedHtmlQuery =
  | { eq: { format?: PrerenderedHtmlFormat; renderTypeKey?: string } }
  | { every: ResolvedHtmlQuery[] }
  | { any: ResolvedHtmlQuery[] }
  | { not: ResolvedHtmlQuery };

export function resolveHtmlQuery(
  query: HtmlQuery,
  resolveRenderTypeKey: (ref: CodeRef) => string,
): ResolvedHtmlQuery {
  if ('eq' in query) {
    let { format, renderType } = query.eq;
    return {
      eq: {
        ...(format !== undefined ? { format } : {}),
        ...(renderType !== undefined
          ? { renderTypeKey: resolveRenderTypeKey(renderType) }
          : {}),
      },
    };
  }
  if ('every' in query) {
    return {
      every: query.every.map((q) => resolveHtmlQuery(q, resolveRenderTypeKey)),
    };
  }
  if ('any' in query) {
    return {
      any: query.any.map((q) => resolveHtmlQuery(q, resolveRenderTypeKey)),
    };
  }
  return { not: resolveHtmlQuery(query.not, resolveRenderTypeKey) };
}

export function htmlQueryMatches(
  query: ResolvedHtmlQuery,
  candidate: RenderingCandidate,
): boolean {
  if ('eq' in query) {
    let { format, renderTypeKey } = query.eq;
    if (format !== undefined && candidate.format !== format) {
      return false;
    }
    if (
      renderTypeKey !== undefined &&
      candidate.renderTypeKey !== renderTypeKey
    ) {
      return false;
    }
    return true;
  }
  if ('every' in query) {
    return query.every.every((q) => htmlQueryMatches(q, candidate));
  }
  if ('any' in query) {
    return query.any.some((q) => htmlQueryMatches(q, candidate));
  }
  return !htmlQueryMatches(query.not, candidate);
}

// ---------------------------------------------------------------------------
// Request parsing.
// ---------------------------------------------------------------------------

// Translate one filter node from `item.` addressing to the legacy grammar:
// `item.on` → `on`, field paths inside the operators stripped of their
// `item.` prefix, connectives recursed. The structure (which operators nest
// where) is untouched — `assertQuery` validates the translated result.
//
// `capture` is present only on the root node: an `htmlQuery` binding in the
// root node's `eq` is lifted into it. Anywhere else the binding is
// unsatisfiable (a single-valued field binds once) and rejected.
function translateFilterNode(
  node: unknown,
  pointer: string,
  capture?: HtmlQueryCapture,
): Record<string, unknown> {
  if (typeof node !== 'object' || node == null || Array.isArray(node)) {
    throw invalidQuery(`${pointer}: filter must be an object`);
  }
  let out: Record<string, unknown> = {};
  for (let [key, value] of Object.entries(node)) {
    if (key === ITEM_ANCHOR) {
      out.on = value;
    } else if (key === 'any' || key === 'every') {
      if (!Array.isArray(value)) {
        throw invalidQuery(`${pointer}/${key}: ${key} must be an array`);
      }
      out[key] = value.map((entry, i) =>
        translateFilterNode(entry, `${pointer}/${key}[${i}]`),
      );
    } else if (key === 'not') {
      out.not = translateFilterNode(value, `${pointer}/not`);
    } else if (FIELD_KEYED_OPERATORS.includes(key)) {
      let translated = translateFieldKeys(
        value,
        `${pointer}/${key}`,
        key === 'eq' ? capture : undefined,
      );
      // An eq that carried only the htmlQuery binding vanishes with the lift;
      // a user-authored empty operator is preserved for assertQuery to
      // reject.
      if (
        Object.keys(translated).length === 0 &&
        Object.keys(value as object).length > 0
      ) {
        continue;
      }
      out[key] = translated;
    } else if (key === 'matches') {
      // Full-text match over the whole document — no field path to address.
      out.matches = value;
    } else if (key === HTML_QUERY) {
      throw invalidHtmlQuery(
        `${pointer}/${HTML_QUERY}: ${HTML_QUERY} is a field — bind it with eq: { "${HTML_QUERY}": … }`,
      );
    } else {
      throw invalidQuery(
        `${pointer}: unknown filter member "${key}" — the type anchor is item.on and field paths are addressed through item. inside the filter operators (${FIELD_KEYED_OPERATORS.join(
          '/',
        )})`,
      );
    }
  }
  // A node carrying only the type anchor is the v2 spelling of a pure
  // card-type filter.
  let keys = Object.keys(out);
  if (keys.length === 1 && keys[0] === 'on') {
    return { type: out.on };
  }
  return out;
}

function translateFieldKeys(
  value: unknown,
  pointer: string,
  capture: HtmlQueryCapture | undefined,
): Record<string, unknown> {
  if (typeof value !== 'object' || value == null || Array.isArray(value)) {
    throw invalidQuery(
      `${pointer}: must be an object keyed by item. field paths`,
    );
  }
  let out: Record<string, unknown> = {};
  for (let [fieldPath, fieldValue] of Object.entries(value)) {
    if (fieldPath === HTML_QUERY) {
      if (capture) {
        capture.htmlQuery = fieldValue;
      } else {
        throw invalidHtmlQuery(
          `${pointer}/${HTML_QUERY}: ${HTML_QUERY} is a single-valued synthesized field — bind it once, in the filter's top-level eq`,
        );
      }
      continue;
    }
    out[stripItemPrefix(fieldPath, `${pointer}/${fieldPath}`)] = fieldValue;
  }
  return out;
}

function translateSort(value: unknown, rootAnchor: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw invalidQuery(`sort: sort must be an array`);
  }
  return value.map((entry, i) => {
    let pointer = `sort[${i}]`;
    if (typeof entry !== 'object' || entry == null) {
      throw invalidQuery(`${pointer}: missing sort object`);
    }
    let out: Record<string, unknown> = {};
    for (let [key, v] of Object.entries(entry)) {
      if (key === 'by') {
        if (typeof v !== 'string') {
          throw invalidQuery(`${pointer}/by: by must be a string`);
        }
        out.by = stripItemPrefix(v, `${pointer}/by`);
      } else if (key === ITEM_ANCHOR) {
        out.on = v;
      } else if (key === 'direction') {
        out.direction = v;
      } else if (key === 'on') {
        throw invalidQuery(
          `${pointer}: the sort type anchor is addressed as item.on`,
        );
      } else {
        throw invalidQuery(`${pointer}: unknown sort member "${key}"`);
      }
    }
    // A card-field sort entry without its own anchor inherits the filter's —
    // the sort resolves against the same type the query is anchored on.
    // General (non-card-field) sort keys need no anchor.
    if (
      out.on === undefined &&
      typeof out.by === 'string' &&
      !(out.by in generalSortFields) &&
      rootAnchor !== undefined
    ) {
      out.on = rootAnchor;
    }
    return out;
  });
}

function parseFieldset(fields: unknown): SearchEntryFieldset {
  if (fields === undefined) {
    // No fieldset → the default resolution policy: the selected renderings,
    // falling back to the item serialization where none match.
    return { html: true, item: { kind: 'none' }, itemAsFallback: true };
  }
  if (typeof fields !== 'object' || fields == null || Array.isArray(fields)) {
    throw invalidQuery(`fields must be an object`);
  }
  let keys = Object.keys(fields);
  if (keys.length !== 1 || keys[0] !== 'search-entry') {
    throw invalidQuery(`fields supports only the "search-entry" type`);
  }
  let entries = (fields as Record<string, unknown>)['search-entry'];
  if (
    !Array.isArray(entries) ||
    entries.length === 0 ||
    !entries.every((entry) => typeof entry === 'string')
  ) {
    throw invalidQuery(
      `fields[search-entry] must be a non-empty array of strings`,
    );
  }
  let html = false;
  let itemFull = false;
  let sparseFields: string[] = [];
  for (let entry of entries) {
    if (entry === 'html') {
      html = true;
    } else if (entry === 'item') {
      itemFull = true;
    } else if (
      entry.startsWith(ITEM_PREFIX) &&
      entry.length > ITEM_PREFIX.length
    ) {
      sparseFields.push(entry.slice(ITEM_PREFIX.length));
    } else {
      throw invalidQuery(
        `each fields[search-entry] entry must be "html", "item", or "item.<field>" (got "${entry}")`,
      );
    }
  }
  if (itemFull && sparseFields.length > 0) {
    throw invalidQuery(
      `fields[search-entry] cannot combine "item" (the full serialization) with item.<field> entries`,
    );
  }
  let item: SearchEntryItemSelection = itemFull
    ? { kind: 'full' }
    : sparseFields.length > 0
      ? { kind: 'sparse', fields: [...new Set(sparseFields)] }
      : { kind: 'none' };
  return { html, item, itemAsFallback: false };
}

export function parseSearchEntryQueryFromPayload(
  payload: unknown,
): SearchEntryQuery {
  if (
    payload == null ||
    typeof payload !== 'object' ||
    Array.isArray(payload)
  ) {
    throw invalidQuery(`request body must be a JSON object`);
  }
  let record = payload as Record<string, unknown>;
  for (let key of Object.keys(record)) {
    if (!SEARCH_ENTRY_QUERY_MEMBERS.includes(key)) {
      throw invalidQuery(`unknown member "${key}" in search-entry query`);
    }
  }

  let realms: string[] | undefined;
  if (record.realms !== undefined) {
    if (
      !Array.isArray(record.realms) ||
      !record.realms.every((realm) => typeof realm === 'string')
    ) {
      throw new SearchRequestError(
        'missing-realms',
        'realms must be an array of strings',
      );
    }
    realms = record.realms
      .map((realm) => realm.trim())
      .filter(Boolean)
      .map((realm) => ensureTrailingSlash(realm));
  }

  let cardUrls: string[] | undefined;
  if (record.cardUrls !== undefined) {
    if (typeof record.cardUrls === 'string') {
      cardUrls = [record.cardUrls];
    } else if (
      Array.isArray(record.cardUrls) &&
      record.cardUrls.every((url) => typeof url === 'string')
    ) {
      cardUrls = record.cardUrls;
    } else {
      throw invalidQuery(`cardUrls must be a string or array of strings`);
    }
  }

  let capture: HtmlQueryCapture = {};
  let filter: Record<string, unknown> | undefined;
  if (record.filter !== undefined) {
    filter = translateFilterNode(record.filter, 'filter', capture);
    // A filter that carried only the htmlQuery binding dissolves with the
    // lift — the residual query matches everything.
    if (Object.keys(filter).length === 0) {
      filter = undefined;
    }
  }
  let htmlQuery: HtmlQuery;
  if (capture.htmlQuery !== undefined) {
    assertHtmlQuery(capture.htmlQuery);
    htmlQuery = capture.htmlQuery;
  } else {
    htmlQuery = DEFAULT_HTML_QUERY;
  }

  let rootAnchor = filter?.on ?? filter?.type;
  let sort =
    record.sort !== undefined
      ? translateSort(record.sort, rootAnchor)
      : undefined;

  let itemQuery: Record<string, unknown> = {};
  if (filter) {
    itemQuery.filter = filter;
  }
  if (sort) {
    itemQuery.sort = sort;
  }
  if (record.page !== undefined) {
    itemQuery.page = record.page;
  }
  try {
    assertQuery(itemQuery);
  } catch (e) {
    if (e instanceof InvalidQueryError) {
      throw invalidQuery(e.message);
    }
    throw e;
  }

  let fieldset = parseFieldset(record.fields);

  return {
    itemQuery: itemQuery as Query,
    htmlQuery,
    fieldset,
    realms,
    cardUrls,
  };
}

// ---------------------------------------------------------------------------
// The federated merge + runner. Concatenate `data` in realm order, sum
// `meta.page.total`, and dedupe `included` by the JSON:API identity pair
// `(type, id)` — `html`/`css`/`card`/`file-meta` resources referenced by
// results from more than one realm travel exactly once (`css` ids are
// content hashes, so identical stylesheets across realms collapse). The
// applied htmlQuery is identical across the per-realm documents (one binding
// per request), so the first echo wins.
// ---------------------------------------------------------------------------

export function combineSearchEntryResults(
  docs: SearchEntryCollectionDocument[],
): SearchEntryCollectionDocument {
  let combined: SearchEntryCollectionDocument = {
    data: [],
    meta: { page: { total: 0 } },
  };
  let included: SearchEntryIncludedResource[] = [];
  let includedByIdentity = new Set<string>();

  for (let doc of docs) {
    combined.data.push(...doc.data);
    combined.meta.page.total += doc.meta?.page?.total ?? 0;
    if (combined.meta.htmlQuery == null && doc.meta?.htmlQuery != null) {
      combined.meta.htmlQuery = doc.meta.htmlQuery;
    }
    for (let resource of doc.included ?? []) {
      if (resource.id) {
        // NUL-separated so a `(type, id)` pair can't alias another by
        // concatenation (no resource type or id contains a NUL byte).
        let identity = `${resource.type}\u0000${resource.id}`;
        if (includedByIdentity.has(identity)) {
          continue;
        }
        includedByIdentity.add(identity);
      }
      included.push(resource);
    }
  }

  if (included.length > 0) {
    combined.included = included;
  }
  return combined;
}

type SearchEntrySearchableRealm = {
  searchEntries: (
    searchEntryQuery: SearchEntryQuery,
    opts?: SearchOpts,
  ) => Promise<SearchEntryCollectionDocument>;
  url?: string;
};

export async function searchEntryRealms(
  realms: Array<SearchEntrySearchableRealm | null | undefined>,
  searchEntryQuery: SearchEntryQuery,
  opts?: SearchOpts,
): Promise<SearchEntryCollectionDocument> {
  let docs = await fanOutRealmSearch(
    realms,
    searchEntryQuery.itemQuery,
    (realm) => realm.searchEntries(searchEntryQuery, opts),
    (label, queryLabel) =>
      `searchEntryRealms realm search failed: ${label} query=${queryLabel}`,
  );
  return combineSearchEntryResults(docs);
}

// ---------------------------------------------------------------------------
// Builders for the v2 resources. The projection engine runs these per row
// when assembling a `search-entry` document; keeping them pure (no SQL, no
// realm state) lets the shapes be unit-tested directly. The `css` resource
// builder is shared with the pre-existing search paths (`buildCssResource`).
// ---------------------------------------------------------------------------

// One `search-entry` — the top-level `data` resource for a result. Which
// branches it carries is the resolution policy / sparse fieldset's call; this
// just assembles the linkage. The `item` shares the entry's URL as its id;
// each `html` member points at one specific rendering by its composite id.
// `htmlIds` undefined omits the relationship (the default mode's fallback
// rows); an empty array emits `data: []` (a pinned html branch with no
// matching rendering yet).
export function buildSearchEntryResource(args: {
  url: string;
  htmlIds?: string[];
  itemType?: typeof CardResourceType | typeof FileMetaResourceType;
}): SearchEntryResource {
  let { url, htmlIds, itemType } = args;
  let resource: SearchEntryResource = {
    type: SearchEntryResourceType,
    id: url,
    relationships: {},
  };
  if (htmlIds !== undefined) {
    resource.relationships.html = {
      data: htmlIds.map((id) => ({ type: HtmlResourceType, id })),
    };
  }
  if (itemType !== undefined) {
    resource.relationships.item = { data: { type: itemType, id: url } };
  }
  return resource;
}

// One `html` rendering. Its id is the (card URL, format, renderType)
// composite — pass the same args the id derives from; `format`/`renderType`
// are also carried as attributes (the readable form; the id is an opaque
// cache key). `html` is absent only on an error rendering with no
// last-known-good markup. `styles` references the rendering's `css`
// resources by their content-hash ids.
export function buildHtmlResource(args: {
  url: string;
  format: PrerenderedHtmlFormat;
  renderType?: ResolvedCodeRef;
  html?: string;
  cardType: string;
  iconHtml?: string;
  isError?: boolean;
  cssIds: string[];
}): HtmlResource {
  let { url, format, renderType, html, cardType, iconHtml, isError, cssIds } =
    args;
  return {
    type: HtmlResourceType,
    id: htmlResourceId({ url, format, renderType }),
    attributes: {
      ...(html !== undefined ? { html } : {}),
      cardType,
      ...(iconHtml ? { iconHtml } : {}),
      ...(isError ? { isError: true } : {}),
      format,
      ...(renderType ? { renderType } : {}),
    },
    relationships: {
      styles: {
        data: cssIds.map((id) => ({ type: CssResourceType, id })),
      },
    },
  };
}

// A field-limited (`meta.sparseFields`) projection of a full serialization:
// only the requested fields' attributes (and the relationships rooted at a
// requested field) ride along, and the marker records exactly what was
// requested — so a consumer can tell "sparse" from "full but empty" and the
// Store can refuse it. id / type / links / meta are preserved per JSON:API;
// `meta.fields` is dropped since it describes per-field metadata for fields
// that may not be present.
export function buildSparseItemResource<
  T extends CardResource<Saved> | FileMetaResource,
>(resource: T, sparseFields: string[]): T {
  let attributes: Record<string, any> = {};
  for (let field of sparseFields) {
    let path = field.split('.');
    let value = pickAttributePath(resource.attributes, path);
    if (value !== undefined) {
      setAttributePath(attributes, path, value);
    }
  }
  // A requested field may be a relationship (linksTo / linksToMany — plural
  // entries serialize as `field.N` keys), keyed by its root segment.
  let requestedRoots = new Set(sparseFields.map((f) => f.split('.')[0]));
  let relationships: Record<string, Relationship | Relationship[]> = {};
  for (let [key, relationship] of Object.entries(
    resource.relationships ?? {},
  )) {
    if (requestedRoots.has(key.split('.')[0])) {
      relationships[key] = relationship;
    }
  }
  let { fields: _perFieldMeta, ...meta } = resource.meta;
  let sparse = {
    ...resource,
    attributes,
    meta: { ...meta, sparseFields: [...sparseFields] },
  };
  if (Object.keys(relationships).length > 0) {
    sparse.relationships = relationships;
  } else {
    delete sparse.relationships;
  }
  return sparse;
}

function pickAttributePath(
  source: Record<string, any> | undefined,
  path: string[],
): any {
  let value: any = source;
  for (let segment of path) {
    if (value == null || typeof value !== 'object') {
      return undefined;
    }
    value = value[segment];
  }
  return value;
}

function setAttributePath(
  target: Record<string, any>,
  path: string[],
  value: any,
): void {
  let cursor = target;
  for (let segment of path.slice(0, -1)) {
    cursor = cursor[segment] ??= {};
  }
  cursor[path[path.length - 1]] = value;
}
