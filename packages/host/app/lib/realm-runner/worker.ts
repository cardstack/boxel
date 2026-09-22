import { getQuickJS, shouldInterruptAfterDeadline } from 'quickjs-emscripten';

import type {
  RealmRunnerRequest,
  RealmRunnerResponse,
  RealmRunnerOperation,
} from './types';

const worker = globalThis as unknown as {
  onmessage: ((event: MessageEvent<RealmRunnerRequest>) => void) | null;
  postMessage(message: RealmRunnerResponse): void;
};

worker.onmessage = async (event: MessageEvent<RealmRunnerRequest>) => {
  let request = event.data;
  if (request.type !== 'run') {
    return;
  }

  try {
    let QuickJS = await getQuickJS();
    let runtime = QuickJS.newRuntime();
    runtime.setMemoryLimit(8 * 1024 * 1024);
    runtime.setMaxStackSize(512 * 1024);
    runtime.setInterruptHandler(
      shouldInterruptAfterDeadline(Date.now() + request.timeoutMs),
    );
    let vm = runtime.newContext();
    let files = Object.fromEntries(
      request.files.map((file) => [file.url, file.content]),
    );
    let operations: RealmRunnerOperation[] = [];

    let filesJSON = JSON.stringify(files);
    let operationsJSON = JSON.stringify(operations);
    let bootstrap = `
      (() => {
        const files = ${JSON.stringify(filesJSON)};
        const operations = ${JSON.stringify(operationsJSON)};
        const contents = JSON.parse(files);
        const changes = JSON.parse(operations);
        const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
        const replaceCode = (url, search, replacement) => {
          if (typeof url !== 'string' || typeof search !== 'string' || typeof replacement !== 'string') {
            throw new TypeError('Realm.replaceCode expects three strings');
          }
          if (!hasOwn(contents, url)) throw new Error('File was not supplied to this run: ' + url);
          if (search.length === 0) throw new Error('Realm.replaceCode requires a non-empty search string');
          const first = contents[url].indexOf(search);
          if (first < 0) throw new Error('Search string was not found in ' + url);
          if (contents[url].indexOf(search, first + search.length) >= 0) throw new Error('Search string matched more than once in ' + url);
          contents[url] = contents[url].slice(0, first) + replacement + contents[url].slice(first + search.length);
          changes.push({ type: 'replace', url, search, replacement });
          return { status: 'staged', url };
        };
        const createFile = (url, content) => {
          if (typeof url !== 'string' || typeof content !== 'string') throw new TypeError('Realm.createFile expects two strings');
          if (hasOwn(contents, url)) throw new Error('File already exists: ' + url);
          contents[url] = content;
          changes.push({ type: 'create', url, content });
          return { status: 'staged', url };
        };
        globalThis.Realm = Object.freeze({ replaceCode, createFile });
        globalThis.__realmFiles = contents;
        globalThis.__realmOperations = changes;
      })();
    `;
    let bootstrapResult = vm.evalCode(bootstrap);
    vm.unwrapResult(bootstrapResult).dispose();
    let code = `(async () => {\n${request.code}\n})()`;
    let result = vm.evalCode(code);
    let promise = vm.unwrapResult(result);
    // `resolvePromise` bridges the guest promise to a native promise, but
    // QuickJS still needs its microtask queue drained. Without this loop an
    // async guest function can remain pending forever even when it only awaits
    // an already-resolved promise.
    let resolvedPromise = vm.resolvePromise(promise);
    while (runtime.hasPendingJob()) {
      vm.unwrapResult(runtime.executePendingJobs()).dispose();
    }
    let resolved = await resolvedPromise;
    promise.dispose();
    let value = vm.unwrapResult(resolved);
    let scriptResult = JSON.stringify(vm.dump(value)) ?? '';
    value.dispose();
    let filesHandle = vm.getProp(vm.global, '__realmFiles');
    let operationsHandle = vm.getProp(vm.global, '__realmOperations');
    let output: RealmRunnerResponse = {
      type: 'success',
      result: {
        files: vm.dump(filesHandle) as Record<string, string>,
        operations: vm.dump(operationsHandle) as RealmRunnerOperation[],
        scriptResult,
      },
    };
    filesHandle.dispose();
    operationsHandle.dispose();
    vm.dispose();
    runtime.dispose();
    worker.postMessage(output);
  } catch (error) {
    let output: RealmRunnerResponse = {
      type: 'error',
      error: error instanceof Error ? error.message : String(error),
    };
    worker.postMessage(output);
  }
};
