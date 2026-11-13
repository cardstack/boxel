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

import { errors, type Adapter, type AdapterPayload } from 'oidc-provider';
import { logger, param, type DBAdapter } from '@cardstack/runtime-common';
import { endGrant } from './grants.ts';
import { OAuthProviderObjectError, sha256Hex } from './objects.ts';

const log = logger('boxel:oauth-provider');

export const REFRESH_GRACE_SECONDS = 30;

export type TokenKind = 'AccessToken' | 'RefreshToken';

interface TokenRow {
  payload: AdapterPayload | string;
  rotation: number | null;
  consumed_at: string | Date | null;
  revoked_at: string | Date | null;
  in_window: boolean | null;
  child_used: boolean;
}

export class TokenAdapter implements Adapter {
  #dbAdapter: DBAdapter;
  #kind: TokenKind;

  constructor(dbAdapter: DBAdapter, kind: TokenKind) {
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
    let resource =
      this.#kind === 'AccessToken' ? payload.aud : (payload.resource ?? null);
    await this.#dbAdapter.execute(
      `INSERT INTO oauth_provider_tokens
         (id_hash, kind, grant_id, resource, scope, payload, expires_at, rotation)
         VALUES (decode($1, 'hex'), $2, $3, $4, $5, $6::jsonb,
                 now() + make_interval(secs => $7), $8)
         ON CONFLICT (id_hash) DO UPDATE
           SET payload = EXCLUDED.payload, expires_at = EXCLUDED.expires_at`,
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
  }

  async find(id: string): Promise<AdapterPayload | undefined> {
    let [row] = (await this.#dbAdapter.execute(
      `SELECT t.payload, t.rotation, t.consumed_at, t.revoked_at,
              t.consumed_at > now() - make_interval(secs => $3) AS in_window,
              EXISTS (
                SELECT 1 FROM oauth_provider_tokens AS c
                 WHERE c.grant_id = t.grant_id
                   AND c.kind = 'RefreshToken'
                   AND c.rotation = t.rotation + 1
                   AND c.consumed_at IS NOT NULL
              ) AS child_used
         FROM oauth_provider_tokens AS t
        WHERE t.id_hash = decode($1, 'hex') AND t.kind = $2
          AND t.expires_at > now()`,
      { bind: [sha256Hex(id), this.#kind, REFRESH_GRACE_SECONDS] },
    )) as unknown as TokenRow[];
    if (!row) {
      return undefined;
    }
    let payload = (
      typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload
    ) as AdapterPayload;
    let restored: AdapterPayload = { ...payload, jti: id };
    if (this.#kind === 'RefreshToken') {
      // The library ends the grant on a token it finds used. Inside the
      // grace window, a used token whose children are unused is reported
      // unused, so the library rotates it again.
      let usedAt = row.revoked_at ?? row.consumed_at;
      let inGrace = !row.revoked_at && row.in_window && !row.child_used;
      if (usedAt && !inGrace) {
        restored.consumed = Math.floor(new Date(usedAt).getTime() / 1000);
      }
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
      throw new OAuthProviderObjectError(
        `the OAuth provider's ${this.#kind} has no consume`,
      );
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
        `SELECT t.rotation, t.consumed_at IS NOT NULL AS consumed,
                t.revoked_at IS NOT NULL AS revoked,
                t.consumed_at > now() - make_interval(secs => `,
        param(REFRESH_GRACE_SECONDS),
        `) AS in_window,
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
                ) AS sibling_used
           FROM oauth_provider_tokens AS t
          WHERE t.kind = 'RefreshToken' AND t.id_hash = decode(`,
        param(hash),
        `, 'hex')`,
      ]);
      if (!state) {
        return { result: 'missing' as const };
      }
      if (state.revoked || state.sibling_used) {
        return { result: 'reuse' as const, grantId };
      }
      if (state.consumed) {
        return state.in_window && !state.child_used
          ? { result: 'grace' as const }
          : { result: 'reuse' as const, grantId };
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

  async findByUserCode(): Promise<never> {
    throw this.#unused('findByUserCode');
  }

  async findByUid(): Promise<never> {
    throw this.#unused('findByUid');
  }

  #unused(method: string) {
    return new OAuthProviderObjectError(
      `the OAuth provider's ${this.#kind} has no ${method}`,
    );
  }
}
