import type { DBAdapter } from './db.ts';
import { param, query, type Querier } from './expression.ts';
import type { LooseCardResource } from './resource-types.ts';
import { indexingConcurrencyGroup } from './jobs/indexing.ts';
import { assertLatticeOwnerCodes } from './lattice-code-reference.ts';
import {
  createLatticeRenderCheckpoint,
  validateLatticeRenderCheckpoint,
  type LatticeRenderCheckpoint,
  type LatticeRenderReceipt,
} from './lattice-render-checkpoint.ts';

export interface LatticeRenderAuthority {
  version: 1;
  realmURL: string;
  ownerURL: string;
  realmGeneration: number;
  indexedGeneration: number;
  publishedGeneration: number;
  definitionRevision: string;
  loaderEpoch: string;
}

export type LatticeRenderInput =
  | { status: 'unmanaged' | 'retired' | 'pending' }
  | {
      status: 'ready';
      authority: LatticeRenderAuthority;
      checkpoint: LatticeRenderCheckpoint;
    };

interface AuthorityRow {
  owner_url: string;
  retired: boolean;
  dirty_generation: number | string | null;
  published_generation: number | string;
  definition_revision: string;
  current_generation: number | string;
  loader_epoch: string;
  code_current: boolean;
  indexed_generation: number | string | null;
  is_deleted: boolean | null;
  has_error: boolean | null;
  unsettled: boolean;
  pristine_doc?: LooseCardResource;
}

// One statement sees the owner, committed data and pending-source barrier in
// the same database snapshot. Only producer capture requests the wide document;
// commit validation touches metadata alone.
async function readAuthority(
  tx: Querier,
  realmURL: string,
  ownerURL: string,
  includeDocument: boolean,
): Promise<AuthorityRow | undefined> {
  let [row] = await tx([
    `SELECT o.owner_url, o.retired, o.dirty_generation, o.published_generation,
       o.definition_revision, r.current_generation, r.loader_epoch,
       lattice_owner_code_current(o.realm_url,o.owner_url,r.loader_epoch) AS code_current,
       i.generation AS indexed_generation, i.is_deleted, i.has_error,`,
    ...(includeDocument ? ['i.pristine_doc,'] : []),
    `((EXISTS (SELECT 1 FROM lattice_pending_generations p WHERE p.realm_url = o.realm_url))
       OR (EXISTS (SELECT 1 FROM jobs j WHERE j.concurrency_group =`,
    param(indexingConcurrencyGroup(realmURL)),
    `AND j.job_type <> 'lattice-materialize' AND j.status = 'unfulfilled'))
       OR ((SELECT j.status FROM jobs j WHERE j.concurrency_group =`,
    param(indexingConcurrencyGroup(realmURL)),
    `AND j.job_type <> 'lattice-materialize' ORDER BY j.id DESC LIMIT 1) = 'rejected')) AS unsettled
     FROM lattice_owners o
     LEFT JOIN realm_generations r ON r.realm_url = o.realm_url
     LEFT JOIN boxel_index i ON i.realm_url = o.realm_url
       AND i.url = o.owner_url AND i.type = 'instance'
     WHERE o.realm_url =`,
    param(realmURL),
    'AND o.owner_url =',
    param(ownerURL),
  ]);
  return row as unknown as AuthorityRow | undefined;
}

function authorityFor(
  row: AuthorityRow | undefined,
  realmURL: string,
): Exclude<LatticeRenderInput, { status: 'ready' }> | LatticeRenderAuthority {
  if (!row) return { status: 'unmanaged' };
  if (row.retired || row.is_deleted) return { status: 'retired' };
  let realmGeneration = Number(row.current_generation);
  let indexedGeneration = Number(row.indexed_generation);
  let publishedGeneration = Number(row.published_generation);
  if (
    row.unsettled ||
    row.dirty_generation != null ||
    row.has_error ||
    row.indexed_generation == null ||
    !Number.isSafeInteger(realmGeneration) ||
    realmGeneration < 1 ||
    !Number.isSafeInteger(indexedGeneration) ||
    indexedGeneration < 1 ||
    !Number.isSafeInteger(publishedGeneration) ||
    publishedGeneration < 1 ||
    realmGeneration < indexedGeneration ||
    indexedGeneration !== publishedGeneration ||
    !row.definition_revision ||
    !row.code_current ||
    !row.loader_epoch
  )
    return { status: 'pending' };
  return {
    version: 1,
    realmURL,
    ownerURL: row.owner_url,
    realmGeneration,
    indexedGeneration,
    publishedGeneration,
    definitionRevision: row.definition_revision,
    loaderEpoch: row.loader_epoch,
  };
}

export async function captureLatticeRenderInput(
  db: DBAdapter,
  realmURL: string,
  id: string,
): Promise<LatticeRenderInput> {
  if (db.kind !== 'pg')
    throw new Error('Native render authority requires PostgreSQL');
  let ownerURL = id.endsWith('.json') ? id : `${id}.json`;
  let row = await readAuthority(
    (expression) => query(db, expression),
    realmURL,
    ownerURL,
    true,
  );
  let authority = authorityFor(row, realmURL);
  if ('status' in authority) return authority;
  if (!row?.pristine_doc) return { status: 'pending' };
  let checkpoint = await createLatticeRenderCheckpoint(
    { data: row.pristine_doc },
    realmURL,
    authority.loaderEpoch,
  );
  if (
    checkpoint.document.data.meta.publication?.outputRevision !==
      authority.publishedGeneration ||
    checkpoint.document.data.meta.publication?.definitionRevision !==
      authority.definitionRevision
  ) {
    return { status: 'pending' };
  }
  return { status: 'ready', authority, checkpoint };
}

// This is a committed-index fence, not proof of an immutable module closure.
// The native producer still needs module/theme/context admission. Its realm
// generation check is deliberately conservative until those dependencies have
// separate authority versions. Never turn a failed check into a fresh artifact.
// The callback MUST use its supplied transaction for artifact/outbox writes.
export async function withLatticeRenderAuthority<T>(
  db: DBAdapter,
  input: Extract<LatticeRenderInput, { status: 'ready' }>,
  receipt: LatticeRenderReceipt,
  commit: (tx: Querier) => Promise<T>,
): Promise<
  | { published: true; value: T }
  | {
      published: false;
      reason: 'superseded' | 'pending' | 'retired' | 'unmanaged';
    }
> {
  if (db.kind !== 'pg')
    throw new Error('Native render authority requires PostgreSQL');
  // Freeze caller-owned input across awaits; the metadata checked in the lock
  // must be exactly the input that was validated outside it.
  let captured = structuredClone(input);
  let expected = await validateLatticeRenderCheckpoint(captured.checkpoint, {
    id: captured.authority.ownerURL,
    realmURL: captured.authority.realmURL,
    loaderEpoch: captured.authority.loaderEpoch,
  });
  if (
    expected.version !== receipt.version ||
    expected.id !== receipt.id ||
    expected.realmURL !== receipt.realmURL ||
    expected.documentHash !== receipt.documentHash ||
    expected.publishedGeneration !== receipt.publishedGeneration ||
    expected.definitionRevision !== receipt.definitionRevision ||
    expected.loaderEpoch !== receipt.loaderEpoch ||
    expected.publishedGeneration !== captured.authority.publishedGeneration
  ) {
    throw new Error(
      'Lattice renderer did not consume the captured publication',
    );
  }
  return db.withWriteLock(
    `lattice:index:${captured.authority.realmURL}`,
    async (tx) => {
      if (!tx)
        throw new Error('Lattice publication requires a pinned transaction');
      let latest = authorityFor(
        await readAuthority(
          tx,
          captured.authority.realmURL,
          captured.authority.ownerURL,
          false,
        ),
        captured.authority.realmURL,
      );
      if ('status' in latest)
        return { published: false, reason: latest.status };
      if (
        latest.version !== captured.authority.version ||
        latest.realmGeneration !== captured.authority.realmGeneration ||
        latest.indexedGeneration !== captured.authority.indexedGeneration ||
        latest.publishedGeneration !== captured.authority.publishedGeneration ||
        latest.definitionRevision !== captured.authority.definitionRevision ||
        latest.loaderEpoch !== captured.authority.loaderEpoch
      ) {
        return { published: false, reason: 'superseded' };
      }
      await assertLatticeOwnerCodes(tx, captured.authority.realmURL, [
        captured.authority.ownerURL,
      ]);
      return { published: true, value: await commit(tx) };
    },
  );
}
