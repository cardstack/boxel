import { getQuickJS } from 'quickjs-emscripten';

import { RealmCapabilityHost } from './capability.js';
import { errorDetails, RealmRunnerError } from './errors.js';

const DEFAULT_RUNTIME_LIMITS = Object.freeze({
  timeoutMs: 5_000,
  wallTimeoutMs: 5 * 60_000,
  memoryBytes: 64 * 1024 * 1024,
  stackBytes: 1 * 1024 * 1024,
  inputBytes: 4 * 1024 * 1024,
});

const textEncoder = new TextEncoder();
const REALM_API_VERSION = '2';
const REALM_FEATURES = Object.freeze({
  notebooks: true,
  activity: true,
  streamingActivity: true,
});

const AUTOMATIC_ACTIVITY = Object.freeze({
  'realms.list': ['discover', 'Discovering readable realms'],
  search: ['search', 'Searching readable realms'],
  'bxl.evaluate': ['transform', 'Transforming data with BXL'],
  'fs.list': ['list', 'Listing Realm files'],
  'fs.glob': ['list', 'Finding candidate files'],
  'fs.grep': ['grep', 'Inspecting candidate files'],
  'fs.readText': ['read', 'Reading Realm data'],
  'fs.readJSON': ['read', 'Reading Realm data'],
  'fs.readBase64': ['read', 'Reading Realm data'],
  'fs.readTranspiled': ['read', 'Reading transpiled Realm data'],
  'fs.lint': ['diagnose', 'Checking Realm source'],
  'fs.writeText': ['stage', 'Staging Realm changes'],
  'fs.writeJSON': ['stage', 'Staging Realm changes'],
  'fs.appendText': ['stage', 'Staging Realm changes'],
  'fs.replace': ['stage', 'Staging Realm changes'],
  'fs.copy': ['stage', 'Staging Realm changes'],
  'fs.remove': ['stage', 'Staging Realm changes'],
  'fs.diff': ['preview', 'Preparing Realm change preview'],
  indexingErrors: ['diagnose', 'Checking Realm indexing diagnostics'],
});

function automaticActivity(operation) {
  let direct = AUTOMATIC_ACTIVITY[operation];
  if (direct) return { phase: direct[0], message: direct[1] };
  if (operation === 'scoped.fs.grep') {
    return { phase: 'grep', message: 'Inspecting cross-Realm candidates' };
  }
  if (operation.startsWith('scoped.fs.')) {
    return { phase: 'read', message: 'Reading authorized Realm data' };
  }
  if (
    operation.startsWith('api.') ||
    operation.startsWith('server.') ||
    operation.startsWith('scoped.api.')
  ) {
    return { phase: 'api', message: 'Calling the authenticated Realm API' };
  }
  return undefined;
}

function createActivityReporter(onActivity) {
  let sequence = 0;
  let lastAutomaticPhase;
  return async (
    activity,
    { automatic = false, source = automatic ? 'runtime' : 'script' } = {},
  ) => {
    if (typeof onActivity !== 'function') return;
    if (automatic && activity.phase === lastAutomaticPhase) return;
    if (automatic) lastAutomaticPhase = activity.phase;
    try {
      await onActivity({
        sequence: ++sequence,
        timestamp: Date.now(),
        source,
        status: activity.status ?? 'running',
        ...activity,
      });
    } catch {
      // Observability is best-effort and must never change script behavior.
    }
  };
}

function byteLength(value) {
  return textEncoder.encode(value).byteLength;
}

const GUEST_BOOTSTRAP = String.raw`
(() => {
  'use strict';
  const hostCall = globalThis.__realmHostCall;
  const hostLog = globalThis.__realmHostLog;

  const deepFreeze = (value) => {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      for (const key of Object.keys(value)) deepFreeze(value[key]);
      Object.freeze(value);
    }
    return value;
  };
  const input = deepFreeze(JSON.parse(globalThis.__realmInputJSON));
  const notebook = deepFreeze(JSON.parse(globalThis.__realmNotebookJSON));
  const features = deepFreeze(JSON.parse(globalThis.__realmFeaturesJSON));

  const call = async (operation, args = []) => {
    const envelope = JSON.parse(await hostCall(operation, JSON.stringify(args)));
    if (!envelope.ok) {
      const error = new Error('[realm:' + envelope.error.code + '] ' + envelope.error.message);
      error.code = envelope.error.code;
      error.details = envelope.error.details;
      throw error;
    }
    return envelope.value;
  };

  const encodePattern = (pattern) => {
    if (pattern instanceof RegExp) {
      return { kind: 'regex', source: pattern.source, flags: pattern.flags };
    }
    return pattern;
  };

  const fs = Object.freeze({
    list: () => call('fs.list'),
    glob: (pattern, options) => call('fs.glob', [pattern, options]),
    grep: (pattern, options) => call('fs.grep', [encodePattern(pattern), options]),
    stat: (path) => call('fs.stat', [path]),
    exists: (path) => call('fs.exists', [path]),
    readText: (path) => call('fs.readText', [path]),
    readJSON: (path) => call('fs.readJSON', [path]),
    readBase64: (path) => call('fs.readBase64', [path]),
    readTranspiled: (path) => call('fs.readTranspiled', [path]),
    lint: (path) => call('fs.lint', [path]),
    writeText: (path, content) => call('fs.writeText', [path, content]),
    writeJSON: (path, value, options) => call('fs.writeJSON', [path, value, options]),
    appendText: (path, content) => call('fs.appendText', [path, content]),
    replace: (path, search, replacement, options) =>
      call('fs.replace', [path, search, replacement, options]),
    copy: (from, to) => call('fs.copy', [from, to]),
    remove: (path) => call('fs.remove', [path]),
    diff: (path) => call('fs.diff', [path]),
  });

  const bxl = Object.freeze({
    evaluate: (expression, input, options) =>
      call('bxl.evaluate', [expression, input, options]),
    jq: (expression, input) =>
      call('bxl.evaluate', [expression, input, { syntax: 'jq' }]),
  });

  const api = Object.freeze({
    get: (path, options) => call('api.get', [path, options]),
    head: (path, options) => call('api.head', [path, options]),
    query: (path, body, options) => call('api.query', [path, body, options]),
    request: (method, path, options) =>
      call('api.request', [method, path, options]),
  });

  const server = Object.freeze({
    get: (path, options) => call('server.get', [path, options]),
    head: (path, options) => call('server.head', [path, options]),
    query: (path, body, options) =>
      call('server.query', [path, body, options]),
    request: (method, path, options) =>
      call('server.request', [method, path, options]),
  });

  const openRealm = (url, options = {}) => {
    const writable = options && options.write === true;
    const scopedFs = Object.freeze({
      list: () => call('scoped.fs.list', [url]),
      glob: (pattern, options) =>
        call('scoped.fs.glob', [url, pattern, options]),
      grep: (pattern, options) =>
        call('scoped.fs.grep', [url, encodePattern(pattern), options]),
      stat: (path) => call('scoped.fs.stat', [url, path]),
      exists: (path) => call('scoped.fs.exists', [url, path]),
      readText: (path) => call('scoped.fs.readText', [url, path]),
      readJSON: (path) => call('scoped.fs.readJSON', [url, path]),
      readBase64: (path) => call('scoped.fs.readBase64', [url, path]),
      readTranspiled: (path) =>
        call('scoped.fs.readTranspiled', [url, path]),
      lint: (path) => call('scoped.fs.lint', [url, path]),
    });
    return Object.freeze({
      current: Object.freeze({ url, mode: writable ? 'commit' : 'read-only' }),
      fs: scopedFs,
      bxl,
      api: Object.freeze({
        get: (path, options) => call('scoped.api.get', [url, path, options]),
        head: (path, options) =>
          call('scoped.api.head', [url, path, options]),
        query: (path, body, options) =>
          call('scoped.api.query', [url, path, body, options]),
        request: (method, path, options) =>
          call('scoped.api.request', [url, method, path, options, writable]),
      }),
      search: (query) => call('search', [query, { realms: [url] }]),
      indexingErrors: () => call('scoped.indexingErrors', [url]),
    });
  };

  const realm = Object.freeze({
    apiVersion: '${REALM_API_VERSION}',
    features,
    current: Object.freeze(globalThis.__realmCurrent),
    input,
    notebook,
    fs,
    bxl,
    api,
    server,
    listRealms: (options) => call('realms.list', [options]),
    search: (query, options) => call('search', [query, options]),
    open: openRealm,
    indexingErrors: () => call('indexingErrors'),
    activity: (messageOrDetails) => call('activity', [messageOrDetails]),
    help: () => call('help'),
  });

  const console = Object.freeze({
    debug: (...args) => hostLog('debug', JSON.stringify(args)),
    log: (...args) => hostLog('log', JSON.stringify(args)),
    info: (...args) => hostLog('info', JSON.stringify(args)),
    warn: (...args) => hostLog('warn', JSON.stringify(args)),
    error: (...args) => hostLog('error', JSON.stringify(args)),
  });

  Object.defineProperties(globalThis, {
    realm: { value: realm, writable: false, configurable: false },
    console: { value: console, writable: false, configurable: false },
  });
  delete globalThis.__realmHostCall;
  delete globalThis.__realmHostLog;
  delete globalThis.__realmCurrent;
  delete globalThis.__realmInputJSON;
  delete globalThis.__realmNotebookJSON;
  delete globalThis.__realmFeaturesJSON;
})();
`;

function resultSize(value) {
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch (error) {
    throw new RealmRunnerError(
      'RESULT_NOT_SERIALIZABLE',
      `Realm Script result must be JSON-serializable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return byteLength(serialized ?? 'null');
}

function dumpQuickJSError(context, errorHandle) {
  let dumped = context.dump(errorHandle);
  if (dumped && typeof dumped === 'object') {
    let message = dumped.message ? String(dumped.message) : '';
    let stack = dumped.stack ? String(dumped.stack) : '';
    if (message && stack && !stack.includes(message))
      return `${message}\n${stack}`;
    return stack || message || JSON.stringify(dumped);
  }
  return String(dumped);
}

function quickJSError(message, deadline) {
  let capabilityCode = message.match(/\[realm:([A-Z][A-Z0-9_]*)\]/)?.[1];
  let code =
    capabilityCode ??
    (performance.now() >= deadline || message.includes('interrupted')
      ? 'TIME_LIMIT'
      : 'RUNTIME_ERROR');
  return new RealmRunnerError(code, message);
}

async function beforeWallDeadline(promise, wallDeadline) {
  let remaining = wallDeadline - performance.now();
  if (remaining <= 0) {
    throw new RealmRunnerError(
      'TIME_LIMIT',
      'Realm Script wall-clock execution timed out',
    );
  }
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new RealmRunnerError(
                'TIME_LIMIT',
                'Realm Script wall-clock execution timed out',
              ),
            ),
          remaining,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function runRealmScript({
  code,
  realm,
  mode = 'preview',
  input = {},
  notebook = null,
  adapter,
  bxl,
  limits = {},
  onActivity,
}) {
  if (typeof code !== 'string' || code.trim().length === 0) {
    throw new RealmRunnerError(
      'EMPTY_SCRIPT',
      'Realm Script code must be a non-empty string',
    );
  }
  if (byteLength(code) > 256 * 1024) {
    throw new RealmRunnerError(
      'SOURCE_LIMIT',
      'Realm Script source exceeds 256 KiB',
    );
  }

  let started = performance.now();
  let reportActivity = createActivityReporter(onActivity);
  await reportActivity(
    {
      phase: 'start',
      message: 'Starting Realm Script',
      status: 'running',
    },
    { source: 'runtime' },
  );
  let runtimeLimits = { ...DEFAULT_RUNTIME_LIMITS, ...limits };
  let inputJSON;
  try {
    inputJSON = JSON.stringify(input ?? {});
  } catch (error) {
    throw new RealmRunnerError(
      'INVALID_ARGUMENT',
      `Realm Script input must be JSON-serializable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (byteLength(inputJSON) > runtimeLimits.inputBytes) {
    throw new RealmRunnerError(
      'NOTEBOOK_INPUT_LIMIT',
      `Realm Script input exceeds ${runtimeLimits.inputBytes} bytes`,
    );
  }
  let capability = new RealmCapabilityHost({
    adapter,
    bxl,
    realmUrl: realm,
    mode,
    limits,
  });
  let QuickJS = await getQuickJS();
  let context = QuickJS.newContext();
  let runtime = context.runtime;
  let requests = [];
  let pendingDeferreds = new Set();
  // The bootstrap is fixed, trusted runner code. Start the guest CPU clock
  // only after it is installed so cold WASM/JIT startup cannot consume a
  // user's script budget.
  let deadline = Number.POSITIVE_INFINITY;
  let wallDeadline = Number.POSITIVE_INFINITY;
  let wallAbortController;
  let wallAbortTimer;
  runtime.setMemoryLimit(runtimeLimits.memoryBytes);
  runtime.setMaxStackSize(runtimeLimits.stackBytes);
  runtime.setInterruptHandler(
    () => performance.now() > deadline || performance.now() > wallDeadline,
  );

  try {
    let hostCall = context.newFunction(
      '__realmHostCall',
      (operationHandle, argsHandle) => {
        let operation = context.getString(operationHandle);
        let argsText = context.getString(argsHandle);
        let deferred = context.newPromise();
        pendingDeferreds.add(deferred);
        requests.push({
          operation,
          args: JSON.parse(argsText),
          deferred,
        });
        return deferred.handle;
      },
    );
    context.setProp(context.global, '__realmHostCall', hostCall);
    hostCall.dispose();

    let hostLog = context.newFunction(
      '__realmHostLog',
      (levelHandle, argsHandle) => {
        let level = context.getString(levelHandle);
        let args;
        try {
          args = JSON.parse(context.getString(argsHandle));
        } catch {
          args = ['[unserializable console arguments]'];
        }
        capability.captureLog(level, args);
        return context.undefined;
      },
    );
    context.setProp(context.global, '__realmHostLog', hostLog);
    hostLog.dispose();

    let current = context.newObject();
    let realmUrl = context.newString(realm);
    let runtimeMode = context.newString(mode);
    context.setProp(current, 'url', realmUrl);
    context.setProp(current, 'mode', runtimeMode);
    realmUrl.dispose();
    runtimeMode.dispose();
    context.setProp(context.global, '__realmCurrent', current);
    current.dispose();

    let inputJSONHandle = context.newString(inputJSON);
    context.setProp(context.global, '__realmInputJSON', inputJSONHandle);
    inputJSONHandle.dispose();

    let notebookJSONHandle = context.newString(JSON.stringify(notebook));
    context.setProp(context.global, '__realmNotebookJSON', notebookJSONHandle);
    notebookJSONHandle.dispose();

    let featuresJSONHandle = context.newString(JSON.stringify(REALM_FEATURES));
    context.setProp(context.global, '__realmFeaturesJSON', featuresJSONHandle);
    featuresJSONHandle.dispose();

    let bootstrap = context.evalCode(GUEST_BOOTSTRAP, 'realm-bootstrap.js');
    if (bootstrap.error) {
      let message = dumpQuickJSError(context, bootstrap.error);
      bootstrap.error.dispose();
      throw new RealmRunnerError('BOOTSTRAP_ERROR', message);
    }
    bootstrap.value.dispose();

    deadline = performance.now() + runtimeLimits.timeoutMs;
    wallDeadline = performance.now() + runtimeLimits.wallTimeoutMs;
    wallAbortController = new AbortController();
    adapter.setProgramSignal?.(wallAbortController.signal);
    wallAbortTimer = setTimeout(
      () => wallAbortController.abort(),
      runtimeLimits.wallTimeoutMs,
    );

    let wrapped = `(async function __runRealmScript(realm, console) {\n'use strict';\n${code}\n})(realm, console)`;
    let evaluated = context.evalCode(wrapped, 'realm-script.js');
    if (evaluated.error) {
      let message = dumpQuickJSError(context, evaluated.error);
      evaluated.error.dispose();
      throw quickJSError(message, deadline);
    }

    let promiseHandle = evaluated.value;
    let value;
    for (;;) {
      if (performance.now() >= wallDeadline) {
        promiseHandle.dispose();
        throw new RealmRunnerError(
          'TIME_LIMIT',
          'Realm Script wall-clock execution timed out',
        );
      }
      let jobs = runtime.executePendingJobs();
      if (jobs.error) {
        let message = dumpQuickJSError(context, jobs.error);
        jobs.error.dispose();
        promiseHandle.dispose();
        throw new RealmRunnerError('RUNTIME_ERROR', message);
      }

      let state = context.getPromiseState(promiseHandle);
      if (state.type === 'fulfilled') {
        value = context.dump(state.value);
        state.value.dispose();
        break;
      }
      if (state.type === 'rejected') {
        let message = dumpQuickJSError(context, state.error);
        state.error.dispose();
        promiseHandle.dispose();
        throw quickJSError(message, deadline);
      }

      if (performance.now() >= deadline) {
        promiseHandle.dispose();
        throw new RealmRunnerError(
          'TIME_LIMIT',
          'Realm Script execution timed out',
        );
      }
      if (requests.length === 0) {
        promiseHandle.dispose();
        throw new RealmRunnerError(
          'DEADLOCK',
          'Realm Script is waiting on a promise that the runner cannot resolve',
        );
      }

      let batch = requests.splice(0);
      for (let request of batch) {
        if (performance.now() >= wallDeadline) {
          promiseHandle.dispose();
          throw new RealmRunnerError(
            'TIME_LIMIT',
            'Realm Script wall-clock execution timed out',
          );
        }
        let envelope;
        let capabilityStarted = performance.now();
        try {
          let activity = automaticActivity(request.operation);
          if (activity) {
            await reportActivity(
              { ...activity, operation: request.operation },
              { automatic: true },
            );
          }
          let requestValue = await beforeWallDeadline(
            capability.dispatch(request.operation, request.args),
            wallDeadline,
          );
          if (request.operation === 'activity') {
            await reportActivity({ ...requestValue, operation: 'activity' });
            requestValue = null;
          }
          envelope = {
            ok: true,
            value: requestValue === undefined ? null : requestValue,
          };
        } catch (error) {
          envelope = { ok: false, error: errorDetails(error) };
        } finally {
          // The interrupt deadline bounds guest QuickJS execution, not Realm
          // HTTP latency. A federated search or file read can legitimately
          // take longer than the guest CPU budget while QuickJS is suspended
          // awaiting its capability promise.
          deadline += performance.now() - capabilityStarted;
        }
        if (performance.now() >= wallDeadline) {
          promiseHandle.dispose();
          throw new RealmRunnerError(
            'TIME_LIMIT',
            'Realm Script wall-clock execution timed out',
          );
        }
        let responseText = JSON.stringify(envelope);
        if (byteLength(responseText) > capability.limits.rpcResultBytes) {
          responseText = JSON.stringify({
            ok: false,
            error: {
              code: 'RESULT_LIMIT',
              message: `Realm capability response exceeds ${capability.limits.rpcResultBytes} bytes`,
            },
          });
        }
        let responseHandle = context.newString(responseText);
        request.deferred.resolve(responseHandle);
        responseHandle.dispose();
        pendingDeferreds.delete(request.deferred);
      }
    }
    promiseHandle.dispose();
    if (resultSize(value) > capability.limits.resultBytes) {
      throw new RealmRunnerError(
        'RESULT_LIMIT',
        'Realm Script result exceeds the configured byte limit',
      );
    }

    await reportActivity(
      {
        phase: mode === 'commit' ? 'commit' : 'finalize',
        message:
          mode === 'commit'
            ? 'Committing staged Realm changes'
            : 'Finalizing Realm Script preview',
        operation: 'finish',
      },
      { automatic: true },
    );
    let finished = await capability.finish();
    await reportActivity(
      {
        phase: 'complete',
        message: 'Realm Script complete',
        status: 'completed',
      },
      { source: 'runtime' },
    );
    return {
      ok: true,
      mode,
      value: value === undefined ? null : value,
      ...finished,
      stats: {
        ...finished.stats,
        durationMs: Math.round((performance.now() - started) * 100) / 100,
      },
    };
  } catch (error) {
    await reportActivity(
      {
        phase: 'failed',
        message: 'Realm Script failed',
        status: 'failed',
      },
      { source: 'runtime' },
    );
    if (capability.effects.length === 0) throw error;
    let details = {
      ...(error instanceof RealmRunnerError &&
      error.details &&
      typeof error.details === 'object' &&
      !Array.isArray(error.details)
        ? error.details
        : {}),
      effects: capability.effects.map((effect) => ({ ...effect })),
    };
    if (error instanceof RealmRunnerError) {
      error.details = details;
      throw error;
    }
    throw new RealmRunnerError(
      'RUNTIME_ERROR',
      error instanceof Error ? error.message : String(error),
      details,
    );
  } finally {
    clearTimeout(wallAbortTimer);
    wallAbortController?.abort();
    adapter.setProgramSignal?.(undefined);
    for (let deferred of pendingDeferreds) deferred.dispose();
    context.dispose();
  }
}

export { DEFAULT_RUNTIME_LIMITS };
