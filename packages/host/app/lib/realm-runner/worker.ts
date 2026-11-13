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

import {
  MAX_MILESTONE_CHARS,
  MAX_MILESTONES,
  MAX_RUN_NOTIFICATION_CHARS,
  MAX_RUN_NOTIFICATIONS,
  NOTIFY_METHODS,
  surfaceMethods,
} from './surfaces';

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

// The script's file name as a pattern, for finding its frames in a stack.
const SCRIPT_FILE_PATTERN = REALM_RUNNER_SCRIPT_FILE_NAME.replace(
  /[.*+?^${}()|[\]\\]/g,
  '\\$&',
);

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

// The guest sees only `realm`, and on surfaces that have them, `room` and
// `console`. Each method is a thin wrapper that hands its arguments to the
// host and parses the host's JSON answer; the host does the work and the
// checks, so nothing here is trusted. Every method is defined here, and the
// surface's list (`__methods`) keeps those it names: a group left with no
// method, such as `room` on the automation surface, is not defined at all.
//
// Progress and console methods are one-way (`__hostNotify`): they return
// nothing, so a script needn't await them, and a run doesn't fail for a
// `console.log` it didn't await. Their arguments are checked here, where a
// bad one can still throw in the script.
const BOOTSTRAP = `
  (() => {
    const hostCall = globalThis.__hostCall;
    const hostNotify = globalThis.__hostNotify;
    const allowed = new Set(JSON.parse(globalThis.__methods));
    const automation =
      globalThis.__automation === undefined
        ? undefined
        : JSON.parse(globalThis.__automation);
    const realmURL = globalThis.__realmURL;
    for (const name of [
      '__hostCall',
      '__hostNotify',
      '__methods',
      '__automation',
      '__realmURL',
    ]) {
      delete globalThis[name];
    }
    const call = async (method, args) =>
      JSON.parse(await hostCall(method, JSON.stringify(args)));
    const notify = (method, args) => {
      hostNotify(method, JSON.stringify(args));
    };
    const deepFreeze = (value) => {
      if (value !== null && typeof value === 'object') {
        Object.values(value).forEach(deepFreeze);
        Object.freeze(value);
      }
      return value;
    };
    const onSurface = (methods, prefix) => {
      const kept = {};
      for (const [key, value] of Object.entries(methods)) {
        const name = prefix + key;
        if (typeof value === 'function') {
          if (allowed.has(name)) {
            kept[key] = value;
          }
        } else {
          const group = onSurface(value, name + '.');
          if (Object.keys(group).length > 0) {
            kept[key] = group;
          }
        }
      }
      return Object.freeze(kept);
    };
    const milestoneName = (name, method) => {
      if (typeof name !== 'string' || !name.trim() || name.length > ${MAX_MILESTONE_CHARS}) {
        throw new TypeError(
          'realm.progress.' + method + ' expects milestone names of 1 to ${MAX_MILESTONE_CHARS} characters',
        );
      }
      return name.trim();
    };
    const wholeNumber = (value, name) => {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
        throw new TypeError(
          'realm.progress.count ' + name + ' must be a whole number of 0 or more',
        );
      }
      return value;
    };
    // The script's own line that made the call: the first frame of the
    // script in the stack, less the line the wrapper adds above it.
    const scriptLine = () => {
      const found = /${SCRIPT_FILE_PATTERN}:(\\d+)/.exec(new Error().stack ?? '');
      return found ? Number(found[1]) - ${REALM_RUNNER_WRAPPER_LINES} : null;
    };
    const show = (value) => {
      if (typeof value === 'string') {
        return value;
      }
      if (value instanceof Error) {
        return value.name + ': ' + value.message;
      }
      try {
        const text = JSON.stringify(value);
        return text === undefined ? String(value) : text;
      } catch {
        return String(value);
      }
    };
    const log = (level) => (...values) => {
      notify('console.' + level, [values.map(show).join(' '), scriptLine()]);
    };
    globalThis.realm = Object.freeze({
      current: deepFreeze({
        url: realmURL,
        ...(automation === undefined ? {} : { automation }),
      }),
      ...onSurface(
        {
          fs: {
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
          },
          cards: {
            search: (query) => call('cards.search', [query]),
            get: (path) => call('cards.get', [path]),
            update: (path, attributes) =>
              call('cards.update', [path, attributes]),
          },
          operations: {
            invoke: (path, name, payload) =>
              call('operations.invoke', [path, name, payload]),
            invokeBatchOperation: (entries) => call('operations.invokeBatchOperation', [entries]),
            capabilities: (checks) => call('operations.capabilities', [checks]),
          },
          entries: {
            search: (query, options) =>
              call('entries.search', [query, options ?? {}]),
          },
          capture: (path, options) => call('capture', [path, options ?? {}]),
          images: {
            generate: (options) => call('images.generate', [options ?? {}]),
          },
          workspaces: {
            create: (options) => call('workspaces.create', [options ?? {}]),
            delete: (url) => call('workspaces.delete', [url]),
          },
          ui: {
            switchSubmode: (submode) => call('ui.switchSubmode', [submode]),
            openFile: (path) => call('ui.openFile', [path]),
            previewFormat: (path, format) =>
              call('ui.previewFormat', [path, format]),
            openWorkspace: () => call('ui.openWorkspace', []),
          },
          index: {
            invalidate: (paths) => call('index.invalidate', [paths]),
            reindex: () => call('index.reindex', []),
            fullReindex: () => call('index.fullReindex', []),
            cancelJob: () => call('index.cancelJob', []),
          },
          web: {
            search: (query, options) =>
              call('web.search', [query, options ?? {}]),
            read: (url, options) => call('web.read', [url, options ?? {}]),
          },
          resolve: (request) => call('resolve', [request ?? {}]),
          transform: (input, source, options) =>
            call('transform', [input ?? null, source, options ?? {}]),
          activity: (details) => call('activity', [details ?? {}]),
          plan: (steps) => call('plan', [steps]),
          ask: (request) => call('ask', [request ?? {}]),
          progress: {
            plan: (names) => {
              if (
                !Array.isArray(names) ||
                names.length === 0 ||
                names.length > ${MAX_MILESTONES}
              ) {
                throw new TypeError(
                  'realm.progress.plan expects 1 to ${MAX_MILESTONES} milestone names',
                );
              }
              notify('progress.plan', [
                names.map((name) => milestoneName(name, 'plan')),
              ]);
            },
            milestone: (name) => {
              notify('progress.milestone', [milestoneName(name, 'milestone')]);
            },
            count: (done, total) => {
              wholeNumber(done, 'done');
              if (total !== undefined && total !== null) {
                wholeNumber(total, 'total');
                if (done > total) {
                  throw new TypeError(
                    'realm.progress.count done cannot be more than total',
                  );
                }
              }
              notify('progress.count', [done, total ?? null]);
            },
          },
        },
        '',
      ),
    });
    const room = onSurface(
      {
        enableSkills: (ids) => call('room.enableSkills', [ids]),
        disableSkills: (ids) => call('room.disableSkills', [ids]),
        setModel: (model) => call('room.setModel', [model]),
        credits: () => call('room.credits', []),
      },
      'room.',
    );
    if (Object.keys(room).length > 0) {
      globalThis.room = room;
    }
    const console = onSurface(
      {
        log: log('log'),
        info: log('info'),
        warn: log('warn'),
        error: log('error'),
      },
      'console.',
    );
    if (Object.keys(console).length > 0) {
      globalThis.console = console;
    }
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
    stack?: string;
  };
  let message = describeScriptError(dumped, code);
  let name = error.name ?? 'Error';
  // QuickJS's own InternalError is the engine stopping the script (an
  // interrupt at its time limit, memory or stack), not something the script
  // threw. Anything else, including an error the script throws itself, is the
  // script's error and keeps its line.
  if (name === 'InternalError') {
    return new Error(message);
  }
  let line = scriptLineOf(error, code);
  return new ScriptFailure(message, {
    name,
    message: error.message ?? String(dumped),
    ...(line !== undefined ? { line } : {}),
    phase,
  });
}

// The line of its own script an error points at. QuickJS gives an error it
// raises a `lineNumber`, kept as it is. An error the script constructs
// itself carries its line only in its stack, whose frames in the script's
// file include the wrapper's own call to the script: only a frame on one of
// the script's lines counts, and the first such frame is where it was thrown.
function scriptLineOf(
  error: { lineNumber?: number; stack?: string },
  code: string,
): number | undefined {
  let lineCount = code.split('\n').length;
  let onScript = (wrapped: number) => {
    let line = wrapped - REALM_RUNNER_WRAPPER_LINES;
    return line >= 1 && line <= lineCount ? line : undefined;
  };
  if (typeof error.lineNumber === 'number') {
    return error.lineNumber - REALM_RUNNER_WRAPPER_LINES;
  }
  for (let found of (error.stack ?? '').matchAll(
    new RegExp(`${SCRIPT_FILE_PATTERN}:(\\d+)`, 'g'),
  )) {
    let line = onScript(Number(found[1]));
    if (line !== undefined) {
      return line;
    }
  }
  return undefined;
}

// A worker runs one script. These hold that run's open host calls so a
// `callResult` can settle the guest promise that is waiting for it.
let vm: QuickJSContext | undefined;
let drain: (() => void) | undefined;
let pending = new Map<number, QuickJSDeferredPromise>();
// When the script must stop. Time a call spent waiting on a person
// (realm.ask) does not count: its answer moves this out.
let deadlineAt = 0;
let nextCallId = 1;
// One-way calls posted, the characters of their arguments, and those dropped
// past the run's limit. They are dropped here, before they are posted, so a
// script looping on `console.log` can't fill the tab with messages.
let notified = 0;
let notifiedChars = 0;
let dropped = 0;

function reportDropped() {
  if (dropped > 0) {
    worker.postMessage({ type: 'dropped', count: dropped });
  }
}

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

    let surface = request.surface ?? 'interactive';
    let methods = surfaceMethods(surface);
    let hostCall = context.newFunction(
      '__hostCall',
      (methodHandle, argsHandle) => {
        let method = context.getString(methodHandle) as RealmRunnerCallMethod;
        if (!methods.has(method) || NOTIFY_METHODS.has(method)) {
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
    let hostNotify = context.newFunction(
      '__hostNotify',
      (methodHandle, argsHandle) => {
        let method = context.getString(methodHandle) as RealmRunnerCallMethod;
        if (!methods.has(method) || !NOTIFY_METHODS.has(method)) {
          throw new Error(`Unknown realm call: ${method}`);
        }
        let argsJSON = context.getString(argsHandle);
        if (
          notified >= MAX_RUN_NOTIFICATIONS ||
          notifiedChars + argsJSON.length > MAX_RUN_NOTIFICATION_CHARS
        ) {
          dropped += 1;
          if (dropped === 1) {
            reportDropped();
          }
          return;
        }
        notified += 1;
        notifiedChars += argsJSON.length;
        let args = JSON.parse(argsJSON) as unknown[];
        worker.postMessage({ type: 'notify', method, args });
      },
    );
    context.setProp(context.global, '__hostNotify', hostNotify);
    hostNotify.dispose();
    for (let [name, value] of Object.entries({
      __realmURL: request.realmURL,
      __methods: JSON.stringify([...methods]),
      ...(surface === 'automation' && request.automation
        ? { __automation: JSON.stringify(request.automation) }
        : {}),
    })) {
      let handle = context.newString(value);
      context.setProp(context.global, name, handle);
      handle.dispose();
    }
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
    reportDropped();
    worker.postMessage({ type: 'success', result: { scriptResult } });
  } catch (error) {
    reportDropped();
    worker.postMessage({
      type: 'error',
      error: error instanceof Error ? error.message : String(error),
      ...(error instanceof ScriptFailure ? { scriptError: error.info } : {}),
    });
  }
  // The caller terminates the worker once it has an answer, which frees the
  // runtime with it, so the handles are not disposed one by one here.
};
