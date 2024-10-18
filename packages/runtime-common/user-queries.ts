import { DBAdapter } from './db';

import { query, asExpressions, upsert } from './expression';

export async function upsertUser(dbAdapter: DBAdapter, matrixUserId: string) {
  let { valueExpressions, nameExpressions } = asExpressions({
    matrix_user_id: matrixUserId,
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
