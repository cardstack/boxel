import { loadAllFormulaExtensions } from '@cardstack/bxl/bxl/bridge/lazy-formulas';
import { isBxlTransformError, runBxlTransform } from '@cardstack/bxl/transform';

import { MAX_TRANSFORM_OUTPUT_BYTES } from './transform-limits';

import type {
  TransformWorkerRequest,
  TransformWorkerResponse,
} from './transform';

// Runs realm.transform programs for one Realm Runner run, outside QuickJS: the
// BXL evaluator is large and synchronous, so it gets its own thread, and the
// host can stop a program that runs too long by ending this worker.

const worker = globalThis as unknown as {
  onmessage: ((event: MessageEvent<TransformWorkerRequest>) => void) | null;
  postMessage(message: TransformWorkerResponse): void;
};

const encoder = new TextEncoder();

// Every Excel function, the lazy families too, so a program never fails on
// a function that exists but was not loaded yet. The host's start deadline
// ends when `ready` is posted.
const formulasLoaded = loadAllFormulaExtensions().then(() =>
  worker.postMessage({ ready: true }),
);

worker.onmessage = async (event: MessageEvent<TransformWorkerRequest>) => {
  let { id, input, source, params, syntax } = event.data;
  try {
    await formulasLoaded;
    // Programs run one at a time, so a call's deadline starts here and not
    // when it was posted: the time it waited behind other calls is not its own.
    worker.postMessage({ id, started: true });
    let value = JSON.stringify(
      runBxlTransform(source, input, params ? { params } : {}, { syntax }) ??
        null,
    );
    // Measured here, so that only an accepted value is copied to the UI
    // thread. A string longer than the limit in UTF-16 units is longer in
    // bytes too, so the encoding is skipped for it.
    if (
      value.length > MAX_TRANSFORM_OUTPUT_BYTES ||
      encoder.encode(value).byteLength > MAX_TRANSFORM_OUTPUT_BYTES
    ) {
      worker.postMessage({ id, outputTooLarge: true });
      return;
    }
    worker.postMessage({ id, value });
  } catch (error) {
    worker.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
      ...(isBxlTransformError(error) ? { phase: error.phase } : {}),
    });
  }
};
