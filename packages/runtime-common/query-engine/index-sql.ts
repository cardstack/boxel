// SQL fragments over the index tables that every layer shares: which table
// a read uses (published or a staged `_pending` copy), the prerendered-HTML
// join, the two error channels folded into one "effectively errored", the
// realm bound (one realm or a same-server union), the text-search vectors,
// and assembling a `file` row from a result.
// Owns: those fragments as strings or expressions.
// Must not: run a statement, or decide anything about a query.
// Guarantees: staged reads and error visibility, docs/search.md ("Result
// kinds and `scope`", "Bounds every query runs under").

import type { CaptureManifest } from '../capture-spec.ts';
import type { Expression } from '../expression.ts';
import type { FileMetaResource } from '../resource-types.ts';
import type {
  FilterContext,
  IndexRowWithHtml,
  IndexedFile,
  WIPOptions,
} from './types.ts';
import { SEARCH_TEXT_KEY } from '../search-intent.ts';
import { realmIs } from '../realm-union.ts';

export function assertIndexEntry<T>(obj: T): Omit<
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

export function tableFromOpts(opts: WIPOptions | undefined) {
  return opts?.pendingStagingId === undefined
    ? 'boxel_index'
    : stagedRows('boxel_index_pending', opts.pendingStagingId);
}

// Bounds a matches subquery's side to the realm searched, where the context
// knows it.
export function realmBound(alias: string, context: FilterContext): Expression {
  return context.realmURL
    ? ['AND', ...realmIs(`${alias}.realm_url`, context.realmURL)]
    : [];
}

export function markdownVector(alias: string, staged: boolean): string {
  return staged
    ? `to_tsvector('boxel_english', markdown_search_text(${alias}.markdown))`
    : `${alias}.markdown_tsv`;
}

// A card's role-weighted full-text vector (docs/search-intent.md): titles,
// names and aliases at weight A down to body text at D. Production rows carry
// it in `search_tsv`, which the index writer builds from the render's
// `_searchText` as it promotes a pass; staged rows still hold `_searchText`
// in their search doc, so a search over them builds it inline. A row indexed
// before the column existed has none, and ranks by its markdown alone.
export function searchTextVector(alias: string, staged: boolean): string {
  return staged
    ? `search_text_vector(${alias}.search_doc -> '${SEARCH_TEXT_KEY}')`
    : `${alias}.search_tsv`;
}

// A card's small, inline rank vector (the `add-boxel-index-rank-vector`
// migration); staged rows build it inline from their `_searchText`.
// The relevance of a card that matched a query's words on its rendered page
// alone: below any field match, above a card that did not match.
export const PAGE_ONLY_RELEVANCE = '1e-6';

export function rankVector(alias: string, staged: boolean): string {
  return staged
    ? `search_rank_vector(${alias}.search_doc -> '${SEARCH_TEXT_KEY}')`
    : `${alias}.rank_tsv`;
}

// Text relevance from word statistics (BM25-shaped), all in Postgres's C
// text-search code: for each query lexeme, its IDF times `ts_rank` of the
// row's rank vector for that lexeme alone. `ts_rank` weighs each position by
// its tier (A 1, B 2/3, C 1/2, D 1/3), saturates as a word repeats, and with
// normalization 1 divides by the log of the vector's length. Rescaled to 0–1
// by score / (score + 1); blends read ranks, so the scale only matters to
// `meta._matchRelevance`.
export const TIER_WEIGHTS = '{0.333333,0.5,0.666667,1}';

export function prerenderedTableFromOpts(opts: WIPOptions | undefined) {
  return opts?.pendingStagingId === undefined
    ? 'prerendered_html'
    : stagedRows('prerendered_html_pending', opts.pendingStagingId);
}

// A pass's rows of a pending table, as a derived table the callers alias like
// the table it stands in for. The staging id is spliced into the statement
// text because the table expression is interpolated into it rather than built
// from parameters, so only the two shapes a batch mints are accepted.
export const STAGING_ID_PATTERN = /^(job:\d+\.-?\d+|adhoc:[0-9a-f-]+)$/;

export function stagedRows(
  table: 'boxel_index_pending' | 'prerendered_html_pending',
  stagingId: string,
) {
  if (!STAGING_ID_PATTERN.test(stagingId)) {
    throw new Error(`not a staging id: ${JSON.stringify(stagingId)}`);
  }
  // Staged index rows have no `title_sort`: it is written at promotion, from
  // the staged doc, and a title sort reads it (`handleFieldQuery`).
  let derived =
    table === 'boxel_index_pending'
      ? `, search_doc ->> 'cardTitle' AS title_sort`
      : '';
  return `(SELECT *${derived} FROM ${table} WHERE staging_id = '${stagingId}')`;
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
export const RENDER_ERROR_IS_CURRENT = `(ph.url IS NOT NULL AND ph.error_doc IS NOT NULL AND ph.generation >= i.generation)`;

export const INDEX_HAS_ERROR = `COALESCE(i.has_error, FALSE)`;

// `NOT effectiveHasError()` for a search's WHERE clause. Same meaning (the
// join to prerendered_html is on its primary key, so at most one row decides
// the render half), but the render half is a NOT EXISTS against
// `prerendered_html_render_error_index`, a partial index holding only the rows
// with a render error. A search that has to test thousands of candidates
// (a type-ahead term matching 7,500 rows of a 36k-card realm) then probes a tiny, cached
// index per candidate instead of reading each candidate's prerendered row:
// 1.6 s -> 0.18 s for that query.
export function notEffectivelyErrored(opts?: WIPOptions): string {
  return `(NOT ${INDEX_HAS_ERROR} AND NOT EXISTS (SELECT 1 FROM ${prerenderedTableFromOpts(
    opts,
  )} AS phe WHERE phe.url = i.url AND phe.realm_url = i.realm_url AND phe.type = i.type AND phe.error_doc IS NOT NULL AND phe.generation >= i.generation))`;
}

export function effectiveHasError(): string {
  return `(${INDEX_HAS_ERROR} OR ${RENDER_ERROR_IS_CURRENT})`;
}

// The current render error, as a column beside a data read's `SELECT i.*`.
// NULL when the render channel holds no current error.
export const RENDER_ERROR_SELECT = `CASE WHEN ${RENDER_ERROR_IS_CURRENT} THEN ph.error_doc END AS render_error_doc`;

export function effectiveErrorDoc(): string {
  return `CASE WHEN COALESCE(i.has_error, FALSE) THEN i.error_doc WHEN ${RENDER_ERROR_IS_CURRENT} THEN ph.error_doc ELSE i.error_doc END`;
}

// Appended after a `SELECT i.*` alongside PRERENDERED_HTML_SELECTS so the
// effective error state wins over the raw boxel_index columns
// (duplicate result columns resolve to the last one in both adapters).
export const EFFECTIVE_ERROR_SELECTS = [
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
export const PRERENDERED_HTML_SELECTS = [
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
