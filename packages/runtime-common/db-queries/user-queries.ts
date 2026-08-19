import type { DBAdapter } from '../db.ts';

import { query, asExpressions, insert, param } from '../expression.ts';
import type { User } from './db-types.ts';

export async function insertUser(
  dbAdapter: DBAdapter,
  matrixUserId: string,
  matrixRegistrationToken: string,
): Promise<User> {
  let { valueExpressions, nameExpressions } = asExpressions({
    matrix_user_id: matrixUserId,
    matrix_registration_token: matrixRegistrationToken,
  });

  let result = await query(
    dbAdapter,
    insert('users', nameExpressions, valueExpressions),
  );

  return result[0] as unknown as User;
}

export async function getOrCreateUser(
  dbAdapter: DBAdapter,
  matrixUserId: string,
  matrixRegistrationToken?: string,
): Promise<{ user: User; created: boolean }> {
  // Try to insert a new user, do nothing on conflict.
  // When a registration token is provided, it's included in the INSERT
  // so new users get the token atomically.
  let result = await query(dbAdapter, [
    `INSERT INTO users (matrix_user_id`,
    ...(matrixRegistrationToken != null
      ? ([
          `, matrix_registration_token) VALUES (`,
          param(matrixUserId),
          `,`,
          param(matrixRegistrationToken),
        ] as const)
      : ([`) VALUES (`, param(matrixUserId)] as const)),
    `) ON CONFLICT (matrix_user_id) DO NOTHING RETURNING *`,
  ]);

  if (result.length > 0) {
    return { user: result[0] as unknown as User, created: true };
  }

  // User already existed — update the registration token if provided,
  // otherwise just fetch.
  if (matrixRegistrationToken != null) {
    let [updated] = await query(dbAdapter, [
      `UPDATE users SET matrix_registration_token =`,
      param(matrixRegistrationToken),
      `WHERE matrix_user_id =`,
      param(matrixUserId),
      `RETURNING *`,
    ]);
    if (!updated) {
      throw new Error(
        `getOrCreateUser: failed to update registration token for matrix_user_id="${matrixUserId}"`,
      );
    }
    return { user: updated as unknown as User, created: false };
  }

  let [existing] = await query(dbAdapter, [
    `SELECT * FROM users WHERE matrix_user_id =`,
    param(matrixUserId),
  ]);

  if (!existing) {
    throw new Error(
      `getOrCreateUser: expected existing user for matrix_user_id="${matrixUserId}" but none was found`,
    );
  }

  return { user: existing as unknown as User, created: false };
}

// Marks every session token already issued to this user as unusable, by
// recording the instant of revocation in epoch seconds. Tokens minted after
// this instant are unaffected, so a user holding a live matrix session simply
// re-authenticates; a bearer holding only a copied realm JWT cannot, because
// minting requires the matrix openid handshake. Revoking a user who has no
// `users` row still needs to take effect — realm session tokens are minted
// without one — so insert the row when it is missing.
//
// Returns the epoch second that was recorded.
export async function revokeUserSessions(
  dbAdapter: DBAdapter,
  matrixUserId: string,
): Promise<number> {
  let [row] = await query(dbAdapter, [
    `INSERT INTO users (matrix_user_id, sessions_revoked_at) VALUES (`,
    param(matrixUserId),
    `, EXTRACT(EPOCH FROM now())::bigint)`,
    `ON CONFLICT (matrix_user_id) DO UPDATE SET sessions_revoked_at = EXTRACT(EPOCH FROM now())::bigint`,
    `RETURNING sessions_revoked_at`,
  ]);

  if (row?.sessions_revoked_at == null) {
    throw new Error(
      `revokeUserSessions: failed to record revocation for matrix_user_id="${matrixUserId}"`,
    );
  }

  return Number(row.sessions_revoked_at);
}

// True when `issuedAt` (a JWT `iat`, in epoch seconds) predates the user's
// recorded revocation. Read fresh on every call rather than memoized: a
// revocation issued against one replica has to take effect on every other
// replica immediately, which is the same reason realm permissions are not
// cached.
export async function isSessionRevoked(
  dbAdapter: DBAdapter,
  matrixUserId: string,
  issuedAt: number | undefined,
): Promise<boolean> {
  let [row] = await query(dbAdapter, [
    'SELECT sessions_revoked_at FROM users WHERE matrix_user_id =',
    param(matrixUserId),
  ]);

  let revokedAt = row?.sessions_revoked_at;
  if (revokedAt == null) {
    return false;
  }

  // A token with no `iat` cannot be placed relative to the revocation, so treat
  // it as revoked. Every token this server mints carries one.
  if (issuedAt == null) {
    return true;
  }

  return issuedAt < Number(revokedAt);
}

export async function userExists(
  dbAdapter: DBAdapter,
  matrixUserId: string,
): Promise<boolean> {
  let [row] = await query(dbAdapter, [
    'SELECT EXISTS (SELECT 1 FROM users WHERE matrix_user_id =',
    param(matrixUserId),
    ') AS user_exists',
  ]);

  return Boolean(row.user_exists);
}
