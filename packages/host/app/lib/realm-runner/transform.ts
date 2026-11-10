import { isPlainObject } from '@cardstack/runtime-common/is-plain-object';

import { jsonBytes } from './research';
import { makeRealmWorker, resolveAssetURL } from './runner';
import {
  MAX_TRANSFORM_INPUT_BYTES,
  MAX_TRANSFORM_OUTPUT_BYTES,
  MAX_TRANSFORM_SOURCE_BYTES,
  MAX_TRANSFORM_BYTES_PER_RUN,
  MAX_TRANSFORMS_PER_RUN,
  TRANSFORM_STALL_GRACE_MS,
  TRANSFORM_TIMEOUT_MS,
  TRANSFORM_WORKER_START_TIMEOUT_MS,
} from './transform-limits';

import WorkerURL from './transform-worker?worker&url';

// realm.transform(input, source, options?) runs one BXL program over JSON the
// script hands it, under BXL's transform profile: the profile card
// operations' input and output programs use. The program runs in a worker of
// its own, never inside QuickJS.

const SPELLINGS = { jq: 'solidified', readable: 'readable' } as const;
type Spelling = keyof typeof SPELLINGS;
const OPTION_KEYS = new Set(['params', 'spelling']);

export interface TransformWorkerRequest {
  id: number;
  input: unknown;
  source: string;
  params?: Record<string, unknown>;
  syntax: (typeof SPELLINGS)[Spelling];
}

export type TransformWorkerResponse =
  | { ready: true }
  | { id: number; started: true }
  | { id: number; value: string; bytes: number }
  | { id: number; outputTooLarge: true }
  | { id: number; error: string; phase?: 'parse' | 'profile' | 'evaluate' };

export interface TransformRequest {
  message: Omit<TransformWorkerRequest, 'id'>;
  // The input's and params' bytes, counted toward the run's budget.
  bytes: number;
}

// Checks a realm.transform call's arguments before any work is done.
export function transformRequest(
  input: unknown,
  source: unknown,
  options: unknown,
): TransformRequest {
  if (typeof source !== 'string' || !source.trim()) {
    throw new TypeError(
      "realm.transform expects a BXL program as its second argument, such as realm.transform(cards, 'map({title})')",
    );
  }
  let sourceBytes = new TextEncoder().encode(source).byteLength;
  if (sourceBytes > MAX_TRANSFORM_SOURCE_BYTES) {
    throw new RangeError(
      `realm.transform takes a program of at most ${MAX_TRANSFORM_SOURCE_BYTES} bytes; this one has ${sourceBytes}`,
    );
  }
  if (options !== undefined && options !== null && !isPlainObject(options)) {
    throw new TypeError('realm.transform options are { params?, spelling? }');
  }
  let { params, spelling = 'jq' } = (options ?? {}) as {
    params?: unknown;
    spelling?: unknown;
  };
  let unknownKeys = Object.keys(options ?? {}).filter(
    (key) => !OPTION_KEYS.has(key),
  );
  if (unknownKeys.length > 0) {
    throw new TypeError(
      `realm.transform options are { params?, spelling? }; ${unknownKeys.join(', ')} is not one`,
    );
  }
  if (params !== undefined && !isPlainObject(params)) {
    throw new TypeError(
      'realm.transform params must be an object of named values, read with params("name")',
    );
  }
  // params reach the worker and the program as input does, so they count
  // toward the same limit.
  let inputBytes =
    jsonBytes(input ?? null) + (params === undefined ? 0 : jsonBytes(params));
  if (inputBytes > MAX_TRANSFORM_INPUT_BYTES) {
    throw new RangeError(
      `realm.transform takes at most ${MAX_TRANSFORM_INPUT_BYTES} bytes of input and params; this call has ${inputBytes}`,
    );
  }
  if (typeof spelling !== 'string' || !Object.hasOwn(SPELLINGS, spelling)) {
    throw new TypeError(
      `realm.transform spelling is "jq" (the default) or "readable", not ${JSON.stringify(spelling)}`,
    );
  }
  return {
    message: {
      input: input ?? null,
      source,
      ...(params ? { params } : {}),
      syntax: SPELLINGS[spelling as Spelling],
    },
    bytes: inputBytes,
  };
}

function transformError(
  message: string,
  phase: 'parse' | 'profile' | 'evaluate' | undefined,
): Error {
  switch (phase) {
    case 'parse':
      return new SyntaxError(
        `realm.transform: the program does not parse: ${message}`,
      );
    case 'profile':
      return new Error(
        `realm.transform: the program uses what a transform may not:\n${message}`,
      );
    case 'evaluate':
      return new Error(`realm.transform: the program failed: ${message}`);
    default:
      return new Error(`realm.transform failed: ${message}`);
  }
}

interface Waiting {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  // Set when the worker starts the program, not when the call is posted.
  timer?: number;
}

// The transform worker of one run. It starts on the run's first
// realm.transform and ends with the run.
export class RealmTransformer {
  private worker?: Worker;
  private startTimer?: number;
  private waiting = new Map<number, Waiting>();
  private nextId = 1;
  private closed = false;
  private count = 0;
  private bytes = 0;

  run(request: TransformRequest): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(
        new Error('The run has ended; realm.transform was not run'),
      );
    }
    if (this.count >= MAX_TRANSFORMS_PER_RUN) {
      return Promise.reject(
        new Error(
          `Realm code may call realm.transform at most ${MAX_TRANSFORMS_PER_RUN} times per run`,
        ),
      );
    }
    if (this.bytes + request.bytes > MAX_TRANSFORM_BYTES_PER_RUN) {
      return Promise.reject(
        new RangeError(
          `realm.transform may move at most ${MAX_TRANSFORM_BYTES_PER_RUN} bytes in and out per run; this call's ${request.bytes} bytes of input were not sent`,
        ),
      );
    }
    let worker = this.start();
    let id = this.nextId++;
    try {
      worker.postMessage({
        id,
        ...request.message,
      } satisfies TransformWorkerRequest);
    } catch (error) {
      return Promise.reject(
        new Error(
          `realm.transform could not send its input to the worker: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }
    // Counted once the call is sent, so a call that never reached the worker
    // costs the run nothing.
    this.count += 1;
    this.bytes += request.bytes;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
    });
  }

  close() {
    this.closed = true;
    this.stop(new Error('The run has ended; realm.transform was stopped'));
  }

  private start(): Worker {
    if (this.worker) {
      return this.worker;
    }
    let workerURL = resolveAssetURL(WorkerURL);
    let worker = makeRealmWorker(workerURL);
    this.startTimer = window.setTimeout(() => {
      this.stop(
        new Error(
          `realm.transform could not start: its worker did not load within ${TRANSFORM_WORKER_START_TIMEOUT_MS / 1000} s`,
        ),
      );
    }, TRANSFORM_WORKER_START_TIMEOUT_MS);
    worker.onmessage = (event: MessageEvent<TransformWorkerResponse>) => {
      let message = event.data;
      if ('ready' in message) {
        window.clearTimeout(this.startTimer);
        this.startTimer = undefined;
        return;
      }
      let waiting = this.waiting.get(message.id);
      if (!waiting) {
        return;
      }
      if ('started' in message) {
        // BXL stops a program at TRANSFORM_TIMEOUT_MS by itself. This timer is
        // for an evaluator that stalls outside its own metering: such a
        // program cannot be interrupted inside the worker, so the worker
        // ends, and every call waiting on it with it.
        waiting.timer = window.setTimeout(() => {
          this.stop(
            new Error(
              `realm.transform took longer than ${TRANSFORM_TIMEOUT_MS / 1000} s and was stopped`,
            ),
          );
        }, TRANSFORM_TIMEOUT_MS + TRANSFORM_STALL_GRACE_MS);
        return;
      }
      this.waiting.delete(message.id);
      window.clearTimeout(waiting.timer);
      if ('error' in message) {
        waiting.reject(transformError(message.error, message.phase));
        return;
      }
      if ('outputTooLarge' in message) {
        waiting.reject(
          new RangeError(
            `realm.transform returns at most ${MAX_TRANSFORM_OUTPUT_BYTES} bytes; this program returned more`,
          ),
        );
        return;
      }
      this.bytes += message.bytes;
      if (this.bytes > MAX_TRANSFORM_BYTES_PER_RUN) {
        waiting.reject(
          new RangeError(
            `realm.transform may move at most ${MAX_TRANSFORM_BYTES_PER_RUN} bytes in and out per run; this program's ${message.bytes} bytes of output were dropped`,
          ),
        );
        return;
      }
      waiting.resolve(JSON.parse(message.value));
    };
    // A reply that cannot be read would leave its call waiting for a timer
    // that then blames the program, so the worker ends with the real reason.
    worker.onmessageerror = () => {
      this.stop(
        new Error("realm.transform could not read the worker's answer"),
      );
    };
    worker.onerror = (event) => {
      this.stop(
        new Error(
          event.message ||
            `realm.transform worker failed to load from ${workerURL.href}`,
        ),
      );
    };
    this.worker = worker;
    return worker;
  }

  private stop(reason: Error) {
    this.worker?.terminate();
    this.worker = undefined;
    window.clearTimeout(this.startTimer);
    this.startTimer = undefined;
    for (let waiting of this.waiting.values()) {
      window.clearTimeout(waiting.timer);
      waiting.reject(reason);
    }
    this.waiting.clear();
  }
}
