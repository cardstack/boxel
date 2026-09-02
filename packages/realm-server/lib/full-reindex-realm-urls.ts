import type { DBAdapter } from '@cardstack/runtime-common';
import { baseRealm, param, query } from '@cardstack/runtime-common';

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
// here is its position in the queue. The base realm sorts first, then the rest of the bootstrap realms, then
// everything else, because every other realm's cards import from base and the
// bootstrap realms are what they import from next.
//
// Url order alone works against that at both levels. Base is addressed at
// `https://cardstack.com/base/`, which sorts behind every `app.boxel.ai` /
// `boxel.site` / `boxel.space` realm — the back of a fleet-wide sweep. And it
// sorts behind its own siblings too: a bootstrap realm configured with a
// non-url `--fromUrl` (`@cardstack/catalog/`, `@cardstack/skills/`) is
// registered under the server's own host, so `app.boxel.ai/catalog/` precedes
// `cardstack.com/base/`. Anchoring base explicitly is what makes this ordering
// the safety net it is meant to be for a deployment whose only worker pool
// floors at the system tier, where the priority tier cannot help.
export async function getFullReindexRealmUrls(dbAdapter: DBAdapter) {
  let rows = (await query(dbAdapter, [
    `SELECT url FROM realm_registry
     WHERE url NOT IN (SELECT url FROM realm_metadata WHERE archived_at IS NOT NULL)
     ORDER BY (url =`,
    param(baseRealm.url),
    `) DESC, (kind = 'bootstrap') DESC, url`,
  ])) as RealmRegistryRow[];

  return rows.map(({ url }) => url);
}
