import { jsonBytes } from './research';
import { makeRealmWorker, resolveAssetURL } from './runner';

import WorkerURL from './transform-worker?worker&url';

// realm.transform(input, source, options?) runs one BXL program over JSON the
// script hands it, under BXL's transform profile: the profile card
// operations' input and output programs use. The program runs in a worker of
// its own, never inside QuickJS.

export const MAX_TRANSFORM_INPUT_BYTES = 1_000_000;
export const MAX_TRANSFORM_OUTPUT_BYTES = 1_000_000;
export const MAX_TRANSFORM_SOURCE_BYTES = 16 * 1024;
// One program's time. A program that runs longer is stopped by ending its
// worker; the next call starts a new one.
export const TRANSFORM_TIMEOUT_MS = 10_000;
// How many programs one run may run (ADR 022 §1.6).
export const MAX_TRANSFORMS_PER_RUN = 100;

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
  | { id: number; value: string }
  | { id: number; error: string; phase?: 'parse' | 'profile' | 'evaluate' };

export type TransformRequest = Omit<TransformWorkerRequest, 'id'>;

const encoder = new TextEncoder();

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
  let sourceBytes = encoder.encode(source).byteLength;
  if (sourceBytes > MAX_TRANSFORM_SOURCE_BYTES) {
    throw new RangeError(
      `realm.transform takes a program of at most ${MAX_TRANSFORM_SOURCE_BYTES} bytes; this one has ${sourceBytes}`,
    );
  }
  let inputBytes = jsonBytes(input ?? null);
  if (inputBytes > MAX_TRANSFORM_INPUT_BYTES) {
    throw new RangeError(
      `realm.transform takes at most ${MAX_TRANSFORM_INPUT_BYTES} bytes of input; this input has ${inputBytes}`,
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
  if (typeof spelling !== 'string' || !(spelling in SPELLINGS)) {
    throw new TypeError(
      `realm.transform spelling is "jq" (the default) or "readable", not ${JSON.stringify(spelling)}`,
    );
  }
  return {
    input: input ?? null,
    source,
    ...(params ? { params } : {}),
    syntax: SPELLINGS[spelling as Spelling],
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
  timer: number;
}

// The transform worker of one run. It starts on the run's first
// realm.transform and ends with the run.
export class RealmTransformer {
  private worker?: Worker;
  private waiting = new Map<number, Waiting>();
  private nextId = 1;
  private closed = false;
  private count = 0;

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
    this.count += 1;
    let worker = this.start();
    let id = this.nextId++;
    return new Promise((resolve, reject) => {
      let timer = window.setTimeout(() => {
        // A program past its time cannot be interrupted inside the worker, so
        // the worker ends, and every call waiting on it with it.
        this.stop(
          new Error(
            `realm.transform took longer than ${TRANSFORM_TIMEOUT_MS / 1000} s and was stopped`,
          ),
        );
      }, TRANSFORM_TIMEOUT_MS);
      this.waiting.set(id, { resolve, reject, timer });
      worker.postMessage({ id, ...request } satisfies TransformWorkerRequest);
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
    worker.onmessage = (event: MessageEvent<TransformWorkerResponse>) => {
      let message = event.data;
      let waiting = this.waiting.get(message.id);
      if (!waiting) {
        return;
      }
      this.waiting.delete(message.id);
      window.clearTimeout(waiting.timer);
      if ('error' in message) {
        waiting.reject(transformError(message.error, message.phase));
        return;
      }
      let bytes = encoder.encode(message.value).byteLength;
      if (bytes > MAX_TRANSFORM_OUTPUT_BYTES) {
        waiting.reject(
          new RangeError(
            `realm.transform returns at most ${MAX_TRANSFORM_OUTPUT_BYTES} bytes; this program returned ${bytes}`,
          ),
        );
        return;
      }
      waiting.resolve(JSON.parse(message.value));
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
    for (let waiting of this.waiting.values()) {
      window.clearTimeout(waiting.timer);
      waiting.reject(reason);
    }
    this.waiting.clear();
  }
}
