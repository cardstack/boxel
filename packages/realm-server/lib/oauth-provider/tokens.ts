// The provider's access and refresh tokens, in `oauth_provider_tokens` (ADR
// 021 §1.2): each found only by the SHA-256 of its value, with the library's
// payload minus its copy of the value (`jti`). A row past its expiry reads as
// missing, whether or not it has been deleted.
//
// Refresh tokens rotate on every use (§1.9). The token a refresh presents is
// marked used once, atomically, and the token it returns is its child: the
// next rotation of the grant's one chain. Presenting a used token again ends
// the grant as reuse, except within the grace window: 30 seconds from its
// first use, and only while none of its children has been used, it rotates
// again, so a client whose response was lost, or that refreshed twice at
// once, keeps its connection. The tokens a grace-window refresh adds are
// siblings of the first: once one of them is used, the others are revoked,
// and presenting a revoked one ends the grant. Either way one chain is left.
//
// A token is stored only while its grant is current: a grant that has ended
// keeps no tokens, even one issued by an exchange that raced the end.

import { errors, type AdapterPayload } from 'oidc-provider';
import { logger, param, type DBAdapter } from '@cardstack/runtime-common';
import { endGrant } from './grants.ts';
import {
  OAuthProviderAdapter,
  OAuthProviderObjectError,
  sha256Hex,
} from './objects.ts';

const log = logger('boxel:oauth-provider');

export const REFRESH_GRACE_SECONDS = 30;

// Expired rows are deleted on roughly one store in this many, at most
// `EXPIRED_SWEEP_LIMIT` at a time. A row past its expiry already reads as
// missing, so this only keeps a grant that runs to its expiry, refreshing
// every few minutes, from piling up its tokens. A store adds one or two
// rows, so the limit clears them far faster than they come, and keeps the
// request that runs it from waiting on a large delete.
const EXPIRED_SWEEP_ONE_IN = 50;
const EXPIRED_SWEEP_LIMIT = 500;

export type TokenKind = 'AccessToken' | 'RefreshToken';

// What decides a refresh token's use (§1.9), read for the token as `t` by
// `REFRESH_USE_COLUMNS`.
interface RefreshUse {
  consumed: boolean;
  revoked: boolean;
  // Used within the grace window. Null when unused.
  in_window: boolean | null;
  // One of the tokens its use issued has been used.
  child_used: boolean;
  // Another token of its rotation has been used.
  sibling_used: boolean;
}

// The columns of `RefreshUse`, for a query that reads the token as `t`. One
// fragment, read by `TokenAdapter.find` and `consume` and by
// `presentedRefreshToken`, and decided by `refreshTokenUse`, so the three
// agree on whether presenting a token ends its grant.
const REFRESH_USE_COLUMNS = `
  t.consumed_at IS NOT NULL AS consumed,
  t.revoked_at IS NOT NULL AS revoked,
  t.consumed_at > now() - make_interval(secs => ${Number(REFRESH_GRACE_SECONDS)})
    AS in_window,
  EXISTS (
    SELECT 1 FROM oauth_provider_tokens AS c
     WHERE c.grant_id = t.grant_id
       AND c.kind = 'RefreshToken'
       AND c.rotation = t.rotation + 1
       AND c.consumed_at IS NOT NULL
  ) AS child_used,
  EXISTS (
    SELECT 1 FROM oauth_provider_tokens AS s
     WHERE s.grant_id = t.grant_id
       AND s.kind = 'RefreshToken'
       AND s.rotation = t.rotation
       AND s.id_hash <> t.id_hash
       AND s.consumed_at IS NOT NULL
  ) AS sibling_used`;

// The reuse rule (§1.9). `unused`: presenting it rotates it. `grace`: used,
// but within the grace window and before any of its children, so presenting
// it rotates it again. `reuse`: it was revoked, a sibling was used, or it was
// used outside the window or after one of its children, so presenting it
// ends the grant.
function refreshTokenUse(use: RefreshUse): 'unused' | 'grace' | 'reuse' {
  if (use.revoked || use.sibling_used) {
    return 'reuse';
  }
  if (!use.consumed) {
    return 'unused';
  }
  return use.in_window && !use.child_used ? 'grace' : 'reuse';
}

interface TokenRow extends Partial<RefreshUse> {
  payload: AdapterPayload | string;
  used_at: string | Date | null;
}

export class TokenAdapter extends OAuthProviderAdapter {
  #dbAdapter: DBAdapter;
  #kind: TokenKind;

  constructor(dbAdapter: DBAdapter, kind: TokenKind) {
    super(kind);
    this.#dbAdapter = dbAdapter;
    this.#kind = kind;
  }

  async upsert(
    id: string,
    payload: AdapterPayload,
    expiresIn: number,
  ): Promise<void> {
    let { jti: _jti, consumed: _consumed, ...stored } = payload;
    let json = JSON.stringify(stored);
    if (json.includes(JSON.stringify(id).slice(1, -1))) {
      throw new OAuthProviderObjectError(
        `the OAuth provider's ${this.#kind} holds its own value, so it can't be stored`,
      );
    }
    if (typeof payload.grantId !== 'string') {
      throw new OAuthProviderObjectError(
        `the OAuth provider's ${this.#kind} names no grant`,
      );
    }
    // An access token is bound to exactly one resource (§1.2).
    if (this.#kind === 'AccessToken' && typeof payload.aud !== 'string') {
      throw new OAuthProviderObjectError(
        `the OAuth provider's AccessToken names no single resource`,
      );
    }
    let resource =
      this.#kind === 'AccessToken' ? payload.aud : (payload.resource ?? null);
    // Stored only while the grant is current. The share lock makes a store
    // that races `endGrant` wait for it and then find the grant ended, or
    // makes `endGrant` wait for the store, after which it deletes the token
    // with the grant's others.
    let inserted = await this.#dbAdapter.execute(
      `INSERT INTO oauth_provider_tokens
         (id_hash, kind, grant_id, resource, scope, payload, expires_at, rotation)
         SELECT decode($1, 'hex'), $2, g.id, $4, $5, $6::jsonb,
                now() + make_interval(secs => $7), $8
           FROM oauth_provider_grants AS g
          WHERE g.id = $3 AND g.ended_at IS NULL
            FOR SHARE
         ON CONFLICT (id_hash) DO UPDATE
           SET payload = EXCLUDED.payload, expires_at = EXCLUDED.expires_at
         RETURNING 1`,
      {
        bind: [
          sha256Hex(id),
          this.#kind,
          payload.grantId,
          typeof resource === 'string' ? resource : null,
          typeof payload.scope === 'string' ? payload.scope : '',
          json,
          expiresIn,
          this.#kind === 'RefreshToken'
            ? typeof payload.rotations === 'number'
              ? payload.rotations
              : 0
            : null,
        ],
      },
    );
    if (inserted.length === 0) {
      log.info(`token not stored: grant ended`);
      throw new errors.InvalidGrant('grant has ended');
    }
    if (Math.random() * EXPIRED_SWEEP_ONE_IN < 1) {
      // Rows another request is deleting are skipped, not waited for.
      await this.#dbAdapter.execute(
        `DELETE FROM oauth_provider_tokens
          WHERE id_hash IN (
            SELECT id_hash FROM oauth_provider_tokens
             WHERE expires_at <= now()
             LIMIT $1
               FOR UPDATE SKIP LOCKED
          )`,
        { bind: [EXPIRED_SWEEP_LIMIT] },
      );
    }
  }

  async find(id: string): Promise<AdapterPayload | undefined> {
    // An access token's lookup reads only its own row: the reuse rule is a
    // refresh token's.
    let refresh = this.#kind === 'RefreshToken';
    let [row] = (await this.#dbAdapter.execute(
      `SELECT t.payload,
              COALESCE(t.revoked_at, t.consumed_at, now()) AS used_at
              ${refresh ? `, ${REFRESH_USE_COLUMNS}` : ''}
         FROM oauth_provider_tokens AS t
        WHERE t.id_hash = decode($1, 'hex') AND t.kind = $2
          AND t.expires_at > now()`,
      { bind: [sha256Hex(id), this.#kind] },
    )) as unknown as TokenRow[];
    if (!row) {
      return undefined;
    }
    let payload = (
      typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload
    ) as AdapterPayload;
    let restored: AdapterPayload = { ...payload, jti: id };
    // The library ends the grant on a token it finds used. One in the grace
    // window is reported unused, so the library rotates it again.
    if (refresh && refreshTokenUse(row as RefreshUse) === 'reuse') {
      restored.consumed = Math.floor(new Date(row.used_at!).getTime() / 1000);
    }
    return restored;
  }

  // Marks a refresh token used, the first time atomically. Every consume of
  // one grant's tokens runs under a lock on the grant's row, so of two
  // siblings used at once, one is marked used and the other revoked. A
  // second consume inside the grace window counts as done; any other ends
  // the grant as reuse.
  async consume(id: string): Promise<void> {
    if (this.#kind !== 'RefreshToken') {
      throw this.unused('consume');
    }
    let hash = sha256Hex(id);
    let outcome = await this.#dbAdapter.withTransaction(async (query) => {
      let [token] = await query([
        `SELECT grant_id FROM oauth_provider_tokens
          WHERE kind = 'RefreshToken' AND id_hash = decode(`,
        param(hash),
        `, 'hex')`,
      ]);
      if (!token) {
        return { result: 'missing' as const };
      }
      let grantId = token.grant_id as string;
      await query([
        `SELECT 1 FROM oauth_provider_grants WHERE id = `,
        param(grantId),
        ` FOR UPDATE`,
      ]);
      // Read again under the lock, so a sibling's use that committed while
      // this waited is seen.
      let [state] = await query([
        `SELECT t.rotation, ${REFRESH_USE_COLUMNS}
           FROM oauth_provider_tokens AS t
          WHERE t.kind = 'RefreshToken' AND t.id_hash = decode(`,
        param(hash),
        `, 'hex')`,
      ]);
      if (!state) {
        return { result: 'missing' as const };
      }
      let use = refreshTokenUse(state as unknown as RefreshUse);
      if (use === 'reuse') {
        return { result: 'reuse' as const, grantId };
      }
      if (use === 'grace') {
        return { result: 'grace' as const };
      }
      await query([
        `UPDATE oauth_provider_tokens SET consumed_at = now()
          WHERE kind = 'RefreshToken' AND id_hash = decode(`,
        param(hash),
        `, 'hex')`,
      ]);
      await query([
        `UPDATE oauth_provider_tokens SET revoked_at = now()
          WHERE grant_id = `,
        param(grantId),
        ` AND kind = 'RefreshToken' AND rotation = `,
        param(state.rotation as number),
        ` AND id_hash <> decode(`,
        param(hash),
        `, 'hex') AND consumed_at IS NULL AND revoked_at IS NULL`,
      ]);
      return { result: 'first' as const };
    });
    switch (outcome.result) {
      case 'first':
        return;
      case 'grace':
        log.info('token refreshed: grace window');
        return;
      case 'missing':
        throw new errors.InvalidGrant('refresh token not found');
      case 'reuse':
        log.info('refresh token reused');
        await endGrant(this.#dbAdapter, outcome.grantId, 'reuse');
        throw new errors.InvalidGrant('refresh token already used');
    }
  }

  async destroy(id: string): Promise<void> {
    await this.#dbAdapter.execute(
      `DELETE FROM oauth_provider_tokens
         WHERE kind = $1 AND id_hash = decode($2, 'hex')`,
      { bind: [this.#kind, sha256Hex(id)] },
    );
  }

  async revokeByGrantId(grantId: string): Promise<void> {
    await this.#dbAdapter.execute(
      `DELETE FROM oauth_provider_tokens WHERE kind = $1 AND grant_id = $2`,
      { bind: [this.#kind, grantId] },
    );
  }
}

// Whether a refresh token, by its value, has been used in a way that ends
// its grant if it is presented (`refreshTokenUse`), as `TokenAdapter.consume`
// decides it, read without the grant's lock, for a request refused before
// the library sees it. Undefined for a token the provider doesn't hold.
export async function presentedRefreshToken(
  dbAdapter: DBAdapter,
  token: string,
): Promise<{ grantId: string; reused: boolean } | undefined> {
  let [row] = (await dbAdapter.execute(
    `SELECT t.grant_id, t.expires_at > now() AS current, ${REFRESH_USE_COLUMNS}
       FROM oauth_provider_tokens AS t
      WHERE t.kind = 'RefreshToken' AND t.id_hash = decode($1, 'hex')`,
    { bind: [sha256Hex(token)] },
  )) as unknown as (RefreshUse & { grant_id: string; current: boolean })[];
  return row
    ? {
        grantId: row.grant_id,
        reused: row.current && refreshTokenUse(row) === 'reuse',
      }
    : undefined;
}
