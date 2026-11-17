// The provider's OAuth grants, in `oauth_provider_grants` (ADR 021 §1.3): one
// for each consent, never merged into, widened or replaced by a later one.
//
// Boxel creates every grant itself, when a flow finishes (`finish.ts`), with
// the renewal choice its consent recorded and the expiry that choice sets
// (§1.9), in one statement. The library reads a grant through `GrantAdapter`
// (`adapter.ts`), and ends one only through `endGrant`.

import { randomBytes } from 'crypto';
import { logger, type DBAdapter } from '@cardstack/runtime-common';
import { isDynamicClientId } from './dynamic-client-id.ts';

const log = logger('boxel:oauth-provider');

// How long a grant lasts from its consent: 30 days when the user chose to
// keep the connection, 60 minutes when not (ADR 021 §1.9).
export const RENEWING_GRANT_TTL_SECONDS = 30 * 24 * 60 * 60;
export const NON_RENEWING_GRANT_TTL_SECONDS = 60 * 60;

// Why a grant ended (`ended_reason`, ADR 021 §1.9): the user disconnected it,
// its client revoked one of its tokens, one of its codes or refresh tokens
// was used again, or the user's OAuth grants were revoked with their
// sessions.
export type GrantEndReason = 'user' | 'client' | 'reuse' | 'sessions-revoked';

export interface NewGrant {
  // The user's internal ID (`users.id`), never their Matrix ID.
  userId: string;
  clientId: string;
  // Resource identifier to the scopes approved there.
  resources: Record<string, string[]>;
  renewing: boolean;
  // When the user consented, which is when the grant counts as created,
  // and what its expiry is measured from: a revocation between the consent
  // and the end of the flow covers the grant.
  consentedAt: Date;
}

// Stores a new grant and answers its ID. When the grant's client was
// registered by dynamic client registration and the daily cleanup has since
// deleted it (`cleanup.ts`), no grant is stored, and the answer is undefined:
// a grant is never created for a client the provider no longer knows. The
// client counts as connected only once the grant's code is exchanged
// (`markGrantExchanged`).
export async function createGrant(
  dbAdapter: DBAdapter,
  { userId, clientId, resources, renewing, consentedAt }: NewGrant,
): Promise<string | undefined> {
  let id = randomBytes(32).toString('base64url');
  let rows = await dbAdapter.execute(
    `INSERT INTO oauth_provider_grants
       (id, user_id, client_id, resources, renewing, created_at, expires_at)
       SELECT $1::varchar, $2::uuid, $3::varchar, $4::jsonb, $5::boolean,
              $6::timestamptz, $6::timestamptz + make_interval(secs => $7)
        WHERE NOT $8::boolean
           OR EXISTS (
                SELECT 1 FROM oauth_provider_dynamic_clients
                 WHERE client_id = $3::varchar
              )
       RETURNING id`,
    {
      bind: [
        id,
        userId,
        clientId,
        JSON.stringify(resources),
        renewing,
        consentedAt.toISOString(),
        renewing ? RENEWING_GRANT_TTL_SECONDS : NON_RENEWING_GRANT_TTL_SECONDS,
        isDynamicClientId(clientId),
      ],
    },
  );
  return rows.length > 0 ? id : undefined;
}

// Records that a grant connected its app: the first time a token is stored
// for it, which is when its code is exchanged (`exchanged_at`). A client
// registered by dynamic client registration is marked connected then too
// (`last_connected_at`), in the same statement, which the daily cleanup reads
// (`cleanup.ts`). A cleanup that meets that update re-checks the client's own
// row and keeps it. Later stores find the grant already marked and change
// nothing.
export async function markGrantExchanged(
  dbAdapter: DBAdapter,
  grantId: string,
): Promise<void> {
  await dbAdapter.execute(
    `WITH exchanged AS (
       UPDATE oauth_provider_grants
          SET exchanged_at = now()
        WHERE id = $1 AND exchanged_at IS NULL
        RETURNING client_id
     )
     UPDATE oauth_provider_dynamic_clients
        SET last_connected_at = now()
      WHERE client_id IN (SELECT client_id FROM exchanged)`,
    { bind: [grantId] },
  );
}

// What a grant decides about the tokens issued from it: whether it renews,
// and when it expires (epoch seconds).
export interface GrantTerms {
  renewing: boolean;
  expiresAt: number;
}

// The terms of a user's grant, by its ID: undefined when no such grant is
// that user's. Whether the grant may still be used is `GrantAdapter`'s check.
export async function readGrantTerms(
  dbAdapter: DBAdapter,
  grantId: string,
  userId: string,
): Promise<GrantTerms | undefined> {
  let [row] = (await dbAdapter.execute(
    `SELECT renewing, floor(extract(epoch FROM expires_at)) AS expires
       FROM oauth_provider_grants
      WHERE id = $1 AND user_id::text = $2`,
    { bind: [grantId, userId] },
  )) as { renewing: boolean; expires: number | string }[];
  return row
    ? { renewing: row.renewing, expiresAt: Number(row.expires) }
    : undefined;
}

// Ends a grant, keeping its row with when and why (ADR 021 §1.2), and deletes
// its tokens. A grant ends once: a grant already ended keeps its first
// reason. Answers whether this call ended it.
//
// The tokens are deleted by a second statement, after the grant's row is
// updated, so that it sees a token whose store held the row while the update
// waited for it; one statement would read the tokens as they were when it
// began.
export async function endGrant(
  dbAdapter: DBAdapter,
  grantId: string,
  reason: GrantEndReason,
): Promise<boolean> {
  let rows = await dbAdapter.execute(
    `UPDATE oauth_provider_grants
        SET ended_at = now(), ended_reason = $2
      WHERE id = $1 AND ended_at IS NULL
      RETURNING id`,
    { bind: [grantId, reason] },
  );
  await dbAdapter.execute(
    `DELETE FROM oauth_provider_tokens WHERE grant_id = $1`,
    { bind: [grantId] },
  );
  let ended = rows.length > 0;
  if (ended) {
    log.info(`grant ended: ${reason}`);
  }
  return ended;
}

// Revokes a user's OAuth grants (ADR 021 §1.9): records the cutoff, so that
// any grant created at or before it is refused wherever it is next used, and
// ends every grant already created by then, in one statement, then deletes
// their tokens in a second, as `endGrant` does. The cutoff never moves
// earlier. `cutoff` is now unless given. A user with no row has no grant to
// revoke.
//
// Called on the first revocation after a password change, never on the
// later one that covers Matrix OpenID tokens, since an OpenID token can't
// create a grant. An operator's revocation of the user's sessions does the
// same with them, through `revokeUserSessionsAndOAuthGrants`.
export async function revokeUserOAuthGrants(
  dbAdapter: DBAdapter,
  matrixUserId: string,
  cutoff?: Date,
): Promise<number> {
  let rows = (await dbAdapter.execute(
    `WITH revoked AS (
       UPDATE users
          SET oauth_grants_revoked_at = GREATEST(
                oauth_grants_revoked_at,
                COALESCE($2::timestamptz, now())
              )
        WHERE matrix_user_id = $1
        RETURNING id, oauth_grants_revoked_at
     ), ended AS (
       UPDATE oauth_provider_grants AS g
          SET ended_at = now(), ended_reason = 'sessions-revoked'
         FROM revoked
        WHERE g.user_id = revoked.id
          AND g.ended_at IS NULL
          AND g.created_at <= revoked.oauth_grants_revoked_at
        RETURNING g.id
     )
     SELECT id FROM ended`,
    { bind: [matrixUserId, cutoff ? cutoff.toISOString() : null] },
  )) as { id: string }[];
  return await deleteRevokedGrantsTokens(
    dbAdapter,
    rows.map(({ id }) => id),
  );
}

// An operator's revocation of a user's sessions (ADR 021 §1.9), which also
// revokes their OAuth grants as `revokeUserOAuthGrants` does. Both are
// recorded, and the grants ended, in one statement at one instant, so
// neither happens without the other. Like `revokeUserSessions`, it records
// the revocation for a user who has no row yet. Resolves to the sessions'
// revocation instant, in epoch seconds.
export async function revokeUserSessionsAndOAuthGrants(
  dbAdapter: DBAdapter,
  matrixUserId: string,
): Promise<number> {
  let [row] = (await dbAdapter.execute(
    `WITH revoked AS (
       INSERT INTO users
         (matrix_user_id, sessions_revoked_at, oauth_grants_revoked_at)
         VALUES ($1, EXTRACT(EPOCH FROM now())::bigint, now())
       ON CONFLICT (matrix_user_id) DO UPDATE
         SET sessions_revoked_at = EXCLUDED.sessions_revoked_at,
             oauth_grants_revoked_at = GREATEST(
               users.oauth_grants_revoked_at,
               EXCLUDED.oauth_grants_revoked_at
             )
       RETURNING id, sessions_revoked_at, oauth_grants_revoked_at
     ), ended AS (
       UPDATE oauth_provider_grants AS g
          SET ended_at = now(), ended_reason = 'sessions-revoked'
         FROM revoked
        WHERE g.user_id = revoked.id
          AND g.ended_at IS NULL
          AND g.created_at <= revoked.oauth_grants_revoked_at
        RETURNING g.id
     )
     SELECT revoked.sessions_revoked_at,
            ARRAY(SELECT id FROM ended) AS ended
       FROM revoked`,
    { bind: [matrixUserId] },
  )) as { sessions_revoked_at: string | number; ended: string[] }[];
  if (row?.sessions_revoked_at == null) {
    throw new Error(
      `revokeUserSessionsAndOAuthGrants: failed to record revocation for matrix_user_id="${matrixUserId}"`,
    );
  }
  await deleteRevokedGrantsTokens(dbAdapter, row.ended);
  return Number(row.sessions_revoked_at);
}

// Deletes the tokens of grants a revocation ended, in a statement after the
// one that ended them, as `endGrant` does.
async function deleteRevokedGrantsTokens(
  dbAdapter: DBAdapter,
  grantIds: string[],
): Promise<number> {
  if (grantIds.length > 0) {
    await dbAdapter.execute(
      `DELETE FROM oauth_provider_tokens WHERE grant_id = ANY($1::varchar[])`,
      { bind: [grantIds] },
    );
    log.info(`grants ended: sessions-revoked, ${grantIds.length}`);
  }
  return grantIds.length;
}

// Deletes a grant no flow finished with. A grant that connected an app is
// ended instead, and kept until the daily cleanup deletes it 90 days after it
// ended (`cleanup.ts`).
export async function deleteGrant(
  dbAdapter: DBAdapter,
  id: string,
): Promise<void> {
  await dbAdapter.execute(`DELETE FROM oauth_provider_grants WHERE id = $1`, {
    bind: [id],
  });
}
