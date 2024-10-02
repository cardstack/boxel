import debounce from 'lodash/debounce';

import {
  type QueueRunner,
  type QueuePublisher,
  type PgPrimitive,
  Job,
  Deferred,
} from '@cardstack/runtime-common';

let id = 0;

export class BrowserQueue implements QueuePublisher, QueueRunner {
  #isDestroyed = false;
  #hasStarted = false;
  #flush: Promise<void> | undefined;

  // no need for "onAfterJob--that's just the Job.done promise
  constructor(private onBeforeJob?: (jobId: number) => void) {}

  private jobs: {
    jobId: number;
    jobType: string;
    arg: PgPrimitive;
    notifier: Deferred<any>;
  }[] = [];
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

  async publish<T>(
    jobType: string,
    _concurrencyGroup: string | null,
    _timeout: number,
    arg: PgPrimitive,
  ): Promise<Job<T>> {
    if (this.isDestroyed) {
      throw new Error(`Cannot publish job on a destroyed Queue`);
    }
    let jobId = ++id;
    let notifier = new Deferred<T>();
    let job = new Job(jobId, notifier);
    this.jobs.push({
      jobId,
      notifier,
      jobType,
      arg,
    });
    this.debouncedDrainJobs();
    return job;
  }

  private debouncedDrainJobs = debounce(() => {
    this.drainJobs();
  }, 250);

  private async drainJobs() {
    await this.flush();

    let jobsDrained: () => void;
    this.#flush = new Promise((res) => (jobsDrained = res));
    let jobs = [...this.jobs];
    this.jobs = [];
    for (let workItem of jobs) {
      let { jobId, jobType, notifier, arg } = workItem;
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
        notifier.fulfill(await handler(arg));
      } catch (e: any) {
        notifier.reject(e);
      }
    }

    jobsDrained!();
  }

  async destroy() {
    this.#isDestroyed = true;
    await this.flush();
  }
}
