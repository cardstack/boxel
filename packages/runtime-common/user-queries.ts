import { DBAdapter } from './db';

import { query, asExpressions, upsert } from './expression';

export async function upsertUser(
  dbAdapter: DBAdapter,
  matrixUserId: string,
  matrixRegistrationToken: string,
) {
  let { valueExpressions, nameExpressions } = asExpressions({
    matrix_user_id: matrixUserId,
    matrix_registration_token: matrixRegistrationToken,
  });

  await query(
    dbAdapter,
    upsert(
      'users',
      'users_matrix_user_id_key',
      nameExpressions,
      valueExpressions,
    ),
  );
}
