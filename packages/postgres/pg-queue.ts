import './instrument';
import {
  type QueuePublisher,
  type QueueRunner,
  type PgPrimitive,
  type Expression,
  type JobInfo,
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
import { PgAdapter } from './pg-adapter';
import * as Sentry from '@sentry/node';

const log = logger('queue');

interface JobsTable {
  id: number;
  job_type: string;
  concurrency_group: string | null;
  timeout: number;
  priority: number;
  args: Record<string, any>;
  status: 'unfulfilled' | 'resolved' | 'rejected';
  created_at: Date;
  finished_at: Date;
  result: Record<string, any>;
}

interface JobReservationsTable {
  id: number;
  job_id: number;
  created_at: Date;
  locked_until: Date;
  completed_at: Date;
  worker_id: string;
}

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

export class PgQueuePublisher implements QueuePublisher {
  #isDestroyed = false;
  #pgClient: PgAdapter;
  #pollInterval = 10000;
  #notifiers: Map<number, Deferred<any>> = new Map();
  #notificationRunner: WorkLoop | undefined;

  constructor(pgClient: PgAdapter) {
    this.#pgClient = pgClient;
  }

  async #query(expression: Expression) {
    return await query(this.#pgClient, expression);
  }

  private addNotifier(id: number, n: Deferred<any>) {
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
    this.#notifiers.set(id, n);
  }

  private async drainNotifications(loop: WorkLoop) {
    while (!loop.shuttingDown) {
      let waitingIds = [...this.#notifiers.keys()];
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
        // "!" because we only searched for rows matching our notifiers Map, and
        // we are the only code that deletes from that Map.
        let notifier = this.#notifiers.get(row.id)!;
        this.#notifiers.delete(row.id);
        if (row.status === 'resolved') {
          notifier.fulfill(row.result);
        } else {
          notifier.reject(row.result);
        }
      }
    }
  }

  async publish<T>({
    jobType,
    concurrencyGroup,
    timeout, // in seconds
    priority = 0,
    args,
  }: {
    jobType: string;
    concurrencyGroup: string | null;
    priority?: number;
    timeout: number; // in seconds
    args: PgPrimitive;
  }): Promise<Job<T>> {
    let { nameExpressions, valueExpressions } = asExpressions({
      args,
      job_type: jobType,
      concurrency_group: concurrencyGroup,
      priority,
      timeout,
    } as Pick<
      JobsTable,
      'args' | 'job_type' | 'concurrency_group' | 'timeout' | 'priority'
    >);
    let [{ id: jobId }] = (await this.#query([
      'INSERT INTO JOBS',
      ...addExplicitParens(separatedByCommas(nameExpressions)),
      'VALUES',
      ...addExplicitParens(separatedByCommas(valueExpressions)),
      'RETURNING id',
    ] as Expression)) as Pick<JobsTable, 'id'>[];
    log.debug(`%s created, notify jobs`, jobId);
    await this.#query([`NOTIFY jobs`]);
    let notifier = new Deferred<T>();
    let job = new Job(jobId, notifier);
    this.addNotifier(jobId, notifier);
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
    maxTimeoutSec = 10 * 60,
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

function serializableError(err: any): Record<string, any> {
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
