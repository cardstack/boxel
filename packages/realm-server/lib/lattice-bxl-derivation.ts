import { Worker } from 'node:worker_threads';
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

// One job at a time per worker. The queue owns priority and publication. Keeping
// this executor separate also permits a hard deadline when cooperative BXL
// limits cannot interrupt a single operation. This is not an OS sandbox.
export class LatticeBxlWorker {
  #worker: Worker | undefined;
  #busy = false;

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
    if (this.#busy) throw new Error('BXL worker is already busy');
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
    this.#busy = true;
    let worker = (this.#worker ??= new Worker(
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
            this.#worker = undefined;
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
        let onMessage = (message: { result?: T; error?: string }) => {
          if (message.error || !message.result) {
            finish(new Error(message.error ?? 'Missing BXL result'));
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
      this.#busy = false;
    }
  }

  async close(): Promise<void> {
    let worker = this.#worker;
    this.#worker = undefined;
    await worker?.terminate();
  }
}
