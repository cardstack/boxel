import {
  assertQuery,
  InvalidQueryError,
  nearestMember,
  isRelevanceSort,
  type Facet,
  type FacetStats,
  type Filter,
  type Query,
  type Sort,
  type FacetCount,
  type LetBinding,
  type ResultExplanation,
  type PageTotalMode,
  MAX_LET_BINDINGS,
  WHEN_SIGNAL_KEY,
  DEFAULT_FACET_SIZE,
  MAX_FACET_SIZE,
} from './query.ts';
import {
  emitSearchTiming,
  SearchRequestError,
  type SearchOpts,
} from './search-utils.ts';
import { RequestTimings } from './request-timings.ts';
import { SearchBoundError } from './search-bounds.ts';
import { internalSortKeyIn } from './internal-sort-keys.ts';
import { lowerQuery, usesNewSyntax } from './query-syntax.ts';
import { BXL_FORMULA_FUNCTIONS } from '@cardstack/bxl/compiler';
import type {
  EntryCollectionDocument,
  EntryIncludedResource,
} from './document-types.ts';
import {
  CssResourceType,
  HtmlResourceType,
  IconResourceType,
  EntryResourceType,
  htmlResourceId,
  resourceIdentity,
  type CardResource,
  type CardResourceType,
  type FileMetaResource,
  type FileMetaResourceType,
  type HtmlQuery,
  type HtmlResource,
  type IconResource,
  type Relationship,
  type Saved,
  type EntryResource,
} from './resource-types.ts';
import type { CodeRef, ResolvedCodeRef } from './code-ref.ts';
import {
  isValidPrerenderedHtmlFormat,
  PRERENDERED_HTML_FORMATS,
  type PrerenderedHtmlFormat,
} from './prerendered-html-format.ts';
import { isCodeRef, isResolvedCodeRef } from './card-document-shape.ts';
import {
  generalSortFields,
  MATCH_RELEVANCE_SORT_KEY,
  BLEND_SORT_KEY,
  isNearSort,
  isBlendSort,
  defaultSortDirection,
} from './index-query-engine.ts';
import { ensureTrailingSlash } from './paths.ts';
import { parseUsedRenderType } from './search-resource-helpers.ts';

// ---------------------------------------------------------------------------
// The entry query.
//
// An entry request is one query rooted on `entry`. Entry MEMBERSHIP is
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
// single-valued field of `entry` (the `html` has-many is computed from
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
// `fields[entry]` is the sparse fieldset selecting which branches the
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

const WIRE_SORT_MEMBERS = [
  'by',
  'item.on',
  'direction',
  'missing',
  'near',
  'weight',
  'weights',
  'method',
  'k',
  'of',
  'expr',
  'when',
];
const SEARCH_ENTRY_QUERY_MEMBERS = [
  'filter',
  'sort',
  'page',
  'facets',
  'collapse',
  'let',
  'explain',
  'rerank',
  'realms',
  'fields',
  'select',
  'federation',
  'cardUrls',
  'scope',
];

// Which row kinds a search spans. Pins `boxel_index.type` directly, so it works
// for any filter shape and is independent of index-stamp state — unlike
// discriminating kind through a `{ type: … }` anchor or the
// `_isCardInstanceFile` dedup key. `'all'` (the default) returns both kinds,
// including both rows of a dual-indexed card `.json`; a caller that wants the
// `.json` file row dropped adds the dedup filter explicitly.
export type SearchEntryScope = 'cards' | 'files' | 'all';

const SEARCH_ENTRY_SCOPES: SearchEntryScope[] = ['cards', 'files', 'all'];

// The operator members whose value is an object keyed by field paths.
const FIELD_KEYED_OPERATORS = [
  'eq',
  'contains',
  'in',
  'range',
  'near',
  'pattern',
  'regex',
];

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

// The parsed form of an entry request: the legacy `Query` for the SQL core (the
// `item.` addressing stripped), the applied (bound or defaulted) htmlQuery,
// and the parsed sparse fieldset. The compat layer constructs this directly
// from a legacy request — it does not round-trip through the wire grammar.
export interface SearchEntryQuery {
  itemQuery: Query;
  htmlQuery: HtmlQuery;
  fieldset: SearchEntryFieldset;
  realms?: string[];
  cardUrls?: string[];
  scope?: SearchEntryScope;
  // The card types an entry must be one of to satisfy this query's filter, or
  // `undefined` when the filter admits an entry of any type — see
  // `wireFilterTypeAnchors`. Read off the wire filter, which carries the
  // `item.on` anchors the translation to `itemQuery` spreads across `on` and
  // `type`.
  typeAnchors?: CodeRef[];
  // Set by `policyScopedQuery`: the caller reads this realm only through its
  // policy, so the engine applies the small-count rules to word statistics.
  // Internal; not part of the wire grammar.
  anonymizeStatistics?: boolean;
  // Set by `policyScopedQuery`: the policy's grants, which a linked card
  // must meet for its title to label a link facet's value. Internal.
  labelFilter?: Filter;
  // Set by `policyScopedQuery`: the policy's grants, kept apart from the
  // caller's filter. The engine applies them to every read it makes for the
  // query, beside the caller's filter rather than inside it, so a rewrite
  // of the caller's filter (a facet's `own: 'ignore'`) cannot drop them.
  // Internal.
  grantFilter?: Filter;
  // Set by the realm for a caller its policy scopes: the grants a direct
  // read of a card of `type` would face (null where none admits the caller),
  // for reads of cards of another type than the query's. Internal; in
  // process only.
  grantsForType?: (type: CodeRef) => Promise<Filter[] | null>;
  // `select`: values to read off each row's search doc, by path, in order.
  // The response is then a table (`{ columns, rows }`), not entries.
  columns?: SearchColumn[];
  // A search over several realms: each realm's rows in a section of their own
  // (the default) or one merged, globally paged list.
  federation?: { results: 'byRealm' | 'merged' };
  // Set by the federated merge on each realm's query: answer each row with
  // the values the query sorted it by (`meta._sortValues`), so rows from
  // different realms can be ordered by the query's own sort. Internal.
  exposeSortValues?: boolean;
  // The query's rerank is an expression it placed over the top window (see
  // `lowerEntryPayload`), so the engine reports it as the query's
  // expression. Internal.
  expressionOverTopWindow?: boolean;
}

// One requested column: the name it goes out under, and the search-doc path
// (bare, `item.` stripped) or score it reads.
export interface SearchColumn {
  name: string;
  path: string;
}

// The answer to a `select` search: one row per match, `id` first, then each
// requested column in order. A value is what the search doc holds (a list
// field reads as a list), or null. `meta` carries the page total and any
// facets, as an entry search's does.
export interface SearchColumnsDocument {
  columns: string[];
  rows: unknown[][];
  meta: { page?: { total?: number } } & Record<string, unknown>;
}

export const MAX_COLUMNS = 64;
const COLUMN_PATH = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/;

// `select: ['title', 'brand.name', { sku: 'itemId' }]`: a path names a
// column after itself, a one-member object renames it. `id` is always the
// first column, so no column may take that name.
function parseColumns(value: unknown): SearchColumn[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw invalidQuery(
      'select must be a non-empty list of field paths, such as ["title", "brand.name"]',
      'invalid-value',
    );
  }
  if (value.length > MAX_COLUMNS) {
    throw invalidQuery(
      `select takes at most ${MAX_COLUMNS} paths`,
      'limit-exceeded',
    );
  }
  let out: SearchColumn[] = [];
  let names = new Set<string>(['id']);
  for (let [i, entry] of value.entries()) {
    let name: string;
    let path: unknown;
    if (typeof entry === 'string') {
      path = entry;
      name = entry.startsWith(ITEM_PREFIX)
        ? entry.slice(ITEM_PREFIX.length)
        : entry;
    } else if (
      entry &&
      typeof entry === 'object' &&
      !Array.isArray(entry) &&
      Object.keys(entry).length === 1
    ) {
      [[name, path]] = Object.entries(entry as Record<string, unknown>);
    } else {
      throw invalidQuery(
        `select/${i}: a column is a path, or { name: path } to rename it`,
        'invalid-value',
      );
    }
    if (typeof path !== 'string') {
      throw invalidQuery(`select/${i}: a path is a string`, 'invalid-value');
    }
    let bare = path.startsWith(ITEM_PREFIX)
      ? path.slice(ITEM_PREFIX.length)
      : path;
    if (!COLUMN_PATH.test(bare)) {
      throw invalidQuery(
        `select/${i}: "${path}" is not a field path`,
        'invalid-value',
      );
    }
    if (names.has(name)) {
      throw invalidQuery(
        name === 'id'
          ? `select/${i}: every row starts with its id; name this column something else`
          : `select/${i}: two columns are named "${name}"`,
        'conflicting-members',
      );
    }
    names.add(name);
    out.push({ name, path: bare });
  }
  return out;
}

function invalidQuery(message: string, code?: string): SearchRequestError {
  return new SearchRequestError(
    'invalid-query',
    `Invalid query: ${message}`,
    code,
  );
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
    } else if (key === 'prefix' || key === 'typos' || key === 'scope') {
      // matches' type-ahead, typo and title-scope options; assertQuery
      // checks they sit beside matches.
      out[key] = value;
    } else if (key === 'typeahead') {
      // Type-ahead over the `_typeahead` text — no field path to address.
      out.typeahead = value;
    } else if (key === 'linkedFrom') {
      // another card's links: its URL and its own field name, neither of
      // them a path on the cards being searched.
      out.linkedFrom = value;
    } else if (key === 'fields') {
      // matches' field scope: field paths through item.
      if (
        !Array.isArray(value) ||
        !value.every((f) => typeof f === 'string' && f.startsWith(ITEM_PREFIX))
      ) {
        throw invalidQuery(
          `${pointer}/fields: fields lists field paths through item., such as ["item.material"]`,
        );
      }
      out.fields = (value as string[]).map((f) => f.slice(ITEM_PREFIX.length));
    } else if (key === 'within') {
      // matches' passage list, addressed through item. like any field path.
      if (typeof value !== 'string' || !value.startsWith(ITEM_PREFIX)) {
        throw invalidQuery(
          `${pointer}/within: within names a passage list field through item., such as "item.segments"`,
        );
      }
      out.within = value.slice(ITEM_PREFIX.length);
    } else if (key === HTML_QUERY) {
      throw invalidHtmlQuery(
        `${pointer}/${HTML_QUERY}: ${HTML_QUERY} is a field — bind it with eq: { "${HTML_QUERY}": … }`,
      );
    } else {
      throw invalidQuery(
        `${pointer}: unknown filter member "${key}" — the type anchor is item.on and field paths are addressed through item. inside the filter operators (${FIELD_KEYED_OPERATORS.join(
          '/',
        )})`,
        'unknown-key',
      );
    }
  }
  // A node carrying only the type anchor is the entry spelling of a pure
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

function translateSort(
  value: unknown,
  rootAnchor: unknown,
  path = 'sort',
): unknown[] {
  if (!Array.isArray(value)) {
    throw invalidQuery(`${path}: sort must be an array`);
  }
  return value.map((entry, i) => {
    let pointer = `${path}[${i}]`;
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
      } else if (key === 'missing') {
        out.missing = v;
      } else if (key === 'near') {
        out.near = v;
      } else if (
        key === 'weight' ||
        key === 'weights' ||
        key === 'method' ||
        key === 'k'
      ) {
        out[key] = v;
      } else if (key === 'of') {
        // a `_blend` sort's signals: sort entries in the same grammar
        out.of = translateSort(v, rootAnchor, `${pointer}/of`);
      } else if (key === 'expr') {
        // an `_expr` sort's formula; its field names are the card's own
        out.expr = v;
      } else if (key === 'when') {
        // a `_when` signal's filter, in the filter grammar; it takes the
        // query's anchor when it names none
        let when = translateFilterNode(v, `${pointer}/when`, {});
        if (
          when.on === undefined &&
          when.type === undefined &&
          rootAnchor !== undefined
        ) {
          when = { on: rootAnchor, ...when };
        }
        out.when = when;
      } else if (key === 'on') {
        throw invalidQuery(
          `${pointer}: the sort type anchor is addressed as item.on`,
        );
      } else {
        let near = nearestMember(key, WIRE_SORT_MEMBERS);
        throw invalidQuery(
          `${pointer}: unknown sort member "${key}"${near ? `; did you mean "${near}"?` : ''}`,
          'unknown-key',
        );
      }
    }
    // A card-field sort entry without its own anchor inherits the filter's —
    // the sort resolves against the same type the query is anchored on.
    // General (non-card-field) sort keys need no anchor.
    if (
      out.on === undefined &&
      typeof out.by === 'string' &&
      !(out.by in generalSortFields) &&
      out.by !== MATCH_RELEVANCE_SORT_KEY &&
      out.by !== BLEND_SORT_KEY &&
      out.by !== WHEN_SIGNAL_KEY &&
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
  if (keys.length !== 1 || keys[0] !== 'entry') {
    throw invalidQuery(`fields supports only the "entry" type`);
  }
  let entries = (fields as Record<string, unknown>)['entry'];
  if (
    !Array.isArray(entries) ||
    entries.length === 0 ||
    !entries.every((entry) => typeof entry === 'string')
  ) {
    throw invalidQuery(`fields[entry] must be a non-empty array of strings`);
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
        `each fields[entry] entry must be "html", "item", or "item.<field>" (got "${entry}")`,
      );
    }
  }
  if (itemFull && sparseFields.length > 0) {
    throw invalidQuery(
      `fields[entry] cannot combine "item" (the full serialization) with item.<field> entries`,
    );
  }
  let item: SearchEntryItemSelection = itemFull
    ? { kind: 'full' }
    : sparseFields.length > 0
      ? { kind: 'sparse', fields: [...new Set(sparseFields)] }
      : { kind: 'none' };
  return { html, item, itemAsFallback: false };
}

// Facets in the wire grammar name their field through `item.`, like every
// other field path; the engine's grammar names it bare. Anything that isn't a
// facet object is passed through for `assertQuery` to reject.
function translateFacets(facets: unknown): unknown {
  if (!Array.isArray(facets)) {
    return facets;
  }
  return facets.map((facet) => {
    if (
      typeof facet !== 'object' ||
      facet == null ||
      typeof (facet as { by?: unknown }).by !== 'string'
    ) {
      return facet;
    }
    let by = (facet as { by: string }).by;
    if (!by.startsWith(ITEM_PREFIX)) {
      throw invalidQuery(
        `facets: by is a field path addressed through item., such as "item.category"`,
      );
    }
    return { ...facet, by: by.slice(ITEM_PREFIX.length) };
  });
}

// `collapse` in the wire grammar names its field through `item.` and its
// type as `item.on`; without one it takes the filter's root anchor.
function translateCollapse(collapse: unknown, rootAnchor: unknown): unknown {
  let shape: Record<string, unknown> | undefined =
    typeof collapse === 'string'
      ? { by: collapse }
      : typeof collapse === 'object' &&
          collapse != null &&
          !Array.isArray(collapse)
        ? { ...(collapse as Record<string, unknown>) }
        : undefined;
  if (!shape || typeof shape.by !== 'string') {
    return collapse;
  }
  if (!(shape.by as string).startsWith(ITEM_PREFIX)) {
    throw invalidQuery(
      `collapse: by is a field path addressed through item., such as "item.productType"`,
    );
  }
  let out: Record<string, unknown> = {
    by: (shape.by as string).slice(ITEM_PREFIX.length),
  };
  let on = shape[ITEM_ANCHOR] ?? rootAnchor;
  if (on !== undefined) {
    out.on = on;
  }
  for (let [key, value] of Object.entries(shape)) {
    if (key !== 'by' && key !== ITEM_ANCHOR) {
      out[key] = value;
    }
  }
  return out;
}

// A request in the newer spellings (query-syntax.ts) lowers to today's wire
// query before anything else reads it: its query members are unwired
// (`item.on` → `on`), lowered, and wired again; the entry-only members
// (`fields`, `realms`, `cardUrls`, `scope`) ride along untouched.
const QUERY_MEMBERS = new Set([
  'type',
  'filter',
  'sort',
  'page',
  'facets',
  'collapse',
  'let',
  'explain',
  'rerank',
]);
// The wire's spellings back to the card grammar's: `item.on` → `on`, and
// `item.` off every field path (operator keys, `by`, `select`, `collapse`,
// a comparison's `by` and `near`, `fields`). Values stay as written.
const WIRE_PATH_OPS = new Set([
  'eq',
  'in',
  'range',
  'contains',
  'near',
  'pattern',
  'regex',
]);
const unprefix = (p: unknown) =>
  typeof p === 'string' && p.startsWith(ITEM_PREFIX)
    ? p.slice(ITEM_PREFIX.length)
    : p;
function unwireAnchors(node: unknown, key?: string): unknown {
  if (Array.isArray(node)) {
    return key === 'fields'
      ? node.map(unprefix)
      : node.map((n) => unwireAnchors(n));
  }
  if (node == null || typeof node !== 'object') {
    return ['by', 'select', 'collapse'].includes(key ?? '')
      ? unprefix(node)
      : node;
  }
  let out: Record<string, unknown> = {};
  for (let [k, v] of Object.entries(node as Record<string, unknown>)) {
    let name = k === 'item.on' ? 'on' : k === 'item.type' ? 'type' : k;
    if (name === 'on' || name === 'type') {
      out[name] = v; // a code ref is a value
    } else if (
      WIRE_PATH_OPS.has(k) &&
      v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      // a sort's near target is a vector, not a map of paths
      !(k === 'near' && 'dims' in (v as object))
    ) {
      out[k] = Object.fromEntries(
        Object.entries(v as Record<string, unknown>).map(([p, x]) => [
          unprefix(p) as string,
          x,
        ]),
      );
    } else if (k === 'compare' && v && typeof v === 'object') {
      let c = unwireAnchors(v) as Record<string, unknown>;
      out[k] = { ...c, ...(c.near ? { near: unprefix(c.near) } : {}) };
    } else {
      out[k] = unwireAnchors(v, k);
    }
  }
  return out;
}

function refuseInternalSortKeys(sort: unknown) {
  let found = internalSortKeyIn(sort);
  if (found) {
    throw invalidQuery(
      `${found.path}: "${found.by}" is not a sort key`,
      'unknown-key',
    );
  }
}

function lowerEntryPayload(record: Record<string, unknown>): {
  record: Record<string, unknown>;
  expressionOverTopWindow?: boolean;
} {
  refuseInternalSortKeys(record.sort);
  let query: Record<string, any> = {};
  let rest: Record<string, unknown> = {};
  for (let [k, v] of Object.entries(record)) {
    if (QUERY_MEMBERS.has(k)) query[k] = unwireAnchors(v);
    else rest[k] = v;
  }
  if (!usesNewSyntax(query)) {
    return { record };
  }
  // The htmlQuery binding rides in the filter's top-level eq unprefixed; it
  // is the entry's, not the query's, so it stays out of the lowering.
  let htmlQuery: unknown;
  let topEq = query.filter?.eq;
  if (topEq && typeof topEq === 'object' && 'htmlQuery' in topEq) {
    let { htmlQuery: h, ...eq } = topEq;
    htmlQuery = h;
    query.filter = Object.keys(eq).length
      ? { ...query.filter, eq }
      : (({ eq: _e, ...f }) => f)(query.filter);
  }
  let lowered;
  try {
    lowered = lowerQuery(query, {
      knownFunctions: BXL_FORMULA_FUNCTIONS,
    });
    // checked before it is wired again, which carries known members only
    assertQuery(lowered.query);
  } catch (e) {
    if (e instanceof InvalidQueryError) {
      throw invalidQuery(e.message, e.code);
    }
    throw e;
  }
  let wire: Record<string, any>;
  emitEngineSortKeys = true;
  try {
    wire = searchEntryWireQueryFromQuery(lowered.query as Query) as Record<
      string,
      any
    >;
  } finally {
    emitEngineSortKeys = false;
  }
  if (htmlQuery !== undefined) {
    wire.filter = {
      ...(wire.filter ?? {}),
      eq: { ...(wire.filter?.eq ?? {}), htmlQuery },
    };
  }
  return {
    record: { ...wire, ...rest },
    ...(lowered.notes.expression?.placement === 'top'
      ? { expressionOverTopWindow: true }
      : {}),
  };
}

// `let` in the wire grammar: each binding's query is a wire query (field
// paths through `item.`, its type as `item.on`), and `select` is a path
// through `item.` too.
function translateLets(lets: unknown): unknown {
  if (typeof lets !== 'object' || lets == null || Array.isArray(lets)) {
    return lets;
  }
  return Object.fromEntries(
    Object.entries(lets as Record<string, any>).map(([name, b]) => {
      if (typeof b !== 'object' || b == null) {
        return [name, b];
      }
      let at = `let/${name}`;
      let out: Record<string, unknown> = { ...b };
      if (typeof b.select === 'string') {
        out.select = stripItemPrefix(b.select, `${at}/select`);
      }
      if (b.from && typeof b.from === 'object') {
        let from: Record<string, unknown> = { ...b.from };
        if (b.from.filter !== undefined) {
          from.filter = translateFilterNode(
            b.from.filter,
            `${at}/from/filter`,
            {},
          );
        }
        let anchor =
          (from.filter as any)?.on ?? (from.filter as any)?.type ?? undefined;
        if (b.from.sort !== undefined) {
          from.sort = translateSort(b.from.sort, anchor, `${at}/from/sort`);
        }
        out.from = from;
      }
      return [name, out];
    }),
  );
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
  let { record, expressionOverTopWindow } = lowerEntryPayload(
    payload as Record<string, unknown>,
  );
  for (let key of Object.keys(record)) {
    if (!SEARCH_ENTRY_QUERY_MEMBERS.includes(key)) {
      let near = nearestMember(key, [...SEARCH_ENTRY_QUERY_MEMBERS, 'type']);
      throw invalidQuery(
        `unknown member "${key}" in entry query${near ? `; did you mean "${near}"?` : ''}`,
        'unknown-key',
      );
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

  let scope: SearchEntryScope | undefined;
  if (record.scope !== undefined) {
    if (!SEARCH_ENTRY_SCOPES.includes(record.scope as SearchEntryScope)) {
      throw invalidQuery(
        `scope must be one of ${SEARCH_ENTRY_SCOPES.map((s) => `"${s}"`).join(
          ', ',
        )}`,
      );
    }
    scope = record.scope as SearchEntryScope;
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
  if (record.facets !== undefined) {
    itemQuery.facets = translateFacets(record.facets);
  }
  if (record.collapse !== undefined) {
    itemQuery.collapse = translateCollapse(record.collapse, rootAnchor);
  }
  if (record.let !== undefined) {
    itemQuery.let = translateLets(record.let);
  }
  if (record.explain !== undefined) {
    itemQuery.explain = record.explain;
  }
  if (record.rerank !== undefined) {
    let r = record.rerank as Record<string, any>;
    let compare = r && typeof r === 'object' ? r.compare : undefined;
    itemQuery.rerank =
      compare && typeof compare === 'object'
        ? {
            ...r,
            compare: {
              ...(compare.filter !== undefined
                ? {
                    filter: translateFilterNode(
                      compare.filter,
                      'rerank/compare/filter',
                      {},
                    ),
                  }
                : {}),
              ...(typeof compare.by === 'string'
                ? { by: stripItemPrefix(compare.by, 'rerank/compare/by') }
                : compare.by !== undefined
                  ? { by: compare.by }
                  : {}),
              ...(typeof compare.near === 'string'
                ? {
                    near: stripItemPrefix(compare.near, 'rerank/compare/near'),
                  }
                : compare.near !== undefined
                  ? { near: compare.near }
                  : {}),
              ...(compare.k !== undefined ? { k: compare.k } : {}),
              ...(compare.minSimilarity !== undefined
                ? { minSimilarity: compare.minSimilarity }
                : {}),
            },
          }
        : r;
  }
  try {
    assertQuery(itemQuery);
  } catch (e) {
    if (e instanceof InvalidQueryError) {
      throw invalidQuery(e.message, e.code);
    }
    throw e;
  }

  let columns: SearchColumn[] | undefined;
  if (record.select !== undefined) {
    if (record.fields !== undefined) {
      throw invalidQuery(
        'select and fields cannot go together: select answers a table, fields answers entries',
        'select-excludes-fields',
      );
    }
    columns = parseColumns(record.select);
  }
  let federation: SearchEntryQuery['federation'];
  if (record.federation !== undefined) {
    let f = record.federation as { results?: unknown } | null;
    if (
      !f ||
      typeof f !== 'object' ||
      Array.isArray(f) ||
      Object.keys(f).some((k) => k !== 'results') ||
      (f.results !== 'byRealm' && f.results !== 'merged')
    ) {
      throw invalidQuery(
        'federation is { results: "byRealm" } or { results: "merged" }; federation.results takes byRealm or merged',
        'invalid-value',
      );
    }
    federation = { results: f.results };
  }
  let fieldset = parseFieldset(record.fields);

  return {
    itemQuery: itemQuery as Query,
    ...(expressionOverTopWindow ? { expressionOverTopWindow } : {}),
    htmlQuery,
    fieldset,
    realms,
    cardUrls,
    scope,
    typeAnchors: wireFilterTypeAnchors(
      record.filter as SearchEntryWireFilter | undefined,
    ),
    ...(columns ? { columns } : {}),
    ...(federation ? { federation } : {}),
  };
}

// ---------------------------------------------------------------------------
// Composing a realm's policy into a search.
//
// A `query` grant's predicate compiled to a filter when the policy compiled,
// so a search the policy scopes runs that filter alongside the caller's own
// rather than judging each row it finds. Both must hold: the caller asked for
// a shape, and the grant admits a set of cards, and what comes back is the
// rows in both.
//
//   effectiveFilter = { every: [ callerFilter, { any: [ ...grantFilters ] } ] }
//
// Composing before the query is planned is the whole point. The engine pages
// over the rows the composed filter matches, so a page comes back full rather
// than sparse — a page filtered after the fact would be short by however many
// of its rows the policy removed, which reads as data loss rather than as a
// policy.
//
// A realm contributing no filter is left alone. Not wrapped in an `every` of
// one, not anchored, not touched: it runs the caller's query as the caller
// sent it, which is what every caller a realm reads coarsely gets.
// ---------------------------------------------------------------------------

// The filter a search runs for one realm, given what the caller asked for and
// what that realm's policy contributes.
//
// The grants are composed under `any` whether there is one of them or several.
// Grants union, so the shape says what it means, and it says the same thing
// however many rules happened to match — adding a second grant to a policy
// widens what comes back without reshaping the query that was already running.
export function composePolicyScopedFilter(
  callerFilter: Filter | undefined,
  grantFilters: Filter[],
): Filter | undefined {
  if (grantFilters.length === 0) {
    return callerFilter;
  }
  let granted: Filter = { any: grantFilters };
  return callerFilter === undefined
    ? granted
    : { every: [callerFilter, granted] };
}

// A policy's compiled filter in the grammar the engine runs. The fragment is
// stored as a wire filter, the same grammar a request carries, so it is read
// the way a request's filter is read — including the validation, which is what
// keeps a filter the compiler should never have produced from reaching the
// engine.
//
// A fragment binds no `htmlQuery`: it is compiled from a predicate over a
// card's fields, and the rendering a search asks for is the caller's to
// choose. So the whole fragment is membership, and it always reads as some
// filter. One that reads as none is refused rather than returned, since a
// grant that composed nothing into a search would leave the search running
// unscoped.
export function policyFilterFromWire(filter: SearchEntryWireFilter): Filter {
  let translated = parseSearchEntryQueryFromPayload({ filter }).itemQuery
    .filter;
  if (!translated) {
    throw new Error(
      `a policy filter translated to no filter at all: ${JSON.stringify(filter)}`,
    );
  }
  return translated;
}

// The query a realm runs for a caller its policy scopes: the caller's query,
// with the grants that admit them composed into its filter. Composed on the
// parsed query rather than on the wire filter, because the wire grammar binds
// the caller's rendering choice in the filter's top-level `eq`, and nesting
// that filter inside an `every` would carry the binding away from where it is
// read. Everything but the filter — page, sort, fieldset, rendering — is the
// caller's query as it stands.
// `linkedGrants`: for each card a linkedFrom names, the grants a direct read
// of that card faces, which are its own type's (null where none admits the
// caller). A card it does not list reads under `grantFilters`.
export function policyScopedQuery(
  query: SearchEntryQuery,
  grantFilters: Filter[],
  linkedGrants?: Map<string, Filter[] | null>,
): SearchEntryQuery {
  if (grantFilters.length === 0) {
    throw new Error(
      'a policy-scoped search needs at least one grant filter; with none, the search would run unscoped',
    );
  }
  let lets: Record<string, LetBinding> = Object.fromEntries(
    Object.entries(query.itemQuery.let ?? {}).map(([name, b]) => [
      name,
      {
        ...b,
        from: {
          ...b.from,
          filter: composePolicyScopedFilter(b.from.filter, grantFilters),
        },
      },
    ]),
  );
  // `linkedFrom` reads its card's links directly, so under a policy it runs
  // as a binding whose query the grants scope like any other.
  let count = 0;
  let serial = 0;
  let rewrite = (node: Filter): Filter => {
    if ('any' in node) return { ...node, any: node.any.map(rewrite) };
    if ('every' in node) return { ...node, every: node.every.map(rewrite) };
    if ('not' in node) return { ...node, not: rewrite(node.not) };
    if ('linkedFrom' in node) {
      // A name of its own: one the caller's bindings do not already use.
      let name: string;
      do {
        name = `__linkedFrom${serial++}`;
      } while (name in lets);
      count++;
      let id = node.linkedFrom.card.replace(/\.json$/, '');
      let own = linkedGrants?.has(node.linkedFrom.card)
        ? linkedGrants.get(node.linkedFrom.card)!
        : linkedGrants?.has(id)
          ? linkedGrants.get(id)!
          : undefined;
      lets[name] = {
        from: {
          // A card no grant opens to the caller: a binding that matches
          // nothing, so the links it would have read stay unread.
          filter:
            own === null
              ? { every: [{ eq: { id } }, { not: { eq: { id } } }] }
              : composePolicyScopedFilter({ eq: { id } }, own ?? grantFilters),
        },
        select: `${node.linkedFrom.field}.id`,
        // Read under the card's own type's grants, composed above, not the
        // query's.
        ...(own !== undefined ? { ownGrants: true as const } : {}),
      };
      return {
        ...(node.on ? { on: node.on } : {}),
        in: { id: { $let: name } },
      };
    }
    return node;
  };
  let callerFilter = query.itemQuery.filter
    ? rewrite(query.itemQuery.filter)
    : undefined;
  // A boost in a blend is a filter too, and reads bindings the same way.
  let sort = query.itemQuery.sort?.map((s: any) =>
    s && s.by === '_blend' && Array.isArray(s.of)
      ? {
          ...s,
          of: s.of.map((c: any) =>
            c && c.by === WHEN_SIGNAL_KEY && c.when
              ? { ...c, when: rewrite(c.when) }
              : c,
          ),
        }
      : s,
  ) as typeof query.itemQuery.sort;
  // A binding's own query and a rerank's comparison filter cannot use a
  // binding, so a linkedFrom there cannot become one. Under a policy it is
  // refused rather than left to read the card's links directly, which the
  // grants around it would not stop.
  let refuseLinkedFrom = (node: unknown, where: string) => {
    if (JSON.stringify(node ?? null).includes('"linkedFrom":')) {
      throw new InvalidQueryError(
        `${where}: under a realm policy, linkedFrom works only in the query's filter and its boosts; move it there`,
        'policy-linked-from',
      );
    }
  };
  for (let [name, binding] of Object.entries(query.itemQuery.let ?? {})) {
    refuseLinkedFrom(binding.from?.filter, `/let/${name}/from/filter`);
  }
  refuseLinkedFrom(
    query.itemQuery.rerank?.compare?.filter,
    '/rerank/compare/filter',
  );
  // The bindings the rewrite adds are capped apart from the caller's own, so
  // a query that runs without a policy runs with one, and a policy cannot be
  // made to run an unbounded number of binding queries.
  if (count > MAX_LET_BINDINGS) {
    throw new InvalidQueryError(
      `/filter: under a realm policy, a query reads at most ${MAX_LET_BINDINGS} cards' links with linkedFrom, and this one reads ${count}`,
      'limit-exceeded',
    );
  }
  let rerank = query.itemQuery.rerank;
  return {
    ...query,
    anonymizeStatistics: true,
    labelFilter: composePolicyScopedFilter(undefined, grantFilters),
    grantFilter: composePolicyScopedFilter(undefined, grantFilters),
    itemQuery: {
      ...query.itemQuery,
      filter: composePolicyScopedFilter(callerFilter, grantFilters),
      ...(sort ? { sort } : {}),
      ...(Object.keys(lets).length ? { let: lets } : {}),
      // A comparison set the grants scope: an explicit one, and a row's
      // look-alikes, which would otherwise reach every card in the realm.
      ...(rerank?.compare?.filter || rerank?.compare?.near
        ? {
            rerank: {
              ...rerank,
              compare: {
                ...rerank.compare,
                filter: composePolicyScopedFilter(
                  rerank.compare.filter,
                  grantFilters,
                ),
              },
            },
          }
        : {}),
    },
  };
}

// The realms of a search whose rows the result marks policy-scoped
// (`meta.policyScopedRealms`). A realm the caller does not read outright is
// scoped whatever it contributed. Its policy composed a grant, admitted
// nothing, or could not be judged, and the mark reads the same in each case,
// so it cannot tell a caller whether they hold a grant there. A declared query
// the server resolved from its own definition scopes every realm the request
// named, since what it matched is the server's resolution rather than the
// caller's. That includes a realm its declaration leaves out, which contributes
// no rows to it, so the mark never says which realms the declaration searched.
// `realms` are the ones the request named, and they are marked in that order,
// once each.
export function policyScopedRealms({
  realms,
  readable,
  resolvedByServer,
}: {
  realms: string[];
  readable: (realm: string) => boolean;
  resolvedByServer: boolean;
}): string[] {
  return [
    ...new Set(
      resolvedByServer ? realms : realms.filter((realm) => !readable(realm)),
    ),
  ];
}

// `doc` with `realms` marked policy-scoped, beside any it already marks. A
// document with no realm to mark is returned as it is, so a search of realms
// the caller reads outright carries no mark at all.
export function markPolicyScoped(
  doc: EntryCollectionDocument,
  realms: string[],
): EntryCollectionDocument {
  if (realms.length === 0) {
    return doc;
  }
  return {
    ...doc,
    meta: {
      ...doc.meta,
      policyScopedRealms: [
        ...new Set([...(doc.meta.policyScopedRealms ?? []), ...realms]),
      ],
    },
  };
}

// The document a realm answers with when it contributes no rows because the
// caller may not see any: the one a search matching nothing produces, so a
// realm that grants the caller nothing reads exactly as a realm holding
// nothing for them. The rendering choice is echoed whenever the html branch
// is in play, as the engine echoes it.
export function emptySearchEntryDocument(
  query: SearchEntryQuery,
): EntryCollectionDocument {
  return {
    data: [],
    meta: {
      page: { total: 0 },
      ...(query.fieldset.html ? { htmlQuery: query.htmlQuery } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// The single-instance GET's query-string surface. The card+html /
// file-meta+html GET sources one entry by URL, so it needs no membership
// query — only the rendering selection (`?format=` / `?renderType=`) and the
// sparse fieldset (`?fields=`), the query-string spelling of the html. branch's
// `htmlQuery` + `fields[entry]`. The two helpers translate those params into
// the same `HtmlQuery` / `SearchEntryFieldset` the engine consumes, reusing
// the wire grammar's validation.
// ---------------------------------------------------------------------------

// `?format=` (default `fitted`) + optional `?renderType=<module>/<name>` → the
// htmlQuery selecting the rendering. An absent `renderType` leaves only the
// card's native type in play (no renderType predicate), exactly like an
// htmlQuery that constrains format alone.
export function htmlQueryFromParams(params: {
  format?: string | null;
  renderType?: string | null;
}): HtmlQuery {
  // Empty or absent means "unspecified" for both dimensions, consistent with
  // an omitted `?fields=` — the universal query-string convention. So an empty
  // `?format=` falls back to fitted, and an empty `?renderType=` leaves only
  // the native type in play (no predicate). A genuinely malformed value still
  // fails: a bad format is rejected by `assertHtmlQuery` below, and a
  // renderType that isn't a `<module>/<name>` key throws here.
  let format = params.format || DEFAULT_HTML_QUERY.eq.format;
  let renderType: unknown;
  if (params.renderType) {
    renderType = parseUsedRenderType(params.renderType);
    if (renderType === undefined) {
      throw invalidHtmlQuery(
        `renderType must be a <module>/<name> key (got "${params.renderType}")`,
      );
    }
  }
  let htmlQuery = {
    eq: {
      format,
      ...(renderType !== undefined ? { renderType } : {}),
    },
  };
  // Validates the format is a known rendering format and the renderType is a
  // CodeRef — the same checks the wire grammar applies to a bound htmlQuery.
  assertHtmlQuery(htmlQuery);
  return htmlQuery;
}

// `?fields=` → the sparse fieldset. The single GET serves the three
// combinations `html`, `item`, and `html,item`; the wire grammar's sparse
// `item.<field>` selectors have no query-string spelling here. Omitted → the
// default resolution policy (the selected rendering, falling back to the item
// where none matched).
export function fieldsetFromParam(
  fields: string | null | undefined,
): SearchEntryFieldset {
  if (fields == null || fields.trim() === '') {
    return { html: true, item: { kind: 'none' }, itemAsFallback: true };
  }
  let html = false;
  let item = false;
  for (let part of fields.split(',').map((f) => f.trim())) {
    if (part === 'html') {
      html = true;
    } else if (part === 'item') {
      item = true;
    } else if (part !== '') {
      throw invalidQuery(
        `each fields entry must be "html" or "item" (got "${part}")`,
      );
    }
  }
  if (!html && !item) {
    throw invalidQuery(`fields must name at least one of "html" or "item"`);
  }
  return {
    html,
    item: item ? { kind: 'full' } : { kind: 'none' },
    itemAsFallback: false,
  };
}

// The (format, renderType) a single-leaf htmlQuery selects — the pair the
// card+html GET spells as `?format=` / `?renderType=`. Returns `undefined`
// whenever the htmlQuery has no query-string spelling, and the caller must
// fall back to a full search instead of refreshing one member in isolation:
// a composite htmlQuery (`every`/`any`/`not`), an `eq` leaf with no `format`
// (that leaves format UNCONSTRAINED — the row carries a rendering per format,
// which one GET's single `?format=` cannot reproduce), or an `eq` leaf whose
// renderType isn't a resolved `<module>/<name>` ref.
export function htmlQueryRenderingSelection(
  htmlQuery: HtmlQuery | undefined,
): { format: PrerenderedHtmlFormat; renderType?: ResolvedCodeRef } | undefined {
  // Structural guards, not just types: the input can come straight off a wire
  // document's `meta.htmlQuery`, whose shape the document guard does not
  // validate. A malformed value must read as "no single-leaf selection" (the
  // caller falls back to a full re-run) rather than throw.
  if (
    typeof htmlQuery !== 'object' ||
    htmlQuery == null ||
    !('eq' in htmlQuery) ||
    typeof htmlQuery.eq !== 'object' ||
    htmlQuery.eq == null
  ) {
    return undefined;
  }
  let { format, renderType } = htmlQuery.eq;
  if (!isValidPrerenderedHtmlFormat(format)) {
    return undefined;
  }
  if (
    renderType !== undefined &&
    // `isResolvedCodeRef` assumes an object (it probes with `in`), so the
    // structural check must come first for the same malformed-wire reason as
    // above.
    (typeof renderType !== 'object' ||
      renderType == null ||
      !isResolvedCodeRef(renderType))
  ) {
    return undefined;
  }
  return {
    format,
    ...(renderType !== undefined ? { renderType } : {}),
  };
}

// Whether a full-text `matches` predicate appears anywhere in the entry wire
// filter tree — the wire-grammar counterpart of `filterHasMatches`. A live
// search reads this to route a `prerender_html` event: a query whose membership
// depends on `markdown` (matches) needs a full re-run, a structured one only a
// targeted rendering refresh.
export function wireFilterHasMatches(
  filter: SearchEntryWireFilter | undefined,
): boolean {
  if (!filter) {
    return false;
  }
  if (filter.matches !== undefined) {
    return true;
  }
  if (filter.any) {
    return filter.any.some(wireFilterHasMatches);
  }
  if (filter.every) {
    return filter.every.some(wireFilterHasMatches);
  }
  if (filter.not) {
    return wireFilterHasMatches(filter.not);
  }
  return false;
}

// The card types an entry must be one of to satisfy this filter, or
// `undefined` when the filter admits an entry of any type. An over-
// approximation, and deliberately so: every entry the filter matches adopts
// from at least one of the returned refs, but not every entry adopting from
// one of them matches.
//
// That direction is what a live search needs. An index event names the types
// it touched; a query whose anchors are disjoint from them cannot have gained
// or lost a member, because a member would have to be of one of these types
// and a row of one of these types would have named it in the event. The
// reverse — narrowing the anchors — would let a real membership change slip
// past, so every shape whose anchors can't be established returns `undefined`
// and leaves the caller re-running unconditionally.
//
// The engine ANDs a node's own `item.on` with every branch it could take (see
// `filterCondition`), so an anchored node answers for its whole subtree
// whatever that subtree contains and whichever branch runs.
//
// An unanchored node is only readable when exactly one member decides what it
// matches. A node carrying several is compiled from just one of them and the
// rest are dead weight — and which one that is cannot be read off the node,
// because `filterCondition` and the query validator disagree about the order
// they choose in. Reading the wrong member would anchor a node the engine is
// running untyped, so a multi-member node anchors nothing.
//
// Given the one member: `every` is satisfied by any one branch's anchors (a
// match satisfies all the branches, so any one of them constrains it), `any`
// needs all of its branches anchored because an unanchored branch admits an
// entry of any type, and a bare `not` or operator member anchors nothing.
export function wireFilterTypeAnchors(
  filter: SearchEntryWireFilter | undefined,
): CodeRef[] | undefined {
  if (!filter) {
    return undefined;
  }
  let anchor = filter[ITEM_ANCHOR];
  if (anchor) {
    return [anchor];
  }
  let member = soleShapeMember(filter);
  if (member === 'every' && filter.every?.length) {
    for (let branch of filter.every) {
      let anchors = wireFilterTypeAnchors(branch);
      if (anchors) {
        return anchors;
      }
    }
    return undefined;
  }
  if (member === 'any' && filter.any?.length) {
    let anchors: CodeRef[] = [];
    for (let branch of filter.any) {
      let branchAnchors = wireFilterTypeAnchors(branch);
      if (!branchAnchors) {
        return undefined;
      }
      anchors.push(...branchAnchors);
    }
    return anchors;
  }
  return undefined;
}

// The card types a policy is asked about for an ad-hoc search with this
// filter, or `undefined` when the filter admits an entry of any type.
//
// Every entry the filter matches adopts from at least one of them, as with
// `wireFilterTypeAnchors`, and on the same readings of a node: an unanchored
// node is read only through its one deciding member, and `any` only when all
// of its branches are anchored. It differs in what it keeps. Where a live
// search needs only enough of a filter's anchors to bound its matches, a
// policy is asked about every type a match is known to adopt from, since each
// such type brings its own rules. So an `every` contributes the anchors of all
// of its anchored branches rather than the first one found, and an anchored
// node contributes its own anchor together with those its body names. Two
// filters that match the same cards are then asked about the same types,
// whichever order their branches are written in.
//
// A match of an `every` adopts from all of its anchors at once, so each of
// them brings rules the gate would consult for that match. A match of an `any`
// adopts from the anchors of one branch, and `policyQueryScope` confines what
// each type's rules admit to that type's cards, so the other branches' types
// admit nothing of it.
export function wireFilterGrantTypes(
  filter: SearchEntryWireFilter | undefined,
): CodeRef[] | undefined {
  if (!filter) {
    return undefined;
  }
  let own = filter[ITEM_ANCHOR];
  let body = grantTypesOfBody(filter);
  if (own) {
    return [own, ...(body ?? [])];
  }
  return body;
}

function grantTypesOfBody(
  filter: SearchEntryWireFilter,
): CodeRef[] | undefined {
  let member = soleShapeMember(filter);
  if (member === 'every' && filter.every?.length) {
    let types = filter.every.flatMap(
      (branch) => wireFilterGrantTypes(branch) ?? [],
    );
    return types.length > 0 ? types : undefined;
  }
  if (member === 'any' && filter.any?.length) {
    let types: CodeRef[] = [];
    for (let branch of filter.any) {
      let branchTypes = wireFilterGrantTypes(branch);
      if (!branchTypes) {
        return undefined;
      }
      types.push(...branchTypes);
    }
    return types;
  }
  return undefined;
}

// The members that decide what a filter node matches, as opposed to the
// `item.on` anchor that gates whichever of them runs.
const SHAPE_MEMBERS = [
  'any',
  'every',
  'not',
  'eq',
  'in',
  'contains',
  'range',
  'matches',
  'typeahead',
  'near',
  'pattern',
  'regex',
] as const;

// The single member that decides what an unanchored node matches, or
// `undefined` when it carries none or several. An `eq` binding nothing but the
// `htmlQuery` rendering selection doesn't count: the parser lifts that binding
// out of the node, so it never decides anything.
function soleShapeMember(
  filter: SearchEntryWireFilter,
): (typeof SHAPE_MEMBERS)[number] | undefined {
  let members = SHAPE_MEMBERS.filter((member) => {
    let value = filter[member];
    if (value === undefined) {
      return false;
    }
    return !(member === 'eq' && bindsOnlyHtmlQuery(value));
  });
  return members.length === 1 ? members[0] : undefined;
}

function bindsOnlyHtmlQuery(eq: unknown): boolean {
  if (typeof eq !== 'object' || eq == null) {
    return false;
  }
  let keys = Object.keys(eq);
  return keys.length > 0 && keys.every((key) => key === HTML_QUERY);
}

// ---------------------------------------------------------------------------
// The wire grammar — what a client sends to `_search` /
// `_federated-search`. `SearchEntryWireQuery` is the entry-rooted
// request body: entry membership addressed through `item.` paths (`item.on`
// as the type anchor), the htmlQuery bound in the filter's top-level `eq`,
// and the sparse fieldset under `fields[entry]`.
//
// `searchEntryWireQueryFromQuery` translates a legacy card-rooted `Query`
// into that grammar — the exact inverse of the parser's addressing strip
// (round-trip parity is pinned by test) — so an instances-level caller can
// keep authoring the legacy query shape while the request runs against the
// entry engine.
// ---------------------------------------------------------------------------

export interface SearchEntryWireSortExpression {
  // an `item.`-prefixed field path (general sort fields included)
  by: string;
  'item.on'?: CodeRef;
  direction?: 'asc' | 'desc';
  missing?: 'first' | 'last';
  // a near sort's target vector (see `NearSortTarget`)
  near?: unknown;
  // a `_blend` sort's signals, fusion method and constant, and a signal's
  // weight (see `BlendSortExpression`)
  of?: SearchEntryWireSortExpression[];
  method?: 'rrf';
  k?: number;
  weight?: number;
  // a `_relevance` sort's signal weights (see `RelevanceSortExpression`)
  weights?: Record<string, number>;
  // a `_when` signal's filter (see `WhenSignal`)
  when?: SearchEntryWireFilter;
  // an `_expr` sort's formula (see `ExprSortExpression`)
  expr?: string;
}

export type SearchEntryWireFilter = {
  'item.on'?: CodeRef;
  any?: SearchEntryWireFilter[];
  every?: SearchEntryWireFilter[];
  not?: SearchEntryWireFilter;
  // field paths inside the operators are `item.`-prefixed; the filter's
  // top-level `eq` may additionally bind the bare `htmlQuery` field
  eq?: Record<string, unknown>;
  contains?: Record<string, unknown>;
  in?: Record<string, unknown>;
  range?: Record<string, unknown>;
  matches?: string;
  prefix?: boolean;
  within?: string;
  fields?: string[];
  linkedFrom?: { card: string; field: string };
  typeahead?: string;
  near?: Record<string, unknown>;
  pattern?: Record<string, string>;
  regex?: Record<string, string>;
  typos?: boolean;
  scope?: 'title';
};

export interface SearchEntryWireQuery {
  filter?: SearchEntryWireFilter;
  sort?: SearchEntryWireSortExpression[];
  page?: {
    number?: number;
    size: number;
    generation?: number;
    total?: PageTotalMode;
  };
  // field paths through `item.`, as in a sort
  facets?: (Facet & { by: string })[];
  // named lists computed first (see `LetBinding`); paths through `item.`
  let?: Record<
    string,
    {
      from: {
        filter?: SearchEntryWireFilter;
        sort?: SearchEntryWireSortExpression[];
        page?: { size: number };
      };
      // a list's path through `item.`, or `one: true` for one card
      select?: string;
      one?: true;
    }
  >;
  // each result explains its rank in `meta._explain`
  explain?: boolean;
  // re-rank the top of the result by a BXL expression (see `Rerank`)
  rerank?: {
    expression: string;
    top?: number;
    direction?: 'asc' | 'desc';
    compare?: {
      filter?: SearchEntryWireFilter;
      by?: string;
      near?: string;
      k?: number;
      minSimilarity?: number;
    };
  };
  // one result per group; `by` through `item.` (see `Collapse`)
  collapse?: string | { by: string; 'item.on'?: CodeRef; keep?: number };
  fields?: { entry: string[] };
  cardUrls?: string[];
  realms?: string[];
  scope?: SearchEntryScope;
}

// A filter in the grammar the engine runs, written back in the grammar a
// search request carries.
export function wireFilterFromFilter(filter: Filter): SearchEntryWireFilter {
  let out: SearchEntryWireFilter = {};
  for (let [key, value] of Object.entries(filter)) {
    if (key === 'type' || key === 'on') {
      // both legacy spellings of the type anchor (the standalone card-type
      // filter and a node's `on`) are the wire grammar's `item.on`
      out[ITEM_ANCHOR] = value as CodeRef;
    } else if (key === 'any' || key === 'every') {
      out[key] = (value as Filter[]).map(wireFilterFromFilter);
    } else if (key === 'not') {
      out.not = wireFilterFromFilter(value as Filter);
    } else if (FIELD_KEYED_OPERATORS.includes(key)) {
      (out as Record<string, unknown>)[key] = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(
          ([fieldPath, fieldValue]) => [
            `${ITEM_PREFIX}${fieldPath}`,
            fieldValue,
          ],
        ),
      );
    } else if (key === 'matches') {
      out.matches = value as string;
    } else if (key === 'prefix' || key === 'typos' || key === 'scope') {
      (out as Record<string, unknown>)[key] = value;
    } else if (key === 'typeahead') {
      out.typeahead = value as string;
    } else if (key === 'within') {
      out.within = `${ITEM_PREFIX}${value as string}`;
    } else if (key === 'fields') {
      out.fields = (value as string[]).map((f) => `${ITEM_PREFIX}${f}`);
    } else if (key === 'linkedFrom') {
      out.linkedFrom = value as { card: string; field: string };
    } else {
      throw new Error(
        `cannot translate filter member "${key}" to the entry wire grammar`,
      );
    }
  }
  return out;
}

// One sort entry in the wire grammar: field paths through `item.`, the type
// anchor as `item.on`, a blend's signals translated the same way.
// The request grammar spells the engine's signal sorts by key: `_blend` is
// `{ blend }`, `_expr` is `{ formula }`, a `_when` signal is `{ boost }`.
// The parser's own rewire (`lowerEntryPayload`) keeps the engine's form.
let emitEngineSortKeys = false;
function wireSortFromSort(entry: any): SearchEntryWireSortExpression {
  if (!emitEngineSortKeys) {
    if (entry.by === '_blend' && Array.isArray(entry.of)) {
      return {
        blend: entry.of.map(wireSortFromSort),
        ...(entry.k != null ? { k: entry.k } : {}),
      } as unknown as SearchEntryWireSortExpression;
    }
    if (entry.by === '_expr') {
      return {
        expression: entry.expr,
        ...(entry.direction ? { direction: entry.direction } : {}),
        ...(entry.weight != null ? { weight: entry.weight } : {}),
      } as unknown as SearchEntryWireSortExpression;
    }
    if (entry.by === '_when') {
      return {
        boost: wireFilterFromFilter(entry.when),
        ...(entry.weight != null ? { weight: entry.weight } : {}),
      } as unknown as SearchEntryWireSortExpression;
    }
    if (entry.by === '_relevance') {
      return {
        relevance: entry.weights ?? true,
        ...('on' in entry && entry.on ? { [ITEM_ANCHOR]: entry.on } : {}),
        ...('near' in entry && entry.near != null ? { near: entry.near } : {}),
        ...(entry.weight != null ? { weight: entry.weight } : {}),
      } as unknown as SearchEntryWireSortExpression;
    }
    if (entry.by === '_matchRelevance') {
      return {
        by: `${ITEM_PREFIX}textRelevance`,
        ...(entry.direction ? { direction: entry.direction } : {}),
        ...(entry.weight != null ? { weight: entry.weight } : {}),
      } as unknown as SearchEntryWireSortExpression;
    }
  }
  return {
    by: `${ITEM_PREFIX}${entry.by}`,
    ...('on' in entry && entry.on ? { [ITEM_ANCHOR]: entry.on } : {}),
    ...(entry.direction ? { direction: entry.direction } : {}),
    ...(entry.missing ? { missing: entry.missing } : {}),
    ...('near' in entry && entry.near != null ? { near: entry.near } : {}),
    ...(entry.weight != null ? { weight: entry.weight } : {}),
    ...(entry.weights != null ? { weights: entry.weights } : {}),
    ...(Array.isArray(entry.of) ? { of: entry.of.map(wireSortFromSort) } : {}),
    ...(entry.method ? { method: entry.method } : {}),
    ...(entry.k != null ? { k: entry.k } : {}),
    ...(entry.when ? { when: wireFilterFromFilter(entry.when) } : {}),
    ...(typeof entry.expr === 'string' ? { expr: entry.expr } : {}),
  };
}

export function searchEntryWireQueryFromQuery(
  query: Query,
  opts?: { fields?: string[]; scope?: SearchEntryScope },
): SearchEntryWireQuery {
  // the legacy `realm`/`realms` members are deliberately not carried — the
  // caller addresses realms at the request level; `asData`/`fields` are the
  // legacy data path's members and have no wire spelling here (the
  // projection is `opts.fields`, the `fields[entry]` sparse fieldset)
  let wire: SearchEntryWireQuery = {};
  if (query.filter) {
    wire.filter = wireFilterFromFilter(query.filter);
  }
  if (query.sort) {
    wire.sort = (query.sort as Sort).map(wireSortFromSort);
  }
  if (query.page) {
    wire.page = query.page;
  }
  if (query.facets) {
    wire.facets = query.facets.map((facet) => ({
      ...facet,
      by: `${ITEM_PREFIX}${facet.by}`,
    }));
  }
  if (query.explain) {
    wire.explain = true;
  }
  if (query.rerank) {
    let { compare, ...rest } = query.rerank;
    wire.rerank = {
      ...rest,
      ...(compare
        ? {
            compare: {
              ...(compare.filter
                ? { filter: wireFilterFromFilter(compare.filter) }
                : {}),
              ...(compare.by ? { by: `${ITEM_PREFIX}${compare.by}` } : {}),
              ...(compare.near
                ? { near: `${ITEM_PREFIX}${compare.near}` }
                : {}),
              ...(compare.k !== undefined ? { k: compare.k } : {}),
              ...(compare.minSimilarity !== undefined
                ? { minSimilarity: compare.minSimilarity }
                : {}),
            },
          }
        : {}),
    };
  }
  if (query.let) {
    wire.let = Object.fromEntries(
      Object.entries(query.let).map(([name, b]) => [
        name,
        {
          from: {
            ...(b.from.filter
              ? { filter: wireFilterFromFilter(b.from.filter) }
              : {}),
            ...(b.from.sort
              ? { sort: (b.from.sort as Sort).map(wireSortFromSort) }
              : {}),
            ...(b.from.page ? { page: b.from.page } : {}),
          },
          ...(b.one
            ? { one: true as const }
            : { select: `${ITEM_PREFIX}${b.select}` }),
        },
      ]),
    );
  }
  if (query.collapse) {
    let c = query.collapse;
    wire.collapse =
      typeof c === 'string'
        ? `${ITEM_PREFIX}${c}`
        : {
            by: `${ITEM_PREFIX}${c.by}`,
            ...(c.on ? { [ITEM_ANCHOR]: c.on } : {}),
            ...(c.keep != null ? { keep: c.keep } : {}),
          };
  }
  if (opts?.fields) {
    wire.fields = { entry: [...opts.fields] };
  }
  if (opts?.scope) {
    wire.scope = opts.scope;
  }
  return wire;
}

function combineFacetMeasure(
  a: { count: number; measure: NonNullable<FacetCount['measure']> },
  b: { count: number; measure: NonNullable<FacetCount['measure']> },
): NonNullable<FacetCount['measure']> {
  let out: NonNullable<FacetCount['measure']> = {};
  for (let op of ['avg', 'min', 'max', 'sum'] as const) {
    let x = a.measure[op];
    let y = b.measure[op];
    if (x == null || y == null) {
      if (x != null || y != null) {
        out[op] = (x ?? y)!;
      }
      continue;
    }
    out[op] =
      op === 'avg'
        ? (x * a.count + y * b.count) / (a.count + b.count)
        : op === 'min'
          ? Math.min(x, y)
          : op === 'max'
            ? Math.max(x, y)
            : x + y;
  }
  return out;
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

// Two realms' statistics for one facet. Counts, sums and missing counts add
// up; min and max combine; the average is re-derived from the sum and the
// number values. `distinct` adds up too, so it is an upper bound across
// realms that share values.
function mergeFacetStats(a: FacetStats, b: FacetStats): FacetStats {
  let merged: FacetStats = {
    count: a.count + b.count,
    distinct: a.distinct + b.distinct,
  };
  if (a.order ?? b.order) {
    merged.order = a.order ?? b.order;
  }
  if (a.missing !== undefined || b.missing !== undefined) {
    merged.missing = (a.missing ?? 0) + (b.missing ?? 0);
  }
  let pick = (x: unknown, y: unknown, fn: (p: any, q: any) => any) =>
    x === undefined ? y : y === undefined ? x : fn(x, y);
  merged.min = pick(a.min, b.min, (p, q) => (p < q ? p : q));
  merged.max = pick(a.max, b.max, (p, q) => (p > q ? p : q));
  if (a.values !== undefined || b.values !== undefined) {
    merged.values = (a.values ?? 0) + (b.values ?? 0);
    merged.sum = (a.sum ?? 0) + (b.sum ?? 0);
    merged.avg = merged.values > 0 ? merged.sum / merged.values : undefined;
  }
  for (let key of Object.keys(merged) as (keyof FacetStats)[]) {
    if (merged[key] === undefined) {
      delete merged[key];
    }
  }
  return merged;
}

export function combineSearchEntryResults(
  docs: EntryCollectionDocument[],
  // How many realms the request asked for. A realm goes missing two ways and
  // neither raises: it never resolves to an instance (the peer is down, the
  // mount failed), or it resolves and its search rejects. Both leave `docs`
  // one short, which is the only evidence here that a realm is missing — and
  // the summed total then counts only the realms that answered. Count the
  // asked-for realms, not the resolved ones, so the first way is caught too.
  attemptedRealmCount?: number,
  // When the query's primary sort is a `near` sort, each realm's page is
  // ranked by cosine similarity to the same target — a score comparable
  // across realms — so the merge orders the concatenated entries by
  // `meta._nearSimilarity` (in the sort's direction, entries without a score
  // last) instead of leaving them in realm order.
  rankBy?: {
    key: '_nearSimilarity' | '_blendScore' | '_matchRelevance';
    direction: 'asc' | 'desc';
  },
): EntryCollectionDocument {
  let combined: EntryCollectionDocument = {
    data: [],
    meta: { page: { total: 0 } },
  };
  let included: EntryIncludedResource[] = [];
  let includedByIdentity = new Set<string>();

  for (let doc of docs) {
    combined.data.push(...doc.data);
    combined.meta.page.total += doc.meta?.page?.total ?? 0;
    if (doc.meta?.page?.totalIsEstimate) {
      combined.meta.page.totalIsEstimate = true;
    }
    // Facet counts add up across realms. Each realm returns only its own top
    // values, so a value common overall but outside one realm's top `size`
    // is undercounted there.
    if (doc.meta?.facets) {
      let facets = (combined.meta.facets ??= {});
      for (let [by, counts] of Object.entries(doc.meta.facets)) {
        let merged = new Map(
          (facets[by] ?? []).map((c) => [c.value, c.count] as const),
        );
        // A link facet's values carry the linked card's title as `label`.
        let labels = new Map(
          [...(facets[by] ?? []), ...counts]
            .filter((c) => c.label !== undefined)
            .map((c) => [c.value, c.label!] as const),
        );
        // A measure combines across realms: an average weighted by each
        // realm's count, the smaller min, the larger max, the summed sum.
        let measures = new Map(
          (facets[by] ?? [])
            .filter((c) => c.measure)
            .map((c) => [c.value, { count: c.count, measure: c.measure! }]),
        );
        for (let { value, count, measure } of counts) {
          if (measure) {
            let prior = measures.get(value);
            measures.set(value, {
              count: (prior?.count ?? 0) + count,
              measure: prior
                ? combineFacetMeasure(prior, { count, measure })
                : measure,
            });
          }
          merged.set(value, (merged.get(value) ?? 0) + count);
        }
        // A facet that sorts by value (an interval, `order: 'value'`) or
        // keeps its buckets in order (ranges) says so in its stats; the rest
        // sort by count.
        let order = doc.meta.facetStats?.[by]?.order;
        let isRanges =
          doc.meta.facetStats?.[by] !== undefined && order === undefined;
        let entries: FacetCount[] = [...merged].map(([value, count]) => ({
          value,
          count,
          ...(labels.has(value) ? { label: labels.get(value)! } : {}),
          ...(measures.has(value)
            ? { measure: measures.get(value)!.measure }
            : {}),
        }));
        let measureOf = (c: FacetCount) =>
          c.measure ? (Object.values(c.measure)[0] ?? -Infinity) : -Infinity;
        facets[by] = isRanges
          ? entries
          : order === 'measure'
            ? entries.sort(
                (a, b) =>
                  measureOf(b) - measureOf(a) ||
                  b.count - a.count ||
                  a.value.localeCompare(b.value),
              )
            : order === 'value'
              ? entries.sort((a, b) => a.value.localeCompare(b.value))
              : entries.sort(
                  (a, b) => b.count - a.count || a.value.localeCompare(b.value),
                );
      }
    }
    if (doc.meta?.facetStats) {
      let all = (combined.meta.facetStats ??= {});
      for (let [by, stats] of Object.entries(doc.meta.facetStats)) {
        all[by] = all[by] ? mergeFacetStats(all[by], stats) : { ...stats };
      }
    }
    if (doc.meta?.realmTotals) {
      combined.meta.realmTotals = {
        ...combined.meta.realmTotals,
        ...doc.meta.realmTotals,
      };
    }
    if (combined.meta.htmlQuery == null && doc.meta?.htmlQuery != null) {
      combined.meta.htmlQuery = doc.meta.htmlQuery;
    }
    // Any realm that clipped its closure clips the merged one: the combined
    // `included[]` is the union, so a consumer holding it is short by whatever
    // that realm withheld. Each realm holds its own ceiling, which is why the
    // report is a fact rather than a figure — there is no single number here to
    // merge.
    if (doc.meta?.linkClosureTruncated) {
      combined.meta.linkClosureTruncated = true;
    }
    // A realm that scoped its own rows scopes them in the merge too: the mark
    // is per realm, so merging only collects which realms carry it.
    if (doc.meta?.policyScopedRealms?.length) {
      combined.meta.policyScopedRealms = [
        ...new Set([
          ...(combined.meta.policyScopedRealms ?? []),
          ...doc.meta.policyScopedRealms,
        ]),
      ];
    }
    for (let resource of doc.included ?? []) {
      if (resource.id) {
        // NUL-separated so a `(type, id)` pair can't alias another by
        // concatenation (no resource type or id contains a NUL byte).
        let identity = resourceIdentity(resource.type, resource.id);
        if (includedByIdentity.has(identity)) {
          continue;
        }
        includedByIdentity.add(identity);
      }
      included.push(resource);
    }
  }

  if (rankBy && docs.length > 1) {
    let sign = rankBy.direction === 'asc' ? 1 : -1;
    let score = (entry: EntryResource) => entry.meta?.[rankBy.key];
    // Array#sort is stable, so equal scores keep realm order.
    combined.data.sort((a, b) => {
      let sa = score(a);
      let sb = score(b);
      if (sa == null || sb == null) {
        return sa == null ? (sb == null ? 0 : 1) : -1;
      }
      return (sa - sb) * sign;
    });
  }

  if (attemptedRealmCount != null && docs.length < attemptedRealmCount) {
    // Say the sum is short rather than letting it read as the match count. How
    // many instances the missing realm holds is exactly what its failure
    // withheld, so the total cannot be repaired here — only labelled.
    combined.meta.incomplete = true;
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
  ) => Promise<EntryCollectionDocument>;
  url?: string;
};

export async function searchEntryRealms(
  realms: Array<SearchEntrySearchableRealm | null | undefined>,
  searchEntryQuery: SearchEntryQuery,
  opts?: SearchOpts,
  // The query one realm runs, where it differs from the one every other realm
  // runs. A realm whose policy scopes this caller searches the caller's query
  // with that realm's grants composed into it, and a policy governs the realm
  // it belongs to alone — so the fan-out is over one question asked several
  // ways, rather than one query run several times.
  queryForRealm?: (realm: SearchEntrySearchableRealm) => SearchEntryQuery,
): Promise<EntryCollectionDocument> {
  // Same instrumentation contract as `searchRealms`: a caller that threads
  // its own collector (the realm-server handler) emits the complete
  // request→response line itself; a caller that threads only a
  // `loggingCorrelationId` (the host-test realm-server mock) gets the
  // collector created — and the line emitted — here.
  let ownsTimings = Boolean(opts?.loggingCorrelationId) && !opts?.timings;
  let timings =
    opts?.timings ?? (ownsTimings ? new RequestTimings() : undefined);
  let perRealmOpts = ownsTimings && opts ? { ...opts, timings } : opts;
  let startedAt = ownsTimings ? Date.now() : 0;
  let results = searchEntryQuery.federation?.results ?? 'byRealm';
  let page = searchEntryQuery.itemQuery.page as
    | { number?: number; size: number; total?: PageTotalMode }
    | undefined;
  // Merged: each realm answers its top `offset + size` rows, with the values
  // it sorted them by; the merge orders the union by the query's sort and
  // keeps one global page. Per realm: each realm pages on its own.
  // A value facet over several realms: each realm answers its top
  // 1.5 × size + 10 values (as Elasticsearch's shard_size does), the merge
  // sums them and keeps `size`, and `meta.facetErrors` bounds how far any
  // count may be short. Range, interval and stats buckets need no top N.
  let overrequested = new Map<string, { size: number; asked: number }>();
  let facets = searchEntryQuery.itemQuery.facets?.map((f) => {
    if (realms.length < 2 || f.ranges || f.interval) return f;
    let size = f.size ?? DEFAULT_FACET_SIZE;
    let asked = Math.min(Math.ceil(1.5 * size + 10), MAX_FACET_SIZE);
    overrequested.set(f.by, { size, asked });
    return { ...f, size: asked };
  });
  let withFacets = (q: SearchEntryQuery): SearchEntryQuery =>
    facets && overrequested.size
      ? { ...q, itemQuery: { ...q.itemQuery, facets } }
      : q;
  let perRealmQuery = (q0: SearchEntryQuery): SearchEntryQuery => {
    let q = withFacets(q0);
    return results === 'merged'
      ? {
          ...q,
          exposeSortValues: true,
          itemQuery: {
            ...q.itemQuery,
            ...(page
              ? {
                  page: {
                    number: 0,
                    size: ((page.number ?? 0) + 1) * page.size,
                    // Each realm counts only as far as the caller asked.
                    ...(page.total ? { total: page.total } : {}),
                  },
                }
              : {}),
          },
        }
      : q;
  };
  // `realms` is positional with the requested realm list: an entry is nullish
  // exactly when that realm could not be resolved to an instance.
  let asked = searchEntryQuery.realms ?? [];
  let statuses: NonNullable<EntryCollectionDocument['meta']['realms']> = {};
  let answered: { url: string | undefined; doc: EntryCollectionDocument }[] =
    [];
  let settled = await Promise.all(
    realms.map(async (realm, index) => {
      let url = realm?.url ?? asked[index];
      if (!realm) {
        return { url, status: { status: 'unavailable' as const } };
      }
      // A realm's `ms` is its whole part of the request: what was spent
      // preparing it before the fan-out (its mount), and its search from the
      // moment the fan-out asks for it until its document is complete (rows,
      // count, facets, link assembly and the rendering of each entry).
      let t0 = Date.now() - (url ? (opts?.realmPreparedMs?.[url] ?? 0) : 0);
      try {
        let doc = await withRealmDeadline(
          opts?.realmDeadline,
          perRealmOpts,
          (o) =>
            realm.searchEntries(
              perRealmQuery(
                queryForRealm ? queryForRealm(realm) : searchEntryQuery,
              ),
              o,
            ),
        );
        return {
          url,
          doc,
          status: {
            status: 'ok' as const,
            total: doc.meta?.page?.total ?? 0,
            ...(doc.meta?.page?.totalIsEstimate
              ? { totalIsEstimate: true }
              : {}),
            ...(doc.meta?.page?.hasMore !== undefined
              ? { hasMore: doc.meta.page.hasMore }
              : {}),
            ms: Date.now() - t0,
          },
        };
      } catch (e: any) {
        // A search its caller abandoned stops in every realm at once; that is
        // not a realm failing.
        if (!opts?.signal?.aborted) {
          console.error(
            `searchEntryRealms realm search failed: ${url ?? `index ${index}`}`,
            e,
          );
        }
        return {
          url,
          status: { ...realmFailureStatus(e), ms: Date.now() - t0 },
        };
      }
    }),
  );
  for (let { url, doc, status } of settled) {
    if (url) {
      statuses[url] = status;
    }
    if (doc) {
      answered.push({
        url,
        doc: url
          ? {
              ...doc,
              meta: {
                ...doc.meta,
                realmTotals: { [url]: doc.meta?.page?.total ?? 0 },
              },
            }
          : doc,
      });
    }
  }
  let primarySort = searchEntryQuery.itemQuery.sort?.[0];
  let rankBy =
    primarySort && (isBlendSort(primarySort) || isRelevanceSort(primarySort))
      ? // A `_relevance` sort compiles to a blend in each realm's engine.
        {
          key: '_blendScore' as const,
          direction: primarySort.direction ?? 'desc',
        }
      : primarySort && primarySort.by === MATCH_RELEVANCE_SORT_KEY
        ? // Text relevance (with type-ahead tiers) compares across realms.
          {
            key: '_matchRelevance' as const,
            direction: primarySort.direction ?? 'desc',
          }
        : primarySort && isNearSort(primarySort)
          ? {
              key: '_nearSimilarity' as const,
              direction: primarySort.direction ?? 'desc',
            }
          : undefined;
  let combined: EntryCollectionDocument;
  if (results === 'merged') {
    // The union in the query's own order, then one global page.
    combined = combineSearchEntryResults(
      answered.map((a) => a.doc),
      realms.length,
    );
    // Each entry in the direction the engine sorted it: scores (an `_expr`
    // formula, a blend, a near similarity, text relevance) default to `desc`.
    // Under a rerank each row's values lead with its rerank value (highest
    // first unless the rerank says `asc`), then the query's own sort.
    let rerank = searchEntryQuery.itemQuery.rerank;
    let directions = [
      ...(rerank ? [rerank.direction === 'asc' ? 1 : -1] : []),
      ...(searchEntryQuery.itemQuery.sort ?? []).map((s: any) =>
        (s.direction ?? defaultSortDirection(s)) === 'desc' ? -1 : 1,
      ),
    ];
    combined.data.sort((a, b) =>
      compareSortValues(
        a.meta?._sortValues as unknown[] | undefined,
        b.meta?._sortValues as unknown[] | undefined,
        directions,
      ),
    );
    if (page) {
      let start = (page.number ?? 0) * page.size;
      combined.data = combined.data.slice(start, start + page.size);
    }
    for (let entry of combined.data) {
      if (entry.meta && '_sortValues' in entry.meta) {
        let { _sortValues: _drop, ...rest } = entry.meta as Record<
          string,
          unknown
        >;
        entry.meta = rest as EntryResource['meta'];
      }
    }
  } else {
    // Per realm: each realm's rows stay together, sections in order of their
    // best card's score when the sort scores rows (a realm matching nothing
    // last), in the order asked otherwise.
    let sign = rankBy?.direction === 'asc' ? -1 : 1;
    let scored = answered.map((a, i) => {
      let best = rankBy ? a.doc.data[0]?.meta?.[rankBy.key] : undefined;
      return { ...a, i, score: typeof best === 'number' ? best : undefined };
    });
    scored.sort((x, y) => {
      let ex = x.doc.data.length === 0;
      let ey = y.doc.data.length === 0;
      if (ex !== ey) return ex ? 1 : -1;
      if (x.score !== undefined && y.score !== undefined && x.score !== y.score)
        return (y.score - x.score) * sign;
      return x.i - y.i;
    });
    combined = combineSearchEntryResults(
      scored.map((s) => s.doc),
      realms.length,
    );
    combined.meta.sections = scored.map((s) => ({
      realm: s.url ?? '',
      count: s.doc.data.length,
      ...(s.score !== undefined ? { score: s.score } : {}),
    }));
  }
  if (overrequested.size && combined.meta.facets) {
    let errors: Record<string, number> = {};
    for (let [by, { size, asked }] of overrequested) {
      let merged = combined.meta.facets[by];
      if (!merged) continue;
      combined.meta.facets[by] = merged.slice(0, size);
      // A realm that answered all `asked` values may hold more: any value
      // missing from its answer counts at most its smallest count there.
      errors[by] = answered.reduce((sum, { doc }) => {
        let counts = doc.meta?.facets?.[by] ?? [];
        return (
          sum +
          (counts.length >= asked ? (counts[counts.length - 1]?.count ?? 0) : 0)
        );
      }, 0);
    }
    combined.meta.facetErrors = errors;
  }
  combined.meta.federation = { results };
  combined.meta.realms = statuses;
  if (timings) {
    timings.incr('results', combined.data?.length ?? 0);
  }
  if (ownsTimings && timings) {
    emitSearchTiming(
      `corr=${opts!.loggingCorrelationId}` +
        ` realms=${realms.filter((realm) => Boolean(realm)).length}` +
        ` total=${Date.now() - startedAt}ms ` +
        timings.toLogFragment(),
    );
  }
  return combined;
}

// One realm's search, cut off at the federated search's per-realm deadline:
// the realm's own signal aborts (so its link fan-out stops) and the search
// fails as a timeout, which the merge reports for that realm alone. The
// caller's own signal still aborts it.
async function withRealmDeadline<T>(
  deadline: number | undefined,
  opts: SearchOpts | undefined,
  run: (opts: SearchOpts | undefined) => Promise<T>,
): Promise<T> {
  if (deadline == null) {
    return run(opts);
  }
  let controller = new AbortController();
  let outer = opts?.signal;
  let onAbort = () => controller.abort(outer?.reason);
  if (outer?.aborted) {
    controller.abort(outer.reason);
  } else {
    outer?.addEventListener('abort', onAbort, { once: true });
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => {
        let error = new SearchBoundError(
          408,
          'this realm did not answer within the request time limit',
        );
        controller.abort(error);
        reject(error);
      },
      Math.max(0, deadline - Date.now()),
    );
  });
  let running = run({ ...opts, signal: controller.signal });
  running.catch(() => {});
  try {
    return await Promise.race([running, timedOut]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    outer?.removeEventListener('abort', onAbort);
  }
}

// How a realm's failed search reads in `meta.realms`: a refusal the query
// grammar raised (with its code), a time-budget cutoff, or anything else.
function realmFailureStatus(e: any): {
  status: 'refused' | 'timeout' | 'unavailable';
  code?: string;
} {
  if (e instanceof InvalidQueryError) {
    return { status: 'refused', code: e.code };
  }
  if (e instanceof SearchRequestError) {
    return { status: 'refused', code: e.queryCode ?? e.code };
  }
  if (
    (e?.name === 'SearchBoundError' && e.status === 408) ||
    e?.name === 'AbortError' ||
    e?.name === 'TimeoutError'
  ) {
    return { status: 'timeout' };
  }
  return { status: 'unavailable' };
}

// Orders two rows by the values each realm sorted them by, key by key, each
// in its sort's direction (keys past the sort list, the engine's tiebreaks,
// ascending). A row with no values sorts last; nulls sort after values.
function compareSortValues(
  a: unknown[] | undefined,
  b: unknown[] | undefined,
  directions: number[],
): number {
  if (!a || !b) {
    return !a && !b ? 0 : !a ? 1 : -1;
  }
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    let x = a[i];
    let y = b[i];
    if (x === y) continue;
    if (x == null || y == null) return x == null ? 1 : -1;
    let d = directions[i] ?? 1;
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * d;
    let nx = Number(x);
    let ny = Number(y);
    if (!Number.isNaN(nx) && !Number.isNaN(ny) && typeof x !== 'boolean')
      return (nx - ny) * d;
    return String(x).localeCompare(String(y)) * d;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Builders for the entry resources. The projection engine runs these per row
// when assembling an `entry` document; keeping them pure (no SQL, no
// realm state) lets the shapes be unit-tested directly. The `css` resource
// builder is shared with the pre-existing search paths (`buildCssResource`).
// ---------------------------------------------------------------------------

// One `entry` — the top-level `data` resource for a result. Which
// branches it carries is the resolution policy / sparse fieldset's call; this
// just assembles the linkage. The `item` shares the entry's URL as its id;
// each `html` member points at one specific rendering by its composite id.
// `htmlIds` undefined omits the relationship (the default mode's fallback
// rows); an empty array emits `data: []` (a pinned html branch with no
// matching rendering yet).
export function buildEntryResource(args: {
  url: string;
  htmlIds?: string[];
  itemType?: typeof CardResourceType | typeof FileMetaResourceType;
  // The id of the result's `icon` resource (its native-type internal key) —
  // omitted when the row carries no `icon_html`.
  iconId?: string;
  // The row's index-data generation (`boxel_index.generation`) — rides in
  // `meta.generation` so a consumer can tell fresh index data from stale.
  // Omitted only by callers with no generation to surface (unit tests); the
  // engine always supplies it.
  generation?: number;
  // Full-text relevance for the query's `matches` terms — present only on a
  // relevance-sorted query; rides in `meta._matchRelevance`. Omitted otherwise.
  matchRelevance?: number;
  // Cosine similarity to the target of the query's first `near` sort (1 =
  // same direction, -1 = opposite) — present only on a near-sorted query; rides in
  // `meta._nearSimilarity`. Omitted otherwise, and for a card with no vector.
  nearSimilarity?: number;
  // The first `_blend` sort's fused score — rides in `meta._blendScore`.
  blendScore?: number;
  // Under `explain`, each signal's part in that score — `meta._explain`.
  explanation?: ResultExplanation;
  // Under `rerank`, the row's formula value — `meta._rerank`.
  rerankValue?: number | null;
  // Under `collapse`, the row's group size — `meta._collapseSize`.
  collapseSize?: number;
  // For a federated merge, the row's sort values — `meta._sortValues`.
  sortValues?: unknown[];
  // The query's expression value — `meta._expression`.
  formulaValue?: number | null;
}): EntryResource {
  let {
    url,
    htmlIds,
    itemType,
    iconId,
    generation,
    matchRelevance,
    nearSimilarity,
    blendScore,
    explanation,
    rerankValue,
    formulaValue,
    collapseSize,
    sortValues,
  } = args;
  let resource: EntryResource = {
    type: EntryResourceType,
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
  if (iconId !== undefined) {
    resource.relationships.icon = {
      data: { type: IconResourceType, id: iconId },
    };
  }
  if (
    generation !== undefined ||
    matchRelevance !== undefined ||
    nearSimilarity !== undefined ||
    blendScore !== undefined ||
    explanation !== undefined ||
    rerankValue !== undefined ||
    formulaValue !== undefined ||
    collapseSize !== undefined ||
    sortValues !== undefined
  ) {
    resource.meta = {
      ...(generation !== undefined ? { generation } : {}),
      ...(matchRelevance !== undefined
        ? { _matchRelevance: matchRelevance }
        : {}),
      ...(nearSimilarity !== undefined
        ? { _nearSimilarity: nearSimilarity }
        : {}),
      ...(blendScore !== undefined ? { _blendScore: blendScore } : {}),
      ...(explanation !== undefined ? { _explain: explanation } : {}),
      ...(rerankValue !== undefined ? { _rerank: rerankValue } : {}),
      ...(collapseSize !== undefined ? { _collapseSize: collapseSize } : {}),
      ...(sortValues !== undefined ? { _sortValues: sortValues } : {}),
      ...(formulaValue !== undefined
        ? {
            _expression:
              typeof formulaValue === 'string'
                ? Number(formulaValue)
                : formulaValue,
          }
        : {}),
    };
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
  isError?: boolean;
  cssIds: string[];
  // The generation this rendering was produced at
  // (`prerendered_html.generation`) — rides in `meta.generation`, independent
  // of the owning entry's index-data generation. Omitted only by callers with
  // no generation to surface (unit tests); the engine always supplies it.
  generation?: number;
}): HtmlResource {
  let { url, format, renderType, html, cardType, isError, cssIds, generation } =
    args;
  let resource: HtmlResource = {
    type: HtmlResourceType,
    id: htmlResourceId({ url, format, renderType }),
    attributes: {
      ...(html !== undefined ? { html } : {}),
      cardType,
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
  if (generation !== undefined) {
    resource.meta = { generation };
  }
  return resource;
}

// One card-type `icon` resource (see `IconResource`): the per-type descriptor
// (icon, display name, code ref). Its `id` is the type's internal key — the
// `<module>/<name>` form a row already carries as `types[0]` — so the same type
// collapses to one resource in `included`. The `entry` → `icon`
// relationship points here, reachable for item-only rows that carry no `html`
// rendering.
export function buildIconResource(args: {
  internalKey: string;
  iconHtml: string;
  displayName: string;
  codeRef: ResolvedCodeRef;
}): IconResource {
  return {
    type: IconResourceType,
    id: args.internalKey,
    attributes: {
      iconHtml: args.iconHtml,
      displayName: args.displayName,
      codeRef: args.codeRef,
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
