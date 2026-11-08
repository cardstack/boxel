import type * as JSONTypes from 'json-typescript';
import { flatten } from 'lodash-es';
import stringify from 'safe-stable-stringify';
import {
  type CardResource,
  type CodeRef,
  type Diagnostics,
  type ResolvedCodeRef,
  baseCardRef,
  internalKeyFor,
  isResolvedCodeRef,
  baseRealmRRI,
  getSerializer,
} from './index.ts';
import { isValidPrerenderedHtmlFormat } from './prerendered-html-format.ts';
import { verdictCoversRow } from './index-writer.ts';
import {
  type Expression,
  type CardExpression,
  type FieldQuery,
  type FieldValue,
  type FieldArity,
  type JsonContainsQuery,
  type TypeCondition,
  param,
  isParam,
  tableValuedTree,
  typesContains,
  typeCondition as typeConditionNode,
  separatedByCommas,
  addExplicitParens,
  any,
  every,
  fieldQuery,
  fieldValue,
  fieldArity,
  jsonContainsQuery,
  tableValuedFunctionsPlaceholder,
  query,
  dbExpression,
  isDbExpression,
  sortDirection,
} from './expression.ts';
import type {
  RangeOperator,
  RangeFilterValue,
  NearSortTarget,
  BlendSortExpression,
  BlendComponent,
} from './query.ts';
import {
  DEFAULT_RRF_K,
  DEFAULT_RELEVANCE_WEIGHTS,
  MAX_BLEND_COMPONENTS,
  isRelevanceSort,
  type RelevanceSignal,
  type RelevanceSortExpression,
} from './query.ts';
import {
  rankFieldsOf,
  searchesByPattern,
  typoCorrections,
  SEARCH_RANK_SIGNALS,
  SEARCH_TEXT_KEY,
} from './search-intent.ts';
import { vectorDimensions, vectorToSqlLiteral } from './serializers/vector.ts';
import {
  hasVectorIndex,
  VECTOR_INDEX_UNAVAILABLE_MESSAGE,
} from './vector-index.ts';
import {
  type Query,
  type Filter,
  type EqFilter,
  type InFilter,
  type NotFilter,
  type ContainsFilter,
  type MatchesFilter,
  type NearFilter,
  type PatternFilter,
  type RegexFilter,
  type Sort,
  type RangeFilter,
  RANGE_OPERATORS,
  InvalidQueryError,
  collectPositiveMatchTerms,
  splitTypeAheadQuery,
  type MatchTerm,
  filterOperators,
  isCardTypeFilter,
  isMatchesFilter,
  isTypeAheadFilter,
  DEFAULT_FACET_SIZE,
  type Facet,
  type FacetCount,
  type FacetMeasureOp,
  type FacetInterval,
  type FacetRange,
  type FacetStats,
  facetRangeLabel,
  type PassageMatch,
  typeAheadWords,
  type TypeAheadFilter,
  type LinkedFromFilter,
  isNearFilter,
  isReferenceFilterField,
  collapseBy,
  MAX_PEER_VALUES,
  DEFAULT_RERANK_TOP,
  MAX_RERANK_TOP,
  EXPR_SORT_KEY,
  exprSortSql,
  isExprSort,
  type ResultExplanation,
  mapLetReferences,
  MAX_LET_ROWS,
  MAX_LET_VALUES,
  type LetBinding,
  isWhenSignal,
  isRelativeDate,
  resolveRelativeDate,
} from './query.ts';
import {
  renderErrorSummary,
  type RenderErrorSummary,
  type SerializedError,
} from './error.ts';
import type { CaptureManifest } from './capture-spec.ts';
import type { DBAdapter } from './db.ts';
import {
  coerceTypes,
  normalizeRealmMetaValue,
  type BoxelIndexTable,
  type PrerenderedHtmlTable,
  type RealmMetaValue,
} from './index-structure.ts';
import {
  getFieldDef,
  type Definition,
  type FieldDefinition,
} from './definitions.ts';
import {
  linkIncludes,
  matchSearchableRoutes,
  routesForField,
} from './searchable-routes.ts';
import {
  CARD_INSTANCE_FILE_KEY,
  CARD_TITLE_KEY,
  TYPE_AHEAD_KEY,
  isSyntheticSearchDocKey,
} from './search-doc-keys.ts';
import {
  isFilterRefersToNonexistentTypeError,
  type DefinitionLookup,
} from './definition-lookup.ts';
import type { FileMetaResource } from './resource-types.ts';
import type { VirtualNetwork } from './virtual-network.ts';
import type { RequestTimings } from './request-timings.ts';
import {
  restoreSpilledSearchDocs,
  SEARCH_DOC_INLINE_STRING_MAX,
} from './search-doc-spill.ts';

// A filter path resolves in the schema but crosses a `linksTo`/`linksToMany`
// hop whose target is not in the search doc, so the query would silently match
// nothing. Raised by the query compiler (see `walkFilterFieldPath`) and
// kept distinct from the "nonexistent field" error so a forgotten `searchable`
// annotation surfaces at the point of use as an actionable message rather than
// as mysteriously-empty results. `reason` distinguishes a link that simply was
// never made searchable (fixable by annotating it) from a query-backed
// relationship, which is never in the doc at all and cannot be filtered
// through.
export class FilterRefersToNonsearchableFieldError extends Error {
  type: CodeRef;
  // The full filter path as written (e.g. `bestFriend.friends.name`).
  path: string;
  // The dotted path to the offending relationship hop (e.g. `bestFriend.friends`).
  relationshipPath: string;
  reason: 'not-searchable' | 'query-backed';

  constructor(opts: {
    type: CodeRef;
    path: string;
    relationshipPath: string;
    reason: 'not-searchable' | 'query-backed';
  }) {
    super(buildNonsearchableFieldMessage(opts));
    this.name = 'FilterRefersToNonsearchableFieldError';
    this.type = opts.type;
    this.path = opts.path;
    this.relationshipPath = opts.relationshipPath;
    this.reason = opts.reason;
    // make sure instances of this Error subclass behave like instances of the subclass should
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function isFilterRefersToNonsearchableFieldError(
  error: unknown,
): error is FilterRefersToNonsearchableFieldError {
  return error instanceof FilterRefersToNonsearchableFieldError;
}

function buildNonsearchableFieldMessage(opts: {
  type: CodeRef;
  path: string;
  relationshipPath: string;
  reason: 'not-searchable' | 'query-backed';
}): string {
  let { type, path, relationshipPath, reason } = opts;
  if (reason === 'query-backed') {
    return (
      `Your filter on ${stringify(type)} refers to "${path}", but the ` +
      `"${relationshipPath}" relationship is query-backed and is never ` +
      `included in the search doc (query-backed relationships can't be kept ` +
      `current as matching cards change), so it cannot be filtered through.`
    );
  }
  // `searchable` routes are seeded from the queried card's own fields, so the
  // fix is always to extend the head field's annotation. For a single-hop path
  // the head field IS the relationship (annotate it `searchable: true`); for a
  // deeper hop the head field's annotation gains the remaining route.
  let [headField, ...rest] = relationshipPath.split('.');
  let hint =
    rest.length === 0 ? `searchable: true` : `searchable: '${rest.join('.')}'`;
  return (
    `Your filter on ${stringify(type)} refers to "${path}", but the ` +
    `"${relationshipPath}" relationship is not searchable, so its target is ` +
    `not in the search doc and the filter would silently match nothing. To ` +
    `query through it, make it searchable: add \`${hint}\` to the ` +
    `"${headField}" field (combine multiple routes in an array if it already ` +
    `has a searchable annotation).`
  );
}

// A boxel_index row (`i`) joined with its prerendered_html row's (`ph`)
// rendered output — the shape the single-entry read paths project
// (`SELECT i.*` plus `PRERENDERED_HTML_SELECTS`). The HTML/markdown columns
// live only on prerendered_html; a row with no prerendered_html row reads
// them as NULL.
type IndexRowWithHtml = BoxelIndexTable &
  Pick<
    PrerenderedHtmlTable,
    | 'isolated_html'
    | 'head_html'
    | 'embedded_html'
    | 'fitted_html'
    | 'atom_html'
    | 'markdown'
    | 'captures'
  > & {
    // `getInstance`'s `RENDER_ERROR_SELECT`; absent from the other paths.
    render_error_doc?: SerializedError | null;
  };

export interface IndexedFile {
  type: 'file';
  canonicalURL: string;
  lastModified: number | null;
  resourceCreatedAt: number | null;
  searchDoc: Record<string, any> | null;
  resource: FileMetaResource | null;
  types: string[] | null;
  displayNames: string[] | null;
  deps: string[] | null;
  isolatedHtml: string | null;
  headHtml: string | null;
  embeddedHtml: { [refURL: string]: string } | null;
  fittedHtml: { [refURL: string]: string } | null;
  atomHtml: string | null;
  iconHtml: string | null;
  markdown: string | null;
  // The file row's declared-capture manifest
  // (`prerendered_html.captures`, type 'file') — joined into the served
  // file-meta resource's `meta.captures` the way an instance row's
  // manifest is joined into a card's.
  captures: CaptureManifest | null;
  generation: number;
  // The generation the file's prerendered HTML was produced at
  // (`prerendered_html.generation`; a file with no prerendered row falls back
  // to its index-data generation). Distinct from `generation`, the file's
  // index-data generation. Only populated on the search-entry read path
  // (`fileEntryFromResult`); undefined on the single-file `getFile` path.
  htmlGeneration?: number;
  realmURL: string;
  indexedAt: number | null;
}

// What link expansion reads off a side-loaded link target. Deliberately not
// an `IndexedInstance`: that shape promises the prerendered formats, the
// search doc and both dependency graphs, and a read that selects them on
// this path fetches bytes no caller can have asked for. A narrower type is
// what keeps the next caller from quietly depending on fields this read does
// not fetch.
// The file-row counterpart of `LinkTargetInstance`, and narrow for the same
// reason: `IndexedFile` promises the prerendered formats, the icon, the
// display names and the dependency graph, none of which building a
// side-loaded file-meta resource reads. Kept structurally a subset of
// `IndexedFile` so the paths that do hold a full one can still be assembled
// through the same function.
export interface LinkTargetFile {
  canonicalURL: string;
  // The file row's stored document, and the search doc it falls back to for
  // any attribute the document does not carry.
  resource: FileMetaResource | null;
  searchDoc: Record<string, any> | null;
  // `types[0]` names the adopted FileDef ref; the resource's own
  // `meta.adoptsFrom` is the fallback.
  types: string[] | null;
  lastModified: number | null;
  resourceCreatedAt: number | null;
  // Both the resource's `meta.realmURL` and the prefix test that decides
  // whether the capture manifest applies to this URL.
  realmURL: string;
  captures: CaptureManifest | null;
}

export interface LinkTargetInstance {
  // The row's own spelling of its URL — a lookup may have addressed it by
  // `file_alias`, and the resource's local path is derived from this.
  canonicalURL: string;
  // The stored card resource, as `pristine_doc` holds it: relationships
  // carrying relative `links.self` and no `data`, which link expansion
  // resolves and rewrites.
  resource: CardResource;
  // Rides the prerendered_html channel and is joined into the side-loaded
  // resource's `meta`, so it is read here even though the formats are not.
  captures: CaptureManifest | null;
}

export interface IndexedInstance {
  type: 'instance';
  instance: CardResource;
  canonicalURL: string;
  lastModified: number | null;
  resourceCreatedAt: number;
  isolatedHtml: string | null;
  headHtml: string | null;
  embeddedHtml: { [refURL: string]: string } | null;
  fittedHtml: { [refURL: string]: string } | null;
  atomHtml: string | null;
  markdown: string | null;
  searchDoc: Record<string, any> | null;
  types: string[] | null;
  deps: string[] | null;
  // The row's declared-capture manifest (`prerendered_html.captures`)
  // — like the HTML columns, whatever rendering currently exists, which may
  // trail the index-data generation until the row's prerender pass lands.
  captures: CaptureManifest | null;
  generation: number;
  realmURL: string;
  indexedAt: number | null;
  // The content hash of the stored source `instance` was serialized from, as
  // the pass that indexed those bytes recorded it. The card+json GET serves it
  // as `meta.version`; a client sends it back as the base its next write is
  // computed against.
  //
  // Null when the row predates the stamp or its pass produced no fingerprint,
  // in which case the GET reports no version at all. Never substitute
  // `realm_file_meta.content_hash` for a null here: that column describes
  // whatever the file holds now rather than the bytes behind this row's
  // document, and it is empty for every file that reached disk outside the
  // realm's own write API.
  sourceContentHash: string | null;
  // The error the card's current render recorded on the prerendered_html
  // channel, while its index visit succeeded. The card's data is intact —
  // `instance` is what that visit read — and only its prerendered output is
  // affected: the HTML columns above hold the last-known-good rendering, or
  // nothing when no render ever succeeded. A consumer serving the card's data
  // reports this alongside it, and a consumer serving the prerendered output
  // treats the card as errored. Null when the render channel holds no current
  // error.
  renderError: RenderErrorSummary | null;
}

// An instance's row as its index visit left it, and nothing from its render.
// `error` is set when the visit itself failed, and `instance` otherwise.
export interface IndexedInstanceSource {
  // The row's own URL: the file the instance is stored in, which is what an
  // index visit of it is asked to visit.
  url: string;
  realmURL: string;
  generation: number;
  sourceContentHash: string | null;
  types: string[] | null;
  instance: CardResource | null;
  error: SerializedError | null;
  // Whether the latest visit failed for a reason the prerender server did not
  // attribute to the card: a stale host shell, or a gateway failure on a fetch
  // the visit made. The index keeps such a failure off the row, so the row
  // reads as healthy, and everything on it, `instance` and `sourceContentHash`
  // included, is what an earlier visit recorded. The card's source may have
  // changed since.
  failureWithheld: boolean;
}

interface InstanceError extends Partial<
  Omit<
    IndexedInstance,
    | 'type'
    | 'generation'
    | 'realmURL'
    | 'instance'
    | 'lastModified'
    | 'resourceCreatedAt'
  >
> {
  type: 'instance-error';
  error: SerializedError;
  generation: number;
  realmURL: string;
  instance: CardResource | null;
  lastModified: number | null;
  resourceCreatedAt: number | null;
}

export type InstanceOrError = IndexedInstance | InstanceError;

type GetEntryOptions = WIPOptions;
export type QueryOptions = WIPOptions & {
  includeErrors?: true;
  // Restrict the result set to this subset of URLs (SQL `i.url IN (...)`) —
  // instance rows by their `.json` file URL, file rows by their canonical URL.
  cardUrls?: string[];
  timings?: RequestTimings;
};

// Selects which columns `search()` projects. `dataOnly` projects
// the live serialization only (pristine_doc / error_doc); `renderSet` projects
// each row's full rendering set (every per-format HTML column, JSONB maps
// whole) plus the live serialization on every row — the caller selects
// renderings from the set (the htmlQuery evaluation).
export type SearchProjection = { kind: 'dataOnly' } | { kind: 'renderSet' };

export interface WIPOptions {
  // Read one index pass's staged rows — its `boxel_index_pending` rows, with
  // its own `prerendered_html_pending` rows joined — instead of the committed
  // index. Takes the pass's `Batch.stagingId`, so a read sees that pass's
  // uncommitted work and no other pass's.
  pendingStagingId?: string;
}

export interface QueryResultsMeta {
  // TODO SQLite doesn't let us use cursors in the classic sense so we need to
  // keep track of page size and index number
  page: {
    total: number;
  };
  // A query's `facets`, counted over every match: per facet's `by`, its
  // values with how many matched cards hold each, most common first.
  facets?: Record<string, FacetCount[]>;
  // Per facet's `by`, its statistics, for a facet that asked for them or
  // whose field declares a number or date shape (see `Facet`).
  facetStats?: Record<string, FacetStats>;
  // For a search with a `matches … within <field>` term: per card on the page
  // (keyed by card URL), the passages of that field that matched, best first.
  passages?: Record<string, PassageMatch[]>;
  // The result set omits rows nobody counted, so `page.total` covers less than
  // the query asked about and is a floor rather than the match count. Two
  // things leave a result set that way: a realm the query fanned out to did not
  // answer, so the total sums only the realms that did; or the search failed as
  // a unit, so nothing was counted and the total describes an empty result set
  // rather than an empty match set. A consumer that reports a count must treat
  // the total as unknown while this is set — publishing it claims a number over
  // the very rows whose absence made it unknowable.
  incomplete?: boolean;
  // For a query with `let` bindings: how each was resolved. `join` ran in
  // the same statement; `list` ran its query first and passed `values` on.
  lets?: Record<string, { strategy: 'join' | 'list'; values?: number }>;
  // Filled by the host's search resource, never by the engine: under
  // `explain`, each result's `meta._explain` by card id.
  explanations?: Record<string, ResultExplanation>;
  // Likewise each re-ranked result's formula value, by card id.
  reranks?: Record<string, number | null>;
  // For a query with `rerank`: the window it re-ranked and how many of its
  // rows the formula gave a number.
  rerank?: { window: number; scored: number };
}

// Per re-ranked row: its formula value.
export const RERANK_KEY = '_rerank';

// Per result row, under `explain`: the row's `_explain` column.
export const EXPLAIN_KEY = '_explain';

// A mapper for fields that can be sorted on but are not an attribute of a card
// SQL fragments consumed by `_search`'s ORDER BY, which runs with the
// boxel_index alias `i` in scope (and the joined prerendered_html `ph`).
// `cardURL` sorts on the primary-key `url`, which exists in both joined
// tables — qualify it to `i` so it is unambiguous. Callers outside the
// query engine (query.ts, search-entry.ts) use only the keys of this map.
// Full-text `matches` builds its tsvector from `markdown_search_text(markdown)`,
// an IMMUTABLE Postgres function (defined in the prerendered_html migration)
// that strips long base64-alphabet runs and caps length. Postgres caps a single
// tsvector at 1,048,575 bytes and throws SQLSTATE 54000 (`make_tsvector`) above
// it — which, for a plain GIN expression index, aborts the whole index build.
// Some instances carry multi-megabyte markdown (base64 image data embedded by
// image cards), so the raw column can't be indexed. prerendered_html's markdown
// GIN index is built on `to_tsvector('english', markdown_search_text(markdown))`.
// That vector is stored in `prerendered_html.markdown_tsv` (kept current by a
// trigger, migration 1793936584288) and GIN-indexed there, so `matches` and
// relevance read the column: a phrase recheck, a rank, or a key-probe filter
// is a detoast rather than a regex over up to 400 KB of markdown.
// What a filter compiles inside: whether it sits under an `any` (where a
// condition that leans on the prerendered_html join is planned per row), and
// which prerendered_html table a subquery reads (the staged one for a staged
// read).
interface FilterContext {
  inAny: boolean;
  prerenderedTable: string;
  indexTable: string;
}
const DEFAULT_FILTER_CONTEXT: FilterContext = {
  inAny: false,
  prerenderedTable: 'prerendered_html',
  indexTable: 'boxel_index',
};

// Search-doc keys whose substring (`contains`) match has a trigram index of
// its own (see the `add-search-doc-title-trigram-indexes` migration): a row's
// display title, as the search sheet matches it.
const TRIGRAM_INDEXED_TITLE_KEYS = [CARD_TITLE_KEY, 'cardTitle'] as const;

// Field serializers whose values never spill out of the search doc (ADR 021
// §1.1): numbers, booleans, dates, and short fixed-form strings. A filter or
// sort on one reads `search_doc` directly; any other leaf reads through
// `spill_text`. The title keys above never spill either (`search-doc-spill.ts`).
const NEVER_SPILLED_SERIALIZERS: ReadonlySet<string> = new Set([
  'number',
  'big-integer',
  'boolean',
  'date',
  'datetime',
  'email',
  'phone',
  'ethereum-address',
]);

export const generalSortFields: Record<string, string> = {
  lastModified: 'i.last_modified',
  createdAt: 'i.resource_created_at',
  cardURL: 'i.url COLLATE "POSIX"',
};

// A synthetic sort key (not a column in `generalSortFields`): the full-text
// relevance score of a `matches` query, computed per query from the filter's
// match terms. The leading underscore follows the synthetic-key convention
// (`_isCardInstance`, `_isCardInstanceFile`) — it is derived, not a stored
// field. Recognized by the sort validators (`assertSortExpression`,
// `translateSort`) and handled specially by the order builders below; it never
// flows through `generalFieldSortColumn` (it has no static column). Sorting by
// it defaults to `desc` (best match first).
export const MATCH_RELEVANCE_SORT_KEY = '_matchRelevance';

// A relevance sort is recognized by its key alone. The score belongs to the
// query, not to any card type, so an `on` beside it anchors nothing and is
// ignored rather than sending the key down the card-field path, where it
// would resolve as a nonexistent field.
export function isMatchRelevanceSort(sort: { by: string }): boolean {
  return sort.by === MATCH_RELEVANCE_SORT_KEY;
}

// A `near` sort ranks by cosine similarity between a VectorField and a target
// vector (see `NearSortTarget` in query.ts). Like `_matchRelevance`, the score
// belongs to the query and reads "higher is better": `_search` projects it as
// an aggregated, aliased column (`nearSimilarityAlias`) and the order builders
// reference the alias, defaulting to `desc` (most similar first). The first
// near sort's similarity (1 = same direction, -1 = opposite) rides each
// result's `meta._nearSimilarity`.
export const NEAR_SIMILARITY_KEY = '_nearSimilarity';

// A `_blend` sort fuses several ranking signals with reciprocal rank fusion
// (see `BlendSortExpression` in query.ts). Like the other synthetic keys it is
// projected as a column (`blendScoreAlias`) and ordered by alias, defaulting
// to `desc`. The first blend's score rides `meta._blendScore`.
export const BLEND_SORT_KEY = '_blend';
export const BLEND_SCORE_KEY = '_blendScore';

export function isBlendSort(sort: object): sort is BlendSortExpression {
  return (sort as { by?: unknown }).by === BLEND_SORT_KEY;
}

function blendScoreAlias(sort: Sort, index: number): string {
  let firstBlend = sort.findIndex((s) => isBlendSort(s));
  return index === firstBlend ? BLEND_SCORE_KEY : `${BLEND_SCORE_KEY}_${index}`;
}

export function isNearSort(sort: object): sort is {
  by: string;
  on: CodeRef;
  near: NearSortTarget;
  direction?: 'asc' | 'desc';
} {
  return 'near' in sort && (sort as { near?: unknown }).near != null;
}

// The alias of the sort at `index`'s similarity column: the first near sort
// gets `_nearSimilarity` (which `meta._nearSimilarity` reads), any later one a
// suffixed alias.
function nearSimilarityAlias(sort: Sort, index: number): string {
  let firstNear = sort.findIndex((s) => isNearSort(s));
  return index === firstNear
    ? NEAR_SIMILARITY_KEY
    : `${NEAR_SIMILARITY_KEY}_${index}`;
}

export { isValidPrerenderedHtmlFormat };

// Whether a predicate sits under an even (`positive`) or odd (`negated`) number
// of enclosing `not` filters. The `@>` containment rewrite is only equivalent
// to `->>` extraction at positive polarity: on an absent path `->>` yields SQL
// NULL while `@>` yields FALSE, and `NOT NULL` vs `NOT FALSE` diverge.
type FilterPolarity = 'positive' | 'negated';

// An `any` whose branches are each a single-key `eq` on the same field (and
// the same type anchor) is an `in`: `any: [{eq: {vid: a}}, {eq: {vid: b}}]`
// selects exactly what `in: {vid: [a, b]}` does. Folding it lets the `in`
// plan (one indexed lookup) serve what would otherwise be an OR of
// per-branch type and containment checks, which slowed sharply past ~10
// branches. Returns undefined when the branches don't all have that shape.
function foldSameKeyEqs(branches: Filter[]): Filter | undefined {
  if (branches.length < 2) {
    return undefined;
  }
  let key: string | undefined;
  let anchor: string | undefined;
  let on: CodeRef | undefined;
  let values: JSONTypes.Value[] = [];
  for (let branch of branches) {
    let keys = Object.keys(branch).filter((k) => k !== 'on');
    if (keys.length !== 1 || keys[0] !== 'eq') {
      return undefined;
    }
    let eq = (branch as EqFilter).eq;
    let entries = Object.entries(eq);
    if (entries.length !== 1) {
      return undefined;
    }
    let [k, v] = entries[0];
    let branchOn = (branch as { on?: CodeRef }).on;
    let branchAnchor = JSON.stringify(branchOn ?? null);
    if (key === undefined) {
      key = k;
      anchor = branchAnchor;
      on = branchOn;
    } else if (k !== key || branchAnchor !== anchor) {
      return undefined;
    }
    values.push(v);
  }
  return { ...(on ? { on } : {}), in: { [key!]: values } } as Filter;
}

function flipPolarity(polarity: FilterPolarity): FilterPolarity {
  return polarity === 'positive' ? 'negated' : 'positive';
}

// Architectural guidance for this module — the two-pass compilation pipeline,
// the Postgres/SQLite dual-adapter constraints, the semantics of table-valued
// fan-out, and the parity contract with the client-side
// `instance-filter-matcher.ts` — lives in
// `.claude/skills/index-query-engine/SKILL.md`. Read it before changing how
// queries compile or adding a filter operator / synthetic search-doc key.
export class IndexQueryEngine {
  #dbAdapter: DBAdapter;
  #definitionLookup: DefinitionLookup;
  #virtualNetwork: VirtualNetwork;

  constructor(
    dbAdapter: DBAdapter,
    definitionLookup: DefinitionLookup,
    virtualNetwork: VirtualNetwork,
  ) {
    this.#dbAdapter = dbAdapter;
    this.#definitionLookup = definitionLookup;
    this.#virtualNetwork = virtualNetwork;
  }

  async #query(expression: Expression) {
    return await query(this.#dbAdapter, expression, coerceTypes);
  }

  // Split the two phases so the search-timing line can attribute the SQL
  // stage. `makeExpression` resolves the filter tree to SQL — that resolution
  // runs a `getDefinition` card-definition lookup per type/field (a cache
  // read, or a module prerender on a miss), so it can dominate a search whose
  // actual row fetch is tiny. `#query` is the DB round-trip itself. The data
  // and count queries run concurrently, so these accumulate into the
  // parallel-sum `busy` bucket rather than the wall-clock stages.
  async #queryCards(query: CardExpression, timings?: RequestTimings) {
    let expression = timings
      ? await timings.busyTime('compile', () => this.makeExpression(query))
      : await this.makeExpression(query);
    return timings
      ? await timings.busyTime('sqlExec', () => this.#query(expression))
      : this.#query(expression);
  }

  // A card's row, read as its data: the instance its index visit read, or the
  // error that visit recorded. Only the index channel decides between the two.
  // A render failure leaves the data intact, so it comes back as the instance
  // with `renderError` set rather than as an `instance-error`.
  async getInstance(
    url: URL,
    opts?: GetEntryOptions,
  ): Promise<InstanceOrError | undefined> {
    let result = (await this.#query([
      `SELECT i.*, ${PRERENDERED_HTML_SELECTS}, ${RENDER_ERROR_SELECT}`,
      `FROM ${tableFromOpts(opts)} as i ${prerenderedJoin(opts)}
       WHERE`,
      ...every([
        any([
          [`i.url =`, param(url.href)],
          [`i.file_alias =`, param(url.href)],
        ]),
        ['i.type =', param('instance')],
        any([['i.is_deleted = FALSE'], ['i.is_deleted IS NULL']]),
      ]),
    ] as Expression)) as unknown as IndexRowWithHtml[];
    return this.#rowToInstanceOrError(result[0], url, opts);
  }

  // Batch read of the link targets `loadLinks` side-loads, selecting what link
  // expansion actually consumes and nothing else.
  //
  // The wide `getInstance` shape is the wrong one here, and not merely
  // wasteful. Whichever entry point reaches link expansion — a search's
  // projected roots or a single card+json document's own — expansion puts
  // only the resource into `included[]`. Rendered output for any of these
  // URLs is served by the render-set projection, which joins
  // `prerendered_html` itself and never reaches this code. So no caller of
  // this read can have asked for prerendered HTML.
  //
  // A `SELECT i.*` costs more than those formats, though: it also drags
  // `deps` and `last_known_good_deps`, each holding a few hundred dependency
  // URLs, which together dwarf everything else on the row. Both stay far
  // larger than the document even if a scoped-CSS dep stops carrying its
  // stylesheet inline, since the row's cost there is the number of deps
  // rather than the width of any one.
  //
  // So the select names its columns rather than starring: what a star
  // quietly includes is the whole of the expense, and two of the columns it
  // includes are ones nothing on this path reads.
  //
  // Returns a map keyed by the LOOKUP URL (matching either `i.url` or
  // `i.file_alias`), matching rows on the same type/tombstone predicate
  // `getInstance` uses. A row that is absent, deleted, or whose index visit
  // failed is simply not in the map — which is what link expansion does with
  // one anyway: it leaves the relationship naming a target the document does
  // not carry. A target whose render failed is included: side-loading puts
  // only its data into `included[]`, and that data is intact.
  async getLinkTargetInstances(
    urls: URL[],
    opts?: GetEntryOptions,
  ): Promise<Map<string, LinkTargetInstance>> {
    let resultMap = new Map<string, LinkTargetInstance>();
    if (urls.length === 0) {
      return resultMap;
    }
    let lookupHrefs = [...new Set(urls.map((u) => u.href))];
    // Each chunk emits 2*N + 1 placeholders (url IN list + file_alias IN list
    // + i.type param). Cap at half the existing url-batch sizes used in
    // index-writer.ts (sqlite=900, pg=5000) so we stay well under both
    // adapter parameter limits.
    let chunkSize = this.#dbAdapter.kind === 'sqlite' ? 450 : 2500;
    for (let start = 0; start < lookupHrefs.length; start += chunkSize) {
      let chunk = lookupHrefs.slice(start, start + chunkSize);
      let chunkSet = new Set(chunk);
      let chunkParams = chunk.map((href) => [param(href)]);
      let rows = (await this.#query([
        // `ph.captures` is the join's only consumer: it is joined into the
        // side-loaded resource's `meta`.
        `SELECT i.url, i.file_alias, i.pristine_doc,
                ph.captures AS captures`,
        `FROM ${tableFromOpts(opts)} as i ${prerenderedJoin(opts)}
         WHERE`,
        ...every([
          any([
            ['i.url IN', ...addExplicitParens(separatedByCommas(chunkParams))],
            [
              'i.file_alias IN',
              ...addExplicitParens(separatedByCommas(chunkParams)),
            ],
          ]),
          ['i.type =', param('instance')],
          any([['i.is_deleted = FALSE'], ['i.is_deleted IS NULL']]),
          // An index error is excluded here rather than after the fact, as
          // the file leg of this same batch does: it keeps an errored
          // target's document off the wire too, which is this read's own
          // argument.
          [`NOT ${INDEX_HAS_ERROR}`],
        ]),
      ] as Expression)) as unknown as {
        url: string | null;
        file_alias: string | null;
        pristine_doc: CardResource | null;
        captures: CaptureManifest | null;
      }[];
      for (let row of rows) {
        if (!row.url) {
          continue;
        }
        // Every row here is live and unerrored, and such a row is required to
        // carry a document. One that does not is unrepresentable rather than
        // merely unavailable, so it is reported instead of dropped — a
        // dropped one is indistinguishable from a link whose target is
        // legitimately gone, and would silently cost the document a
        // relationship. This rejects the whole read, as the singular one does.
        if (!row.pristine_doc) {
          throw new Error(
            `bug: live index entry for ${row.url} with opts: ${stringify(
              opts,
            )} has no pristine_doc`,
          );
        }
        let target: LinkTargetInstance = {
          canonicalURL: row.url,
          resource: row.pristine_doc,
          captures: row.captures ?? null,
        };
        // A row may be addressable by its url or its file_alias.
        // Index the result under whichever lookup keys the caller asked about.
        if (chunkSet.has(row.url)) {
          resultMap.set(row.url, target);
        }
        if (row.file_alias && chunkSet.has(row.file_alias)) {
          resultMap.set(row.file_alias, target);
        }
      }
    }
    return resultMap;
  }

  // The live-instance row predicate, defined once: `getInstance`'s
  // url/file_alias match, instance type, and tombstone exclusion, plus the
  // effective error across both channels. The gates below serve prerendered
  // output, so a card whose render failed is not live to them even though
  // `getInstance` reads its data as an instance. Every liveness gate —
  // `hasLiveInstance`, `liveInstanceGeneration`, `liveInstanceCaptures` —
  // spreads this one fragment, so the DSL and `?name=` capture routes'
  // liveness semantics cannot silently split. (`findLiveInstanceGeneration` in media-cache.ts
  // is the realm-scoped raw-SQL twin, built from the same exported join
  // fragments.)
  #liveInstanceConditions(url: URL): Expression {
    return this.#liveRowConditions(url, 'instance');
  }

  // The same predicate over the URL's 'file' row — the file-flavored liveness
  // gate the `?name=` capture route falls back to when no instance
  // matches (a FileDef family's declared captures live on the file row).
  #liveRowConditions(url: URL, type: 'instance' | 'file'): Expression {
    return every([
      any([
        [`i.url =`, param(url.href)],
        [`i.file_alias =`, param(url.href)],
      ]),
      ['i.type =', param(type)],
      any([['i.is_deleted = FALSE'], ['i.is_deleted IS NULL']]),
      [`NOT ${effectiveHasError()}`],
    ]) as Expression;
  }

  // Existence probe with the live-instance predicate, without hydrating the
  // row. `getInstance` selects every wide column in the index (prerendered
  // HTML, pristine/search docs), so callers that gate on liveness alone —
  // the capture route runs this on every request, 304 revalidations
  // included — must not pay for a hydration they discard.
  async hasLiveInstance(url: URL, opts?: GetEntryOptions): Promise<boolean> {
    let rows = (await this.#query([
      'SELECT 1',
      `FROM ${tableFromOpts(opts)} AS i ${prerenderedJoin(opts)}`,
      'WHERE',
      ...this.#liveInstanceConditions(url),
      'LIMIT 1',
    ] as Expression)) as unknown as { 1: number }[];
    return rows.length > 0;
  }

  // The index generation of a live instance, or undefined when none matches —
  // the generation companion to `hasLiveInstance`, selecting the one column
  // the capture cache key needs, still without hydrating the row. Used
  // where the caller needs both the liveness gate and the generation, so the
  // two collapse into a single narrow read.
  async liveInstanceGeneration(
    url: URL,
    opts?: GetEntryOptions,
  ): Promise<number | undefined> {
    let rows = (await this.#query([
      'SELECT i.generation',
      `FROM ${tableFromOpts(opts)} AS i ${prerenderedJoin(opts)}`,
      'WHERE',
      ...this.#liveInstanceConditions(url),
      'LIMIT 1',
    ] as Expression)) as unknown as { generation: number }[];
    return rows.length > 0 ? Number(rows[0].generation) : undefined;
  }

  // An instance's row from `boxel_index` alone, with no `prerendered_html`
  // join: what its index visit read and recorded, and whether that visit
  // failed. A render error is not reflected, so a card whose rendering failed
  // still reads as the instance its source says it is. For a reader that
  // needs the card's data and adoption chain, and none of its rendering.
  async getInstanceSource(
    url: URL,
    opts?: GetEntryOptions,
  ): Promise<IndexedInstanceSource | undefined> {
    let rows = (await this.#query([
      'SELECT i.url, i.realm_url, i.generation, i.source_content_hash, i.types, i.pristine_doc, i.has_error, i.error_doc, i.diagnostics',
      `FROM ${tableFromOpts(opts)} AS i`,
      'WHERE',
      ...every([
        any([
          [`i.url =`, param(url.href)],
          [`i.file_alias =`, param(url.href)],
        ]),
        ['i.type =', param('instance')],
        any([['i.is_deleted = FALSE'], ['i.is_deleted IS NULL']]),
      ]),
      'LIMIT 1',
    ] as Expression)) as unknown as {
      url: string;
      realm_url: string;
      generation: number;
      source_content_hash: string | null;
      types: string[] | null;
      pristine_doc: CardResource | null;
      has_error: boolean | null;
      error_doc: SerializedError | null;
      diagnostics: Diagnostics | null;
    }[];
    let row = rows[0];
    if (!row) {
      return undefined;
    }
    return {
      url: row.url,
      realmURL: row.realm_url,
      generation: Number(row.generation),
      sourceContentHash: row.source_content_hash ?? null,
      types: row.types,
      instance: row.has_error ? null : row.pristine_doc,
      error: row.has_error ? row.error_doc : null,
      failureWithheld:
        !row.has_error &&
        verdictCoversRow(row.diagnostics ?? undefined, 'instance'),
    };
  }

  // The declared-capture manifest of a live instance — the `?name=`
  // serving route's addressing read: the shared live-instance predicate (so
  // a name resolves exactly when a DSL capture of the same instance would).
  // `undefined` means no live instance matches; a live row comes back with
  // its canonical `url` (the lookup also matches `file_alias`, and the
  // MediaCache ledger is keyed off the row's own spelling, never the
  // request's) and a `manifest` that is null when nothing has been captured.
  async liveInstanceCaptures(
    url: URL,
    opts?: GetEntryOptions,
  ): Promise<{ url: string; manifest: CaptureManifest | null } | undefined> {
    return await this.#liveRowCaptures(url, 'instance', opts);
  }

  // The file-row twin of `liveInstanceCaptures`: the declared-capture
  // manifest of a live 'file' row. The `?name=` serving route falls back to
  // this when the addressed path resolves to no live instance — a FileDef
  // family's declared captures are persisted on the file rendering's row.
  async liveFileCaptures(
    url: URL,
    opts?: GetEntryOptions,
  ): Promise<{ url: string; manifest: CaptureManifest | null } | undefined> {
    return await this.#liveRowCaptures(url, 'file', opts);
  }

  async #liveRowCaptures(
    url: URL,
    type: 'instance' | 'file',
    opts?: GetEntryOptions,
  ): Promise<{ url: string; manifest: CaptureManifest | null } | undefined> {
    let rows = (await this.#query([
      'SELECT i.url AS url, ph.captures AS captures',
      `FROM ${tableFromOpts(opts)} AS i ${prerenderedJoin(opts)}`,
      'WHERE',
      ...this.#liveRowConditions(url, type),
      'LIMIT 1',
    ] as Expression)) as unknown as {
      url: string;
      captures: CaptureManifest | null;
    }[];
    if (rows.length === 0) {
      return undefined;
    }
    return { url: rows[0].url, manifest: rows[0].captures ?? null };
  }

  // Shared row → InstanceOrError mapping for getInstance.
  // `lookupURL` is used only for error context and is optional in the batch path.
  #rowToInstanceOrError(
    maybeResult: IndexRowWithHtml | undefined,
    lookupURL: URL | undefined,
    opts?: GetEntryOptions,
  ): InstanceOrError | undefined {
    if (!maybeResult) {
      return undefined;
    }
    if (maybeResult.is_deleted) {
      return undefined;
    }
    let {
      url: canonicalURL,
      pristine_doc: instance,
      isolated_html: isolatedHtml,
      head_html: headHtml,
      atom_html: atomHtml,
      embedded_html: embeddedHtml,
      fitted_html: fittedHtml,
      markdown,
      search_doc: searchDoc,
      captures,
      generation,
      realm_url: realmURL,
      indexed_at: indexedAt,
      last_modified: lastModified,
      resource_created_at: resourceCreatedAt,
      types,
      deps,
      source_content_hash: sourceContentHash,
    } = maybeResult;
    let baseResult = {
      canonicalURL,
      realmURL,
      instance,
      sourceContentHash: sourceContentHash ?? null,
      isolatedHtml,
      headHtml,
      embeddedHtml,
      fittedHtml,
      atomHtml,
      markdown,
      searchDoc,
      captures: (captures as CaptureManifest | null) ?? null,
      types,
      indexedAt: indexedAt != null ? parseInt(indexedAt) : null,
      deps,
      lastModified: lastModified != null ? parseInt(lastModified) : null,
      resourceCreatedAt:
        resourceCreatedAt != null ? parseInt(resourceCreatedAt) : null,
      generation,
    };

    if (maybeResult.has_error) {
      return {
        ...baseResult,
        type: 'instance-error',
        error: maybeResult.error_doc!,
      };
    }
    let instanceEntry = assertIndexEntry(maybeResult);
    if (!instance) {
      throw new Error(
        `bug: index entry for ${
          lookupURL?.href ?? canonicalURL
        } with opts: ${stringify(
          opts,
        )} has neither an error_doc nor a pristine_doc`,
      );
    }
    return {
      ...baseResult,
      type: 'instance',
      instance,
      renderError: maybeResult.render_error_doc
        ? renderErrorSummary(maybeResult.render_error_doc)
        : null,
      lastModified:
        instanceEntry.last_modified != null
          ? parseInt(instanceEntry.last_modified)
          : null,
      resourceCreatedAt: parseInt(instanceEntry.resource_created_at),
    };
  }

  async getFile(
    url: URL,
    opts?: GetEntryOptions,
  ): Promise<IndexedFile | undefined> {
    let result = (await this.#query([
      `SELECT i.*, ${PRERENDERED_HTML_SELECTS}, ${EFFECTIVE_ERROR_SELECTS}`,
      `FROM ${tableFromOpts(opts)} as i ${prerenderedJoin(opts)}
       WHERE`,
      ...every([
        any([
          [`i.url =`, param(url.href)],
          [`i.file_alias =`, param(url.href)],
        ]),
        ['i.type =', param('file')],
        [`NOT ${effectiveHasError()}`],
        any([['i.is_deleted = FALSE'], ['i.is_deleted IS NULL']]),
      ]),
    ] as Expression)) as unknown as IndexRowWithHtml[];
    return this.#rowToIndexedFile(result[0]);
  }

  // Batch read of the file-meta link targets `loadLinks` side-loads — the
  // file leg of the same batch `getLinkTargetInstances` serves, narrow for the
  // same reason. A side-loaded file's resource is assembled from its stored
  // document, its search doc and its timestamps; the formats, the icon, the
  // display names and the dependency graph are all fetched and discarded by a
  // star select, and `deps` is the widest column on the row.
  //
  // Keys are the LOOKUP URLs the caller passed in (matching either `i.url` or
  // `i.file_alias`). As on the instance leg, only an index error keeps a file
  // out: a file whose render failed still has the data side-loading reads.
  async getLinkTargetFiles(
    urls: URL[],
    opts?: GetEntryOptions,
  ): Promise<Map<string, LinkTargetFile>> {
    let resultMap = new Map<string, LinkTargetFile>();
    if (urls.length === 0) {
      return resultMap;
    }
    let lookupHrefs = [...new Set(urls.map((u) => u.href))];
    // Same chunking discipline as getLinkTargetInstances — keeps placeholder count
    // safely below the sqlite/pg parameter limits.
    let chunkSize = this.#dbAdapter.kind === 'sqlite' ? 450 : 2500;
    for (let start = 0; start < lookupHrefs.length; start += chunkSize) {
      let chunk = lookupHrefs.slice(start, start + chunkSize);
      let chunkSet = new Set(chunk);
      let chunkParams = chunk.map((href) => [param(href)]);
      let rows = (await this.#query([
        // `ph.captures` is the join's only consumer: it is joined into the
        // side-loaded resource's `meta`.
        `SELECT i.url, i.file_alias, i.pristine_doc, i.search_doc, i.types,
                i.last_modified, i.resource_created_at, i.realm_url,
                ph.captures AS captures`,
        `FROM ${tableFromOpts(opts)} as i ${prerenderedJoin(opts)}
         WHERE`,
        ...every([
          any([
            ['i.url IN', ...addExplicitParens(separatedByCommas(chunkParams))],
            [
              'i.file_alias IN',
              ...addExplicitParens(separatedByCommas(chunkParams)),
            ],
          ]),
          ['i.type =', param('file')],
          [`NOT ${INDEX_HAS_ERROR}`],
          any([['i.is_deleted = FALSE'], ['i.is_deleted IS NULL']]),
        ]),
      ] as Expression)) as unknown as {
        url: string | null;
        file_alias: string | null;
        pristine_doc: FileMetaResource | null;
        search_doc: Record<string, any> | null;
        types: string[] | null;
        last_modified: string | number | null;
        resource_created_at: string | number | null;
        realm_url: string | null;
        captures: CaptureManifest | null;
      }[];
      await restoreSpilledSearchDocs(this.#dbAdapter, rows);
      for (let row of rows) {
        if (!row.url) {
          continue;
        }
        // Postgres hands back a bigint column as a string; SQLite as a number.
        let toEpoch = (v: string | number | null) =>
          typeof v === 'string' ? parseInt(v) : (v ?? null);
        let mapped: LinkTargetFile = {
          canonicalURL: row.url,
          resource: row.pristine_doc ?? null,
          searchDoc: row.search_doc ?? null,
          types: row.types ?? null,
          lastModified: toEpoch(row.last_modified),
          resourceCreatedAt: toEpoch(row.resource_created_at),
          realmURL: row.realm_url ?? '',
          captures: row.captures ?? null,
        };
        if (chunkSet.has(row.url)) {
          resultMap.set(row.url, mapped);
        }
        if (row.file_alias && chunkSet.has(row.file_alias)) {
          resultMap.set(row.file_alias, mapped);
        }
      }
    }
    return resultMap;
  }

  #rowToIndexedFile(
    maybeResult: IndexRowWithHtml | undefined,
  ): IndexedFile | undefined {
    if (!maybeResult) {
      return undefined;
    }
    if (maybeResult.is_deleted) {
      return undefined;
    }
    let {
      url: canonicalURL,
      pristine_doc: resource,
      search_doc: searchDoc,
      isolated_html: isolatedHtml,
      head_html: headHtml,
      embedded_html: embeddedHtml,
      fitted_html: fittedHtml,
      atom_html: atomHtml,
      icon_html: iconHtml,
      markdown,
      captures,
      generation,
      realm_url: realmURL,
      indexed_at: indexedAt,
      last_modified: lastModified,
      resource_created_at: resourceCreatedAt,
      deps,
      types,
      display_names: displayNames,
    } = maybeResult;
    generation =
      typeof generation === 'string' ? parseInt(generation) : (generation ?? 0);
    return {
      type: 'file',
      canonicalURL,
      searchDoc,
      resource: (resource as FileMetaResource | null) ?? null,
      types,
      displayNames,
      deps,
      isolatedHtml,
      headHtml,
      embeddedHtml,
      fittedHtml,
      atomHtml,
      iconHtml: iconHtml ?? null,
      markdown,
      captures: (captures as CaptureManifest | null) ?? null,
      lastModified: lastModified != null ? parseInt(lastModified) : null,
      resourceCreatedAt:
        resourceCreatedAt != null ? parseInt(resourceCreatedAt) : null,
      generation,
      realmURL,
      indexedAt: indexedAt != null ? parseInt(indexedAt) : null,
    };
  }

  async hasFileType(
    realmURL: URL,
    ref: CodeRef,
    opts?: GetEntryOptions,
  ): Promise<boolean> {
    if (!isResolvedCodeRef(ref)) {
      return false;
    }
    let typeKeys = await this.typeKeysFor(ref);
    let rows = (await this.#query([
      'SELECT 1',
      `FROM ${tableFromOpts(opts)} AS i`,
      'WHERE',
      ...every([
        ['i.realm_url =', param(realmURL.href)],
        ['i.type =', param('file')],
        any(typeKeys.map((typeKey) => [typesContains(typeKey)])),
      ]),
      'LIMIT 1',
    ] as Expression)) as unknown as { 1: number }[];
    return rows.length > 0;
  }

  async hasInstanceType(
    realmURL: URL,
    ref: CodeRef,
    opts?: GetEntryOptions,
  ): Promise<boolean> {
    if (!isResolvedCodeRef(ref)) {
      return false;
    }
    let typeKeys = await this.typeKeysFor(ref);
    let rows = (await this.#query([
      'SELECT 1',
      `FROM ${tableFromOpts(opts)} AS i`,
      'WHERE',
      ...every([
        ['i.realm_url =', param(realmURL.href)],
        ['i.type =', param('instance')],
        any(typeKeys.map((typeKey) => [typesContains(typeKey)])),
      ]),
      'LIMIT 1',
    ] as Expression)) as unknown as { 1: number }[];
    return rows.length > 0;
  }

  // The types a realm holds cards of that descend from `ref`: the first entry
  // of the adoption chain of every live instance row whose chain carries one
  // of the ref's keys, once each. A row of the ref's own type contributes its
  // own key. Rows whose visit failed count too, since a search that includes
  // errors can return them.
  async instanceTypesUnder(
    realmURL: URL,
    ref: ResolvedCodeRef,
  ): Promise<string[]> {
    let typeKeys = await this.typeKeysFor(ref);
    let rows = (await this.#query([
      'SELECT DISTINCT',
      dbExpression({
        pg: `i.types->>0`,
        sqlite: `json_extract(i.types, '$[0]')`,
      }),
      'AS type_key',
      'FROM boxel_index AS i',
      'WHERE',
      ...every([
        ['i.realm_url =', param(realmURL.href)],
        ['i.type =', param('instance')],
        any([['i.is_deleted = FALSE'], ['i.is_deleted IS NULL']]),
        any(typeKeys.map((typeKey) => [typesContains(typeKey)])),
      ]),
    ] as Expression)) as unknown as { type_key: string | null }[];
    return rows
      .map(({ type_key }) => type_key)
      .filter((key): key is string => typeof key === 'string')
      .sort();
  }

  private async getDefinition(codeRef: CodeRef): Promise<Definition> {
    if (!isResolvedCodeRef(codeRef)) {
      throw new Error(
        `Your filter refers to a nonexistent type: ${stringify(codeRef)}`,
      );
    }
    return await this.#definitionLookup.lookupDefinition(codeRef);
  }

  // we pass the loader in so there is no ambiguity which loader to use as this
  // client may be serving a live index or a WIP index that is being built up
  // which could have conflicting loaders. It is up to the caller to provide the
  // loader that we should be using.
  private async _search(
    realmURL: URL,
    { filter, sort, page, facets, collapse, let: lets, explain, rerank }: Query,
    opts: QueryOptions,
    selectClauseExpression: CardExpression,
    entryType: 'instance' | 'file' | 'all' = 'instance',
    // When set, the grouped projection is wrapped in an outer select so a
    // conditional live `pristine_doc` can reference the computed `html` column
    // once (see `search()`'s render branch). The inner projection must alias
    // its raw live serialization as `pristine_doc_fallback` and its HTML as
    // `html`.
    conditionalLiveDoc = false,
  ): Promise<{
    meta: QueryResultsMeta;
    results: Partial<IndexRowWithHtml>[];
  }> {
    if (rerank) {
      let reranked = await this.#reranked(
        realmURL,
        { filter, sort, page, facets, collapse, let: lets, rerank },
        opts,
        selectClauseExpression,
        entryType,
      );
      if (reranked) {
        return reranked;
      }
    }
    try {
      let letMeta: QueryResultsMeta['lets'];
      if (lets && Object.keys(lets).length) {
        ({ filter, sort, letMeta } = await this.#resolveLets(
          realmURL,
          lets,
          filter,
          sort,
          opts,
        ));
      }
      filter = await this.#resolveTypos(filter, realmURL);
      sort = await this.#expandRelevanceSorts(sort, filter);
      // A facet of plain values is counted with the page (one statement on
      // Postgres); any other shape, or one counted without its own
      // selection, gets its own queries (`#extendedFacet`).
      let requestedFacets = facets ?? [];
      let facetPlans = await this.#facetPlans(requestedFacets, filter);
      facets = facetPlans.filter((plan) => plan.plain).map((p) => p.facet);
      let conditions: CardExpression[] = [
        ['i.realm_url = ', param(realmURL.href)],
        ['i.is_deleted = FALSE OR i.is_deleted IS NULL'],
      ];

      // "not errored" spans both error channels (index + current render error),
      // matching the single-kind branches below — so a file row with a current
      // render error is excluded from the mixed scope too.
      let notErrored: CardExpression = [`NOT ${effectiveHasError()}`];
      if (entryType === 'all') {
        // Mixed scope. Instance rows follow `includeErrors` (their error
        // markup is rendered through the html branch); file rows are only
        // ever surfaced in a healthy state, so they always require
        // `has_error` false regardless of `includeErrors`.
        let instanceBranch: CardExpression = opts.includeErrors
          ? ['i.type =', param('instance')]
          : every([['i.type =', param('instance')], notErrored]);
        let fileBranch = every([['i.type =', param('file')], notErrored]);
        conditions.push(any([instanceBranch, fileBranch]));
      } else if (opts.includeErrors) {
        conditions.push(['i.type =', param(entryType)]);
      } else {
        conditions.push(every([['i.type =', param(entryType)], notErrored]));
      }

      // A card-instance `.json` is dual-indexed: an `instance` row and a
      // `file` row sharing the same `i.url`, distinguished only by `i.type`.
      // `GROUP BY i.url, i.type` (below) keeps them as two distinct rows so a
      // mixed query surfaces both; a consumer that wants to dedup the `file`
      // row filters on the `_isCardInstanceFile` search-doc key (stamped only on
      // that row) — e.g. `eq: { _isCardInstanceFile: false }` keeps cards + plain
      // files and drops the card `.json`.

      if (opts.cardUrls && opts.cardUrls.length > 0) {
        // Restrict to this URL subset. Instance rows key on their `.json` file
        // URL; file rows on their canonical file URL — the same `i.url` column,
        // so the filter applies to both projections (the single-instance
        // card+html / file-meta+html GET sources one entry this way).
        conditions.push([
          'i.url IN',
          ...addExplicitParens(
            separatedByCommas(opts.cardUrls.map((url) => [param(url)])),
          ),
        ]);
      }

      // Everything but the filter: the wide pass of a paged search reads its
      // page's rows under these alone (see `#pageRows`).
      let baseConditions = [...conditions];

      if (filter) {
        await this.#assertNearFilters(filter, baseCardRef);
        conditions.push(
          this.filterCondition(filter, baseCardRef, 'positive', {
            inAny: false,
            prerenderedTable: prerenderedTableFromOpts(opts),
            indexTable: tableFromOpts(opts),
          }),
        );
      }

      let everyCondition = every(conditions);
      let collapsed = collapseBy(collapse);
      let collapseOn = collapsed?.on ?? filterAnchor(filter);
      if (collapsed && !collapseOn) {
        throw new InvalidQueryError(
          `collapse by "${collapsed.by}" needs a type: give it \`on\` or anchor the filter on a type`,
        );
      }
      let limitClause = page
        ? [`LIMIT ${page.size} OFFSET ${(page.number ?? 0) * page.size}`]
        : [];

      // Full-text relevance is opt-in: computed only when the caller sorts by
      // `_matchRelevance`, so every existing `matches` caller pays nothing. When
      // present it rides the projection as an aggregated, aliased column that the
      // ORDER BY (below) references — see `matchRelevanceExpression`.
      let sortsByMatchRelevance = (sort ?? []).some(
        (s) =>
          isMatchRelevanceSort(s) ||
          (isBlendSort(s) && s.of.some(isMatchRelevanceSort)),
      );
      let relevanceColumn: CardExpression = [];
      if (sortsByMatchRelevance) {
        // `assertQuery` already rejects this on the wire surfaces (as an
        // HTTP 400); this re-check is the backstop for callers that reach the
        // engine directly.
        let matches = collectPositiveMatchTerms(filter);
        if (matches.length === 0) {
          throw new InvalidQueryError(
            `sort by "${MATCH_RELEVANCE_SORT_KEY}" requires at least one positive \`matches\` filter`,
          );
        }
        if ((sort ?? []).some(isMatchRelevanceSort)) {
          relevanceColumn = [
            ',',
            ...this.matchRelevanceExpression(
              matches,
              opts?.pendingStagingId !== undefined,
            ),
          ];
        }
      }
      let { nearColumns, nearJoins } = await this.#nearSortExpressions(sort);
      let { blendColumns, blendJoins } = await this.#blendSortExpressions(
        sort,
        sortsByMatchRelevance ? collectPositiveMatchTerms(filter) : [],
        opts?.pendingStagingId !== undefined,
        {
          inAny: false,
          prerenderedTable: prerenderedTableFromOpts(opts),
          indexTable: tableFromOpts(opts),
        },
        Boolean(explain),
      );
      relevanceColumn = [...relevanceColumn, ...nearColumns, ...blendColumns];
      nearJoins = [...nearJoins, ...blendJoins];

      let query: CardExpression;
      if (conditionalLiveDoc) {
        // Outer-wrap the grouped projection so the conditional `pristine_doc`
        // references the already-computed `html` column rather than recomputing
        // the HTML expression. Sort keys are exposed by the inner query and the
        // outer ORDER BY applies them (plus the `url` tiebreaker), so ordering
        // and paging match the unwrapped path.
        let { innerSortColumns, outerOrderBy } =
          this.#wrappedOrderExpression(sort);
        query = [
          'SELECT sub.*,',
          'CASE WHEN sub.html IS NULL THEN sub.pristine_doc_fallback END as pristine_doc',
          'FROM (',
          ...selectClauseExpression,
          ...relevanceColumn,
          ...innerSortColumns,
          `FROM ${tableFromOpts(opts)} AS i ${prerenderedJoin(opts)}`,
          ...nearJoins,
          tableValuedFunctionsPlaceholder,
          'WHERE',
          ...everyCondition,
          'GROUP BY i.url, i.type',
          ') AS sub',
          ...outerOrderBy,
          ...limitClause,
        ];
      } else {
        query = [
          ...selectClauseExpression,
          ...relevanceColumn,
          `FROM ${tableFromOpts(opts)} AS i ${prerenderedJoin(opts)}`,
          ...nearJoins,
          tableValuedFunctionsPlaceholder,
          'WHERE',
          ...everyCondition,
          'GROUP BY i.url, i.type',
          ...this.orderExpression(sort),
          ...limitClause,
        ];
      }
      // Count over the same tables as the data query (via `opts`) so `total`
      // stays consistent with the result set — including in WIP mode and for a
      // `matches` predicate, which is shared with the data query through
      // `everyCondition` and references `ph.markdown`. Count distinct
      // `(url, type)` pairs to match the `GROUP BY i.url, i.type` grouping — a
      // dual-indexed card `.json` contributes both its `instance` and `file`
      // row. Expressed as a `COUNT(*)` over a `DISTINCT` subquery because
      // SQLite's `COUNT(DISTINCT …)` takes only a single expression.
      let queryCount = [
        'SELECT COUNT(*) AS total FROM (',
        'SELECT DISTINCT i.url, i.type',
        `FROM ${tableFromOpts(opts)} AS i ${prerenderedJoin(
          opts,
        )} ${tableValuedFunctionsPlaceholder}`,
        'WHERE',
        ...everyCondition,
        ') AS distinct_entries',
      ];

      let facetQueries = () =>
        (facets ?? []).map((facet) =>
          this.#facetQuery(facet, opts, everyCondition),
        );
      let results: Record<string, unknown>[];
      let totalResults: Record<string, unknown>[];
      let facetResults: unknown[];
      if (collapsed && collapseOn && !conditionalLiveDoc) {
        // Collapsed: the narrow pass keeps each group's best rows by the
        // query's own order, then orders, counts and pages what remains.
        // Facets count every match, so they run on their own.
        let keys: Record<string, unknown>[];
        [keys, ...facetResults] = await Promise.all([
          this.#queryCards(
            this.#collapsedNarrowPass({
              opts,
              sort,
              collapse: {
                by: collapsed.by,
                on: collapseOn,
                keep: collapsed.keep,
              },
              relevanceColumn,
              nearJoins,
              everyCondition,
              limitClause,
            }),
            opts.timings,
          ),
          ...facetQueries().map((q) => this.#queryCards(q, opts.timings)),
        ]);
        if (keys.length > 0) {
          totalResults = [{ total: keys[0].__page_total }];
        } else {
          let [row] = await this.#queryCards(
            this.#collapsedNarrowPass({
              opts,
              sort: undefined,
              collapse: {
                by: collapsed.by,
                on: collapseOn,
                keep: collapsed.keep,
              },
              relevanceColumn: [],
              nearJoins: [],
              everyCondition,
              limitClause: [],
              countOnly: true,
            }),
            opts.timings,
          );
          totalResults = [{ total: row?.total ?? 0 }];
        }
        results =
          keys.length > 0
            ? await this.#pageRows(
                keys,
                selectClauseExpression,
                baseConditions,
                opts,
              )
            : [];
      } else if (page && !conditionalLiveDoc) {
        // A paged search runs as a narrow pass then a wide one. The narrow
        // pass evaluates the filter once and returns only each match's key, its
        // sort values and the synthetic sort columns, ordered and limited to
        // the page, with the match count taken in the same pass by a window
        // function (evaluated over every group, before the LIMIT). On Postgres
        // it counts the facets in the same statement too, from the same match
        // set. The wide pass reads the projection's large columns
        // (`pristine_doc`, the HTML maps) for the page's rows alone, by key,
        // without the filter.
        //
        // In one pass the projection's `ANY_VALUE(...)` columns are aggregated
        // for every match before the sort keeps a page, so a 24-row shelf over
        // 6,000 matches detoasted 6,000 documents; and the COUNT query and each
        // facet's query evaluated the whole filter again.
        let keys: Record<string, unknown>[];
        let pgFacets = this.#dbAdapter.kind === 'pg';
        if (pgFacets) {
          keys = await this.#queryCards(
            this.#narrowPassWithFacets({
              opts,
              sort,
              facets: facets ?? [],
              relevanceColumn,
              nearJoins,
              everyCondition,
              limitClause,
            }),
            opts.timings,
          );
          facetResults = [];
        } else {
          let keyQuery: CardExpression = [
            'SELECT i.url AS url, i.type AS type, COUNT(*) OVER () AS __page_total',
            ...relevanceColumn,
            `FROM ${tableFromOpts(opts)} AS i ${prerenderedJoin(opts)}`,
            ...nearJoins,
            tableValuedFunctionsPlaceholder,
            'WHERE',
            ...everyCondition,
            'GROUP BY i.url, i.type',
            ...this.orderExpression(sort),
            ...limitClause,
          ];
          [keys, ...facetResults] = await Promise.all([
            this.#queryCards(keyQuery, opts.timings),
            ...facetQueries().map((q) => this.#queryCards(q, opts.timings)),
          ]);
        }
        if (keys.length > 0) {
          totalResults = [{ total: keys[0].__page_total }];
          if (pgFacets) {
            facetResults = facetCountsFromColumn(
              keys[0].__facets,
              (facets ?? []).length,
            );
          }
        } else if ((page.number ?? 0) === 0 && Number(page.size) > 0) {
          // No match: no count, and every facet is empty. A counts-only page
          // (`size: 0`) returns no row whether or not anything matched, so it
          // takes the fallback below.
          totalResults = [{ total: 0 }];
          if (pgFacets) {
            facetResults = (facets ?? []).map(() => []);
          }
        } else {
          // A page past the last match has no row to carry the count (or, on
          // Postgres, the facets), so they come from their own queries.
          let fallbacks = await Promise.all([
            this.#queryCards(queryCount, opts.timings),
            ...(pgFacets
              ? facetQueries().map((q) => this.#queryCards(q, opts.timings))
              : []),
          ]);
          totalResults = fallbacks[0];
          if (pgFacets) {
            facetResults = fallbacks.slice(1);
          }
        }
        results =
          keys.length > 0
            ? await this.#pageRows(
                keys,
                selectClauseExpression,
                baseConditions,
                opts,
              )
            : [];
      } else {
        // Unpaged: every match is a row, so the rows are the count.
        [results, ...facetResults] = await Promise.all([
          this.#queryCards(query, opts.timings),
          ...facetQueries().map((q) => this.#queryCards(q, opts.timings)),
        ]);
        totalResults = [{ total: results.length }];
      }
      // A projection that returns `search_doc` (file rows) returns it whole.
      await restoreSpilledSearchDocs(this.#dbAdapter, results);
      if (explain) {
        explainRows(results, sort);
      }

      let filterContext: FilterContext = {
        inAny: false,
        prerenderedTable: prerenderedTableFromOpts(opts),
        indexTable: tableFromOpts(opts),
      };
      let extendedPlans = facetPlans.filter((plan) => !plan.plain);
      let extendedResults = await Promise.all(
        extendedPlans.map((plan) => {
          let condition = everyCondition;
          if (plan.facet.own === 'ignore') {
            let rest = filter
              ? filterWithout(filter, plan.facet.by)
              : undefined;
            condition = every([
              ...baseConditions,
              ...(rest
                ? [
                    this.filterCondition(
                      rest,
                      baseCardRef,
                      'positive',
                      filterContext,
                    ),
                  ]
                : []),
            ]);
          }
          return this.#extendedFacet(plan, opts, condition);
        }),
      );
      let plainCounts = new Map<string, FacetCount[]>(
        (facets ?? []).map((facet, i) => [
          facet.by,
          (facetResults[i] as { value: unknown; count: unknown }[])
            .filter((row) => row.value != null)
            .map(
              (row): FacetCount => ({
                value: String(row.value),
                count: Number(row.count),
              }),
            ),
        ]),
      );
      let extendedByFacet = new Map(
        extendedPlans.map((plan, i) => [plan.facet, extendedResults[i]]),
      );
      let facetStats: Record<string, FacetStats> = {};
      for (let [facet, result] of extendedByFacet) {
        if (result.stats) {
          facetStats[facet.by] = result.stats;
        }
      }

      let passageTerms = collectPositiveMatchTerms(filter).filter(
        (m) => m.within,
      );
      let passages = await this.#pagePassages(
        realmURL,
        passageTerms,
        results
          .map((row) => row.url)
          .filter((url): url is string => typeof url === 'string'),
      );

      return {
        results,
        meta: {
          page: { total: Number(totalResults[0].total) },
          ...(passages ? { passages } : {}),
          ...(requestedFacets.length
            ? {
                facets: Object.fromEntries(
                  requestedFacets.map((facet) => [
                    facet.by,
                    extendedByFacet.get(facet)?.counts ??
                      plainCounts.get(facet.by) ??
                      [],
                  ]),
                ),
              }
            : {}),
          ...(Object.keys(facetStats).length ? { facetStats } : {}),
          ...(letMeta ? { lets: letMeta } : {}),
        },
      };
    } catch (error) {
      if (isFilterRefersToNonexistentTypeError(error)) {
        return {
          results: [],
          meta: {
            page: { total: 0 },
          },
        };
      }
      throw error;
    }
  }

  // The wide pass of a paged search: the projection for the rows the narrow
  // pass chose, in its order, each carrying the synthetic columns
  // (`_matchRelevance`, `_nearSimilarity`, `_blendScore`) the narrow pass
  // computed over the whole match set. Those are not recomputed here: a blend
  // ranks each signal across every match, so it cannot be recomputed over the
  // page. The filter is not applied either; the rows are known to match it,
  // and `baseConditions` keeps the realm, deletion and entry-kind rules. A row
  // deleted between the passes is dropped from the page.
  async #pageRows(
    keys: Record<string, unknown>[],
    selectClauseExpression: CardExpression,
    baseConditions: CardExpression[],
    opts: QueryOptions,
  ): Promise<Record<string, unknown>[]> {
    let urls = [...new Set(keys.map((key) => String(key.url)))];
    let rows = (await this.#queryCards(
      [
        ...selectClauseExpression,
        ', i.type AS __page_type',
        `FROM ${tableFromOpts(opts)} AS i ${prerenderedJoin(opts)}`,
        'WHERE',
        ...every([
          ...baseConditions,
          [
            'i.url IN',
            ...addExplicitParens(
              separatedByCommas(urls.map((url) => [param(url)])),
            ),
          ],
        ]),
        'GROUP BY i.url, i.type',
      ],
      opts.timings,
    )) as Record<string, unknown>[];
    let byKey = new Map(
      rows.map((row) => [`${row.__page_type} ${row.url}`, row]),
    );
    let page: Record<string, unknown>[] = [];
    for (let key of keys) {
      let row = byKey.get(`${key.type} ${key.url}`);
      if (!row) {
        continue;
      }
      let { __page_type: _type, ...columns } = row;
      // The key row's own columns are the synthetic sort columns, plus the
      // narrow pass's bookkeeping, which stays behind: its key, the total, the
      // facets, the per-facet values, and the sort keys it ordered by.
      let synthetic = Object.fromEntries(
        Object.entries(key).filter(
          ([name]) =>
            name !== 'url' &&
            name !== 'type' &&
            !name.startsWith('__') &&
            !/^_sort_\d+$/.test(name),
        ),
      );
      page.push({ ...columns, ...synthetic });
    }
    return page;
  }

  // The narrow pass on Postgres, with the page's facets counted in the same
  // statement. The match set is one materialized CTE: the filter runs once,
  // and the same scan reads each requested facet's value from the row it is
  // already on (`spill_unmark`, so a spilled value counts too). The outer
  // query orders and limits the page and carries the total and every facet's
  // counts as columns, computed once over the whole set. Each facet keeps the
  // semantics of `#facetQuery`: a match counts once per distinct value it
  // holds, a list contributes each element, nulls are left out, and the
  // largest counts come first, ties by value.
  #narrowPassWithFacets({
    opts,
    sort,
    facets,
    relevanceColumn,
    nearJoins,
    everyCondition,
    limitClause,
  }: {
    opts: QueryOptions;
    sort: Sort | undefined;
    facets: Facet[];
    relevanceColumn: CardExpression;
    nearJoins: CardExpression;
    everyCondition: CardExpression;
    limitClause: string[];
  }): CardExpression {
    let { innerSortColumns, outerOrderBy } = this.#wrappedOrderExpression(sort);
    let facetColumns: CardExpression = [];
    facets.forEach((facet, index) => {
      facetColumns.push(
        ', ANY_VALUE(spill_unmark(i.search_doc #>',
        param(
          `{${facet.by
            .split('.')
            .map((p) => `"${p}"`)
            .join(',')}}`,
        ),
        `::text[])) AS __facet_${index}`,
      );
    });
    let facetCounts: CardExpression = [];
    if (facets.length > 0) {
      let values = facets
        .map((_, index) => `(${index}, m.__facet_${index})`)
        .join(', ');
      let sizes = facets
        .map(
          (facet, index) =>
            `WHEN ${index} THEN ${Number(facet.size ?? DEFAULT_FACET_SIZE)}`,
        )
        .join(' ');
      facetCounts = [
        ', (SELECT jsonb_object_agg(fc.facet, fc.counts) FROM (',
        "SELECT x.facet, jsonb_agg(jsonb_build_object('value', x.value, 'count', x.count) ORDER BY x.count DESC, x.value) AS counts FROM (",
        'SELECT c.facet, c.value, c.count, ROW_NUMBER() OVER (PARTITION BY c.facet ORDER BY c.count DESC, c.value) AS rn FROM (',
        'SELECT d.facet, e.value, COUNT(*) AS count FROM m',
        `CROSS JOIN LATERAL (VALUES ${values}) AS d(facet, v)`,
        `CROSS JOIN LATERAL (SELECT DISTINCT t.value FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(d.v) = 'array' THEN d.v ELSE jsonb_build_array(d.v) END) AS t(value)) AS e`,
        'WHERE e.value IS NOT NULL',
        'GROUP BY d.facet, e.value',
        `) AS c) AS x WHERE x.rn <= CASE x.facet ${sizes} END`,
        'GROUP BY x.facet) AS fc) AS __facets',
      ];
    }
    return [
      'WITH m AS MATERIALIZED (',
      'SELECT i.url AS url, i.type AS type',
      ...relevanceColumn,
      ...innerSortColumns,
      ...facetColumns,
      `FROM ${tableFromOpts(opts)} AS i ${prerenderedJoin(opts)}`,
      ...nearJoins,
      tableValuedFunctionsPlaceholder,
      'WHERE',
      ...everyCondition,
      'GROUP BY i.url, i.type',
      ')',
      'SELECT m.*, COUNT(*) OVER () AS __page_total',
      ...facetCounts,
      'FROM m',
      ...outerOrderBy,
      ...limitClause,
    ];
  }

  // A `rerank`: the query's first `top` rows, ordered by a BXL formula over
  // each row's search doc, then the page of that order. Undefined when the
  // page lies past the window, so the query runs in its own order.
  async #reranked(
    realmURL: URL,
    query: Query,
    opts: QueryOptions,
    selectClauseExpression: CardExpression,
    entryType: 'instance' | 'file' | 'all',
  ): Promise<
    { meta: QueryResultsMeta; results: Partial<IndexRowWithHtml>[] } | undefined
  > {
    let rerank = query.rerank!;
    let top = Math.min(rerank.top ?? DEFAULT_RERANK_TOP, MAX_RERANK_TOP);
    let start = query.page ? (query.page.number ?? 0) * query.page.size : 0;
    if (query.page && start >= top) {
      return undefined;
    }
    let candidates = await this._search(
      realmURL,
      {
        filter: query.filter,
        sort: query.sort,
        page: { number: 0, size: top },
        facets: query.facets,
        collapse: query.collapse,
        let: query.let,
      },
      opts,
      [
        'SELECT i.url AS url, ANY_VALUE(i.type) AS type, ANY_VALUE(i.search_doc) AS search_doc',
      ],
      entryType,
    );
    let rows = candidates.results as {
      url: string;
      type?: string;
      search_doc?: unknown;
    }[];
    let docs = rows.map((row) => {
      let doc = row.search_doc;
      if (typeof doc === 'string') {
        try {
          doc = JSON.parse(doc);
        } catch {
          doc = {};
        }
      }
      return (doc ?? {}) as Record<string, unknown>;
    });
    let set = await this.#comparisonSet(realmURL, query, opts, entryType);
    let inputs = set
      ? docs.map((doc) => {
          let group = set!.groups.get(groupKey(doc, query.rerank!.compare?.by));
          return {
            ...doc,
            peers: group?.peers ?? {},
            stats: group?.stats ?? {},
          };
        })
      : docs;
    let values = await scoreWithBxl(rerank.expr, inputs);
    let direction = rerank.direction === 'asc' ? 1 : -1;
    let order = rows
      .map((row, index) => ({ row, index, value: values[index] }))
      .sort((a, b) => {
        if (a.value == null || b.value == null) {
          return a.value == null && b.value == null
            ? a.index - b.index
            : a.value == null
              ? 1
              : -1;
        }
        return (a.value - b.value) * direction || a.index - b.index;
      });
    let window = query.page
      ? order.slice(start, start + query.page.size)
      : order;
    let results: Partial<IndexRowWithHtml>[] = [];
    if (window.length > 0) {
      let { results: page } = await this._search(
        realmURL,
        {},
        { ...opts, cardUrls: [...new Set(window.map((w) => w.row.url))] },
        selectClauseExpression,
        entryType,
      );
      let byKey = new Map(
        page.map((r) => [`${(r as any).type ?? ''} ${(r as any).url}`, r]),
      );
      for (let w of window) {
        let row =
          byKey.get(`${w.row.type ?? ''} ${w.row.url}`) ??
          page.find((r) => (r as any).url === w.row.url);
        if (row) {
          results.push({
            ...row,
            [RERANK_KEY]: w.value,
          } as Partial<IndexRowWithHtml>);
        }
      }
    }
    return {
      results,
      meta: {
        ...candidates.meta,
        rerank: {
          window: rows.length,
          scored: values.filter((v) => v != null).length,
        },
      },
    };
  }

  // A rerank's comparison set, when its formula reads `peers.` or `stats.`:
  // the fields it names, read as numbers from every row of the set (the
  // query's matches, or `compare.filter`'s), grouped by `compare.by`.
  async #comparisonSet(
    realmURL: URL,
    query: Query,
    opts: QueryOptions,
    entryType: 'instance' | 'file' | 'all',
  ): Promise<
    | {
        groups: Map<
          string,
          {
            peers: Record<string, number[]>;
            stats: Record<string, Record<string, number | null>>;
          }
        >;
      }
    | undefined
  > {
    let rerank = query.rerank!;
    let fields = [
      ...new Set(
        [...rerank.expr.matchAll(/\b(?:peers|stats)\.([A-Za-z_$][\w$]*)/g)].map(
          (m) => m[1],
        ),
      ),
    ];
    if (fields.length === 0) {
      return undefined;
    }
    if (this.#dbAdapter.kind !== 'pg') {
      throw new InvalidQueryError(
        'rerank: a comparison set (peers. or stats.) runs on Postgres only',
      );
    }
    let path = (p: string) => `'{${p.split('.').join(',')}}'::text[]`;
    let columns = fields
      .map(
        (f, i) =>
          `ANY_VALUE(CASE jsonb_typeof(spill_unmark(i.search_doc #> ${path(f)})) WHEN 'number' THEN (spill_unmark(i.search_doc #> ${path(f)}) #>> '{}')::double precision END) AS c${i}`,
      )
      .join(', ');
    let by = rerank.compare?.by;
    let group = by
      ? `, ANY_VALUE(spill_unmark(i.search_doc #> ${path(by)}) #>> '{}') AS g`
      : '';
    let { results } = await this._search(
      realmURL,
      { filter: rerank.compare?.filter ?? query.filter, let: query.let },
      { ...opts, cardUrls: undefined },
      [`SELECT i.url AS url, ${columns}${group}`],
      entryType,
    );
    let values = new Map<string, number[][]>();
    for (let row of results as Record<string, unknown>[]) {
      let key = by ? String(row.g ?? '') : '';
      let lists = values.get(key) ?? fields.map(() => [] as number[]);
      fields.forEach((_f, i) => {
        let v = row[`c${i}`];
        if (v != null && Number.isFinite(Number(v))) lists[i].push(Number(v));
      });
      values.set(key, lists);
    }
    let groups = new Map<
      string,
      {
        peers: Record<string, number[]>;
        stats: Record<string, Record<string, number | null>>;
      }
    >();
    for (let [key, lists] of values) {
      groups.set(key, {
        peers: Object.fromEntries(
          fields.map((f, i) => [f, lists[i].slice(0, MAX_PEER_VALUES)]),
        ),
        stats: Object.fromEntries(
          fields.map((f, i) => [f, summarize(lists[i])]),
        ),
      });
    }
    return { groups };
  }

  // An `_expr` sort's formula as SQL over the row's search doc. Postgres
  // only: the score profile lowers to Postgres functions.
  #exprSql(expr: string): string {
    if (this.#dbAdapter.kind !== 'pg') {
      throw new InvalidQueryError(
        `sort by "${EXPR_SORT_KEY}" runs on Postgres only`,
      );
    }
    return exprSortSql(expr);
  }

  // A query's `let` bindings, resolved before it is planned. A binding that
  // names one card by id and selects a link field's ids, read only by `in`s
  // on `id`, becomes `linkedFrom` and joins in the same statement. Any other
  // runs its own query over this realm first, and its selected values stand
  // in for each `"$name"`.
  async #resolveLets(
    realmURL: URL,
    lets: Record<string, LetBinding>,
    filter: Filter | undefined,
    sort: Sort | undefined,
    opts: QueryOptions,
  ): Promise<{
    filter: Filter | undefined;
    sort: Sort | undefined;
    letMeta: NonNullable<QueryResultsMeta['lets']>;
  }> {
    let letMeta: NonNullable<QueryResultsMeta['lets']> = {};
    let readBy = new Map<string, Set<string>>();
    mapLetReferences({ filter, sort }, (field, name, node) => {
      let fields = readBy.get(name) ?? new Set<string>();
      fields.add(field);
      readBy.set(name, fields);
      return node;
    });
    let resolved = new Map<
      string,
      { join: { card: string; field: string } } | { values: JSONTypes.Value[] }
    >();
    for (let [name, binding] of Object.entries(lets)) {
      if (!readBy.has(name)) {
        continue;
      }
      let join = joinableLet(binding);
      if (join && [...readBy.get(name)!].every((field) => field === 'id')) {
        resolved.set(name, { join });
        letMeta[name] = { strategy: 'join' };
        continue;
      }
      let values = await this.#letValues(realmURL, binding, opts);
      resolved.set(name, { values });
      letMeta[name] = { strategy: 'list', values: values.length };
    }
    let out = mapLetReferences({ filter, sort }, (field, name, node) => {
      let r = resolved.get(name)!;
      let on = node.on ? { on: node.on } : {};
      return 'join' in r
        ? ({ ...on, linkedFrom: r.join } as Filter)
        : ({ ...on, in: { [field]: r.values } } as Filter);
    });
    return { filter: out.filter, sort: out.sort, letMeta };
  }

  // A binding's values: its query's rows over this realm, read at `select`
  // in each row's search doc. A list contributes each value and a link its
  // id; nulls are dropped and the values deduplicated.
  async #letValues(
    realmURL: URL,
    binding: LetBinding,
    opts: QueryOptions,
  ): Promise<JSONTypes.Value[]> {
    let { results } = await this._search(
      realmURL,
      {
        filter: binding.from.filter,
        sort: binding.from.sort,
        page: {
          size: Math.min(binding.from.page?.size ?? MAX_LET_ROWS, MAX_LET_ROWS),
        },
      },
      { ...opts, cardUrls: undefined },
      ['SELECT i.url AS url, ANY_VALUE(i.search_doc) AS search_doc'],
      'instance',
    );
    let seen = new Set<string>();
    let values: JSONTypes.Value[] = [];
    let collect = (value: unknown, path: string[]) => {
      if (value == null || values.length >= MAX_LET_VALUES) {
        return;
      }
      if (Array.isArray(value)) {
        value.forEach((v) => collect(v, path));
        return;
      }
      if (path.length > 0) {
        if (typeof value === 'object') {
          collect((value as Record<string, unknown>)[path[0]], path.slice(1));
        }
        return;
      }
      let leaf =
        typeof value === 'object'
          ? (value as Record<string, unknown>).id
          : value;
      if (leaf == null || typeof leaf === 'object') {
        return;
      }
      let key = JSON.stringify(leaf);
      if (!seen.has(key)) {
        seen.add(key);
        values.push(leaf as JSONTypes.Value);
      }
    };
    for (let row of results) {
      let doc = (row as { search_doc?: unknown }).search_doc;
      if (typeof doc === 'string') {
        try {
          doc = JSON.parse(doc);
        } catch {
          continue;
        }
      }
      collect(doc, binding.select.split('.'));
    }
    return values;
  }

  // The narrow pass of a collapsed search: every match's key and sort
  // values, as in a paged search, plus its group's value at `collapse.by`.
  // Each group keeps its best `keep` rows by the query's order (a match with
  // no value is a group of its own), and the total counts what is kept.
  #collapsedNarrowPass({
    opts,
    sort,
    collapse,
    relevanceColumn,
    nearJoins,
    everyCondition,
    limitClause,
    countOnly = false,
  }: {
    opts: QueryOptions;
    sort: Sort | undefined;
    collapse: { by: string; on: CodeRef; keep: number };
    relevanceColumn: CardExpression;
    nearJoins: CardExpression;
    everyCondition: CardExpression;
    limitClause: string[];
    countOnly?: boolean;
  }): CardExpression {
    let { innerSortColumns, outerOrderBy } = this.#wrappedOrderExpression(sort);
    let kept: CardExpression = [
      'WITH m AS (',
      'SELECT i.url AS url, i.type AS type',
      ...relevanceColumn,
      ...innerSortColumns,
      ', ANY_VALUE(',
      fieldQuery(collapse.by, collapse.on, false, 'sort'),
      ') AS __collapse',
      `FROM ${tableFromOpts(opts)} AS i ${prerenderedJoin(opts)}`,
      ...nearJoins,
      tableValuedFunctionsPlaceholder,
      'WHERE',
      ...everyCondition,
      'GROUP BY i.url, i.type',
      '), c AS (',
      'SELECT m.*, ROW_NUMBER() OVER (PARTITION BY COALESCE(CAST(m.__collapse AS TEXT), m.url)',
      ...outerOrderBy,
      ') AS __collapse_rank FROM m',
      ')',
    ];
    if (countOnly) {
      return [
        ...kept,
        `SELECT COUNT(*) AS total FROM c WHERE c.__collapse_rank <= ${Number(collapse.keep)}`,
      ];
    }
    return [
      ...kept,
      'SELECT c.*, COUNT(*) OVER () AS __page_total FROM c',
      `WHERE c.__collapse_rank <= ${Number(collapse.keep)}`,
      ...outerOrderBy,
      ...limitClause,
    ];
  }

  // Projection-parametrized instance search. `_search` builds the shared query
  // core (WHERE / GROUP BY url / ORDER / LIMIT); this method varies only the
  // SELECT list by projection. `searchCards` and `searchPrerendered` are thin
  // wrappers, each fixing one projection.
  async search(
    realmURL: URL,
    { filter, sort, page, facets, collapse, let: lets, explain, rerank }: Query,
    opts: QueryOptions,
    projection: SearchProjection,
    // 'all' searches both `instance` and `file` rows in one query (kind is
    // discriminated by the caller's filter, with the card-instance `.json`
    // exclusion applied); 'file' pins file rows only; the file columns needed
    // to synthesize a file row's resource + renderings ride the projection when
    // file rows are in scope. Defaults to instance-only so `searchCards` and
    // other single-kind callers are unchanged.
    entryType: 'instance' | 'file' | 'all' = 'instance',
  ): Promise<{
    meta: QueryResultsMeta;
    results: (Partial<IndexRowWithHtml> & {
      html?: string | null;
      used_render_type?: string | null;
      // The rendering generation (`prerendered_html.generation`; NULL when no
      // prerendered row exists) — distinct from `generation`, the entry's
      // index-data generation.
      html_generation?: number | null;
    })[];
  }> {
    // File-only columns the assembly loop reads to build a `file` row's
    // resource + native renderings. Each is gated on `i.type = 'file'` so a
    // mixed query never drags a card row's (potentially multi-megabyte)
    // `search_doc` — the only large column in this fragment: within a
    // `(url, type)` group the type is constant, so the CASE yields the value
    // for a file group and NULL for an instance group (which the assembly loop
    // ignores — it only calls `fileEntryFromResult` on `file` rows). Appended
    // to either projection only when file rows are in scope.
    let fileOnly = (col: string) =>
      `ANY_VALUE(CASE WHEN i.type = 'file' THEN ${col} END)`;
    // Only the columns the file-row assembly actually reads
    // (`fileResourceFromIndex` + `fileEntryFromResult`): the row's search_doc,
    // timestamps, realm, and index generation. `markdown` is deliberately NOT
    // here — nothing in the file-meta resource or its renderings reads it, and
    // it can be multi-megabyte. `isolated_html` is a rendering column served to
    // file renderings too (`enumerateFileRenderings`), so it rides the shared
    // `renderSet` projection alongside the other per-format HTML columns rather
    // than this file-only fragment. The standalone `searchFiles` projection
    // (below) still carries both for its own consumers.
    let fileColumns = `, ${fileOnly('i.search_doc')} as search_doc, ${fileOnly(
      'i.last_modified',
    )} as last_modified, ${fileOnly(
      'i.resource_created_at',
    )} as resource_created_at, ${fileOnly('i.realm_url')} as realm_url, ${fileOnly(
      'i.indexed_at',
    )} as indexed_at`;
    let selectClauseExpression: CardExpression;
    if (projection.kind === 'dataOnly') {
      // The live serialization only — no rendered HTML entries (dataOnly).
      // When file rows are in scope, also carry the columns the file-row
      // assembly reads to synthesize each file's `file-meta` resource + type
      // descriptor. The effective error columns fold in current render errors
      // from the prerendered_html channel.
      let dataOnly = `SELECT i.url AS url, ANY_VALUE(i.type) as type, ANY_VALUE(${effectiveHasError()}) as has_error, ANY_VALUE(i.pristine_doc) as pristine_doc, ANY_VALUE(${effectiveErrorDoc()}) as error_doc, ANY_VALUE(i.generation) as generation`;
      selectClauseExpression =
        entryType !== 'instance'
          ? [
              `${dataOnly}, ANY_VALUE(i.types) as types, ANY_VALUE(i.display_names) as display_names, ANY_VALUE(ph.deps) as deps, ANY_VALUE(i.icon_html) as icon_html${fileColumns}`,
            ]
          : [dataOnly];
    } else {
      // The full rendering set: every per-format HTML column whole (the
      // fitted/embedded JSONB maps keyed by render type, the scalar
      // atom/head/isolated columns), plus the live serialization on every row.
      // The caller enumerates candidate renderings and selects from the set.
      // HTML, the deps that carry its scoped-CSS URLs, and the rendering
      // generation all come from the prerendered_html channel (`ph`); a row
      // with no prerendered row reads them as NULL and falls back to its
      // `item` serialization.
      let renderSet = `SELECT i.url AS url, ANY_VALUE(i.type) as type, ANY_VALUE(${effectiveHasError()}) as has_error, ANY_VALUE(i.file_alias) as file_alias, ANY_VALUE(ph.fitted_html) as fitted_html, ANY_VALUE(ph.embedded_html) as embedded_html, ANY_VALUE(ph.atom_html) as atom_html, ANY_VALUE(ph.head_html) as head_html, ANY_VALUE(ph.isolated_html) as isolated_html, ANY_VALUE(i.types) as types, ANY_VALUE(ph.deps) as deps, ANY_VALUE(i.display_names) as display_names, ANY_VALUE(i.icon_html) as icon_html, ANY_VALUE(${effectiveErrorDoc()}) as error_doc, ANY_VALUE(i.pristine_doc) as pristine_doc, ANY_VALUE(i.generation) as generation, ANY_VALUE(ph.generation) as html_generation`;
      selectClauseExpression =
        entryType !== 'instance' ? [`${renderSet}${fileColumns}`] : [renderSet];
    }

    return (await this._search(
      realmURL,
      { filter, sort, page, facets, collapse, let: lets, explain, rerank },
      opts,
      selectClauseExpression,
      entryType,
    )) as {
      meta: QueryResultsMeta;
      results: (Partial<IndexRowWithHtml> & {
        html?: string | null;
        used_render_type?: string | null;
      })[];
    };
  }

  async searchCards(
    realmURL: URL,
    { filter, sort, page, facets, collapse, let: lets, explain, rerank }: Query,
    opts: QueryOptions = {},
    // TODO this should be returning a CardCollectionDocument--handle that in
    // subsequent PR where we start storing card documents in "pristine_doc"
  ): Promise<{ cards: CardResource[]; meta: QueryResultsMeta }> {
    let { results, meta } = await this.search(
      realmURL,
      { filter, sort, page, facets, collapse, let: lets, explain, rerank },
      opts,
      { kind: 'dataOnly' },
    );

    let cards = results
      .map((r) => r.pristine_doc)
      .filter(Boolean) as CardResource[];

    return { cards, meta };
  }

  async searchFiles(
    realmURL: URL,
    { filter, sort, page, facets, collapse, let: lets, explain, rerank }: Query,
    opts: QueryOptions = {},
  ): Promise<{ files: IndexedFile[]; meta: QueryResultsMeta }> {
    let { results, meta } = await this._search(
      realmURL,
      { filter, sort, page, facets, collapse, let: lets, explain, rerank },
      opts,
      [
        `SELECT i.url AS url, ANY_VALUE(i.pristine_doc) AS pristine_doc, ANY_VALUE(i.search_doc) AS search_doc, ANY_VALUE(i.types) AS types, ANY_VALUE(i.display_names) AS display_names, ANY_VALUE(ph.deps) AS deps, ANY_VALUE(i.last_modified) AS last_modified, ANY_VALUE(i.resource_created_at) AS resource_created_at, ANY_VALUE(ph.isolated_html) AS isolated_html, ANY_VALUE(ph.head_html) AS head_html, ANY_VALUE(ph.embedded_html) AS embedded_html, ANY_VALUE(ph.fitted_html) AS fitted_html, ANY_VALUE(ph.atom_html) AS atom_html, ANY_VALUE(i.icon_html) AS icon_html, ANY_VALUE(ph.markdown) AS markdown, ANY_VALUE(i.generation) AS generation, ANY_VALUE(ph.generation) AS html_generation, ANY_VALUE(i.realm_url) AS realm_url, ANY_VALUE(i.indexed_at) AS indexed_at`,
      ],
      'file',
    );

    let files = results.map((result) => fileEntryFromResult(result));
    return { files, meta };
  }

  private generalFieldSortColumn(field: string) {
    let mappedField = generalSortFields[field];
    if (mappedField) {
      return mappedField;
    } else {
      throw new Error(`Unknown sort field: ${field}`);
    }
  }

  private orderExpression(sort: Sort | undefined): CardExpression {
    if (!sort) {
      // `i.type` follows `url` so a dual-indexed card `.json`'s two rows
      // (same url, `instance` vs `file`) order deterministically.
      return ['ORDER BY i.url COLLATE "POSIX", i.type'];
    }
    return [
      'ORDER BY',
      ...separatedByCommas([
        ...sort.map((s, index) =>
          // `_matchRelevance` is the aggregated relevance column projected by
          // the SELECT (see `_search`); reference the alias directly and default
          // to `desc` (best match first). A near sort's similarity column works
          // the same way. Everything else sorts on a column.
          isExprSort(s)
            ? [
                'ANY_VALUE(',
                this.#exprSql(s.expr),
                ')',
                sortDirection(s.direction ?? 'desc'),
                'NULLS LAST',
              ]
            : isBlendSort(s)
              ? [
                  `"${blendScoreAlias(sort, index)}"`,
                  sortDirection(s.direction ?? 'desc'),
                  'NULLS LAST',
                ]
              : isNearSort(s)
                ? [
                    `"${nearSimilarityAlias(sort, index)}"`,
                    sortDirection(s.direction ?? 'desc'),
                    'NULLS LAST',
                  ]
                : isMatchRelevanceSort(s)
                  ? [
                      `"${MATCH_RELEVANCE_SORT_KEY}"`,
                      sortDirection(s.direction ?? 'desc'),
                      'NULLS LAST',
                    ]
                  : [
                      // intentionally not using field arity here--not sure what it
                      // means to sort via a plural field
                      'ANY_VALUE(',
                      'on' in s && s.on
                        ? fieldQuery(s.by, s.on, false, 'sort')
                        : this.generalFieldSortColumn(s.by),
                      ')',
                      sortDirection(s.direction),
                      'NULLS LAST',
                    ],
        ),
        // `url` then `type` are the final sort keys for deterministic results
        // (the two rows of a dual-indexed card `.json` share a url).
        ['i.url COLLATE "POSIX"'],
        ['i.type'],
      ]),
    ];
  }

  // The order expression split for the outer-wrapped projection: the inner
  // grouped query exposes each sort value as an aliased column, and the outer
  // query applies the ORDER BY against those aliases (plus the `url`
  // tiebreaker). This yields the same ordering as `orderExpression` while the
  // sort values are computed once in the inner aggregation.
  #wrappedOrderExpression(sort: Sort | undefined): {
    innerSortColumns: CardExpression;
    outerOrderBy: CardExpression;
  } {
    if (!sort) {
      // `type` follows `url` to match `orderExpression`'s tiebreaker — the two
      // rows of a dual-indexed card `.json` share a url. The inner projection
      // aliases `ANY_VALUE(i.type) as type`, so the outer references it bare.
      return {
        innerSortColumns: [],
        outerOrderBy: ['ORDER BY url COLLATE "POSIX", type'],
      };
    }
    let innerSortColumns: CardExpression = [];
    let outerKeys: CardExpression[] = [];
    sort.forEach((s, i) => {
      if (isExprSort(s)) {
        let alias = `_sort_${i}`;
        innerSortColumns.push(
          ', ANY_VALUE(',
          this.#exprSql(s.expr),
          `) AS ${alias}`,
        );
        outerKeys.push([
          alias,
          sortDirection(s.direction ?? 'desc'),
          'NULLS LAST',
        ]);
        return;
      }
      // Blend and near columns are projected by the inner SELECT too.
      if (isBlendSort(s)) {
        outerKeys.push([
          `"${blendScoreAlias(sort, i)}"`,
          sortDirection(s.direction ?? 'desc'),
          'NULLS LAST',
        ]);
        return;
      }
      if (isNearSort(s)) {
        outerKeys.push([
          `"${nearSimilarityAlias(sort, i)}"`,
          sortDirection(s.direction ?? 'desc'),
          'NULLS LAST',
        ]);
        return;
      }
      // `_matchRelevance` is already projected by the inner SELECT (see
      // `_search`), so it rides through `sub.*` — reference it in the outer
      // ORDER BY directly, with no inner `_sort_i` alias, defaulting to `desc`.
      if (isMatchRelevanceSort(s)) {
        outerKeys.push([
          `"${MATCH_RELEVANCE_SORT_KEY}"`,
          sortDirection(s.direction ?? 'desc'),
          'NULLS LAST',
        ]);
        return;
      }
      let alias = `_sort_${i}`;
      innerSortColumns.push(
        ', ANY_VALUE(',
        'on' in s && s.on
          ? fieldQuery(s.by, s.on, false, 'sort')
          : this.generalFieldSortColumn(s.by),
        `) AS ${alias}`,
      );
      outerKeys.push([alias, sortDirection(s.direction), 'NULLS LAST']);
    });
    // `url` then `type` are the final tiebreakers, matching `orderExpression`
    // for deterministic results (a dual-indexed card `.json`'s two rows share
    // a url; the inner projection aliases `ANY_VALUE(i.type) as type`).
    outerKeys.push(['url COLLATE "POSIX"']);
    outerKeys.push(['type']);
    return {
      innerSortColumns,
      outerOrderBy: ['ORDER BY', ...separatedByCommas(outerKeys)],
    };
  }

  async fetchCardTypeSummary(realmURL: URL): Promise<RealmMetaValue> {
    // JOIN against realm_generations.current_generation so we always pick the
    // realm_meta row that matches the realm's authoritative current
    // generation. Naive `SELECT … WHERE realm_url=…` returns an arbitrary
    // row when stale rows linger (e.g., a from-scratch reindex resets
    // the generation to a low number, leaving older high-generation rows that
    // the legacy prune predicate `generation < <new>` never reaches).
    // Ordering by `generation DESC` would actually pick the *wrong*
    // row after a from-scratch — the highest generation is the oldest.
    // realm_generations is the system source of truth for "which generation
    // is current," so anchoring the read there is the robust fix.
    let results = (await this.#query([
      `SELECT rm.value
       FROM realm_meta rm
       JOIN realm_generations rg
         ON rg.realm_url = rm.realm_url
        AND rg.current_generation = rm.generation
       WHERE`,
      ...every([['rm.realm_url =', param(realmURL.href)]]),
      `LIMIT 1`,
    ] as Expression)) as { value: unknown }[];

    return normalizeRealmMetaValue(results[0]?.value);
  }

  private filterCondition(
    filter: Filter,
    onRef: CodeRef,
    polarity: FilterPolarity,
    context: FilterContext = DEFAULT_FILTER_CONTEXT,
  ): CardExpression {
    let typeRef = (filter as { type?: CodeRef }).type;
    let onProp = 'on' in filter ? filter.on : undefined;
    let on = onProp ?? typeRef ?? onRef;
    let typeConditionRef = onProp ?? typeRef;

    if (typeRef && Object.keys(filter).length === 1) {
      return this.typeCondition(typeRef);
    }

    // The validator rejects a multi-operator node on the wire, but a
    // query-backed field is indexed through here with no `assertQuery` in the
    // path. Each branch below picks a single operator, so without this backstop
    // such a node would compile on whichever one comes first and silently drop
    // the rest — diverging from the host, which rejects the same query. Reject
    // here too so every path agrees. `type`/`on` are not operators.
    let operators = filterOperators(filter);
    if (operators.length > 1) {
      throw new InvalidQueryError(
        `a filter may use only one operator, but found ${operators
          .map((key) => `"${key}"`)
          .join(
            ', ',
          )}; combine operators by nesting them under "every" or "any"`,
      );
    }

    if ('eq' in filter) {
      return this.eqCondition(filter, on, typeConditionRef, polarity);
    } else if ('in' in filter) {
      return this.inCondition(filter, on, typeConditionRef, polarity, context);
    } else if ('contains' in filter) {
      return this.containsCondition(filter, on, typeConditionRef);
    } else if ('not' in filter) {
      return this.notCondition(filter, on, typeConditionRef, polarity, context);
    } else if ('range' in filter) {
      return this.rangeCondition(filter, on, typeConditionRef);
    } else if ('matches' in filter) {
      return this.matchesCondition(filter, on, typeConditionRef, context);
    } else if (isTypeAheadFilter(filter)) {
      return this.typeAheadCondition(filter, typeConditionRef, context);
    } else if (isNearFilter(filter)) {
      return this.nearCondition(filter, typeConditionRef);
    } else if ('linkedFrom' in filter) {
      return every([
        ...(typeConditionRef ? [this.typeCondition(typeConditionRef)] : []),
        this.#linkedFromCondition(filter as LinkedFromFilter, context),
      ]);
    } else if ('pattern' in filter || 'regex' in filter) {
      return this.#patternCondition(
        filter as PatternFilter | RegexFilter,
        on,
        typeConditionRef,
        context,
      );
    } else if ('every' in filter) {
      // State each type's membership test once per conjunction. A sibling
      // anchored on a type the AND already tests keeps that type for resolving
      // its fields, but emits no second test: Postgres multiplies the two
      // tests' selectivities, expects almost no rows, and then re-runs an
      // indexed `in`/`matches` subquery per row instead of hashing it (a
      // 20-value `in` beside a bare `{ on }` took 12 s against 70 ms alone).
      // Dropping a repeated conjunct never changes what an AND selects.
      let established = new Set<string>();
      let parts: CardExpression[] = [];
      if (typeConditionRef) {
        established.add(stringify(typeConditionRef));
        parts.push(this.typeCondition(typeConditionRef));
      }
      for (let child of filter.every) {
        let childKeys = Object.keys(child);
        let childOn = (child as { on?: CodeRef }).on;
        let childType = (child as { type?: CodeRef }).type;
        let pureRef =
          childKeys.length === 1 ? (childOn ?? childType) : undefined;
        if (pureRef) {
          let key = stringify(pureRef);
          if (established.has(key)) {
            continue;
          }
          established.add(key);
          parts.push(this.typeCondition(pureRef));
          continue;
        }
        if (childOn && established.has(stringify(childOn))) {
          let { on: _anchor, ...rest } = child as { on?: CodeRef } & Filter;
          parts.push(
            this.filterCondition(rest as Filter, childOn, polarity, context),
          );
          continue;
        }
        if (childOn) {
          established.add(stringify(childOn));
        }
        parts.push(this.filterCondition(child, on, polarity, context));
      }
      return every(parts);
    } else if ('any' in filter) {
      let folded = foldSameKeyEqs(filter.any);
      if (folded) {
        return every([
          ...(typeConditionRef ? [this.typeCondition(typeConditionRef)] : []),
          this.filterCondition(folded, on, polarity, context),
        ]);
      }
      let union = this.#anyAsIndexedUnion(filter.any, context);
      if (union) {
        return every([
          ...(typeConditionRef ? [this.typeCondition(typeConditionRef)] : []),
          union,
        ]);
      }
      return every([
        ...(typeConditionRef ? [this.typeCondition(typeConditionRef)] : []),
        any([
          ...filter.any.map((i) =>
            this.filterCondition(i, on, polarity, { ...context, inAny: true }),
          ),
        ]),
      ]);
    } else {
      if (isCardTypeFilter(filter)) {
        return this.typeCondition(filter.type);
      }
      assertNever(filter);
    }
    throw new Error(`Unknown filter: ${stringify(filter)}`);
  }

  // the type condition only consumes absolute URL card refs.
  private typeCondition(ref: CodeRef): CardExpression {
    // Deferred to pass 1 (`handleTypeCondition`): the membership keys need the
    // ref's definition, which resolves asynchronously.
    return [typeConditionNode(ref)];
  }

  private async handleTypeCondition(
    condition: TypeCondition,
  ): Promise<Expression> {
    // Each key is a self-contained `types-contains` membership predicate rather
    // than a comparison against a shared `jsonb_array_elements_text(types)`
    // cross-join alias. The cross join gave every type condition in a query
    // exists-one-element semantics (all type conditions dedupe onto one alias),
    // which miscompose: `not: { type: X }` failed to exclude X, and
    // `every: [{ type: A }, { type: B }]` was unsatisfiable. Per-row membership
    // makes negation a true exclusion and conjunction a true intersection.
    let keys = await this.typeKeysFor(condition.ref);
    return any(keys.map((typeKey) => [typesContains(typeKey)])) as Expression;
  }

  // Every `types` membership key a ref can legitimately match:
  //
  // - the ref's own key. `internalKeyFor` resolves any spelling to a real URL
  //   and unresolves it to the registered prefix, so a filter naming a module
  //   by prefix, real URL or virtual alias yields one key — the same form the
  //   indexer writes.
  // - the key of the ref's canonical (defining-module) codeRef. Rows stamp
  //   `types` via `identifyCard`, which names the module a class is defined
  //   in — so a ref that names the type through a re-exporting module (e.g.
  //   file-api's FileDef, re-exported from card-api) only matches through its
  //   definition's canonical ref. The host's search resource applies the same
  //   canonicalization (via the loader) before its client-side matching,
  //   keeping the two evaluations in agreement.
  //
  // A ref whose definition doesn't resolve keeps only its own key and matches
  // nothing (unless rows were stamped under that spelling).
  //
  // Public because the live-search cache key is scoped by the same keys: it
  // reads a per-type watermark for each of a query's type anchors, and those
  // keys have to be the ones this engine matches rows on or the key would
  // address a row nothing writes. Calling the engine rather than reproducing
  // it is what keeps the two from drifting.
  async typeKeysFor(ref: CodeRef): Promise<string[]> {
    let keys = [internalKeyFor(ref, undefined, this.#virtualNetwork)];
    if (isResolvedCodeRef(ref)) {
      try {
        let definition = await this.#definitionLookup.lookupDefinition(ref);
        if (isResolvedCodeRef(definition.codeRef)) {
          let key = internalKeyFor(
            definition.codeRef,
            undefined,
            this.#virtualNetwork,
          );
          if (!keys.includes(key)) {
            keys.push(key);
          }
        }
      } catch (error) {
        // A ref that names no resolvable type falls through to the
        // spelling-based keys (matching nothing unless rows were stamped under
        // that spelling) — the same way the engine's top-level catch treats a
        // nonexistent type as an empty result rather than an error. Any other
        // failure is unexpected and propagates rather than silently
        // narrowing the match.
        if (!isFilterRefersToNonexistentTypeError(error)) {
          throw error;
        }
      }
    }
    return keys;
  }

  // The card's primary `id` and a FileDef's `url` index in URL form, but a
  // query may now arrive with a canonical-RRI (prefix) value. For filter paths
  // whose leaf is `id`/`url`, a prefix-form value additionally matches its
  // equivalent spellings — real-URL, RRI-prefix, and any virtual-alias — via
  // the realm's VirtualNetwork, so a reference filter matches the URL-indexed
  // value without a reindex or DB migration. Unlike `types`, which is written
  // and read in one canonical form, `id`/`url` are still indexed in URL form,
  // so the expansion here is load-bearing.
  //
  // Only a *prefix-form* value (one that starts with a registered realm prefix)
  // is expanded. These leaf names also occur on ordinary user-data fields (a
  // contained `url` StringField, a FieldDef `id`) whose values are plain
  // strings or URLs and whose `in` filter is an exact string comparison —
  // those are matched exactly as given, gaining no extra normalized spellings,
  // so exact semantics are preserved for non-reference fields.
  private expandReferenceFilterValues(
    key: string,
    values: JSONTypes.Value[],
  ): JSONTypes.Value[] {
    if (!isReferenceFilterField(key)) {
      return values;
    }
    let expanded: JSONTypes.Value[] = [];
    let seen = new Set<string>();
    for (let value of values) {
      if (typeof value !== 'string') {
        expanded.push(value);
        continue;
      }
      // Match the value as given by default — this preserves exact `in`
      // semantics for URL-form refs and for ordinary (non-reference) `id`/`url`
      // user-data fields.
      let forms: string[] = [value];
      if (this.#virtualNetwork.isRegisteredPrefix(value)) {
        try {
          // A prefix-form RRI: resolve to its real URL (the server's VN owns
          // the realm mappings), then enumerate equivalent spellings so it
          // matches the URL-form indexed reference.
          forms.push(
            ...this.#virtualNetwork.equivalentURLForms(
              this.#virtualNetwork.toURL(value).href,
            ),
          );
        } catch {
          // Unresolvable prefix — match the value as given.
        }
      }
      for (let form of forms) {
        if (!seen.has(form)) {
          seen.add(form);
          expanded.push(form);
        }
      }
    }
    return expanded;
  }

  private eqCondition(
    filter: EqFilter,
    on: CodeRef,
    typeConditionRef?: CodeRef,
    polarity: FilterPolarity = 'positive',
  ): CardExpression {
    let typeRef = typeConditionRef;
    return every([
      ...(typeRef ? [this.typeCondition(typeRef)] : []),
      ...Object.entries(filter.eq).map(([key, value]) => {
        return this.fieldEqFilter(key, value, on, polarity);
      }),
    ]);
  }

  private inCondition(
    filter: InFilter,
    on: CodeRef,
    typeConditionRef?: CodeRef,
    polarity: FilterPolarity = 'positive',
    context: FilterContext = DEFAULT_FILTER_CONTEXT,
  ): CardExpression {
    let typeRef = typeConditionRef;
    return every([
      ...(typeRef ? [this.typeCondition(typeRef)] : []),
      ...Object.entries(filter.in).map(([key, values]) => {
        return this.fieldInFilter(
          key,
          values as JSONTypes.Value[],
          on,
          polarity,
          context,
        );
      }),
    ]);
  }

  private containsCondition(
    filter: ContainsFilter,
    on: CodeRef,
    typeConditionRef?: CodeRef,
  ): CardExpression {
    let typeRef = typeConditionRef;
    return every([
      ...(typeRef ? [this.typeCondition(typeRef)] : []),
      ...Object.entries(filter.contains).map(([key, value]) => {
        return this.fieldLikeFilter(key, value, on);
      }),
    ]);
  }

  private notCondition(
    filter: NotFilter,
    on: CodeRef,
    typeConditionRef?: CodeRef,
    polarity: FilterPolarity = 'positive',
    context: FilterContext = DEFAULT_FILTER_CONTEXT,
  ): CardExpression {
    let typeRef = typeConditionRef;
    return every([
      ...(typeRef ? [this.typeCondition(typeRef)] : []),
      [
        'NOT',
        ...addExplicitParens(
          this.filterCondition(filter.not, on, flipPolarity(polarity), context),
        ),
      ],
    ]);
  }

  private rangeCondition(
    filter: RangeFilter,
    on: CodeRef,
    typeConditionRef?: CodeRef,
  ): CardExpression {
    let typeRef = typeConditionRef;
    return every([
      ...(typeRef ? [this.typeCondition(typeRef)] : []),
      ...Object.entries(filter.range).map(([key, filterValue]) => {
        return this.fieldRangeFilter(key, filterValue as RangeFilterValue, on);
      }),
    ]);
  }

  // Resolves the VectorField a near sort or filter addresses and refuses
  // anything else: a path that is not a VectorField, or a Postgres without
  // the pgvector table.
  async #assertNearField(on: CodeRef, path: string, what: string) {
    let definition = await this.getDefinition(on);
    let field = await getField(definition, path, this.#definitionLookup);
    if (field.serializerName !== 'vector') {
      throw new InvalidQueryError(
        `${what} requires "${path}" to be a VectorField`,
      );
    }
    if (
      this.#dbAdapter.kind === 'pg' &&
      !(await hasVectorIndex(this.#dbAdapter))
    ) {
      throw new InvalidQueryError(VECTOR_INDEX_UNAVAILABLE_MESSAGE);
    }
  }

  // Validates every near filter in the tree up front (field lookups are
  // async, the filter compiler is not), resolving each node's `on` the way
  // `filterCondition` does.
  async #assertNearFilters(filter: Filter | undefined, onRef: CodeRef) {
    if (!filter) {
      return;
    }
    let on =
      ('on' in filter ? filter.on : undefined) ??
      (filter as { type?: CodeRef }).type ??
      onRef;
    if (isNearFilter(filter)) {
      for (let path of Object.keys(filter.near)) {
        await this.#assertNearField(on, path, `near filter on "${path}"`);
      }
    } else if ('pattern' in filter || 'regex' in filter) {
      let operator = 'regex' in filter ? 'regex' : 'pattern';
      if (operator === 'regex' && this.#dbAdapter.kind !== 'pg') {
        throw new InvalidQueryError(
          'a regex filter needs Postgres; this index has no regular expressions',
        );
      }
      let definition = await this.getDefinition(on);
      for (let path of Object.keys(
        (filter as unknown as Record<string, Record<string, string>>)[operator],
      )) {
        let field = await getField(definition, path, this.#definitionLookup);
        let search = field.search === false ? undefined : field.search;
        if (!searchesByPattern(search)) {
          throw new InvalidQueryError(
            `a ${operator} filter on "${path}" needs a field searched by pattern: declare it \`search: { patterns: true }\`, or give it an identifier or code role`,
          );
        }
      }
    } else if ('every' in filter) {
      for (let child of filter.every) {
        await this.#assertNearFilters(child, on);
      }
    } else if ('any' in filter) {
      for (let child of filter.any) {
        await this.#assertNearFilters(child, on);
      }
    } else if ('not' in filter) {
      await this.#assertNearFilters(filter.not, on);
    }
  }

  // A glob (`pattern`) or regular expression (`regex`) over a field's value.
  // On Postgres the row's `pattern_text` (every pattern field's value, one per
  // line, trigram-indexed) narrows to the rows that can match first; the
  // field itself decides. A glob matches the whole value, ignoring case.
  #patternCondition(
    filter: PatternFilter | RegexFilter,
    on: CodeRef,
    typeConditionRef: CodeRef | undefined,
    context: FilterContext,
  ): CardExpression {
    let isRegex = 'regex' in filter;
    let entries = Object.entries(
      isRegex
        ? (filter as RegexFilter).regex
        : (filter as PatternFilter).pattern,
    );
    let prefilter =
      this.#dbAdapter.kind === 'pg' &&
      context.indexTable === DEFAULT_FILTER_CONTEXT.indexTable;
    let conditions: CardExpression[] = [];
    for (let [key, value] of entries) {
      let operand = isRegex ? value : globToLike(value);
      if (prefilter) {
        if (!isRegex) {
          conditions.push(['i.pattern_text ILIKE', param(`%${operand}%`)]);
        } else if (!value.startsWith('(?')) {
          // Newline-sensitive, so `^` and `$` hold at each value's ends.
          conditions.push(['i.pattern_text ~', param(`(?n)${value}`)]);
        }
      }
      conditions.push([
        fieldArity({
          type: on,
          path: key,
          value: [
            fieldQuery(key, on, false, 'filter'),
            isRegex ? '~' : 'ILIKE',
            fieldValue(key, [param(operand)], on, 'filter'),
          ],
          errorHint: 'filter',
        }),
      ]);
    }
    return every([
      ...(typeConditionRef ? [this.typeCondition(typeConditionRef)] : []),
      ...conditions,
    ]);
  }

  // Widens each `typos` term's words to the closest words of the realm's
  // word list (fields declared `typos: true`), as tsquery text the term then
  // matches with (`typoQuery`). A word of three letters or fewer, or one the
  // list already holds, stays as typed. Postgres only.
  async #resolveTypos(
    filter: Filter | undefined,
    realmURL: URL,
  ): Promise<Filter | undefined> {
    if (!filter || this.#dbAdapter.kind !== 'pg') {
      return filter;
    }
    let node = filter as any;
    if ('matches' in node) {
      if (!node.typos || node.matches.trim() === '') {
        return filter;
      }
      // With `prefix`, the last word is still being typed: it matches as a
      // prefix exactly as without `typos` (see `matchTsQuery`), and takes
      // corrections only once it is long enough to stand for a whole word.
      // A short partial would otherwise be "corrected" to a host of short
      // words and match nearly everything.
      let { words: finishedText, partial } = node.prefix
        ? splitTypeAheadQuery(node.matches)
        : { words: node.matches, partial: undefined };
      let finished = typeAheadWords(finishedText);
      let partialWords =
        partial && [...partial].length >= MIN_TYPO_PARTIAL_LETTERS
          ? [partial]
          : [];
      if (finished.length === 0 && partialWords.length === 0) {
        return filter;
      }
      let corrections = await this.#typoCorrectionsFor(
        [...finished, ...partialWords],
        realmURL,
      );
      let alternativesOf = (word: string) =>
        [...new Set([word, ...(corrections.get(word) ?? [])])]
          .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
          .filter(Boolean);
      let typoQuery = finished
        .map((word) => `(${alternativesOf(word).join(' | ')})`)
        .join(' & ');
      let typoPartial =
        partialWords.length > 0
          ? (corrections.get(partialWords[0]) ?? [])
              .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
              .filter(Boolean)
              .join(' | ')
          : '';
      return {
        ...node,
        typoQuery,
        ...(typoPartial ? { typoPartial } : {}),
      } as Filter;
    }
    if ('typeahead' in node) {
      if (!node.typos) {
        return filter;
      }
      let words = typeAheadWords(node.typeahead).filter(
        (w) => !TYPE_AHEAD_STOP_WORDS.has(w),
      );
      if (words.length === 0) {
        return filter;
      }
      // Every type-ahead word matches as a prefix, so any of them may still
      // be being typed: only words long enough to stand for a whole word take
      // corrections.
      let corrections = await this.#typoCorrectionsFor(
        words.filter((w) => [...w].length >= MIN_TYPO_PARTIAL_LETTERS),
        realmURL,
      );
      // As `typeAheadTsQuery`: a word of three letters or more matches as a
      // prefix (so does a shorter one once another word narrows). Each word
      // also matches its corrections whole, so a fully typed misspelling
      // ("conurency") finds the word it meant.
      let narrowed = words.some((w) => [...w].length >= MIN_PREFIX_LETTERS);
      let typoQuery = words
        .map((word) => {
          let clean = word.replace(/[^\p{L}\p{N}]/gu, '');
          let alternatives = [
            narrowed || [...clean].length >= MIN_PREFIX_LETTERS
              ? `${clean}:*`
              : clean,
            ...(corrections.get(word) ?? [])
              .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
              .filter(Boolean),
          ];
          return `(${[...new Set(alternatives)].join(' | ')})`;
        })
        .join(' & ');
      return { ...node, typoQuery } as Filter;
    }
    if ('every' in node || 'any' in node) {
      let key = 'every' in node ? 'every' : 'any';
      return {
        ...node,
        [key]: await Promise.all(
          (node[key] as Filter[]).map((child) =>
            this.#resolveTypos(child, realmURL),
          ),
        ),
      } as Filter;
    }
    if ('not' in node) {
      return {
        ...node,
        not: await this.#resolveTypos(node.not, realmURL),
      } as Filter;
    }
    return filter;
  }

  // Each word's corrections from the realm's word list: candidates by
  // trigram similarity (the list's GIN index), for words the list doesn't
  // already hold, kept when within the word's edit budget
  // (`typoCorrections`).
  async #typoCorrectionsFor(
    words: string[],
    realmURL: URL,
  ): Promise<Map<string, string[]>> {
    let rows = (await this.#dbAdapter.execute(
      `SELECT q.w AS word, c.word AS correction
         FROM unnest($1::text[]) AS q(w)
         CROSS JOIN LATERAL (
           SELECT bw.word FROM boxel_index_words AS bw
            WHERE bw.realm_url = $2 AND char_length(q.w) > 3
              AND bw.word % q.w AND bw.word <> q.w
              AND NOT EXISTS (
                SELECT 1 FROM boxel_index_words AS known
                 WHERE known.realm_url = $2 AND known.word = q.w
              )
            ORDER BY similarity(bw.word, q.w) DESC, bw.word
            LIMIT 10
         ) AS c`,
      { bind: [words, realmURL.href] },
    )) as { word: string; correction: string }[];
    let candidates = new Map<string, string[]>();
    for (let { word, correction } of rows) {
      candidates.set(word, [...(candidates.get(word) ?? []), correction]);
    }
    return new Map(
      [...candidates].map(([word, list]) => [
        word,
        typoCorrections(word, list),
      ]),
    );
  }

  // A near filter: the card has a vector at the path of the target's
  // dimension and, given `minSimilarity`, at least that cosine similarity to
  // the target. Postgres asks `boxel_index_vectors` with EXISTS (so it negates
  // and nests like any predicate); SQLite scores the search doc's own vector,
  // singular paths only.
  private nearCondition(
    filter: NearFilter,
    typeConditionRef?: CodeRef,
  ): CardExpression {
    let [path, { to, minSimilarity }] = Object.entries(filter.near)[0];
    let fieldPath = removeBrackets(path);
    let target = vectorToSqlLiteral(to);
    let dims = vectorDimensions(to);
    let condition: CardExpression;
    if (this.#dbAdapter.kind === 'pg') {
      // An uncorrelated IN rather than a correlated EXISTS: under AND the
      // planner makes it a semi-join, and under OR (`any`) a hashed SubPlan
      // that scans the vectors once instead of once per candidate row.
      condition = [
        '(i.realm_url, i.url, i.type) IN (SELECT nvf.realm_url, nvf.url, nvf.type FROM boxel_index_vectors AS nvf WHERE nvf.field_path =',
        param(fieldPath),
        'AND nvf.dims =',
        param(dims),
        ...(minSimilarity == null
          ? []
          : [
              'AND (nvf.embedding <=> CAST(',
              param(target),
              'AS vector)) <=',
              param(1 - minSimilarity),
            ]),
        ')',
      ];
    } else {
      let jsonPath = `$.${fieldPath}`;
      condition = [
        'json_array_length(substr(json_extract(i.search_doc,',
        param(jsonPath),
        '), 5)) =',
        param(dims),
        ...(minSimilarity == null
          ? []
          : [
              'AND',
              ...sqliteCosineSimilarity(jsonPath, target),
              '>=',
              param(minSimilarity),
            ]),
      ];
    }
    return every([
      ...(typeConditionRef ? [this.typeCondition(typeConditionRef)] : []),
      condition,
    ]);
  }

  // Each `_relevance` sort, as the `_blend` it stands for: text relevance
  // (when the filter has a positive `matches` term), each ranking signal the
  // anchoring type declares (`rank: 'popularity'`, its `static searchDefaults.rank`),
  // and, given `near`, the similarity of the type's vector field as the
  // `meaning` signal. Weights default to `DEFAULT_RELEVANCE_WEIGHTS`; a zero
  // weight drops a signal and a negative one inverts it.
  async #expandRelevanceSorts(
    sort: Sort | undefined,
    filter: Filter | undefined,
  ): Promise<Sort | undefined> {
    if (!sort?.some((s) => isRelevanceSort(s))) {
      return sort;
    }
    let expanded: Sort = [];
    for (let s of sort) {
      expanded.push(
        isRelevanceSort(s) ? await this.#relevanceBlend(s, filter) : s,
      );
    }
    return expanded;
  }

  async #relevanceBlend(
    sort: RelevanceSortExpression,
    filter: Filter | undefined,
  ): Promise<BlendSortExpression> {
    let weightOf = (signal: RelevanceSignal) =>
      sort.weights?.[signal] ?? DEFAULT_RELEVANCE_WEIGHTS[signal];
    let signal = (
      weight: number,
      entry: { by: string; on?: CodeRef; near?: NearSortTarget },
      name?: RelevanceSignal,
    ): BlendComponent => {
      let component = {
        ...entry,
        weight: Math.abs(weight),
        direction: weight < 0 ? 'asc' : 'desc',
      } as BlendComponent;
      // read by `explain`, never on the wire
      if (name) explainNames.set(component, { name, weight });
      return component;
    };
    let of: BlendComponent[] = [];
    let text = weightOf('text');
    if (text !== 0 && collectPositiveMatchTerms(filter).length > 0) {
      of.push(signal(text, { by: MATCH_RELEVANCE_SORT_KEY }, 'text'));
    }
    let on = sort.on ?? filterAnchor(filter);
    if (on) {
      let definition = await this.getDefinition(on);
      let rankFields = rankFieldsOf(definition);
      for (let name of SEARCH_RANK_SIGNALS) {
        let field = rankFields[name]?.[0];
        let weight = weightOf(name);
        if (field && weight !== 0) {
          of.push(signal(weight, { by: field, on }, name));
        }
      }
      let meaning = weightOf('meaning');
      if (sort.near != null && meaning !== 0) {
        let vectorField = Object.entries(definition.fields).find(
          ([, defId]) =>
            definition.fieldDefs[defId]?.serializerName === 'vector',
        )?.[0];
        if (!vectorField) {
          throw new InvalidQueryError(
            `sort by "${RELEVANCE_SORT_KEY_NAME}" near a vector needs a type with a VectorField; ${JSON.stringify(on)} has none`,
          );
        }
        of.push(
          signal(meaning, { by: vectorField, on, near: sort.near }, 'meaning'),
        );
      }
    } else if (sort.near != null) {
      throw new InvalidQueryError(
        `sort by "${RELEVANCE_SORT_KEY_NAME}" near a vector needs "on", the type whose vector field it compares`,
      );
    }
    if (of.length === 0) {
      throw new InvalidQueryError(
        `sort by "${RELEVANCE_SORT_KEY_NAME}" has nothing to rank by: give the query a positive \`matches\` filter, or anchor it ("on") to a type that declares rank fields`,
      );
    }
    return {
      by: BLEND_SORT_KEY,
      of: of.slice(0, MAX_BLEND_COMPONENTS),
      direction: sort.direction ?? 'desc',
    };
  }

  // The projection column (and any vector joins) for each `_blend` sort:
  // reciprocal rank fusion, sum(weight / (k + rank)) over the signals a card
  // has a value for. Each signal's rank is a window over every grouped row
  // the filter admits (evaluated before ORDER BY / LIMIT), so a page holds
  // the top of the whole match set. A card without a value for a signal (no
  // vector, no text match, an empty field) gets nothing from it, rather than
  // a last place. Ties share a rank (RANK()).
  async #blendSortExpressions(
    sort: Sort | undefined,
    matches: MatchTerm[],
    staged: boolean,
    filterContext: FilterContext,
    explain = false,
  ): Promise<{ blendColumns: CardExpression; blendJoins: CardExpression }> {
    let blendColumns: CardExpression = [];
    let blendJoins: CardExpression = [];
    if (!sort) {
      return { blendColumns, blendJoins };
    }
    for (let [index, s] of sort.entries()) {
      if (!isBlendSort(s)) {
        continue;
      }
      let k = s.k ?? DEFAULT_RRF_K;
      let terms: CardExpression[] = [];
      for (let [j, component] of s.of.entries()) {
        let weight = component.weight ?? 1;
        let inverted = weight < 0;
        let score = await this.#blendSignalScore(
          component,
          matches,
          `nb${index}_${j}`,
          blendJoins,
          staged,
          filterContext,
          inverted,
        );
        // A negative weight inverts the signal: the same size, ranked the
        // other way round. A `_when` signal inverts in its score instead.
        if (explain && index === sort.findIndex((s) => isBlendSort(s))) {
          let order: CardExpression = [
            '(ORDER BY',
            ...score,
            sortDirection(
              isWhenSignal(component)
                ? 'desc'
                : inverted
                  ? (component.direction ?? 'desc') === 'desc'
                    ? 'asc'
                    : 'desc'
                  : (component.direction ?? 'desc'),
            ),
            'NULLS LAST)',
          ];
          blendColumns.push(
            ', (',
            ...score,
            `) AS "_x${j}_value"`,
            ', (CASE WHEN',
            ...score,
            'IS NULL THEN NULL ELSE RANK() OVER',
            ...order,
            `END) AS "_x${j}_rank"`,
          );
        }
        let declared = isWhenSignal(component)
          ? 'desc'
          : (component.direction ?? 'desc');
        let direction =
          inverted && !isWhenSignal(component)
            ? declared === 'desc'
              ? 'asc'
              : 'desc'
            : declared;
        terms.push([
          'CASE WHEN',
          ...score,
          'IS NULL THEN 0 ELSE CAST(',
          param(Math.abs(weight)),
          dbExpression({ pg: 'AS DOUBLE PRECISION)', sqlite: 'AS REAL)' }),
          '/ (',
          param(k),
          '+ RANK() OVER (ORDER BY',
          ...score,
          sortDirection(direction),
          'NULLS LAST)) END',
        ]);
      }
      let sum: CardExpression = [];
      terms.forEach((t, i) => {
        if (i > 0) {
          sum.push('+');
        }
        sum.push(...t);
      });
      blendColumns.push(
        ', (',
        ...sum,
        `) AS "${blendScoreAlias(sort, index)}"`,
      );
    }
    return { blendColumns, blendJoins };
  }

  // One blend signal's aggregated value for a card, NULL when it has none.
  async #blendSignalScore(
    component: BlendComponent,
    matches: MatchTerm[],
    joinAlias: string,
    joins: CardExpression,
    staged: boolean,
    filterContext: FilterContext,
    inverted = false,
  ): Promise<CardExpression> {
    if (isWhenSignal(component)) {
      // 1 for a card the filter admits, NULL (no signal) otherwise, so every
      // match ties for first place. Inverted, the cards it doesn't admit.
      await this.#assertNearFilters(component.when, baseCardRef);
      let condition = this.filterCondition(
        component.when,
        baseCardRef,
        'positive',
        filterContext,
      );
      return inverted
        ? ['NULLIF(MIN(CASE WHEN', ...condition, 'THEN 0 ELSE 1 END), 0)']
        : ['MAX(CASE WHEN', ...condition, 'THEN 1 END)'];
    }
    if (isExprSort(component)) {
      return ['ANY_VALUE(', this.#exprSql(component.expr), ')'];
    }
    if (isMatchRelevanceSort(component)) {
      // ts_rank_cd is 0 for a card the terms don't match: no signal.
      return ['NULLIF(', ...this.matchRelevanceScore(matches, staged), ', 0)'];
    }
    if (isNearSort(component)) {
      await this.#assertNearField(
        component.on,
        component.by,
        `blend signal "${component.by}" near a vector`,
      );
      let target = vectorToSqlLiteral(component.near);
      if (this.#dbAdapter.kind === 'pg') {
        joins.push(
          `LEFT JOIN boxel_index_vectors AS ${joinAlias} ON ${joinAlias}.realm_url = i.realm_url AND ${joinAlias}.url = i.url AND ${joinAlias}.type = i.type AND ${joinAlias}.field_path =`,
          param(removeBrackets(component.by)),
          `AND ${joinAlias}.dims =`,
          param(vectorDimensions(component.near)),
        );
        return [
          `MAX(1 - (${joinAlias}.embedding <=> CAST(`,
          param(target),
          'AS vector)))',
        ];
      }
      return [
        'MAX(',
        ...sqliteCosineSimilarity(`$.${removeBrackets(component.by)}`, target),
        ')',
      ];
    }
    return [
      'ANY_VALUE(',
      'on' in component && component.on
        ? fieldQuery(component.by, component.on, false, 'sort')
        : this.generalFieldSortColumn(component.by),
      ')',
    ];
  }

  // The projection columns and joins for the query's near sorts.
  //
  // Postgres reads the vectors the index writer copied into
  // `boxel_index_vectors` (one LEFT JOIN per near sort, on the card's row and
  // the field path) and scores cosine similarity, `1 - <=>`. MAX folds a
  // plural field's vectors into the card's nearest one, and leaves NULL
  // (sorted last) for a card with no vector at the path. The search is exact:
  // every row the filter admits is scored, so a near sort combines with any
  // filter and never drops a match. While an index pass is staged (WIP
  // reads), the table still holds the last committed vectors.
  //
  // SQLite (the browser index the host tests run on) has no vector type, so
  // it scores the search doc's own "vec:[…]" string with json_each. That is a
  // fallback for small test indexes, not for real data.
  async #nearSortExpressions(sort: Sort | undefined): Promise<{
    nearColumns: CardExpression;
    nearJoins: CardExpression;
  }> {
    let nearColumns: CardExpression = [];
    let nearJoins: CardExpression = [];
    if (!sort) {
      return { nearColumns, nearJoins };
    }
    for (let [index, s] of sort.entries()) {
      if (!isNearSort(s)) {
        continue;
      }
      await this.#assertNearField(
        s.on,
        s.by,
        `sort by "${s.by}" near a vector`,
      );
      let alias = nearSimilarityAlias(sort, index);
      let target = vectorToSqlLiteral(s.near);
      let dims = vectorDimensions(s.near);
      if (this.#dbAdapter.kind === 'pg') {
        let v = `nv${index}`;
        nearJoins.push(
          `LEFT JOIN boxel_index_vectors AS ${v} ON ${v}.realm_url = i.realm_url AND ${v}.url = i.url AND ${v}.type = i.type AND ${v}.field_path =`,
          param(removeBrackets(s.by)),
          `AND ${v}.dims =`,
          param(dims),
        );
        nearColumns.push(
          `, MAX(1 - (${v}.embedding <=> CAST(`,
          param(target),
          `AS vector))) AS "${alias}"`,
        );
      } else {
        nearColumns.push(
          ', MAX(',
          ...sqliteCosineSimilarity(`$.${removeBrackets(s.by)}`, target),
          `) AS "${alias}"`,
        );
      }
    }
    return { nearColumns, nearJoins };
  }

  // The relevance value for a `matches` query, aggregated per (url, type) group.
  //
  // Postgres scores the row's markdown tsvector against the OR-union of the
  // positive match terms with `ts_rank_cd` — cover-density (proximity/position
  // aware), normalized to a bounded 0–1 range via flag 32 so it reads as a clean
  // gauge. The tsvector is recomputed here (the markdown GIN index is a lossy
  // expression index and can't hand a rankable vector back), through the SAME
  // `markdown_search_text` wrapper as the match predicate and its index, so the
  // ranked text is exactly the filtered text.
  //
  // SQLite has no full-text ranking, so it falls back to boolean 1/0 (did the
  // LIKE predicate match at all) — enough for a deterministic sort in host
  // in-browser tests; meaningful ranking is Postgres-only.
  //
  // `MAX(...)` lets the value survive `GROUP BY i.url, i.type` (and any
  // table-valued fan-out, where every fanned row shares the same markdown).
  private matchRelevanceExpression(
    matches: MatchTerm[],
    staged: boolean,
  ): CardExpression {
    return [
      ...this.matchRelevanceScore(matches, staged),
      `AS "${MATCH_RELEVANCE_SORT_KEY}"`,
    ];
  }

  // The aggregated relevance value alone (no alias), shared by the
  // `_matchRelevance` column and a `_blend` signal.
  private matchRelevanceScore(
    allMatches: MatchTerm[],
    staged: boolean,
  ): CardExpression {
    // Terms scoped to a passage list score the card's best passage;
    // type-ahead terms score by title tier (see `#typeAheadRelevance`); the
    // others score the card's rank vector. A card's relevance is the best.
    let passageTerms = allMatches.filter((m) => m.within);
    let typeAheadTerms = allMatches.filter((m) => m.typeahead);
    let matches = allMatches.filter((m) => !m.within && !m.typeahead);
    let parts: CardExpression[] = [];
    if (passageTerms.length > 0) {
      parts.push(['MAX(', ...this.#passageRelevance(passageTerms), ')']);
    }
    if (typeAheadTerms.length > 0) {
      parts.push([
        'MAX(',
        ...this.#typeAheadRelevance(typeAheadTerms, staged),
        ')',
      ]);
    }
    if (matches.length === 0 || parts.length > 0) {
      if (matches.length > 0) {
        parts.push(this.matchRelevanceScore(matches, staged));
      }
      if (parts.length === 0) {
        return ['0'];
      }
      if (parts.length === 1) {
        return parts[0];
      }
      let out: CardExpression = ['GREATEST('];
      parts.forEach((part, i) => {
        if (i > 0) {
          out.push(',');
        }
        out.push(...part);
      });
      out.push(')');
      return out;
    }
    let pgTsQuery: Expression = [];
    matches.forEach((m, i) => {
      if (i > 0) {
        pgTsQuery.push('||');
      }
      pgTsQuery.push(...matchTsQuery(m));
    });
    let sqliteLike: Expression = [];
    matches.forEach((m, i) => {
      if (i > 0) {
        sqliteLike.push('OR');
      }
      sqliteLike.push(
        `LOWER(coalesce(ph.markdown, '')) LIKE LOWER(`,
        param(`%${escapeSqliteLikePattern(m.matches)}%`),
        `) ESCAPE '\\'`,
      );
    });
    return [
      'MAX(',
      dbExpression({
        // A card ranks by its small, inline rank vector (titles, names and
        // aliases; summaries, keywords, labels and type names; the start of
        // plain and body text), so ranking any number of matches reads no
        // out-of-line value, however large the cards are. A card without
        // one yet (indexed before it existed) ranks lowest. Matching reads
        // the full vectors; ranking never reads the rendered page.
        pg: [
          `ts_rank_cd(COALESCE(${rankVector('i', staged)}, ''::tsvector), `,
          ...pgTsQuery,
          `, 32)`,
        ],
        sqlite: [`CASE WHEN (`, ...sqliteLike, `) THEN 1 ELSE 0 END`],
      }),
      `)`,
    ];
  }

  // A type-ahead term's relevance for one row: a tier from the row's inline
  // title (3 when the title is what was typed, 2 when it starts with it, 1
  // when every typed word prefixes a title word, 0 when the row matched
  // through its alternative names or type words), plus its rank vector's
  // score for the typed words as a fraction. The tiers outrank any text
  // score, so title hits lead and content can't push them down.
  #typeAheadRelevance(terms: MatchTerm[], staged: boolean): CardExpression {
    let title = staged
      ? `lower(i.search_doc ->> '${CARD_TITLE_KEY}')`
      : 'i.search_title';
    let scores: CardExpression[] = [];
    for (let term of terms) {
      let typed = typeAheadWords(term.matches).join(' ');
      if (!typed) {
        continue;
      }
      let tsquery: Expression | undefined = term.typoQuery
        ? [`to_tsquery('simple',`, param(term.typoQuery), `)`]
        : typeAheadTsQuery(term.matches);
      scores.push([
        dbExpression({
          pg: [
            `(CASE WHEN ${title} =`,
            param(typed),
            `THEN 3 WHEN ${title} LIKE`,
            param(`${escapeSqliteLikePattern(typed)}%`),
            `THEN 2`,
            ...(tsquery
              ? [
                  `WHEN to_tsvector('simple', coalesce(${title}, '')) @@`,
                  ...tsquery,
                  `THEN 1`,
                ]
              : []),
            `ELSE 0 END`,
            ...(tsquery
              ? [
                  `+ ts_rank_cd(COALESCE(${rankVector('i', staged)}, ''::tsvector),`,
                  ...tsquery,
                  `, 32)`,
                ]
              : []),
            `)`,
          ],
          sqlite: [
            `(CASE WHEN lower(i.search_doc ->> '${CARD_TITLE_KEY}') =`,
            param(typed),
            `THEN 3 WHEN lower(i.search_doc ->> '${CARD_TITLE_KEY}') LIKE`,
            param(`${escapeSqliteLikePattern(typed)}%`),
            `ESCAPE '\\' THEN 2 ELSE 1 END)`,
          ],
        }),
      ]);
    }
    if (scores.length === 0) {
      return ['0'];
    }
    if (scores.length === 1) {
      return scores[0];
    }
    let out: CardExpression = ['GREATEST('];
    scores.forEach((score, i) => {
      if (i > 0) {
        out.push(',');
      }
      out.push(...score);
    });
    out.push(')');
    return out;
  }

  // An `any` whose every branch an index answers on its own — a full-text
  // `matches` (the markdown GIN index) or a `contains` on a row's title (the
  // title trigram indexes) — compiled as one membership test against the
  // UNION of each branch's matching keys. Written as an OR of per-row
  // conditions instead, Postgres can't combine indexes across the two tables
  // and scans every row of the realm, reading each row's whole search doc to
  // test its title; the union lets each index find its few rows first. This
  // is the search sheet's term filter (`matches` OR `_title` OR `cardTitle`).
  // A branch carrying a type anchor, or any other operator, keeps the general
  // compilation. Postgres only; SQLite has neither index.
  #anyAsIndexedUnion(
    branches: Filter[],
    context: FilterContext,
  ): CardExpression | undefined {
    if (this.#dbAdapter.kind !== 'pg' || branches.length < 2) {
      return undefined;
    }
    let selects: CardExpression[] = [];
    for (let branch of branches) {
      if ('on' in branch || 'type' in branch) {
        return undefined;
      }
      if (isMatchesFilter(branch)) {
        if (branch.matches.trim() === '') {
          continue;
        }
        if (branch.scope) {
          return undefined;
        }
        if (branch.within) {
          selects.push([
            `SELECT pp.url, pp.realm_url, pp.type FROM boxel_index_passages AS pp WHERE pp.field_path =`,
            param(branch.within),
            `AND pp.tsv @@`,
            ...matchTsQuery(branch),
          ]);
          continue;
        }
        selects.push([
          `SELECT phm.url, phm.realm_url, phm.type FROM ${context.prerenderedTable} AS phm WHERE ${markdownVector('phm', context.prerenderedTable !== 'prerendered_html')} @@`,
          ...renderedTsQuery(branch),
        ]);
        selects.push([
          `SELECT tsi.url, tsi.realm_url, tsi.type FROM ${context.indexTable} AS tsi WHERE ${searchTextVector('tsi', context.indexTable !== DEFAULT_FILTER_CONTEXT.indexTable)} @@`,
          ...matchTsQuery(branch),
        ]);
        continue;
      }
      if (isTypeAheadFilter(branch)) {
        let query = branch.typoQuery
          ? [`to_tsquery('simple',`, param(branch.typoQuery), `)`]
          : typeAheadTsQuery(branch.typeahead);
        if (query) {
          selects.push([
            `SELECT ti.url, ti.realm_url, ti.type FROM ${context.indexTable} AS ti WHERE ${TYPE_AHEAD_TSVECTOR('ti')} @@`,
            ...query,
          ]);
        }
        continue;
      }
      if (!('contains' in branch) || Object.keys(branch).length !== 1) {
        return undefined;
      }
      let entries = Object.entries(branch.contains);
      if (entries.length !== 1) {
        return undefined;
      }
      let [key, value] = entries[0];
      // A trigram index needs three characters to narrow anything; a shorter
      // term matches most titles, and the general compilation serves it
      // better than a union of nearly every row.
      if (
        typeof value !== 'string' ||
        [...value].length < 3 ||
        !(TRIGRAM_INDEXED_TITLE_KEYS as readonly string[]).includes(key)
      ) {
        return undefined;
      }
      // The key is spliced in as a literal from the fixed list above: the
      // trigram index is on `search_doc ->> '<key>'`, and the planner matches
      // a predicate to an expression index only when the key is a constant.
      selects.push([
        `SELECT ti.url, ti.realm_url, ti.type FROM ${context.indexTable} AS ti WHERE ti.search_doc ->> '${key}' ILIKE`,
        param(`%${value}%`),
      ]);
    }
    if (selects.length === 0) {
      return ['FALSE'];
    }
    let union: CardExpression = [];
    selects.forEach((select, i) => {
      if (i > 0) {
        union.push('UNION');
      }
      union.push(...select);
    });
    return ['(i.url, i.realm_url, i.type) IN (', ...union, ')'];
  }

  // How each requested facet is counted: its shape (a query's `stats`,
  // `ranges` or `interval` wins; otherwise the field's declared
  // `search: { facet }`, read from the type the filter is anchored on), and
  // whether it is plain values counted with the page.
  async #facetPlans(
    facets: Facet[],
    filter: Filter | undefined,
  ): Promise<FacetPlan[]> {
    if (facets.length === 0) {
      return [];
    }
    let anchor = filterAnchor(filter);
    let definition: Definition | undefined;
    if (anchor) {
      try {
        definition = await this.getDefinition(anchor);
      } catch {
        definition = undefined;
      }
    }
    let plans: FacetPlan[] = [];
    for (let facet of facets) {
      let link = false;
      if (definition) {
        try {
          let field = await getField(
            definition,
            facet.by,
            this.#definitionLookup,
          );
          link = field.type === 'linksTo' || field.type === 'linksToMany';
        } catch {
          link = false;
        }
      }
      let shape: FacetShape = facet.ranges
        ? 'range'
        : facet.interval
          ? 'date'
          : 'values';
      if (!facet.stats && !facet.ranges && !facet.interval && definition) {
        try {
          let field = await getField(
            definition,
            facet.by,
            this.#definitionLookup,
          );
          let declared = field.search ? field.search.facet : undefined;
          if (declared === true) {
            shape = NUMBER_SERIALIZERS.has(field.serializerName ?? '')
              ? 'range'
              : DATE_SERIALIZERS.has(field.serializerName ?? '')
                ? 'date'
                : 'values';
          } else if (declared) {
            shape = declared;
          }
        } catch {
          // A path the type doesn't declare counts as plain values.
        }
      }
      let plain =
        !link &&
        shape === 'values' &&
        Object.keys(facet).every((key) => key === 'by' || key === 'size');
      plans.push({ facet, shape: link ? 'values' : shape, plain, link });
    }
    return plans;
  }

  // A facet that isn't plain values counted with the page: its counts (by
  // value, by range or by date bucket) and, when it asked for them or its
  // shape implies them, its statistics.
  async #extendedFacet(
    { facet, shape, link }: FacetPlan,
    opts: QueryOptions,
    condition: CardExpression,
  ): Promise<{ counts: FacetCount[]; stats?: FacetStats }> {
    let size = facet.size ?? DEFAULT_FACET_SIZE;
    let interval: FacetInterval | undefined =
      shape === 'date' ? (facet.interval ?? 'month') : undefined;
    let order: 'count' | 'value' | 'measure' =
      facet.order ?? (interval ? 'value' : 'count');
    let wantStats =
      Boolean(facet.stats) ||
      shape !== 'values' ||
      Boolean(facet.missing) ||
      order === 'value' ||
      order === 'measure';
    let stats = wantStats
      ? await this.#facetStatsQuery(facet, opts, condition)
      : undefined;
    let counts: FacetCount[];
    if (shape === 'range') {
      let ranges = facet.ranges ?? autoFacetRanges(stats);
      counts =
        ranges.length > 0
          ? await this.#facetRangeCounts(facet, ranges, opts, condition)
          : await this.#facetValueCounts(facet, size, order, opts, condition);
    } else if (interval) {
      counts = await this.#facetIntervalCounts(
        facet,
        interval,
        size,
        order === 'measure' ? 'count' : order,
        opts,
        condition,
      );
    } else {
      counts = await this.#facetValueCounts(
        facet,
        size,
        order,
        opts,
        condition,
        link,
      );
      if (link) {
        counts = await this.#labelLinkCounts(counts, opts);
      }
    }
    if (!stats) {
      return { counts };
    }
    let out: FacetStats = { count: stats.count, distinct: stats.distinct };
    if (facet.stats || shape !== 'values') {
      Object.assign(out, stats);
    }
    if (facet.missing) {
      let [row] = await this.#queryCards(
        [
          'SELECT COUNT(*) AS total FROM (SELECT DISTINCT i.url, i.type',
          `FROM ${tableFromOpts(opts)} AS i ${prerenderedJoin(opts)} ${tableValuedFunctionsPlaceholder}`,
          'WHERE',
          ...condition,
          ') AS t',
        ],
        opts.timings,
      );
      out.missing = Math.max(0, Number(row?.total ?? 0) - stats.count);
    }
    if (shape !== 'range') {
      out.order = order;
    }
    return { counts, stats: out };
  }

  // The facet's values over the rows `condition` admits, one row per match
  // and distinct value (a list contributes each element): `value` as text
  // and `num` when it is a number.
  #facetValuesTable(
    facet: Facet,
    opts: QueryOptions,
    condition: CardExpression,
    // A link's values are `{ id, … }` objects; it counts their ids.
    link = false,
  ): CardExpression {
    let path = facet.by.split('.');
    let measured = facetMeasureOf(facet);
    let pgMeasure: Expression = measured
      ? [
          ", (SELECT CASE WHEN jsonb_typeof(mv.v) = 'number' THEN (mv.v #>> '{}')::numeric END FROM (SELECT spill_unmark(i.search_doc #>",
          param(
            `{${measured.path
              .split('.')
              .map((p) => `"${p}"`)
              .join(',')}}`,
          ),
          '::text[]) AS v) AS mv) AS m',
        ]
      : [', NULL AS m'];
    let sqliteMeasure: Expression = measured
      ? [
          ', CASE WHEN json_type(i.search_doc,',
          param(`$.${measured.path}`),
          ") IN ('integer', 'real') THEN json_extract(i.search_doc,",
          param(`$.${measured.path}`),
          ') END AS m',
        ]
      : [', NULL AS m'];
    let pgValue = link ? `fv0.value ->> 'id'` : `fv0.value #>> '{}'`;
    let sqliteValue = link ? `json_extract(fv0.value, '$.id')` : 'fv0.value';
    return [
      dbExpression({
        pg: [
          `(SELECT DISTINCT f.url, f.type, ${pgValue} AS value, CASE WHEN jsonb_typeof(fv0.value) = 'number' THEN (fv0.value #>> '{}')::numeric END AS num, f.m AS measure FROM (`,
          'SELECT DISTINCT i.url, i.type, spill_unmark(i.search_doc #>',
          param(`{${path.map((p) => `"${p}"`).join(',')}}`),
          '::text[]) AS v',
          ...pgMeasure,
        ],
        sqlite: [
          `(SELECT DISTINCT f.url, f.type, ${sqliteValue} AS value, CASE WHEN fv0.type IN ('integer', 'real') THEN fv0.value END AS num, f.m AS measure FROM (`,
          'SELECT DISTINCT i.url, i.type, i.search_doc ->',
          param(`$.${facet.by}`),
          'AS v',
          ...sqliteMeasure,
        ],
      }),
      `FROM ${tableFromOpts(opts)} AS i ${prerenderedJoin(opts)} ${tableValuedFunctionsPlaceholder}`,
      'WHERE',
      ...condition,
      ') AS f',
      dbExpression({
        pg: [
          `CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(f.v) = 'array' THEN f.v ELSE jsonb_build_array(f.v) END) AS fv0(value)`,
          `WHERE jsonb_typeof(fv0.value) <> 'null'`,
        ],
        sqlite: [
          `CROSS JOIN json_each(CASE WHEN json_type(f.v) = 'array' THEN f.v ELSE json_array(json(f.v)) END) AS fv0`,
          `WHERE fv0.type <> 'null'`,
        ],
      }),
      ') AS fv',
    ];
  }

  async #facetValueCounts(
    facet: Facet,
    size: number,
    order: 'count' | 'value' | 'measure',
    opts: QueryOptions,
    condition: CardExpression,
    link = false,
  ): Promise<FacetCount[]> {
    let measured = facetMeasureOf(facet);
    let rows = await this.#queryCards(
      [
        'SELECT fv.value AS facet_value, COUNT(*) AS count',
        measured
          ? `, ${measured.op.toUpperCase()}(fv.measure) AS facet_measure`
          : '',
        'FROM',
        ...this.#facetValuesTable(facet, opts, condition, link),
        ...(facet.prefix
          ? [
              'WHERE LOWER(fv.value) LIKE LOWER(',
              param(`${escapeSqliteLikePattern(facet.prefix)}%`),
              `) ESCAPE '\\'`,
            ]
          : []),
        'GROUP BY fv.value',
        order === 'value'
          ? 'ORDER BY fv.value'
          : order === 'measure' && measured
            ? 'ORDER BY facet_measure DESC NULLS LAST, count DESC, fv.value'
            : 'ORDER BY count DESC, fv.value',
        `LIMIT ${Number(size)}`,
      ],
      opts.timings,
    );
    let kept = rows.filter((row) => row.facet_value != null);
    let counts = facetCountsOf(kept);
    if (measured) {
      counts = counts.map((c, i) =>
        kept[i].facet_measure == null
          ? c
          : { ...c, measure: { [measured.op]: Number(kept[i].facet_measure) } },
      );
    }
    return counts;
  }

  // Labels each link facet value (a linked card's id) with that card's
  // indexed title, in one lookup for the values returned. A value whose card
  // isn't indexed in this realm keeps no label; the id still renders the card
  // by delegating to its prerendered HTML.
  async #labelLinkCounts(
    counts: FacetCount[],
    opts: QueryOptions,
  ): Promise<FacetCount[]> {
    if (counts.length === 0) {
      return counts;
    }
    let ids = counts.map((c) => c.value);
    let rows = await this.#queryCards(
      [
        `SELECT i.file_alias AS card_id, i.search_doc ->> '${CARD_TITLE_KEY}' AS card_title FROM ${tableFromOpts(opts)} AS i WHERE i.type = 'instance' AND i.file_alias IN`,
        ...addExplicitParens(separatedByCommas(ids.map((id) => [param(id)]))),
      ],
      opts.timings,
    );
    let titles = new Map(
      rows
        .filter((row) => row.card_title != null)
        .map((row) => [String(row.card_id), String(row.card_title)]),
    );
    return counts.map((c) =>
      titles.has(c.value) ? { ...c, label: titles.get(c.value)! } : c,
    );
  }

  async #facetStatsQuery(
    facet: Facet,
    opts: QueryOptions,
    condition: CardExpression,
  ): Promise<FacetStats> {
    let [row] = await this.#queryCards(
      [
        `SELECT COUNT(DISTINCT fv.url || '|' || fv.type) AS count, COUNT(DISTINCT fv.value) AS distinct_count, COUNT(fv.num) AS numeric_count, MIN(fv.num) AS min_num, MAX(fv.num) AS max_num, SUM(fv.num) AS sum_num, MIN(fv.value) AS min_text, MAX(fv.value) AS max_text FROM`,
        ...this.#facetValuesTable(facet, opts, condition),
      ],
      opts.timings,
    );
    let stats: FacetStats = {
      count: Number(row?.count ?? 0),
      distinct: Number(row?.distinct_count ?? 0),
    };
    let values = Number(row?.numeric_count ?? 0);
    if (values > 0) {
      let sum = Number(row!.sum_num);
      Object.assign(stats, {
        values,
        min: Number(row!.min_num),
        max: Number(row!.max_num),
        sum,
        avg: sum / values,
      });
    } else if (row?.min_text != null) {
      Object.assign(stats, {
        min: String(row.min_text),
        max: String(row.max_text),
      });
    }
    return stats;
  }

  async #facetRangeCounts(
    facet: Facet,
    ranges: FacetRange[],
    opts: QueryOptions,
    condition: CardExpression,
  ): Promise<FacetCount[]> {
    let columns: CardExpression = [];
    ranges.forEach((range, index) => {
      let column =
        typeof (range.from ?? range.to) === 'number' ? 'fv.num' : 'fv.value';
      let bounds: CardExpression = [];
      if (range.from !== undefined) {
        bounds.push(`${column} >=`, param(range.from));
      }
      if (range.to !== undefined) {
        bounds.push(
          ...(bounds.length ? ['AND'] : []),
          `${column} <`,
          param(range.to),
        );
      }
      columns.push(
        ...(index > 0 ? [','] : []),
        `COUNT(DISTINCT CASE WHEN ${column} IS NOT NULL AND`,
        ...bounds,
        `THEN fv.url || '|' || fv.type END) AS r${index}`,
      );
    });
    let [row] = await this.#queryCards(
      [
        'SELECT',
        ...columns,
        'FROM',
        ...this.#facetValuesTable(facet, opts, condition),
      ],
      opts.timings,
    );
    return ranges.map((range, index) => ({
      value: facetRangeLabel(range),
      count: Number(row?.[`r${index}`] ?? 0),
    }));
  }

  async #facetIntervalCounts(
    facet: Facet,
    interval: FacetInterval,
    size: number,
    order: 'count' | 'value',
    opts: QueryOptions,
    condition: CardExpression,
  ): Promise<FacetCount[]> {
    let pgInstant = `CASE WHEN fv.num IS NOT NULL THEN to_timestamp((CASE WHEN abs(fv.num) >= 100000000000 THEN fv.num / 1000 ELSE fv.num END)::float8) AT TIME ZONE 'UTC' WHEN fv.value ~ '^\\d{4}-\\d{2}-\\d{2}' THEN fv.value::timestamptz AT TIME ZONE 'UTC' END`;
    let sqliteInstant = `CASE WHEN fv.num IS NOT NULL THEN datetime(CASE WHEN abs(fv.num) >= 100000000000 THEN fv.num / 1000.0 ELSE fv.num END, 'unixepoch') ELSE datetime(fv.value) END`;
    let sqliteBucket = {
      day: `date(${sqliteInstant})`,
      week: `date(${sqliteInstant}, '-6 days', 'weekday 1')`,
      month: `strftime('%Y-%m-01', ${sqliteInstant})`,
      year: `strftime('%Y-01-01', ${sqliteInstant})`,
    }[interval];
    let rows = await this.#queryCards(
      [
        'SELECT b.bucket AS facet_value, COUNT(DISTINCT b.k) AS count FROM (SELECT',
        dbExpression({
          pg: [
            `to_char(date_trunc('${interval}', ${pgInstant}), 'YYYY-MM-DD') AS bucket`,
          ],
          sqlite: [`${sqliteBucket} AS bucket`],
        }),
        `, fv.url || '|' || fv.type AS k FROM`,
        ...this.#facetValuesTable(facet, opts, condition),
        ') AS b WHERE b.bucket IS NOT NULL GROUP BY b.bucket',
        order === 'value'
          ? 'ORDER BY b.bucket'
          : 'ORDER BY count DESC, b.bucket',
        `LIMIT ${Number(size)}`,
      ],
      opts.timings,
    );
    return facetCountsOf(rows);
  }

  // One facet's counts over the rows the filter matches (the same FROM and
  // WHERE as the page's count, so counts agree with `page.total`). Each
  // matched (url, type) pair counts once per distinct value it holds; a list
  // field (a JSON array in the search doc) contributes each element.
  #facetQuery(
    facet: Facet,
    opts: QueryOptions,
    everyCondition: CardExpression,
  ): CardExpression {
    let size = facet.size ?? DEFAULT_FACET_SIZE;
    let path = facet.by.split('.');
    return [
      dbExpression({
        pg: [
          'SELECT fv.value AS value, COUNT(*) AS count FROM (',
          'SELECT DISTINCT f.url, f.type, fv0.value FROM (',
          // `spill_unmark` resolves a spilled value (a long list, say).
          'SELECT DISTINCT i.url, i.type, spill_unmark(i.search_doc #>',
          param(`{${path.map((p) => `"${p}"`).join(',')}}`),
          '::text[]) AS v',
        ],
        sqlite: [
          'SELECT fv.value AS value, COUNT(*) AS count FROM (',
          'SELECT DISTINCT f.url, f.type, fv0.value FROM (',
          'SELECT DISTINCT i.url, i.type, i.search_doc ->',
          param(`$.${facet.by}`),
          'AS v',
        ],
      }),
      `FROM ${tableFromOpts(opts)} AS i ${prerenderedJoin(opts)} ${tableValuedFunctionsPlaceholder}`,
      'WHERE',
      ...everyCondition,
      ') AS f',
      dbExpression({
        pg: [
          `CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(f.v) = 'array' THEN f.v ELSE jsonb_build_array(f.v) END) AS fv0(value)`,
        ],
        sqlite: [
          `CROSS JOIN json_each(CASE WHEN json_type(f.v) = 'array' THEN f.v ELSE json_array(json(f.v)) END) AS fv0`,
        ],
      }),
      'WHERE fv0.value IS NOT NULL',
      ') AS fv',
      'GROUP BY fv.value',
      'ORDER BY count DESC, fv.value',
      `LIMIT ${Number(size)}`,
    ];
  }

  // A `matches … within <field>` predicate: the card has a passage in that field
  // whose text matches. Postgres asks the passages table's GIN index once
  // (an uncorrelated IN, hashed per row); SQLite looks for the words in the
  // field's search-doc JSON.
  #passageMatchCondition(filter: MatchesFilter, field: string): CardExpression {
    return [
      dbExpression({
        pg: [
          `(i.url, i.realm_url, i.type) IN (SELECT pp.url, pp.realm_url, pp.type FROM boxel_index_passages AS pp WHERE pp.field_path =`,
          param(field),
          `AND pp.tsv @@`,
          ...matchTsQuery(filter),
          `)`,
        ],
        sqlite: [
          `LOWER(coalesce(i.search_doc ->>`,
          param(`$.${field}`),
          `, '')) LIKE LOWER(`,
          param(`%${escapeSqliteLikePattern(filter.matches)}%`),
          `) ESCAPE '\\'`,
        ],
      }),
    ];
  }

  // A card's best passage score for passage-scoped terms (per row, before
  // aggregation), 0 when none matches. SQLite has no ranking: 1 or 0.
  #passageRelevance(terms: MatchTerm[]): CardExpression {
    let pg: Expression = ['GREATEST(0'];
    let sqlite: Expression = ['(CASE WHEN ('];
    terms.forEach((term, index) => {
      pg.push(
        `, (SELECT MAX(ts_rank_cd(pr.tsv,`,
        ...matchTsQuery(term),
        `, 32)) FROM boxel_index_passages AS pr WHERE pr.realm_url = i.realm_url AND pr.url = i.url AND pr.type = i.type AND pr.field_path =`,
        param(term.within!),
        `AND pr.tsv @@`,
        ...matchTsQuery(term),
        `)`,
      );
      sqlite.push(
        ...(index > 0 ? ['OR'] : []),
        `LOWER(coalesce(i.search_doc ->>`,
        param(`$.${term.within!}`),
        `, '')) LIKE LOWER(`,
        param(`%${escapeSqliteLikePattern(term.matches)}%`),
        `) ESCAPE '\\'`,
      );
    });
    pg.push(')');
    sqlite.push(') THEN 1 ELSE 0 END)');
    return [dbExpression({ pg, sqlite })];
  }

  // The passages that matched a search's passage-scoped terms, for the cards
  // on the returned page: up to `PASSAGES_PER_CARD` per card and field, best
  // first, keyed by card URL. Postgres only.
  async #pagePassages(
    realmURL: URL,
    terms: MatchTerm[],
    urls: string[],
  ): Promise<Record<string, PassageMatch[]> | undefined> {
    if (
      this.#dbAdapter.kind !== 'pg' ||
      terms.length === 0 ||
      urls.length === 0
    ) {
      return undefined;
    }
    let byField = new Map<string, MatchTerm[]>();
    for (let term of terms) {
      byField.set(term.within!, [...(byField.get(term.within!) ?? []), term]);
    }
    let found: Record<string, PassageMatch[]> = {};
    for (let [field, fieldTerms] of byField) {
      let tsQuery: Expression = [];
      fieldTerms.forEach((term, index) => {
        if (index > 0) {
          tsQuery.push('||');
        }
        tsQuery.push(...matchTsQuery(term));
      });
      let rows = (await this.#query([
        `SELECT url, ordinal, start_at, end_at, score FROM (SELECT pp.url, pp.ordinal, pp.start_at, pp.end_at, ts_rank_cd(pp.tsv, (`,
        ...tsQuery,
        `), 32) AS score, ROW_NUMBER() OVER (PARTITION BY pp.url ORDER BY ts_rank_cd(pp.tsv, (`,
        ...tsQuery,
        `), 32) DESC, pp.ordinal) AS rank FROM boxel_index_passages AS pp WHERE pp.realm_url =`,
        param(realmURL.href),
        `AND pp.field_path =`,
        param(field),
        `AND pp.url IN`,
        ...addExplicitParens(
          separatedByCommas(urls.map((url) => [param(url)])),
        ),
        `AND pp.tsv @@ (`,
        ...tsQuery,
        `)) AS ranked WHERE rank <=`,
        param(PASSAGES_PER_CARD),
        `ORDER BY url, score DESC, ordinal`,
      ] as Expression)) as {
        url: string;
        ordinal: number;
        start_at: number | null;
        end_at: number | null;
        score: number;
      }[];
      for (let row of rows) {
        let key = row.url.replace(/\.json$/, '');
        (found[key] ??= []).push({
          field,
          ordinal: Number(row.ordinal),
          start: row.start_at == null ? null : Number(row.start_at),
          end: row.end_at == null ? null : Number(row.end_at),
          score: Number(row.score),
        });
      }
    }
    return found;
  }

  // Type-ahead: every typed word is a word prefix of the card's `_typeahead`
  // text. Postgres matches an unstemmed ('simple') tsvector of that text,
  // which the `add-type-ahead-index` migration indexes; like a prefix
  // `matches`, it asks the index once through an uncorrelated IN, because the
  // planner can't estimate a prefix query and beside a type anchor would
  // otherwise test every typed row. SQLite requires each word as a substring.
  private typeAheadCondition(
    filter: TypeAheadFilter,
    typeConditionRef: CodeRef | undefined,
    context: FilterContext,
  ): CardExpression {
    let words = typeAheadWords(filter.typeahead).filter(
      (w) => !TYPE_AHEAD_STOP_WORDS.has(w),
    );
    let query = filter.typoQuery
      ? [`to_tsquery('simple',`, param(filter.typoQuery), `)`]
      : typeAheadTsQuery(filter.typeahead);
    let predicate: CardExpression = !query
      ? ['FALSE']
      : [
          dbExpression({
            pg: [
              `(i.url, i.realm_url, i.type) IN (SELECT ti.url, ti.realm_url, ti.type FROM ${context.indexTable} AS ti WHERE ${TYPE_AHEAD_TSVECTOR('ti')} @@`,
              ...query,
              `)`,
            ],
            sqlite: words.flatMap((word, index) => [
              ...(index > 0 ? ['AND'] : []),
              `LOWER(coalesce(i.search_doc ->> '${TYPE_AHEAD_KEY}', '')) LIKE`,
              param(`%${escapeSqliteLikePattern(word)}%`),
              `ESCAPE '\\'`,
            ]),
          }),
        ];
    return every([
      ...(typeConditionRef ? [this.typeCondition(typeConditionRef)] : []),
      predicate,
    ]);
  }

  // Full-text matches predicate. Postgres uses tsvector/tsquery on the
  // indexed markdown column; SQLite falls back to a case-insensitive
  // substring LIKE with `%`/`_`/`\` escaped in JS before binding. An
  // empty/whitespace-only query short-circuits to FALSE so SQLite doesn't
  // match every non-null row (PG's websearch_to_tsquery already yields an
  // empty tsquery that matches nothing — we match that behavior here).
  //
  // Markdown is a render output and lives on `prerendered_html.markdown`, so
  // full-text membership is eventually consistent: a row whose prerender-html
  // job hasn't landed yet has no markdown and is not full-text findable until
  // it does. The predicate is an expression match against the GIN-indexed
  // `to_tsvector('english', markdown_search_text(markdown))` —
  // `markdown_search_text` strips oversized base64 runs and caps length so
  // the tsvector stays under Postgres's byte limit, and the predicate must
  // call the same function as the migration's index expression or the
  // planner won't use the index.
  private matchesCondition(
    filter: MatchesFilter,
    _on: CodeRef,
    typeConditionRef?: CodeRef,
    context: FilterContext = DEFAULT_FILTER_CONTEXT,
  ): CardExpression {
    let typeRef = typeConditionRef;
    if (filter.within && filter.matches.trim() !== '') {
      return every([
        ...(typeRef ? [this.typeCondition(typeRef)] : []),
        this.#passageMatchCondition(filter, filter.within),
      ]);
    }
    if (filter.scope === 'title' && filter.matches.trim() !== '') {
      return every([
        ...(typeRef ? [this.typeCondition(typeRef)] : []),
        this.#titleScopedMatchCondition(filter, context),
      ]);
    }
    if (filter.fields?.length && filter.matches.trim() !== '') {
      return every([
        ...(typeRef ? [this.typeCondition(typeRef)] : []),
        this.#fieldScopedMatchCondition(filter, filter.fields),
      ]);
    }
    let predicate: CardExpression =
      filter.matches.trim() === ''
        ? ['FALSE']
        : [
            dbExpression({
              // Always an uncorrelated IN, which becomes a hashed SubPlan: the
              // markdown GIN index answers the term once, and each row is a
              // hash probe. Inline beside a type anchor, Postgres estimates a
              // term's matches from statistics, and for some words (a prefix,
              // or a plain word like "compiler") it guesses high and recomputes
              // the tsvector of every typed row: ~2 s over 6k talk transcripts
              // where the index answers in ~10 ms. Under an `any` the LEFT JOIN
              // to prerendered_html can't be reduced, so the inline form
              // recomputes every row there too. Keyed on the join's own primary
              // key, it selects exactly the rows the inline form would, and the
              // subquery never yields NULL, so it negates cleanly under `not`.
              //
              // `OFFSET 0` fences the subquery so Postgres keeps it a hashed
              // SubPlan. Without it the planner flattens the IN into a join
              // and picks the driving side from its estimate of the term; for
              // a term it guesses is common ("compiler") it drives from every
              // typed row and recomputes that row's tsvector as a filter on a
              // primary-key probe (6,449 talks × 0.8 ms = 1.7 s, once for the
              // page and again for the count). A phrase is the exception: the
              // index holds no word positions, so a fenced phrase rechecks
              // every row holding all its words across the table (60 s for
              // "type system"), while the unfenced plan rechecks only the
              // typed rows.
              //
              // A card matches by its rendered markdown or by its fields'
              // role-weighted vector (`search_tsv`), which holds the words of
              // fields the card doesn't render, such as a transcript's
              // segments. Each side is its own GIN-indexed lookup, so the
              // union stays an index answer.
              pg: [
                `(i.url, i.realm_url, i.type) IN (SELECT phm.url, phm.realm_url, phm.type FROM ${context.prerenderedTable} AS phm WHERE ${markdownVector('phm', context.prerenderedTable !== 'prerendered_html')} @@`,
                ...renderedTsQuery(filter),
                `UNION SELECT tsi.url, tsi.realm_url, tsi.type FROM ${context.indexTable} AS tsi WHERE ${searchTextVector('tsi', context.indexTable !== DEFAULT_FILTER_CONTEXT.indexTable)} @@`,
                ...matchTsQuery(filter),
                filter.matches.includes('"') ? `)` : `OFFSET 0)`,
              ],
              sqlite: [
                `LOWER(coalesce(ph.markdown, '')) LIKE LOWER(`,
                param(`%${escapeSqliteLikePattern(filter.matches)}%`),
                `) ESCAPE '\\'`,
              ],
            }),
          ];
    return every([
      ...(typeRef ? [this.typeCondition(typeRef)] : []),
      predicate,
    ]);
  }

  // `linkedFrom`: the ids `card` links to at `field`, read from its search
  // doc (a link is `{ id }` there, a list of them for linksToMany), matched
  // against each row's card id. The source must be a live card instance in
  // the realm being searched, so a search never reads another realm's links.
  #linkedFromCondition(
    filter: LinkedFromFilter,
    context: FilterContext,
  ): CardExpression {
    let card = filter.linkedFrom.card.replace(/\.json$/, '');
    let path = filter.linkedFrom.field;
    return [
      dbExpression({
        pg: [
          `i.file_alias IN (SELECT lf.value ->> 'id' FROM ${context.indexTable} AS lfs CROSS JOIN LATERAL jsonb_array_elements(CASE jsonb_typeof(spill_unmark(lfs.search_doc #>`,
          param(
            `{${path
              .split('.')
              .map((p) => `"${p}"`)
              .join(',')}}`,
          ),
          `::text[])) WHEN 'array' THEN spill_unmark(lfs.search_doc #>`,
          param(
            `{${path
              .split('.')
              .map((p) => `"${p}"`)
              .join(',')}}`,
          ),
          `::text[]) WHEN 'object' THEN jsonb_build_array(spill_unmark(lfs.search_doc #>`,
          param(
            `{${path
              .split('.')
              .map((p) => `"${p}"`)
              .join(',')}}`,
          ),
          `::text[])) ELSE '[]'::jsonb END) AS lf(value) WHERE lfs.file_alias =`,
          param(card),
          `AND lfs.type = 'instance' AND lfs.realm_url = i.realm_url AND (lfs.is_deleted IS NOT TRUE) AND lf.value ->> 'id' IS NOT NULL)`,
        ],
        sqlite: [
          `i.file_alias IN (SELECT json_extract(lf.value, '$.id') FROM ${context.indexTable} AS lfs, json_each(CASE json_type(lfs.search_doc,`,
          param(`$.${path}`),
          `) WHEN 'array' THEN json_extract(lfs.search_doc,`,
          param(`$.${path}`),
          `) WHEN 'object' THEN json_array(json_extract(lfs.search_doc,`,
          param(`$.${path}`),
          `)) ELSE '[]' END) AS lf WHERE lfs.file_alias =`,
          param(card),
          `AND lfs.type = 'instance' AND lfs.realm_url = i.realm_url AND (lfs.is_deleted IS NULL OR lfs.is_deleted = 0))`,
        ],
      }),
    ];
  }

  // A `matches … fields` term: the words of those search-doc values alone,
  // stemmed and case-insensitive as everywhere else. The values are read
  // whole (`spill_unmark`, so a spilled value counts) and a list's values all
  // count. Nothing indexes this text, so it is computed for each row the
  // rest of the filter admits. SQLite matches a case-insensitive substring.
  #fieldScopedMatchCondition(
    filter: MatchesFilter,
    fields: string[],
  ): CardExpression {
    let pgText: Expression = ["to_tsvector('english', concat_ws(' '"];
    for (let path of fields) {
      pgText.push(
        ', spill_unmark(i.search_doc #>',
        param(
          `{${path
            .split('.')
            .map((p) => `"${p}"`)
            .join(',')}}`,
        ),
        "::text[]) #>> '{}'",
      );
    }
    pgText.push('))');
    let sqliteText: Expression = ['LOWER(', "''"];
    for (let path of fields) {
      sqliteText.push(
        "|| ' ' || coalesce(json_extract(i.search_doc,",
        param(`$.${path}`),
        "), '')",
      );
    }
    sqliteText.push(')');
    return [
      dbExpression({
        pg: [...pgText, '@@', ...matchTsQuery(filter)],
        sqlite: [
          ...sqliteText,
          'LIKE LOWER(',
          param(`%${escapeSqliteLikePattern(filter.matches)}%`),
          `) ESCAPE '\\'`,
        ],
      }),
    ];
  }

  // A `matches … scope: 'title'` term: the card's title, name and alias
  // words, which its role-weighted vector holds at weight A. The vector's GIN
  // index finds the rows holding the words anywhere, and `ts_filter` keeps
  // those holding them at A. SQLite has no vector; it reads the type-ahead
  // text, which holds the same names.
  #titleScopedMatchCondition(
    filter: MatchesFilter,
    context: FilterContext,
  ): CardExpression {
    let vector = searchTextVector(
      'ti',
      context.indexTable !== DEFAULT_FILTER_CONTEXT.indexTable,
    );
    return [
      dbExpression({
        pg: [
          `(i.url, i.realm_url, i.type) IN (SELECT ti.url, ti.realm_url, ti.type FROM ${context.indexTable} AS ti WHERE ${vector} @@`,
          ...matchTsQuery(filter),
          `AND ts_filter(${vector}, '{a}') @@`,
          ...matchTsQuery(filter),
          `OFFSET 0)`,
        ],
        sqlite: [
          `LOWER(coalesce(i.search_doc ->> '${TYPE_AHEAD_KEY}', '')) LIKE LOWER(`,
          param(`%${escapeSqliteLikePattern(filter.matches)}%`),
          `) ESCAPE '\\'`,
        ],
      }),
    ];
  }

  private fieldEqFilter(
    key: string,
    value: JSONTypes.Value,
    onRef: CodeRef,
    polarity: FilterPolarity = 'positive',
  ): CardExpression {
    if (
      currentField(key) === CARD_INSTANCE_FILE_KEY &&
      typeof value === 'boolean'
    ) {
      // Synthetic boolean search-doc key, stamped `true` only on the file row of
      // a dual-indexed card `.json` and omitted (never stamped `false`)
      // everywhere else. Because the key is present exactly when it is true,
      // membership is an existence test: `eq: false` ("not a card-instance
      // file", which must also match rows lacking the key) is `->> IS NULL`, and
      // `eq: true` is `->> IS NOT NULL`. This deliberately avoids comparing the
      // extracted value against a boolean literal: `->>` of a JSON boolean
      // renders as 'true'/'false' on Postgres but 1/0 on SQLite, so a
      // `= 'true'` comparison would silently diverge between adapters. `IS
      // [NOT] NULL` is adapter-agnostic and inverts cleanly when `notCondition`
      // wraps this in `NOT (...)`, so polarity needs no special handling here.
      let extracted = fieldQuery(key, onRef, false, 'filter');
      return [
        fieldArity({
          type: onRef,
          path: key,
          value: [extracted, value ? 'IS NOT NULL' : 'IS NULL'],
          errorHint: 'filter',
        }),
      ];
    }
    if (value === null) {
      let query = fieldQuery(key, onRef, true, 'filter');
      return [
        fieldArity({
          type: onRef,
          path: key,
          value: [query, 'IS NULL'],
          pluralValue: [query, "= 'null'::jsonb"],
          usePluralContainer: true,
          errorHint: 'filter',
        }),
      ];
    }
    // Note: the canonical-RRI tolerance (see `expandReferenceFilterValues`) is
    // applied to `in` filters only. `eq` on a reference field keeps exact-match
    // semantics so a singular `.id` eq is still served by the `@>` GIN
    // containment path below; canonical-RRI reference matching uses `in`.
    let query = fieldQuery(key, onRef, false, 'filter');
    let v = fieldValue(key, [param(value)], onRef, 'filter');
    // At positive polarity a singular-path string `eq` can be served by the GIN
    // `search_doc` index via a `@>` containment predicate. fieldArity routes on
    // cardinality only: the singular branch resolves the containment-capable
    // node (which itself falls back to `->>` extraction for numeric/non-string
    // leaves), while a plural path anywhere uses the json_tree machinery. At
    // negated polarity we keep plain extraction, whose NULL-on-absent-path
    // semantics `@>` cannot reproduce under `NOT`.
    if (polarity === 'positive') {
      return [
        fieldArity({
          type: onRef,
          path: key,
          value: [jsonContainsQuery(key, onRef, [param(value)])],
          pluralValue: [query, '=', v],
          errorHint: 'filter',
        }),
      ];
    }
    return [
      fieldArity({
        type: onRef,
        path: key,
        value: [query, '=', v],
        errorHint: 'filter',
      }),
    ];
  }

  private fieldInFilter(
    key: string,
    values: JSONTypes.Value[],
    onRef: CodeRef,
    polarity: FilterPolarity = 'positive',
    context: FilterContext = DEFAULT_FILTER_CONTEXT,
  ): CardExpression {
    if (values.length === 0) {
      // Empty set matches nothing
      return ['false'];
    }
    let nonNullValues = this.expandReferenceFilterValues(
      key,
      values.filter((v) => v !== null),
    );
    let hasNull = values.some((v) => v === null);

    let conditions: CardExpression[] = [];

    if (nonNullValues.length > 0 && polarity === 'positive') {
      // Like a positive `eq`, a positive `in` on a singular path is served by
      // the GIN `search_doc` index: one `@>` containment per value, OR'd, so
      // Postgres plans a BitmapOr of index scans. The `->> IN (...)` form
      // below extracts per row, which no index covers, so it scans every row
      // of the type. A plural path keeps the json_tree machinery. At negated
      // polarity we keep extraction, whose NULL-on-absent-path semantics
      // `@>` cannot reproduce under `NOT` (see `fieldEqFilter`).
      let query = fieldQuery(key, onRef, false, 'filter');
      let inList: CardExpression = [];
      let containments: CardExpression = [];
      nonNullValues.forEach((v, i) => {
        if (i > 0) {
          inList.push(',');
          containments.push('OR');
        }
        inList.push(fieldValue(key, [param(v)], onRef, 'filter'));
        containments.push(jsonContainsQuery(key, onRef, [param(v)]));
      });
      // Postgres misestimates an OR of containments ANDed with a separate
      // type-membership clause, and rechecks every typed row once per value
      // (~0.5 s a value on 6k cards). An uncorrelated IN becomes a hashed
      // SubPlan: the GIN index answers the OR once, and each outer row is a
      // hash probe, whatever else the filter ANDs in. The unqualified
      // `search_doc` in each containment binds to the subquery's own row.
      // Keyed on the index's primary key, so it selects exactly the rows the
      // inline form would.
      let matched: CardExpression =
        this.#dbAdapter.kind === 'pg'
          ? [
              `(i.url, i.realm_url, i.type) IN (SELECT ti.url, ti.realm_url, ti.type FROM ${context.indexTable} AS ti WHERE`,
              ...containments,
              ')',
            ]
          : ['(', ...containments, ')'];
      conditions.push([
        fieldArity({
          type: onRef,
          path: key,
          value: matched,
          pluralValue: [query, 'IN', '(', ...inList, ')'],
          errorHint: 'filter',
        }),
      ]);
    } else if (nonNullValues.length > 0) {
      let query = fieldQuery(key, onRef, false, 'filter');
      let inList: CardExpression = [];
      nonNullValues.forEach((v, i) => {
        if (i > 0) {
          inList.push(',');
        }
        inList.push(fieldValue(key, [param(v)], onRef, 'filter'));
      });
      conditions.push([
        fieldArity({
          type: onRef,
          path: key,
          value: [query, 'IN', '(', ...inList, ')'],
          errorHint: 'filter',
        }),
      ]);
    }

    if (hasNull) {
      let query = fieldQuery(key, onRef, true, 'filter');
      conditions.push([
        fieldArity({
          type: onRef,
          path: key,
          value: [query, 'IS NULL'],
          pluralValue: [query, "= 'null'::jsonb"],
          usePluralContainer: true,
          errorHint: 'filter',
        }),
      ]);
    }

    if (conditions.length === 1) {
      return conditions[0];
    }
    return any(conditions);
  }

  private fieldLikeFilter(
    key: string,
    value: JSONTypes.Value,
    onRef: CodeRef,
  ): CardExpression {
    if (value === null) {
      let query = fieldQuery(key, onRef, true, 'filter');
      return [
        fieldArity({
          type: onRef,
          path: key,
          value: [query, 'IS NULL'],
          pluralValue: [query, "= 'null'::jsonb"],
          usePluralContainer: true,
          errorHint: 'filter',
        }),
      ];
    }
    let query = fieldQuery(key, onRef, false, 'filter');
    let v = fieldValue(key, [param(`%${value}%`)], onRef, 'filter');
    return [
      fieldArity({
        type: onRef,
        path: key,
        value: [query, 'ILIKE', v],
        errorHint: 'filter',
      }),
    ];
  }

  private fieldRangeFilter(
    key: string,
    filterValue: RangeFilterValue,
    onRef: CodeRef,
  ): CardExpression {
    let query = fieldQuery(key, onRef, false, 'filter');
    let cardExpressions: CardExpression[] = [];
    Object.entries(filterValue).forEach(([operator, value]) => {
      if (value == null) {
        throw new Error(`'null' is not a permitted value in a 'range' filter`);
      }
      let v = fieldValue(key, [param(value)], onRef, 'filter');
      cardExpressions.push([
        fieldArity({
          type: onRef,
          path: key,
          value: [query, RANGE_OPERATORS[operator as RangeOperator], v],
          errorHint: 'filter',
        }),
      ]);
    });

    return every(cardExpressions);
  }

  private async makeExpression(query: CardExpression): Promise<Expression> {
    return flatten(
      await Promise.all(
        query.map((element) => {
          if (
            isParam(element) ||
            isDbExpression(element) ||
            typeof element === 'string' ||
            element.kind === 'table-valued-tree' ||
            element.kind === 'json-contains' ||
            element.kind === 'types-contains' ||
            element.kind === 'sort-direction'
          ) {
            return Promise.resolve([element]);
          } else if (element.kind === 'field-query') {
            return this.handleFieldQuery(element);
          } else if (element.kind === 'field-value') {
            return this.handleFieldValue(element);
          } else if (element.kind === 'field-arity') {
            return this.handleFieldArity(element);
          } else if (element.kind === 'json-contains-query') {
            return this.handleJsonContainsQuery(element);
          } else if (element.kind === 'type-condition') {
            return this.handleTypeCondition(element);
          } else {
            throw assertNever(element);
          }
        }),
      ),
    );
  }

  // The goal of this handler is to ensure that the use of table valued
  // json_tree() function that we use for querying thru fields that are plural
  // is confined to the specific JSON path that our query should run. This means
  // that we need to determine the root path for the json_tree() function, as
  // well as the "query path" for the json_tree() function. The query path
  // predicate is AND'ed to the expression contained in the FieldArity
  // expression. Queries that do not go thru a plural field can use the normal
  // '->' and '->>' JSON operators.
  // The result is a query that looks like this:
  //
  //   SELECT url, pristine_doc
  //   FROM
  //     boxel_index,
  //     -- This json_tree was derived by this handler:
  //   CROSS JOIN LATERAL jsonb_tree(search_doc, '$.friends') as friends1_tree
  //   WHERE
  //     ( ( is_deleted = FALSE OR is_deleted IS NULL ) )
  //     AND (
  //       ( COALESCE(types, '[]'::jsonb) @> $1::jsonb )
  //       AND (
  //         ( friends1_tree.text_value = $2 )
  //         AND
  //         -- This predicate was derived by this handler:
  //         ( friends1_tree.fullkey LIKE '$.friends[%].bestFriend.name' )
  //       )
  //     )
  //   GROUP BY url
  //   ORDER BY url

  private async handleFieldArity(fieldArity: FieldArity): Promise<Expression> {
    let { path, value, type, pluralValue, usePluralContainer } = fieldArity;
    let definition = await this.getDefinition(type);
    let exp: CardExpression = await this.walkFilterFieldPath(
      definition,
      path,
      value,
      // Leaf field handler
      async (_definition, expression, pathTraveled) => {
        if (traveledThruPlural(pathTraveled)) {
          return [
            ...every([
              pluralValue ?? expression,
              [
                tableValuedTree(
                  'search_doc',
                  trimPathAtFirstPluralField(pathTraveled),
                  path,
                  'fullkey',
                ),
                `LIKE '$.${
                  usePluralContainer
                    ? convertBracketsToWildCards(
                        trimTrailingBrackets(pathTraveled),
                      )
                    : convertBracketsToWildCards(pathTraveled)
                }'`,
              ],
            ]),
          ];
        }
        return expression;
      },
      undefined,
      // This is a filter path: walk it with the card's `searchable` routes so
      // a hop into a non-searchable relationship is rejected as we cross it.
      seedSearchableRoutesFromDefinition(definition),
    );
    return await this.makeExpression(exp);
  }

  private async handleFieldQuery(fieldQuery: FieldQuery): Promise<Expression> {
    let { path, type, useJsonBValue, errorHint } = fieldQuery;
    let definition = await this.getDefinition(type);
    // The rootPluralPath should line up with the tableValuedTree that was
    // used in the handleFieldArity (the multiple tableValuedTree expressions will
    // collapse into a single function)
    let rootPluralPath: string | undefined;
    let isNumericField = false;
    // Whether the leaf can hold a spilled value (ADR 021): read through
    // `spill_text`, which resolves a marker and is `->>` otherwise. Numbers,
    // booleans and dates never spill, so they keep the raw extraction their
    // casts and indexes expect.
    let readsSpill = false;

    let exp = await this.walkFilterFieldPath(
      definition,
      path,
      [],
      // Leaf field handler
      async (definition, expression, pathTraveled) => {
        let field = await getField(
          definition,
          pathTraveled,
          this.#definitionLookup,
        );
        if (isFieldPlural(field)) {
          rootPluralPath = trimPathAtFirstPluralField(pathTraveled);
          return [
            tableValuedTree(
              'search_doc',
              rootPluralPath,
              path,
              useJsonBValue ? 'jsonb_value' : 'text_value',
            ),
          ];
        } else if (!rootPluralPath) {
          let fieldName = currentField(pathTraveled);
          isNumericField =
            field.serializerName === 'number' ||
            field.serializerName === 'big-integer';
          readsSpill =
            this.#dbAdapter.kind === 'pg' &&
            !NEVER_SPILLED_SERIALIZERS.has(field.serializerName ?? '');
          return [...expression, readsSpill ? '->' : '->>', param(fieldName)];
        }
        return expression;
      },
      // interior field handler
      {
        enter: async (definition, expression, pathTraveled) => {
          // we work forwards determining if any interior fields are plural
          // since that requires a different style predicate
          let field = await getField(
            definition,
            pathTraveled,
            this.#definitionLookup,
          );
          if (isFieldPlural(field)) {
            rootPluralPath = trimPathAtFirstPluralField(pathTraveled);
            return [
              tableValuedTree('search_doc', rootPluralPath, path, 'text_value'),
            ];
          }
          return expression;
        },
        exit: async (definition, expression, pathTraveled) => {
          // we populate the singular fields backwards as we can only do that
          // after we are assured that we are not leveraging the plural style
          // predicate
          let field = await getField(
            definition,
            pathTraveled,
            this.#definitionLookup,
          );
          if (!isFieldPlural(field) && !rootPluralPath) {
            let fieldName = currentField(pathTraveled);
            return ['->', param(fieldName), ...expression];
          }
          return expression;
        },
      },
      // `fieldQuery` serves both filters and sorts; only gate filter paths on
      // searchability (a sort key that isn't in the doc is out of scope here).
      errorHint === 'filter'
        ? seedSearchableRoutesFromDefinition(definition)
        : undefined,
    );
    if (!rootPluralPath) {
      // Numeric fields (NumberField, BigIntegerField) are stored as JSON
      // numbers/strings but PostgreSQL's ->> extracts them as text. Cast to
      // numeric so that ORDER BY and range comparisons use numeric ordering
      // instead of lexicographic ordering (e.g. 100 > 20 > 3, not
      // "100" < "20" < "3"). SQLite's ->> preserves the original JSON type so
      // no cast is needed there.
      if (isNumericField) {
        exp = [
          dbExpression({ pg: '(', sqlite: '' }),
          'search_doc',
          ...exp,
          dbExpression({ pg: ')::numeric', sqlite: '' }),
        ];
      } else if (readsSpill) {
        exp = ['spill_text(search_doc', ...exp, ')'];
      } else {
        exp = ['search_doc', ...exp];
      }
    }
    return exp;
  }

  private async handleFieldValue(fieldValue: FieldValue): Promise<Expression> {
    let { path, value, type } = fieldValue;
    let definition = await this.getDefinition(type);
    let exp = await this.makeExpression(value);

    return await this.walkFilterFieldPath(
      definition,
      path,
      exp,
      // Leaf field handler
      async (definition, expression, pathTraveled) => {
        let queryValue: any;
        let [value] = expression;
        let field = await getField(
          definition,
          pathTraveled,
          this.#definitionLookup,
        );
        let serializer = field.serializerName
          ? getSerializer(field.serializerName)
          : undefined;
        if (isParam(value) && isRelativeDate(value.param)) {
          // `now-30d` and the like, as the field's search doc spells a date.
          let when = new Date(resolveRelativeDate(value.param));
          // A date field holds a calendar day: the UTC day the bound falls
          // on, as the bound itself is reckoned in UTC.
          queryValue =
            field.serializerName === 'date'
              ? when.toISOString().slice(0, 10)
              : field.serializerName === 'datetime'
                ? serializer!.queryableValue(when)
                : when.toISOString();
        } else if (isParam(value)) {
          queryValue = serializer?.formatQuery?.(value.param) ?? value.param;
        } else if (typeof value === 'string') {
          queryValue = serializer?.formatQuery?.(value) ?? value;
        } else {
          throw new Error(
            `Do not know how to handle field value: ${stringify(value)}`,
          );
        }
        return [param(queryValue)];
      },
      undefined,
      // This is a filter path: validate searchability as the walk crosses it.
      seedSearchableRoutesFromDefinition(definition),
    );
  }

  // Resolves a non-null `eq` predicate that fieldArity routed to a singular
  // path (no plural segment was crossed). When the leaf is a string-valued,
  // non-numeric field the predicate becomes a GIN-servable `JsonContains`
  // node; otherwise it degrades to the same `->>` extraction equality the
  // engine has always emitted — numeric leaves keep their `::numeric` cast
  // semantics, non-string values keep text equality.
  private async handleJsonContainsQuery(
    node: JsonContainsQuery,
  ): Promise<Expression> {
    let { path, type, value } = node;
    let resolvedValue = await this.makeExpression([
      fieldValue(path, value, type, 'filter'),
    ]);
    let [leaf] = resolvedValue;
    let definition = await this.getDefinition(type);
    let leafField = await getField(definition, path, this.#definitionLookup);
    let isNumericLeaf =
      leafField.serializerName === 'number' ||
      leafField.serializerName === 'big-integer';
    if (
      isParam(leaf) &&
      typeof leaf.param === 'string' &&
      !isNumericLeaf &&
      // A value longer than the inline limit may be spilled, which a
      // containment can't see, so it compares through `spill_text` instead. A
      // shorter one is always inline (ADR 021 §1.1).
      (this.#dbAdapter.kind !== 'pg' ||
        leaf.param.length <= SEARCH_DOC_INLINE_STRING_MAX)
    ) {
      return [
        {
          kind: 'json-contains',
          column: 'search_doc',
          segments: path.split('.'),
          value: leaf,
        },
      ];
    }
    return await this.makeExpression([
      fieldQuery(path, type, false, 'filter'),
      '=',
      ...resolvedValue,
    ]);
  }

  private async walkFilterFieldPath(
    definition: Definition,
    path: string,
    expression: Expression,
    handleLeafField: FilterFieldHandler<Expression>,
    handleInteriorField?: FilterFieldHandlerWithEntryAndExit<Expression>,
    searchableRoutes?: string[],
    pathTraveled?: string[],
  ): Promise<Expression>;
  private async walkFilterFieldPath(
    definition: Definition,
    path: string,
    expression: CardExpression,
    handleLeafField: FilterFieldHandler<CardExpression>,
    handleInteriorField?: FilterFieldHandlerWithEntryAndExit<CardExpression>,
    searchableRoutes?: string[],
    pathTraveled?: string[],
  ): Promise<CardExpression>;
  private async walkFilterFieldPath(
    definition: Definition,
    path: string,
    expression: Expression,
    handleLeafField: FilterFieldHandler<any[]>,
    handleInteriorField?: FilterFieldHandlerWithEntryAndExit<any[]>,
    // `searchable` routes for this card, supplied (and narrowed to the target's
    // tails on each hop) only when walking a FILTER path — sort paths pass none,
    // which disables the searchability check. Seeded by the caller from the
    // queried card's annotations so the check uses the SAME route model the
    // search-doc generator uses.
    searchableRoutes?: string[],
    pathTraveled: string[] = [],
  ): Promise<any> {
    let pathSegments = path.split('.');
    let isLeaf = pathSegments.length === 1;
    let currentSegment = pathSegments.shift()!;
    let currentPath = removeBrackets(
      [...pathTraveled, currentSegment].join('.'),
    );
    let field = await getField(definition, currentPath, this.#definitionLookup);

    // Validate searchability as we cross each relationship hop. A filter that
    // continues past a `linksTo`/`linksToMany` whose target the search doc does
    // not carry would match nothing silently, so raise a distinct, actionable
    // error instead. `getField` above has already resolved this segment, so a
    // genuinely nonexistent field surfaces as the "nonexistent field" error
    // before we get here.
    let interiorRoutes: string[] | undefined;
    if (searchableRoutes !== undefined) {
      let { matched, tails } = matchSearchableRoutes(
        searchableRoutes,
        currentSegment,
      );
      interiorRoutes = tails;
      if (
        !isLeaf &&
        (field.type === 'linksTo' || field.type === 'linksToMany')
      ) {
        // A path stopping at the link's `id` reads only the always-present
        // `{ id }` sentinel, so it needs no expansion.
        let crossingToIdOnly =
          pathSegments.length === 1 && pathSegments[0] === 'id';
        if (field.query) {
          // Query-backed relationships are never in the search doc at all (not
          // even `{ id }`) — they can't be invalidated when matching cards
          // change — so nothing can be filtered through them.
          throw new FilterRefersToNonsearchableFieldError({
            type: definition.codeRef,
            path: [currentPath, ...pathSegments].join('.'),
            relationshipPath: currentPath,
            reason: 'query-backed',
          });
        }
        // A link declared `search: { include: [...] }` carries the included
        // fields beside its id, so a path into one of those is answerable.
        let crossingToIncluded =
          pathSegments.length === 1 &&
          linkIncludes(field.search, pathSegments[0], pathTraveled.length);
        if (!matched && !crossingToIdOnly && !crossingToIncluded) {
          throw new FilterRefersToNonsearchableFieldError({
            type: definition.codeRef,
            path: [currentPath, ...pathSegments].join('.'),
            relationshipPath: currentPath,
            reason: 'not-searchable',
          });
        }
      }
    }

    // we use '[]' to denote plural fields as that has important ramifications
    // to how we compose our queries in the various handlers and ultimately in
    // SQL construction
    let traveled = [
      ...(pathTraveled ?? []),
      `${currentSegment}${isFieldPlural(field) ? '[]' : ''}`,
    ].join('.');
    if (isLeaf) {
      expression = await handleLeafField(definition, expression, traveled);
    } else {
      let passThru: FilterFieldHandler<any[]> = async (
        _definition,
        e: Expression,
      ) => e;
      // when dealing with an interior field that is not a leaf path segment,
      // the entrance and exit hooks allow you to decorate the expression for
      // the interior field before the interior's antecedant segment's
      // expression is processed and after the interior field's antecedant
      // segment's expression has been processed (i.e. recursing into the
      // antecedant field and recursing out of the antecedant field).
      let entranceHandler = handleInteriorField
        ? handleInteriorField.enter || passThru
        : passThru;
      let exitHandler = handleInteriorField
        ? handleInteriorField.exit || passThru
        : passThru;

      let interiorExpression = await this.walkFilterFieldPath(
        definition,
        pathSegments.join('.'),
        await entranceHandler(definition, expression, traveled),
        handleLeafField,
        handleInteriorField,
        interiorRoutes,
        traveled.split('.'),
      );
      expression = await exitHandler(definition, interiorExpression, traveled);
    }
    return expression;
  }
}

function traveledThruPlural(pathTraveled: string) {
  return pathTraveled.includes('[');
}

function trimTrailingBrackets(pathTraveled: string) {
  return pathTraveled.replace(/\[\]$/g, '');
}

function trimPathAtFirstPluralField(pathTraveled: string) {
  return pathTraveled.substring(0, pathTraveled.indexOf('['));
}

function convertBracketsToWildCards(pathTraveled: string) {
  return pathTraveled.replace(/\[\]/g, '[%]');
}

// SQLite's stand-in for pgvector: the cosine similarity between the
// search doc's "vec:[…]" string at `jsonPath` and `target` (a '[…]' literal),
// as a scalar subquery. NULL when the doc has no vector there.
function sqliteCosineSimilarity(
  jsonPath: string,
  target: string,
): CardExpression {
  return [
    '(SELECT SUM(a.value * b.value) / (sqrt(SUM(a.value * a.value)) * sqrt(SUM(b.value * b.value))) FROM json_each(substr(json_extract(i.search_doc,',
    param(jsonPath),
    '), 5)) AS a JOIN json_each(',
    param(target),
    ') AS b ON a.key = b.key)',
  ];
}

function removeBrackets(pathTraveled: string) {
  return pathTraveled.replace(/\[\]/g, '');
}

function isFieldPlural(field: FieldDefinition): boolean {
  return field.type === 'containsMany' || field.type === 'linksToMany';
}

// Seed the `searchable` route set from the queried card's own fields — the
// loaderless mirror of `base/searchable.ts`'s `seedSearchableRoutes`, reading
// `FieldDefinition.searchable` from the cached definition instead of the live
// field descriptor.
function seedSearchableRoutesFromDefinition(
  definition: Pick<Definition, 'fields' | 'fieldDefs'>,
): string[] {
  let routes: string[] = [];
  for (let [fieldName, defId] of Object.entries(definition.fields)) {
    routes.push(
      ...routesForField(fieldName, definition.fieldDefs[defId]?.searchable),
    );
  }
  return routes;
}

async function getField(
  definition: Definition,
  pathTraveled: string,
  definitionLookup: DefinitionLookup,
): Promise<FieldDefinition> {
  let cleansedPath = removeBrackets(pathTraveled);
  let field = await getFieldDef(definition, cleansedPath, async (codeRef) => {
    if (!isResolvedCodeRef(codeRef)) {
      return undefined;
    }
    return await definitionLookup.lookupDefinition(codeRef);
  });
  if (!field) {
    if (isSyntheticSearchDocKey(currentField(pathTraveled))) {
      // this is a little awkward--we have the need to treat the synthetic
      // search-doc keys (see search-doc-keys.ts) as fields that we can query
      // against from the index (e.g. the cards grid sorts by the card's display
      // name via `_cardType`; a mixed cards+files search sorts/filters both row
      // types on `_title`, and dedups a card's dual-indexed `.json` file row
      // with `eq: { _isCardInstanceFile: false }`). the index-runner / prerender
      // meta route inject these into the searchDoc during index time. The string
      // field shape here is enough for the non-null string keys and the `IS
      // NULL` legacy spelling; `_isCardInstanceFile`'s boolean `eq: true/false`
      // is special-cased in `fieldEqFilter` so it never depends on the
      // adapter-specific `->>` rendering of a JSON boolean. Kept in sync with
      // the matcher shim (instance-filter-matcher.ts) and searchable-parity.ts.
      return {
        type: 'contains',
        isPrimitive: true,
        isComputed: false,
        fieldOrCard: {
          module: `${baseRealmRRI}card-api`,
          name: 'StringField',
        },
      } as FieldDefinition;
    }
    let onBaseType =
      definition.codeRef &&
      'name' in definition.codeRef &&
      definition.codeRef.name === 'CardDef';
    throw new InvalidQueryError(
      `Your filter refers to a nonexistent field "${cleansedPath}" on type ${stringify(
        definition.codeRef,
      )}` +
        (onBaseType
          ? `. A type anchor applies only to the filter object it is on: put "on" (on the wire, "item.on") beside the field's operator, not in a sibling clause`
          : ''),
    );
  }
  return field;
}

function currentField(pathTraveled: string) {
  let cleansedPath = removeBrackets(pathTraveled);
  return cleansedPath.split('.').pop()!;
}

function assertIndexEntry<T>(obj: T): Omit<
  T,
  'source' | 'last_modified' | 'resource_created_at'
> & {
  last_modified: string | null;
  resource_created_at: string;
} {
  if (!obj || typeof obj !== 'object') {
    throw new Error(`expected index entry is null or not an object`);
  }
  if (!('last_modified' in obj)) {
    throw new Error(`expected index entry to have "last_modified" property`);
  }
  if (
    !('resource_created_at' in obj) ||
    typeof obj.resource_created_at !== 'string'
  ) {
    throw new Error(
      `expected index entry to have "resource_created_at" property`,
    );
  }
  return obj as Omit<T, 'source' | 'last_modified' | 'resource_created_at'> & {
    last_modified: string;
    resource_created_at: string;
  };
}

function tableFromOpts(opts: WIPOptions | undefined) {
  return opts?.pendingStagingId === undefined
    ? 'boxel_index'
    : stagedRows('boxel_index_pending', opts.pendingStagingId);
}

// The prerendered_html rows paired with the boxel_index rows `tableFromOpts`
// selects: the same pass's staged HTML rows for a staged read, the production
// table otherwise.
// The facet counts `#narrowPassWithFacets` carries in its `__facets` column
// (an object keyed by the facet's position), as the per-facet rows of
// `#facetQuery`. A facet with no counted value is an empty list.
function facetCountsFromColumn(
  column: unknown,
  facetCount: number,
): { value: unknown; count: unknown }[][] {
  let byIndex =
    column && typeof column === 'object'
      ? (column as Record<string, { value: unknown; count: unknown }[]>)
      : typeof column === 'string'
        ? (JSON.parse(column) as Record<
            string,
            { value: unknown; count: unknown }[]
          >)
        : {};
  return Array.from({ length: facetCount }, (_, index) => byIndex[index] ?? []);
}

// A card's full-text vector, as `matches` and relevance read it. Production
// rows carry it in `markdown_tsv`, which the index writer computes as it
// promotes a pass (see `promotePrerenderedHtmlPending`); a pass's staged rows
// don't carry it, so a search over them computes it inline, which is
// affordable because staging only ever holds one pass.
function markdownVector(alias: string, staged: boolean): string {
  return staged
    ? `to_tsvector('english', markdown_search_text(${alias}.markdown))`
    : `${alias}.markdown_tsv`;
}

type FacetShape = 'values' | 'range' | 'date';
interface FacetPlan {
  facet: Facet;
  shape: FacetShape;
  plain: boolean;
  // A link field: counted by the linked card's id, each value labelled with
  // the card's title (docs/search-intent.md, `facet`).
  link?: boolean;
}
const NUMBER_SERIALIZERS = new Set(['number', 'big-integer']);
const DATE_SERIALIZERS = new Set(['date', 'datetime']);

// The column is `facet_value`, not `value`: the shared row coercion reads a
// column named `value` as JSON.
function facetCountsOf(rows: Record<string, unknown>[]): FacetCount[] {
  return rows
    .filter((row) => row.facet_value != null)
    .map((row) => ({
      value: String(row.facet_value),
      count: Number(row.count),
    }));
}

// Range buckets for a number facet that declares its shape but names no
// ranges: up to ten equal buckets of a round width across the values'
// span, the last holding the maximum.
export function autoFacetRanges(stats: FacetStats | undefined): FacetRange[] {
  if (
    !stats?.values ||
    typeof stats.min !== 'number' ||
    typeof stats.max !== 'number'
  ) {
    return [];
  }
  let { min, max } = stats;
  if (min === max) {
    return [{ from: min }];
  }
  let rough = (max - min) / 5;
  let magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  let step = rough / magnitude;
  let width = (step <= 1 ? 1 : step <= 2 ? 2 : step <= 5 ? 5 : 10) * magnitude;
  let round = (n: number) => Number(n.toPrecision(12));
  let ranges: FacetRange[] = [];
  for (
    let from = round(Math.floor(min / width) * width);
    from <= max && ranges.length < 10;
    from = round(from + width)
  ) {
    ranges.push({ from, to: round(from + width) });
  }
  return ranges;
}

// `filter` without the nodes that constrain only `by`, for a facet counted
// without its own selection (`own: 'ignore'`). A removed node's type anchor
// stays, so the count keeps the filter's type.
export function filterWithout(filter: Filter, by: string): Filter | undefined {
  let node = filter as any;
  let anchor = (): Filter | undefined =>
    node.on ? ({ type: node.on } as Filter) : undefined;
  for (let operator of ['eq', 'in', 'range', 'contains']) {
    if (operator in node) {
      let keys = Object.keys(node[operator] ?? {});
      // A link facet's selection filters by the linked card's id.
      return keys.length > 0 &&
        keys.every((key) => key === by || key === `${by}.id`)
        ? anchor()
        : filter;
    }
  }
  if ('not' in node) {
    return filterWithout(node.not, by) === node.not ? filter : anchor();
  }
  if ('any' in node) {
    let branches = (node.any as Filter[]).map((b) => filterWithout(b, by));
    let removed = branches.every(
      (branch, i) => branch !== (node.any as Filter[])[i],
    );
    return removed
      ? (anchor() ?? branches.find((branch) => branch !== undefined))
      : filter;
  }
  if ('every' in node) {
    let kept = (node.every as Filter[])
      .map((b) => filterWithout(b, by))
      .filter((b): b is Filter => b !== undefined);
    return kept.length === 0 ? anchor() : ({ ...node, every: kept } as Filter);
  }
  return filter;
}

const RELEVANCE_SORT_KEY_NAME = '_relevance';

// The card type a filter is anchored on: its own `on` or `type`, or the first
// anchor among the branches of a top-level `every`.
// A glob as a LIKE pattern: `*` is `%`, `?` is `_`, and LIKE's own
// wildcards and escape are escaped.
// The comparison group a row belongs to: its value at `by`, as text.
function groupKey(doc: Record<string, unknown>, by: string | undefined) {
  if (!by) return '';
  let v: unknown = doc;
  for (let part of by.split('.')) {
    v =
      v && typeof v === 'object'
        ? (v as Record<string, unknown>)[part]
        : undefined;
  }
  return v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
}

// A comparison set's aggregates for one field: Excel's inclusive
// percentiles, and the sample standard deviation.
function summarize(xs: number[]): Record<string, number | null> {
  let n = xs.length;
  if (n === 0) {
    return {
      count: 0,
      sum: 0,
      avg: null,
      min: null,
      max: null,
      median: null,
      p10: null,
      p25: null,
      p75: null,
      p90: null,
      stdev: null,
    };
  }
  let sorted = [...xs].sort((a, b) => a - b);
  let sum = sorted.reduce((a, b) => a + b, 0);
  let avg = sum / n;
  let pct = (p: number) => {
    let h = (n - 1) * p;
    let lo = Math.floor(h);
    return (
      sorted[lo] + (h - lo) * ((sorted[lo + 1] ?? sorted[lo]) - sorted[lo])
    );
  };
  let variance =
    n > 1 ? sorted.reduce((a, x) => a + (x - avg) ** 2, 0) / (n - 1) : null;
  return {
    count: n,
    sum,
    avg,
    min: sorted[0],
    max: sorted[n - 1],
    median: pct(0.5),
    p10: pct(0.1),
    p25: pct(0.25),
    p75: pct(0.75),
    p90: pct(0.9),
    stdev: variance == null ? null : Math.sqrt(variance),
  };
}

// A `rerank` formula's number for each search doc, or null where it has
// none. The formula is BXL with every Excel function (the lazily loaded
// statistical, financial and engineering ones too), compiled once with the
// docs' own field names as its labels so `rating` reads `.rating`, and run in
// BXL's sandbox under a per-row and a total time budget.
let formulaExtensions: Promise<void> | undefined;
async function scoreWithBxl(
  expr: string,
  docs: Record<string, unknown>[],
): Promise<(number | null)[]> {
  let bxl = await import('@cardstack/bxl');
  formulaExtensions ??= bxl.loadAllFormulaExtensions().catch(() => undefined);
  await formulaExtensions;
  let keys = new Set<string>();
  for (let doc of docs) {
    for (let key of Object.keys(doc)) {
      if (/^[A-Za-z_$][\w$]*$/.test(key)) keys.add(key);
    }
  }
  let prepared;
  try {
    prepared = bxl.prepareBxl(expr, {
      schema: { fields: [...keys].map((key) => ({ key, label: key })) },
    });
  } catch (e) {
    throw new InvalidQueryError(
      `rerank: the formula does not compile: ${(e as Error).message}`,
    );
  }
  let deadline = Date.now() + 1000;
  return docs.map((doc) => {
    if (Date.now() > deadline) {
      return null;
    }
    try {
      let value = prepared.evaluate(doc, {
        runtimeLimits: { maxMillis: 20, maxSteps: 100_000, maxOutputs: 4 },
      }).value;
      if (typeof value === 'boolean') return value ? 1 : 0;
      let n =
        typeof value === 'number'
          ? value
          : typeof value === 'string' && value.trim() !== ''
            ? Number(value)
            : NaN;
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  });
}

// The `_relevance` signal a blend component stands for, by identity: set
// when `#relevanceBlend` builds the component, read by `explainRows`.
const explainNames = new WeakMap<
  object,
  { name: RelevanceSignal; weight: number }
>();

// Folds each row's per-signal `_xN_value` / `_xN_rank` columns into one
// `_explain` object (see `ResultExplanation`) and drops them.
function explainRows(rows: Record<string, unknown>[], sort: Sort | undefined) {
  let blend = (sort ?? []).find((s) => isBlendSort(s)) as
    | BlendSortExpression
    | undefined;
  if (!blend) {
    return;
  }
  let k = blend.k ?? DEFAULT_RRF_K;
  let labels = blend.of.map((c) => {
    let named = explainNames.get(c);
    if (named) {
      return { signal: named.name, weight: named.weight };
    }
    let signal = isExprSort(c)
      ? c.expr
      : isWhenSignal(c)
        ? 'when'
        : isMatchRelevanceSort(c)
          ? 'text'
          : isNearSort(c)
            ? `near ${c.by}`
            : c.by;
    return { signal, weight: c.weight ?? 1 };
  });
  for (let row of rows) {
    let signals = labels.map(({ signal, weight }, j) => {
      let rawRank = row[`_x${j}_rank`];
      let rank = rawRank == null ? null : Number(rawRank);
      let value = row[`_x${j}_value`] ?? null;
      delete row[`_x${j}_rank`];
      delete row[`_x${j}_value`];
      return {
        signal,
        weight,
        ...(weight < 0 ? { inverted: true as const } : {}),
        value:
          typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)
            ? Number(value)
            : value,
        rank,
        contribution: rank == null ? 0 : Math.abs(weight) / (k + rank),
      };
    });
    row[EXPLAIN_KEY] = {
      score: Number(row[BLEND_SCORE_KEY] ?? 0),
      k,
      signals,
    } satisfies ResultExplanation;
  }
}

// A binding the engine can run as a join: one card named by id, selecting a
// link field's ids (`items.id`). Its `linkedFrom` reads that card's links in
// the same statement as the query that uses them.
function joinableLet(
  binding: LetBinding,
): { card: string; field: string } | undefined {
  if (binding.from.sort || !binding.select.endsWith('.id')) {
    return undefined;
  }
  let node: any = binding.from.filter;
  if (node && Array.isArray(node.every)) {
    let rest = node.every.filter((n: any) => !isCardTypeFilter(n));
    node = rest.length === 1 ? rest[0] : undefined;
  }
  if (!node || typeof node !== 'object') {
    return undefined;
  }
  let keys = Object.keys(node).filter((k) => k !== 'on' && k !== 'type');
  let id = keys.length === 1 && keys[0] === 'eq' ? node.eq?.id : undefined;
  if (typeof id !== 'string' || Object.keys(node.eq).length !== 1) {
    return undefined;
  }
  return { card: id, field: binding.select.slice(0, -'.id'.length) };
}

// A facet's `measure`, as the aggregate and the field it reads.
function facetMeasureOf(
  facet: Facet,
): { op: FacetMeasureOp; path: string } | undefined {
  if (!facet.measure) {
    return undefined;
  }
  let [op, path] = Object.entries(facet.measure)[0] ?? [];
  return op && path ? { op: op as FacetMeasureOp, path } : undefined;
}

export function globToLike(glob: string): string {
  return glob
    .replace(/[\\%_]/g, (c) => `\\${c}`)
    .replace(/\*/g, '%')
    .replace(/\?/g, '_');
}

function filterAnchor(filter: Filter | undefined): CodeRef | undefined {
  if (!filter) {
    return undefined;
  }
  if ('on' in filter && filter.on) {
    return filter.on;
  }
  if ('type' in filter && filter.type) {
    return filter.type;
  }
  if ('every' in filter) {
    for (let branch of filter.every) {
      let anchor = filterAnchor(branch);
      if (anchor) {
        return anchor;
      }
    }
  }
  return undefined;
}

// A card's role-weighted full-text vector (docs/search-intent.md): titles,
// names and aliases at weight A down to body text at D. Production rows carry
// it in `search_tsv`, which the index writer builds from the render's
// `_searchText` as it promotes a pass; staged rows still hold `_searchText`
// in their search doc, so a search over them builds it inline. A row indexed
// before the column existed has none, and ranks by its markdown alone.
function searchTextVector(alias: string, staged: boolean): string {
  return staged
    ? `search_text_vector(${alias}.search_doc -> '${SEARCH_TEXT_KEY}')`
    : `${alias}.search_tsv`;
}

// A card's small, inline rank vector (the `add-boxel-index-rank-vector`
// migration); staged rows build it inline from their `_searchText`.
function rankVector(alias: string, staged: boolean): string {
  return staged
    ? `search_rank_vector(${alias}.search_doc -> '${SEARCH_TEXT_KEY}')`
    : `${alias}.rank_tsv`;
}

function prerenderedTableFromOpts(opts: WIPOptions | undefined) {
  return opts?.pendingStagingId === undefined
    ? 'prerendered_html'
    : stagedRows('prerendered_html_pending', opts.pendingStagingId);
}

// A pass's rows of a pending table, as a derived table the callers alias like
// the table it stands in for. The staging id is spliced into the statement
// text because the table expression is interpolated into it rather than built
// from parameters, so only the two shapes a batch mints are accepted.
const STAGING_ID_PATTERN = /^(job:\d+\.-?\d+|adhoc:[0-9a-f-]+)$/;
function stagedRows(
  table: 'boxel_index_pending' | 'prerendered_html_pending',
  stagingId: string,
) {
  if (!STAGING_ID_PATTERN.test(stagingId)) {
    throw new Error(`not a staging id: ${JSON.stringify(stagingId)}`);
  }
  return `(SELECT * FROM ${table} WHERE staging_id = '${stagingId}')`;
}

// HTML-channel LEFT JOIN: attaches the prerendered_html row (aliased `ph`) for
// each boxel_index row (aliased `i`) on their shared (url, realm_url, type)
// primary key. prerendered_html is the sole home of rendered output (the HTML
// formats, markdown, the deps carrying scoped-CSS URLs, the rendering
// generation, render errors); a boxel_index row without a matching
// prerendered_html row reads those as NULL (`ph.url IS NULL`) — no rendering
// exists yet. Being keyed on the primary key the join is 1:1, so it never
// fans out a `GROUP BY url` grouping. `icon_html` is not joined in: the icon
// renders in the index visit and lives on boxel_index. Exported (with
// `effectiveHasError`) so `findLiveInstanceGeneration` in media-cache.ts can
// build its realm-scoped raw-SQL twin of `liveInstanceGeneration` from the
// same fragments instead of re-deriving the liveness predicate.
export function prerenderedJoin(opts?: WIPOptions) {
  return `LEFT JOIN ${prerenderedTableFromOpts(
    opts,
  )} AS ph ON ph.url = i.url AND ph.realm_url = i.realm_url AND ph.type = i.type`;
}

// Effective error state spans both channels: the index pass records
// dependency/compute failures on `boxel_index.error_doc`, while a format
// render failure lands on `prerendered_html.error_doc` (beside the
// last-known-good HTML it preserves). A row reads as errored when either
// channel holds an error. The index error wins the error_doc pick — it
// carries the dependency chain that error repair fans out over. A render
// error counts only while its row is at-or-newer than the index row's
// generation: a lower-generation render error predates the row's latest
// index pass (e.g. the content was since fixed) and must not gate the row —
// the fresh render lands on its own channel and re-runs live searches via
// the prerender_html event.
//
// The effective state is for readers of the prerendered output: searches,
// the liveness gates of the capture routes, publishing. A reader of the
// card's data asks the index channel alone (`INDEX_HAS_ERROR`), because a
// render failure leaves the data the index visit read intact.
const RENDER_ERROR_IS_CURRENT = `(ph.url IS NOT NULL AND ph.error_doc IS NOT NULL AND ph.generation >= i.generation)`;

const INDEX_HAS_ERROR = `COALESCE(i.has_error, FALSE)`;

export function effectiveHasError(): string {
  return `(${INDEX_HAS_ERROR} OR ${RENDER_ERROR_IS_CURRENT})`;
}

// The current render error, as a column beside a data read's `SELECT i.*`.
// NULL when the render channel holds no current error.
const RENDER_ERROR_SELECT = `CASE WHEN ${RENDER_ERROR_IS_CURRENT} THEN ph.error_doc END AS render_error_doc`;

function effectiveErrorDoc(): string {
  return `CASE WHEN COALESCE(i.has_error, FALSE) THEN i.error_doc WHEN ${RENDER_ERROR_IS_CURRENT} THEN ph.error_doc ELSE i.error_doc END`;
}

// Appended after a `SELECT i.*` alongside PRERENDERED_HTML_SELECTS so the
// effective error state wins over the raw boxel_index columns
// (duplicate result columns resolve to the last one in both adapters).
const EFFECTIVE_ERROR_SELECTS = [
  `${effectiveHasError()} AS has_error`,
  `${effectiveErrorDoc()} AS error_doc`,
].join(', ');

// Maps a raw `file`-row search result to the `IndexedFile` view-model. Shared
// by `searchFiles` and the mixed `searchEntries` assembly loop (which builds
// a file's resource + native renderings from the same shape).
export function fileEntryFromResult(
  result: Partial<IndexRowWithHtml>,
): IndexedFile {
  let canonicalURL = result.url;
  if (!canonicalURL) {
    throw new Error('expected file search result to include url');
  }
  let lastModified =
    typeof result.last_modified === 'string'
      ? parseInt(result.last_modified)
      : (result.last_modified ?? null);
  let resourceCreatedAt =
    typeof result.resource_created_at === 'string'
      ? parseInt(result.resource_created_at)
      : (result.resource_created_at ?? null);
  let indexedAt =
    typeof result.indexed_at === 'string'
      ? parseInt(result.indexed_at)
      : (result.indexed_at ?? null);
  return {
    type: 'file',
    canonicalURL,
    searchDoc: (result.search_doc as Record<string, any> | null) ?? null,
    resource: (result.pristine_doc as FileMetaResource | null) ?? null,
    types: (result.types as string[] | null) ?? null,
    displayNames: (result.display_names as string[] | null) ?? null,
    deps: (result.deps as string[] | null) ?? null,
    isolatedHtml: result.isolated_html ?? null,
    headHtml: result.head_html ?? null,
    embeddedHtml:
      (result.embedded_html as { [refURL: string]: string } | null) ?? null,
    fittedHtml:
      (result.fitted_html as { [refURL: string]: string } | null) ?? null,
    atomHtml: result.atom_html ?? null,
    iconHtml: result.icon_html ?? null,
    markdown: result.markdown ?? null,
    // The search projections don't select the manifest — like an instance
    // search entry, whose `meta.captures` joins only on the single-card
    // GET — so this is null on the search path and populated on the
    // `getFile`/`getFiles` paths, whose SELECT carries `ph.captures`.
    captures: (result.captures as CaptureManifest | null) ?? null,
    lastModified,
    resourceCreatedAt,
    generation: result.generation ?? 0,
    htmlGeneration:
      (result as { html_generation?: number | null }).html_generation ??
      result.generation ??
      0,
    realmURL: result.realm_url ?? '',
    indexedAt,
  };
}

// The prerendered_html row's rendered output, appended after a `SELECT i.*`
// on the single-entry read paths. `icon_html` is excluded — the icon renders
// in the index visit and lives on boxel_index. `deps` is excluded too:
// `getInstance`/`getFile` expose `deps` for the dependency graph
// (`getCardDependencies`), which is boxel_index's; the scoped-CSS URLs needed
// to serve HTML come from `ph.deps` where HTML is served — the search
// selects, searchFiles, and retrieve-scoped-css.
const PRERENDERED_HTML_SELECTS = [
  'isolated_html',
  'head_html',
  'atom_html',
  'embedded_html',
  'fitted_html',
  'markdown',
  'captures',
]
  .map((col) => `ph.${col} AS ${col}`)
  .join(', ');

// The Postgres tsquery one `matches` term compiles to. Without `prefix` it is
// `websearch_to_tsquery('english', …)` over the whole string. With it, the
// finished words keep that form, ANDed with an OR over the unfinished last
// word:
//   - the word as a prefix of any lexeme (`kleppm:*`, under 'simple' so it is
//     not stemmed first);
//   - the word's own english stem, exact (`jobs` → `job`);
//   - the word less its last one or two letters, exact, while at least three
//     remain.
// The document's tsvector is stemmed, so a prefix alone misses a word whose
// stem is shorter than what has been typed: "learni" is a prefix of
// "learning", but the indexed lexeme is "learn". The shortened forms catch it,
// at the cost of the odd extra match on a short word ("lear"). The partial
// word is letters and digits only, so it carries no tsquery syntax. A partial
// word right after a websearch `-` is negated, as a finished one would be.
// The type-ahead tsvector, exactly as the `add-type-ahead-index` migration
// indexes it (the planner uses the index only for an identical expression).
const TYPE_AHEAD_TSVECTOR = (alias: string) =>
  `to_tsvector('simple', coalesce(${alias}.search_doc ->> '${TYPE_AHEAD_KEY}', ''))`;

// Every word of a type-ahead query as a prefix (`word:*`), ANDed. The words
// are letters and digits only, so they carry no tsquery syntax. Undefined when
// the query has no words.
// Words too common to narrow a type-ahead: dropped when other words remain,
// and a query made only of them matches nothing (13k of 36k OnTube cards hold
// "the"; counting and ranking them took ~220 ms for a list of eight).
const TYPE_AHEAD_STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'that',
  'this',
  'are',
  'was',
  'not',
  'but',
  'you',
  'all',
  'can',
  'has',
  'have',
  'its',
  'our',
  'out',
  'into',
]);

// The tsquery for a type-ahead: every word must start some word of the card's
// short names. A word shorter than MIN_PREFIX_LETTERS is a prefix of a large
// share of the index (one letter matched 11k-24k of 36k OnTube cards at
// 200-450 ms), so it matches as a whole word unless a longer word is there to
// narrow the match first ("steve jo" keeps "jo" a prefix). Returns undefined
// when nothing is left to match.
function typeAheadTsQuery(text: string): Expression | undefined {
  let words = typeAheadWords(text);
  let meaningful = words.filter((w) => !TYPE_AHEAD_STOP_WORDS.has(w));
  if (meaningful.length === 0) {
    return undefined;
  }
  let narrowed = meaningful.some((w) => [...w].length >= MIN_PREFIX_LETTERS);
  return [
    `to_tsquery('simple',`,
    param(
      meaningful
        .map((word) =>
          narrowed || [...word].length >= MIN_PREFIX_LETTERS
            ? `${word}:*`
            : word,
        )
        .join(' & '),
    ),
    `)`,
  ];
}

const MIN_PREFIX_LETTERS = 3;

// How many matching passages a search reports per card and field.
const PASSAGES_PER_CARD = 5;

// The query a `matches` term runs against a card's rendered markdown. With
// `prefix`, the word still being typed matches the rendered page only as a
// whole word (and its typo corrections): a page carries its template's own
// words (headings such as "Connected concepts", labels), so a short prefix
// would match every card of a type, and a prefix scan over every rendered
// page in the realm is slow. The prefix itself matches the card's own field
// words (`search_tsv`), which `matchTsQuery` builds.
function renderedTsQuery(term: MatchTerm): Expression {
  if (!term.prefix) {
    return matchTsQuery(term);
  }
  let { words, partial } = splitTypeAheadQuery(term.matches);
  // A negated partial ("dog -painterl") excludes by prefix, which only
  // narrows, so the page reads it as a prefix too.
  if (partial === undefined || /(^|\s)-$/.test(words)) {
    return matchTsQuery(term);
  }
  if (term.typoQuery === undefined) {
    return [`websearch_to_tsquery('english',`, param(term.matches), `)`];
  }
  let partialAlternatives = [partial, ...(term.typoPartial ?? '').split(' | ')]
    .map((w) => w.trim())
    .filter(Boolean)
    .join(' | ');
  let tsquery = [term.typoQuery, `(${partialAlternatives})`]
    .filter(Boolean)
    .join(' & ');
  return [`to_tsquery('english',`, param(tsquery), `)`];
}

// A word still being typed takes typo corrections only from this many
// letters (`#resolveTypos`); shorter, it matches as a prefix alone.
const MIN_TYPO_PARTIAL_LETTERS = 5;

function matchTsQuery(term: MatchTerm): Expression {
  let typoPartial: Expression = term.typoPartial
    ? [`|| to_tsquery('english',`, param(term.typoPartial), `)`]
    : [];
  if (term.typoQuery !== undefined && !term.prefix) {
    // The words widened to their corrections (`#resolveTypos`).
    return [`to_tsquery('english',`, param(term.typoQuery), `)`];
  }
  let { words, partial } = term.prefix
    ? splitTypeAheadQuery(term.matches)
    : { words: term.matches, partial: undefined };
  // A one- or two-letter prefix is a prefix of a large share of the index's
  // lexemes, so on its own it reads most of the index for a result that says
  // little; such a word matches whole until a third letter is typed. After a
  // finished word ("steve jo") the finished word narrows the match first, so
  // a short prefix is cheap there and stays a prefix.
  if (
    partial === undefined ||
    ([...partial].length < MIN_PREFIX_LETTERS && words.trim() === '')
  ) {
    if (term.typoQuery) {
      return [`to_tsquery('english',`, param(term.typoQuery), `)`];
    }
    return [`websearch_to_tsquery('english',`, param(term.matches), `)`];
  }
  let negated = /(^|\s)-$/.test(words);
  if (negated) {
    words = words.slice(0, -1);
  }
  let alternatives: Expression = [
    `to_tsquery('simple',`,
    param(`${partial}:*`),
    `) || to_tsquery('english',`,
    param(partial),
    `)`,
  ];
  let letters = [...partial];
  for (let drop = 1; drop <= 2 && letters.length - drop >= 3; drop++) {
    alternatives.push(
      `|| to_tsquery('simple',`,
      param(letters.slice(0, -drop).join('')),
      `)`,
    );
  }
  let partialQuery: Expression = [
    negated ? '!!(' : '(',
    ...alternatives,
    ...typoPartial,
    ')',
  ];
  if (words.trim() === '') {
    return partialQuery;
  }
  return [
    term.typoQuery
      ? `(to_tsquery('english',`
      : `(websearch_to_tsquery('english',`,
    param(term.typoQuery || words),
    `) &&`,
    ...partialQuery,
    `)`,
  ];
}

// SQLite LIKE treats `%` and `_` as wildcards. With `ESCAPE '\'` we can
// neutralize user-supplied wildcards by prefixing them (and the escape
// char itself) with a backslash before binding.
function escapeSqliteLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function assertNever(value: never) {
  return new Error(`should never happen ${value}`);
}

type FilterFieldHandler<T> = (
  definition: Definition,
  expression: T,
  pathTraveled: string,
) => Promise<T>;

interface FilterFieldHandlerWithEntryAndExit<T> {
  enter?: FilterFieldHandler<T>;
  exit?: FilterFieldHandler<T>;
}
