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
//
// The order is load-bearing, not cosmetic: `fullReindex` enqueues one
// from-scratch job per url in the order it receives them, and workers claim
// jobs within a priority pool in strict arrival order, so a realm's position
// here is its position in the queue. Bootstrap realms (base, catalog, skills,
// ...) sort ahead of the rest because every other realm's cards import from
// them. Url order alone works against that: `https://cardstack.com/base/`
// sorts behind every `app.boxel.ai` / `boxel.site` / `boxel.space` realm, so
// in a fleet-wide sweep the base realm lands last of hundreds of jobs — and a
// base-realm repair that takes milliseconds then waits out every other realm's
// reindex while realms linking a base card serve 500s.
export async function getFullReindexRealmUrls(dbAdapter: DBAdapter) {
  let rows = (await query(dbAdapter, [
    `SELECT url FROM realm_registry
     WHERE url NOT IN (SELECT url FROM realm_metadata WHERE archived_at IS NOT NULL)
     ORDER BY (kind = 'bootstrap') DESC, url`,
  ])) as RealmRegistryRow[];

  return rows.map(({ url }) => url);
}
