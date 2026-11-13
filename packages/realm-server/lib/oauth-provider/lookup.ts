// The one check of an OAuth access token (ADR 021 §1.5): given a token and the
// resource it was presented to, who is calling, through which grant and
// client, and with which scopes. Only a resource's controller calls it, once
// per request (`resource.ts`).
//
// It reads the token, its grant and the user in one indexed query on every
// request, and caches nothing past the request (§1.2): a revocation on one
// realm server must apply on every other at once, the same choice
// `isSessionRevoked` makes. It never reads `users.sessions_revoked_at`,
// which the later revocation after a password change also moves, and which
// must not end an OAuth grant (§1.9).

import { logger, type DBAdapter } from '@cardstack/runtime-common';
import { endGrant } from './grants.ts';
import { sha256Hex } from './objects.ts';

const log = logger('boxel:oauth-provider');

// How often a grant's "last used" is written at most, so that reading a
// token doesn't become a write on every request.
export const LAST_USED_INTERVAL_SECONDS = 5 * 60;

// Who a valid OAuth access token speaks for, and nothing taken from the
// request (§1.5). It never carries `secureSession` (§1.6), and it is never
// turned into a session token's claims: those reach `isSessionRevoked`,
// which would compare the grant against the user's session revocations.
export interface OAuthCaller {
  // The user's Matrix ID, the user a session token names.
  user: string;
  // The user's internal ID (`users.id`).
  userId: string;
  grantId: string;
  clientId: string;
  // The token's own scopes.
  scopes: readonly string[];
  // When the grant was created (its consent), in epoch seconds.
  grantCreatedAt: number;
}

// Why a token was refused. It goes to telemetry, never into a response.
export type OAuthLookupRefusal =
  | 'unknown'
  | 'expired'
  | 'wrong-resource'
  | 'revoked';

export type OAuthLookupResult =
  | { ok: true; caller: OAuthCaller }
  | { ok: false; reason: OAuthLookupRefusal };

interface LookupRow {
  resource: string | null;
  scope: string;
  token_expired: boolean;
  grant_id: string;
  client_id: string;
  resources: string | Record<string, string[]>;
  grant_created: number | string;
  grant_ended: boolean;
  grant_expired: boolean;
  grants_revoked: boolean;
  last_used_stale: boolean;
  user_id: string;
  matrix_user_id: string;
}

// Checks, in order: (1) the token exists and hasn't expired; (2) it was
// issued for this resource; (3) its grant hasn't ended or expired, and still
// holds this resource; (4) its grant was created after the user's OAuth
// grants were last revoked. A grant that fails (4) is ended, with reason
// `sessions-revoked`. The token is never logged or kept.
export async function resolveOAuthAccessToken(
  dbAdapter: DBAdapter,
  token: string,
  resource: string,
): Promise<OAuthLookupResult> {
  let started = Date.now();
  let result = await lookup(dbAdapter, token, resource);
  let ms = Date.now() - started;
  if (result.ok) {
    log.info(
      `token accepted: resource ${resource}, client ${result.caller.clientId}, ${ms}ms`,
    );
  } else {
    log.info(`token refused: ${result.reason}, resource ${resource}, ${ms}ms`);
  }
  return result;
}

async function lookup(
  dbAdapter: DBAdapter,
  token: string,
  resource: string,
): Promise<OAuthLookupResult> {
  let [row] = (await dbAdapter.execute(
    `SELECT t.resource, t.scope,
            t.expires_at <= now() AS token_expired,
            g.id AS grant_id, g.client_id, g.resources,
            floor(extract(epoch FROM g.created_at)) AS grant_created,
            g.ended_at IS NOT NULL AS grant_ended,
            g.expires_at <= now() AS grant_expired,
            COALESCE(g.created_at <= u.oauth_grants_revoked_at, false)
              AS grants_revoked,
            (g.last_used_at IS NULL
              OR g.last_used_at <= now() - make_interval(secs => $2))
              AS last_used_stale,
            u.id AS user_id, u.matrix_user_id
       FROM oauth_provider_tokens AS t
       JOIN oauth_provider_grants AS g ON g.id = t.grant_id
       JOIN users AS u ON u.id = g.user_id
      WHERE t.id_hash = decode($1, 'hex') AND t.kind = 'AccessToken'`,
    { bind: [sha256Hex(token), LAST_USED_INTERVAL_SECONDS] },
  )) as unknown as LookupRow[];

  if (!row) {
    return { ok: false, reason: 'unknown' };
  }
  if (row.token_expired) {
    return { ok: false, reason: 'expired' };
  }
  if (row.resource !== resource) {
    return { ok: false, reason: 'wrong-resource' };
  }
  let resources = (
    typeof row.resources === 'string'
      ? JSON.parse(row.resources)
      : row.resources
  ) as Record<string, string[]>;
  if (
    row.grant_ended ||
    row.grant_expired ||
    !Object.prototype.hasOwnProperty.call(resources, resource)
  ) {
    return { ok: false, reason: 'revoked' };
  }
  if (row.grants_revoked) {
    await endGrant(dbAdapter, row.grant_id, 'sessions-revoked');
    return { ok: false, reason: 'revoked' };
  }

  if (row.last_used_stale) {
    // Conditional, so two replicas reading a stale value write it once.
    await dbAdapter.execute(
      `UPDATE oauth_provider_grants SET last_used_at = now()
        WHERE id = $1
          AND (last_used_at IS NULL
               OR last_used_at <= now() - make_interval(secs => $2))`,
      { bind: [row.grant_id, LAST_USED_INTERVAL_SECONDS] },
    );
  }

  return {
    ok: true,
    caller: {
      user: row.matrix_user_id,
      userId: String(row.user_id),
      grantId: row.grant_id,
      clientId: row.client_id,
      scopes: row.scope.split(' ').filter(Boolean),
      grantCreatedAt: Number(row.grant_created),
    },
  };
}
