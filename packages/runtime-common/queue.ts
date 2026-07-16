import type { PgPrimitive } from './index.ts';
import type { Deferred } from './deferred.ts';

// Job priority is a worker-reservation floor, not an ordering: a worker
// dequeues only jobs whose priority is at or above its configured
// minimum, oldest-first among those. A higher number therefore reserves
// a job to more (and to more-dedicated) worker pools.
//
// The tiers:
//
//   | priority | job                                          |
//   | -------- | -------------------------------------------- |
//   | 10       | any user-initiated job, incl. prerender-html |
//   | 1        | system-initiated job (non-prerender-html)    |
//   | 0        | system-initiated prerender-html              |
//
// User-initiated prerender-html is co-equal with user indexing (both 10):
// for a published realm the rendered HTML is the deliverable served to
// visitors — as important as the search index — so it is NOT deprioritized
// below its initiator tier. System-initiated prerender-html stays one notch
// below system work (background); boot rendering is gated separately and must
// not crowd out user-tier jobs. The high-priority pool floors at
// `userInitiatedPrerenderHtmlPriority` (serving all user-initiated work and
// never system-tier jobs); the all-priority pool floors at
// `systemInitiatedPrerenderHtmlPriority` and serves everything.
export const userInitiatedPriority = 10;
export const userInitiatedPrerenderHtmlPriority = 10;
export const systemInitiatedPriority = 1;
export const systemInitiatedPrerenderHtmlPriority = 0;

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
  // Unfulfilled jobs in the concurrency group whose worker has already
  // claimed them (an active job_reservations row exists). The worker has
  // already loaded args into memory, so DB-side args mutations won't
  // propagate. Attaching here is purely "register a late waiter on this
  // jobId"; the publish path will not call the join `update` for an
  // in-flight target. Handlers must verify the running job's existing
  // work covers the incoming request before joining.
  inFlightCandidates: QueueCoalesceCandidate[];
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

export interface QueueWaiter {
  fulfillFromResult: (result: PgPrimitive) => void;
  rejectFromResult: (result: PgPrimitive) => void;
  reject: (error: unknown) => void;
}

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

export function normalizeQueueJobSpec(args: QueuePublishRequest): QueueJobSpec {
  return {
    ...args,
    // A publish that doesn't state a priority is background work, so it
    // takes the system-initiated tier.
    priority: args.priority ?? systemInitiatedPriority,
  };
}

export const identityResultMapper: QueueResultMapper<PgPrimitive> = (result) =>
  result;

export function makeQueueWaiter<TResult>(
  deferred: Deferred<TResult>,
  mapResult: QueueResultMapper<TResult>,
): QueueWaiter {
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

export class Job<T> {
  readonly id: number;
  private notifier: Deferred<T>;
  constructor(id: number, notifier: Deferred<T>) {
    this.id = id;
    this.notifier = notifier;
    // The result promise is live from the moment the job is published,
    // before any caller reads `.done` and attaches a handler. A job that
    // settles to a rejection in that window — or whose result is never
    // awaited at all — would otherwise surface as an unhandled rejection,
    // which under native Node aborts the whole process. Awaiting `.done`
    // is opt-in: a caller that cares about the outcome reads it and
    // handles the rejection there, and still receives it even though this
    // no-op ran first, because a promise delivers to every attached
    // handler. This guard only suppresses the unhandled-rejection signal
    // for an outcome nobody is awaiting.
    this.notifier.promise.catch(() => {});
  }
  get done(): Promise<T> {
    return this.notifier.promise;
  }
}
