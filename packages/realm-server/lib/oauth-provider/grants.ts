// The provider's OAuth grants, in `oauth_provider_grants` (ADR 021 §1.3): one
// for each consent, never merged into, widened or replaced by a later one.
//
// Boxel creates every grant itself, when a flow finishes (`finish.ts`), with
// the renewal choice its consent recorded and the expiry that choice sets
// (§1.9), in one statement. The library reads a grant through `GrantAdapter`
// (`adapter.ts`), and ends one only through `endGrant`.

import { randomBytes } from 'crypto';
import { logger, type DBAdapter } from '@cardstack/runtime-common';

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

// Stores a new grant and answers its ID.
export async function createGrant(
  dbAdapter: DBAdapter,
  { userId, clientId, resources, renewing, consentedAt }: NewGrant,
): Promise<string> {
  let id = randomBytes(32).toString('base64url');
  await dbAdapter.execute(
    `INSERT INTO oauth_provider_grants
       (id, user_id, client_id, resources, renewing, created_at, expires_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6::timestamptz,
               $6::timestamptz + make_interval(secs => $7))`,
    {
      bind: [
        id,
        userId,
        clientId,
        JSON.stringify(resources),
        renewing,
        consentedAt.toISOString(),
        renewing ? RENEWING_GRANT_TTL_SECONDS : NON_RENEWING_GRANT_TTL_SECONDS,
      ],
    },
  );
  return id;
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
export async function endGrant(
  dbAdapter: DBAdapter,
  grantId: string,
  reason: GrantEndReason,
): Promise<boolean> {
  let rows = (await dbAdapter.execute(
    `WITH ended AS (
       UPDATE oauth_provider_grants
          SET ended_at = now(), ended_reason = $2
        WHERE id = $1 AND ended_at IS NULL
        RETURNING id
     ), deleted AS (
       DELETE FROM oauth_provider_tokens WHERE grant_id = $1
     )
     SELECT count(*)::int AS ended FROM ended`,
    { bind: [grantId, reason] },
  )) as { ended: number }[];
  let ended = (rows[0]?.ended ?? 0) > 0;
  if (ended) {
    log.info(`grant ended: ${reason}`);
  }
  return ended;
}

// Revokes a user's OAuth grants (ADR 021 §1.9): records the cutoff, so that
// any grant created at or before it is refused wherever it is next used, and
// ends every grant already created by then, in one statement. The cutoff
// never moves earlier. `cutoff` is now unless given. A user with no row has
// no grant to revoke.
//
// Called beside an operator's revocation of the user's sessions, and on the
// first revocation after a password change, never on the later one that
// covers Matrix OpenID tokens, since an OpenID token can't create a grant.
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
     ), deleted AS (
       DELETE FROM oauth_provider_tokens AS t
        USING ended
        WHERE t.grant_id = ended.id
     )
     SELECT count(*)::int AS ended FROM ended`,
    { bind: [matrixUserId, cutoff ? cutoff.toISOString() : null] },
  )) as { ended: number }[];
  let ended = rows[0]?.ended ?? 0;
  if (ended > 0) {
    log.info(`grants ended: sessions-revoked, ${ended}`);
  }
  return ended;
}
