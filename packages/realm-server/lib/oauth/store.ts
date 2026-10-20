import { createHash } from 'node:crypto';
import { errors, type Adapter, type AdapterPayload } from 'oidc-provider';
import { param, type DBAdapter } from '@cardstack/runtime-common';
import {
  secretsKeyring,
  sealedColumnsSelect,
  sealedFromColumns,
  sealedColumnBindings,
  PLATFORM_SECRET_OWNER,
} from '../secrets-at-rest/index.ts';

export const OAUTH_PAYLOAD_FIELD = 'oauth_objects.payload';
export function oauthId(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
export function oauthBinding(id: string) {
  return { field: OAUTH_PAYLOAD_FIELD, owner: PLATFORM_SECRET_OWNER, id };
}

// Provider artifacts contain client secrets, codes and refresh tokens. IDs
// are hashed and the complete payload uses Boxel's existing KMS-backed seal.
// The row binding prevents moving a sealed artifact between models or IDs.
export function oauthAdapter(db: DBAdapter) {
  return class BoxelOAuthAdapter implements Adapter {
    private model: string;
    constructor(model: string) {
      this.model = model;
    }
    private id(id: string) {
      return oauthId(`${this.model}:${id}`);
    }
    async upsert(id: string, payload: AdapterPayload, expiresIn?: number) {
      let key = this.id(id);
      let sealed = secretsKeyring().seal(
        JSON.stringify(payload),
        oauthBinding(key),
      );
      await db.execute(
        `INSERT INTO oauth_objects
        (id, model, grant_id, uid, user_code, expires_at,
         payload_ciphertext, payload_nonce, payload_tag, payload_key_id)
        VALUES ($1,$2,$3,$4,$5,$6,decode($7,'base64'),decode($8,'base64'),decode($9,'base64'),$10)
        ON CONFLICT (id) DO UPDATE SET
          grant_id=EXCLUDED.grant_id, uid=EXCLUDED.uid, user_code=EXCLUDED.user_code,
          expires_at=EXCLUDED.expires_at, payload_ciphertext=EXCLUDED.payload_ciphertext,
          payload_nonce=EXCLUDED.payload_nonce, payload_tag=EXCLUDED.payload_tag,
          payload_key_id=EXCLUDED.payload_key_id`,
        {
          bind: [
            key,
            this.model,
            this.model === 'Grant'
              ? oauthId(id)
              : payload.grantId
                ? oauthId(payload.grantId)
                : null,
            payload.uid ? oauthId(payload.uid) : null,
            payload.userCode ? oauthId(payload.userCode) : null,
            expiresIn ? Math.floor(Date.now() / 1000) + expiresIn : null,
            ...sealedColumnBindings(sealed),
          ],
          redactBindings: true,
        },
      );
    }
    private async lookup(column: 'id' | 'uid' | 'user_code', value: string) {
      let [row] = await db.execute(
        `SELECT id, consumed_at, ${sealedColumnsSelect('payload')}
        FROM oauth_objects WHERE model=$1 AND ${column}=$2
        AND (expires_at IS NULL OR expires_at > EXTRACT(EPOCH FROM NOW()))`,
        {
          bind: [this.model, value],
          redactBindings: true,
        },
      );
      if (!row) {
        return undefined;
      }
      let sealed = sealedFromColumns(row, 'payload');
      if (!sealed) {
        throw new Error('OAuth artifact is not sealed');
      }
      let payload = JSON.parse(
        secretsKeyring().open(sealed, oauthBinding(String(row.id))),
      ) as AdapterPayload;
      if (row.consumed_at !== null) {
        payload.consumed = Number(row.consumed_at);
      }
      return payload;
    }
    find(id: string) {
      return this.lookup('id', this.id(id));
    }
    findByUid(uid: string) {
      return this.lookup('uid', oauthId(uid));
    }
    findByUserCode(code: string) {
      return this.lookup('user_code', oauthId(code));
    }
    async consume(id: string) {
      // Compare-and-set across replicas: concurrent code/refresh exchanges
      // cannot both consume an artifact after reading it as unused.
      let rows = await db.execute(
        `UPDATE oauth_objects SET consumed_at=EXTRACT(EPOCH FROM NOW())::bigint
        WHERE id=$1 AND consumed_at IS NULL AND expires_at > EXTRACT(EPOCH FROM NOW()) RETURNING id`,
        {
          bind: [this.id(id)],
          redactBindings: true,
        },
      );
      if (!rows.length) {
        throw new errors.InvalidGrant('authorization already used or expired');
      }
    }
    async destroy(id: string) {
      await db.execute('DELETE FROM oauth_objects WHERE id=$1', {
        bind: [this.id(id)],
        redactBindings: true,
      });
    }
    async revokeByGrantId(id: string) {
      await revokeOAuthGrant(db, oauthId(id));
    }
  };
}

export interface BoxelOAuthGrant {
  id: string;
  user: string;
  clientId: string;
  resource: string;
  realms: string[];
  scopes: string[];
  issuedAt: number;
  renewableUntil?: number;
  revoked: boolean;
}
export async function saveOAuthGrant(
  db: DBAdapter,
  grant: Omit<BoxelOAuthGrant, 'revoked'>,
) {
  let sealed = secretsKeyring().seal(JSON.stringify(grant), {
    field: 'oauth_grants.permissions',
    owner: grant.user,
    id: grant.id,
  });
  await db.execute(
    `INSERT INTO oauth_grants (id,user_id,client_id,resource,realms,scopes,issued_at,permissions_ciphertext,permissions_nonce,permissions_tag,permissions_key_id)
    VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,decode($8,'base64'),decode($9,'base64'),decode($10,'base64'),$11)`,
    {
      bind: [
        grant.id,
        grant.user,
        grant.clientId,
        grant.resource,
        JSON.stringify(grant.realms),
        JSON.stringify(grant.scopes),
        grant.issuedAt,
        ...sealedColumnBindings(sealed),
      ],
      redactBindings: true,
    },
  );
}
export async function readOAuthGrant(
  db: DBAdapter,
  id: string,
): Promise<BoxelOAuthGrant | undefined> {
  let [row] = await db.execute(
    `SELECT *, ${sealedColumnsSelect('permissions')} FROM oauth_grants WHERE id=$1`,
    {
      bind: [id],
      redactBindings: true,
    },
  );
  if (!row) {
    return undefined;
  }
  let sealed = sealedFromColumns(row, 'permissions');
  if (!sealed) {
    return undefined;
  }
  let grant = JSON.parse(
    secretsKeyring().open(sealed, {
      field: 'oauth_grants.permissions',
      owner: String(row.user_id),
      id,
    }),
  ) as Omit<BoxelOAuthGrant, 'revoked'>;
  if (grant.id !== id || grant.user !== row.user_id) {
    return undefined;
  }
  return { ...grant, revoked: row.revoked_at !== null };
}
export async function revokeOAuthGrant(db: DBAdapter, id: string) {
  await db.withTransaction(async (q) => {
    await q([`UPDATE oauth_grants SET revoked_at=NOW() WHERE id=`, param(id)]);
    await q([`DELETE FROM oauth_objects WHERE grant_id=`, param(id)]);
  });
}
