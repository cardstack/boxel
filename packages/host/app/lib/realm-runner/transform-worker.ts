import { loadAllFormulaExtensions } from '@cardstack/bxl/bxl/bridge/lazy-formulas';
import { isBxlTransformError, runBxlTransform } from '@cardstack/bxl/transform';

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

// Every Excel function, the lazy families too, so a program never fails on
// a function that exists but was not loaded yet.
let formulasLoaded: Promise<void> | undefined;

worker.onmessage = async (event: MessageEvent<TransformWorkerRequest>) => {
  let { id, input, source, params, syntax } = event.data;
  try {
    formulasLoaded ??= loadAllFormulaExtensions();
    await formulasLoaded;
    let value = runBxlTransform(source, input, params ? { params } : {}, {
      syntax,
    });
    worker.postMessage({ id, value: JSON.stringify(value ?? null) });
  } catch (error) {
    worker.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
      ...(isBxlTransformError(error) ? { phase: error.phase } : {}),
    });
  }
};
