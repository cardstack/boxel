import { param, type Querier } from '../expression.ts';
import type { PrerenderHtmlArgs } from '../tasks/prerender-html.ts';
import { prerenderHtmlConcurrencyGroup } from './prerender-html.ts';
import { SOURCE_INDEX_JOB_TYPES_SQL } from './indexing.ts';

// A retry is an ordinary native HTML job with one durable owner obligation.
// It does not join a running attempt, whose input has already been captured.
// Call under the realm index publication lock, including on rejection paths.
export async function enqueueLatticeRenderRetry(
  tx: Querier,
  args: PrerenderHtmlArgs,
  ownerURL: string,
  currentJobId: number,
  priority: number,
) {
  let retry: PrerenderHtmlArgs = {
    realmURL: args.realmURL,
    realmUsername: args.realmUsername,
    changes: [{ url: ownerURL, operation: 'update' }],
    generation: args.generation,
    loaderEpoch: args.loaderEpoch,
    spawningJobId: null,
    coalescedPublishes: null,
    preWarm: false,
    latticeRenderRetryOwner: ownerURL,
  };
  await tx([
    `INSERT INTO jobs (job_type, concurrency_group, priority, timeout, args)
     SELECT 'prerender_html',`,
    param(prerenderHtmlConcurrencyGroup(args.realmURL)),
    ',',
    param(priority),
    ', 600,',
    param(JSON.stringify(retry)),
    `WHERE NOT EXISTS (SELECT 1 FROM jobs j WHERE j.job_type = 'prerender_html'
       AND j.concurrency_group =`,
    param(prerenderHtmlConcurrencyGroup(args.realmURL)),
    `AND j.args->>'latticeRenderRetryOwner' =`,
    param(ownerURL),
    `AND j.id <>`,
    param(currentJobId),
    `AND j.status = 'unfulfilled' AND NOT EXISTS (
       SELECT 1 FROM job_reservations r WHERE r.job_id = j.id
         AND r.completed_at IS NULL AND r.locked_until > NOW()))`,
  ]);
  await tx(['NOTIFY jobs']);
}

// Queue admission uses metadata only. Pending work remains unreserved, freeing
// worker capacity; existing source/materialization completion NOTIFY wakes it.
// This is only a scheduling hint. Capture and final publication recheck under
// native authority, because source work can arrive just after a queue claim.
export const latticeRenderRetryReadySQL = `(
  j.job_type <> 'prerender_html' OR j.args->>'latticeRenderRetryOwner' IS NULL OR (
    NOT EXISTS (SELECT 1 FROM lattice_pending_generations p
      WHERE p.realm_url = j.args->>'realmURL')
    AND NOT EXISTS (SELECT 1 FROM jobs source
      WHERE source.concurrency_group = 'indexing:' || (j.args->>'realmURL')
        AND source.job_type IN ${SOURCE_INDEX_JOB_TYPES_SQL} AND source.status = 'unfulfilled')
    AND COALESCE((SELECT source.status <> 'rejected' FROM jobs source
      WHERE source.concurrency_group = 'indexing:' || (j.args->>'realmURL')
        AND source.job_type IN ${SOURCE_INDEX_JOB_TYPES_SQL} ORDER BY source.id DESC LIMIT 1), TRUE)
    AND NOT EXISTS (SELECT 1 FROM lattice_owners o
      LEFT JOIN realm_generations r ON r.realm_url = o.realm_url
      LEFT JOIN boxel_index i ON i.realm_url = o.realm_url AND i.url = o.owner_url AND i.type = 'instance'
      WHERE o.realm_url = j.args->>'realmURL'
        AND o.owner_url = j.args->>'latticeRenderRetryOwner' AND o.retired = FALSE
        AND i.is_deleted IS DISTINCT FROM TRUE
        AND (o.dirty_generation IS NOT NULL OR i.generation IS NULL OR i.has_error
          OR i.generation IS DISTINCT FROM o.published_generation
          OR NOT lattice_owner_code_current(o.realm_url,o.owner_url,r.loader_epoch)))
  )
)`;
