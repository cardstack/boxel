import debounce from 'lodash/debounce';

import { v4 as uuidv4 } from 'uuid';

import {
  type Queue,
  type PgPrimitive,
  Job,
  Deferred,
} from '@cardstack/runtime-common';

export class BrowserQueue implements Queue {
  #isDestroyed = false;
  #hasStarted = false;
  #flush: Promise<void> | undefined;

  // no need for "onAfterJob--that's just the Job.done promise
  constructor(private onBeforeJob?: (jobId: string) => void) {}

  private jobs: {
    jobId: string;
    category: string;
    arg: PgPrimitive;
    notifier: Deferred<any>;
  }[] = [];
  private categories: Map<string, (arg: any) => Promise<any>> = new Map();

  get isDestroyed() {
    return this.#isDestroyed;
  }
  get hasStarted() {
    return this.#hasStarted;
  }

  async flush() {
    await this.#flush;
  }

  start() {
    this.#hasStarted = true;
  }

  register<A, T>(category: string, handler: (arg: A) => Promise<T>) {
    if (!this.#hasStarted) {
      throw new Error(`Cannot register category on unstarted Queue`);
    }
    if (this.isDestroyed) {
      throw new Error(`Cannot register category on a destroyed Queue`);
    }
    this.categories.set(category, handler);
    this.debouncedDrainJobs();
  }

  async publish<T>(category: string, arg: PgPrimitive): Promise<Job<T>> {
    if (!this.#hasStarted) {
      throw new Error(`Cannot publish job on unstarted Queue`);
    }
    if (this.isDestroyed) {
      throw new Error(`Cannot publish job on a destroyed Queue`);
    }
    let jobId = uuidv4();
    let notifier = new Deferred<T>();
    let job = new Job(jobId, notifier);
    this.jobs.push({
      jobId,
      notifier,
      category,
      arg,
    });
    this.debouncedDrainJobs();
    return job;
  }

  private debouncedDrainJobs = debounce(() => {
    this.drainJobs();
  }, 250);

  private async drainJobs() {
    await this.#flush;

    let jobsDrained: () => void;
    this.#flush = new Promise((res) => (jobsDrained = res));
    let jobs = [...this.jobs];
    this.jobs = [];
    for (let workItem of jobs) {
      let { jobId, category, notifier, arg } = workItem;
      let handler = this.categories.get(category);
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
    await this.#flush;
  }
}
