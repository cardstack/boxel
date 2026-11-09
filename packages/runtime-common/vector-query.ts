import type { DBAdapter } from './db.ts';
import type { CardExpression } from './expression.ts';
import type { FieldDefinition } from './definitions.ts';
import { type CodeRef, internalKeyFor } from './index.ts';
import {
  InvalidQueryError,
  type BlendComponent,
  type NearFilter,
  type NearSortTarget,
  type Sort,
} from './query.ts';
import { vectorDimensions, vectorToSqlLiteral } from './serializers/vector.ts';
import { VECTOR_INDEX_UNAVAILABLE_MESSAGE } from './vector-index.ts';
import { vectorStoreFor, type VectorStore } from './vector-store.ts';
import type { VirtualNetwork } from './virtual-network.ts';

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
//   - `rerank.compare.near` reads each result's look-alikes by a field that
//     declares `search: { neighbors: true }`;
//   - a one-card `let` binding reads a stored card's vector as a target,
//     with its space;
//   - the space guard: a vector's space names the model, revision, provider
//     and size that made it (vector-space.ts), and two spaces are never
//     compared (`vector-space-mismatch`), as a vector database keeps one
//     collection per embedding model.
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

function removeBrackets(path: string) {
  return path.replace(/\[\]/g, '');
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
      `SELECT search_doc -> '_vectorFields' AS fields FROM boxel_index WHERE url = $1 AND type = 'instance' AND (is_deleted = false OR is_deleted IS NULL) LIMIT 1`,
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
    for (let [path, info] of Object.entries(
      fields as Record<string, { space: string }>,
    )) {
      let rows = counts.filter((c) => c.fieldPath === path);
      let inSpace = rows
        .filter((c) => c.space === info.space)
        .reduce((n, c) => n + c.count, 0);
      let other = rows
        .filter((c) => c.space !== info.space)
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
        space: info.space,
        count: inSpace,
        ...(fieldErrors.length ? { errors: fieldErrors } : {}),
      };
    }
    return out;
  }

  // A card's single (non-list) vectors, by field path, with their spaces.
  async oneCardVectors(
    realmURL: URL,
    url: string,
  ): Promise<Map<string, { space: string; components: number[] }>> {
    let found = new Map<string, { space: string; components: number[] }>();
    if (!this.#pg || !(await this.#store.available())) {
      return found;
    }
    for (let row of await this.#store.oneCardVectors(realmURL.href, url)) {
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

  // The space a type declares one of its vector fields in, read from the
  // `_vectorFields` its cards' search docs carry (a card from before that was
  // recorded stored its vectors as a plain `vector <size>`). A near
  // comparison reads only the vectors stored in it, so one in another space
  // (stale, or `''` from before spaces were recorded) never compares with
  // the target just because its size matches. A target read from a card
  // carries its own space, and one in another space is refused. Undefined
  // off Postgres. Cached for a few seconds, so a query naming the field
  // several times asks once, and a reindex that moves a field to a new space
  // is seen soon after.
  #declaredSpaces = new Map<
    string,
    { at: number; space: Promise<string | undefined> }
  >();
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
    let typeKey = internalKeyFor(on, undefined, this.#host.virtualNetwork);
    let key = `${realmURL.href} ${typeKey} ${fieldPath}`;
    let cached = this.#declaredSpaces.get(key);
    if (!cached || Date.now() - cached.at > 5_000) {
      cached = {
        at: Date.now(),
        space: this.#host.dbAdapter
          .execute(
            `SELECT d.space FROM (
               SELECT bi.search_doc -> '_vectorFields' -> $3 ->> 'space' AS space,
                      jsonb_exists(bi.search_doc, '_vectorFields') AS recorded
                 FROM boxel_index AS bi
                WHERE bi.realm_url = $1 AND bi.type = 'instance'
                  AND (bi.is_deleted = FALSE OR bi.is_deleted IS NULL)
                  AND COALESCE(bi.types, '[]'::jsonb) @> $2::jsonb
                LIMIT 20
             ) AS d
             ORDER BY d.space IS NULL, d.recorded DESC
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
      this.#declaredSpaces.set(key, cached);
    }
    let declared = await cached.space;
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

  // A near target read from a card carries its space: comparing it with a
  // field whose vectors are all in other spaces is refused, never answered
  // with distances that mean nothing.
  async #assertNearSpace(
    realmURL: URL | undefined,
    fieldPath: string,
    near: unknown,
    what: string,
  ) {
    let space = targetSpaceOf(near);
    // Without the realm there are no vectors to compare against; the join's
    // own space condition still keeps other spaces out.
    if (space == null || !realmURL || !this.#pg) {
      return;
    }
    let dims = vectorDimensions(near as number[]);
    let spaces = await this.#spacesOf(realmURL, fieldPath, dims);
    if (spaces.length > 0 && !spaces.includes(space)) {
      throw new InvalidQueryError(
        `${what}: the target vector is in the space "${space}", but "${fieldPath}" holds vectors in ${spaces.map((s) => `"${s}"`).join(', ')}; vectors from different spaces can't be compared`,
        'vector-space-mismatch',
      );
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
  // in for `nearCondition`.
  async assertNearFilter(filter: NearFilter, on: CodeRef, realmURL?: URL) {
    for (let [path, entry] of Object.entries(filter.near)) {
      await this.#assertNearField(on, path, `near filter on "${path}"`);
      if (realmURL && entry && typeof entry === 'object') {
        let space = await this.declaredSpaceOf(
          realmURL,
          on,
          removeBrackets(path),
          (entry as { to: number[] }).to,
          `near filter on "${path}"`,
        );
        if (space != null) nearFilterDeclaredSpaces.set(entry, space);
      }
    }
  }

  // A near filter: the card has a vector at the path of the target's
  // dimension and, given `minSimilarity`, at least that cosine similarity to
  // the target. Postgres asks the vector table (so it negates and nests like
  // any predicate); SQLite scores the search doc's own vector, singular paths
  // only.
  nearCondition(filter: NearFilter): CardExpression {
    let [path, entry] = Object.entries(filter.near)[0];
    let { to, minSimilarity } = entry;
    return this.#store.nearFilterCondition(
      {
        fieldPath: removeBrackets(path),
        dims: vectorDimensions(to),
        literal: vectorToSqlLiteral(to),
        targetSpace: targetSpaceOf(to),
        declaredSpace: nearFilterDeclaredSpaces.get(entry),
      },
      minSimilarity,
    );
  }

  // One near blend signal's aggregated value for a card, NULL when it has
  // none; its joins are pushed onto `joins`.
  async nearSignalScore(
    component: BlendComponent & {
      by: string;
      on: CodeRef;
      near: NearSortTarget;
    },
    joinAlias: string,
    joins: CardExpression,
    realmURL: URL | undefined,
  ): Promise<CardExpression> {
    let what = `blend signal "${component.by}" near a vector`;
    await this.#assertNearField(component.on, component.by, what);
    let fieldPath = removeBrackets(component.by);
    await this.#assertNearSpace(realmURL, fieldPath, component.near, what);
    let { joins: signalJoins, similarity } = this.#store.nearSimilarity(
      joinAlias,
      {
        fieldPath,
        dims: vectorDimensions(component.near),
        literal: vectorToSqlLiteral(component.near),
        targetSpace: targetSpaceOf(component.near),
        declaredSpace:
          this.#pg && realmURL
            ? await this.declaredSpaceOf(
                realmURL,
                component.on,
                fieldPath,
                component.near,
                what,
              )
            : undefined,
      },
    );
    joins.push(...signalJoins);
    return similarity;
  }

  // The projection columns and joins for the query's near sorts.
  //
  // Postgres reads the vectors the index writer copied into the vector
  // table, scoring cosine similarity. A card with no vector at the path
  // sorts last. The search is exact: every row the filter admits is scored,
  // so a near sort combines with any filter and never drops a match. While
  // an index pass is staged (WIP reads), the table still holds the last
  // committed vectors.
  async nearSortExpressions(
    sort: Sort | undefined,
    realmURL: URL,
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
      let { joins, similarity } = this.#store.nearSimilarity(`nv${index}`, {
        fieldPath,
        dims: vectorDimensions(s.near),
        literal: vectorToSqlLiteral(s.near),
        targetSpace: targetSpaceOf(s.near),
        declaredSpace: this.#pg
          ? await this.declaredSpaceOf(realmURL, s.on, fieldPath, s.near, what)
          : undefined,
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
  // the vector field `field`, at least `minSimilarity` similar, read through
  // that field's nearest-neighbour index. The field must declare
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
  }): Promise<Map<string, { url: string; sim: number }[]>> {
    let { realmURL, anchor, field } = opts;
    if (!this.#pg) {
      throw new InvalidQueryError(
        'rerank: look-alikes (compare.near) run on Postgres only',
        'needs-postgres',
      );
    }
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
        `rerank: compare.near reads each card's look-alikes by "${field}", which needs a neighbour index: declare the field with search: { neighbors: true }, and anchor the query on its type`,
        'needs-declaration',
      );
    }
    let bySrc = new Map<string, { url: string; sim: number }[]>();
    let dims = await this.#store.fieldDims(realmURL.href, field);
    if (dims === undefined || opts.sourceUrls.length === 0) {
      return bySrc;
    }
    if (!Number.isInteger(dims) || dims < 1 || dims > 2000) {
      return bySrc;
    }
    let declaredSpace = await this.declaredSpaceOf(
      realmURL,
      anchor!,
      field,
      undefined,
      'rerank: compare.near',
    );
    // The neighbours a row may have are applied inside the
    // nearest-neighbour read, before its ORDER BY and LIMIT, so rows the
    // caller cannot see never take an admitted neighbour's place.
    let allowed = await opts.allowed();
    let pairs = await this.#store.lookalikes({
      realmURL: realmURL.href,
      fieldPath: field,
      dims,
      declaredSpace,
      sourceUrls: opts.sourceUrls,
      k: opts.k,
      allowed,
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
