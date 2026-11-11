// The engine's shared vocabulary: the options a search takes
// (`QueryOptions`, `WIPOptions`), the answer's `meta` (`QueryResultsMeta`),
// the row shapes it returns (`IndexedInstance`, `IndexedFile`, …), the
// filter-compilation context, and the reserved result keys (`_window`,
// `_expression`, `_blend`, `_sortValues`, …).
// Owns: types and constants only, plus the two or three predicates over
// sort entries every layer reads.
// Must not: import an engine layer, or build SQL.
// Guarantees: what `meta` reports is documented in docs/search.md
// ("Pagination", "Warnings", "Federated search").

import {
  type BlendSortExpression,
  type FacetCount,
  type FacetStats,
  type Filter,
  type PassageMatch,
  type ResultExplanation,
  isExprSort,
  isRelevanceSort,
} from '../query.ts';
import type {
  BoxelIndexTable,
  PrerenderedHtmlTable,
} from '../index-structure.ts';
import type { CaptureManifest } from '../capture-spec.ts';
import type { CardResource, CodeRef } from '../index.ts';
import type { DBAdapter } from '../db.ts';
import type { Definition } from '../definitions.ts';
import type { FileMetaResource } from '../resource-types.ts';
import type { LogAccess } from '../log-query.ts';
import type { LogFileReader } from '../log-line-index.ts';
import type { NearContext } from '../vector-query.ts';
import { type NearReport, isNearSort } from '../vector-query.ts';
import type { RenderErrorSummary, SerializedError } from '../error.ts';
import type { RequestTimings } from '../request-timings.ts';

// A boxel_index row (`i`) joined with its prerendered_html row's (`ph`)
// rendered output — the shape the single-entry read paths project
// (`SELECT i.*` plus `PRERENDERED_HTML_SELECTS`). The HTML/markdown columns
// live only on prerendered_html; a row with no prerendered_html row reads
// them as NULL.
export type IndexRowWithHtml = BoxelIndexTable &
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

export interface InstanceError extends Partial<
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

export type GetEntryOptions = WIPOptions;

// What a statement of a search reads through: the search's snapshot, and the
// signal that cancels it.
export type ReadContext = { signal?: AbortSignal; reader?: DBAdapter };

export type QueryOptions = WIPOptions & {
  includeErrors?: true;
  // Set by a federated merge: each paged row carries the values the query
  // sorted it by (`_sortValues`), so rows from several realms can be ordered
  // by the query's own sort.
  exposeSortValues?: boolean;
  // The query's one clock reading: relative dates (`now-30d`), facet range
  // bounds and NOW()/TODAY() all read it, so one query sees one instant.
  // Set on entry when the caller gives none.
  queryNow?: Date;
  // The IANA zone the query's calendar is reckoned in when the query names
  // none (time-zone.ts): beats the realm's default. A federated search over
  // several realms passes UTC, so no realm's default decides for the rest.
  // Interactive callers pass the viewer's zone only by choice.
  timeZone?: string;
  // Set by the engine once the outermost search has resolved its zone.
  zoneResolved?: true;
  // For a query with a `let` binding read from a log (`isLogBinding`): what
  // the caller may read of each log, for a caller a realm policy scopes
  // (unset: every line), and how to read a log's file, so a log no index
  // pass has synced yet is synced before the search's snapshot is taken.
  logAccess?: (url: string) => LogAccess | Promise<LogAccess>;
  readLogFile?: LogFileReader;
  // Set for a caller a realm policy scopes: realm-wide word statistics
  // (IDF, typo corrections) are used only under the small-count rules
  // (`STATS_MIN_ROWS`, `STATS_MIN_COUNT`).
  anonymizeStatistics?: boolean;
  // Set for a caller a realm policy scopes: the policy's grants. A link
  // facet's value is labeled with the linked card's title only when that
  // card meets them, as it would have to for the caller to read it.
  labelFilter?: Filter;
  // Set for a caller a realm policy scopes: the grants a direct read of a
  // card of `type` would face (null where none admits the caller). Used for
  // reads of cards of another type than the query's, such as the cards a link
  // facet labels its values with.
  grantsForType?: (type: CodeRef) => Promise<Filter[] | null>;
  // Set for a caller a realm policy scopes: the policy's grants, applied to
  // every read of the query (rows, facets, bindings, comparison sets) as a
  // base condition beside the caller's filter, so no rewrite of the caller's
  // filter can drop them.
  grantFilter?: Filter;
  // Restrict the result set to this subset of URLs (SQL `i.url IN (...)`) —
  // instance rows by their `.json` file URL, file rows by their canonical URL.
  cardUrls?: string[];
  timings?: RequestTimings;
  // Cancels the search's statements when it aborts (the request's client went
  // away, or its time budget ran out). See `ExecuteOptions.signal`.
  signal?: AbortSignal;
  // Run every near search exactly, over all the realm's vectors (the
  // engine's retry when an approximate read starved a page; see
  // `NearContext#starved`).
  nearExact?: boolean;
  // Set by the engine on entry: the search's one read snapshot, which every
  // statement of the search and of the searches nested in it reads through
  // (see `inSnapshot`). A caller leaves it unset.
  reader?: DBAdapter;
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
    // A lower bound rather than the match count when `meta.warnings` holds
    // `total-estimated` (a `capped` page stopped counting at
    // SEARCH_TOTAL_CAP, a broad `matches` term was capped, or `none` counted
    // nothing); `page.total: 'exact'` asks for an exact one.
    // Whether another page follows this one. Always set on a paged search, so
    // a caller that only needs "is there more" can send `page.total: 'none'`.
    hasMore?: boolean;
  };
  // A query's `facets`, counted over every match: per facet's `by`, its
  // values with how many matched cards hold each, most common first.
  facets?: Record<string, FacetCount[]>;
  // The zone the query's calendar was reckoned in, when the query named one
  // or one other than UTC applied (a realm's default, a caller's zone).
  timeZone?: string;
  // Per facet's `by`, its statistics, for a facet that asked for them or
  // whose field declares a number or date shape (see `Facet`).
  facetStats?: Record<string, FacetStats>;
  // A search over a realm union: how many of `page.total` each realm holds
  // (realm-union.ts). Absent when the total is a bound.
  realmTotals?: Record<string, number>;
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
  // A list binding cut short (past MAX_LET_VALUES values or MAX_LET_ROWS
  // rows) says so in `meta.warnings` (`binding-truncated`), not here.
  lets?: Record<
    string,
    {
      strategy: 'join' | 'list' | 'card';
      values?: number;
      found?: boolean;
    }
  >;
  // Filled by the host's search resource, never by the engine: under
  // `explain`, each result's `meta._explain` by card id.
  explanations?: Record<string, ResultExplanation>;
  // Likewise each windowed result's expression value, by card id.
  windows?: Record<string, number | null>;
  // For a query whose first sort entry is an expression with `top` (its
  // window): how many rows the window held (`rows`) and how many of them
  // the expression gave a number (`scored`). `truncated`: the query matched
  // more rows than the window, and the rest keep the query's order, as the
  // query asked (a fact, like a page's `hasMore`). A comparison set cut at
  // MAX_COMPARE_ROWS is a caveat: `compare-truncated` in `meta.warnings`.
  window?: {
    rows: number;
    scored: number;
    truncated?: boolean;
  };
  // Problems that left the result usable but not as asked, by code: every
  // caveat an answer carries is one of these, never a flag elsewhere in
  // `meta` (docs/search.md, "Warnings"). `total-estimated` (the total is a
  // lower bound), `approximate-order` (a merged federated order),
  // `binding-truncated`, `compare-truncated`, `near-exact-scan`,
  // `page-size-clamped`, `default-page-truncated`, `incomplete`. Across
  // realms (a federated search) each warning appears once; `realms` names
  // the realms it came from when not every answering realm gave it.
  warnings?: { code: string; message: string; realms?: string[] }[];
  // How the query's near search ran: `exact` over every vector of the
  // field in its space, or `hnsw` through the space's approximate index
  // with exact re-scoring (see vector-query.ts). `candidates` counts the
  // realm's vectors, stopping one past `threshold`.
  near?: NearReport;
}

// Per row of a window (the leading sort entry's `{ expression, top }`): its
// expression value.
export const RERANK_KEY = '_window';

// The value of the query's leading expression sort for a row (over every
// match). An expression with `top` orders its window, and its value rides
// `_window`.
export const FORMULA_KEY = '_expression';

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
// vector is `to_tsvector('boxel_english', markdown_search_text(markdown))`,
// the accent-folding English configuration every stemmed text vector uses.
// That vector is stored in `prerendered_html.markdown_tsv` (kept current by a
// trigger, migration 1793936584288) and GIN-indexed there, so `matches` and
// relevance read the column: a phrase recheck, a rank, or a key-probe filter
// is a detoast rather than a regex over up to 400 KB of markdown.
// What a filter compiles inside: whether it sits under an `any` (where a
// condition that leans on the prerendered_html join is planned per row), and
// which prerendered_html table a subquery reads (the staged one for a staged
// read).
export interface FilterContext {
  inAny: boolean;
  prerenderedTable: string;
  indexTable: string;
  // The realm the search runs over, where a signal needs it (the spaces a
  // near signal's field is declared in).
  realmURL?: URL;
  // The search's near plans, which a near signal records its plan in.
  near?: NearContext;
  // The query's clock reading, which relative dates are reckoned from.
  now?: Date;
  // The condition tests a row other clauses already selected (a blend
  // boost scores each candidate), rather than finding rows. A list
  // membership then extracts and compares on the row, which Postgres hashes
  // for a long list, instead of a subquery of one index probe per value.
  perRow?: boolean;
}

export const DEFAULT_FILTER_CONTEXT: FilterContext = {
  inAny: false,
  prerenderedTable: 'prerendered_html',
  indexTable: 'boxel_index',
};

// A page read by `plainTopN`: its keys in order, the total as far as the
// page's `total` mode counted it, and whether another page follows.
export interface PlainPage {
  keys: Record<string, unknown>[];
  total: number;
  hasMore: boolean;
  totalIsEstimate: boolean;
}

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

// The direction a sort entry takes when it names none. Scores the engine
// computes (an `_expr` formula, a blend, a near similarity, text relevance)
// read "higher is better" and default to `desc`; a field sorts `asc`. The
// federated merge orders rows from several realms by the same rule.
export function defaultSortDirection(sort: object): 'asc' | 'desc' {
  let s = sort as { by: string };
  return isExprSort(s) ||
    isBlendSort(s) ||
    isNearSort(s) ||
    isMatchRelevanceSort(s) ||
    isRelevanceSort(s)
    ? 'desc'
    : 'asc';
}

// A `_blend` sort fuses several ranking signals with reciprocal rank fusion
// (see `BlendSortExpression` in query.ts). Like the other synthetic keys it is
// projected as a column (`blendScoreAlias`) and ordered by alias, defaulting
// to `desc`. The first blend's score rides `meta._blendScore`.
export const BLEND_SORT_KEY = '_blend';

export const BLEND_SCORE_KEY = '_blendScore';

// Under `collapse`, how many matches the row's group holds, the kept rows
// included. Rides `meta._collapseSize`.
export const COLLAPSE_SIZE_KEY = '_collapseSize';

// Under `exposeSortValues`, a row's sort values in sort order, then its url
// (the engine's tiebreak). Rides `meta._sortValues`.
export const SORT_VALUES_KEY = '_sortValues';

// The scores a `select` list may name beside field paths: each is read off
// the row the query ranked, as `meta` would carry it.
export const SCORE_COLUMNS = new Set([
  '_matchRelevance',
  '_nearSimilarity',
  '_blendScore',
  '_collapseSize',
  '_window',
]);

// One planned column: a score, or a search-doc path (`items[].name` marks a
// list as `[]`), with the first link it reads past.
export interface ColumnPlan {
  name: string;
  index: number;
  score?: string;
  segments?: string[];
  plural?: boolean;
  link?: { segments: string[]; type: CodeRef };
  // A vector field's values, read from the vector table rather than the
  // search doc (a vector in a sidecar is not in the doc).
  vector?: { fieldPath: string; list: boolean };
}

// `items[].name` as a SQL/JSON path, lax, so a list is read element by
// element: `$."items"[*]."name"`. Segments are field names, checked.
export function isBlendSort(sort: object): sort is BlendSortExpression {
  return (sort as { by?: unknown }).by === BLEND_SORT_KEY;
}

// Whether a predicate sits under an even (`positive`) or odd (`negated`) number
// of enclosing `not` filters. The `@>` containment rewrite is only equivalent
// to `->>` extraction at positive polarity: on an absent path `->>` yields SQL
// NULL while `@>` yields FALSE, and `NOT NULL` vs `NOT FALSE` diverge.
export type FilterPolarity = 'positive' | 'negated';

export function flipPolarity(polarity: FilterPolarity): FilterPolarity {
  return polarity === 'positive' ? 'negated' : 'positive';
}

export function assertNever(value: never) {
  return new Error(`should never happen ${value}`);
}

export type FilterFieldHandler<T> = (
  definition: Definition,
  expression: T,
  pathTraveled: string,
) => Promise<T>;

export interface FilterFieldHandlerWithEntryAndExit<T> {
  enter?: FilterFieldHandler<T>;
  exit?: FilterFieldHandler<T>;
}
