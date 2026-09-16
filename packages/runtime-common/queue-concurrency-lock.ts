import { param, type Expression } from './expression.ts';

// One key derivation for queue claim, coalescing and external finalization.
// The caller must hold a PostgreSQL transaction; the lock lasts until commit.
export async function acquireConcurrencyGroupLock(
  queryFn: (expression: Expression) => Promise<unknown>,
  concurrencyGroup: string | null,
) {
  await queryFn([
    'SELECT pg_advisory_xact_lock(hashtext(',
    param(concurrencyGroup ?? '__queue_no_concurrency_group__'),
    '))',
  ]);
}
