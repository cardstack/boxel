import { randomBytes } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import type { PgAdapter } from '@cardstack/postgres';
import { APP_BOXEL_REALMS_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';
import { fetchAccountData, registerUser } from '../../synapse.ts';
import { sha256Hex } from '../../lib/oauth-provider/objects.ts';
import { matrixRegistrationSecret, matrixURL } from './index.ts';

export interface ListUser {
  userId: string;
  displayName: string;
  // The user's own Matrix token, so a test reads and seeds their workspace
  // list without going through the server under test.
  accessToken: string;
}

// A new user of the test homeserver.
export async function registerListUser(prefix: string): Promise<ListUser> {
  let localpart = `${prefix}-${uuidv4().slice(0, 8)}`;
  let displayName = `List ${localpart}`;
  let { userId, accessToken } = await registerUser({
    matrixURL,
    displayname: displayName,
    username: localpart,
    password: 'password',
    registrationSecret: matrixRegistrationSecret,
  });
  return { userId, displayName, accessToken };
}

// The user's `app.boxel.realms` list as Matrix holds it.
export async function workspaceListOf(user: ListUser): Promise<unknown> {
  let { realms } = await fetchAccountData(
    matrixURL,
    user.userId,
    user.accessToken,
    APP_BOXEL_REALMS_EVENT_TYPE,
  );
  return realms;
}

export async function setWorkspaceListOf(user: ListUser, realms: string[]) {
  let response = await fetch(
    `${matrixURL.href}_matrix/client/v3/user/${encodeURIComponent(
      user.userId,
    )}/account_data/${APP_BOXEL_REALMS_EVENT_TYPE}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${user.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ realms }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `could not set ${user.userId}'s workspace list: HTTP ${response.status}`,
    );
  }
}

// A Boxel API access token for `user`, stored as the provider stores one: its
// hash, bound to `resource`, on a grant of its own.
export async function boxelApiToken(
  dbAdapter: PgAdapter,
  user: string,
  resource: string,
  scope = 'boxel:read boxel:write',
): Promise<string> {
  let [{ id: userId }] = (await dbAdapter.execute(
    `INSERT INTO users (matrix_user_id) VALUES ($1)
       ON CONFLICT (matrix_user_id)
       DO UPDATE SET matrix_user_id = EXCLUDED.matrix_user_id
       RETURNING id`,
    { bind: [user] },
  )) as { id: string }[];
  let grantId = randomBytes(16).toString('base64url');
  let token = randomBytes(32).toString('base64url');
  await dbAdapter.execute(
    `INSERT INTO oauth_provider_grants
       (id, user_id, client_id, resources, renewing, expires_at)
       VALUES ($1, $2::uuid, 'boxel-cli', $3::jsonb, false,
               now() + interval '1 hour')`,
    {
      bind: [grantId, userId, JSON.stringify({ [resource]: scope.split(' ') })],
    },
  );
  await dbAdapter.execute(
    `INSERT INTO oauth_provider_tokens
       (id_hash, kind, grant_id, resource, scope, payload, expires_at)
       VALUES (decode($1, 'hex'), 'AccessToken', $2, $3, $4, '{}'::jsonb,
               now() + interval '10 minutes')`,
    { bind: [sha256Hex(token), grantId, resource, scope] },
  );
  return token;
}
