import './instrument.ts';
import {
  type QueuePublisher,
  type QueueRunner,
  type QueuePublishArgs,
  type QueuePublishRequest,
  type QueueCoalesceJoinUpdate,
  type QueueResultMapper,
  type QueueWaiter,
  type QueueJobSpec,
  type QueueCoalesceCandidate,
  type QueueCoalesceContext,
  type QueueCoalesceDecision,
  type PgPrimitive,
  type Expression,
  type JobInfo,
  getQueueJobCoalesceHandler,
  normalizeQueueJobSpec,
  identityResultMapper,
  makeQueueWaiter,
  param,
  separatedByCommas,
  addExplicitParens,
  any,
  query,
  logger,
  asExpressions,
  Deferred,
  Job,
  registerJobHeartbeat,
  unregisterJobHeartbeat,
  userInitiatedPriority,
} from '@cardstack/runtime-common';
import { FROM_SCRATCH_JOB_TIMEOUT_SEC } from '@cardstack/runtime-common/tasks/indexer';
// Side-effect imports: these modules call registerQueueJobDefinition() at
// load time, so any process that constructs a PgQueuePublisher gets the
// coalesce handlers registered before publish() is called.
import '@cardstack/runtime-common/jobs/capture-card';
import '@cardstack/runtime-common/tasks/copy';
import '@cardstack/runtime-common/tasks/full-reindex';
import '@cardstack/runtime-common/tasks/media-cache-gc';
import '@cardstack/runtime-common/tasks/prerender-html';
import '@cardstack/runtime-common/tasks/prerender-html-reconcile';
import '@cardstack/runtime-common/tasks/scoped-css-gc';
import type { PgAdapter } from './pg-adapter.ts';
import type { JobReservationsTable, JobsTable } from './job-tables.ts';
import { acquireConcurrencyGroupLock } from './job-concurrency-lock.ts';
import { flattenErrorForJsonb } from './flatten-error-for-jsonb.ts';
import { WorkLoop } from './work-loop.ts';
import { finalizeJobVerdict, releaseJobReservation } from './job-finalize.ts';
import * as Sentry from '@sentry/node';

const log = logger('queue');

// Ceiling on how long any single job may occupy a worker, whatever timeout it
// declares. It clamps the reservation's lease — and with it the handler's abort
// deadline, which is the same value — so it is the backstop behind every job
// type's own budget rather than a deadline competing with it.
//
// Set to the largest timeout any job type declares, so in a deployed worker it
// never binds: `Math.min` always picks the job's own, shorter budget. What it
// bounds is a caller declaring something absurd, and it is how a test runner
// keeps aborts short without restating a smaller timeout at every publish site.
const MAX_JOB_TIMEOUT_SEC = FROM_SCRATCH_JOB_TIMEOUT_SEC;

// How long a lease outlives the handler deadline it protects.
//
// The invariant: a lease is how long a worker owns a job; the deadline is how
// long its handler may run. The lease has to outlast the deadline, or a
// handler has no uncontested moment in which to record what it did.
//
// Sharing one instant denies it that moment. The deadline fires, the handler
// throws, and by the time it reaches `finalizeJobVerdict` the job is already
// claimable: a peer that gets there first makes the verdict `superseded`, so
// it is discarded and the job runs again — repeatedly, because every attempt
// loses the same race. The cost lands twice, in duplicated work and in a job
// whose recorded state never catches up with what actually happened.
//
// `findStuckReservations` already defends the same boundary from the other
// side, with the same 30 seconds and for the same stated reason — "the lease
// boundary is not synchronized with the finalize transaction". This is that
// protection applied to the claim path, which had none: the instant
// `locked_until` passed, a peer could take the job.
//
// The window only has to cover a `finalizeJobVerdict` transaction against a
// database that answered the rest of the pass in milliseconds, so 30s is
// generous. Its price is how long a genuinely dead worker delays a retry —
// and because a progressing job extends its lease, that delay is measured
// from the job's last heartbeat rather than from its claim: a worker lost
// mid-pass holds its job for one deadline plus this window, however long the
// pass had already been running.
const LEASE_GRACE_SEC = 30;

interface CoalesceCandidateRow extends Pick<
  JobsTable,
  | 'id'
  | 'job_type'
  | 'concurrency_group'
  | 'timeout'
  | 'priority'
  | 'args'
  | 'initiated_by'
> {}

export class PgQueuePublisher implements QueuePublisher {
  #isDestroyed = false;
  #pgClient: PgAdapter;
  #pollInterval = 10000;
  #notifiers: Map<number, Set<QueueWaiter>> = new Map();
  #notificationRunner: WorkLoop | undefined;

  constructor(pgClient: PgAdapter) {
    this.#pgClient = pgClient;
  }

  async #query(expression: Expression) {
    return await query(this.#pgClient, expression);
  }

  private addWaiter(id: number, waiter: QueueWaiter) {
    if (!this.#notificationRunner && !this.#isDestroyed) {
      this.#notificationRunner = new WorkLoop(
        'notificationRunner',
        this.#pollInterval,
      );
      this.#notificationRunner.run(async (loop) => {
        await this.#pgClient.listen(
          'jobs_finished',
          loop.wake.bind(loop),
          async () => {
            while (!loop.shuttingDown) {
              await this.drainNotifications(loop);
              await loop.sleep();
            }
          },
        );
      });
    }
    let waiters = this.#notifiers.get(id);
    if (!waiters) {
      waiters = new Set();
      this.#notifiers.set(id, waiters);
    }
    waiters.add(waiter);
  }

  private async drainNotifications(loop: WorkLoop) {
    while (!loop.shuttingDown) {
      let waitingIds = [...this.#notifiers.keys()];
      if (waitingIds.length === 0) {
        return;
      }
      log.debug('jobs waiting for notification: %s', waitingIds);
      let result = (await this.#query([
        `SELECT id, status, result FROM jobs WHERE status != 'unfulfilled' AND (`,
        ...any(waitingIds.map((id) => [`id=`, param(id)])),
        `)`,
      ] as Expression)) as Pick<JobsTable, 'id' | 'status' | 'result'>[];
      if (result.length === 0) {
        log.debug(`no jobs to notify`);
        return;
      }
      for (let row of result) {
        log.debug(
          `notifying caller that job %s finished with %s`,
          row.id,
          row.status,
        );
        let waiters = this.#notifiers.get(row.id) ?? new Set();
        this.#notifiers.delete(row.id);
        for (let waiter of waiters) {
          if (row.status === 'resolved') {
            waiter.fulfillFromResult(row.result);
          } else {
            waiter.rejectFromResult(row.result);
          }
        }
      }
    }
  }

  private async findCoalesceCandidates(
    queryFn: (expression: Expression) => Promise<unknown>,
    concurrencyGroup: string | null,
  ): Promise<{
    pending: QueueCoalesceCandidate[];
    inFlight: QueueCoalesceCandidate[];
  }> {
    // Pending candidates are locked FOR UPDATE so a concurrent publisher
    // can't merge into the same row. In-flight rows are read in the same
    // snapshot but not locked: the worker is the only writer that should
    // commit a status change on them, and our advisory lock prevents
    // another publisher from racing us on this concurrency group.
    let rows = (await queryFn([
      `SELECT j.id, j.job_type, j.concurrency_group, j.timeout, j.priority, j.args,
              j.initiated_by,
              EXISTS (
                SELECT 1 FROM job_reservations r
                WHERE r.job_id = j.id
                  AND r.locked_until > NOW()
                  AND r.completed_at IS NULL
              ) as in_flight
       FROM jobs j
       WHERE j.status='unfulfilled'
         AND j.concurrency_group IS NOT DISTINCT FROM`,
      param(concurrencyGroup),
      `ORDER BY j.created_at, j.id`,
    ])) as (CoalesceCandidateRow & { in_flight: boolean })[];

    let pendingIds: number[] = [];
    let pending: QueueCoalesceCandidate[] = [];
    let inFlight: QueueCoalesceCandidate[] = [];
    for (let row of rows) {
      let candidate: QueueCoalesceCandidate = {
        id: row.id,
        jobType: row.job_type,
        concurrencyGroup: row.concurrency_group,
        timeout: row.timeout,
        priority: row.priority,
        args: row.args,
        ...(Array.isArray(row.initiated_by)
          ? { initiatedBy: row.initiated_by as string[] }
          : {}),
      };
      if (row.in_flight) {
        inFlight.push(candidate);
      } else {
        pending.push(candidate);
        pendingIds.push(row.id);
      }
    }

    if (pendingIds.length > 0) {
      await queryFn([
        `SELECT id FROM jobs WHERE`,
        ...any(pendingIds.map((id) => [`id=`, param(id)])),
        `FOR UPDATE`,
      ] as Expression);
    }

    return { pending, inFlight };
  }

  private async insertJob(
    queryFn: (expression: Expression) => Promise<unknown>,
    job: QueueJobSpec,
  ) {
    let { nameExpressions, valueExpressions } = asExpressions({
      args: job.args,
      job_type: job.jobType,
      concurrency_group: job.concurrencyGroup,
      priority: job.priority,
      timeout: job.timeout,
      // Left null when the publish named nobody, which is a different answer
      // from an empty set: a row recording no user reads as the realm owner,
      // while one recording an empty set would gate nobody at all.
      initiated_by: job.initiatedBy?.length ? job.initiatedBy : null,
    } as Pick<
      JobsTable,
      | 'args'
      | 'job_type'
      | 'concurrency_group'
      | 'timeout'
      | 'priority'
      | 'initiated_by'
    >);
    let [{ id: jobId }] = (await queryFn([
      'INSERT INTO JOBS',
      ...addExplicitParens(separatedByCommas(nameExpressions)),
      'VALUES',
      ...addExplicitParens(separatedByCommas(valueExpressions)),
      'RETURNING id',
    ] as Expression)) as Pick<JobsTable, 'id'>[];
    return jobId;
  }

  private async jobIsPendingAndUnreserved(
    queryFn: (expression: Expression) => Promise<unknown>,
    jobId: number,
  ): Promise<boolean> {
    let rows = (await queryFn([
      `SELECT j.id
       FROM jobs j
       WHERE j.id =`,
      param(jobId),
      `AND j.status='unfulfilled'
       AND NOT EXISTS (
         SELECT 1 FROM job_reservations r
         WHERE r.job_id = j.id
           AND r.locked_until > NOW()
           AND r.completed_at IS NULL
       )
       FOR UPDATE`,
    ])) as { id: number }[];
    return rows.length > 0;
  }

  private async updateJobForCoalesce(
    queryFn: (expression: Expression) => Promise<unknown>,
    jobId: number,
    update: QueueCoalesceJoinUpdate,
  ): Promise<boolean> {
    let setClauses: Expression[] = [];
    if (update.jobType !== undefined) {
      setClauses.push(['job_type=', param(update.jobType)]);
    }
    if (update.args !== undefined) {
      setClauses.push(['args=', param(update.args)]);
    }
    if (update.priority !== undefined) {
      setClauses.push(['priority=', param(update.priority)]);
    }
    if (update.timeout !== undefined) {
      setClauses.push(['timeout=', param(update.timeout)]);
    }
    if (update.initiatedBy !== undefined) {
      setClauses.push([
        'initiated_by=',
        param(update.initiatedBy.length ? update.initiatedBy : null),
      ]);
    }
    if (setClauses.length === 0) {
      return true;
    }

    let setExpression: Expression = [];
    for (let clause of setClauses) {
      if (setExpression.length > 0) {
        setExpression.push(',');
      }
      setExpression.push(...clause);
    }

    let updatedRows = (await queryFn([
      'UPDATE jobs SET ',
      ...setExpression,
      ' WHERE id=',
      param(jobId),
      `AND status='unfulfilled'
       AND NOT EXISTS (
         SELECT 1 FROM job_reservations r
         WHERE r.job_id = jobs.id
           AND r.locked_until > NOW()
           AND r.completed_at IS NULL
       )
       RETURNING id`,
    ])) as { id: number }[];
    return updatedRows.length > 0;
  }

  private async coalesceAndGetCanonicalJobId(
    incoming: QueueJobSpec,
    coalesce: (context: QueueCoalesceContext) => QueueCoalesceDecision,
  ): Promise<number> {
    return await this.#pgClient.withConnection(async (queryFn) => {
      let shouldRetry = true;
      while (shouldRetry) {
        try {
          await queryFn(['BEGIN']);
          await queryFn(['SET TRANSACTION ISOLATION LEVEL SERIALIZABLE']);
          await acquireConcurrencyGroupLock(queryFn, incoming.concurrencyGroup);

          let { pending, inFlight } = await this.findCoalesceCandidates(
            queryFn,
            incoming.concurrencyGroup,
          );
          let decision = coalesce({
            incoming,
            candidates: pending,
            inFlightCandidates: inFlight,
          });
          let jobId: number;

          if (decision.type === 'insert') {
            let insertJob = decision.job ?? incoming;
            jobId = await this.insertJob(queryFn, insertJob);
          } else {
            jobId = decision.jobId;
            let isInFlightTarget = inFlight.some((c) => c.id === jobId);
            if (isInFlightTarget) {
              // Attaching as a late waiter on an already-claimed job. The
              // worker holds the args in memory and won't see DB writes,
              // so the join must not request an `update`. The waiter is
              // wired up in `publish()` via `addWaiter(jobId, ...)`.
              if (decision.update !== undefined) {
                throw new Error(
                  `coalesce returned a join with update for in-flight job ${jobId}; updates cannot reach a running worker`,
                );
              }
              log.debug(
                `attaching late waiter to in-flight job %s (concurrency group %s)`,
                jobId,
                incoming.concurrencyGroup,
              );
            } else {
              let isStillPending = await this.jobIsPendingAndUnreserved(
                queryFn,
                jobId,
              );
              if (!isStillPending) {
                await queryFn(['ROLLBACK']);
                continue;
              }

              if (decision.update) {
                let wasUpdated = await this.updateJobForCoalesce(
                  queryFn,
                  jobId,
                  decision.update,
                );
                if (!wasUpdated) {
                  await queryFn(['ROLLBACK']);
                  continue;
                }
              }
            }
          }

          await queryFn([`NOTIFY jobs`]);
          await queryFn(['COMMIT']);
          return jobId;
        } catch (e: any) {
          if (e.code === '40001') {
            await queryFn(['ROLLBACK']);
            continue;
          }
          throw e;
        }
      }
      throw new Error('unreachable: coalesce retry loop exited');
    });
  }

  async publish<TResult = PgPrimitive>({
    mapResult,
    ...request
  }: QueuePublishArgs<TResult>): Promise<Job<TResult>> {
    let spec = normalizeQueueJobSpec(request as QueuePublishRequest);
    let coalesce = getQueueJobCoalesceHandler(spec.jobType);
    let jobId = coalesce
      ? await this.coalesceAndGetCanonicalJobId(spec, coalesce)
      : await this.insertJob(this.#query.bind(this), spec);
    if (!coalesce) {
      log.debug(`%s created, notify jobs`, jobId);
      await this.#query([`NOTIFY jobs`]);
    }
    let deferred = new Deferred<TResult>();
    let job = new Job(jobId, deferred);
    let mapper =
      mapResult == null
        ? (identityResultMapper as QueueResultMapper<TResult>)
        : mapResult;
    this.addWaiter(jobId, makeQueueWaiter(deferred, mapper));
    return job;
  }

  async destroy() {
    this.#isDestroyed = true;
    if (this.#notificationRunner) {
      await this.#notificationRunner.shutDown();
    }
  }
}

// Cap on how many times a job can be reserved before we abandon it. Once a
// job has had this many reservation rows, the next claim attempt marks the
// job rejected instead of starting a new attempt. Two attempts means the
// job got an initial run and one full retry; if both reservations end with
// the job still 'unfulfilled', the symptom is almost always a deterministic
// crash in the worker — looping forever just burns wall-clock waiting on
// 7200s leases.
const MAX_RESERVATION_COUNT_PER_JOB = 2;

export class PgQueueRunner implements QueueRunner {
  #isDestroyed = false;
  #pgClient: PgAdapter;
  #workerId: string;
  #maxTimeoutSec: number;
  #maxReservationCount: number;
  #pollInterval = 10000;
  #handlers: Map<string, Function> = new Map();
  #jobRunner: WorkLoop | undefined;
  #priority: number;

  constructor({
    adapter,
    workerId,
    maxTimeoutSec = MAX_JOB_TIMEOUT_SEC,
    maxReservationCount = MAX_RESERVATION_COUNT_PER_JOB,
    priority = 0,
  }: {
    adapter: PgAdapter;
    workerId: string;
    priority?: number;
    maxTimeoutSec?: number;
    maxReservationCount?: number;
  }) {
    this.#pgClient = adapter;
    this.#workerId = workerId;
    this.#maxTimeoutSec = maxTimeoutSec;
    this.#maxReservationCount = maxReservationCount;
    this.#priority = priority;
  }

  get priority() {
    return this.#priority;
  }

  register<A, T>(jobType: string, handler: (arg: A) => Promise<T>) {
    log.info(
      `registering job handler for %s, workerId: %s`,
      jobType,
      this.#workerId,
    );
    this.#handlers.set(jobType, handler);
  }

  async start() {
    if (!this.#jobRunner && !this.#isDestroyed) {
      this.#jobRunner = new WorkLoop('jobRunner', this.#pollInterval);
      this.#jobRunner.run(async (loop) => {
        await this.#pgClient.listen('jobs', loop.wake.bind(loop), async () => {
          while (!loop.shuttingDown) {
            await this.processJobs(loop);
            await loop.sleep();
          }
        });
      });
    }
  }

  private async runJob(jobType: string, args: PgPrimitive, jobInfo: JobInfo) {
    let handler = this.#handlers.get(jobType);
    if (!handler) {
      throw new Error(`unknown job handler ${jobType}`);
    }

    if (
      args &&
      typeof args === 'object' &&
      !Array.isArray(args) &&
      !('jobInfo' in args)
    ) {
      args.jobInfo = jobInfo;
    }
    return await handler(args);
  }

  private async processJobs(workLoop: WorkLoop) {
    if (this.#handlers.size === 0) {
      // nothing this runner could execute — and the claim query's
      // job-type filter would be malformed with an empty IN list
      return;
    }
    await this.#pgClient.withConnection(async (query) => {
      try {
        while (!workLoop.shuttingDown) {
          log.debug(`%s: processing jobs`, this.#workerId);

          await query(['BEGIN']);
          await query(['SET TRANSACTION ISOLATION LEVEL SERIALIZABLE']);

          let jobs = (await query([
            // find the queue with the oldest job that isn't running and lock it.
            // Break created_at ties on the monotonic id so the job enqueued
            // first always wins — two jobs in the same concurrency group can
            // share a created_at (current_timestamp is the transaction start
            // time), and without the tiebreaker the worker could claim them
            // out of enqueue order.
            `WITH
              pending_jobs AS (
                SELECT * FROM jobs j WHERE j.status='unfulfilled'
                  -- A held concurrency group's jobs stay pending rather than
                  -- being claimed, so a burst of same-group publishes has a
                  -- pending job to coalesce into (see the add-job-claim-holds
                  -- migration). Normally there is nothing to match, and a
                  -- lease its holder stops refreshing expires on its own.
                  --
                  -- A hold only ever delays background work. Anything at the
                  -- user-initiated tier is on someone's critical path — a
                  -- publish does not report its realm ready until the render
                  -- it is waiting on lands, and that render is enqueued at
                  -- this tier precisely to say so — so a hold must not be
                  -- able to keep it waiting.
                  AND (j.priority >=`,
            param(userInitiatedPriority),
            `OR NOT EXISTS (
                    SELECT 1 FROM job_claim_holds h
                     WHERE h.concurrency_group = j.concurrency_group
                       AND h.expires_at > NOW()
                  ))
                  and j.priority >=`,
            param(this.#priority),
            // Only claim job types this runner has a handler for: a worker
            // that claims a type it can't run would finalize the job as
            // rejected, permanently discarding work a differently-configured
            // worker (e.g. a newer version mid rolling-deploy) could have
            // completed.
            `AND j.job_type IN (`,
            ...[...this.#handlers.keys()].flatMap((jobType, i) =>
              i === 0 ? [param(jobType)] : [',', param(jobType)],
            ),
            `)),
              valid_reservations AS (
                SELECT * FROM job_reservations WHERE locked_until > NOW() AND completed_at IS NULL
              ),
              active_concurrency_groups AS (
                SELECT DISTINCT j.concurrency_group FROM jobs j, valid_reservations v WHERE v.job_id = j.id
            )
            SELECT j.* FROM pending_jobs j
              WHERE j.id NOT IN (
                SELECT job_id FROM valid_reservations
              )
              AND j.concurrency_group NOT IN (
                SELECT concurrency_group FROM active_concurrency_groups
              )
              ORDER BY j.created_at, j.id
              LIMIT 1`,
          ])) as unknown as JobsTable[];
          if (jobs.length === 0) {
            log.debug(`%s: found no work`, this.#workerId);
            await query(['ROLLBACK']);
            return;
          }
          let jobToRun = jobs[0];
          log.debug(
            `%s: found job to run, job id: %s`,
            this.#workerId,
            jobToRun.id,
          );

          await acquireConcurrencyGroupLock(query, jobToRun.concurrency_group);

          let jobIsStillEligible = (await query([
            // queue_wait_ms is computed against the database clock — the same
            // clock that stamped created_at — so it needs no client-side
            // timestamp parsing (created_at arrives as a timezone-less string
            // on some adapters).
            `SELECT j.id, (EXTRACT(EPOCH FROM (NOW() - j.created_at)) * 1000)::bigint AS queue_wait_ms
             FROM jobs j
             WHERE j.id =`,
            param(jobToRun.id),
            `AND j.status='unfulfilled'
             AND NOT EXISTS (
               SELECT 1 FROM job_reservations r
               WHERE r.job_id = j.id
                 AND r.locked_until > NOW()
                 AND r.completed_at IS NULL
             )
             FOR UPDATE`,
          ])) as { id: number; queue_wait_ms: number | string }[];
          if (jobIsStillEligible.length === 0) {
            await query(['ROLLBACK']);
            continue;
          }

          // Abandon the job after #maxReservationCount genuine attempts.
          // Count only reservations that closed with a real verdict
          // (`completion_reason = 'completed'`) plus still-open ones
          // (NULL). Reservations closed as `'interrupted'` or
          // `'timeout-expired'` (deploy, autoscaler, child crash, dropped
          // PG connection) don't count — the worker never had an
          // uninterrupted shot at the job, so re-trying isn't a failed
          // attempt.
          let priorReservations = (await query([
            `SELECT COUNT(*)::int as count FROM job_reservations
             WHERE job_id =`,
            param(jobToRun.id),
            `AND (completion_reason IS NULL OR completion_reason = 'completed')`,
          ])) as unknown as { count: number }[];
          if (priorReservations[0].count >= this.#maxReservationCount) {
            await query([
              `UPDATE jobs SET `,
              ...separatedByCommas([
                [
                  `result =`,
                  param({
                    status: 500,
                    message: `Job abandoned after ${priorReservations[0].count} failed attempts (max=${this.#maxReservationCount})`,
                  }),
                ],
                [`status = 'rejected'`],
                [`finished_at = NOW()`],
              ]),
              `WHERE id =`,
              param(jobToRun.id),
            ] as Expression);
            await query([`NOTIFY jobs_finished`]);
            await query(['COMMIT']);
            log.info(
              `%s: abandoned job %s after %s prior reservations (max=%s)`,
              this.#workerId,
              jobToRun.id,
              priorReservations[0].count,
              this.#maxReservationCount,
            );
            continue;
          }

          // The handler's deadline. The lease outlives it by
          // LEASE_GRACE_SEC — see the constant — so the two do not expire
          // together.
          let effectiveTimeoutSec = Math.min(
            jobToRun.timeout,
            this.#maxTimeoutSec,
          );
          let leaseSec = effectiveTimeoutSec + LEASE_GRACE_SEC;
          let [{ id: jobReservationId }] = (await query([
            'INSERT INTO job_reservations (job_id, locked_until, worker_id) values (',
            ...separatedByCommas([
              [param(jobToRun.id)],
              ['(', param(leaseSec), ` || ' seconds')::interval + now()`],
              [param(this.#workerId)],
            ]),
            ') RETURNING id',
          ] as Expression)) as Pick<JobReservationsTable, 'id'>[];

          await query(['COMMIT']); // this should fail in the case of a concurrency conflict

          // Queue-wait rides at info so CI logs surface worker starvation:
          // with few (or one) workers, a long-running job serializes everything
          // behind it, and a large wait on a user-initiated job is the direct
          // signal of that — without it a stalled dequeue is indistinguishable
          // from slow job execution.
          let queueWaitMs = Number(jobIsStillEligible[0].queue_wait_ms);
          log.info(
            `%s: starting job %s (type=%s priority=%s group=%s) after %s in queue`,
            this.#workerId,
            jobToRun.id,
            jobToRun.job_type,
            jobToRun.priority,
            jobToRun.concurrency_group,
            Number.isFinite(queueWaitMs)
              ? `${queueWaitMs}ms`
              : 'an unknown wait',
          );
          log.debug(
            `%s: claimed job %s, reservation %s`,
            this.#workerId,
            jobToRun.id,
            jobReservationId,
          );
          let newStatus: string;
          let result: PgPrimitive;
          try {
            log.debug(`%s: running %s`, this.#workerId, jobToRun.id);
            // The deadline is re-armed by every heartbeat, so it measures
            // time *without progress* rather than total runtime. A handler
            // that never heartbeats sees one deadline from the start, exactly
            // as before.
            let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
            let onDeadline: (() => void) | undefined;
            let armDeadline = () => {
              if (deadlineTimer) {
                clearTimeout(deadlineTimer);
              }
              deadlineTimer = setTimeout(() => {
                onDeadline?.();
              }, effectiveTimeoutSec * 1000);
              deadlineTimer.unref();
            };
            // Pushing `locked_until` out is a write, and progress arrives per
            // file — thousands of times on a large pass. Throttle it, but at a
            // fraction of the grace window rather than the whole of it: two
            // heartbeats can be a full deadline apart, so throttling on the
            // grace itself would let the gap between extensions reach exactly
            // the lease being written, leaving no margin at all. Half buys real
            // headroom at the same negligible write rate.
            let leaseExtensionIntervalMs = (LEASE_GRACE_SEC / 2) * 1000;
            let lastLeaseExtension = Date.now();
            let extendLease = () => {
              if (Date.now() - lastLeaseExtension < leaseExtensionIntervalMs) {
                return;
              }
              // Fire-and-forget on the pool rather than this loop's
              // connection, which is mid-transaction for the next claim. A
              // failed extension only costs the job its lease, which is the
              // pre-existing behaviour.
              void this.#pgClient
                .execute(
                  `UPDATE job_reservations
                     SET locked_until = (($1 || ' seconds')::interval + NOW())
                     WHERE id = $2 AND completed_at IS NULL`,
                  { bind: [String(leaseSec), jobReservationId] },
                )
                .then(() => {
                  // Stamped on completion rather than on the decision, so a
                  // slow write does not also suppress the next attempt for a
                  // further interval.
                  lastLeaseExtension = Date.now();
                })
                .catch((e: unknown) => {
                  log.warn(
                    `%s: could not extend lease for job %s: %s`,
                    this.#workerId,
                    jobToRun.id,
                    (e as Error)?.message ?? e,
                  );
                });
            };
            let jobStartedAt = Date.now();
            registerJobHeartbeat(jobReservationId, () => {
              armDeadline();
              extendLease();
            });
            armDeadline();

            result = await Promise.race([
              this.runJob(jobToRun.job_type, jobToRun.args, {
                jobId: jobToRun.id,
                reservationId: jobReservationId,
                priority: jobToRun.priority,
                queueWaitMs: Number.isFinite(queueWaitMs) ? queueWaitMs : null,
              }),
              // We race the job so a promise that never resolves cannot hold
              // this worker hostage. What counts as "never resolves" is now
              // "made no progress for a whole deadline" — a job that keeps
              // heartbeating re-arms the timer and extends its lease, so a
              // long pass is bounded by going quiet rather than by taking
              // time. A job that goes quiet still loses the worker, which is
              // what puts a genuinely wedged handler in front of the
              // stuck-job watchdog.
              new Promise<'timeout'>((r) => {
                onDeadline = () => r('timeout');
              }),
            ]).finally(() => {
              // On the race, not on the handler. The timeout exists precisely
              // for a handler promise that never settles, so cleanup hung off
              // the handler would never run in the one case it matters — the
              // registry would retain the callback and its closures for every
              // wedged job, and late progress from an abandoned handler would
              // keep arming timers nobody is waiting on.
              unregisterJobHeartbeat(jobReservationId);
              clearTimeout(deadlineTimer);
            });
            if (result === 'timeout') {
              // The number is the silence window, not the elapsed time: a job
              // that keeps reporting progress can run far past it. Say so, and
              // carry the elapsed time, so a reader triaging this against the
              // job's `created_at` is not misled.
              throw new Error(
                `Timed-out after ${effectiveTimeoutSec}s without progress from job ${
                  jobToRun.id
                } (ran ${Math.round((Date.now() - jobStartedAt) / 1000)}s)`,
              );
            }
            newStatus = 'resolved';
          } catch (err: any) {
            Sentry.captureException(err);
            // ECONNREFUSED typically means the upstream's port wasn't bound
            // when the job tried to reach it — common during boot, where
            // workers can come up before their upstream service. Log a
            // single line so a transient startup race doesn't bury genuine
            // job failures in stack-trace noise; Sentry still captures the
            // full error for deployed-environment visibility.
            let cause = err?.cause;
            if (
              err?.code === 'ECONNREFUSED' ||
              cause?.code === 'ECONNREFUSED'
            ) {
              let target =
                cause?.address && cause?.port
                  ? `${cause.address}:${cause.port}`
                  : 'upstream';
              console.warn(
                `job ${jobToRun.id} (${jobToRun.job_type}) failed: ECONNREFUSED to ${target}`,
              );
            } else {
              console.error(
                `Error running job ${jobToRun.id}: jobType=${
                  jobToRun.job_type
                } args=${JSON.stringify(jobToRun.args)}`,
                err,
              );
            }
            result = flattenErrorForJsonb(err);
            newStatus = 'rejected';
          }
          log.debug(
            `%s: finished %s as %s`,
            this.#workerId,
            jobToRun.id,
            newStatus,
          );
          let outcome = await finalizeJobVerdict(
            query,
            this.#workerId,
            jobToRun,
            jobReservationId,
            newStatus,
            result,
          );
          if (outcome.type !== 'committed') {
            // The verdict is gone either way. What must not also be lost is
            // the reservation: an open row whose lease has aged out is
            // indistinguishable, to the worker-manager watchdog, from a
            // worker wedged inside its handler — so it would reject this
            // job and kill this (healthy) worker up to a full lease later.
            await releaseJobReservation(
              query,
              this.#workerId,
              jobToRun.id,
              jobReservationId,
              outcome,
            );
            return;
          }
          log.debug(
            `%s: committed job completion, notified jobs_finished`,
            this.#workerId,
          );
        }
      } catch (e: any) {
        // Reachable for the claim transaction only — `finalizeJob` handles
        // its own serialization failures, because bailing out there loses a
        // verdict the handler already produced. A conflict while claiming
        // costs nothing: no handler has run, and the next poll re-claims.
        if (e.code === '40001') {
          log.debug(
            `%s: detected concurrency conflict, rolling back`,
            this.#workerId,
          );
          await query(['ROLLBACK']);
          return;
        }
        throw e;
      }
    });
  }

  async destroy() {
    this.#isDestroyed = true;
    if (this.#jobRunner) {
      await this.#jobRunner.shutDown();
    }
  }
}
