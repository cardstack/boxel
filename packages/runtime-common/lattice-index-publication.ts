import type { LatticeProjectionWhere } from './definitions.ts';
import stringify from 'safe-stable-stringify';
import { enqueueLattice, latticeOwnerRetryReadySQL } from './jobs/lattice.ts';
import { recordLatticePublication } from './lattice-publication-outbox.ts';
import type { LatticeReadScope, LatticeScheduledWork } from './lattice-work.ts';
import type { LatticeChangeCapture } from './lattice-adapters.ts';
import type { DBAdapter } from './db.ts';
import type { BoxelIndexTable } from './index-structure.ts';
import { coerceTypes } from './index-structure.ts';
import {
  param,
  textArrayParam,
  query,
  dbExpression,
  type Querier,
} from './expression.ts';
import { assertLatticeGeneration } from './lattice-materialization.ts';
import { latticeOwnerDefinitionCurrent } from './lattice-code-reference.ts';
import { logger } from './log.ts';
import type {
  LatticeQueryRegistry,
  LatticeDocument,
  LatticeWatch,
  LatticeQueryPreparation,
} from './lattice-query-registry.ts';

const perfLog = logger('index-perf');
const MAX_PENDING_INDEX_EVENTS = 100_000;

// IndexRunner prepares these outside the commit lock. The actual publication,
// watch replacement and dirty markers all use Batch.done's pinned transaction.
export interface LatticeSourceChange {
  realmURL: string;
  generation: number;
  definitionRevision: string;
  realmUsername: string;
}

export class LatticeIndexPublication implements LatticeChangeCapture<
  Querier,
  LatticeSourceChange
> {
  private db: DBAdapter;
  readonly registry: LatticeQueryRegistry;
  constructor(db: DBAdapter, registry: LatticeQueryRegistry) {
    this.db = db;
    this.registry = registry;
  }

  async analyzeAfterFullIndex() {
    if (this.db.kind === 'pg') {
      // Run after promotion, outside its transaction. Fresh imports otherwise
      // leave the query planner using statistics from the old/empty index.
      await this.db.execute(
        'ANALYZE boxel_index, boxel_index_working, lattice_index_events, lattice_pending_generations, lattice_owners, lattice_query_watches',
      );
    }
  }

  // No definition loads, reverse matching, or owner renders on the source
  // commit path. These set-based copies and the queue wake-up share the swap's
  // transaction, so a crash cannot leave an apparently current orphaned view.
  // Returns whether the realm has Lattice work to wake. With `deferWake` the
  // caller enqueues that wake-up itself (`wakeSource`) at the end of the swap
  // transaction: the queue insert takes the realm's index concurrency-group
  // lock, and holding it from here to commit made every source write's own
  // queue insert wait for the whole promotion.
  async recordChange(tx: Querier, change: LatticeSourceChange) {
    await this.recordSourceChange(tx, change);
  }

  async recordSourceChange(
    tx: Querier,
    change: LatticeSourceChange,
    opts?: { deferWake?: boolean },
  ): Promise<boolean> {
    let { realmURL, generation, definitionRevision, realmUsername } = change;
    await assertLatticeGeneration(this.db, realmURL, generation - 1, tx);
    let [enabled] = await tx([
      'SELECT 1 WHERE EXISTS (SELECT 1 FROM lattice_owners WHERE realm_url =',
      param(realmURL),
      'AND retired = FALSE) OR EXISTS (SELECT 1 FROM boxel_index_working WHERE realm_url =',
      param(realmURL),
      'AND generation =',
      param(generation),
      "AND type = 'instance' AND pristine_doc->'meta'->'publication' IS NOT NULL)",
    ]);
    if (!enabled) return false;
    // These are outstanding obligations, not history: never TTL/drop an
    // unmatched transition. The realm's source-swap lock serializes admission
    // with matching. Bound the count before copying any more JSON bodies;
    // overflow rolls back the entire source promotion and can retry after
    // matching drains capacity. A single oversized full import also refuses.
    let [backlog] = await tx([
      'SELECT count(*) AS count FROM (SELECT 1 FROM lattice_index_events WHERE realm_url =',
      param(realmURL),
      'UNION ALL SELECT 1 FROM boxel_index_working WHERE realm_url =',
      param(realmURL),
      'AND generation =',
      param(generation),
      "AND type = 'instance' LIMIT",
      param(MAX_PENDING_INDEX_EVENTS + 1),
      ') pending',
    ]);
    if (Number(backlog.count) > MAX_PENDING_INDEX_EVENTS) {
      throw new Error(
        `Lattice index event backlog limit (${MAX_PENDING_INDEX_EVENTS}) reached for ${realmURL}; drain pending materialization work and retry indexing`,
      );
    }
    await tx([
      'INSERT INTO lattice_pending_generations (realm_url, generation, definition_revision) VALUES (',
      param(realmURL),
      ',',
      param(generation),
      ',',
      param(definitionRevision),
      ') ON CONFLICT DO NOTHING',
    ]);
    let fields = [
      'url',
      'type',
      'has_error',
      'is_deleted',
      'pristine_doc',
      'search_doc',
      'types',
    ];
    let json = (alias: string) =>
      `jsonb_build_object(${fields.map((f) => `'${f}', ${alias}.${f}`).join(',')})`;
    await tx([
      `INSERT INTO lattice_index_events (realm_url, generation, url, previous_row, next_row)
       SELECT w.realm_url, w.generation, w.url,
         CASE WHEN i.url IS NULL THEN NULL ELSE ${json('i')} END, ${json('w')}
       FROM boxel_index_working w LEFT JOIN boxel_index i
         ON i.realm_url = w.realm_url AND i.url = w.url AND i.type = w.type
       WHERE w.realm_url =`,
      param(realmURL),
      'AND w.generation =',
      param(generation),
      "AND w.type = 'instance' ON CONFLICT DO NOTHING",
    ]);
    // Cold readers also receive well-formed pending provenance before the
    // secondary job has registered a new owner. Existing clients retain data.
    await tx([
      `UPDATE boxel_index_working SET pristine_doc = jsonb_set(pristine_doc,
        '{meta,publication}', (pristine_doc->'meta'->'publication') || jsonb_build_object(
          'state', 'pending', 'inputGeneration', 0, 'publishedGeneration',`,
      param(generation),
      "::bigint, 'definitionRevision',",
      param(definitionRevision),
      `::text))
       WHERE realm_url =`,
      param(realmURL),
      'AND generation =',
      param(generation),
      "AND type = 'instance' AND pristine_doc->'meta'->'publication' IS NOT NULL",
    ]);
    await tx([
      'UPDATE boxel_index_working SET job_id = NULL WHERE realm_url =',
      param(realmURL),
      'AND generation =',
      param(generation),
    ]);
    if (!opts?.deferWake) await enqueueLattice(tx, realmURL, realmUsername);
    return true;
  }

  // The deferred half of `recordChange`: the queue wake-up, placed by the
  // caller at the tail of the same transaction.
  async wakeSource(tx: Querier, realmURL: string, realmUsername: string) {
    await enqueueLattice(tx, realmURL, realmUsername);
  }

  // Match a bounded portion of the durable outbox. Checkpoint deletion and
  // precise dirty-owner marks commit together; replay after failure is safe.
  async matchPending(
    realmURL: string,
    realmUsername: string,
  ): Promise<boolean> {
    let [generationRow] = await query(this.db, [
      'SELECT generation, definition_revision FROM lattice_pending_generations WHERE realm_url =',
      param(realmURL),
      'ORDER BY generation LIMIT 1',
    ]);
    if (!generationRow) return false;
    let generation = Number(generationRow.generation);
    let events = await query(
      this.db,
      [
        'SELECT url, previous_row, next_row FROM lattice_index_events WHERE realm_url =',
        param(realmURL),
        'AND generation =',
        param(generation),
        'ORDER BY url LIMIT 250',
      ],
      { previous_row: 'JSON', next_row: 'JSON' },
    );
    let rows = events.map((e) => e.next_row as unknown as BoxelIndexTable);
    let previous = new Map(
      events.map((e) => [
        e.url as string,
        e.previous_row as unknown as BoxelIndexTable | undefined,
      ]),
    );
    let prepared = await this.prepare(realmURL, generation, rows, previous);
    await this.db.withWriteLock(`lattice:index:${realmURL}`, async (tx) => {
      if (!tx)
        throw new Error('Lattice secondary matching requires a transaction');
      await this.commit(tx, {
        realmURL,
        generation,
        definitionRevision: generationRow.definition_revision as string,
        prepared,
        replayPrevious: previous,
      });
      if (events.length)
        await tx([
          'DELETE FROM lattice_index_events WHERE realm_url =',
          param(realmURL),
          'AND generation =',
          param(generation),
          'AND url = ANY(',
          textArrayParam(events.map((e) => e.url as string)),
          '::text[])',
        ]);
      await tx([
        'DELETE FROM lattice_pending_generations g WHERE g.realm_url =',
        param(realmURL),
        'AND g.generation =',
        param(generation),
        'AND NOT EXISTS (SELECT 1 FROM lattice_index_events e WHERE e.realm_url = g.realm_url AND e.generation = g.generation)',
      ]);
      await this.enqueuePending(tx, realmURL, realmUsername);
    });
    return true;
  }

  async failWork(
    work: LatticeScheduledWork,
    reason: string,
    realmUsername: string,
    wave: number,
  ) {
    if (this.db.kind !== 'pg') return false;
    await this.db.withWriteLock(
      `lattice:index:${work.realmURL}`,
      async (tx) => {
        if (!tx)
          throw new Error('Lattice failure recording requires a transaction');
        await this.registry.recordFailure(tx, work, reason);
        await this.enqueuePending(tx, work.realmURL, realmUsername, wave);
      },
    );
    return true;
  }

  // A wave that found nothing runnable while owners sit in their settle
  // window leaves a queued job behind; the queue's claim eligibility keeps
  // it unclaimed until a hold passes (the worker's poll is the clock).
  async wakeHeldOwners(
    realmURL: string,
    realmUsername: string,
    wave: number,
  ): Promise<boolean> {
    if (this.db.kind !== 'pg') return false;
    let [held] = await query(this.db, [
      'SELECT 1 FROM lattice_owners o WHERE o.realm_url =',
      param(realmURL),
      'AND NOT o.retired AND o.dirty_generation IS NOT NULL AND (o.settle_until > now() OR o.stale_after > now()) LIMIT 1',
    ]);
    if (!held) return false;
    await this.db.withWriteLock(`lattice:index:${realmURL}`, async (tx) => {
      if (!tx) throw new Error('Lattice wake-up requires a transaction');
      await this.enqueuePending(tx, realmURL, realmUsername, wave);
    });
    return true;
  }

  async enqueuePending(
    tx: Querier,
    realmURL: string,
    realmUsername: string,
    wave = 0,
    waitForRead?: LatticeReadScope,
  ) {
    let [pending] = await tx([
      'SELECT 1 WHERE EXISTS (SELECT 1 FROM lattice_pending_generations WHERE realm_url =',
      param(realmURL),
      ') OR EXISTS (SELECT 1 FROM lattice_owners o WHERE o.realm_url =',
      param(realmURL),
      `AND NOT o.retired AND o.dirty_generation IS NOT NULL AND ${latticeOwnerRetryReadySQL})`,
    ]);
    if (pending)
      await enqueueLattice(tx, realmURL, realmUsername, wave, 0, waitForRead);
  }

  async hasUnmatched(realmURL: string): Promise<boolean> {
    return (
      (
        await query(this.db, [
          'SELECT 1 FROM lattice_pending_generations WHERE realm_url =',
          param(realmURL),
          'LIMIT 1',
        ])
      ).length > 0
    );
  }

  async prepare(
    realmURL: string,
    generation: number,
    replayRows?: BoxelIndexTable[],
    replayPrevious?: Map<string, BoxelIndexTable | undefined>,
    nativeQueries?: ReadonlyMap<string, LatticeQueryPreparation>,
    opts?: {
      // Owner publications (a materialization wave) read only the document
      // envelope: `pristine_doc` comes back as `{ meta }`. The body, which for
      // a day owner is over a megabyte, stays in Postgres; `commit` compares
      // and updates it there. Source passes and replay keep the full rows.
      envelope?: boolean;
    },
  ) {
    let startedAt = Date.now();
    let active = await query(this.db, [
      'SELECT owner_url FROM lattice_owners WHERE realm_url =',
      param(realmURL),
      'AND retired = FALSE',
    ]);
    let activeAt = Date.now();
    let rows =
      replayRows ??
      ((await query(
        this.db,
        [
          opts?.envelope
            ? "SELECT url, type, has_error, is_deleted, CASE WHEN pristine_doc IS NULL THEN NULL ELSE jsonb_build_object('meta', pristine_doc->'meta') END AS pristine_doc, search_doc, types FROM boxel_index_working WHERE realm_url ="
            : 'SELECT url, type, has_error, is_deleted, pristine_doc, search_doc, types FROM boxel_index_working WHERE realm_url =',
          param(realmURL),
          'AND generation =',
          param(generation),
          ...(active.length
            ? []
            : ["AND pristine_doc->'meta'->'publication' IS NOT NULL"]),
        ],
        coerceTypes,
      )) as unknown as BoxelIndexTable[]);
    let rowsAt = Date.now();
    let ownerWatches = new Map<string, LatticeWatch[]>();
    let ownerReadPaths = new Map<string, Record<string, string[]>>();
    let ownerProjections = new Map<
      string,
      Record<string, LatticeProjectionWhere>
    >();
    let activeOwners = new Set(active.map((row) => row.owner_url as string));
    let retiringOwners = new Set(
      rows
        .filter(
          (row) =>
            row.type === 'instance' &&
            activeOwners.has(row.url) &&
            (row.is_deleted ||
              (!row.has_error && !row.pristine_doc?.meta.publication)),
        )
        .map((row) => row.url),
    );
    for (let row of rows) {
      let manifest = row.pristine_doc?.meta.publication;
      if (
        row.type === 'instance' &&
        !row.has_error &&
        !row.is_deleted &&
        manifest
      ) {
        ownerWatches.set(row.url, manifest.watches);
        if (manifest.readPaths) ownerReadPaths.set(row.url, manifest.readPaths);
        if (manifest.projections)
          ownerProjections.set(row.url, manifest.projections);
      }
    }
    let previousRows = replayPrevious
      ? [...replayPrevious.values()].filter((row): row is BoxelIndexTable =>
          Boolean(row),
        )
      : rows.length
        ? ((await query(
            this.db,
            [
              'SELECT url, is_deleted, search_doc, types FROM boxel_index WHERE realm_url =',
              param(realmURL),
              "AND type = 'instance' AND",
              dbExpression({
                pg: [
                  'url = ANY(',
                  textArrayParam(rows.map((row) => row.url)),
                  '::text[])',
                ],
                sqlite: [
                  'url IN (SELECT value FROM json_each(',
                  textArrayParam(rows.map((row) => row.url)),
                  '))',
                ],
              }),
            ],
            coerceTypes,
          )) as unknown as BoxelIndexTable[])
        : [];
    let previousAt = Date.now();
    let documents = [...rows, ...previousRows]
      .map(latticeDocument)
      .filter((document): document is LatticeDocument => Boolean(document));
    let { watches, matchers } = await this.registry.preparePublication(
      realmURL,
      ownerWatches,
      retiringOwners,
      documents,
      nativeQueries,
      ownerReadPaths,
      ownerProjections,
    );
    if (opts?.envelope) {
      perfLog.debug(
        `Lattice publication prepare ${JSON.stringify({
          rows: rows.length,
          activeMs: activeAt - startedAt,
          rowsMs: rowsAt - activeAt,
          previousMs: previousAt - rowsAt,
          watchesMs: Date.now() - previousAt,
          totalMs: Date.now() - startedAt,
          generation,
        })}`,
      );
    }
    return {
      rows,
      watches,
      matchers,
      retiringOwners,
      hadOwners: active.length > 0,
      envelope: Boolean(opts?.envelope),
    };
  }

  async commit(
    tx: Querier,
    args: {
      realmURL: string;
      generation: number;
      definitionRevision: string;
      prepared: Awaited<ReturnType<LatticeIndexPublication['prepare']>>;
      inputGeneration?: number;
      replayPrevious?: Map<string, BoxelIndexTable | undefined>;
      changedCode?: ReadonlySet<string>;
    },
  ): Promise<Set<string>> {
    let {
      realmURL,
      generation,
      definitionRevision,
      prepared,
      inputGeneration,
      replayPrevious,
      changedCode,
    } = args;
    // Even the no-watch fast path was prepared outside the lock. Another
    // publisher may have registered the realm's first owner since then; a
    // stale source must retry so that new watch participates in invalidation.
    if (!replayPrevious)
      await assertLatticeGeneration(this.db, realmURL, generation - 1, tx);
    const retained = new Set<string>();
    const skipped: string[] = [];
    if (!prepared.rows.length && !prepared.hadOwners) return retained;
    if (inputGeneration !== undefined && inputGeneration !== generation - 1) {
      throw new Error('Lattice publication does not follow its input revision');
    }
    if (inputGeneration !== undefined) {
      let [realm] = await tx([
        'SELECT loader_epoch FROM realm_generations WHERE realm_url =',
        param(realmURL),
      ]);
      if (realm?.loader_epoch !== definitionRevision)
        throw new Error('Lattice definitions changed during computation');
    }
    let changed = new Set<string>();
    let dirty = new Set<string>();
    let published = new Set<string>();
    // Envelope rows (see `prepare`): compare bodies and rewrite the manifest
    // in Postgres, and copy the attribute body between tables there, so the
    // owner document is never re-serialized through this process.
    const envelope = prepared.envelope && !replayPrevious;
    const timings = {
      owners: 0,
      previousMs: 0,
      compareMs: 0,
      affectedMs: 0,
      publishMs: 0,
      attributesMs: 0,
      workingMs: 0,
      depsMs: 0,
      dirtyMs: 0,
      outboxMs: 0,
    };
    // Retire before matching changed inputs. An owner's removed definition
    // must not be needed to delete its watches. These writes remain inside
    // the same transaction as the source tombstones and generation promotion.
    for (let ownerURL of prepared.retiringOwners) {
      await this.registry.publish(tx, {
        realmURL,
        ownerURL,
        generation,
        inputGeneration: generation,
        definitionRevision,
        watches: [],
        retired: true,
      });
    }
    if (inputGeneration === undefined) {
      // Code-backed values follow their file-owned receipt. Legacy values
      // still use the conservative loader epoch until they acquire a binding.
      let outdated = await tx([
        'SELECT o.owner_url FROM lattice_owners o WHERE o.realm_url =',
        param(realmURL),
        'AND o.retired = FALSE AND NOT',
        ...latticeOwnerDefinitionCurrent(
          ['o.realm_url'],
          ['o.owner_url'],
          [param(definitionRevision)],
          ['o.definition_revision'],
        ),
      ]);
      for (let owner of outdated) dirty.add(owner.owner_url as string);
    }
    for (let row of prepared.rows) {
      if (row.type !== 'instance') continue;
      let phaseAt = Date.now();
      let sameBody: boolean | undefined;
      let [old] = replayPrevious
        ? [replayPrevious.get(row.url)]
        : envelope
          ? await tx([
              `SELECT i.url, i.type, i.generation, i.has_error, i.is_deleted,
                      CASE WHEN i.pristine_doc IS NULL THEN NULL
                           ELSE jsonb_build_object('meta', i.pristine_doc->'meta') END AS pristine_doc,
                      i.search_doc, i.types,
                      md5((i.pristine_doc #- '{meta,publication}')::text) =
                        md5((w.pristine_doc #- '{meta,publication}')::text) AS same_body
                 FROM boxel_index i
                 LEFT JOIN boxel_index_working w
                   ON w.realm_url = i.realm_url AND w.url = i.url
                  AND w.type = 'instance' AND w.generation =`,
              param(generation),
              'WHERE i.realm_url =',
              param(realmURL),
              'AND i.url =',
              param(row.url),
              "AND i.type = 'instance'",
            ])
          : await tx([
              'SELECT url, type, generation, has_error, is_deleted, pristine_doc, search_doc, types FROM boxel_index WHERE realm_url =',
              param(realmURL),
              'AND url =',
              param(row.url),
              "AND type = 'instance'",
            ]);
      let previous = old as unknown as BoxelIndexTable | undefined;
      if (envelope && old) {
        sameBody = Boolean((old as { same_body?: unknown }).same_body);
      }
      timings.previousMs += Date.now() - phaseAt;
      phaseAt = Date.now();
      // Exclude only provenance from equality: membership and output changes
      // propagate to feeders; a recomputation with identical data does not.
      const semanticallyEqual = envelope
        ? latticeEnvelopeRowsEqual(previous, row, sameBody)
        : latticeSemanticRow(previous) === latticeSemanticRow(row);
      timings.compareMs += Date.now() - phaseAt;
      phaseAt = Date.now();
      if (
        !semanticallyEqual ||
        changedCode?.has(row.url) ||
        (inputGeneration !== undefined &&
          row.pristine_doc?.meta.publication &&
          previous?.pristine_doc?.meta.publication?.definitionRevision !==
            definitionRevision)
      ) {
        changed.add(row.url);
        for (let owner of await this.registry.affected(
          realmURL,
          latticeDocument(previous),
          latticeDocument(row),
          tx,
          prepared.matchers,
        ))
          dirty.add(owner);
      }
      timings.affectedMs += Date.now() - phaseAt;
      let manifest = row.pristine_doc?.meta.publication;
      if (!row.has_error && !row.is_deleted && manifest) {
        if (
          inputGeneration !== undefined &&
          manifest.validatedThrough !== inputGeneration
        ) {
          throw new Error(
            'Lattice renderer returned a different input revision',
          );
        }
        let ready = inputGeneration !== undefined;
        const previousManifest = previous?.pristine_doc?.meta.publication;
        const retainOutput =
          ready &&
          !changed.has(row.url) &&
          !changedCode?.has(row.url) &&
          previousManifest?.state === 'ready' &&
          previousManifest.definitionRevision === definitionRevision &&
          previousManifest.outputRevision === Number(previous?.generation);
        const outputGeneration = retainOutput
          ? previousManifest!.outputRevision!
          : generation;

        phaseAt = Date.now();
        timings.owners++;
        const publishOwner = (retain: boolean) =>
          this.registry.publish(tx, {
            realmURL,
            ownerURL: row.url,
            generation,
            inputGeneration: inputGeneration ?? 0,
            definitionRevision,
            watches: prepared.watches.get(row.url)!,
            pending: !ready,
            ...(retain ? { retainOutputGeneration: outputGeneration } : {}),
            ...(manifest.freshUntil ? { freshUntil: manifest.freshUntil } : {}),
            ...(manifest.freshWithin
              ? { freshWithin: manifest.freshWithin }
              : {}),
            ...(manifest.staleWithin
              ? { staleWithin: manifest.staleWithin }
              : {}),
            ...(manifest.stale ? { stale: true as const } : {}),
          });
        let retainsOutput = retainOutput;
        let accepted = await publishOwner(retainOutput);
        if (!accepted && retainOutput) {
          // Retention pins the owner row's published generation to the
          // retained output revision. A pending registration since that
          // output (the owner's own card re-indexed) moves the row past it,
          // and no retry can restore the match: publish a fresh revision.
          retainsOutput = false;
          accepted = await publishOwner(false);
        }
        if (!accepted) {
          {
            // An obsolete member must not discard a materialization wave --
            // nor, when it is the wave's only member, the whole drain: the
            // job's retries render the same owner into the same race and the
            // chain dies with every other owner still dirty. Leave its last
            // publication in place (drop this wave's working row) and let the
            // owner take a later wave.
            await tx([
              'DELETE FROM boxel_index_working WHERE realm_url =',
              param(realmURL),
              'AND url =',
              param(row.url),
              "AND type = 'instance' AND generation =",
              param(generation),
            ]);
            skipped.push(row.url);
            timings.publishMs += Date.now() - phaseAt;
            continue;
          }
        }
        const finalOutputGeneration = retainsOutput
          ? outputGeneration
          : generation;
        timings.publishMs += Date.now() - phaseAt;
        const publication: typeof manifest = {
          ...manifest,
          state: ready ? ('ready' as const) : ('pending' as const),
          outputRevision: finalOutputGeneration,
          definitionRevision,
        };
        let resource = envelope
          ? undefined
          : structuredClone(row.pristine_doc!);
        if (resource) resource.meta.publication = publication;
        if (ready) {
          published.add(row.url);
          if (retainsOutput) retained.add(row.url);
          // Store the large attribute body in the same transaction as its
          // provenance. Serving only serializes the small, dynamic envelope.
          phaseAt = Date.now();
          await tx(
            envelope
              ? [
                  `UPDATE lattice_owners SET attributes_json = (
                     SELECT (w.pristine_doc->'attributes')::text FROM boxel_index_working w
                      WHERE w.realm_url =`,
                  param(realmURL),
                  'AND w.url =',
                  param(row.url),
                  "AND w.type = 'instance' AND w.generation =",
                  param(generation),
                  '), attributes_generation =',
                  param(finalOutputGeneration),
                  'WHERE realm_url =',
                  param(realmURL),
                  'AND owner_url =',
                  param(row.url),
                ]
              : [
                  'UPDATE lattice_owners SET attributes_json =',
                  param(JSON.stringify(resource!.attributes) ?? null),
                  ', attributes_generation =',
                  param(finalOutputGeneration),
                  'WHERE realm_url =',
                  param(realmURL),
                  'AND owner_url =',
                  param(row.url),
                ],
          );
          timings.attributesMs += Date.now() - phaseAt;
        }
        phaseAt = Date.now();
        if (!replayPrevious)
          await tx(
            envelope
              ? [
                  "UPDATE boxel_index_working SET pristine_doc = jsonb_set(pristine_doc, '{meta,publication}',",
                  param(JSON.stringify(publication)),
                  '::jsonb), job_id = NULL, generation =',
                  param(finalOutputGeneration),
                  'WHERE realm_url =',
                  param(realmURL),
                  'AND url =',
                  param(row.url),
                  "AND type = 'instance' AND generation =",
                  param(generation),
                ]
              : [
                  'UPDATE boxel_index_working SET pristine_doc =',
                  param(JSON.stringify(resource)),
                  ', job_id = NULL, generation =',
                  param(finalOutputGeneration),
                  'WHERE realm_url =',
                  param(realmURL),
                  'AND url =',
                  param(row.url),
                  "AND type = 'instance' AND generation =",
                  param(generation),
                ],
          );
        timings.workingMs += Date.now() - phaseAt;
      } else if (
        previous?.pristine_doc?.meta.publication &&
        !prepared.retiringOwners.has(row.url)
      ) {
        if (row.is_deleted || !row.has_error) {
          await this.registry.publish(tx, {
            realmURL,
            ownerURL: row.url,
            generation,
            inputGeneration: generation,
            definitionRevision,
            watches: [],
            retired: true,
          });
        } else dirty.add(row.url);
      }
    }
    // Concrete dependencies supplement watches, including transitive inputs
    // whose fields a getter consumed without appearing in a query predicate.
    // Existing source passes already expand their dependency closure. This
    // handles a newly published feeder's outputs in a Lattice follow-up wave.
    let tailAt = Date.now();
    if (changed.size) {
      let changedURLs = [...changed];
      let owners = await tx([
        'SELECT o.owner_url FROM lattice_owners o JOIN boxel_index i ON i.realm_url = o.realm_url AND i.url = o.owner_url',
        "AND i.type = 'instance' WHERE o.realm_url =",
        param(realmURL),
        'AND o.retired = FALSE',
        'AND',
        dbExpression({
          pg: ['i.deps ?|', textArrayParam(changedURLs), '::text[]'],
          sqlite: [
            'EXISTS (SELECT 1 FROM json_each(i.deps) dependency JOIN json_each(',
            textArrayParam(changedURLs),
            ') changed ON dependency.value = changed.value)',
          ],
        }),
      ]);
      for (let owner of owners) {
        dirty.add(owner.owner_url as string);
      }
    }
    timings.depsMs = Date.now() - tailAt;
    tailAt = Date.now();
    // A successful owner in this wave was computed from the previous revision.
    // If another output it consumes changed in the wave, it must run again.
    await this.registry.markDirty(tx, realmURL, [...dirty], generation);
    timings.dirtyMs = Date.now() - tailAt;
    tailAt = Date.now();
    if (this.db.kind === 'pg') {
      for (let ownerURL of published) {
        await recordLatticePublication(
          tx,
          {
            realmURL,
            ownerURL,
            realmGeneration: generation,
          },
          'index',
        );
      }
    }
    timings.outboxMs = Date.now() - tailAt;
    if (envelope)
      perfLog.debug(
        `Lattice publication commit ${JSON.stringify({ ...timings, generation })}`,
      );
    // A retry after this commit must discover durable dirty owners, not resume
    // and re-promote an already committed source pass under its old generation.
    if (!replayPrevious)
      await tx([
        'UPDATE boxel_index_working SET job_id = NULL WHERE realm_url =',
        param(realmURL),
        'AND generation =',
        param(generation),
      ]);
    if (skipped.length)
      console.log(
        `Lattice wave left ${skipped.length} obsolete owner(s) for the next wave: ${skipped.join(', ')}`,
      );
    return retained;
  }
}

function latticeDocument(
  row: BoxelIndexTable | undefined,
): LatticeDocument | undefined {
  return row && !row.is_deleted && row.search_doc
    ? { url: row.url, types: row.types ?? [], search_doc: row.search_doc }
    : undefined;
}

// The envelope-mode equivalent of comparing `latticeSemanticRow`s: the body
// (everything but `meta.publication`) was compared in Postgres; the small
// parts are compared here.
function latticeEnvelopeRowsEqual(
  previous: BoxelIndexTable | undefined,
  row: BoxelIndexTable,
  sameBody: boolean | undefined,
): boolean {
  let previousDeleted = !previous || previous.is_deleted;
  let rowDeleted = row.is_deleted;
  if (previousDeleted || rowDeleted)
    return Boolean(previousDeleted && rowDeleted);
  if (!sameBody) return false;
  const coverage = (candidate: BoxelIndexTable) => {
    let publication = candidate.pristine_doc?.meta.publication;
    return publication
      ? [publication.computedFields, publication.queryFields]
      : null;
  };
  return (
    Boolean(previous!.has_error) === Boolean(row.has_error) &&
    stringify(coverage(previous!)) === stringify(coverage(row)) &&
    stringify(previous!.search_doc) === stringify(row.search_doc) &&
    stringify(previous!.types) === stringify(row.types)
  );
}

function latticeSemanticRow(row: BoxelIndexTable | undefined): string {
  if (!row || row.is_deleted) return 'deleted';
  let resource = row.pristine_doc ? structuredClone(row.pristine_doc) : null;
  const coverage = resource?.meta.publication;
  if (resource?.meta) delete resource.meta.publication;
  return stringify([
    Boolean(row.has_error),
    coverage ? [coverage.computedFields, coverage.queryFields] : null,
    resource,
    row.search_doc,
    row.types,
  ])!;
}
