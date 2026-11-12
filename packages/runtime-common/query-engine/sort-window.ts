// The sort window: a sort entry with `top` re-ranks the first rows of the
// order by an expression, over comparison sets (`peers.`, `stats.`) and
// look-alikes (`compare.near`); and the expression checks every query runs
// first.
// Owns: `reranked`, scoring a window in SQL, comparison and look-alike sets,
// `assertExpressions`.
// Must not: compile the base order (sort-order.ts).
// Guarantees: docs/search.md ("Ranking by an expression (`expression`)",
// "Warnings": compare-truncated).

import {
  BXL_FORMULA_FUNCTIONS,
  unknownBxlFunctions,
} from '@cardstack/bxl/compiler';
import { COMPARE_TRUNCATED, withWarningOnce } from '../search-bounds.ts';
import type { CardExpression } from '../expression.ts';
import type { CodeRef } from '../index.ts';
import { type ComparedRows, groupKey, readsOnly } from './sort-sql.ts';
import {
  DEFAULT_NEAR_PEERS,
  DEFAULT_RERANK_TOP,
  type Filter,
  InvalidQueryError,
  MAX_NEAR_PEERS,
  MAX_RERANK_TOP,
  type Query,
  type Sort,
  compareRowLimit,
  exprSortSql,
  isExprSort,
} from '../query.ts';
import type { Definition } from '../definitions.ts';
import {
  type IndexRowWithHtml,
  type QueryOptions,
  type QueryResultsMeta,
  RERANK_KEY,
  SORT_VALUES_KEY,
  isBlendSort,
} from './types.ts';
import { SortOrder } from './sort-order.ts';
import {
  assertQueryExpressionProfile,
  exprFieldPaths,
} from '../formula-sql.ts';
import { filterAnchor } from './filter-sql.ts';
import { getField } from './filter-paths.ts';
import { sqlTextArrayLiteral } from '../sql-literal.ts';
import { tableFromOpts } from './index-sql.ts';
import { PeerDistributions } from './peer-distributions.ts';
import { PeerReductions, peerStatistics } from './peer-statistics.ts';

function comparisonFields(expression: string): string[] {
  return [
    ...new Set(
      [...expression.matchAll(/\b(?:peers|stats)\.([A-Za-z_$][\w$]*)/g)].map(
        (match) => match[1],
      ),
    ),
  ];
}

export abstract class SortWindow extends SortOrder {
  // A `rerank`: the query's first `top` rows, ordered by a BXL formula over
  // each row's search doc, then the rows past the window in the query's own
  // order, and the page of that. Undefined when the page lies past the
  // window, so the query runs in its own order.
  protected async reranked(
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
    // A page that runs past the window is filled from the rows after it,
    // read in the same pass. With no page the query returns every match: the
    // window reordered, then the rest in the query's order. The candidate
    // read counts its total as the caller's page asked (`total`).
    let past = query.page ? Math.max(0, start + query.page.size - top) : 0;
    let candidates = await this._search(
      realmURL,
      {
        filter: query.filter,
        sort: query.sort,
        ...(query.page
          ? { page: { ...query.page, number: 0, size: top + past } }
          : {}),
        facets: query.facets,
        collapse: query.collapse,
        let: query.let,
        explain: query.explain,
      },
      opts,
      [
        'SELECT i.url AS url, ANY_VALUE(i.type) AS type, ANY_VALUE(i.search_doc) AS search_doc',
      ],
      entryType,
    );
    let read = candidates.results as {
      url: string;
      type?: string;
      search_doc?: unknown;
      [column: string]: unknown;
    }[];
    let rows = read.slice(0, top);
    let after = read.slice(top);
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
    // The rows each window row is compared with, as plain rows (the fields
    // the expression names, keyed by the row's group): its look-alikes, or
    // the comparison set grouped by `compare.by`. Their `peers.` lists and
    // `stats.` aggregates are computed in the scoring statement.
    let lookalikes = rerank.compare?.near
      ? await this.#lookalikeSets(
          realmURL,
          query,
          rows.map((row) => row.url),
          opts,
          entryType,
        )
      : undefined;
    let set = lookalikes
      ? undefined
      : await this.#comparisonSet(realmURL, query, opts, entryType);
    let keys = lookalikes
      ? rows.map((row) => row.url)
      : docs.map((doc) => groupKey(doc, query.rerank!.compare?.by));
    let bound = this.rerankBindings.get(rerank);
    let values = await this.#scoreRerank(
      rerank.expression,
      readsOnly(
        rerank.expression,
        bound ? docs.map((doc) => ({ ...doc, ...bound })) : docs,
      ),
      keys,
      lookalikes ?? set,
      opts,
    );
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
    let ordered: {
      row: (typeof read)[number];
      index: number;
      value: number | null;
      past?: true;
    }[] = [
      ...order,
      ...after.map((row, i) => ({
        row,
        index: rows.length + i,
        value: null,
        past: true as const,
      })),
    ];
    let window = query.page
      ? ordered.slice(start, start + query.page.size)
      : ordered;
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
          // The page is read by url alone, so what the query computed for
          // each candidate (its scores, `_explain`, `_collapseSize`, a SQL
          // expression's value) comes from the candidate row.
          let {
            url: _url,
            type: _type,
            search_doc: _doc,
            [SORT_VALUES_KEY]: candidateSortValues,
            ...computed
          } = w.row;
          results.push({
            ...row,
            ...computed,
            // A row past the window was not re-ranked, so it carries no
            // value of the rerank's.
            ...(w.past ? {} : { [RERANK_KEY]: w.value }),
            // A merge across realms orders by the rerank value first, then
            // by the query's own sort.
            ...(opts.exposeSortValues
              ? {
                  [SORT_VALUES_KEY]: [
                    w.value,
                    ...((candidateSortValues as unknown[] | undefined) ?? [
                      w.row.url,
                    ]),
                  ],
                }
              : {}),
          } as Partial<IndexRowWithHtml>);
        }
      }
    }
    // The page's own count and whether another page follows, from the
    // rows the candidate read found past this page and past that read.
    let pageMeta = candidates.meta.page;
    if (query.page) {
      let mode = query.page.total ?? 'exact';
      let hasMore =
        start + window.length < ordered.length ||
        Boolean(candidates.meta.page?.hasMore);
      pageMeta = {
        ...candidates.meta.page,
        ...(mode === 'none' ? { total: start + window.length } : {}),
        hasMore,
      };
    }
    return {
      results,
      meta: {
        ...candidates.meta,
        page: pageMeta,
        window: {
          rows: rows.length,
          scored: values.filter((v) => v != null).length,
          // The query matched more than the window, so the rows past it
          // keep the query's order.
          ...(Number(candidates.meta.page?.total ?? 0) > rows.length
            ? { truncated: true }
            : {}),
        },
        // The comparison set was cut at MAX_COMPARE_ROWS: a caveat.
        ...(set?.truncated
          ? {
              warnings: withWarningOnce(candidates.meta.warnings, {
                code: COMPARE_TRUNCATED,
                message: `the comparison set held ${set.truncated.total.toLocaleString('en-US')} rows, more than the ${set.truncated.rows.toLocaleString('en-US')} it reads, so stats. and peers. describe the first ${set.truncated.rows.toLocaleString('en-US')}`,
              }),
            }
          : {}),
      },
    };
  }

  // A window's values, in one Postgres statement: the window's rows and the
  // rows they are compared with are bound as JSON, each comparison group's
  // `peers.<field>` (its values, a list) and `stats.<field>.<aggregate>`
  // are computed by SQL aggregates grouped by the row's key, and the
  // expression is the score profile's SQL over each row with its group's.
  // An expression outside the score profile was refused before anything
  // ran; there is no other place it runs.
  async #scoreRerank(
    expr: string,
    docs: Record<string, unknown>[],
    keys: string[],
    compared: ComparedRows | undefined,
    opts: QueryOptions,
  ): Promise<(number | null)[]> {
    if (docs.length === 0) return [];
    this.dialect.requirePostgres(
      'expression: a sort entry with `top` runs on Postgres only',
    );
    let fields = compared?.fields ?? [];
    let distributions = new PeerDistributions(fields);
    let reductions = new PeerReductions(compared);
    let reads: string[][] = [];
    let sql = exprSortSql(expr, undefined, opts.queryNow, {
      percentRankToSql: distributions.percentRank,
      countIfToSql: distributions.countIf,
      peerReductionToSql: reductions.compile,
      onFieldRead(parts) {
        if (parts[0] === 'peers' || parts[0] === 'stats') reads.push(parts);
      },
    });
    let statistics = compared && peerStatistics(fields, reads);
    let groupColumns = reductions.columns;
    if (statistics) groupColumns.push(`${statistics.sql} AS extra`);
    let distributionCtes = distributions.ctes;
    let needsPeers = Boolean(groupColumns.length || distributionCtes);
    let c = needsPeers
      ? ', c AS (SELECT * FROM jsonb_to_recordset($2::jsonb) AS c(ord int, key text, vals jsonb))'
      : '';
    let group = groupColumns.length
      ? `, g AS (SELECT c.key, ${groupColumns.join(', ')} FROM c GROUP BY c.key)`
      : '';
    let groupJoin = group ? ' LEFT JOIN g ON g.key = w.key' : '';
    let doc = statistics ? 'w.doc || COALESCE(g.extra, $3::jsonb)' : 'w.doc';
    let statement = `WITH w AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS w(ord int, doc jsonb, key text))${c}${group}${distributionCtes} SELECT (${sql}) AS v FROM w${groupJoin}${distributions.joins} CROSS JOIN LATERAL (SELECT ${doc} AS search_doc) AS i ORDER BY w.ord`;
    let bind: unknown[] = [
      JSON.stringify(docs.map((doc, ord) => ({ ord, doc, key: keys[ord] }))),
    ];
    if (needsPeers) bind.push(JSON.stringify(compared!.rows));
    if (statistics) bind.push(statistics.empty);
    try {
      let rows = await this.db(opts).execute(statement, {
        bind: bind as any[],
      });
      return rows.map((row) =>
        row.v == null ? null : Number(row.v as number | string),
      );
    } catch (e) {
      // A value past a double's range fails the statement (Postgres raises
      // where Excel would give #NUM!).
      if (
        /value out of range: (overflow|underflow)/.test(
          String((e as Error)?.message),
        )
      ) {
        throw new InvalidQueryError(
          `expression: its value overflows a number in SQL for some row: ${JSON.stringify(expr)}`,
          'limit-exceeded',
        );
      }
      throw e;
    }
  }

  // Each window row's own comparison set: its `k` nearest cards in the realm
  // by the vector field `compare.near`, at least `minSimilarity` similar,
  // read through that field's nearest-neighbour index. The field must
  // declare `search: { neighbors: true }`. With `compare.filter` (which a
  // realm policy sets to its grants), a neighbour the filter does not admit
  // is left out. `peers.similarity` and `stats.similarity` describe how
  // alike they are.
  async #lookalikeSets(
    realmURL: URL,
    query: Query,
    rowUrls: string[],
    opts: QueryOptions,
    entryType: 'instance' | 'file' | 'all',
  ): Promise<ComparedRows> {
    let compare = query.rerank!.compare!;
    let k = Math.min(compare.k ?? DEFAULT_NEAR_PEERS, MAX_NEAR_PEERS);
    let bySrc = await this.vectors.lookalikes({
      realmURL,
      anchor: filterAnchor(query.filter),
      field: compare.near!,
      sourceUrls: rowUrls,
      k,
      minSimilarity: compare.minSimilarity,
      reader: opts.reader,
      // The neighbours a row may have: those its comparison filter and, for
      // a caller a policy scopes, its grants admit.
      allowed: async () => {
        if (!compare.filter && !opts.grantFilter) {
          return undefined;
        }
        let { results } = await this._search(
          realmURL,
          { filter: compare.filter, let: query.let },
          { ...opts, cardUrls: undefined },
          ['SELECT i.url AS url'],
          entryType,
        );
        return new Set(results.map((r) => String((r as any).url)));
      },
    });
    let fields = comparisonFields(query.rerank!.expression).filter(
      (field) => field !== 'similarity',
    );
    let neighbourUrls = [
      ...new Set([...bySrc.values()].flat().map((n) => n.url)),
    ];
    let values = new Map<string, (number | null)[]>();
    if (fields.length && neighbourUrls.length) {
      let path = (p: string) => sqlTextArrayLiteral(p.split('.'));
      let columns = fields
        .map(
          (f, i) =>
            `CASE jsonb_typeof(spill_unmark(search_doc #> ${path(f)})) WHEN 'number' THEN (spill_unmark(search_doc #> ${path(f)}) #>> '{}')::double precision END AS c${i}`,
        )
        .join(', ');
      let rows = await this.db(opts).execute(
        `SELECT url, ${columns} FROM ${tableFromOpts(opts)} WHERE realm_url = $1 AND type = 'instance' AND url = ANY($2::text[]) AND (is_deleted IS NOT TRUE)`,
        { bind: [realmURL.href, neighbourUrls] },
      );
      for (let row of rows as Record<string, unknown>[]) {
        values.set(
          String(row.url),
          fields.map((_f, i) =>
            row[`c${i}`] == null ? null : Number(row[`c${i}`]),
          ),
        );
      }
    }
    // one row per (window row, neighbour), keyed by the window row
    let rows: ComparedRows['rows'] = [];
    for (let [src, list] of bySrc) {
      for (let n of list) {
        let own = values.get(n.url);
        rows.push({
          ord: rows.length,
          key: src,
          vals: {
            similarity: n.sim,
            ...Object.fromEntries(fields.map((f, i) => [f, own?.[i] ?? null])),
          },
        });
      }
    }
    return { fields: ['similarity', ...fields], rows };
  }

  // A rerank's comparison set, when its formula reads `peers.` or `stats.`:
  // the fields it names, read as numbers from every row of the set (the
  // query's matches, or `compare.filter`'s), grouped by `compare.by`.
  async #comparisonSet(
    realmURL: URL,
    query: Query,
    opts: QueryOptions,
    entryType: 'instance' | 'file' | 'all',
  ): Promise<ComparedRows | undefined> {
    let rerank = query.rerank!;
    let fields = comparisonFields(rerank.expression);
    if (fields.length === 0) {
      return undefined;
    }
    this.dialect.requirePostgres(
      'expression: a comparison set (peers. or stats.) runs on Postgres only',
    );
    let path = (p: string) => sqlTextArrayLiteral(p.split('.'));
    let columns = fields
      .map(
        (f, i) =>
          // a number, and the text of a text value: a `peers.` list holds
          // the set's text values too (COUNTIF(peers.kind, kind)); `stats.`
          // summarize the numbers
          `ANY_VALUE(CASE jsonb_typeof(spill_unmark(i.search_doc #> ${path(f)})) WHEN 'number' THEN (spill_unmark(i.search_doc #> ${path(f)}) #>> '{}')::double precision END) AS c${i}, ANY_VALUE(CASE jsonb_typeof(spill_unmark(i.search_doc #> ${path(f)})) WHEN 'string' THEN spill_unmark(i.search_doc #> ${path(f)}) #>> '{}' END) AS t${i}`,
      )
      .join(', ');
    let by = rerank.compare?.by;
    let group = by
      ? `, ANY_VALUE(spill_unmark(i.search_doc #> ${path(by)}) #>> '{}') AS g`
      : '';
    let { results, meta: setMeta } = await this._search(
      realmURL,
      {
        filter: rerank.compare?.filter ?? query.filter,
        let: query.let,
        // Exact: a set cut at its row limit says so by its total.
        page: { number: 0, size: compareRowLimit(), total: 'exact' },
      },
      { ...opts, cardUrls: undefined },
      [`SELECT i.url AS url, ${columns}${group}`],
      entryType,
    );
    let setTotal = Number(setMeta.page?.total ?? results.length);
    // one row per card of the set, keyed by its group; a field holds its
    // number, or its text (a `peers.` list keeps both, `stats.` count
    // numbers only)
    let rows: ComparedRows['rows'] = (results as Record<string, unknown>[]).map(
      (row, ord) => ({
        ord,
        key: by ? String(row.g ?? '') : '',
        vals: Object.fromEntries(
          fields.map((f, i) => {
            let v = row[`c${i}`];
            let t = row[`t${i}`];
            return [
              f,
              v != null && Number.isFinite(Number(v))
                ? Number(v)
                : typeof t === 'string'
                  ? t
                  : null,
            ];
          }),
        ),
      }),
    );
    return {
      fields,
      rows,
      ...(setTotal > results.length
        ? { truncated: { rows: results.length, total: setTotal } }
        : {}),
    };
  }

  // An expression (a sort's or a rerank's) is checked before it runs: a
  // function BXL does not know is refused with `unknown-function`, and a
  // name that is no field of the query's type with `unknown-field`, rather
  // than every row reading it as blank and ranking at 0. A binding's name,
  // `peers` and `stats` in a rerank, and the engine's own `_` keys are not
  // fields. A query anchored on no type, or on the base card type, reads any
  // search-doc name.
  protected async assertExpressions(
    filter: Filter | undefined,
    sort: Sort | undefined,
    rerank: Query['rerank'],
    lets: Query['let'],
    realmURL: URL,
    opts: QueryOptions,
  ) {
    let anchor = filterAnchor(filter);
    let exempt = new Set(Object.keys(lets ?? {}));
    let check = async (
      member: string,
      expr: string,
      on: CodeRef | undefined,
      also: string[] = [],
      checkFunctions = true,
    ) => {
      assertQueryExpressionProfile(member, expr);
      let unknown = checkFunctions
        ? unknownBxlFunctions(expr, BXL_FORMULA_FUNCTIONS)
        : [];
      if (unknown.length) {
        throw new InvalidQueryError(
          `${member}: ${unknown.join(', ')} ${unknown.length > 1 ? 'are not functions' : 'is not a function'} BXL knows`,
          'unknown-function',
        );
      }
      let type = on ?? anchor;
      if (!type || ('name' in type && type.name === 'CardDef')) return;
      let paths = exprFieldPaths(expr);
      if (!paths?.length) return;
      let definition: Definition | undefined;
      try {
        definition = await this.getDefinition(type);
      } catch {
        return;
      }
      if (!definition) return;
      for (let parts of paths) {
        let first = parts[0];
        if (
          !first ||
          first.startsWith('_') ||
          exempt.has(first) ||
          also.includes(first)
        ) {
          continue;
        }
        try {
          await getField(definition, parts.join('.'), this.definitionLookup);
        } catch (e) {
          if (
            e instanceof InvalidQueryError &&
            e.code === 'unknown-field' &&
            // a subclass's field, held by a card of the type here
            !(await this.typeHoldsPath(realmURL, type, parts.join('.'), opts))
          ) {
            throw new InvalidQueryError(
              `${member} ${JSON.stringify(expr)}: ${e.message.replace(/^Your filter refers to/, 'refers to')}`,
              'unknown-field',
            );
          }
        }
      }
    };
    // one-card bindings already resolved read under their names
    for (let s of sort ?? []) {
      if (isBlendSort(s)) {
        // a blend's expression signals run in SQL only, which already keeps
        // them to the score profile; the query profile names what it refuses
        for (let signal of s.of) {
          if (isExprSort(signal)) {
            assertQueryExpressionProfile('expression', signal.expr);
          }
        }
      }
      if (isExprSort(s)) {
        await check(
          'expression',
          s.expr,
          s.on,
          Object.keys(this.sortBindings.get(s) ?? {}),
        );
      }
    }
    if (rerank?.expression) {
      // the expression of a sort entry with `top`: `peers` and `stats` are
      // its comparison set, not fields
      await check('expression', rerank.expression, undefined, [
        'peers',
        'stats',
        ...Object.keys(this.rerankBindings.get(rerank) ?? {}),
      ]);
    }
  }

  // A query's `let` bindings, resolved before it is planned. A binding that
  // names one card by id and selects a link field's ids, read only by `in`s
  // on `id`, becomes `linkedFrom` and joins in the same statement. Any other
  // runs its own query over this realm first, and its selected values stand
  // in for each `"$name"`.
  // Each one-card binding's card: the first row of its query, read whole
  // from its search doc. Its values replace the references to it in the
  // filter, the sort and a rerank's comparison filter; a rerank formula
  // reads the card itself under the binding's name.
  protected rerankBindings = new WeakMap<object, Record<string, unknown>>();
}
