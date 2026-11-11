// The index query engine: the public class (`IndexQueryEngine`) and every
// export callers import from this path. A thin coordinator: `search`,
// `searchCards` and `searchFiles` pick a projection and hand the query to
// the pipeline. Everything else lives in query-engine/, one concern per
// module, each a layer the next extends:
//
//   engine-core.ts          state, statements, snapshot, realm zone, types
//   index-rows.ts           reads by URL (cards, files, link targets)
//   expression-resolver.ts  pass 2: CardExpression to SQL
//   filter-compiler.ts      pass 1: filter operators
//   text-search.ts          matches, type-ahead, typos, statistics, passages
//   sort-order.ts           ORDER BY, relevance, blends, expression sorts
//   sort-window.ts          a sort entry's `top` window, comparison sets
//   facets.ts               facet plans and counts
//   bindings.ts             `let`
//   paging.ts               plain top-N, narrow/wide passes, totals
//   columns.ts              `select`
//   search-pipeline.ts      `_search`, the evaluation order
//
// beside the shared, layer-free helpers: types.ts, dialect.ts (Postgres vs
// SQLite), index-sql.ts, filter-paths.ts, filter-sql.ts, text-search-sql.ts,
// sort-sql.ts, facet-sql.ts, realm-time-zone.ts. A layer imports only the
// layer below it and helpers; a helper imports no layer.
//
// What a query means is documented in docs/search.md; the compilation
// pipeline in `.claude/skills/index-query-engine/SKILL.md`.

import type { CardExpression } from './expression.ts';
import type { CardResource } from './index.ts';
import type {
  IndexRowWithHtml,
  IndexedFile,
  QueryOptions,
  QueryResultsMeta,
  SearchProjection,
} from './query-engine/types.ts';
import type { Query } from './query.ts';
import {
  effectiveErrorDoc,
  effectiveHasError,
  fileEntryFromResult,
} from './query-engine/index-sql.ts';
import { internBindingReferences } from './binding-reference.ts';
import { SearchPipeline } from './query-engine/search-pipeline.ts';

export {
  FilterRefersToNonsearchableFieldError,
  isFilterRefersToNonsearchableFieldError,
} from './query-engine/filter-paths.ts';
export {
  RERANK_KEY,
  FORMULA_KEY,
  EXPLAIN_KEY,
  generalSortFields,
  MATCH_RELEVANCE_SORT_KEY,
  isMatchRelevanceSort,
  defaultSortDirection,
  BLEND_SORT_KEY,
  BLEND_SCORE_KEY,
  COLLAPSE_SIZE_KEY,
  SORT_VALUES_KEY,
  SCORE_COLUMNS,
  isBlendSort,
} from './query-engine/types.ts';
export type {
  IndexedFile,
  LinkTargetFile,
  LinkTargetInstance,
  IndexedInstance,
  IndexedInstanceSource,
  InstanceOrError,
  QueryOptions,
  SearchProjection,
  WIPOptions,
  QueryResultsMeta,
  ColumnPlan,
} from './query-engine/types.ts';
export { autoFacetRanges, filterWithout } from './query-engine/facet-sql.ts';
export { globToLike } from './query-engine/filter-sql.ts';
export {
  STATS_MIN_ROWS,
  STATS_MIN_COUNT,
  typoTermClauses,
} from './query-engine/text-search-sql.ts';
export {
  prerenderedJoin,
  effectiveHasError,
  fileEntryFromResult,
} from './query-engine/index-sql.ts';
export { NEAR_SIMILARITY_KEY, isNearSort } from './vector-query.ts';
export { spacesOfSql } from './vector-store-pg.ts';
export { isValidPrerenderedHtmlFormat } from './prerendered-html-format.ts';

// Architectural guidance for this module — the two-pass compilation pipeline,
// the Postgres/SQLite dual-adapter constraints, the semantics of table-valued
// fan-out, and the parity contract with the client-side
// `instance-filter-matcher.ts` — lives in
// `.claude/skills/index-query-engine/SKILL.md`. Read it before changing how
// queries compile or adding a filter operator / synthetic search-doc key.
export class IndexQueryEngine extends SearchPipeline {
  async search(
    realmURL: URL,
    query: Query,
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
    // A string naming a declared binding ("$sofa.priceMin") as the engine's
    // reference, and { $literal } as its text (binding-reference.ts): once,
    // here, never in `_search`, whose own reads are already in that form.
    query = internBindingReferences(query);
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
      // The query as written: a top-level `type` (and every other member)
      // reaches the lowering in `_search`.
      query,
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
    query: Query,
    opts: QueryOptions = {},
    // TODO this should be returning a CardCollectionDocument--handle that in
    // subsequent PR where we start storing card documents in "pristine_doc"
  ): Promise<{ cards: CardResource[]; meta: QueryResultsMeta }> {
    let { results, meta } = await this.search(realmURL, query, opts, {
      kind: 'dataOnly',
    });

    let cards = results
      .map((r) => r.pristine_doc)
      .filter(Boolean) as CardResource[];

    return { cards, meta };
  }

  async searchFiles(
    realmURL: URL,
    query: Query,
    opts: QueryOptions = {},
  ): Promise<{ files: IndexedFile[]; meta: QueryResultsMeta }> {
    // A string naming a declared binding ("$sofa.priceMin") as the engine's
    // reference, and { $literal } as its text (binding-reference.ts): once,
    // here, never in `_search`, whose own reads are already in that form.
    query = internBindingReferences(query);
    let { results, meta } = await this._search(
      realmURL,
      query,
      opts,
      [
        `SELECT i.url AS url, ANY_VALUE(i.pristine_doc) AS pristine_doc, ANY_VALUE(i.search_doc) AS search_doc, ANY_VALUE(i.types) AS types, ANY_VALUE(i.display_names) AS display_names, ANY_VALUE(ph.deps) AS deps, ANY_VALUE(i.last_modified) AS last_modified, ANY_VALUE(i.resource_created_at) AS resource_created_at, ANY_VALUE(ph.isolated_html) AS isolated_html, ANY_VALUE(ph.head_html) AS head_html, ANY_VALUE(ph.embedded_html) AS embedded_html, ANY_VALUE(ph.fitted_html) AS fitted_html, ANY_VALUE(ph.atom_html) AS atom_html, ANY_VALUE(i.icon_html) AS icon_html, ANY_VALUE(ph.markdown) AS markdown, ANY_VALUE(i.generation) AS generation, ANY_VALUE(ph.generation) AS html_generation, ANY_VALUE(i.realm_url) AS realm_url, ANY_VALUE(i.indexed_at) AS indexed_at`,
      ],
      'file',
    );

    let files = results.map((result) => fileEntryFromResult(result));
    return { files, meta };
  }
}
