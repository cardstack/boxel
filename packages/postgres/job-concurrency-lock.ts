import { param, type Expression } from '@cardstack/runtime-common';

// Serializes everything that decides a job's fate within its lane. The claim
// path takes it so two workers cannot claim the same job, or two jobs a lane
// family says may not run together; anything that writes an outcome from
// outside the queue must take the same locks, or it races the claim it is
// trying to avoid stepping on. Exported so there is exactly one derivation of
// the keys — a second copy that drifted would silently stop excluding
// anything.
//
// Two locks, always in this order: the lane family's, then the group's. The
// family lock is what a writer lane's claim and an exclusive claim in the same
// family serialize on, and a fixed order is what keeps two transactions each
// holding one of a pair from waiting on each other. A job that is its
// family's exclusive work — which includes every job published without a
// family — has one key for both, so it takes one lock, the same one a worker
// predating families takes for that job.
export async function acquireLaneLocks(
  queryFn: (expression: Expression) => Promise<unknown>,
  lane: { concurrencyGroup: string | null; laneFamily: string | null },
) {
  let familyKey = lane.laneFamily ?? lane.concurrencyGroup;
  if (familyKey !== lane.concurrencyGroup) {
    await acquireLock(queryFn, familyKey);
  }
  await acquireConcurrencyGroupLock(queryFn, lane.concurrencyGroup);
}

// The group's lock alone, which is the second of the two `acquireLaneLocks`
// takes. Deciding a job's fate takes both; holding only this one excludes
// nothing a family lock would.
export async function acquireConcurrencyGroupLock(
  queryFn: (expression: Expression) => Promise<unknown>,
  concurrencyGroup: string | null,
) {
  await acquireLock(queryFn, concurrencyGroup);
}

async function acquireLock(
  queryFn: (expression: Expression) => Promise<unknown>,
  key: string | null,
) {
  await queryFn([
    'SELECT pg_advisory_xact_lock(hashtext(',
    param(key ?? '__queue_no_concurrency_group__'),
    '))',
  ]);
}
