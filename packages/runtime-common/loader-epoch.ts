import { v4 as uuidv4 } from '@lukeed/uuid';
import type { DBAdapter } from './db.ts';
import {
  addExplicitParens,
  param,
  query,
  separatedByCommas,
  type Expression,
} from './expression.ts';
import type { RealmGenerationsTable } from './index-structure.ts';

// `realm_generations.loader_epoch` is the token a prerender tab uses to decide
// when the modules it has already evaluated belong to a superseded timeline:
// a render threads the realm's epoch, and the route resets that tab's loader
// whenever the threaded value differs from the one it last cleared for. The
// column's original writer is the index pass — `IndexWriter.loaderEpoch` mints
// a fresh token whenever a batch's invalidation set contains an executable —
// which covers a tab that has to re-render a module after indexing observed
// the edit.
//
// It does not cover the window before that: a module's bytes change at write
// time, and everything that resolves a definition in the meantime (the whole
// of it on the deferred-indexing paths) prerenders that module against
// whatever a warm tab still holds. The prerendered definition is derived from
// the pre-write module, cached under the post-write module's URL, and outlives
// the write — the same staleness the write-time definition-cache invalidation
// exists to remove, reinstated one layer down. So the write path mints an
// epoch too, at the point the bytes change.

// Mint a fresh loader epoch for `realmURL` and return it. Called by the write
// path once per batch that carries at least one module: the token's only
// meaning is "different from what a tab may be holding", so one per batch is
// enough no matter how many modules the batch rewrites, and minting per file
// would cost a warm tab one loader reset per file.
//
// The insert covers a realm whose first module write lands before any index
// pass has committed a `realm_generations` row. `current_generation` is only
// in the column list to satisfy the insert; the conflict clause deliberately
// leaves it alone so this never disturbs the generation counter an index pass
// owns.
export async function mintRealmLoaderEpoch(
  dbAdapter: DBAdapter,
  realmURL: string,
): Promise<string> {
  let loaderEpoch = uuidv4();
  await query(dbAdapter, [
    'INSERT INTO realm_generations (realm_url, current_generation, loader_epoch) VALUES',
    ...(addExplicitParens(
      separatedByCommas([[param(realmURL)], [param(0)], [param(loaderEpoch)]]),
    ) as Expression),
    'ON CONFLICT ON CONSTRAINT realm_generations_pkey DO UPDATE SET loader_epoch=EXCLUDED.loader_epoch',
  ] as Expression);
  return loaderEpoch;
}

// The realm's committed loader epoch, or the `'0'` no-epoch-yet sentinel for a
// realm that has neither indexed nor had a module written. Threading the
// sentinel rather than nothing is deliberate: a tab holding no epoch at all
// mismatches every value, so the first module render against a realm
// synchronizes the tab either way.
export async function readRealmLoaderEpoch(
  dbAdapter: DBAdapter,
  realmURL: string,
): Promise<string> {
  let [row] = (await query(dbAdapter, [
    'SELECT loader_epoch FROM realm_generations WHERE realm_url =',
    param(realmURL),
  ] as Expression)) as Pick<RealmGenerationsTable, 'loader_epoch'>[];
  return row?.loader_epoch ?? '0';
}
