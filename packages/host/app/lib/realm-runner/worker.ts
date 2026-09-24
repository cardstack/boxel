import { getQuickJS, shouldInterruptAfterDeadline } from 'quickjs-emscripten';

import type {
  RealmRunnerCallMethod,
  RealmRunnerRequest,
  RealmRunnerResponse,
} from './types';
import type {
  QuickJSContext,
  QuickJSDeferredPromise,
} from 'quickjs-emscripten';

const worker = globalThis as unknown as {
  onmessage: ((event: MessageEvent<RealmRunnerRequest>) => void) | null;
  postMessage(message: RealmRunnerResponse): void;
};

// Load QuickJS as soon as the worker starts rather than when the first request
// arrives, so the WASM fetch and compile overlap with the message round trip.
// Announcing `ready` lets the caller time the submitted script alone; startup
// can take seconds on a cold cache and is not the script's cost to bear.
const quickJSReady = getQuickJS();
quickJSReady.then(
  () => worker.postMessage({ type: 'ready' }),
  (error: unknown) =>
    worker.postMessage({
      type: 'error',
      error: `Realm runner failed to load QuickJS: ${
        error instanceof Error ? error.message : String(error)
      }`,
    }),
);

// The guest sees only `realm`. Each method is a thin wrapper that hands its
// arguments to the host and parses the host's JSON answer; the host does the
// work and the checks, so nothing here is trusted.
const BOOTSTRAP = `
  (() => {
    const hostCall = globalThis.__hostCall;
    delete globalThis.__hostCall;
    const call = async (method, args) =>
      JSON.parse(await hostCall(method, JSON.stringify(args)));
    globalThis.realm = Object.freeze({
      current: Object.freeze({ url: globalThis.__realmURL }),
      fs: Object.freeze({
        readText: (path) => call('fs.readText', [path]),
        exists: (path) => call('fs.exists', [path]),
        replace: (path, search, replacement) =>
          call('fs.replace', [path, search, replacement]),
        writeText: (path, content) => call('fs.writeText', [path, content]),
      }),
    });
    delete globalThis.__realmURL;
  })();
`;

const METHODS = new Set<RealmRunnerCallMethod>([
  'fs.readText',
  'fs.exists',
  'fs.replace',
  'fs.writeText',
]);

// A worker runs one script. These hold that run's open host calls so a
// `callResult` can settle the guest promise that is waiting for it.
let vm: QuickJSContext | undefined;
let drain: (() => void) | undefined;
let pending = new Map<number, QuickJSDeferredPromise>();
let nextCallId = 1;

function settleCall(
  request: Extract<RealmRunnerRequest, { type: 'callResult' }>,
) {
  let deferred = pending.get(request.id);
  if (!deferred || !vm) {
    return;
  }
  pending.delete(request.id);
  if (request.error !== undefined) {
    let error = vm.newError(request.error);
    deferred.reject(error);
    error.dispose();
  } else {
    let value = vm.newString(request.value ?? 'null');
    deferred.resolve(value);
    value.dispose();
  }
  deferred.dispose();
  drain?.();
}

worker.onmessage = async (event: MessageEvent<RealmRunnerRequest>) => {
  let request = event.data;
  if (request.type === 'callResult') {
    try {
      settleCall(request);
    } catch (error) {
      worker.postMessage({
        type: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }
  if (request.type !== 'run' || vm) {
    return;
  }

  try {
    let QuickJS = await quickJSReady;
    let runtime = QuickJS.newRuntime();
    runtime.setMemoryLimit(8 * 1024 * 1024);
    runtime.setMaxStackSize(512 * 1024);
    runtime.setInterruptHandler(
      shouldInterruptAfterDeadline(Date.now() + request.timeoutMs),
    );
    let context = runtime.newContext();
    vm = context;
    // `resolvePromise` bridges a guest promise to a native one, but QuickJS
    // only moves a promise along when its job queue is drained. Drain after
    // the script starts and after every host answer.
    drain = () => {
      while (runtime.hasPendingJob()) {
        context.unwrapResult(runtime.executePendingJobs());
      }
    };

    let hostCall = context.newFunction(
      '__hostCall',
      (methodHandle, argsHandle) => {
        let method = context.getString(methodHandle) as RealmRunnerCallMethod;
        if (!METHODS.has(method)) {
          throw new Error(`Unknown realm call: ${method}`);
        }
        let args = JSON.parse(context.getString(argsHandle)) as unknown[];
        let deferred = context.newPromise();
        let id = nextCallId++;
        pending.set(id, deferred);
        worker.postMessage({ type: 'call', id, method, args });
        return deferred.handle;
      },
    );
    context.setProp(context.global, '__hostCall', hostCall);
    hostCall.dispose();
    let realmURL = context.newString(request.realmURL);
    context.setProp(context.global, '__realmURL', realmURL);
    realmURL.dispose();
    context.unwrapResult(context.evalCode(BOOTSTRAP)).dispose();

    let promise = context.unwrapResult(
      context.evalCode(`(async () => {\n${request.code}\n})()`),
    );
    let resolvedPromise = context.resolvePromise(promise);
    drain();
    let resolved = await resolvedPromise;
    promise.dispose();
    let value = context.unwrapResult(resolved);
    let scriptResult = JSON.stringify(context.dump(value)) ?? '';
    value.dispose();
    if (pending.size > 0) {
      // A realm call the script did not await would finish after the run is
      // reported, so its write could never be saved or reported.
      throw new Error(
        'The script returned before all realm calls finished; await every realm call',
      );
    }
    worker.postMessage({ type: 'success', result: { scriptResult } });
  } catch (error) {
    worker.postMessage({
      type: 'error',
      error: error instanceof Error ? error.message : String(error),
    });
  }
  // The caller terminates the worker once it has an answer, which frees the
  // runtime with it, so the handles are not disposed one by one here.
};
