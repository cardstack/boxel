import type { DBAdapter } from './db.ts';
import type { BoxelIndexTable } from './index-structure.ts';
import { coerceTypes } from './index-structure.ts';
import { param, query, type Querier } from './expression.ts';
import { assertTessarGeneration } from './tessar-materialization.ts';
import type {
  TessarQueryRegistry,
  TessarDocument,
  TessarPreparedWatch,
} from './tessar-query-registry.ts';

// IndexRunner prepares these outside the commit lock. The actual publication,
// watch replacement and dirty markers all use Batch.done's pinned transaction.
export class TessarIndexPublication {
  private db: DBAdapter;
  readonly registry: TessarQueryRegistry;
  constructor(db: DBAdapter, registry: TessarQueryRegistry) {
    this.db = db;
    this.registry = registry;
  }

  async prepare(realmURL: string, generation: number) {
    let active = await query(this.db, [
      'SELECT owner_url FROM tessar_owners WHERE realm_url =',
      param(realmURL),
      'AND retired = FALSE',
    ]);
    let rows = (await query(
      this.db,
      [
        'SELECT * FROM boxel_index_working WHERE realm_url =',
        param(realmURL),
        'AND generation =',
        param(generation),
        ...(active.length
          ? []
          : ["AND pristine_doc->'meta'->'tessar' IS NOT NULL"]),
      ],
      coerceTypes,
    )) as unknown as BoxelIndexTable[];
    let watches = new Map<string, TessarPreparedWatch[]>();
    for (let row of rows) {
      let manifest = row.pristine_doc?.meta.tessar;
      if (
        row.type === 'instance' &&
        !row.has_error &&
        !row.is_deleted &&
        manifest
      ) {
        watches.set(row.url, await this.registry.prepare(manifest.watches));
      }
    }
    return { rows, watches, hadOwners: active.length > 0 };
  }

  async commit(
    tx: Querier,
    args: {
      realmURL: string;
      generation: number;
      definitionRevision: string;
      prepared: Awaited<ReturnType<TessarIndexPublication['prepare']>>;
      inputGeneration?: number;
    },
  ): Promise<void> {
    let {
      realmURL,
      generation,
      definitionRevision,
      prepared,
      inputGeneration,
    } = args;
    // Even the no-watch fast path was prepared outside the lock. Another
    // publisher may have registered the realm's first owner since then; a
    // stale source must retry so that new watch participates in invalidation.
    await assertTessarGeneration(this.db, realmURL, generation - 1, tx);
    if (!prepared.rows.length && !prepared.hadOwners) return;
    if (inputGeneration !== undefined && inputGeneration !== generation - 1) {
      throw new Error('Tessar publication does not follow its input revision');
    }
    if (inputGeneration !== undefined) {
      let [realm] = await tx([
        'SELECT loader_epoch FROM realm_generations WHERE realm_url =',
        param(realmURL),
      ]);
      if (realm?.loader_epoch !== definitionRevision)
        throw new Error('Tessar definitions changed during computation');
    }
    let changed = new Set<string>();
    let dirty = new Set<string>();
    if (inputGeneration === undefined) {
      // The loader epoch is realm-wide. Even a module outside an owner's
      // recorded dependencies can change it; every older snapshot must get
      // work scheduled instead of remaining permanently pending at read time.
      let outdated = await tx([
        'SELECT owner_url FROM tessar_owners WHERE realm_url =',
        param(realmURL),
        'AND retired = FALSE AND definition_revision <>',
        param(definitionRevision),
      ]);
      for (let owner of outdated) dirty.add(owner.owner_url as string);
    }
    for (let row of prepared.rows) {
      if (row.type !== 'instance') continue;
      let [old] = await tx([
        'SELECT * FROM boxel_index WHERE realm_url =',
        param(realmURL),
        'AND url =',
        param(row.url),
        "AND type = 'instance'",
      ]);
      let previous = old as unknown as BoxelIndexTable | undefined;
      // Exclude only provenance from equality: membership and output changes
      // propagate to feeders; a recomputation with identical data does not.
      if (tessarSemanticRow(previous) !== tessarSemanticRow(row)) {
        changed.add(row.url);
        for (let owner of await this.registry.affected(
          realmURL,
          tessarDocument(previous),
          tessarDocument(row),
          tx,
        ))
          dirty.add(owner);
      }
      let manifest = row.pristine_doc?.meta.tessar;
      if (!row.has_error && !row.is_deleted && manifest) {
        if (
          inputGeneration !== undefined &&
          manifest.inputGeneration !== inputGeneration
        ) {
          throw new Error(
            'Tessar renderer returned a different input revision',
          );
        }
        let ready = inputGeneration !== undefined;
        if (
          !(await this.registry.publish(tx, {
            realmURL,
            ownerURL: row.url,
            generation,
            inputGeneration: inputGeneration ?? 0,
            definitionRevision,
            watches: prepared.watches.get(row.url)!,
            pending: !ready,
          }))
        )
          throw new Error('Tessar rejected an obsolete owner publication');
        let resource = structuredClone(row.pristine_doc!);
        resource.meta.tessar = {
          ...manifest,
          state: ready ? 'ready' : 'pending',
          publishedGeneration: generation,
          definitionRevision,
        };
        await tx([
          'UPDATE boxel_index_working SET pristine_doc =',
          param(JSON.stringify(resource)),
          'WHERE realm_url =',
          param(realmURL),
          'AND url =',
          param(row.url),
          "AND type = 'instance' AND generation =",
          param(generation),
        ]);
      } else if (previous?.pristine_doc?.meta.tessar) {
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
    // handles a newly published feeder's outputs in a Tessar follow-up wave.
    if (changed.size) {
      let owners = await tx([
        'SELECT o.owner_url, i.deps FROM tessar_owners o JOIN boxel_index i ON i.realm_url = o.realm_url AND i.url = o.owner_url',
        "AND i.type = 'instance' WHERE o.realm_url =",
        param(realmURL),
        'AND o.retired = FALSE',
      ]);
      for (let owner of owners) {
        let deps = (
          typeof owner.deps === 'string' ? JSON.parse(owner.deps) : owner.deps
        ) as string[] | null;
        if (deps?.some((dep) => changed.has(dep)))
          dirty.add(owner.owner_url as string);
      }
    }
    // A successful owner in this wave was computed from the previous revision.
    // If another output it consumes changed in the wave, it must run again.
    await this.registry.markDirty(tx, realmURL, [...dirty], generation);
    // A retry after this commit must discover durable dirty owners, not resume
    // and re-promote an already committed source pass under its old generation.
    await tx([
      'UPDATE boxel_index_working SET job_id = NULL WHERE realm_url =',
      param(realmURL),
      'AND generation =',
      param(generation),
    ]);
  }
}

function tessarDocument(
  row: BoxelIndexTable | undefined,
): TessarDocument | undefined {
  return row && !row.is_deleted && row.search_doc
    ? { url: row.url, types: row.types ?? [], search_doc: row.search_doc }
    : undefined;
}

function tessarSemanticRow(row: BoxelIndexTable | undefined): string {
  if (!row || row.is_deleted) return 'deleted';
  let resource = row.pristine_doc ? structuredClone(row.pristine_doc) : null;
  if (resource?.meta) delete resource.meta.tessar;
  return JSON.stringify([
    Boolean(row.has_error),
    resource,
    row.search_doc,
    row.types,
  ]);
}
