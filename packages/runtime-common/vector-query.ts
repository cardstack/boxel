import type { DBAdapter } from './db.ts';
import type { CardExpression } from './expression.ts';
import type { FieldDefinition } from './definitions.ts';
import {
  type CodeRef,
  codeRefWithAbsoluteIdentifier,
  internalKeyFor,
  isResolvedCodeRef,
} from './index.ts';
import {
  InvalidQueryError,
  type BlendComponent,
  type NearFilter,
  type NearSortTarget,
  type Sort,
} from './query.ts';
import { vectorDimensions, vectorToSqlLiteral } from './serializers/vector.ts';
import { VECTOR_INDEX_UNAVAILABLE_MESSAGE } from './vector-index.ts';
import {
  vectorSearchSettings,
  vectorStoreFor,
  type VectorStore,
} from './vector-store.ts';
import type { VirtualNetwork } from './virtual-network.ts';
import { realmsOf } from './realm-union.ts';
import { dialectFor } from './query-engine/dialect.ts';

// Near search: ranking and filtering cards by how close one of their vectors
// is to a target vector.
//
// Practice: dense retrieval by cosine similarity, as vector databases and
// RAG pipelines rank passages by embedding distance; hybrid search, which
// fuses a vector ranking with text and other signals by reciprocal rank
// fusion (Cormack, Clarke and Buettcher, 2009; Elasticsearch's RRF retriever,
// Weaviate's hybrid search); and "look-alikes", each result's own nearest
// neighbours (Elasticsearch's kNN query seeded by a stored vector).
// Boxel's mapping:
//   - a `near` sort ranks the cards a query admits by one VectorField; a
//     `near` filter admits the cards within `minSimilarity`; a near signal
//     inside a `_blend` contributes a rank to the fusion;
//   - an expression sort entry's `compare.near` reads each result's look-alikes by a field that
//     declares `search: { neighbors: true }`;
//   - a one-card `let` binding reads a stored card's vector as a target,
//     with its space;
//   - the space guard: a vector's space names the model, revision, provider
//     and size that made it (vector-space.ts), and two spaces are never
//     compared (`vector-space-mismatch`), as a vector database keeps one
//     collection per embedding model.
//   - two-phase retrieval: approximate nearest neighbours for candidates,
//     then exact re-scoring (Vespa's first and second phase;
//     Elasticsearch's kNN `num_candidates` with a `rescore`), and an exact
//     scan below a size threshold, where an index buys nothing (Lucene and
//     Elasticsearch fall back to exact search for small filtered sets).
// Boxel's mapping of the two phases: the engine, not the database planner,
// chooses. It counts the realm's vectors in the field and space (stopping
// at the threshold); below `exactThreshold`, or with no index, it scans them
// exactly. Above it, the space's HNSW index (vector-store-pg.ts) gives the
// nearest few times a page's worth of vectors, and the query then compares
// only those cards' vectors, exactly, so the order of what is returned is
// exact; only which cards were candidates is approximate (about 98-99%
// recall@10 at the defaults). `meta.near` reports the path taken.
// Where Boxel diverges: a near search is a clause of the one declarative
// query, never a separate vector call, so it filters, facets and pages with
// the rest of the query. The SQL lives behind `VectorStore`
// (vector-store.ts, vector-store-pg.ts).

// A `near` sort ranks by cosine similarity between a VectorField and a target
// vector (see `NearSortTarget` in query.ts). Like `_matchRelevance`, the score
// belongs to the query and reads "higher is better": `_search` projects it as
// an aggregated, aliased column (`nearSimilarityAlias`) and the order builders
// reference the alias, defaulting to `desc` (most similar first). The first
// near sort's similarity (1 = same direction, -1 = opposite) rides each
// result's `meta._nearSimilarity`.
export const NEAR_SIMILARITY_KEY = '_nearSimilarity';

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
export function nearSimilarityAlias(sort: Sort, index: number): string {
  let firstNear = sort.findIndex((s) => isNearSort(s));
  return index === firstNear
    ? NEAR_SIMILARITY_KEY
    : `${NEAR_SIMILARITY_KEY}_${index}`;
}

// The space of a near target read from a stored card (a one-card binding),
// keyed by the target's array. A target written as numbers has none, and
// compares with whatever the field holds at its size.
const vectorTargetSpaces = new WeakMap<object, string>();

function targetSpaceOf(target: unknown): string | undefined {
  return target && typeof target === 'object'
    ? vectorTargetSpaces.get(target)
    : undefined;
}

// The space a near filter's field is declared in, keyed by the filter's
// `{ to, minSimilarity }` entry (the filter compiler is synchronous, so
// `assertNearFilter` reads it first).
const nearFilterDeclaredSpaces = new WeakMap<object, string>();

// A near search past the exact threshold that compared every vector: the
// warning a caller tuning a slow search reads, whatever made it exact (save
// a caller's own `exact` and a field that is a small share of its space).
export function warnExactScan(
  ctx: NearContext | undefined,
  fieldPath: string,
  threshold: number,
  reason: NonNullable<NearReport['reason']>,
) {
  if (!ctx || ctx.warnings.some((w) => w.code === 'near-exact-scan')) return;
  ctx.warnings.push({
    code: 'near-exact-scan',
    message: `a near search over "${fieldPath}" compared each of more than ${threshold.toLocaleString('en-US')} vectors exactly (${reason})`,
  });
}

// A target of all zeros has no direction, so no similarity to it exists:
// refused, rather than answered with NaN. A target read from a card (it
// carries its space) is that card's vector, and a stored zero vector is no
// vector: it matches nothing.
export function assertHasDirection(target: unknown, what: string) {
  if (
    Array.isArray(target) &&
    target.length > 0 &&
    target.every((n) => n === 0) &&
    targetSpaceOf(target) == null
  ) {
    throw new InvalidQueryError(
      `${what}: the target vector is all zeros, which has no direction to compare with`,
      'invalid-value',
    );
  }
}

function removeBrackets(path: string) {
  return path.replace(/\[\]/g, '');
}

// The candidates an approximate near filter read, by the filter's
// `{ to, minSimilarity }` entry and then by realm (one filter object may be
// searched in several realms at once).
const nearFilterCandidates = new WeakMap<object, Map<string, string[]>>();

// How one near search ran, for `meta.near` and for tuning. `candidates` is
// how many of the realm's vectors in the field and space were counted,
// stopping one past `threshold` (or past `minShare` of the space, when that
// is more). `reason` says why a search ran exactly.
export interface NearReport {
  path: 'exact' | 'hnsw';
  candidates: number;
  threshold: number;
  efSearch?: number;
  // how many cards the approximate read handed to exact re-scoring
  rescored?: number;
  reason?:
    | 'below-threshold'
    | 'small-share'
    | 'no-index'
    | 'no-space'
    | 'unpaged'
    | 'not-leading'
    | 'asked'
    | 'too-many-matches'
    | 'filtered-out';
}

// One search's near plans: what it asked for, and what the approximate reads
// left behind for the engine to check once the rows are in.
export class NearContext {
  // run every near search exactly (the engine's retry, below)
  readonly exact: boolean;
  // the page the query asks for; an unpaged near sort is exact
  readonly page: { size: number; number?: number } | undefined;
  reports: NearReport[] = [];
  warnings: { code: string; message: string }[] = [];
  // Set when the leading near sort compared only the candidates of an
  // approximate read that was cut short: a page row without a similarity
  // may then be a card the filter admits whose vector was not read.
  leadingSortTruncated = false;

  // For a caller a realm policy scopes: counts the field's vectors on the
  // cards the caller's grants open, so how a search ran (and what
  // `meta.near` reports) is what a realm holding only those cards gives,
  // never a count of cards the caller cannot read (ADR 006).
  readonly countVisible?: (
    fieldPath: string,
    space: string,
    limit: number,
  ) => Promise<number>;

  // The search's read snapshot: the vectors its near reads compare are the
  // ones its rows were read with (see `DBAdapter.withReadSnapshot`).
  readonly reader?: DBAdapter;

  constructor(opts: {
    exact?: boolean;
    page?: { size: number; number?: number };
    countVisible?: (
      fieldPath: string,
      space: string,
      limit: number,
    ) => Promise<number>;
    reader?: DBAdapter;
  }) {
    this.exact = Boolean(opts.exact);
    this.page = opts.page;
    this.countVisible = opts.countVisible;
    this.reader = opts.reader;
  }

  // The report for `meta.near`: the first approximate search, else the
  // first.
  get report(): NearReport | undefined {
    return this.reports.find((r) => r.path === 'hnsw') ?? this.reports[0];
  }

  // Whether the rows returned show the approximate read starved the page:
  // a row with no similarity from the leading near sort, when there may
  // have been more candidates. The engine then runs the query exactly.
  starved(rows: Record<string, unknown>[]): boolean {
    return (
      this.leadingSortTruncated &&
      rows.some((row) => row[NEAR_SIMILARITY_KEY] == null)
    );
  }

  // the rows a page needs, through its last
  get needed(): number | undefined {
    return this.page
      ? this.page.size * ((this.page.number ?? 0) + 1)
      : undefined;
  }
}

// What the query engine lends the near search: its database, its realm's
// network (for type keys) and its field lookup.
export interface VectorQueryHost {
  dbAdapter: DBAdapter;
  virtualNetwork: VirtualNetwork;
  fieldOf(on: CodeRef, path: string): Promise<FieldDefinition>;
}

export type VectorStatus = Record<
  string,
  {
    status: 'ok' | 'stale' | 'missing';
    space: string;
    count: number;
    errors?: { code: string; message: string; item?: string }[];
  }
>;

export class VectorQuery {
  #host: VectorQueryHost;
  #store: VectorStore;

  constructor(host: VectorQueryHost) {
    this.#host = host;
    this.#store = vectorStoreFor(host.dbAdapter);
  }

  get #pg() {
    return this.#host.dbAdapter.kind === 'pg';
  }

  // Each vector field's state for a card read: `ok` when every vector it
  // holds is in the field's declared space, `stale` when some are in another
  // (the type's space changed since they were written), `missing` when it
  // holds none. Never the numbers. A sidecar line the indexer left out is
  // reported with its field. Empty for a card with no vector fields.
  async vectorStatus(url: URL): Promise<VectorStatus> {
    let out: VectorStatus = {};
    if (!this.#pg || !(await this.#store.available())) {
      return out;
    }
    let db = this.#host.dbAdapter;
    let href = url.href.endsWith('.json') ? url.href : `${url.href}.json`;
    let [row] = await db.execute(
      `SELECT search_doc -> '_vectorFields' AS fields, pristine_doc -> 'meta' -> 'adoptsFrom' AS adopts_from FROM boxel_index WHERE url = $1 AND type = 'instance' AND (is_deleted = false OR is_deleted IS NULL) LIMIT 1`,
      { bind: [href] },
    );
    let fields: unknown = row?.fields;
    if (typeof fields === 'string') {
      try {
        fields = JSON.parse(fields);
      } catch {
        fields = undefined;
      }
    }
    if (!fields || typeof fields !== 'object') {
      return out;
    }
    let counts = await this.#store.vectorCounts(href);
    let [sidecar] = await db
      .execute(
        `SELECT errors FROM boxel_index_vector_sidecars WHERE url = $1 AND type = 'instance' LIMIT 1`,
        { bind: [href] },
      )
      .catch(() => []);
    let errors = (
      typeof sidecar?.errors === 'string'
        ? JSON.parse(sidecar.errors)
        : (sidecar?.errors ?? [])
    ) as { field?: string; item?: string; code: string; message: string }[];
    let type = this.#adoptedType(row?.adopts_from, href);
    for (let [path, info] of Object.entries(
      fields as Record<string, { space: string }>,
    )) {
      // The space the card's type declares now, when its definition records
      // it: a card not yet reindexed since its field moved to another space
      // is stale. Otherwise the space the card recorded when it was indexed.
      let space =
        (type && (await this.#definedSpaceOf(type, path))) ?? info.space;
      let rows = counts.filter((c) => c.fieldPath === path);
      let inSpace = rows
        .filter((c) => c.space === space)
        .reduce((n, c) => n + c.count, 0);
      let other = rows
        .filter((c) => c.space !== space)
        .reduce((n, c) => n + c.count, 0);
      let fieldErrors = errors
        .filter((e) => e.field === path)
        .map(({ code, message, item }) => ({
          code,
          message,
          ...(item ? { item } : {}),
        }));
      out[path] = {
        status: other > 0 ? 'stale' : inSpace > 0 ? 'ok' : 'missing',
        space,
        count: inSpace,
        ...(fieldErrors.length ? { errors: fieldErrors } : {}),
      };
    }
    return out;
  }

  // The type an indexed card adopts from, as a code ref a definition lookup
  // takes (its module made absolute against the card's URL).
  #adoptedType(adoptsFrom: unknown, cardURL: string): CodeRef | undefined {
    if (typeof adoptsFrom === 'string') {
      try {
        adoptsFrom = JSON.parse(adoptsFrom);
      } catch {
        return undefined;
      }
    }
    if (!adoptsFrom || typeof adoptsFrom !== 'object') {
      return undefined;
    }
    let ref = codeRefWithAbsoluteIdentifier(
      adoptsFrom as CodeRef,
      new URL(cardURL),
      undefined,
      this.#host.virtualNetwork,
    );
    return isResolvedCodeRef(ref) ? ref : undefined;
  }

  // A card's single (non-list) vectors, by field path, with their spaces.
  async oneCardVectors(
    realmURL: URL,
    url: string,
    reader?: DBAdapter,
  ): Promise<Map<string, { space: string; components: number[] }>> {
    let found = new Map<string, { space: string; components: number[] }>();
    if (!this.#pg || !(await this.#store.available())) {
      return found;
    }
    for (let row of await this.#store.oneCardVectors(
      realmURL.href,
      url,
      reader,
    )) {
      try {
        let components = JSON.parse(row.components);
        if (Array.isArray(components) && components.length > 0) {
          found.set(row.fieldPath, { space: row.space, components });
        }
      } catch {
        // not a vector we can read; the binding falls back to the doc
      }
    }
    return found;
  }

  // A one-card binding's vector, read as a near target: it remembers its
  // space, so a near compares it only with vectors of that space.
  targetFromStored(stored: { space: string; components: number[] }) {
    let target = [...stored.components];
    vectorTargetSpaces.set(target, stored.space);
    return target;
  }

  // The spaces a field's vectors of one size are stored in, in the realm
  // searched (a near search compares only that realm's vectors). Read through
  // the (realm_url, field_path, …) indexes: without the realm the lookup read
  // every vector of the field (1.5 s over 237k vectors). Cached briefly: a
  // query may name the same field several times, and the answer changes only
  // when the realm is indexed.
  #fieldSpaces = new Map<string, { at: number; spaces: Promise<string[]> }>();
  async #spacesOf(
    realmURL: URL,
    fieldPath: string,
    dims: number,
  ): Promise<string[]> {
    let key = `${realmURL.href} ${fieldPath} ${dims}`;
    let cached = this.#fieldSpaces.get(key);
    if (!cached || Date.now() - cached.at > 30_000) {
      cached = {
        at: Date.now(),
        spaces: this.#store
          .spacesOf(realmURL.href, fieldPath, dims)
          .catch(() => []),
      };
      this.#fieldSpaces.set(key, cached);
    }
    return cached.spaces;
  }

  // The space a type declares one of its vector fields in: a fact about the
  // type's code, read from the definition of the type and field path the
  // query names (`FieldDefinition.vectorSpace`), so it is the same whatever
  // spaces the type's cards are stored in while a reindex moves them. A near
  // comparison reads only the vectors stored in it, so one in another space
  // (stale, or `''` from before spaces were recorded) never compares with
  // the target just because its size matches. A target read from a card
  // carries its own space, and one in another space is refused. Undefined
  // off Postgres.
  async declaredSpaceOf(
    realmURL: URL,
    on: CodeRef,
    fieldPath: string,
    target: unknown,
    what: string,
  ): Promise<string | undefined> {
    if (!this.#pg) {
      return undefined;
    }
    let declared =
      (await this.#definedSpaceOf(on, fieldPath)) ??
      (await this.#recordedSpaceOf(realmURL, on, fieldPath));
    let dims = Array.isArray(target)
      ? vectorDimensions(target as number[])
      : undefined;
    // A card from before `_vectorFields` stored a plain vector of its size.
    if (declared === '') {
      return dims ? `vector ${dims}` : undefined;
    }
    let targetSpace = targetSpaceOf(target);
    if (declared != null && targetSpace != null && targetSpace !== declared) {
      throw new InvalidQueryError(
        `${what}: the target vector is in the space "${targetSpace}", but "${fieldPath}" is declared in "${declared}"; vectors from different spaces can't be compared`,
        'vector-space-mismatch',
      );
    }
    return declared;
  }

  // The space the definition of `on` records for the vector field at `path`
  // (through compound fields and lists). Undefined when the path names no
  // field, or the definition was stored before the space was recorded.
  async #definedSpaceOf(on: CodeRef, path: string) {
    try {
      return (await this.#host.fieldOf(on, path)).vectorSpace;
    } catch {
      return undefined;
    }
  }

  // Only for a definition stored before `vectorSpace` was recorded on it:
  // the space the type's most recently indexed card records for the field in
  // its search doc's `_vectorFields`, cards that record the field first (ties
  // go to the lower URL, so the answer never depends on row order). `''` when
  // the cards record no vector fields at all: they stored plain vectors.
  // Cached for a few seconds, because unlike the definition this costs a
  // read of the type's cards each time a query names the field.
  #recordedSpaces = new Map<
    string,
    { at: number; space: Promise<string | undefined> }
  >();
  async #recordedSpaceOf(
    realmURL: URL,
    on: CodeRef,
    fieldPath: string,
  ): Promise<string | undefined> {
    let typeKey = internalKeyFor(on, undefined, this.#host.virtualNetwork);
    let key = `${realmURL.href} ${typeKey} ${fieldPath}`;
    let cached = this.#recordedSpaces.get(key);
    if (!cached || Date.now() - cached.at > 5_000) {
      cached = {
        at: Date.now(),
        space: this.#host.dbAdapter
          .execute(
            `SELECT d.space, d.recorded FROM (
               SELECT bi.search_doc -> '_vectorFields' -> $3 ->> 'space' AS space,
                      jsonb_exists(bi.search_doc, '_vectorFields') AS recorded,
                      bi.indexed_at, bi.url
                 FROM boxel_index AS bi
                WHERE bi.realm_url = $1 AND bi.type = 'instance'
                  AND (bi.is_deleted = FALSE OR bi.is_deleted IS NULL)
                  AND COALESCE(bi.types, '[]'::jsonb) @> $2::jsonb
             ) AS d
             ORDER BY d.space IS NULL, d.recorded DESC,
                      d.indexed_at DESC NULLS LAST, d.url
             LIMIT 1`,
            { bind: [realmURL.href, JSON.stringify([typeKey]), fieldPath] },
          )
          .then(([row]) =>
            row?.space != null
              ? String(row.space)
              : // no card records its fields: they stored plain vectors
                row && !row.recorded
                ? ''
                : undefined,
          )
          .catch(() => undefined),
      };
      this.#recordedSpaces.set(key, cached);
    }
    return cached.space;
  }

  // A near target read from a card carries its space: comparing it with a
  // field whose vectors are all in other spaces is refused, never answered
  // with distances that mean nothing.
  async #assertNearSpace(
    realmURL: URL | undefined,
    fieldPath: string,
    near: unknown,
    what: string,
  ) {
    assertHasDirection(near, what);
    let space = targetSpaceOf(near);
    // Without the realm there are no vectors to compare against; the join's
    // own space condition still keeps other spaces out.
    if (space == null || !realmURL || !this.#pg) {
      return;
    }
    let dims = vectorDimensions(near as number[]);
    // Over a union, each realm's vectors are checked, and a refusal names
    // the realm whose vectors are in another space.
    let realms = realmsOf(realmURL);
    for (let realm of realms) {
      let spaces = await this.#spacesOf(new URL(realm), fieldPath, dims);
      if (spaces.length > 0 && !spaces.includes(space)) {
        throw new InvalidQueryError(
          `${what}: the target vector is in the space "${space}", but "${fieldPath}" holds vectors in ${spaces.map((s) => `"${s}"`).join(', ')}${realms.length > 1 ? ` in ${realm}` : ''}; vectors from different spaces can't be compared`,
          'vector-space-mismatch',
        );
      }
    }
  }

  // Resolves the VectorField a near sort or filter addresses and refuses
  // anything else: a path that is not a VectorField, or a Postgres without
  // the pgvector table.
  async #assertNearField(on: CodeRef, path: string, what: string) {
    let field = await this.#host.fieldOf(on, path);
    if (field.serializerName !== 'vector') {
      throw new InvalidQueryError(
        `${what} requires "${path}" to be a VectorField`,
        'needs-declaration',
      );
    }
    if (this.#pg && !(await this.#store.available())) {
      throw new InvalidQueryError(
        VECTOR_INDEX_UNAVAILABLE_MESSAGE,
        'needs-postgres',
      );
    }
  }

  // Validates a near filter up front (field lookups are async, the filter
  // compiler is not), and records the space each entry's field is declared
  // in for `nearCondition`. A filter with `minSimilarity` over a realm large
  // enough reads its candidates from the space's index here (the vectors
  // within the threshold, by half-precision distance with some slack), and
  // `nearCondition` checks each exactly. One that admits more than
  // `filterCandidates` cards is answered exactly instead.
  async assertNearFilter(
    filter: NearFilter,
    on: CodeRef,
    realmURL?: URL,
    ctx?: NearContext,
  ) {
    for (let [path, entry] of Object.entries(filter.near)) {
      await this.#assertNearField(on, path, `near filter on "${path}"`);
      if (!realmURL || !entry || typeof entry !== 'object') {
        continue;
      }
      let fieldPath = removeBrackets(path);
      let { to, minSimilarity } = entry as {
        to: number[];
        minSimilarity?: number;
      };
      assertHasDirection(to, `near filter on "${path}"`);
      let space = await this.declaredSpaceOf(
        realmURL,
        on,
        fieldPath,
        to,
        `near filter on "${path}"`,
      );
      if (space != null) nearFilterDeclaredSpaces.set(entry, space);
      // what an earlier search of this filter object read is not this one's
      nearFilterCandidates.get(entry)?.delete(realmURL.href);
      if (minSimilarity == null) {
        continue;
      }
      let plan = await this.#plan(
        realmURL,
        fieldPath,
        space ?? targetSpaceOf(to),
        ctx,
      );
      if (plan.path !== 'hnsw') {
        this.#record(ctx, plan.report);
        continue;
      }
      let settings = vectorSearchSettings();
      let k = settings.filterCandidates;
      let rows = await this.#store.nearCandidates({
        realmURL: realmURL.href,
        fieldPath,
        space: plan.space,
        literal: vectorToSqlLiteral(to),
        k,
        maxDistance: 1 - minSimilarity + settings.halfPrecisionSlack,
        reader: ctx?.reader,
      });
      if (rows.length >= k) {
        this.#record(ctx, {
          ...plan.report,
          path: 'exact',
          reason: 'too-many-matches',
        });
        warnExactScan(
          ctx,
          fieldPath,
          plan.report.threshold,
          'too-many-matches',
        );
        continue;
      }
      let urls = [...new Set(rows.map((r) => r.url))];
      let byRealm = nearFilterCandidates.get(entry) ?? new Map();
      byRealm.set(realmURL.href, urls);
      nearFilterCandidates.set(entry, byRealm);
      this.#record(ctx, { ...plan.report, rescored: urls.length });
    }
  }

  // A near filter: the card has a vector at the path of the target's
  // dimension and, given `minSimilarity`, at least that cosine similarity to
  // the target. Postgres asks the vector table (so it negates and nests like
  // any predicate), comparing only the candidates `assertNearFilter` read
  // when it read any; SQLite scores the search doc's own vector, singular
  // paths only.
  nearCondition(filter: NearFilter, realmURL?: URL): CardExpression {
    let [path, entry] = Object.entries(filter.near)[0];
    let { to, minSimilarity } = entry;
    return this.#store.nearFilterCondition(
      {
        fieldPath: removeBrackets(path),
        dims: vectorDimensions(to),
        literal: vectorToSqlLiteral(to),
        targetSpace: targetSpaceOf(to),
        declaredSpace: nearFilterDeclaredSpaces.get(entry),
        candidates:
          minSimilarity != null && realmURL
            ? nearFilterCandidates.get(entry)?.get(realmURL.href)
            : undefined,
      },
      minSimilarity,
    );
  }

  // Whether a near search over a realm's vectors in one field and space runs
  // exactly or through the space's approximate index: exactly when asked, when
  // the space has no index, when the realm holds no more than
  // `exactThreshold` of them (counted, stopping just past it), or when they
  // are less than `minShare` of the space's vectors.
  async #plan(
    realmURL: URL,
    fieldPath: string,
    space: string | undefined,
    ctx: NearContext | undefined,
    opts: { paged?: boolean; leading?: boolean } = {},
  ): Promise<
    | { path: 'exact'; report: NearReport }
    | { path: 'hnsw'; space: string; report: NearReport }
  > {
    let threshold = vectorSearchSettings().exactThreshold;
    let exact = (reason: NearReport['reason'], candidates = 0) => {
      let report: NearReport = { path: 'exact', candidates, threshold, reason };
      return { path: 'exact' as const, report };
    };
    if (!this.#pg || space == null) {
      return exact('no-space');
    }
    let { minShare } = vectorSearchSettings();
    let spaceSize = await this.#store.spaceSize(space);
    let shareOf = spaceSize ? Math.ceil(spaceSize * minShare) : 0;
    let limit = Math.max(threshold, shareOf) + 1;
    // A union's count is its realms' together.
    let candidates = ctx?.countVisible
      ? await ctx.countVisible(fieldPath, space, limit)
      : (
          await Promise.all(
            realmsOf(realmURL).map((realm) =>
              this.#store.countVectors({
                realmURL: realm,
                fieldPath,
                space,
                limit,
              }),
            ),
          )
        ).reduce((sum, n) => sum + n, 0);
    let large = candidates > threshold;
    let reason: NearReport['reason'] | undefined = !large
      ? 'below-threshold'
      : candidates <= shareOf
        ? 'small-share'
        : ctx?.exact
          ? 'asked'
          : opts.paged === false
            ? 'unpaged'
            : opts.leading === false
              ? 'not-leading'
              : !(await this.#store.nearIndex(space))
                ? 'no-index'
                : undefined;
    if (reason) {
      if (large && reason !== 'asked' && reason !== 'small-share') {
        warnExactScan(ctx, fieldPath, threshold, reason);
      }
      return exact(reason, candidates);
    }
    return {
      path: 'hnsw',
      space,
      report: {
        path: 'hnsw',
        candidates,
        threshold,
        efSearch: vectorSearchSettings().efSearch,
      },
    };
  }

  #record(ctx: NearContext | undefined, report: NearReport) {
    ctx?.reports.push(report);
  }

  // The cards whose vectors a paged near sort or signal compares, read
  // through the space's index: the nearest `rescoreFactor` times the rows
  // the page needs, widened (four times each read, up to `maxRescore`)
  // until they cover that many cards, since a card with many vectors (a
  // video's segments) may take several of the nearest. `truncated` when the
  // last read was cut at its limit, so there may be more.
  async #candidateCards(
    realmURL: URL,
    fieldPath: string,
    space: string,
    literal: string,
    needed: number,
    reader: DBAdapter | undefined,
  ): Promise<{ urls: string[]; truncated: boolean } | undefined> {
    let settings = vectorSearchSettings();
    let k = Math.max(needed * settings.rescoreFactor, settings.minRescore);
    for (;;) {
      k = Math.min(k, settings.maxRescore);
      let rows = await this.#store.nearCandidates({
        realmURL: realmURL.href,
        fieldPath,
        space,
        literal,
        k,
        reader,
      });
      let urls = [...new Set(rows.map((r) => r.url))];
      let truncated = rows.length >= k;
      if (urls.length >= needed || !truncated) {
        return { urls, truncated };
      }
      if (k >= settings.maxRescore) {
        // even the widest read does not cover the page: compare exactly
        return undefined;
      }
      k *= 4;
    }
  }

  // One near blend signal's aggregated value for a card, NULL when it has
  // none; its joins are pushed onto `joins`. Over a large realm a paged
  // query's signal compares only the candidates of an approximate read: the
  // blend ranks every match, and a card that was not a candidate gets no
  // rank from this signal (as a card with no vector gets none).
  async nearSignalScore(
    component: BlendComponent & {
      by: string;
      on: CodeRef;
      near: NearSortTarget;
    },
    joinAlias: string,
    joins: CardExpression,
    realmURL: URL | undefined,
    ctx?: NearContext,
  ): Promise<CardExpression> {
    let what = `blend signal "${component.by}" near a vector`;
    await this.#assertNearField(component.on, component.by, what);
    let fieldPath = removeBrackets(component.by);
    await this.#assertNearSpace(realmURL, fieldPath, component.near, what);
    let declaredSpace =
      this.#pg && realmURL
        ? await this.declaredSpaceOf(
            realmURL,
            component.on,
            fieldPath,
            component.near,
            what,
          )
        : undefined;
    let literal = vectorToSqlLiteral(component.near);
    let candidates = realmURL
      ? await this.#candidatesFor(
          realmURL,
          fieldPath,
          declaredSpace ?? targetSpaceOf(component.near),
          literal,
          ctx,
          true,
        )
      : undefined;
    let { joins: signalJoins, similarity } = this.#store.nearSimilarity(
      joinAlias,
      {
        fieldPath,
        dims: vectorDimensions(component.near),
        literal,
        targetSpace: targetSpaceOf(component.near),
        declaredSpace,
        candidates: candidates?.urls,
      },
    );
    joins.push(...signalJoins);
    return similarity;
  }

  // The approximate candidates for a paged near sort or signal, when the
  // plan reads them, recording the plan either way.
  async #candidatesFor(
    realmURL: URL,
    fieldPath: string,
    space: string | undefined,
    literal: string,
    ctx: NearContext | undefined,
    leading: boolean,
  ): Promise<{ urls: string[]; truncated: boolean } | undefined> {
    if (!this.#pg) {
      return undefined;
    }
    let needed = ctx?.needed;
    let plan = await this.#plan(realmURL, fieldPath, space, ctx, {
      paged: needed !== undefined,
      leading,
    });
    if (plan.path !== 'hnsw' || needed === undefined) {
      this.#record(ctx, plan.report);
      return undefined;
    }
    let found = await this.#candidateCards(
      realmURL,
      fieldPath,
      plan.space,
      literal,
      needed,
      ctx?.reader,
    );
    if (!found) {
      this.#record(ctx, {
        ...plan.report,
        path: 'exact',
        reason: 'filtered-out',
      });
      warnExactScan(ctx, fieldPath, plan.report.threshold, 'filtered-out');
      return undefined;
    }
    this.#record(ctx, { ...plan.report, rescored: found.urls.length });
    return found;
  }

  // The projection columns and joins for the query's near sorts.
  //
  // Postgres reads the vectors the index writer copied into the vector
  // table, scoring cosine similarity. A card with no vector at the path
  // sorts last. Over a realm with no more than `exactThreshold` vectors in
  // the field's space, or for a near sort that does not lead the sort, every
  // row the filter admits is scored, so a near sort combines with any filter
  // and never drops a match. A leading, paged near sort over a larger realm
  // scores only the candidate cards of an approximate read, exactly; when
  // the page then holds a row without a similarity, the filter may have
  // admitted cards the read left out, and the engine runs the query again
  // exactly (`NearContext#starved`). While an index pass is staged (WIP
  // reads), the table still holds the last committed vectors.
  async nearSortExpressions(
    sort: Sort | undefined,
    realmURL: URL,
    ctx?: NearContext,
  ): Promise<{
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
      let what = `sort by "${s.by}" near a vector`;
      await this.#assertNearField(s.on, s.by, what);
      let fieldPath = removeBrackets(s.by);
      await this.#assertNearSpace(realmURL, fieldPath, s.near, what);
      let declaredSpace = this.#pg
        ? await this.declaredSpaceOf(realmURL, s.on, fieldPath, s.near, what)
        : undefined;
      let literal = vectorToSqlLiteral(s.near);
      // Only a sort that leads, ranking most similar first, reads candidates.
      let leading = index === 0 && (s.direction ?? 'desc') === 'desc';
      let candidates = await this.#candidatesFor(
        realmURL,
        fieldPath,
        declaredSpace ?? targetSpaceOf(s.near),
        literal,
        ctx,
        leading,
      );
      if (candidates?.truncated && ctx) {
        ctx.leadingSortTruncated = true;
      }
      let { joins, similarity } = this.#store.nearSimilarity(`nv${index}`, {
        fieldPath,
        dims: vectorDimensions(s.near),
        literal,
        targetSpace: targetSpaceOf(s.near),
        declaredSpace,
        candidates: candidates?.urls,
      });
      nearJoins.push(...joins);
      nearColumns.push(
        ',',
        ...similarity,
        `AS "${nearSimilarityAlias(sort, index)}"`,
      );
    }
    return { nearColumns, nearJoins };
  }

  // Each source card's look-alikes: its `k` nearest cards in the realm by
  // the vector field `field`, at least `minSimilarity` similar (exactly, or
  // over a large realm through its space's index, then re-scored exactly). The field must declare
  // `search: { neighbors: true }` on the type the query is anchored on.
  // `allowed`, when it gives a set, keeps only the neighbours it names.
  async lookalikes(opts: {
    realmURL: URL;
    anchor: CodeRef | undefined;
    field: string;
    sourceUrls: string[];
    k: number;
    minSimilarity: number | undefined;
    allowed: () => Promise<Set<string> | undefined>;
    // the search's read snapshot
    reader?: DBAdapter;
  }): Promise<Map<string, { url: string; sim: number }[]>> {
    let { realmURL, anchor, field } = opts;
    dialectFor(this.#host.dbAdapter.kind).requirePostgres(
      'expression: look-alikes (compare.near) run on Postgres only',
    );
    let declared = false;
    if (anchor) {
      try {
        let def = await this.#host.fieldOf(anchor, field);
        declared =
          typeof def.search === 'object' && def.search?.neighbors === true;
      } catch {
        declared = false;
      }
    }
    if (!declared) {
      throw new InvalidQueryError(
        `expression: compare.near reads each card's look-alikes by "${field}", which needs a neighbour index: declare the field with search: { neighbors: true }, and anchor the query on its type`,
        'needs-declaration',
      );
    }
    let bySrc = new Map<string, { url: string; sim: number }[]>();
    let dims = await this.#store.fieldDims(realmURL.href, field);
    if (dims === undefined || opts.sourceUrls.length === 0) {
      return bySrc;
    }
    if (!Number.isInteger(dims) || dims < 1) {
      return bySrc;
    }
    let declaredSpace = await this.declaredSpaceOf(
      realmURL,
      anchor!,
      field,
      undefined,
      'expression: compare.near',
    );
    // The neighbours a row may have are applied inside the
    // nearest-neighbour read, before its ORDER BY and LIMIT, so rows the
    // caller cannot see never take an admitted neighbour's place.
    let allowed = await opts.allowed();
    // A large realm reads each card's neighbours through the space's index
    // and re-scores them exactly; a small one compares them all.
    let plan = await this.#plan(realmURL, field, declaredSpace, undefined);
    let pairs = await this.#store.lookalikes({
      approximate: plan.path === 'hnsw',
      realmURL: realmURL.href,
      fieldPath: field,
      dims,
      declaredSpace,
      sourceUrls: opts.sourceUrls,
      k: opts.k,
      allowed,
      reader: opts.reader,
    });
    for (let { src, nb, sim } of pairs) {
      if (opts.minSimilarity !== undefined && sim < opts.minSimilarity)
        continue;
      if (allowed && !allowed.has(nb)) continue;
      let list = bySrc.get(src) ?? [];
      if (list.length < opts.k) list.push({ url: nb, sim });
      bySrc.set(src, list);
    }
    return bySrc;
  }

  // A `select` column holding the card's own vectors at a field.
  vectorColumn(
    vector: { fieldPath: string; list: boolean },
    alias: string,
  ): string {
    return this.#store.vectorColumn(vector.fieldPath, vector.list, alias);
  }
}
