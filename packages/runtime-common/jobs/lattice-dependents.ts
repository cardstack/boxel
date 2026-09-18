import { param, textArrayParam, type Querier } from '../expression.ts';
import { latticeDependencyAliases } from '../lattice-dependency-aliases.ts';
import { acquireConcurrencyGroupLock } from '../queue-concurrency-lock.ts';
import {
  indexingConcurrencyGroup,
  INCREMENTAL_INDEX_JOB_TIMEOUT_SEC,
} from './indexing.ts';
import { userInitiatedPriority } from '../queue.ts';

// Publication is the point at which ordinary consumers can safely index the
// new value. Source traversal deliberately stops at a materialized boundary;
// restarting at its ordinary consumers resumes that graph on the data lane.
// Called under the publication transaction, after its input/lease checks.
export async function enqueueLatticeDataDependents(
  tx: Querier,
  realmURL: string,
  realmUsername: string,
  published: string[],
) {
  if (!published.length) return;
  const rows = await tx([
    `SELECT i.url FROM boxel_index i WHERE i.realm_url=`,
    param(realmURL),
    `AND i.type='instance' AND i.is_deleted IS NOT TRUE AND i.pristine_doc->'meta'->'publication' IS NULL
     AND NOT EXISTS (SELECT 1 FROM lattice_owners o WHERE o.realm_url=i.realm_url AND o.owner_url=i.url AND NOT o.retired)
     AND i.deps ?|`,
    textArrayParam([...new Set(published.flatMap(latticeDependencyAliases))]),
    '::text[] ORDER BY i.url',
  ]);
  if (!rows.length) return;
  const group = indexingConcurrencyGroup(realmURL);
  await acquireConcurrencyGroupLock(tx, group);
  const changes = rows.map(({ url }) => ({ url, operation: 'update' }));
  const [pending] = await tx([
    `SELECT j.id FROM jobs j WHERE j.concurrency_group=`,
    param(group),
    `AND j.job_type='incremental-index' AND j.status='unfulfilled'
     AND j.args->>'realmUsername'=`,
    param(realmUsername),
    `AND j.args->>'latticeDependents'='true' AND NOT EXISTS (
       SELECT 1 FROM job_reservations r WHERE r.job_id=j.id AND r.completed_at IS NULL AND r.locked_until>now())
     ORDER BY j.id LIMIT 1 FOR UPDATE`,
  ]);
  if (pending) {
    await tx([
      `UPDATE jobs SET args=jsonb_set(args,'{changes}',(SELECT jsonb_agg(DISTINCT value)
        FROM jsonb_array_elements((args->'changes') ||`,
      param(JSON.stringify(changes)),
      '::jsonb))) WHERE id=',
      param(pending.id),
    ]);
  } else {
    await tx([
      `INSERT INTO jobs(job_type,concurrency_group,priority,timeout,args) VALUES ('incremental-index',`,
      param(group),
      ',',
      param(userInitiatedPriority),
      ',',
      param(INCREMENTAL_INDEX_JOB_TIMEOUT_SEC),
      ',',
      param(
        JSON.stringify({
          realmURL,
          realmUsername,
          changes,
          ignoreData: {},
          latticeDependents: true,
        }),
      ),
      ')',
    ]);
  }
  await tx(['NOTIFY jobs']);
}
