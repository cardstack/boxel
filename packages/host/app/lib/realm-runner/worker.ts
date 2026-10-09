import {
  newQuickJSWASMModuleFromVariant,
  newVariant,
  RELEASE_SYNC,
  shouldInterruptAfterDeadline,
} from 'quickjs-emscripten';

import type {
  RealmRunnerCallMethod,
  RealmRunnerRequest,
  RealmRunnerResponse,
} from './types';
import type {
  QuickJSContext,
  QuickJSDeferredPromise,
  QuickJSWASMModule,
} from 'quickjs-emscripten';

const worker = globalThis as unknown as {
  onmessage: ((event: MessageEvent<RealmRunnerRequest>) => void) | null;
  postMessage(message: RealmRunnerResponse): void;
};

// The host posts `run` as soon as it creates the worker, so loading QuickJS
// here costs no more than loading it at startup. Announcing `ready` lets the
// caller time the submitted script alone; startup can take seconds on a cold
// cache and is not the script's cost to bear.
async function loadQuickJS(wasmURL: string): Promise<QuickJSWASMModule> {
  try {
    let QuickJS = await newQuickJSWASMModuleFromVariant(
      newVariant(RELEASE_SYNC, { wasmLocation: wasmURL }),
    );
    worker.postMessage({ type: 'ready' });
    return QuickJS;
  } catch (error) {
    throw new Error(
      `Realm runner failed to load QuickJS: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

// The guest sees only `realm` and `room`. Each method is a thin wrapper that hands its
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
        list: (path) => call('fs.list', [path]),
        replace: (path, search, replacement) =>
          call('fs.replace', [path, search, replacement]),
        writeText: (path, content) => call('fs.writeText', [path, content]),
      }),
      capture: (path, options) => call('capture', [path, options ?? {}]),
    });
    globalThis.room = Object.freeze({
      enableSkills: (ids) => call('room.enableSkills', [ids]),
      disableSkills: (ids) => call('room.disableSkills', [ids]),
      setModel: (model) => call('room.setModel', [model]),
    });
    delete globalThis.__realmURL;
  })();
`;

const SCRIPT_FILE_NAME = 'realm-code.js';
// The script runs inside `(async () => {\n … \n})()`, so its first line is
// line 2 of what QuickJS evaluates.
const WRAPPER_LINES = 1;

// Turns an error from the script itself into a message the model can act on:
// the error, the line of its own script it points at with the lines around
// it, and, for the error that comes up most, what usually causes it. Errors
// from realm calls and the time-limit interrupt keep their own message.
function describeScriptError(dumped: unknown, code: string): string {
  let error = (dumped ?? {}) as {
    name?: string;
    message?: string;
    lineNumber?: number;
  };
  let message = error.message ?? String(dumped);
  let name = error.name ?? 'Error';
  if (
    !['SyntaxError', 'TypeError', 'ReferenceError', 'RangeError'].includes(name)
  ) {
    return message;
  }
  let lines = code.split('\n');
  let line =
    typeof error.lineNumber === 'number'
      ? error.lineNumber - WRAPPER_LINES
      : undefined;
  let parts = [
    `${name} in the script${line ? ` at line ${line}` : ''}: ${message}`,
  ];
  if (line && line >= 1 && line <= lines.length) {
    let from = Math.max(1, line - 2);
    let to = Math.min(lines.length, line + 1);
    let excerpt = [];
    for (let n = from; n <= to; n++) {
      excerpt.push(
        `${n === line ? '>' : ' '} ${n} | ${lines[n - 1].slice(0, 200)}`,
      );
    }
    parts.push(excerpt.join('\n'));
  }
  if (name === 'SyntaxError' && code.includes('`')) {
    parts.push(
      "If a file's content is inside a template literal, a backtick or ${ in that content ends the string or is interpolated. Escape them in the content as \\` and \\${, or build the content without a template literal.",
    );
  }
  return parts.join('\n');
}

const METHODS = new Set<RealmRunnerCallMethod>([
  'fs.readText',
  'fs.exists',
  'fs.list',
  'fs.replace',
  'fs.writeText',
  'capture',
  'room.enableSkills',
  'room.disableSkills',
  'room.setModel',
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
    let QuickJS = await loadQuickJS(request.wasmURL);
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

    let evaluated = context.evalCode(
      `(async () => {\n${request.code}\n})()`,
      SCRIPT_FILE_NAME,
    );
    if (evaluated.error) {
      let dumped = context.dump(evaluated.error);
      evaluated.error.dispose();
      throw new Error(describeScriptError(dumped, request.code));
    }
    let promise = evaluated.value;
    let resolvedPromise = context.resolvePromise(promise);
    drain();
    let resolved = await resolvedPromise;
    promise.dispose();
    if (resolved.error) {
      let dumped = context.dump(resolved.error);
      resolved.error.dispose();
      throw new Error(describeScriptError(dumped, request.code));
    }
    let value = resolved.value;
    let scriptResult = JSON.stringify(context.dump(value)) ?? '';
    value.dispose();
    if (pending.size > 0) {
      // A realm call the script did not await would still be running when the
      // run is reported. Fail the run; the host stops its session, so such a
      // write is not saved behind the report.
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
