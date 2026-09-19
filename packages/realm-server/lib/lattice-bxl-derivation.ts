import { Worker } from 'node:worker_threads';
import { LatticeUnsupportedComputation } from './lattice-card-compute.ts';
import type {
  LatticeCardComputeInput,
  LatticeCardComputePlan,
  LatticeCardComputeResult,
} from './lattice-card-compute.ts';

export type LatticeBxlShape =
  | 'number'
  | 'string'
  | 'boolean'
  | 'json'
  | { array: LatticeBxlShape }
  | { object: Record<string, LatticeBxlShape> };

export type LatticeBxlValue =
  | string
  | number
  | boolean
  | null
  | LatticeBxlValue[]
  | { [key: string]: LatticeBxlValue };

// Trusted definition-index artifact, not a client-supplied execution request.
// Admission must establish complete inputs and field coercion parity. Version 1
// deliberately excludes custom classes, native extensions and arbitrary JS.
export interface LatticeBxlManifest {
  version: 1;
  definition: { module: string; name: string; revision: string };
  field: string;
  expression: string;
  // Builtin libraries the program resolves against; `['core']` when absent.
  // The worker admits only `LATTICE_NATIVE_BXL_LIBRARIES`.
  libraries?: string[];
  input: { object: Record<string, LatticeBxlShape> };
  output: LatticeBxlShape;
}

export interface LatticeBxlInput {
  id: string;
  revision: string;
  json: string;
}

export interface LatticeBxlArtifact {
  id: string;
  inputRevision: string;
  definitionRevision: string;
  field: string;
  value: LatticeBxlValue;
}

export interface LatticeBxlResult {
  artifacts: LatticeBxlArtifact[];
  measurements: {
    prepareMs: number;
    evaluateMs: number;
    workerHeapBytes: number;
    processRssBytes: number;
  };
}

// A small pool of worker threads, one job at a time per thread. The queue owns
// priority and publication. Keeping this executor separate also permits a hard
// deadline when cooperative BXL limits cannot interrupt a single operation.
// This is not an OS sandbox.
//
// LATTICE_BXL_WORKERS sets the thread count (default 1). A caller whose job
// finds every thread busy waits for the next free one in arrival order; a
// materialization wave that renders several owners at once
// (LATTICE_WAVE_CONCURRENCY) is what fills the pool.
export const LATTICE_BXL_WORKERS = Math.max(
  1,
  Math.min(16, Number(process.env.LATTICE_BXL_WORKERS) || 1),
);

interface LatticeBxlThread {
  worker: Worker | undefined;
  busy: boolean;
}

export class LatticeBxlWorker {
  #threads: LatticeBxlThread[];
  #waiters: Array<(thread: LatticeBxlThread) => void> = [];

  constructor(size = LATTICE_BXL_WORKERS) {
    this.#threads = Array.from({ length: Math.max(1, size) }, () => ({
      worker: undefined,
      busy: false,
    }));
  }

  get size(): number {
    return this.#threads.length;
  }

  async #acquire(signal?: AbortSignal): Promise<LatticeBxlThread> {
    const free = this.#threads.find((thread) => !thread.busy);
    if (free) {
      free.busy = true;
      return free;
    }
    return new Promise<LatticeBxlThread>((resolve, reject) => {
      const waiter = (thread: LatticeBxlThread) => {
        signal?.removeEventListener('abort', onAbort);
        resolve(thread);
      };
      const onAbort = () => {
        const index = this.#waiters.indexOf(waiter);
        if (index >= 0) this.#waiters.splice(index, 1);
        reject(signal?.reason ?? new Error('BXL work aborted'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.#waiters.push(waiter);
    });
  }

  #release(thread: LatticeBxlThread) {
    const waiter = this.#waiters.shift();
    if (waiter) waiter(thread);
    else thread.busy = false;
  }

  async evaluate(
    manifest: LatticeBxlManifest,
    inputs: LatticeBxlInput[],
    timeoutMs = 10_000,
    signal?: AbortSignal,
  ): Promise<LatticeBxlResult> {
    return this.#run<LatticeBxlResult>(
      manifest,
      inputs,
      timeoutMs,
      'field',
      signal,
    );
  }

  async evaluateCard(
    plan: LatticeCardComputePlan,
    inputs: LatticeCardComputeInput[],
    timeoutMs = 10_000,
    signal?: AbortSignal,
  ): Promise<LatticeCardComputeResult> {
    return this.#run<LatticeCardComputeResult>(
      plan,
      inputs,
      timeoutMs,
      'card',
      signal,
    );
  }

  async #run<T extends LatticeBxlResult | LatticeCardComputeResult>(
    manifest: LatticeBxlManifest | LatticeCardComputePlan,
    inputs: LatticeCardComputeInput[],
    timeoutMs: number,
    kind: 'field' | 'card',
    signal?: AbortSignal,
  ): Promise<T> {
    signal?.throwIfAborted();
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error('Invalid BXL deadline');
    }
    // 512 cards / 16 MiB originally; the baseball season leaderboard reads
    // every player season (673 cards after one month, ~4 MB).
    if (inputs.length > 4096) throw new Error('BXL batch exceeds 4096 cards');
    // The Nucleus day owner's four programs are about 20 KB each (the port
    // repeats one prelude of record projections in every field) and its
    // projected inputs are the day's people, goals, observations and reports.
    // Bounds sized for that owner; the 32 KiB / 1 MiB originals fit only the
    // per-field BATS experiment.
    if (Buffer.byteLength(JSON.stringify(manifest)) > 512 * 1024) {
      throw new Error('BXL manifest exceeds 512 KiB');
    }
    if (
      inputs.reduce(
        (bytes, input) =>
          bytes +
          Buffer.byteLength(input.json) +
          Buffer.byteLength(input.id) +
          Buffer.byteLength(input.revision) +
          Buffer.byteLength(input.thumbnailURL ?? ''),
        0,
      ) >
      64 * 1_048_576
    ) {
      throw new Error('BXL input batch exceeds 64 MiB');
    }
    const thread = await this.#acquire(signal);
    let worker = (thread.worker ??= new Worker(
      new URL('./lattice-bxl-worker.ts', import.meta.url),
      { resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 } },
    ));
    try {
      return await new Promise<T>((resolve, reject) => {
        let settled = false;
        let finish = (error?: unknown, result?: T) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          worker.off('message', onMessage);
          worker.off('error', onError);
          worker.off('exit', onExit);
          if (error !== undefined) {
            thread.worker = undefined;
            // Do not release the slot until the old worker has actually
            // stopped. A rejected Promise alone does not stop CPU work.
            void worker.terminate().then(
              () => reject(error),
              () => reject(error),
            );
          } else {
            resolve(result!);
          }
        };
        let onAbort = () =>
          finish(signal?.reason ?? new Error('BXL work aborted'));
        let onMessage = (message: {
          result?: T;
          error?: string;
          unsupportedComputation?: boolean;
        }) => {
          if (message.error || !message.result) {
            const Failure = message.unsupportedComputation
              ? LatticeUnsupportedComputation
              : Error;
            finish(new Failure(message.error ?? 'Missing BXL result'));
          } else {
            finish(undefined, message.result);
          }
        };
        let onError = (error: Error) => finish(error);
        let onExit = (code: number) =>
          finish(new Error(`BXL worker exited (${code})`));
        let timer = setTimeout(
          () => finish(new Error('BXL worker deadline exceeded')),
          timeoutMs,
        );
        worker.once('message', onMessage);
        worker.once('error', onError);
        worker.once('exit', onExit);
        signal?.addEventListener('abort', onAbort, { once: true });
        if (signal?.aborted) onAbort();
        else worker.postMessage({ kind, manifest, inputs });
      });
    } finally {
      this.#release(thread);
    }
  }

  async close(): Promise<void> {
    const workers = this.#threads.map((thread) => {
      const worker = thread.worker;
      thread.worker = undefined;
      return worker;
    });
    await Promise.all(workers.map((worker) => worker?.terminate()));
  }
}
