import './instrument';
import {
  type QueuePublisher,
  type QueueRunner,
  type QueuePublishArgs,
  type QueuePublishRequest,
  type QueueCoalesceJoinUpdate,
  type QueueResultMapper,
  type QueueJobSpec,
  type QueueCoalesceCandidate,
  type QueueCoalesceContext,
  type QueueCoalesceDecision,
  type PgPrimitive,
  type Expression,
  type JobInfo,
  getQueueJobCoalesceHandler,
  param,
  separatedByCommas,
  addExplicitParens,
  any,
  query,
  logger,
  asExpressions,
  Deferred,
  Job,
} from '@cardstack/runtime-common';
import { FROM_SCRATCH_JOB_TIMEOUT_SEC } from '@cardstack/runtime-common/tasks/indexer';
import type { PgAdapter } from './pg-adapter';
import * as Sentry from '@sentry/node';

const log = logger('queue');
const MAX_JOB_TIMEOUT_SEC = FROM_SCRATCH_JOB_TIMEOUT_SEC;

interface JobsTable {
  id: number;
  job_type: string;
  concurrency_group: string | null;
  timeout: number;
  priority: number;
  args: PgPrimitive;
  status: 'unfulfilled' | 'resolved' | 'rejected';
  created_at: Date;
  finished_at: Date;
  result: PgPrimitive;
}

interface JobReservationsTable {
  id: number;
  job_id: number;
  created_at: Date;
  locked_until: Date;
  completed_at: Date;
  worker_id: string;
}

interface Waiter {
  fulfillFromResult: (result: PgPrimitive) => void;
  rejectFromResult: (result: PgPrimitive) => void;
  reject: (error: unknown) => void;
}

interface CoalesceCandidateRow extends Pick<
  JobsTable,
  'id' | 'job_type' | 'concurrency_group' | 'timeout' | 'priority' | 'args'
> {}

// Tracks a task that should loop with a timeout and an interruptible sleep.
class WorkLoop {
  private internalWaker: Deferred<void> | undefined;
  private timeout: NodeJS.Timeout | undefined;
  private _shuttingDown = false;
  private runnerPromise: Promise<void> | undefined;

  constructor(
    private label: string,
    private pollInterval: number,
  ) {}

  // 1. Your fn should loop until workLoop.shuttingDown is true.
  // 2. When it has no work to do, it should await workLoop.sleep().
  // 3. It can be awoke with workLoop.wake().
  // 4. Remember to await workLoop.shutdown() when you're done.
  //
  // This is separate from the constructor so you can store your WorkLoop first,
  // *before* the runner starts doing things.
  run(fn: (loop: WorkLoop) => Promise<void>) {
    this.runnerPromise = fn(this);
  }

  async shutDown(): Promise<void> {
    log.debug(`[workloop %s] shutting down`, this.label);
    this._shuttingDown = true;
    this.wake();
    await this.runnerPromise;
    log.debug(`[workloop %s] completed shutdown`, this.label);
  }

  get shuttingDown(): boolean {
    return this._shuttingDown;
  }

  private get waker() {
    if (!this.internalWaker) {
      this.internalWaker = new Deferred();
    }
    return this.internalWaker;
  }

  wake() {
    log.debug(`[workloop %s] waking up`, this.label);
    this.waker.fulfill();
  }

  async sleep() {
    if (this.shuttingDown) {
      return;
    }
    let timerPromise = new Promise((resolve) => {
      this.timeout = setTimeout(resolve, this.pollInterval).unref();
    });
    log.debug(`[workloop %s] entering promise race`, this.label);
    await Promise.race([this.waker.promise, timerPromise]);
    log.debug(`[workloop] leaving promise race`, this.label);
    if (this.timeout != null) {
      clearTimeout(this.timeout);
    }
    this.internalWaker = undefined;
  }
}

function normalizeQueueJobSpec(args: QueuePublishRequest): QueueJobSpec {
  return {
    ...args,
    priority: args.priority ?? 0,
  };
}

const identityResultMapper: QueueResultMapper<PgPrimitive> = (result) => result;

function makeWaiter<TResult>(
  deferred: Deferred<TResult>,
  mapResult: QueueResultMapper<TResult>,
): Waiter {
  let mapAndFulfill = (result: PgPrimitive) => {
    try {
      deferred.fulfill(mapResult(result));
    } catch (error: unknown) {
      deferred.reject(error);
    }
  };
  let mapAndReject = (result: PgPrimitive) => {
    try {
      deferred.reject(mapResult(result));
    } catch (error: unknown) {
      deferred.reject(error);
    }
  };
  return {
    fulfillFromResult(result: PgPrimitive) {
      mapAndFulfill(result);
    },
    rejectFromResult(result: PgPrimitive) {
      mapAndReject(result);
    },
    reject(error: unknown) {
      deferred.reject(error);
    },
  };
}

export class PgQueuePublisher implements QueuePublisher {
  #isDestroyed = false;
  #pgClient: PgAdapter;
  #pollInterval = 10000;
  #notifiers: Map<number, Set<Waiter>> = new Map();
  #notificationRunner: WorkLoop | undefined;

  constructor(pgClient: PgAdapter) {
    this.#pgClient = pgClient;
  }

  async #query(expression: Expression) {
    return await query(this.#pgClient, expression);
  }

  private addWaiter(id: number, waiter: Waiter) {
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

  private async acquireConcurrencyGroupLock(
    queryFn: (expression: Expression) => Promise<unknown>,
    concurrencyGroup: string | null,
  ) {
    await queryFn([
      'SELECT pg_advisory_xact_lock(hashtext(',
      param(concurrencyGroup ?? '__queue_no_concurrency_group__'),
      '))',
    ]);
  }

  private async findPendingCandidates(
    queryFn: (expression: Expression) => Promise<unknown>,
    concurrencyGroup: string | null,
  ): Promise<QueueCoalesceCandidate[]> {
    let rows = (await queryFn([
      `SELECT j.id, j.job_type, j.concurrency_group, j.timeout, j.priority, j.args
       FROM jobs j
       WHERE j.status='unfulfilled'
         AND j.concurrency_group IS NOT DISTINCT FROM`,
      param(concurrencyGroup),
      `AND NOT EXISTS (
          SELECT 1
          FROM job_reservations r
          WHERE r.job_id = j.id
            AND r.locked_until > NOW()
            AND r.completed_at IS NULL
       )
       ORDER BY j.created_at, j.id
       FOR UPDATE`,
    ])) as CoalesceCandidateRow[];
    return rows.map((row) => ({
      id: row.id,
      jobType: row.job_type,
      concurrencyGroup: row.concurrency_group,
      timeout: row.timeout,
      priority: row.priority,
      args: row.args,
    }));
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
    } as Pick<
      JobsTable,
      'args' | 'job_type' | 'concurrency_group' | 'timeout' | 'priority'
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
          await this.acquireConcurrencyGroupLock(
            queryFn,
            incoming.concurrencyGroup,
          );

          let candidates = await this.findPendingCandidates(
            queryFn,
            incoming.concurrencyGroup,
          );
          let decision = coalesce({ incoming, candidates });
          let jobId: number;

          if (decision.type === 'insert') {
            let insertJob = decision.job ?? incoming;
            jobId = await this.insertJob(queryFn, insertJob);
          } else {
            jobId = decision.jobId;
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
    this.addWaiter(jobId, makeWaiter(deferred, mapper));
    return job;
  }

  async destroy() {
    this.#isDestroyed = true;
    if (this.#notificationRunner) {
      await this.#notificationRunner.shutDown();
    }
  }
}

export class PgQueueRunner implements QueueRunner {
  #isDestroyed = false;
  #pgClient: PgAdapter;
  #workerId: string;
  #maxTimeoutSec: number;
  #pollInterval = 10000;
  #handlers: Map<string, Function> = new Map();
  #jobRunner: WorkLoop | undefined;
  #priority: number;

  constructor({
    adapter,
    workerId,
    maxTimeoutSec = MAX_JOB_TIMEOUT_SEC,
    priority = 0,
  }: {
    adapter: PgAdapter;
    workerId: string;
    priority?: number;
    maxTimeoutSec?: number;
  }) {
    this.#pgClient = adapter;
    this.#workerId = workerId;
    this.#maxTimeoutSec = maxTimeoutSec;
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

  private async acquireConcurrencyGroupLock(
    queryFn: (expression: Expression) => Promise<unknown>,
    concurrencyGroup: string | null,
  ) {
    await queryFn([
      'SELECT pg_advisory_xact_lock(hashtext(',
      param(concurrencyGroup ?? '__queue_no_concurrency_group__'),
      '))',
    ]);
  }

  private async processJobs(workLoop: WorkLoop) {
    await this.#pgClient.withConnection(async (query) => {
      try {
        while (!workLoop.shuttingDown) {
          log.debug(`%s: processing jobs`, this.#workerId);

          await query(['BEGIN']);
          await query(['SET TRANSACTION ISOLATION LEVEL SERIALIZABLE']);

          let jobs = (await query([
            // find the queue with the oldest job that isn't running and lock it.
            `WITH
              pending_jobs AS (
                SELECT * FROM jobs WHERE status='unfulfilled' and priority >=`,
            param(this.#priority),
            `),
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
              ORDER BY j.created_at
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

          await this.acquireConcurrencyGroupLock(
            query,
            jobToRun.concurrency_group,
          );

          let jobIsStillEligible = (await query([
            `SELECT j.id
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
          ])) as { id: number }[];
          if (jobIsStillEligible.length === 0) {
            await query(['ROLLBACK']);
            continue;
          }

          let [{ id: jobReservationId }] = (await query([
            'INSERT INTO job_reservations (job_id, locked_until, worker_id) values (',
            ...separatedByCommas([
              [param(jobToRun.id)],
              [
                '(',
                param(Math.min(jobToRun.timeout, this.#maxTimeoutSec)),
                ` || ' seconds')::interval + now()`,
              ],
              [param(this.#workerId)],
            ]),
            ') RETURNING id',
          ] as Expression)) as Pick<JobReservationsTable, 'id'>[];

          await query(['COMMIT']); // this should fail in the case of a concurrency conflict

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
            result = await Promise.race([
              this.runJob(jobToRun.job_type, jobToRun.args, {
                jobId: jobToRun.id,
                reservationId: jobReservationId,
              }),
              // we race the job so that it doesn't hold this worker hostage if
              // the job's promise never resolves
              new Promise<'timeout'>((r) =>
                setTimeout(() => {
                  r('timeout');
                }, this.#maxTimeoutSec * 1000).unref(),
              ),
            ]);
            if (result === 'timeout') {
              throw new Error(
                `Timed-out after ${this.#maxTimeoutSec}s waiting for job ${
                  jobToRun.id
                } to complete`,
              );
            }
            newStatus = 'resolved';
          } catch (err: any) {
            Sentry.captureException(err);
            console.error(
              `Error running job ${jobToRun.id}: jobType=${
                jobToRun.job_type
              } args=${JSON.stringify(jobToRun.args)}`,
              err,
            );
            result = serializableError(err);
            newStatus = 'rejected';
          }
          log.debug(
            `%s: finished %s as %s`,
            this.#workerId,
            jobToRun.id,
            newStatus,
          );
          await query(['BEGIN']);
          await query(['SET TRANSACTION ISOLATION LEVEL SERIALIZABLE']);
          let [{ status: jobStatus }] = (await query([
            'SELECT status FROM jobs WHERE id = ',
            param(jobToRun.id),
          ])) as Pick<JobsTable, 'status'>[];
          if (jobStatus !== 'unfulfilled') {
            log.debug(
              '%s: rolling back because our job is already marked done',
              this.#workerId,
            );
            await query(['ROLLBACK']);
            return;
          }
          let [jobReservation] = (await query([
            'SELECT *, locked_until < NOW() as expired FROM job_reservations WHERE id = ',
            param(jobReservationId),
          ])) as unknown as (JobReservationsTable & { expired: boolean })[];
          if (jobReservation.completed_at) {
            log.debug(
              '%s: rolling back because someone else processed our job',
              this.#workerId,
            );
            await query(['ROLLBACK']);
            return;
          }
          if (jobReservation.expired) {
            // check to see if there are any other reservations for this job
            let [{ total }] = (await query([
              'SELECT COUNT(*) as total FROM job_reservations WHERE job_id = ',
              param(jobToRun.id),
              'AND id != ',
              param(jobReservationId),
            ])) as unknown as { total: number }[];
            if (total > 0) {
              log.debug(
                '%s: rolling back because someone else has reserved our (timed-out) job',
                this.#workerId,
              );
              await query(['ROLLBACK']);
              return;
            }
          }
          // All good, let's persist our results
          await query([
            `UPDATE jobs SET result=`,
            param(result),
            ', status=',
            param(newStatus),
            `, finished_at=now() WHERE id = `,
            param(jobToRun.id),
          ]);
          await query([
            `UPDATE job_reservations SET completed_at = now() WHERE id = `,
            param(jobReservationId),
          ]);
          // NOTIFY takes effect when the transaction actually commits. If it
          // doesn't commit, no notification goes out.
          await query([`NOTIFY jobs_finished`]);
          await query(['COMMIT']);
          log.debug(
            `%s: committed job completion, notified jobs_finished`,
            this.#workerId,
          );
        }
      } catch (e: any) {
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

export function serializableError(err: any): Record<string, any> {
  try {
    let result = Object.create(null);
    for (let field of Object.getOwnPropertyNames(err)) {
      result[field] = err[field];
    }
    return result;
  } catch (megaError) {
    let stringish: string | undefined;
    try {
      stringish = String(err);
    } catch (_ignored) {
      // ignoring
    }
    return {
      failedToSerializeError: true,
      string: stringish,
    };
  }
}
