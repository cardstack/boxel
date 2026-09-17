import type { LatticeProjectionWhere } from './definitions.ts';
import { latticeOwnerDefinitionCurrent } from './lattice-code-reference.ts';
import type { DBAdapter } from './db.ts';
import stringify from 'safe-stable-stringify';
import type { IndexQueryEngine } from './index-query-engine.ts';
import type { Query } from './query.ts';
import { acquireConcurrencyGroupLock } from './queue-concurrency-lock.ts';
import {
  latticeOwnerAttemptsSQL,
  latticeOwnerCodeVersionSQL,
  latticeOwnerRetryReadySQL,
} from './jobs/lattice.ts';
import { indexingConcurrencyGroup } from './jobs/indexing.ts';
import {
  latticePublicationDecision,
  latticeWorkDecision,
  latticeWorkFrontier,
  latticeWorkFailureAttempts,
} from './lattice-kernel.ts';
import {
  LatticeWorkSuperseded,
  latticeWorkReasons,
  type LatticeScheduledWork,
} from './lattice-work.ts';
import type {
  LatticePublicationStorage,
  LatticeProducerRegistration,
} from './lattice-adapters.ts';
import {
  dbExpression,
  every,
  param,
  textArrayParam,
  query,
  type Expression,
  type Querier,
} from './expression.ts';

export interface LatticeWatch {
  fieldPath: string;
  query: Query;
}

export interface LatticePreparedWatch extends LatticeWatch {
  terms: Array<{ path: string; value: string }>;
  // See PublicationReceipt.readPaths.
  readPaths?: string[];
  // See PublicationReceipt.projections.
  where?: LatticeProjectionWhere;
}

// Read-path change detection: does a row that stays matched by a watch
// differ in any field the owner read? Unknown fields count as changed, so a
// value the search document does not carry keeps the owner conservative.
// A compound read (`lines.*`) is otherwise always a change, because the
// search document cannot say which member moved. Read through a projection
// predicate, the comparison is of the members that pass it: the slice the
// owner actually read.
function projectedMembers(
  document: Record<string, unknown>,
  collection: string,
  leaves: Record<string, string | number | boolean>,
): unknown {
  const members = document[collection];
  if (!Array.isArray(members)) return members;
  return members.filter(
    (member) =>
      member &&
      typeof member === 'object' &&
      Object.entries(leaves).every(
        ([leaf, expected]) =>
          (member as Record<string, unknown>)[leaf] === expected,
      ),
  );
}

export function latticeReadPathsChanged(
  readPaths: readonly string[],
  previous: LatticeDocument,
  next: LatticeDocument,
  where?: LatticeProjectionWhere,
): boolean {
  if (readPaths.includes('*')) return true;
  const before = (previous.search_doc ?? {}) as Record<string, unknown>;
  const after = (next.search_doc ?? {}) as Record<string, unknown>;
  for (const field of readPaths) {
    if (field.endsWith('.*')) {
      const collection = field.slice(0, -2);
      const leaves = where?.[collection];
      if (!leaves || collection.includes('.')) return true;
      if (
        JSON.stringify(projectedMembers(before, collection, leaves)) !==
        JSON.stringify(projectedMembers(after, collection, leaves))
      )
        return true;
      continue;
    }
    if (!Object.hasOwn(before, field) || !Object.hasOwn(after, field))
      return true;
    if (
      JSON.stringify((before as Record<string, unknown>)[field]) !==
      JSON.stringify((after as Record<string, unknown>)[field])
    )
      return true;
  }
  return false;
}

export interface LatticeOwnerPublication {
  realmURL: string;
  ownerURL: string;
  generation: number;
  inputGeneration: number;
  definitionRevision: string;
  watches: LatticePreparedWatch[];
  retired?: boolean;
  pending?: boolean;
  retainOutputGeneration?: number;
  // See PublicationReceipt.freshUntil. Only a ready publication starts a hold.
  freshUntil?: string;
  // See PublicationReceipt.freshWithin: the hold armed from publication.
  freshWithin?: number;
  // See PublicationReceipt.staleWithin. Only a ready publication sets it.
  staleWithin?: number;
  // See PublicationReceipt.stale: the owner keeps its obligation.
  stale?: true;
}

// A dirty owner inside its settle window is not runnable (`pending` with
// `runnableOnly`, the queue's claim eligibility). `o` is a lattice_owners row.
export const latticeOwnerSettledSQL = `(o.settle_until IS NULL OR o.settle_until <= now())`;
// A dirty owner past its staleness deadline runs ahead of dirty inputs and
// pending source work (`LatticeWorkClaim.stale`). `o` is a lattice_owners row.
export const latticeOwnerOverdueSQL = `(o.stale_after IS NOT NULL AND o.stale_after <= now())`;

export type LatticeProducer = Pick<
  LatticeOwnerPublication,
  'realmURL' | 'ownerURL' | 'watches' | 'retired'
>;

// Internal native-producer data. Never accept SQL expressions from card JSON.
// The enclosing producer's revision check must run in the publication transaction.
export interface LatticeQueryPreparation {
  manifest: LatticeWatch[];
  // Only queries compiled using this producer's reviewed definition scope.
  // Remaining manifest entries use the ordinary publication compiler.
  watches: Array<LatticePreparedWatch & { matcher: Expression }>;
}

export type LatticeDocument = Parameters<
  IndexQueryEngine['reverseMatchesDocument']
>[1];

// All mutations take the caller's pinned transaction. Index publication and
// watch replacement must commit together. A notification is never the queue:
// dirty_generation survives disconnects and worker restarts.
export class LatticeQueryRegistry
  implements
    LatticePublicationStorage<Querier, LatticeOwnerPublication>,
    LatticeProducerRegistration<Querier, LatticeProducer>
{
  private db: DBAdapter;
  private engine: IndexQueryEngine;
  constructor(db: DBAdapter, engine: IndexQueryEngine) {
    this.db = db;
    this.engine = engine;
  }

  async preparePublication(
    realmURL: string,
    ownerWatches: Map<string, LatticeWatch[]>,
    retiringOwners: Set<string>,
    documents: LatticeDocument[],
    nativeQueries?: ReadonlyMap<string, LatticeQueryPreparation>,
    ownerReadPaths?: ReadonlyMap<string, Record<string, string[]>>,
    ownerProjections?: ReadonlyMap<
      string,
      Record<string, LatticeProjectionWhere>
    >,
  ) {
    // Routing and exact matching read the same definitions. Share only this
    // pass's resolved definitions across owners and both phases. The next
    // publication starts fresh; commit still fences input and code revisions.
    let compiler = this.engine.reverseCompilationScope();
    let watches = new Map<string, LatticePreparedWatch[]>();
    let nativeMatchers = new Map<string, Expression>();
    const withReads = (
      ownerURL: string,
      prepared: LatticePreparedWatch[],
    ): LatticePreparedWatch[] => {
      const reads = ownerReadPaths?.get(ownerURL);
      const projections = ownerProjections?.get(ownerURL);
      if (!reads && !projections) return prepared;
      return prepared.map((watch) => {
        const paths = reads?.[watch.fieldPath];
        const where = projections?.[watch.fieldPath];
        return {
          ...watch,
          ...(Array.isArray(paths) &&
          paths.every((path) => typeof path === 'string')
            ? { readPaths: [...new Set(paths)] }
            : {}),
          ...(where && typeof where === 'object' ? { where } : {}),
        };
      });
    };
    for (let [ownerURL, inputs] of ownerWatches) {
      let native = nativeQueries?.get(ownerURL);
      if (native) {
        if (stringify(native.manifest) !== stringify(inputs)) {
          throw new Error(
            'Lattice prepared queries do not match the published watches',
          );
        }
        const paths = new Set(inputs.map((watch) => watch.fieldPath));
        if (paths.has('') || paths.size !== inputs.length)
          throw new Error('Lattice watch paths must be nonempty and unique');
        const prepared = new Map<string, LatticePreparedWatch>();
        for (let watch of native.watches) {
          const input = inputs.find(
            (input) => input.fieldPath === watch.fieldPath,
          );
          if (
            !input ||
            prepared.has(watch.fieldPath) ||
            stringify(input.query) !== stringify(watch.query)
          )
            throw new Error('Lattice prepared query is outside its manifest');
          const { matcher: _matcher, ...entry } = watch;
          prepared.set(watch.fieldPath, entry);
          nativeMatchers.set(
            stringify(watch.query.filter) ?? '',
            watch.matcher,
          );
        }
        for (const watch of await this.prepare(
          inputs.filter((input) => !prepared.has(input.fieldPath)),
          compiler,
        ))
          prepared.set(watch.fieldPath, watch);
        watches.set(
          ownerURL,
          withReads(
            ownerURL,
            inputs.map((input) => prepared.get(input.fieldPath)!),
          ),
        );
      } else {
        watches.set(
          ownerURL,
          withReads(ownerURL, await this.prepare(inputs, compiler)),
        );
      }
    }
    let matchers = await this.prepareMatchers(
      realmURL,
      [...watches.values()].flat(),
      retiringOwners,
      documents,
      compiler,
      nativeMatchers,
    );
    return { watches, matchers };
  }

  // Compile once per publication, outside its transaction. The forward
  // compiler resolves definitions through the module cache; repeating that
  // work for every (changed document, watch) pair blocks publication for minutes.
  async prepareMatchers(
    realmURL: string,
    watches: LatticeWatch[],
    retiringOwners = new Set<string>(),
    documents?: LatticeDocument[],
    compiler = this.engine.reverseCompilationScope(),
    nativeMatchers?: ReadonlyMap<string, Expression>,
  ) {
    // Route before compiling. Definitions for watches that cannot match any
    // old/new input should not delay publication (or occupy a renderer).
    let existing = documents
      ? await this.candidatesForDocuments(realmURL, documents)
      : (
          await query(
            this.db,
            [
              'SELECT owner_url, query FROM lattice_query_watches WHERE realm_url =',
              param(realmURL),
            ],
            { query: 'JSON' },
          )
        ).map((row) => ({
          ownerURL: row.owner_url as string,
          query: row.query as Query,
        }));
    let matchers = new Map<string, Expression>();
    for (let watch of [
      ...existing.filter((row) => !retiringOwners.has(row.ownerURL)),
      ...watches,
    ]) {
      let filter = (watch.query as Query).filter;
      let key = stringify(filter) ?? '';
      if (!matchers.has(key)) {
        matchers.set(
          key,
          nativeMatchers?.get(key) ??
            (await compiler.reverseCompileFilter(filter)),
        );
      }
    }
    return matchers;
  }

  async prepareNativeQueries(
    watches: LatticeWatch[],
    compiler: IndexQueryEngine,
    maxBytes = 1_048_576,
  ): Promise<LatticeQueryPreparation | undefined> {
    let result: LatticeQueryPreparation = { manifest: watches, watches: [] };
    let bytes = 0;
    for (let watch of await this.prepare(watches, compiler)) {
      let prepared = {
        ...watch,
        matcher: await compiler.reverseCompileFilter(watch.query.filter),
      };
      bytes += new TextEncoder().encode(JSON.stringify(prepared)).byteLength;
      // Oversized plans use normal publication preparation; no query is omitted.
      if (bytes > maxBytes) return undefined;
      result.watches.push(prepared);
    }
    return result;
  }

  async prepare(
    watches: LatticeWatch[],
    compiler = this.engine.reverseCompilationScope(),
  ): Promise<LatticePreparedWatch[]> {
    let paths = new Set<string>();
    let prepared: LatticePreparedWatch[] = [];
    for (let watch of watches) {
      if (!watch.fieldPath || paths.has(watch.fieldPath)) {
        throw new Error('Lattice watch paths must be nonempty and unique');
      }
      paths.add(watch.fieldPath);
      // Sort and page are not read here. An ungated watch's terms come from
      // its whole filter, because a non-returned match can still change an
      // aggregate or displace a page member; a sorted page that the engine
      // gated carries its cutoff inside the filter, so the narrowing is
      // already part of what is routed and matched.
      let terms =
        latticeInputIdTerms(watch) ??
        (await compiler.reverseRoutingTerms(watch.query.filter));
      prepared.push({
        ...watch,
        terms: terms?.length ? terms : [{ path: '', value: '' }],
      });
    }
    return prepared;
  }

  async warmOwnerQueries(realmURL: string, ownerURL: string): Promise<void> {
    // A recovered secondary job may run with a cold module cache. Resolve its
    // query definitions before occupying a render tab: a cache miss while the
    // tab waits on a search could otherwise queue a module render behind itself.
    let watches = await query(
      this.db,
      [
        'SELECT query FROM lattice_query_watches WHERE realm_url =',
        param(realmURL),
        'AND owner_url =',
        param(ownerURL),
      ],
      { query: 'JSON' },
    );
    let compiler = this.engine.reverseCompilationScope();
    for (let watch of watches) {
      await compiler.reverseCompileFilter((watch.query as Query).filter);
    }
  }

  async publish(tx: Querier, owner: LatticeOwnerPublication): Promise<boolean> {
    let { realmURL, ownerURL, generation, inputGeneration } = owner;
    let window = {
      publishedAt: generation,
      validatedThrough: inputGeneration,
      retainOutputAt: owner.retainOutputGeneration,
      kind: owner.retired
        ? ('retire' as const)
        : owner.pending
          ? ('register' as const)
          : ('publish' as const),
      ...(owner.stale && !owner.retired && !owner.pending
        ? { stale: true as const }
        : {}),
    };
    if (
      latticePublicationDecision({ ...window, retainOutputAt: undefined })
        .status === 'reject'
    ) {
      throw new Error(
        'Lattice publication needs valid input and owner generations',
      );
    }
    this.assertProducerScope(owner);
    let [previous] = await tx([
      'SELECT published_generation, dirty_generation FROM lattice_owners WHERE',
      ...this.ownerCondition(realmURL, ownerURL),
    ]);
    if (
      latticePublicationDecision(
        window,
        previous
          ? {
              publishedAt: Number(previous.published_generation),
              dirtyAt:
                previous.dirty_generation == null
                  ? null
                  : Number(previous.dirty_generation),
            }
          : undefined,
      ).status === 'reject'
    ) {
      return false;
    }
    const outputGeneration = owner.retainOutputGeneration ?? generation;
    let freshUntil: string | undefined;
    if (!owner.retired && !owner.pending && owner.freshUntil) {
      const instant = new Date(owner.freshUntil);
      if (Number.isNaN(instant.getTime()))
        throw new Error('Lattice publication has an invalid fresh bound');
      freshUntil = instant.toISOString();
    }
    let freshWithin: number | undefined;
    if (!owner.retired && !owner.pending && owner.freshWithin !== undefined) {
      if (!Number.isSafeInteger(owner.freshWithin) || owner.freshWithin < 1)
        throw new Error('Lattice publication has an invalid fresh window');
      freshWithin = owner.freshWithin;
    }
    let staleWithin: number | undefined;
    if (!owner.retired && !owner.pending && owner.staleWithin !== undefined) {
      if (!Number.isSafeInteger(owner.staleWithin) || owner.staleWithin < 1)
        throw new Error('Lattice publication has an invalid staleness window');
      staleWithin = owner.staleWithin;
    }
    // A stale publication is true at its input generation but was derived
    // while inputs were still moving, so the owner stays obliged at this very
    // generation: the ordinary path re-derives it once the stream quiets.
    const dirtyGeneration = owner.pending
      ? generation
      : owner.stale && !owner.retired
        ? Math.max(
            generation,
            previous?.dirty_generation == null
              ? 0
              : Number(previous.dirty_generation),
          )
        : null;
    const pg = this.db.kind === 'pg';
    await tx([
      `INSERT INTO lattice_owners
       (realm_url, owner_url, published_generation, input_generation,
        dirty_generation, definition_revision, retired, code_bound${pg ? ', settle_until, stale_within, stale_after' : ''}) VALUES (`,
      param(realmURL),
      ',',
      param(ownerURL),
      ',',
      param(outputGeneration),
      ',',
      param(inputGeneration),
      ',',
      param(dirtyGeneration),
      ',',
      param(owner.definitionRevision),
      ',',
      param(owner.retired ?? false),
      ',',
      ...(this.db.kind === 'pg' && !owner.retired
        ? [
            'EXISTS (SELECT 1 FROM lattice_owner_code WHERE realm_url=',
            param(realmURL),
            'AND owner_url=',
            param(ownerURL),
            'AND generation=',
            param(generation),
            ')',
          ]
        : ['FALSE']),
      // The hold is measured from this publication, not from the render
      // that produced it: a window shorter than the swap still holds.
      ...(pg
        ? freshWithin !== undefined
          ? [
              ', now() + ',
              param(freshWithin),
              "::integer * interval '1 second'",
            ]
          : freshUntil !== undefined
            ? [', ', param(freshUntil), '::timestamptz']
            : [', NULL']
        : []),
      // The window is kept for the next time the owner turns dirty; the
      // deadline itself is armed only while the owner is dirty, which after a
      // stale publication it still is.
      ...(pg
        ? staleWithin !== undefined
          ? [
              ', ',
              param(staleWithin),
              '::integer, ',
              ...(dirtyGeneration !== null
                ? [
                    'now() + ',
                    param(staleWithin),
                    "::integer * interval '1 second'",
                  ]
                : ['NULL']),
            ]
          : [', NULL, NULL']
        : []),
      `) ON CONFLICT (realm_url, owner_url) DO UPDATE SET
       published_generation = EXCLUDED.published_generation,
       input_generation = EXCLUDED.input_generation, dirty_generation = EXCLUDED.dirty_generation,
       definition_revision = EXCLUDED.definition_revision,
       retired = EXCLUDED.retired, code_bound = EXCLUDED.code_bound${pg ? ', settle_until = EXCLUDED.settle_until, stale_within = EXCLUDED.stale_within, stale_after = EXCLUDED.stale_after' : ''}`,
    ]);
    if (this.db.kind === 'pg') {
      if (owner.retainOutputGeneration !== undefined) {
        await tx([
          'UPDATE lattice_owner_code SET generation=',
          param(outputGeneration),
          'WHERE',
          ...this.ownerCondition(realmURL, ownerURL),
          'AND generation=',
          param(generation),
        ]);
      }
      await tx([
        'DELETE FROM lattice_work_failures WHERE',
        ...this.ownerCondition(realmURL, ownerURL),
      ]);
      await tx([
        'DELETE FROM lattice_owner_code WHERE',
        ...this.ownerCondition(realmURL, ownerURL),
        ...(owner.retired
          ? []
          : ['AND generation <>', param(outputGeneration)]),
      ]);
    }
    await this.registerProducer(tx, owner);
    return true;
  }

  private assertProducerScope(owner: LatticeProducer) {
    let { realmURL } = owner;
    for (let watch of owner.watches) {
      let realms =
        watch.query.realms ??
        (watch.query.realm ? [watch.query.realm] : [realmURL]);
      if (realms.length !== 1 || realms[0] !== realmURL) {
        throw new Error('Lattice watches currently require the owner realm');
      }
    }
  }

  // The caller owns the publication transaction and its revision fences.
  // Watch replacement must never commit independently of the owner value.
  async registerProducer(tx: Querier, owner: LatticeProducer): Promise<void> {
    this.assertProducerScope(owner);
    let { realmURL, ownerURL } = owner;
    await tx([
      'DELETE FROM lattice_query_watches WHERE',
      ...this.ownerCondition(realmURL, ownerURL),
    ]);
    if (owner.retired) {
      await tx([
        'UPDATE lattice_owners SET attributes_json = NULL, attributes_generation = NULL WHERE',
        ...this.ownerCondition(realmURL, ownerURL),
      ]);
      return;
    }
    for (let watch of owner.watches) {
      await tx([
        `INSERT INTO lattice_query_watches
         (realm_url, owner_url, field_path, query, routing_tokens, read_paths${this.db.kind === 'pg' ? ', projection' : ''}) VALUES (`,
        param(realmURL),
        ',',
        param(ownerURL),
        ',',
        param(watch.fieldPath),
        ',',
        param(JSON.stringify(watch.query)),
        ',',
        param(
          JSON.stringify([
            ...new Set(
              watch.terms.map(({ path, value }) => routingToken(path, value)),
            ),
          ]),
        ),
        ',',
        param(watch.readPaths ? JSON.stringify(watch.readPaths) : null),
        ...(this.db.kind === 'pg'
          ? [',', param(watch.where ? JSON.stringify(watch.where) : null)]
          : []),
        ')',
      ]);
    }
  }

  async candidates(realmURL: string, document: LatticeDocument, tx?: Querier) {
    return this.candidatesForDocuments(realmURL, [document], tx);
  }

  private async candidatesForDocuments(
    realmURL: string,
    documents: LatticeDocument[],
    tx?: Querier,
  ) {
    if (!documents.length) return [];
    // Broad predicates share one sentinel. Ordinary terms encode both path
    // and value, so equal values on different fields cannot collide.
    let tokens = new Set([routingToken('', '')]);
    for (let document of documents) {
      for (let type of document.types ?? []) {
        tokens.add(routingToken('$lattice.type', type));
      }
      for (let [path, value] of Object.entries(document.search_doc ?? {})) {
        if (typeof value === 'string') tokens.add(routingToken(path, value));
        // A containsMany string field: one token per member, so a watch on
        // that field routes by membership instead of the broad sentinel.
        else if (Array.isArray(value))
          for (let member of value)
            if (typeof member === 'string')
              tokens.add(routingToken(path, member));
      }
    }
    let expression: Expression = [
      `SELECT w.owner_url, w.field_path, w.query, w.read_paths${this.db.kind === 'pg' ? ', w.projection' : ''}
       FROM lattice_query_watches w WHERE w.realm_url =`,
      param(realmURL),
      'AND',
      dbExpression({
        // Keep the indexed column bare so jsonb_ops GIN can serve this test.
        pg: ['w.routing_tokens ?|', textArrayParam([...tokens]), '::text[]'],
        sqlite: [
          'EXISTS (SELECT 1 FROM json_each(w.routing_tokens) token JOIN json_each(',
          textArrayParam([...tokens]),
          ') changed ON token.value = changed.value)',
        ],
      }),
    ];
    let rows = tx
      ? await tx(expression)
      : await query(this.db, expression, { query: 'JSON' });
    return rows.map((row) => {
      const readPaths =
        row.read_paths == null
          ? undefined
          : ((typeof row.read_paths === 'string'
              ? JSON.parse(row.read_paths)
              : row.read_paths) as string[]);
      const where =
        row.projection == null
          ? undefined
          : ((typeof row.projection === 'string'
              ? JSON.parse(row.projection)
              : row.projection) as LatticeProjectionWhere);
      return {
        ownerURL: row.owner_url as string,
        fieldPath: row.field_path as string,
        query: (typeof row.query === 'string'
          ? JSON.parse(row.query)
          : row.query) as Query,
        ...(Array.isArray(readPaths) ? { readPaths } : {}),
        ...(where && typeof where === 'object' ? { where } : {}),
      };
    });
  }

  async affected(
    realmURL: string,
    oldDocument: LatticeDocument | undefined,
    newDocument: LatticeDocument | undefined,
    tx?: Querier,
    matchers?: Map<string, Expression>,
  ): Promise<string[]> {
    // Every watch either document routes to, keyed per watch rather than
    // per owner: a row that stays matched by a watch dirties the owner only
    // if the watch has no read paths or one of them changed.
    type Candidate = {
      ownerURL: string;
      filter: Query['filter'];
      compiled?: Expression;
      readPaths?: string[];
      where?: LatticeProjectionWhere;
    };
    let watches = new Map<string, Candidate>();
    // The key travels through a SQL parameter (Postgres text admits no NUL),
    // so it is a JSON pair rather than a control-separated string.
    let keyOf = (ownerURL: string, fieldPath: string) =>
      JSON.stringify([ownerURL, fieldPath]);
    for (let document of [oldDocument, newDocument]) {
      if (!document) continue;
      for (let watch of await this.candidates(realmURL, document, tx)) {
        let key = keyOf(watch.ownerURL, watch.fieldPath);
        if (watches.has(key)) continue;
        let compiled = matchers?.get(stringify(watch.query.filter) ?? '');
        if (matchers && !compiled) {
          throw new Error(
            'Lattice watch changed after publication preparation',
          );
        }
        watches.set(key, {
          ownerURL: watch.ownerURL,
          filter: watch.query.filter,
          compiled,
          readPaths: watch.readPaths,
          where: watch.where,
        });
      }
    }
    let matchedBy = async (document: LatticeDocument | undefined) =>
      new Set(
        document
          ? await this.engine.reverseMatchingCandidates(
              [...watches].map(([key, watch]) => ({
                ownerURL: key,
                filter: watch.filter,
                compiled: watch.compiled,
              })),
              document,
            )
          : [],
      );
    let before = await matchedBy(oldDocument);
    let after = await matchedBy(newDocument);
    let owners = new Set<string>();
    for (let [key, watch] of watches) {
      let was = before.has(key);
      let is = after.has(key);
      if (!was && !is) continue;
      if (
        was &&
        is &&
        watch.readPaths &&
        !latticeReadPathsChanged(
          watch.readPaths,
          oldDocument!,
          newDocument!,
          watch.where,
        )
      )
        continue;
      owners.add(watch.ownerURL);
    }
    return [...owners].sort();
  }

  async markDirty(
    tx: Querier,
    realmURL: string,
    owners: string[],
    generation: number,
  ) {
    for (let ownerURL of new Set(owners)) {
      // Turning dirty arms the staleness deadline for an owner that declares
      // a window; an owner already dirty keeps the deadline it has.
      await tx([
        `UPDATE lattice_owners SET dirty_generation = CASE
         WHEN dirty_generation IS NULL OR dirty_generation <`,
        param(generation),
        'THEN',
        param(generation),
        'ELSE dirty_generation END',
        ...(this.db.kind === 'pg'
          ? [
              `, stale_after = CASE
         WHEN dirty_generation IS NULL AND stale_within IS NOT NULL
         THEN now() + stale_within * interval '1 second'
         ELSE stale_after END`,
            ]
          : []),
        'WHERE',
        ...(every([
          this.ownerCondition(realmURL, ownerURL),
          ['retired = FALSE'],
          ['input_generation <', param(generation)],
        ]) as Expression),
      ]);
    }
  }

  async activeOwnerCount(realmURL: string): Promise<number> {
    let [row] = await query(this.db, [
      'SELECT COUNT(*) AS total FROM lattice_owners WHERE realm_url =',
      param(realmURL),
      'AND retired = FALSE',
    ]);
    return Number(row.total);
  }

  async pending(
    realmURL: string,
    opts?: { runnableOnly?: boolean },
  ): Promise<
    Array<{
      ownerURL: string;
      generation: number;
      codeVersion?: string;
      // Past its staleness deadline: schedule it as a stale attempt.
      stale?: true;
    }>
  > {
    let rows = await query(this.db, [
      'SELECT o.owner_url, o.dirty_generation',
      ...(this.db.kind === 'pg'
        ? [`, ${latticeOwnerOverdueSQL} AS overdue`]
        : []),
      ...(opts?.runnableOnly && this.db.kind === 'pg'
        ? [`, ${latticeOwnerCodeVersionSQL} AS code_version`]
        : []),
      'FROM lattice_owners o WHERE o.realm_url =',
      param(realmURL),
      'AND o.retired = FALSE AND o.dirty_generation IS NOT NULL',
      ...(opts?.runnableOnly && this.db.kind === 'pg'
        ? [
            `AND ${latticeOwnerRetryReadySQL} AND ${latticeOwnerSettledSQL} AND NOT EXISTS (SELECT 1 FROM lattice_owner_code b JOIN lattice_code_artifacts c
          ON c.realm_url=b.realm_url AND c.file_url=b.reference->>'fileURL'
          WHERE b.realm_url=o.realm_url AND b.owner_url=o.owner_url AND c.dirty)`,
          ]
        : []),
      ...(opts?.runnableOnly && this.db.kind === 'pg'
        ? [`ORDER BY ${latticeOwnerAttemptsSQL}, o.owner_url`]
        : ['ORDER BY o.owner_url']),
    ]);
    return rows.map((row) => ({
      ownerURL: row.owner_url as string,
      generation: Number(row.dirty_generation),
      ...(row.code_version == null
        ? {}
        : { codeVersion: String(row.code_version) }),
      ...(row.overdue === true ? { stale: true as const } : {}),
    }));
  }

  // The caller holds the same realm publication lock as successful work.
  // A superseded attempt cannot suppress a newer obligation or spend its budget.
  async recordFailure(tx: Querier, work: LatticeScheduledWork, reason: string) {
    if (this.db.kind !== 'pg')
      throw new Error('Lattice work retries require PostgreSQL');
    await this.assertWorkCurrent(work, tx);
    const [previous] = await tx([
      'SELECT obligation,definition_revision,code_version,attempts FROM lattice_work_failures WHERE',
      ...this.ownerCondition(work.realmURL, work.claim.id),
    ]);
    const attempts = latticeWorkFailureAttempts(
      previous
        ? {
            obligation: Number(previous.obligation),
            definitionRevision: String(previous.definition_revision),
            codeVersion:
              previous.code_version == null
                ? undefined
                : String(previous.code_version),
            attempts: Number(previous.attempts),
          }
        : undefined,
      work.claim.obligation,
      work.definitionRevision,
      work.codeVersion,
    );
    await tx([
      `INSERT INTO lattice_work_failures(realm_url,owner_url,obligation,definition_revision,code_version,attempts,reason) VALUES (`,
      param(work.realmURL),
      ',',
      param(work.claim.id),
      ',',
      param(work.claim.obligation),
      ',',
      param(work.definitionRevision),
      ',',
      param(work.codeVersion ?? null),
      ',',
      param(attempts),
      ',',
      param(reason.slice(0, 4096)),
      `) ON CONFLICT(realm_url,owner_url) DO UPDATE SET obligation=EXCLUDED.obligation,
       definition_revision=EXCLUDED.definition_revision,code_version=EXCLUDED.code_version,attempts=EXCLUDED.attempts,reason=EXCLUDED.reason`,
    ]);
  }

  // Use the selected obligation rather than adopting whatever is dirty now.
  // At publication the caller supplies the existing pinned transaction. Queue
  // ownership and the producer's exact input/code receipts remain separate.
  async assertWorkCurrent(
    work: LatticeScheduledWork,
    tx?: Querier,
    opts?: { lockGroup?: boolean },
  ) {
    const execute =
      tx ?? ((expression: Expression) => query(this.db, expression));
    if (work.reservation) {
      if (this.db.kind !== 'pg')
        throw new Error('Lattice queue reservations require PostgreSQL');
      const group = indexingConcurrencyGroup(work.realmURL);
      // Same order as claim/coalescing: group lock before job/reservation rows.
      // At publication this shares the existing pinned transaction, keeping
      // replacement claims and finalization outside its validity/commit span.
      // The publication transaction takes that lock as late as possible
      // (`assertReservationCurrent`, after the swap) so a source write's
      // queue insert does not wait behind the whole promotion; its opening
      // check passes `lockGroup: false`.
      if (tx && opts?.lockGroup !== false)
        await acquireConcurrencyGroupLock(execute, group);
      const [reservation] = await execute([
        `SELECT r.id FROM job_reservations r JOIN jobs j ON j.id=r.job_id
         WHERE r.id=`,
        param(work.reservation.reservationId),
        'AND j.id=',
        param(work.reservation.jobId),
        `AND j.status='unfulfilled' AND j.job_type='lattice-materialize'
         AND j.concurrency_group=`,
        param(group),
        `AND j.args->>'realmURL'=`,
        param(work.realmURL),
        // NOW() is the transaction start, potentially before a lock wait.
        `AND r.completed_at IS NULL AND r.locked_until > clock_timestamp()`,
        ...(tx ? ['FOR SHARE OF j,r'] : []),
      ]);
      if (!reservation)
        throw new LatticeWorkSuperseded('queue reservation no longer current');
    }
    const [row] = await execute([
      'SELECT',
      dbExpression({ pg: [latticeOwnerCodeVersionSQL], sqlite: ['NULL'] }),
      `AS code_version, g.current_generation,g.loader_epoch,o.retired,o.dirty_generation,
         p.read,r.archived_at,
         EXISTS(SELECT 1 FROM jobs j WHERE j.concurrency_group=`,
      param('indexing:' + work.realmURL),
      `AND j.status='unfulfilled' AND j.job_type IN
         ('incremental-index','from-scratch-index','copy-index')) AS source_pending,
         EXISTS(SELECT 1 FROM lattice_pending_generations t WHERE t.realm_url=g.realm_url) AS matching_pending,`,
      dbExpression({ pg: [latticeOwnerOverdueSQL], sqlite: ['FALSE'] }),
      'AS overdue,',
      dbExpression({
        pg: [
          `NOT EXISTS(SELECT 1 FROM lattice_owner_code b JOIN lattice_code_artifacts c
          ON c.realm_url=b.realm_url AND c.file_url=b.reference->>'fileURL'
          WHERE b.realm_url=g.realm_url AND b.owner_url=o.owner_url AND c.dirty)`,
        ],
        sqlite: ['TRUE'],
      }),
      `AS code_ready FROM realm_generations g
       JOIN realm_user_permissions p ON p.realm_url=g.realm_url
       JOIN realm_metadata r ON r.url=g.realm_url
       LEFT JOIN lattice_owners o ON o.realm_url=g.realm_url AND o.owner_url=`,
      param(work.claim.id),
      'WHERE g.realm_url=',
      param(work.realmURL),
      'AND p.username=',
      param(work.actor),
      ...(tx && this.db.kind === 'pg' ? ['FOR SHARE OF g,p,r'] : []),
    ]);
    const decision = latticeWorkDecision(
      {
        id: work.claim.id,
        obligation:
          row?.dirty_generation == null ? null : Number(row.dirty_generation),
        authorized: Boolean(row?.read) && row?.archived_at == null,
        active: row?.retired === false || row?.retired === 0,
        sourcePending: Boolean(row?.source_pending),
        inputsCurrent:
          Number(row?.current_generation) === work.inputGeneration &&
          !row?.matching_pending,
        codeCurrent:
          Boolean(row?.code_ready) &&
          (row?.code_version ?? undefined) === work.codeVersion &&
          row?.loader_epoch === work.definitionRevision,
        overdue: row?.overdue === true,
      },
      work.claim,
    );
    if (decision.status === 'withheld')
      throw new LatticeWorkSuperseded(
        latticeWorkReasons[decision.reason],
        decision.reason === 'authority-changed'
          ? { realmURL: work.realmURL, actor: work.actor }
          : undefined,
      );
  }

  // The commit-time half of `assertWorkCurrent` for a publication: take the
  // queue group lock and re-read the reservation under it, right before the
  // swap commits. The owner-state checks ran at the start of the transaction
  // (before the swap changed the owner rows); this guarantees no replacement
  // claim or finalization lands inside the commit span, while the group lock
  // is held for milliseconds instead of the whole promotion.
  async assertReservationCurrent(work: LatticeScheduledWork, tx: Querier) {
    if (!work.reservation) return;
    if (this.db.kind !== 'pg')
      throw new Error('Lattice queue reservations require PostgreSQL');
    const group = indexingConcurrencyGroup(work.realmURL);
    await acquireConcurrencyGroupLock(tx, group);
    const [reservation] = await tx([
      `SELECT r.id FROM job_reservations r JOIN jobs j ON j.id=r.job_id
       WHERE r.id=`,
      param(work.reservation.reservationId),
      'AND j.id=',
      param(work.reservation.jobId),
      `AND j.status='unfulfilled' AND j.job_type='lattice-materialize'
       AND j.concurrency_group=`,
      param(group),
      `AND j.args->>'realmURL'=`,
      param(work.realmURL),
      `AND r.completed_at IS NULL AND r.locked_until > clock_timestamp()
       FOR SHARE OF j,r`,
    ]);
    if (!reservation)
      throw new LatticeWorkSuperseded('queue reservation no longer current');
  }

  // Any dirty owner past its staleness deadline: a matching backlog must not
  // keep it from a wave.
  async hasOverdue(realmURL: string): Promise<boolean> {
    if (this.db.kind !== 'pg') return false;
    const [row] = await query(this.db, [
      'SELECT 1 FROM lattice_owners o WHERE o.realm_url =',
      param(realmURL),
      `AND o.retired = FALSE AND o.dirty_generation IS NOT NULL AND ${latticeOwnerOverdueSQL} LIMIT 1`,
    ]);
    return Boolean(row);
  }

  // Scheduling evidence only. The per-realm queue lease, live input checks and
  // guarded publication still own correctness if any of these rows change.
  // `overdueOnly` composes a wave of stale attempts alone: an ordinary
  // attempt beside them would yield to the source backlog and take the wave
  // down with it.
  async ready(realmURL: string, opts?: { overdueOnly?: boolean }) {
    const pending = await this.pending(realmURL);
    if (!pending.length) return [];
    const runnableOwners = await this.pending(realmURL, { runnableOnly: true });
    const runnable = new Set(runnableOwners.map((owner) => owner.ownerURL));
    // Past its deadline an owner reads its dirty inputs' last published
    // bodies rather than waiting for them, so a dirty input does not block
    // it. An input that has never published has no last body to read: a
    // stale attempt over it can only fail, so it blocks the overdue owner
    // exactly as it blocks an ordinary one.
    const overdue = new Set(
      runnableOwners.filter((owner) => owner.stale).map((o) => o.ownerURL),
    );
    const neverPublished = new Set<string>(
      overdue.size && this.db.kind === 'pg'
        ? (
            await query(this.db, [
              `SELECT o.owner_url FROM lattice_owners o
               JOIN realm_generations g ON g.realm_url=o.realm_url
               LEFT JOIN boxel_index i
               ON i.realm_url=o.realm_url AND i.url=o.owner_url AND i.type='instance'
               WHERE o.realm_url=`,
              param(realmURL),
              `AND o.retired=FALSE AND o.dirty_generation IS NOT NULL
               AND (i.url IS NULL OR (i.pristine_doc->'meta'->'publication'->>'state') IS DISTINCT FROM 'ready'
                    OR NOT`,
              ...latticeOwnerDefinitionCurrent(
                ['o.realm_url'],
                ['o.owner_url'],
                ['g.loader_epoch'],
                ['o.definition_revision'],
              ),
              ')',
            ])
          ).map((row) => String(row.owner_url))
        : [],
    );
    const inputs = new Map(
      pending.map(({ ownerURL }) => [ownerURL, new Set<string>()]),
    );

    // Retained concrete reads cover declared links and getters that consume an
    // input without declaring a query. Match card aliases as well as .json URLs;
    // module/CSS dependencies cannot become work nodes in this owner-only join.
    // Set-based on the dependency list: each dirty owner's deps join the
    // dirty owners by equality. The former dirty-owner × dirty-owner form
    // (`i.deps ?| ARRAY[...]` per pair) took over two seconds per wave with
    // 1,100 dirty owners, which every single-owner wave paid again.
    const edges = await query(this.db, [
      `SELECT DISTINCT i.url AS owner_url, d.owner_url AS input_url FROM boxel_index i
       JOIN lattice_owners o ON o.realm_url=i.realm_url AND o.owner_url=i.url`,
      dbExpression({
        pg: [`CROSS JOIN LATERAL jsonb_array_elements_text(i.deps) dep`],
        sqlite: [`CROSS JOIN json_each(i.deps) dep`],
      }),
      `JOIN lattice_owners d ON d.realm_url=o.realm_url
         AND (d.owner_url=dep.value OR d.owner_url=dep.value||'.json')
       WHERE o.realm_url=`,
      param(realmURL),
      `AND i.type='instance' AND o.retired=FALSE AND o.dirty_generation IS NOT NULL
       AND d.retired=FALSE AND d.dirty_generation IS NOT NULL`,
    ]);
    for (const edge of edges)
      inputs.get(String(edge.owner_url))?.add(String(edge.input_url));

    const watches = await query(
      this.db,
      [
        `SELECT w.owner_url,w.field_path,w.query FROM lattice_query_watches w JOIN lattice_owners o
         ON o.realm_url=w.realm_url AND o.owner_url=w.owner_url
         WHERE o.realm_url=`,
        param(realmURL),
        'AND o.retired=FALSE AND o.dirty_generation IS NOT NULL',
      ],
      { query: 'JSON' },
    );
    const compiler = this.engine.reverseCompilationScope();
    const scopes = new Map<string, string[]>();
    for (const watch of watches) {
      const ownerURL = String(watch.owner_url);
      if (!runnable.has(ownerURL)) continue;
      const filter = (watch.query as Query).filter;
      // Native input frames already know the concrete identities they read.
      // This generated watch is for restoring/invalidating those inputs, not
      // an untyped query that must wait for every dirty owner (including self).
      // Unexpected shapes retain the conservative ordinary scope below.
      if (
        watch.field_path === '@lattice/inputs' &&
        filter &&
        Object.keys(filter).length === 1 &&
        'in' in filter &&
        Object.keys(filter.in).length === 1 &&
        Array.isArray(filter.in.id) &&
        filter.in.id.every((id) => typeof id === 'string')
      ) {
        const ids = new Set(filter.in.id);
        for (const input of pending)
          if (ids.has(input.ownerURL.replace(/\.json$/, '')))
            inputs.get(ownerURL)?.add(input.ownerURL);
        continue;
      }
      // Different rooms/dates can share one readiness scope. Their exact
      // membership predicates remain separate in the reverse-query registry.
      const scope = await compiler.latticeQueryTypeScope(filter);
      const key = stringify(scope)!;
      let candidates = scopes.get(key);
      if (!candidates) {
        // Same conservative type scope as native input admission. Old computed
        // values may be false negatives for exact membership, sort or page.
        const rows = await query(this.db, [
          `SELECT o.owner_url FROM lattice_owners o LEFT JOIN boxel_index i
           ON i.realm_url=o.realm_url AND i.url=o.owner_url AND i.type='instance'
           WHERE o.realm_url=`,
          param(realmURL),
          `AND o.retired=FALSE AND o.dirty_generation IS NOT NULL
           AND (i.url IS NULL OR (`,
          ...scope,
          '))',
        ]);
        candidates = rows.map((row) => String(row.owner_url));
        scopes.set(key, candidates);
      }
      for (const candidate of candidates) inputs.get(ownerURL)?.add(candidate);
    }
    const frontier = latticeWorkFrontier(
      pending.map(({ ownerURL }) => ({
        id: ownerURL,
        runnable: runnable.has(ownerURL),
        pendingInputs: overdue.has(ownerURL)
          ? [...inputs.get(ownerURL)!].filter((input) =>
              neverPublished.has(input),
            )
          : [...inputs.get(ownerURL)!],
      })),
    );
    if (frontier.cycle.length)
      throw new Error(
        `Lattice work dependency cycle: ${frontier.cycle.join(' -> ')}`,
      );
    const ready = new Set(frontier.ready);
    // An overdue owner is scheduled as a stale attempt only where the
    // ordinary path cannot serve it: inside a preempting wave, or with an
    // input still dirty. Otherwise it runs the ordinary way and publishes
    // clean, so a stream that has just stopped costs one render, not two.
    return runnableOwners
      .filter(
        ({ ownerURL, stale }) =>
          ready.has(ownerURL) && (!opts?.overdueOnly || stale),
      )
      .map(({ stale, ...row }): (typeof runnableOwners)[number] =>
        stale && (opts?.overdueOnly || inputs.get(row.ownerURL)!.size > 0)
          ? { ...row, stale: true as const }
          : row,
      );
  }

  private ownerCondition(realmURL: string, ownerURL: string) {
    return every([
      ['realm_url =', param(realmURL)],
      ['owner_url =', param(ownerURL)],
    ]) as Expression;
  }
}

// The native input watch (`@lattice/inputs`) lists the exact resolved ids
// the owner read, in the form the search doc's `id` carries, so it routes on
// those ids rather than the sentinel every changed row matches.
function latticeInputIdTerms(
  watch: LatticeWatch,
): Array<{ path: string; value: string }> | undefined {
  if (watch.fieldPath !== '@lattice/inputs') return undefined;
  let filter = watch.query.filter;
  if (
    !filter ||
    Object.keys(filter).length !== 1 ||
    !('in' in filter) ||
    Object.keys(filter.in).length !== 1 ||
    !Array.isArray(filter.in.id) ||
    filter.in.id.length === 0 ||
    !filter.in.id.every(
      (id) => typeof id === 'string' && id.length > 0 && id.length <= 2048,
    )
  )
    return undefined;
  return filter.in.id.map((value) => ({ path: 'id', value: value as string }));
}

function routingToken(path: string, value: string): string {
  return JSON.stringify([path, value]);
}
