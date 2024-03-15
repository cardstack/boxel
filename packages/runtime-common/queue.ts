import { PgPrimitive } from './expression';
import { Memoize } from 'typescript-memoize';
import { Deferred } from './deferred';

export interface QueueOpts {
  queueName?: string;
}

export interface Queue {
  isDestroyed: boolean;
  hasStarted: boolean;
  // postgres needs time to initialize, so we only start our queue after
  // postgres is running
  start: () => void;
  destroy: () => Promise<void>;
  register: <A, T>(category: string, handler: (arg: A) => Promise<T>) => void;
  publish: <T>(
    category: string,
    arg: PgPrimitive,
    opts?: QueueOpts,
  ) => Promise<Job<T>>;
}

export interface JobNotifier {
  resolve: Function;
  reject: Function;
}

export class Job<T> {
  constructor(
    public uuid: string,
    private notifier: Deferred<T>,
  ) {}
  @Memoize()
  get done(): Promise<T> {
    return this.notifier.promise;
  }
}
