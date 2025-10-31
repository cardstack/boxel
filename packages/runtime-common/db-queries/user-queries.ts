import type { DBAdapter } from '../db';

import { query, asExpressions, insert } from '../expression';
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
