import type { DBAdapter } from '../db';

import { query, asExpressions, insert, param } from '../expression';
import type { User } from './db-types';

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
