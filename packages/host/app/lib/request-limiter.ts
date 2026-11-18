// Bounds how many requests one tab has in flight to one origin, and sends
// writes and auth ahead of reads when the bound is reached.
//
// A tab that refreshes many live searches and cards at once can open more
// requests than its connection carries. Over HTTP/2 a browser sends at most
// the server's stream limit at once (an AWS load balancer advertises 128) and
// holds every later request, in order, until a stream is free. A small,
// urgent request — a realm session, a card write, a model call — then waits
// behind every read queued before it, though the server answers it in
// milliseconds. Holding the excess here instead keeps the browser's own
// queue empty, and lets this queue choose the order.
//
// A slot is held until the response body ends (read to the end, cancelled,
// or failed), because the stream stays open while the body downloads. Two
// cases release at the headers instead: a response with no body, and a
// streamed one (`text/event-stream`), which may stay open for minutes. A
// caller can also drop a response without reading its body, so a slot whose
// body has not ended `bodyGraceMs` after its headers is released anyway.

export type RequestPriority = 'urgent' | 'normal';

export interface RequestLimiterOptions {
  // Requests in flight to one origin, across both classes.
  maxInFlight: number;
  // Slots of `maxInFlight` that only urgent requests take, so an urgent
  // request finds a free slot while reads fill the rest.
  urgentReserve: number;
  // How long after its headers a response may hold its slot while its body
  // is still open.
  bodyGraceMs: number;
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export const DEFAULT_MAX_REQUESTS_IN_FLIGHT = 48;
export const DEFAULT_URGENT_REQUEST_RESERVE = 8;
export const DEFAULT_BODY_GRACE_MS = 30_000;

// Reads, which the urgent class goes ahead of. QUERY is the search method.
const NORMAL_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'QUERY']);

export function priorityOf(request: Request): RequestPriority {
  return NORMAL_METHODS.has(request.method.toUpperCase()) ? 'normal' : 'urgent';
}

// How long each response waited here before it was sent, keyed by its
// headers. A response reaches its caller through wrappers (the fetcher's
// waiter proxy among them) that hand back the same headers object, so the
// headers identify it where the response object itself would not.
const queueTimes = new WeakMap<Headers, number>();

export function queueTimeOf(response: Response): number | undefined {
  return queueTimes.get(response.headers);
}

interface Waiter {
  start: () => void;
  priority: RequestPriority;
}

class OriginLane {
  inFlight = 0;
  urgent: Waiter[] = [];
  normal: Waiter[] = [];

  canStart(priority: RequestPriority, opts: RequestLimiterOptions): boolean {
    let limit =
      priority === 'urgent'
        ? opts.maxInFlight
        : Math.max(1, opts.maxInFlight - opts.urgentReserve);
    return this.inFlight < limit;
  }

  get idle(): boolean {
    return (
      this.inFlight === 0 &&
      this.urgent.length === 0 &&
      this.normal.length === 0
    );
  }
}

export class RequestLimiter {
  #lanes = new Map<string, OriginLane>();
  #opts: RequestLimiterOptions;
  #now: () => number;
  #setTimer: (callback: () => void, ms: number) => unknown;
  #clearTimer: (handle: unknown) => void;

  constructor(
    private fetchImpl: (request: Request) => Promise<Response>,
    opts: Partial<RequestLimiterOptions> = {},
  ) {
    this.#opts = {
      maxInFlight: Math.max(
        1,
        Math.floor(opts.maxInFlight ?? DEFAULT_MAX_REQUESTS_IN_FLIGHT),
      ),
      urgentReserve: Math.max(
        0,
        Math.floor(opts.urgentReserve ?? DEFAULT_URGENT_REQUEST_RESERVE),
      ),
      bodyGraceMs: opts.bodyGraceMs ?? DEFAULT_BODY_GRACE_MS,
    };
    this.#now = opts.now ?? (() => performance.now());
    this.#setTimer =
      opts.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    this.#clearTimer =
      opts.clearTimer ??
      ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  // In flight and queued, for one origin. For tests and diagnostics.
  stats(origin: string): { inFlight: number; urgent: number; normal: number } {
    let lane = this.#lanes.get(origin);
    return {
      inFlight: lane?.inFlight ?? 0,
      urgent: lane?.urgent.length ?? 0,
      normal: lane?.normal.length ?? 0,
    };
  }

  fetch = async (request: Request): Promise<Response> => {
    let origin = limitedOrigin(request);
    if (!origin) {
      return await this.fetchImpl(request);
    }
    let lane = this.#lane(origin);
    let queuedAt = this.#now();
    await this.#acquire(lane, priorityOf(request), request.signal);
    let queueMs = this.#now() - queuedAt;

    let response: Response;
    try {
      response = await this.fetchImpl(request);
    } catch (e) {
      this.#release(origin, lane);
      throw e;
    }
    return this.#holdUntilBodyEnds(origin, lane, response, queueMs);
  };

  #lane(origin: string): OriginLane {
    let lane = this.#lanes.get(origin);
    if (!lane) {
      lane = new OriginLane();
      this.#lanes.set(origin, lane);
    }
    return lane;
  }

  #acquire(
    lane: OriginLane,
    priority: RequestPriority,
    signal: AbortSignal | null,
  ): Promise<void> {
    if (signal?.aborted) {
      return Promise.reject(abortReason(signal));
    }
    // Nothing of this class or above is waiting, so starting now jumps no one.
    let ahead =
      priority === 'urgent'
        ? lane.urgent.length
        : lane.urgent.length + lane.normal.length;
    if (ahead === 0 && lane.canStart(priority, this.#opts)) {
      lane.inFlight++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      let queue = priority === 'urgent' ? lane.urgent : lane.normal;
      let onAbort = () => {
        let index = queue.indexOf(waiter);
        if (index !== -1) {
          queue.splice(index, 1);
          reject(abortReason(signal!));
        }
      };
      let waiter: Waiter = {
        priority,
        start: () => {
          signal?.removeEventListener('abort', onAbort);
          lane.inFlight++;
          resolve();
        },
      };
      // A request whose caller gives up while it waits is never sent.
      signal?.addEventListener('abort', onAbort, { once: true });
      queue.push(waiter);
    });
  }

  #release(origin: string, lane: OriginLane) {
    lane.inFlight--;
    // Urgent first; then reads, each while the lane has room for its class.
    for (;;) {
      let next: Waiter | undefined;
      if (lane.urgent.length && lane.canStart('urgent', this.#opts)) {
        next = lane.urgent.shift();
      } else if (lane.normal.length && lane.canStart('normal', this.#opts)) {
        next = lane.normal.shift();
      }
      if (!next) {
        break;
      }
      next.start();
    }
    if (lane.idle) {
      this.#lanes.delete(origin);
    }
  }

  #holdUntilBodyEnds(
    origin: string,
    lane: OriginLane,
    response: Response,
    queueMs: number,
  ): Response {
    let released = false;
    let timer: unknown;
    let release = () => {
      if (released) {
        return;
      }
      released = true;
      if (timer !== undefined) {
        this.#clearTimer(timer);
      }
      this.#release(origin, lane);
    };

    let source = response.body;
    if (!source || isStreamed(response) || !canRebuild(response)) {
      queueTimes.set(response.headers, queueMs);
      release();
      return response;
    }

    let reader = source.getReader();
    let body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          let { done, value } = await reader.read();
          if (done) {
            release();
            controller.close();
          } else {
            controller.enqueue(value);
          }
        } catch (e) {
          release();
          controller.error(e);
        }
      },
      cancel(reason) {
        release();
        return reader.cancel(reason);
      },
    });
    timer = this.#setTimer(release, this.#opts.bodyGraceMs);

    let wrapped = new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
    // A constructed response has no url, type or redirect flag of its own,
    // and the fetcher treats a response with no url as one it must still
    // resolve redirects for. Carry the network's values over.
    Object.defineProperty(wrapped, 'url', { value: response.url });
    Object.defineProperty(wrapped, 'redirected', {
      value: response.redirected,
    });
    Object.defineProperty(wrapped, 'type', { value: response.type });
    queueTimes.set(wrapped.headers, queueMs);
    return wrapped;
  }
}

// The origin a request is counted against, or undefined for a request that
// does not reach a server (data:, blob:).
function limitedOrigin(request: Request): string | undefined {
  try {
    let url = new URL(request.url);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.origin
      : undefined;
  } catch {
    return undefined;
  }
}

function isStreamed(response: Response): boolean {
  return /^\s*text\/event-stream/i.test(
    response.headers.get('content-type') ?? '',
  );
}

// Statuses the Response constructor refuses a body for.
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

// An opaque response (status 0) cannot be constructed again, and a status
// outside 200–599 is refused by the Response constructor.
function canRebuild(response: Response): boolean {
  return (
    response.status >= 200 &&
    response.status <= 599 &&
    !NULL_BODY_STATUSES.has(response.status)
  );
}

function abortReason(signal: AbortSignal): unknown {
  return (
    signal.reason ?? new DOMException('The request was aborted.', 'AbortError')
  );
}
