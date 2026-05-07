import type { DBAdapter } from '@cardstack/runtime-common';
import { query } from '@cardstack/runtime-common';

type RealmRegistryRow = {
  url: string;
};

export async function getFullReindexRealmUrls(dbAdapter: DBAdapter) {
  let rows = (await query(dbAdapter, [
    `SELECT url FROM realm_registry ORDER BY url`,
  ])) as RealmRegistryRow[];

  return rows.map(({ url }) => url);
}
