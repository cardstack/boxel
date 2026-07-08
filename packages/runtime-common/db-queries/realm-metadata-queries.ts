// Read/write helpers for the owner-controlled realm archive flag stored
// on realm_metadata.archived_at (NULL = active, non-null = archived at
// that timestamp).
import type { DBAdapter } from '../db.ts';
import { dbExpression, param, query } from '../expression.ts';

// `now()` is Postgres-only; SQLite spells it `CURRENT_TIMESTAMP`. These
// helpers are a shared runtime-common API, so render the timestamp
// per-adapter rather than baking in a single dialect.
const now = dbExpression({ pg: 'now()', sqlite: 'CURRENT_TIMESTAMP' });

// Mark a realm archived. Upserts the realm_metadata row so a realm that
// never had a metadata row (no other flags ever set) can still be
// archived. Re-archiving an already-archived realm refreshes the
// timestamp.
export async function archiveRealm(dbAdapter: DBAdapter, realmURL: URL) {
  await query(dbAdapter, [
    `INSERT INTO realm_metadata (url, archived_at) VALUES (`,
    param(realmURL.href),
    `,`,
    now,
    `) ON CONFLICT (url) DO UPDATE SET archived_at =`,
    now,
    `, updated_at =`,
    now,
  ]);
}

// Clear the archive flag, returning a realm to active. Upserts so the
// call is idempotent even when no metadata row exists yet.
export async function unarchiveRealm(dbAdapter: DBAdapter, realmURL: URL) {
  await query(dbAdapter, [
    `INSERT INTO realm_metadata (url, archived_at) VALUES (`,
    param(realmURL.href),
    `, NULL) ON CONFLICT (url) DO UPDATE SET archived_at = NULL, updated_at =`,
    now,
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

export interface ArchivedRealm {
  url: string;
  // The archived_at timestamp as the adapter returns it (ISO-ish string).
  archivedAt: string;
}

// List the archived realms owned by a user, most-recently-archived first.
// Joins archived realm_metadata rows to realm_user_permissions where the
// user holds the realm-owner permission. Published snapshots are excluded:
// publishing grants the owner realm-owner on the published URL too, so
// without this filter an archived snapshot would surface as one of the
// user's workspaces.
export async function fetchArchivedRealmsForOwner(
  dbAdapter: DBAdapter,
  username: string,
): Promise<ArchivedRealm[]> {
  let results = (await query(dbAdapter, [
    `SELECT rm.url, rm.archived_at
     FROM realm_metadata rm
     INNER JOIN realm_user_permissions rup ON rup.realm_url = rm.url
     WHERE rm.archived_at IS NOT NULL
       AND rup.realm_owner = true
       AND rm.url NOT IN (SELECT url FROM realm_registry WHERE kind = 'published')
       AND rup.username =`,
    param(username),
    // Secondary sort on url keeps ordering deterministic when several realms
    // share an archived_at second (SQLite's CURRENT_TIMESTAMP is 1s-resolution).
    `ORDER BY rm.archived_at DESC, rm.url ASC`,
  ])) as { url: string; archived_at: string }[];
  return results.map((r) => ({ url: r.url, archivedAt: r.archived_at }));
}
