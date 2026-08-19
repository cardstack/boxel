import type { DBAdapter } from '@cardstack/runtime-common';
import { query } from '@cardstack/runtime-common';

type RealmRegistryRow = {
  url: string;
};

// The system-wide full-reindex source list. Archived realms are sealed and
// their contents can't drift while archived, so the sweep skips them — a
// realm rejoins this list when unarchive clears archived_at, and the
// unarchive handler separately enqueues the one-time reindex that brings
// boxel_index back up to date.
export async function getFullReindexRealmUrls(dbAdapter: DBAdapter) {
  let rows = (await query(dbAdapter, [
    `SELECT url FROM realm_registry
     WHERE url NOT IN (SELECT url FROM realm_metadata WHERE archived_at IS NOT NULL)
     ORDER BY url`,
  ])) as RealmRegistryRow[];

  return rows.map(({ url }) => url);
}
