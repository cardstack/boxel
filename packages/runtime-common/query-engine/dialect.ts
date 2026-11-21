// The query engine's dialect: everything that differs between the Postgres
// index (the server) and the SQLite index (the browser) in one place.
//
// Owns: the capability table below (which index structure or SQL feature
// each optimization or feature needs), the SQL fragments spelled
// differently in the two dialects, the vector store each index reads, the
// one refusal of a Postgres-only feature (`needs-postgres`).
// Must not: run SQL or decide what a query means. A capability is a fact
// about the dialect, never about a query; the engine module that uses it
// decides what to do without it (fall back to the portable form, or
// refuse). A fragment takes what it needs as arguments; where the Postgres
// form is engine logic (text search's tsquery forms), the engine builds it
// and passes it in, and the fragment builds SQLite's fallback and picks one.
// No engine file outside this one branches on the adapter kind.
// Guarantees: a query feature SQLite cannot run is answered with its closest
// approximation and a warning, never refused (sqlite-approximations.ts;
// docs/search.md, "On SQLite"); `refuse` (`needs-postgres`) is left for what
// no query reaches on SQLite. Every flag is true
// on Postgres and false on SQLite today; they are named so each branch says
// what it depends on. A fragment renders the same SQL text the inline
// `dbExpression` it replaced did.

import type { DBAdapter } from '../db.ts';
import { param, type Expression, type Param } from '../expression.ts';
import { InvalidQueryError, type FacetInterval } from '../query.ts';
import { CARD_TITLE_KEY } from '../search-doc-keys.ts';
import { arrayElement, sqlTextArrayLiteral } from '../sql-literal.ts';
import type { VectorStore } from '../vector-store.ts';
import { PgVectorStore } from '../vector-store-pg.ts';
import { SqliteVectorStore } from '../vector-store-sqlite.ts';

// A SQLite substring test: the text to search and the text to find in it.
export interface LikeTest {
  text: string | Expression;
  needle: string;
}

export interface QueryDialect {
  // The adapter kind, for `expressionToSql`.
  readonly kind: DBAdapter['kind'];
  // How many URLs one link-target lookup binds (two parameters each): half
  // the index writer's url-batch sizes, well under each adapter's limit.
  readonly linkLookupChunkSize: number;

  // Index structures only the Postgres index keeps.
  // `realm_generations`: a realm's default time zone is cached per index
  // generation.
  readonly realmGenerations: boolean;
  // `title_sort`: a `cardTitle` sort reads the generated column.
  readonly titleSort: boolean;
  // `search_keys`: a scalar field reads the row's narrow, inline copy of its
  // search doc (see `docRead`).
  readonly searchKeys: boolean;
  // Typo correction (the realm's word list and trigram similarity).
  readonly typoCorrection: boolean;
  // Rendered-page passages (the passages table, `ts_headline` over the
  // markdown vector).
  readonly passages: boolean;
  // Log tables: the line index, and a `let` binding over a log synced
  // before the snapshot.
  readonly logs: boolean;
  // pgvector: the vector table, its spaces and counts.
  readonly vectors: boolean;
  // The value store (`boxel_index_values` and its dictionaries; the
  // add-boxel-index-values migration).
  readonly valueStore: boolean;

  // SQL features only Postgres has.
  // jsonb containment and jsonpath (`@>`, `@?`), GIN-served.
  readonly jsonbContainment: boolean;
  // The title trigram index, for a short title substring.
  readonly titleTrigram: boolean;
  // A trigram-served prefilter before a pattern's exact test.
  readonly patternPrefilter: boolean;
  // A pattern crossing `/` also checks its segments with a regex.
  readonly globSegments: boolean;
  // tsquery negation for an excluded word in `matches`.
  readonly tsqueryNegation: boolean;
  // An `any` over indexed keys as a UNION of index scans.
  readonly indexedUnion: boolean;
  // `pg_timezone_names`, checked before a zone is used.
  readonly timeZoneNames: boolean;
  // Expressions in SQL (the score profile): expression sorts, a window's
  // `top`, comparison sets.
  readonly expressions: boolean;
  // Regular expressions (`~`), for a `regex` filter.
  readonly regularExpressions: boolean;
  // A broad text match capped at its candidate cap (an indexed probe).
  readonly candidateCaps: boolean;
  // Paging strategies that rely on the Postgres planner: the keyed narrow
  // pass and the ungrouped plain top-N (with filter-first and the ordered
  // walk).
  readonly plannerPaging: boolean;

  // SQL fragments spelled differently in each dialect.
  // A list element's value as a number: Postgres casts text that looks
  // numeric; SQLite's value is one already.
  numericText(value: Expression): Expression;
  // A search-doc field's value at a list-free path, as `->>` reads it,
  // through the hot doc (`hotDoc` below).
  docRead(names: string[]): Expression;
  // A search-doc field's value (a `docRead`) as a number: Postgres casts by
  // a regex; SQLite by `typeof` and GLOB.
  numericField(read: Expression): Expression;
  // A bound value compared with a numeric field: SQLite casts it.
  numericBind(bound: Param): Expression;
  // A tree element holds a value: not jsonb `'null'` on Postgres, not SQL
  // NULL on SQLite.
  jsonPresent(): Expression;
  // A cast to a float: DOUBLE PRECISION on Postgres, REAL on SQLite.
  castFloat(value: Expression): Expression;
  // A row's first type key: `->>0` on Postgres, `json_extract` on SQLite.
  firstType(alias: string): Expression;
  // `AND` the search doc holds a value at a bracket-free path: `#>` on
  // Postgres, `json_extract` on SQLite.
  pathExists(path: string): Expression;
  // The rows whose card id is one `cardIs` (over `lfs.file_alias`) links to
  // at `path`: jsonb functions on Postgres, `json_each` on SQLite.
  linkedFromIds(
    indexTable: string,
    path: string,
    cardIs: Expression,
  ): Expression;
  // A date facet's bucket: Postgres's (built by the engine), or SQLite's
  // date functions over the same instant.
  dateBucket(postgres: string, interval: FacetInterval): Expression;
  // A text match: Postgres's tsvector test (built by the engine), or
  // SQLite's case-insensitive substring of `text`.
  textMatch(
    postgres: Expression,
    text: string | Expression,
    needle: string,
  ): Expression;
  // Type-ahead words: Postgres's tsquery test, or SQLite's substring test of
  // each (lowercased) word in `text`.
  everyWordMatch(
    postgres: Expression,
    text: string,
    words: string[],
  ): Expression;
  // A match's relevance: Postgres's rank, or SQLite's 1 or 0 (whether any
  // test holds).
  matchRelevance(postgres: Expression, tests: LikeTest[]): Expression;
  // A type-ahead title tier: Postgres's (whole words by regex), or SQLite's
  // approximation by LIKE.
  typeAheadTier(postgres: Expression, typed: string): Expression;

  // The vector store this index reads: pgvector, or the search doc's own
  // vectors on SQLite.
  vectorStore(dbAdapter: DBAdapter): VectorStore;

  // Refuses with `needs-postgres` (the one place that code is thrown), as
  // an InvalidQueryError or the caller's subclass of it.
  refuse(
    message: string,
    refusal?: (message: string, code: string) => InvalidQueryError,
  ): never;
  // Refuses a feature this index cannot run (`needs-postgres`), as an
  // InvalidQueryError or the caller's subclass of it (a log query's
  // LogQueryError, which carries its HTTP status).
  requirePostgres(
    message: string,
    refusal?: (message: string, code: string) => InvalidQueryError,
  ): void;
}

// What `dbExpression({ pg, sqlite })` rendered, picked here: an expression
// as is, a scalar as its text, and nothing (or an empty list) as one empty
// element, so the statement keeps the same text.
function pick(
  isPostgres: boolean,
  pg: Expression | string | undefined,
  sqlite: Expression | string | undefined,
): Expression {
  let chosen = isPostgres ? pg : sqlite;
  if (Array.isArray(chosen)) {
    return chosen.length > 0 ? chosen : [''];
  }
  return [chosen == null ? '' : String(chosen)];
}

// SQLite's case-insensitive substring test of `text`.
function likeContains({ text, needle }: LikeTest): Expression {
  let open: Expression =
    typeof text === 'string'
      ? [`LOWER(coalesce(${text}, '')) LIKE LOWER(`]
      : ['LOWER(coalesce(', ...text, `, '')) LIKE LOWER(`];
  return [...open, param(`%${escapeLikePattern(needle)}%`), `) ESCAPE '\\'`];
}

// Text a number field's read takes for a number (`numericField`): the
// value store's range tests repeat it (store-facets.ts).
export const NUMERIC_TEXT = '^\\s*-?[0-9]+(\\.[0-9]+)?([eE][-+]?[0-9]+)?\\s*$';

// The column a read of the search doc at `names` reads: the row's
// `search_keys` where it holds the doc's value there, else `search_doc`.
// `search_keys` (add-boxel-index-search-keys) is the doc with each value a
// read wants hot kept as is: scalars, strings up to 256 bytes, lists up to
// 512 bytes, within a 3,000-byte budget; every other value, and where the
// budget needs it a whole object or the whole projection, is the marker
// `{"$doc": true}`. Where the marker is at `names` or above it, or the value
// there is an object (whose members may be marked), the doc is read; anything
// else there (a scalar, a list, or nothing at all) is the doc's own value at
// that path, so either column reads the same.
//
// Technique (the hot doc): every read of the doc at a path goes through here,
// on Postgres: a field's value (`docRead`) for sorts, blend arms and `eq` /
// `in` / `range` tests, and a list's tree (`jsonb_tree`) for list tests. Not
// for a path with a numeric segment, which `#>` would index into a list. It
// is faster because `search_keys` is small and stored in the row, so a read
// over thousands of rows decompresses no doc; the doc read detoasted and
// decompressed the whole doc, on every row matched, once for each time a
// statement names the read.
export function hotDoc(kind: DBAdapter['kind'], names: string[]): string {
  if (kind !== 'pg' || names.some((name) => /^-?[0-9]+$/.test(name))) {
    return 'search_doc';
  }
  // The marker above the path (`?` holds for an object with the key; on
  // anything else it reads the doc, which is never wrong), or an object at
  // it (a marker, or an object whose members may be marked).
  let above = names.map((_, i) =>
    i === 0
      ? `(search_keys ? '$doc')`
      : `((search_keys #> ${sqlTextArrayLiteral(names.slice(0, i))}) ? '$doc')`,
  );
  let at = `jsonb_typeof(search_keys #> ${sqlTextArrayLiteral(names)}) = 'object'`;
  return `(CASE WHEN ${[...above, at].join(' OR ')} THEN search_doc ELSE search_keys END)`;
}

// A GIN-served test of the search doc (`@>`, `@?`) at a path, run on the
// row's `search_keys` and read from the doc only where the projection holds
// the marker at or above the path: `t(search_keys) OR (m AND
// t(search_doc))`, `m` being one `search_keys @> ANY(...)` of the marker
// `{"$doc": true}` nested at the root and at each of the path's prefixes,
// which the same index answers. Where no marker is there, `search_keys` holds
// the doc's subtree at the path as it is (a kept value, a kept list, or an
// object whose kept members are the doc's), so its test is the doc's; where
// one is, its test fails and the doc's decides. A doc that is not an object
// is the marker whole (search_keys_of), so `search_keys` is NULL only where
// the doc is.
//
// Technique (the hot GIN): chosen for every containment and jsonpath test of
// a field (eq and in on a string, a list holding a string) on Postgres, at a
// path with no numeric segment. Faster because the index on `search_keys`
// (jsonb_path_ops) narrows to the rows that hold the value and their recheck
// reads the inline projection, where the index on `search_doc` recheck
// detoasted the whole doc of every candidate.
export function hotIndexedTest(
  kind: DBAdapter['kind'],
  segments: string[],
  test: (column: string) => Expression,
  alias?: string,
  strict = false,
): Expression {
  let column = (name: string) => (alias ? `${alias}.${name}` : name);
  if (kind !== 'pg' || segments.some((name) => /^-?[0-9]+$/.test(name))) {
    return test(column('search_doc'));
  }
  let marker = { $doc: true };
  let markers = [
    marker,
    ...segments.map((_, i) =>
      segments
        .slice(0, i + 1)
        .reduceRight<
          Record<string, unknown>
        >((acc, segment) => ({ [segment]: acc }), marker),
    ),
  ];
  let marked: Expression = [
    `${column('search_keys')} @> ANY(ARRAY[`,
    ...markers.flatMap((m, i) => [
      ...(i ? [','] : []),
      param(m as never),
      '::jsonb',
    ]),
    '])',
  ];
  // Where the marker is at or above the path, `search_keys` holds no value
  // there, so its test fails and the doc's decides; elsewhere its test is the
  // doc's. A strict jsonpath test of a marked row can be unknown rather than
  // false (a structural error), so it is kept to the unmarked rows.
  return [
    '((',
    ...(strict ? ['NOT', ...marked, 'AND'] : []),
    ...test(column('search_keys')),
    ') OR (',
    ...marked,
    'AND',
    ...test(column('search_doc')),
    '))',
  ];
}

// A field's value out of a row's search doc, at a list-free path, as `->>`
// reads it: `<hotDoc> -> 'a' ->> 'b'`.
function docRead(kind: DBAdapter['kind'], names: string[]): Expression {
  return [
    hotDoc(kind, names),
    ...names.flatMap((name, i) => [
      i < names.length - 1 ? '->' : '->>',
      param(name),
    ]),
  ];
}

function makeDialect(kind: DBAdapter['kind']): Readonly<QueryDialect> {
  let isPostgres = kind === 'pg';
  let refuse = (
    message: string,
    refusal = (m: string, code: string) => new InvalidQueryError(m, code),
  ): never => {
    throw refusal(message, 'needs-postgres');
  };
  return Object.freeze({
    kind,
    linkLookupChunkSize: isPostgres ? 2500 : 450,
    realmGenerations: isPostgres,
    titleSort: isPostgres,
    searchKeys: isPostgres,
    typoCorrection: isPostgres,
    passages: isPostgres,
    logs: isPostgres,
    vectors: isPostgres,
    valueStore: isPostgres,
    jsonbContainment: isPostgres,
    titleTrigram: isPostgres,
    patternPrefilter: isPostgres,
    globSegments: isPostgres,
    tsqueryNegation: isPostgres,
    indexedUnion: isPostgres,
    timeZoneNames: isPostgres,
    expressions: isPostgres,
    regularExpressions: isPostgres,
    candidateCaps: isPostgres,
    plannerPaging: isPostgres,

    numericText(value: Expression): Expression {
      return pick(
        isPostgres,
        [
          '(CASE WHEN',
          ...value,
          `~ '^-?[0-9]+(\\.[0-9]+)?([eE][-+]?[0-9]+)?$' THEN (`,
          ...value,
          ')::numeric END)',
        ],
        value,
      );
    },
    docRead(names: string[]): Expression {
      return docRead(kind, names);
    },
    numericField(read: Expression): Expression {
      return pick(
        isPostgres,
        [
          '(CASE WHEN (',
          ...read,
          `) ~ '${NUMERIC_TEXT}' THEN (`,
          ...read,
          ')::numeric END)',
        ],
        [
          '(CASE WHEN typeof(',
          ...read,
          ") IN ('integer', 'real') THEN",
          ...read,
          ' WHEN (',
          ...read,
          ") NOT GLOB '*[^0-9.eE+-]*' AND (",
          ...read,
          ") GLOB '*[0-9]*' THEN CAST(",
          ...read,
          ' AS NUMERIC) END)',
        ],
      );
    },
    numericBind(bound: Param): Expression {
      return isPostgres ? [bound] : ['CAST(', bound, 'AS NUMERIC)'];
    },
    jsonPresent(): Expression {
      return pick(isPostgres, "<> 'null'::jsonb", 'IS NOT NULL');
    },
    castFloat(value: Expression): Expression {
      return [
        'CAST(',
        ...value,
        ...pick(isPostgres, 'AS DOUBLE PRECISION)', 'AS REAL)'),
      ];
    },
    firstType(alias: string): Expression {
      return pick(
        isPostgres,
        `${alias}.types->>0`,
        `json_extract(${alias}.types, '$[0]')`,
      );
    },
    pathExists(path: string): Expression {
      return pick(
        isPostgres,
        [
          'AND i.search_doc #>',
          param(`{${path.split('.').map(arrayElement).join(',')}}`),
          '::text[] IS NOT NULL',
        ],
        ['AND json_extract(i.search_doc,', param(`$.${path}`), ') IS NOT NULL'],
      );
    },
    linkedFromIds(
      indexTable: string,
      path: string,
      cardIs: Expression,
    ): Expression {
      if (isPostgres) {
        let at = `{${path.split('.').map(arrayElement).join(',')}}`;
        return [
          `i.file_alias IN (SELECT lf.value ->> 'id' FROM ${indexTable} AS lfs CROSS JOIN LATERAL jsonb_array_elements(CASE jsonb_typeof(lfs.search_doc #>`,
          param(at),
          `::text[]) WHEN 'array' THEN lfs.search_doc #>`,
          param(at),
          `::text[] WHEN 'object' THEN jsonb_build_array(lfs.search_doc #>`,
          param(at),
          `::text[]) ELSE '[]'::jsonb END) AS lf(value) WHERE`,
          ...cardIs,
          `AND lfs.type = 'instance' AND lfs.realm_url = i.realm_url AND (lfs.is_deleted IS NOT TRUE) AND lf.value ->> 'id' IS NOT NULL)`,
        ];
      }
      return [
        `i.file_alias IN (SELECT json_extract(lf.value, '$.id') FROM ${indexTable} AS lfs, json_each(CASE json_type(lfs.search_doc,`,
        param(`$.${path}`),
        `) WHEN 'array' THEN json_extract(lfs.search_doc,`,
        param(`$.${path}`),
        `) WHEN 'object' THEN json_array(json_extract(lfs.search_doc,`,
        param(`$.${path}`),
        `)) ELSE '[]' END) AS lf WHERE`,
        ...cardIs,
        `AND lfs.type = 'instance' AND lfs.realm_url = i.realm_url AND (lfs.is_deleted IS NULL OR lfs.is_deleted = 0))`,
      ];
    },
    dateBucket(postgres: string, interval: FacetInterval): Expression {
      if (isPostgres) {
        return [postgres];
      }
      let instant = `CASE WHEN fv.num IS NOT NULL THEN datetime(CASE WHEN abs(fv.num) >= 100000000000 THEN fv.num / 1000.0 ELSE fv.num END, 'unixepoch') ELSE datetime(fv.value) END`;
      return [
        {
          day: `date(${instant})`,
          week: `date(${instant}, '-6 days', 'weekday 1')`,
          month: `strftime('%Y-%m-01', ${instant})`,
          year: `strftime('%Y-01-01', ${instant})`,
        }[interval],
      ];
    },
    textMatch(
      postgres: Expression,
      text: string | Expression,
      needle: string,
    ): Expression {
      return isPostgres
        ? pick(true, postgres, undefined)
        : likeContains({ text, needle });
    },
    everyWordMatch(
      postgres: Expression,
      text: string,
      words: string[],
    ): Expression {
      return pick(
        isPostgres,
        postgres,
        words.flatMap((word, index) => [
          ...(index > 0 ? ['AND'] : []),
          `LOWER(coalesce(${text}, '')) LIKE`,
          param(`%${escapeLikePattern(word)}%`),
          `ESCAPE '\\'`,
        ]),
      );
    },
    matchRelevance(postgres: Expression, tests: LikeTest[]): Expression {
      if (isPostgres) {
        return pick(true, postgres, undefined);
      }
      return [
        'CASE WHEN (',
        ...tests.flatMap((test, index) => [
          ...(index > 0 ? ['OR'] : []),
          ...likeContains(test),
        ]),
        ') THEN 1 ELSE 0 END',
      ];
    },
    typeAheadTier(postgres: Expression, typed: string): Expression {
      let title = `lower(i.search_doc ->> '${CARD_TITLE_KEY}')`;
      return pick(isPostgres, postgres, [
        `(CASE WHEN ${title} =`,
        param(typed),
        `THEN 4`,
        // Whole words at the start, approximately: followed by a space or a
        // comma, or a plural "s".
        ...[' %', ',%', 's', 's %', 's,%'].flatMap((ending) => [
          `WHEN ${title} LIKE`,
          param(`${escapeLikePattern(typed)}${ending}`),
          `ESCAPE '\\' THEN 3`,
        ]),
        `WHEN ${title} LIKE`,
        param(`${escapeLikePattern(typed)}%`),
        `ESCAPE '\\' THEN 2 ELSE 1 END)`,
      ]);
    },

    vectorStore(dbAdapter: DBAdapter): VectorStore {
      return isPostgres
        ? new PgVectorStore(dbAdapter)
        : new SqliteVectorStore();
    },

    refuse,
    requirePostgres(
      message: string,
      refusal?: (message: string, code: string) => InvalidQueryError,
    ) {
      if (!isPostgres) {
        refuse(message, refusal);
      }
    },
  });
}

const DIALECTS = new Map<DBAdapter['kind'], Readonly<QueryDialect>>();

export function dialectFor(kind: DBAdapter['kind']): Readonly<QueryDialect> {
  let found = DIALECTS.get(kind);
  if (!found) {
    found = makeDialect(kind);
    DIALECTS.set(kind, found);
  }
  return found;
}

// LIKE treats `%` and `_` as wildcards. With `ESCAPE '\'` (SQLite) or
// Postgres's default escape, a user-supplied wildcard is neutralized by
// prefixing it (and the escape char itself) with a backslash before binding.
// The card engine's `contains` and a log query's `contains` share it.
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
