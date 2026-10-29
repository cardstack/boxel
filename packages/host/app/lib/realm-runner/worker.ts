import {
  newQuickJSWASMModuleFromVariant,
  newVariant,
  RELEASE_SYNC,
} from 'quickjs-emscripten';

import {
  describeScriptError,
  REALM_RUNNER_SCRIPT_FILE_NAME,
  REALM_RUNNER_WRAPPER_LINES,
  wrapRealmRunnerScript,
} from '@cardstack/runtime-common/realm-runner-script';

import type {
  RealmScriptErrorInfo,
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
        copy: (fromPath, toPath) => call('fs.copy', [fromPath, toPath]),
        writeBytes: (path, base64) => call('fs.writeBytes', [path, base64]),
        delete: (path) => call('fs.delete', [path]),
        download: (sourceUrl, path) =>
          call('fs.download', [sourceUrl, path]),
      }),
      cards: Object.freeze({
        search: (query) => call('cards.search', [query]),
        get: (path) => call('cards.get', [path]),
        update: (path, attributes) =>
          call('cards.update', [path, attributes]),
      }),
      entries: Object.freeze({
        search: (query, options) =>
          call('entries.search', [query, options ?? {}]),
      }),
      capture: (path, options) => call('capture', [path, options ?? {}]),
      images: Object.freeze({
        generate: (options) => call('images.generate', [options ?? {}]),
      }),
      workspaces: Object.freeze({
        create: (options) => call('workspaces.create', [options ?? {}]),
        delete: (url) => call('workspaces.delete', [url]),
      }),
      ui: Object.freeze({
        switchSubmode: (submode) => call('ui.switchSubmode', [submode]),
        openFile: (path) => call('ui.openFile', [path]),
        previewFormat: (path, format) =>
          call('ui.previewFormat', [path, format]),
        openWorkspace: () => call('ui.openWorkspace', []),
      }),
      index: Object.freeze({
        invalidate: (paths) => call('index.invalidate', [paths]),
        reindex: () => call('index.reindex', []),
        fullReindex: () => call('index.fullReindex', []),
        cancelJob: () => call('index.cancelJob', []),
      }),
      web: Object.freeze({
        search: (query, options) =>
          call('web.search', [query, options ?? {}]),
        read: (url, options) => call('web.read', [url, options ?? {}]),
      }),
      resolve: (request) => call('resolve', [request ?? {}]),
      activity: (details) => call('activity', [details ?? {}]),
      plan: (steps) => call('plan', [steps]),
      ask: (request) => call('ask', [request ?? {}]),
    });
    globalThis.room = Object.freeze({
      enableSkills: (ids) => call('room.enableSkills', [ids]),
      disableSkills: (ids) => call('room.disableSkills', [ids]),
      setModel: (model) => call('room.setModel', [model]),
    });
    delete globalThis.__realmURL;
  })();
`;

// What a script error throws out of the run, so the host learns which error
// it was, where, and whether the script got to run at all.
class ScriptFailure extends Error {
  constructor(
    message: string,
    readonly info: RealmScriptErrorInfo,
  ) {
    super(message);
  }
}

function scriptFailure(
  dumped: unknown,
  code: string,
  phase: RealmScriptErrorInfo['phase'],
): Error {
  let error = (dumped ?? {}) as {
    name?: string;
    message?: string;
    lineNumber?: number;
  };
  let message = describeScriptError(dumped, code);
  let name = error.name ?? 'Error';
  if (
    !['SyntaxError', 'TypeError', 'ReferenceError', 'RangeError'].includes(name)
  ) {
    return new Error(message);
  }
  return new ScriptFailure(message, {
    name,
    message: error.message ?? String(dumped),
    ...(typeof error.lineNumber === 'number'
      ? { line: error.lineNumber - REALM_RUNNER_WRAPPER_LINES }
      : {}),
    phase,
  });
}

const METHODS = new Set<RealmRunnerCallMethod>([
  'fs.readText',
  'fs.exists',
  'fs.list',
  'fs.replace',
  'fs.writeText',
  'fs.copy',
  'fs.writeBytes',
  'fs.download',
  'cards.search',
  'cards.get',
  'cards.update',
  'entries.search',
  'fs.delete',
  'capture',
  'images.generate',
  'workspaces.create',
  'workspaces.delete',
  'room.enableSkills',
  'room.disableSkills',
  'room.setModel',
  'ui.switchSubmode',
  'ui.openFile',
  'ui.previewFormat',
  'ui.openWorkspace',
  'index.invalidate',
  'index.reindex',
  'index.fullReindex',
  'index.cancelJob',
  'web.search',
  'web.read',
  'resolve',
  'activity',
  'plan',
  'ask',
]);

// A worker runs one script. These hold that run's open host calls so a
// `callResult` can settle the guest promise that is waiting for it.
let vm: QuickJSContext | undefined;
let drain: (() => void) | undefined;
let pending = new Map<number, QuickJSDeferredPromise>();
// When the script must stop. Time a call spent waiting on a person
// (realm.ask) does not count: its answer moves this out.
let deadlineAt = 0;
let nextCallId = 1;

function settleCall(
  request: Extract<RealmRunnerRequest, { type: 'callResult' }>,
) {
  let deferred = pending.get(request.id);
  if (!deferred || !vm) {
    return;
  }
  pending.delete(request.id);
  if (request.extendMs) {
    deadlineAt += request.extendMs;
  }
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
    deadlineAt = Date.now() + request.timeoutMs;
    runtime.setInterruptHandler(() => Date.now() > deadlineAt);
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
      wrapRealmRunnerScript(request.code),
      REALM_RUNNER_SCRIPT_FILE_NAME,
    );
    if (evaluated.error) {
      let dumped = context.dump(evaluated.error);
      evaluated.error.dispose();
      throw scriptFailure(dumped, request.code, 'compile');
    }
    let promise = evaluated.value;
    let resolvedPromise = context.resolvePromise(promise);
    drain();
    let resolved = await resolvedPromise;
    promise.dispose();
    if (resolved.error) {
      let dumped = context.dump(resolved.error);
      resolved.error.dispose();
      throw scriptFailure(dumped, request.code, 'run');
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
      ...(error instanceof ScriptFailure ? { scriptError: error.info } : {}),
    });
  }
  // The caller terminates the worker once it has an answer, which frees the
  // runtime with it, so the handles are not disposed one by one here.
};
