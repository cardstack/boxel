import { param, type Querier } from '../expression.ts';
import { acquireConcurrencyGroupLock } from '../queue-concurrency-lock.ts';
import { latticeWorkAttemptLimit } from '../lattice-kernel.ts';
import type { LatticeReadScope } from '../lattice-work.ts';

export const LATTICE_JOB_TYPE = 'lattice-materialize';
// Independent background tier below user source indexing (10).
// The dedicated worker's type filter, not this number, reserves capacity.
export const LATTICE_PRIORITY = 8;

export function latticeConcurrencyGroup(realmURL: string): string {
  return `lattice:${realmURL}`;
}

// Only the short guarded swap shares the primary publication lock. Candidate
// rows are attempt-scoped, so a reserved wave can run beside source indexing.
// Never join a reserved job: it has already captured its inputs.
export async function enqueueLattice(
  tx: Querier,
  realmURL: string,
  realmUsername: string,
  wave = 0,
  attempt = 0,
  waitForRead?: LatticeReadScope,
) {
  const group = latticeConcurrencyGroup(realmURL);
  // Share the claim lock, not just the publication lock. Otherwise a worker
  // can reserve a candidate between our unreserved check and the args update.
  await acquireConcurrencyGroupLock(tx, group);
  const [pending] = await tx([
    'SELECT j.id FROM jobs j WHERE j.job_type =',
    param(LATTICE_JOB_TYPE),
    'AND j.concurrency_group =',
    param(group),
    "AND j.args->>'realmUsername' =",
    param(realmUsername),
    `AND j.status = 'unfulfilled' AND NOT EXISTS (
      SELECT 1 FROM job_reservations r WHERE r.job_id = j.id
        AND r.completed_at IS NULL AND r.locked_until > NOW())
     ORDER BY j.created_at,j.id LIMIT 1 FOR UPDATE`,
  ]);
  const args = {
    realmURL,
    realmUsername,
    wave,
    attempt,
    ...(waitForRead ? { latticeWaitForRead: waitForRead } : {}),
  };
  if (pending) {
    // New inputs (wave/attempt zero) reset an obsolete budget. An old retry
    // cannot put that budget back. Preserve creation time/FIFO position and
    // any authority wait condition when an ordinary source wake-up joins it.
    await tx([
      `UPDATE jobs SET args = args ||`,
      param(JSON.stringify(args)),
      `::jsonb || jsonb_build_object(
        'wave', LEAST(COALESCE((args->>'wave')::int,0),`,
      param(wave),
      `::int), 'attempt', LEAST(COALESCE((args->>'attempt')::int,0),`,
      param(attempt),
      '::int)) WHERE id =',
      param(pending.id),
    ]);
  } else {
    await tx([
      `INSERT INTO jobs (job_type, concurrency_group, priority, timeout, args)
     SELECT`,
      param(LATTICE_JOB_TYPE),
      ',',
      param(group),
      ',',
      param(LATTICE_PRIORITY),
      ', 600,',
      param(JSON.stringify(args)),
    ]);
  }
  await tx(['NOTIFY jobs']);
}

// Storage-side eligibility; `o` is a lattice_owners row. Read only the exact
// obligation/code budget. A dirty dependent of a failed owner is still pending
// and the shared dependency frontier will keep it blocked.
export const latticeOwnerCodeVersionSQL = `(SELECT jsonb_build_array(b.reference->>'fileURL',c.work_version)::text
  FROM lattice_owner_code b JOIN lattice_code_artifacts c
    ON c.realm_url=b.realm_url AND c.file_url=b.reference->>'fileURL'
  WHERE b.realm_url=o.realm_url AND b.owner_url=o.owner_url)`;
export const latticeOwnerAttemptsSQL = `COALESCE((
  SELECT f.attempts FROM lattice_work_failures f
  JOIN realm_generations g ON g.realm_url=f.realm_url
  WHERE f.realm_url=o.realm_url AND f.owner_url=o.owner_url
    AND f.obligation=o.dirty_generation AND f.definition_revision=g.loader_epoch
    AND f.code_version IS NOT DISTINCT FROM ${latticeOwnerCodeVersionSQL}
),0)`;
export const latticeOwnerRetryReadySQL = `(${latticeOwnerAttemptsSQL} < ${latticeWorkAttemptLimit})`;

// Initial computation cannot wait for a window that only computation can
// produce. Admit an indexed registration stub through the guarded stale path,
// retaining its obligation, just like an overdue owner. Readiness still blocks
// missing input bodies; this is scheduling advice, not an input-validity proof.
// Share this predicate between queue admission, frontier and publication guard.
export const latticeOwnerStaleAttemptSQL = `(
  (o.stale_after IS NOT NULL AND o.stale_after <= now()) OR EXISTS (
    SELECT 1 FROM boxel_index initial WHERE initial.realm_url=o.realm_url
      AND initial.url=o.owner_url AND initial.type='instance'
      AND initial.is_deleted IS NOT TRUE
      AND initial.pristine_doc->'meta'->'publication' IS NOT NULL
      AND initial.pristine_doc->'meta'->'publication'->>'outputRevision' IS NULL
  ))`;

// A wave under a source backlog: an owner past its staleness deadline may
// run a stale attempt ahead of the index jobs still queued for its realm
// (the kernel's `overdue`), so a feed that never pauses still refreshes
// every tier on its window. `j` is the jobs row being claimed.
export const latticeOverdueWorkSQL = `EXISTS (
  SELECT 1 FROM lattice_owners o WHERE o.realm_url=j.args->>'realmURL'
    AND NOT o.retired AND o.dirty_generation IS NOT NULL
    AND ${latticeOwnerStaleAttemptSQL})`;
// Dedicated lanes reserve independent capacity. A general-purpose worker may
// still help either lane; when it does, alternate overdue waves with source
// jobs using the realm's last completed data job across both groups.
export const latticeWaveTurnSQL = `COALESCE((SELECT f.job_type FROM jobs f
  WHERE f.args->>'realmURL'=j.args->>'realmURL' AND f.job_type IN ('incremental-index','from-scratch-index','copy-index','lattice-materialize') AND f.status<>'unfulfilled'
  ORDER BY f.finished_at DESC NULLS LAST, f.id DESC LIMIT 1),'') <> 'lattice-materialize'`;

// A cancelled attempt can leave a durable authority wait condition. Do not
// reserve a worker just to discover the same denial again. The native input
// reader and publication transaction still recheck authority after admission.
export const latticeMaterializationReadySQL = `(
  (j.job_type <> 'lattice-materialize' OR EXISTS (
    SELECT 1 FROM lattice_pending_generations p WHERE p.realm_url=j.args->>'realmURL'
  ) OR NOT EXISTS (SELECT 1 FROM lattice_owners o WHERE o.realm_url=j.args->>'realmURL'
    AND NOT o.retired AND o.dirty_generation IS NOT NULL
  ) OR EXISTS (
    SELECT 1 FROM lattice_owners o WHERE o.realm_url=j.args->>'realmURL'
      AND NOT o.retired AND o.dirty_generation IS NOT NULL
      AND ${latticeOwnerRetryReadySQL} AND (o.settle_until IS NULL OR o.settle_until <= now()) AND NOT EXISTS (
        SELECT 1 FROM lattice_owner_code b JOIN lattice_code_artifacts c ON c.realm_url=b.realm_url AND c.file_url=b.reference->>'fileURL'
        WHERE b.realm_url=o.realm_url AND b.owner_url=o.owner_url AND c.dirty)
  )) AND (
  j.job_type <> 'lattice-materialize' OR j.args->>'latticeWaitForRead' IS NULL OR
  EXISTS (SELECT 1 FROM realm_user_permissions p
    JOIN realm_metadata r ON r.url=p.realm_url AND r.archived_at IS NULL
    WHERE p.realm_url=j.args->'latticeWaitForRead'->>'realmURL'
      AND p.username=j.args->'latticeWaitForRead'->>'actor' AND p.read=TRUE)
))`;
