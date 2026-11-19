// The OAuth provider's daily cleanup: deletes the rows nothing can use any
// more, from its four tables. The `oauth-provider-cleanup` job runs it once a
// day for the whole environment (`cron-scheduler.ts`).
//
// Correctness never depends on it. A short-lived object or a token past its
// expiry, and a grant that has ended or expired, already read as missing,
// whether or not they have been deleted. The cleanup only saves space, with
// one exception: a client registered by dynamic client registration that it
// deletes is unknown from then on, and has to register again.
//
// - Short-lived objects and tokens are deleted once they expire. Their stores
//   delete expired rows too, but only while rows are being stored.
// - A grant is deleted 90 days after it ended, or after it expired if it was
//   never ended or ended later: a revocation ends grants that expired long
//   before, which doesn't restart their clock. Its tokens go with it.
// - A client registered by dynamic client registration that has no current
//   connection is deleted 7 days after it registered if it never connected,
//   and 30 days after its last connection ended if it did. A grant connects
//   its app once its code is exchanged. Pre-registered clients are
//   listed in code and a client ID metadata document is kept in memory, so
//   neither is ever here.

import type {
  DBAdapter,
  OAuthProviderCleanupResult,
} from '@cardstack/runtime-common';
import { EXCHANGED_GRANT, RENEWING_GRANT_TTL_SECONDS } from './grants.ts';

const DAY_SECONDS = 24 * 60 * 60;

export const ENDED_GRANT_RETENTION_SECONDS = 90 * DAY_SECONDS;
export const UNCONNECTED_CLIENT_RETENTION_SECONDS = 7 * DAY_SECONDS;
export const DISCONNECTED_CLIENT_RETENTION_SECONDS = 30 * DAY_SECONDS;

// Expired tokens are deleted this many at a time, so no one statement holds
// many row locks or runs long. Every other kind is deleted in one statement:
// the stores already keep short-lived objects few, and a grant's tokens are
// gone before the grant is.
const TOKEN_BATCH_SIZE = 5000;

// Runs the cleanup and answers what it deleted: short-lived objects and tokens
// by kind (the library's model name, or Boxel's own for an object the library
// doesn't know), then grants and clients.
export async function deleteExpiredOAuthProviderRows(
  dbAdapter: DBAdapter,
): Promise<OAuthProviderCleanupResult> {
  let objects = await deleteExpiredObjects(dbAdapter);
  let tokens = await deleteExpiredTokens(dbAdapter);
  let grants = await deleteEndedGrants(dbAdapter);
  let dynamicClients = await deleteUnusedDynamicClients(dbAdapter);
  return { objects, tokens, grants, dynamicClients };
}

async function deleteExpiredObjects(
  dbAdapter: DBAdapter,
): Promise<Record<string, number>> {
  let rows = (await dbAdapter.execute(
    `WITH deleted AS (
       DELETE FROM oauth_provider_objects
        WHERE expires_at <= now()
        RETURNING kind
     )
     SELECT kind, count(*) AS deleted FROM deleted GROUP BY kind`,
  )) as { kind: string; deleted: number | string }[];
  return byKind(rows);
}

async function deleteExpiredTokens(
  dbAdapter: DBAdapter,
): Promise<Record<string, number>> {
  let counts: Record<string, number> = {};
  for (;;) {
    // Rows another request is deleting are skipped, not waited for, as the
    // token store's own sweep does.
    let rows = (await dbAdapter.execute(
      `WITH deleted AS (
         DELETE FROM oauth_provider_tokens
          WHERE id_hash IN (
            SELECT id_hash FROM oauth_provider_tokens
             WHERE expires_at <= now()
             LIMIT $1
               FOR UPDATE SKIP LOCKED
          )
          RETURNING kind
       )
       SELECT kind, count(*) AS deleted FROM deleted GROUP BY kind`,
      { bind: [TOKEN_BATCH_SIZE] },
    )) as { kind: string; deleted: number | string }[];
    let batch = 0;
    for (let [kind, deleted] of Object.entries(byKind(rows))) {
      counts[kind] = (counts[kind] ?? 0) + deleted;
      batch += deleted;
    }
    if (batch < TOKEN_BATCH_SIZE) {
      return counts;
    }
  }
}

async function deleteEndedGrants(dbAdapter: DBAdapter): Promise<number> {
  let rows = await dbAdapter.execute(
    `DELETE FROM oauth_provider_grants
      WHERE LEAST(ended_at, expires_at) <= now() - make_interval(secs => $1)
      RETURNING 1`,
    { bind: [ENDED_GRANT_RETENTION_SECONDS] },
  );
  return rows.length;
}

// A client that never connected has no `last_connected_at`, and no exchanged
// grant. A connected client's last connection ended when its latest
// exchanged grant ended. Once its grants have been deleted (with their user,
// say), it is taken to have ended as late as it could have: as long after
// the client was last marked connected as a renewing grant lasts.
//
// `markGrantExchanged` marks a client connected in the statement that marks
// the exchange. A delete that reaches the client's row after that update
// re-checks the row's own columns against the new `last_connected_at`,
// though not what the subqueries read, and every rule requires that column
// to be missing or old, so the client is kept. Nothing else holds a client
// against a delete already under way:
// - A delete that reaches the row first deletes it, and the exchange that
//   was marking it leaves an app holding tokens for a client the provider no
//   longer knows. Its first refresh is refused with `invalid_client`.
// - A grant not yet exchanged keeps its client under neither rule, so a
//   delete between a flow's consent and its code exchange ends that flow.
//   `createGrant` refuses a flow whose client is already gone, but its check
//   is a plain read, so a delete under way can pass it.
// Either way one flow or connection is lost, for a client unused for 7 or 30
// days, and the app registers again.
async function deleteUnusedDynamicClients(
  dbAdapter: DBAdapter,
): Promise<number> {
  let rows = await dbAdapter.execute(
    `DELETE FROM oauth_provider_dynamic_clients AS c
      WHERE NOT EXISTS (
              SELECT 1 FROM oauth_provider_grants AS g
               WHERE g.client_id = c.client_id
                 AND g.ended_at IS NULL
                 AND g.expires_at > now()
                 AND ${EXCHANGED_GRANT}
            )
        AND (
              (c.last_connected_at IS NULL
               AND c.created_at <= now() - make_interval(secs => $1)
               AND NOT EXISTS (
                     SELECT 1 FROM oauth_provider_grants AS g
                      WHERE g.client_id = c.client_id
                        AND ${EXCHANGED_GRANT}
                   ))
           OR ((c.last_connected_at IS NULL
                OR c.last_connected_at <= now() - make_interval(secs => $2))
               AND COALESCE(
                     (SELECT max(LEAST(g.ended_at, g.expires_at))
                        FROM oauth_provider_grants AS g
                       WHERE g.client_id = c.client_id
                         AND ${EXCHANGED_GRANT}),
                     c.last_connected_at + make_interval(secs => $3)
                   ) <= now() - make_interval(secs => $2))
            )
      RETURNING 1`,
    {
      bind: [
        UNCONNECTED_CLIENT_RETENTION_SECONDS,
        DISCONNECTED_CLIENT_RETENTION_SECONDS,
        RENEWING_GRANT_TTL_SECONDS,
      ],
    },
  );
  return rows.length;
}

function byKind(
  rows: { kind: string; deleted: number | string }[],
): Record<string, number> {
  return Object.fromEntries(
    rows.map(({ kind, deleted }) => [kind, Number(deleted)]),
  );
}
