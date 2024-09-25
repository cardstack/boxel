import { type PgPrimitive } from './index';
import { Deferred } from './deferred';

export interface QueueOpts {
  queueName?: string;
}

export interface Queue {
  isDestroyed: boolean;
  hasStarted: boolean;
  // postgres needs time to initialize, so we only start our queue after
  // postgres is running
  start: () => Promise<void>; // the queue worker starts the queue
  destroy: () => Promise<void>;
  register: <A, T>(category: string, handler: (arg: A) => Promise<T>) => void;
  publish: <T>(
    jobType: string,
    concurrencyGroup: string | null,
    timeout: number,
    args: PgPrimitive,
  ) => Promise<Job<T>>;
}

export interface JobNotifier {
  resolve: Function;
  reject: Function;
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
