// The query engine's dialect: everything that differs between the Postgres
// index (the server) and the SQLite index (the browser) in one place.
//
// Owns: the capability table below (which index structure or SQL feature
// each optimization or feature needs), the one refusal of a Postgres-only
// feature (`needs-postgres`), and the query-level check that runs before any
// statement does (`assertRunnable`).
// Must not: build SQL, or read the adapter. A capability is a fact about
// the dialect, never about a query; the engine module that uses it decides
// what to do without it (fall back to the portable form, or refuse).
// Guarantees: a feature SQLite cannot run is refused with `needs-postgres`
// before anything reads the index (docs/search.md, "Errors"; the code list
// is in invalid-query-error.ts). Every flag is true on Postgres and false on
// SQLite today; they are named so each branch says what it depends on.

import type { DBAdapter } from '../db.ts';
import { InvalidQueryError } from '../query.ts';

export interface QueryDialect {
  // The adapter kind, for `expressionToSql`.
  readonly kind: DBAdapter['kind'];
  readonly isPostgres: boolean;
  // How many URLs one link-target lookup binds (two parameters each): half
  // the index writer's url-batch sizes, well under each adapter's limit.
  readonly linkLookupChunkSize: number;

  // Index structures only the Postgres index keeps.
  // `realm_generations`: a realm's default time zone is cached per index
  // generation.
  readonly realmGenerations: boolean;
  // Search-doc spilling: a long value lives in `boxel_index_spill`, read
  // through `spill_text`, and a field reads as jsonb (`->`).
  readonly searchDocSpill: boolean;
  // Realm word statistics: BM25-style weights for `matches`.
  readonly wordStatistics: boolean;
  // Typo correction (the realm's word list and trigram similarity).
  readonly typoCorrection: boolean;
  // Rendered-page passages (`ts_headline` over the markdown vector).
  readonly passages: boolean;
  // Log tables: a `let` binding over a log is synced before the snapshot.
  readonly logs: boolean;
  // pgvector, for counting the vectors a grant lets a caller see.
  readonly vectors: boolean;

  // SQL features only Postgres has.
  // jsonb containment and jsonpath (`@>`, `@?`), GIN-served.
  readonly jsonbContainment: boolean;
  // The title trigram index, for a short title substring.
  readonly titleTrigram: boolean;
  // A trigram-served prefilter before a pattern's exact test.
  readonly patternPrefilter: boolean;
  // tsquery negation for an excluded word in `matches`.
  readonly tsqueryNegation: boolean;
  // An `any` over indexed keys as a UNION of index scans.
  readonly indexedUnion: boolean;
  // `pg_timezone_names`, checked before a zone is used.
  readonly timeZoneNames: boolean;
  // Expressions in SQL (the score profile): expression sorts, a window's
  // `top`, comparison sets.
  readonly expressions: boolean;
  // A broad text match capped at its candidate cap (an indexed probe).
  readonly candidateCaps: boolean;
  // Paging strategies that rely on the Postgres planner: the keyed narrow
  // pass and the ungrouped plain top-N (with filter-first and the ordered
  // walk).
  readonly plannerPaging: boolean;

  // Refuses a feature this index cannot run (`needs-postgres`), as an
  // InvalidQueryError or the caller's subclass of it (a log query's
  // LogQueryError, which carries its HTTP status).
  requirePostgres(
    message: string,
    refusal?: (message: string, code: string) => InvalidQueryError,
  ): void;
  // Refuses, before any statement runs, a query asking for a feature only
  // Postgres runs: a regex filter, an expression in the sort, a facet.
  assertRunnable(query: unknown): void;
}

function makeDialect(kind: DBAdapter['kind']): Readonly<QueryDialect> {
  let isPostgres = kind === 'pg';
  return Object.freeze({
    kind,
    isPostgres,
    linkLookupChunkSize: kind === 'sqlite' ? 450 : 2500,
    realmGenerations: isPostgres,
    searchDocSpill: isPostgres,
    wordStatistics: isPostgres,
    typoCorrection: isPostgres,
    passages: isPostgres,
    logs: isPostgres,
    vectors: isPostgres,
    jsonbContainment: isPostgres,
    titleTrigram: isPostgres,
    patternPrefilter: isPostgres,
    tsqueryNegation: isPostgres,
    indexedUnion: isPostgres,
    timeZoneNames: isPostgres,
    expressions: isPostgres,
    candidateCaps: isPostgres,
    plannerPaging: isPostgres,
    requirePostgres(
      message: string,
      refusal = (m: string, code: string) => new InvalidQueryError(m, code),
    ) {
      if (!isPostgres) {
        throw refusal(message, 'needs-postgres');
      }
    },
    assertRunnable(query: unknown) {
      if (isPostgres) return;
      let feature = postgresOnlyFeature(query);
      if (feature) {
        throw new InvalidQueryError(feature, 'needs-postgres');
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

// What a query asks of the index that only Postgres runs, as the refusal's
// message: a regex filter, an expression in the sort (a blend signal and a
// window included), or a facet. Undefined when it asks for none of them.
function postgresOnlyFeature(query: unknown): string | undefined {
  if (!query || typeof query !== 'object') return undefined;
  let q = query as Record<string, unknown>;
  if (filterHoldsRegex(q.filter)) {
    return 'a regex filter needs Postgres; this index has no regular expressions';
  }
  let hasExpression = (entry: unknown): boolean => {
    if (!entry || typeof entry !== 'object') return false;
    let e = entry as Record<string, unknown>;
    if ('expression' in e || e.by === '_expr') return true;
    return [e.blend, e.of].some(
      (signals) => Array.isArray(signals) && signals.some(hasExpression),
    );
  };
  if (
    (Array.isArray(q.sort) && q.sort.some(hasExpression)) ||
    (q.rerank !== undefined && q.rerank !== null)
  ) {
    return 'an expression sort runs on Postgres only';
  }
  if (Array.isArray(q.facets) && q.facets.length > 0) {
    return 'facets are counted from the facet table, which only the Postgres index keeps; this index (SQLite) cannot count them';
  }
  return undefined;
}

// Whether a filter tree holds a `regex` node anywhere (under `every`, `any`
// and `not`).
function filterHoldsRegex(filter: unknown): boolean {
  if (!filter || typeof filter !== 'object' || Array.isArray(filter)) {
    return false;
  }
  let node = filter as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(node, 'regex')) return true;
  return (
    (Array.isArray(node.every) && node.every.some(filterHoldsRegex)) ||
    (Array.isArray(node.any) && node.any.some(filterHoldsRegex)) ||
    filterHoldsRegex(node.not)
  );
}
