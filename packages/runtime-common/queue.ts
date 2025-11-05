import type { PgPrimitive } from './index';
import type { Deferred } from './deferred';

export const systemInitiatedPriority = 0;
export const userInitiatedPriority = 10;

export interface QueueRunner {
  start: () => Promise<void>;
  register: <A, T>(category: string, handler: (arg: A) => Promise<T>) => void;
  destroy: () => Promise<void>;
}

export interface QueuePublisher {
  publish: <T>(args: {
    jobType: string;
    priority?: number;
    concurrencyGroup: string | null;
    timeout: number;
    args: PgPrimitive;
  }) => Promise<Job<T>>;
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
