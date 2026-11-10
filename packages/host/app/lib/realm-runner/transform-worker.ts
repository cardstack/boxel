import { resolveLazyBuiltinLibrariesForExpressions } from '@cardstack/bxl/bxl/bridge/lazy-formulas';
import { isBxlTransformError, runBxlTransform } from '@cardstack/bxl/transform';

import {
  MAX_TRANSFORM_OUTPUT_BYTES,
  TRANSFORM_MAX_STEPS,
  TRANSFORM_TIMEOUT_MS,
} from './transform-limits';

import type {
  TransformWorkerRequest,
  TransformWorkerResponse,
} from './transform';

// Runs realm.transform programs for one Realm Runner run, outside QuickJS: the
// BXL evaluator is large and synchronous, so it gets its own thread, and the
// host can stop a program that stalls by ending this worker.

const worker = globalThis as unknown as {
  onmessage: ((event: MessageEvent<TransformWorkerRequest>) => void) | null;
  postMessage(message: TransformWorkerResponse): void;
};

const encoder = new TextEncoder();

worker.onmessage = async (event: MessageEvent<TransformWorkerRequest>) => {
  let { id, input, source, params, syntax } = event.data;
  try {
    // Programs run one at a time, so a call's time starts here and not when
    // it was posted: the time it waited behind other calls is not its own.
    worker.postMessage({ id, started: true });
    let startedAt = Date.now();
    // Only the Excel formula families this program names, each loaded once
    // per worker.
    let libraries = await resolveLazyBuiltinLibrariesForExpressions([source]);
    let value = JSON.stringify(
      runBxlTransform(source, input, params ? { params } : {}, {
        syntax,
        libraries,
        runtimeLimits: {
          maxMillis: Math.max(
            TRANSFORM_TIMEOUT_MS - (Date.now() - startedAt),
            1,
          ),
          maxSteps: TRANSFORM_MAX_STEPS,
        },
      }) ?? null,
    );
    // Measured here, so that only an accepted value is copied to the UI
    // thread. A string longer than the limit in UTF-16 units is longer in
    // bytes too, so the encoding is skipped for it.
    let bytes =
      value.length > MAX_TRANSFORM_OUTPUT_BYTES
        ? value.length
        : encoder.encode(value).byteLength;
    if (bytes > MAX_TRANSFORM_OUTPUT_BYTES) {
      worker.postMessage({ id, outputTooLarge: true });
      return;
    }
    worker.postMessage({ id, value, bytes });
  } catch (error) {
    worker.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
      ...(isBxlTransformError(error) ? { phase: error.phase } : {}),
    });
  }
};

// The host's start deadline ends here, once the worker module and BXL's core
// have loaded.
worker.postMessage({ ready: true });
