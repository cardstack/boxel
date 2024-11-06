import { type PgPrimitive } from './index';
import { Deferred } from './deferred';

export interface QueueRunner {
  start: () => Promise<void>;
  register: <A, T>(category: string, handler: (arg: A) => Promise<T>) => void;
  destroy: () => Promise<void>;
}

export interface QueuePublisher {
  publish: <T>(
    jobType: string,
    concurrencyGroup: string | null,
    timeout: number,
    args: PgPrimitive,
  ) => Promise<Job<T>>;
  destroy: () => Promise<void>;
}

export class Job<T> {
  constructor(
    readonly id: number,
    private notifier: Deferred<T>,
  ) {}
  get done(): Promise<T> {
    return this.notifier.promise;
  }
}
