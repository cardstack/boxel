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
import { logOAuthEvent } from './events.ts';
import { GRANT_STATE_COLUMNS, grantUsable, type GrantState } from './grants.ts';
import { asRecord, sha256Hex } from './objects.ts';
import type { OAuthCaller } from '@cardstack/runtime-common/oauth-route-admission';

const log = logger('boxel:oauth-provider');

// How often a grant's "last used" is written at most, so that reading a
// token doesn't become a write on every request.
export const LAST_USED_INTERVAL_SECONDS = 5 * 60;

// Who a valid OAuth access token speaks for (`OAuthCaller`) is declared in
// runtime-common, since a realm is a controller too. It is never turned into a
// session token's claims: those reach `isSessionRevoked`, which would compare
// the grant against the user's session revocations.
export type { OAuthCaller } from '@cardstack/runtime-common/oauth-route-admission';

// Why a token was refused. It goes to telemetry, never into a response.
export type OAuthLookupRefusal =
  | 'unknown'
  | 'expired'
  | 'wrong-resource'
  | 'revoked';

export type OAuthLookupResult =
  | { ok: true; caller: OAuthCaller }
  | { ok: false; reason: OAuthLookupRefusal };

interface LookupRow extends GrantState {
  resource: string | null;
  scope: string;
  token_expired: boolean;
  grant_id: string;
  client_id: string;
  resources: string | Record<string, string[]>;
  grant_created: number | string;
  last_used_stale: boolean;
  user_id: string;
  matrix_user_id: string;
}

// Checks: the token exists; its grant hasn't ended or expired, and was
// created after the user's OAuth grants were last revoked; the token hasn't
// expired; it was issued for this resource; and its grant still holds this
// resource. A grant created at or before that revocation is ended, with
// reason `sessions-revoked`, whichever of the token's own checks would also
// refuse it. The token is never logged or kept.
export async function resolveOAuthAccessToken(
  dbAdapter: DBAdapter,
  token: string,
  resource: string,
): Promise<OAuthLookupResult> {
  let started = Date.now();
  let result = await lookup(dbAdapter, token, resource);
  let ms = Date.now() - started;
  // Every request to a resource is a lookup, so only a refusal is logged
  // at `info`.
  if (result.ok) {
    log.debug(
      `token accepted: resource ${resource}, client ${result.caller.clientId}, ${ms}ms`,
    );
  } else {
    logOAuthEvent(
      'info',
      { event: 'resource-refused', reason: result.reason, resource },
      `token refused: ${result.reason}, resource ${resource}, ${ms}ms`,
    );
  }
  return result;
}

interface GrantLookupRow extends GrantState {
  client_id: string;
  resources: string | Record<string, string[]>;
  grant_created: number | string;
  user_id: string;
  matrix_user_id: string;
}

// The check of a tab token's grant (ADR 021 §1.5): given the grant a
// verified tab token names, the user it was minted for and the scopes it
// carries, who is calling, with the same grant checks an access token's
// lookup makes, read on every call and cached nothing past the request. Only
// a Boxel API controller calls it, once per request, for a tab token it has
// verified. The scopes are the ones the token carries that the grant still
// approves for the resource. A grant for another user than the token names
// is refused, though only this server can mint the token.
export async function resolveOAuthGrant(
  dbAdapter: DBAdapter,
  {
    grantId,
    user,
    scopes,
  }: { grantId: string; user: string; scopes: readonly string[] },
  resource: string,
): Promise<OAuthLookupResult> {
  let started = Date.now();
  let result = await lookupGrant(
    dbAdapter,
    { grantId, user, scopes },
    resource,
  );
  let ms = Date.now() - started;
  if (result.ok) {
    log.debug(
      `tab token accepted: resource ${resource}, client ${result.caller.clientId}, ${ms}ms`,
    );
  } else {
    log.info(
      `tab token refused: ${result.reason}, resource ${resource}, ${ms}ms`,
    );
  }
  return result;
}

async function lookupGrant(
  dbAdapter: DBAdapter,
  {
    grantId,
    user,
    scopes,
  }: { grantId: string; user: string; scopes: readonly string[] },
  resource: string,
): Promise<OAuthLookupResult> {
  let [row] = (await dbAdapter.execute(
    `SELECT g.client_id, g.resources,
            floor(extract(epoch FROM g.created_at)) AS grant_created,
            ${GRANT_STATE_COLUMNS},
            u.id AS user_id, u.matrix_user_id
       FROM oauth_provider_grants AS g
       JOIN users AS u ON u.id = g.user_id
      WHERE g.id = $1`,
    { bind: [grantId] },
  )) as unknown as GrantLookupRow[];
  if (!row || row.matrix_user_id !== user) {
    return { ok: false, reason: 'unknown' };
  }
  if (!(await grantUsable(dbAdapter, grantId, row))) {
    return { ok: false, reason: 'revoked' };
  }
  let resources = asRecord(row.resources) as Record<string, string[]>;
  if (!Object.prototype.hasOwnProperty.call(resources, resource)) {
    return { ok: false, reason: 'revoked' };
  }
  let approved = resources[resource];
  return {
    ok: true,
    caller: {
      user: row.matrix_user_id,
      userId: String(row.user_id),
      grantId,
      clientId: row.client_id,
      scopes: scopes.filter((scope) => approved.includes(scope)),
      grantCreatedAt: Number(row.grant_created),
    },
  };
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
            ${GRANT_STATE_COLUMNS},
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
  // The grant checks the token endpoint applies too. They come first, so a
  // grant the user's revocation covers is ended whichever token of it is
  // presented, and wherever.
  if (!(await grantUsable(dbAdapter, row.grant_id, row))) {
    return { ok: false, reason: 'revoked' };
  }
  if (row.token_expired) {
    return { ok: false, reason: 'expired' };
  }
  if (row.resource !== resource) {
    return { ok: false, reason: 'wrong-resource' };
  }
  let resources = asRecord(row.resources) as Record<string, string[]>;
  if (!Object.prototype.hasOwnProperty.call(resources, resource)) {
    return { ok: false, reason: 'revoked' };
  }
  let approved = resources[resource];

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
      scopes: row.scope
        .split(' ')
        .filter((scope) => scope && approved.includes(scope)),
      grantCreatedAt: Number(row.grant_created),
    },
  };
}
