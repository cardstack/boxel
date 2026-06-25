// Read/write helpers for the owner-controlled realm archive flag stored
// on realm_metadata.archived_at (NULL = active, non-null = archived at
// that timestamp).
import type { DBAdapter } from '../db.ts';
import { param, query } from '../expression.ts';

// Mark a realm archived. Upserts the realm_metadata row so a realm that
// never had a metadata row (no other flags ever set) can still be
// archived. Re-archiving an already-archived realm refreshes the
// timestamp.
export async function archiveRealm(dbAdapter: DBAdapter, realmURL: URL) {
  await query(dbAdapter, [
    `INSERT INTO realm_metadata (url, archived_at) VALUES (`,
    param(realmURL.href),
    `, now()) ON CONFLICT (url) DO UPDATE SET archived_at = now(), updated_at = now()`,
  ]);
}

// Clear the archive flag, returning a realm to active. Upserts so the
// call is idempotent even when no metadata row exists yet.
export async function unarchiveRealm(dbAdapter: DBAdapter, realmURL: URL) {
  await query(dbAdapter, [
    `INSERT INTO realm_metadata (url, archived_at) VALUES (`,
    param(realmURL.href),
    `, NULL) ON CONFLICT (url) DO UPDATE SET archived_at = NULL, updated_at = now()`,
  ]);
}

export async function isRealmArchived(
  dbAdapter: DBAdapter,
  realmURL: URL,
): Promise<boolean> {
  let results = (await query(dbAdapter, [
    `SELECT archived_at FROM realm_metadata WHERE url =`,
    param(realmURL.href),
  ])) as { archived_at: string | null }[];
  return results.length > 0 && results[0].archived_at != null;
}

// List the URLs of archived realms owned by a user. Joins archived
// realm_metadata rows to realm_user_permissions where the user holds the
// realm-owner permission.
export async function fetchArchivedRealmsForOwner(
  dbAdapter: DBAdapter,
  username: string,
): Promise<string[]> {
  let results = (await query(dbAdapter, [
    `SELECT rm.url
     FROM realm_metadata rm
     INNER JOIN realm_user_permissions rup ON rup.realm_url = rm.url
     WHERE rm.archived_at IS NOT NULL
       AND rup.realm_owner = true
       AND rup.username =`,
    param(username),
    `ORDER BY rm.archived_at DESC`,
  ])) as { url: string }[];
  return results.map((r) => r.url);
}
