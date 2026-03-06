import debounce from 'lodash/debounce';

import {
  type QueueRunner,
  type QueuePublisher,
  type QueuePublishArgs,
  type QueueResultMapper,
  type QueueWaiter,
  type QueueCoalesceCandidate,
  type PgPrimitive,
  getQueueJobCoalesceHandler,
  normalizeQueueJobSpec,
  identityResultMapper,
  makeQueueWaiter,
  Job,
  Deferred,
} from '@cardstack/runtime-common';

let id = 0;

interface QueueWorkItem {
  jobType: string;
  concurrencyGroup: string | null;
  timeout: number;
  priority: number;
  args: PgPrimitive;
  id: number;
  waiters: Set<QueueWaiter>;
}

export class BrowserQueue implements QueuePublisher, QueueRunner {
  #isDestroyed = false;
  #hasStarted = false;
  #flush: Promise<void> | undefined;

  // no need for "onAfterJob--that's just the Job.done promise
  constructor(private onBeforeJob?: (jobId: number) => void) {}

  private jobs: QueueWorkItem[] = [];
  private types: Map<string, (arg: any) => Promise<any>> = new Map();

  get isDestroyed() {
    return this.#isDestroyed;
  }

  get hasStarted() {
    return this.#hasStarted;
  }

  async flush() {
    await this.#flush;
  }

  async start() {
    this.#hasStarted = true;
  }

  register<A, T>(category: string, handler: (arg: A) => Promise<T>) {
    if (this.isDestroyed) {
      throw new Error(`Cannot register category on a destroyed Queue`);
    }
    this.types.set(category, handler);
    this.debouncedDrainJobs();
  }

  async publish<TResult = PgPrimitive>({
    mapResult,
    ...request
  }: QueuePublishArgs<TResult>): Promise<Job<TResult>> {
    if (this.isDestroyed) {
      throw new Error(`Cannot publish job on a destroyed Queue`);
    }
    let incoming = normalizeQueueJobSpec(request);
    let coalesce = getQueueJobCoalesceHandler(incoming.jobType);

    let workItem: QueueWorkItem;
    if (!coalesce) {
      workItem = {
        ...incoming,
        id: ++id,
        waiters: new Set(),
      };
      this.jobs.push(workItem);
    } else {
      let candidates: QueueCoalesceCandidate[] = this.jobs
        .filter((job) => job.concurrencyGroup === incoming.concurrencyGroup)
        .map((job) => ({
          id: job.id,
          jobType: job.jobType,
          concurrencyGroup: job.concurrencyGroup,
          timeout: job.timeout,
          priority: job.priority,
          args: job.args,
        }));
      let decision = coalesce({ incoming, candidates });

      if (decision.type === 'insert') {
        let jobSpec = decision.job ?? incoming;
        workItem = {
          ...jobSpec,
          id: ++id,
          waiters: new Set(),
        };
        this.jobs.push(workItem);
      } else {
        let existingWorkItem = this.jobs.find(
          (job) => job.id === decision.jobId,
        );
        if (!existingWorkItem) {
          workItem = {
            ...incoming,
            id: ++id,
            waiters: new Set(),
          };
          this.jobs.push(workItem);
        } else {
          workItem = existingWorkItem;
        }
        if (decision.update) {
          if (decision.update.jobType !== undefined) {
            workItem.jobType = decision.update.jobType;
          }
          if (decision.update.args !== undefined) {
            workItem.args = decision.update.args;
          }
          if (decision.update.priority !== undefined) {
            workItem.priority = decision.update.priority;
          }
          if (decision.update.timeout !== undefined) {
            workItem.timeout = decision.update.timeout;
          }
        }
      }
    }

    let deferred = new Deferred<TResult>();
    workItem.waiters.add(
      makeQueueWaiter(
        deferred,
        mapResult == null
          ? (identityResultMapper as QueueResultMapper<TResult>)
          : mapResult,
      ),
    );
    this.debouncedDrainJobs();
    return new Job(workItem.id, deferred);
  }

  private debouncedDrainJobs = debounce(() => {
    this.drainJobs();
  }, 1);

  private async drainJobs() {
    await this.flush();

    let jobsDrained: () => void;
    this.#flush = new Promise((res) => (jobsDrained = res));
    let jobs = [...this.jobs];
    this.jobs = [];
    for (let workItem of jobs) {
      let { id: jobId, jobType, args } = workItem;
      let handler = this.types.get(jobType);
      if (!handler) {
        // no handler for this job, add it back to the queue
        this.jobs.push(workItem);
        continue;
      }

      if (this.onBeforeJob) {
        this.onBeforeJob(jobId);
      }
      try {
        let result = await handler(args);
        for (let waiter of workItem.waiters) {
          waiter.fulfillFromResult(result as PgPrimitive);
        }
      } catch (e: unknown) {
        for (let waiter of workItem.waiters) {
          waiter.rejectFromResult(e as PgPrimitive);
        }
      }
    }

    jobsDrained!();
  }

  async destroy() {
    this.#isDestroyed = true;
    await this.flush();
  }
}
