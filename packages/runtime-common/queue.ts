import type { PgPrimitive } from './index';
import type { Deferred } from './deferred';

export const systemInitiatedPriority = 0;
export const userInitiatedPriority = 10;

export interface QueueRunner {
  start: () => Promise<void>;
  register: <A, T>(category: string, handler: (arg: A) => Promise<T>) => void;
  destroy: () => Promise<void>;
}

export type QueueResultMapper<TResult> = (result: PgPrimitive) => TResult;

export type QueuePublishArgs<TResult = PgPrimitive> = QueuePublishRequest & {
  mapResult?: QueueResultMapper<TResult>;
};

export interface QueuePublisher {
  publish: <TResult = PgPrimitive>(
    args: QueuePublishArgs<TResult>,
  ) => Promise<Job<TResult>>;
  destroy: () => Promise<void>;
}

export interface QueuePublishRequest {
  jobType: string;
  priority?: number;
  concurrencyGroup: string | null;
  timeout: number;
  args: PgPrimitive;
}

export interface QueueJobSpec extends Omit<QueuePublishRequest, 'priority'> {
  priority: number;
}

export interface QueueCoalesceCandidate extends QueueJobSpec {
  id: number;
}

export interface QueueCoalesceContext {
  incoming: QueueJobSpec;
  candidates: QueueCoalesceCandidate[];
}

export type QueueCoalesceJoinUpdate = Partial<
  Pick<QueueJobSpec, 'jobType' | 'args' | 'priority' | 'timeout'>
>;

export type QueueCoalesceDecision =
  | {
      type: 'insert';
      job?: QueueJobSpec;
    }
  | {
      type: 'join';
      jobId: number;
      update?: QueueCoalesceJoinUpdate;
    };

export interface QueueJobDefinition {
  jobType: string;
  coalesce?: (context: QueueCoalesceContext) => QueueCoalesceDecision;
}

let coalesceHandlersByJobType = new Map<
  string,
  NonNullable<QueueJobDefinition['coalesce']>
>();

export function registerQueueJobDefinition(definition: QueueJobDefinition) {
  if (!definition.coalesce) {
    return;
  }
  coalesceHandlersByJobType.set(definition.jobType, definition.coalesce);
}

export function getQueueJobCoalesceHandler(jobType: string) {
  return coalesceHandlersByJobType.get(jobType);
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
