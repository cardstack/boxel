import WorkerURL from './worker?worker&url';

import type {
  RealmRunnerCallHandler,
  RealmRunnerRequest,
  RealmRunnerResponse,
  RealmRunnerResult,
} from './types';

// Starting the sandbox means fetching the worker chunk and compiling the
// QuickJS WASM. That is sub-second once anything is cached, but a cold vite dev
// server discovers `quickjs-emscripten` on the first run and pre-bundles it,
// which takes far longer than any script is allowed. Give startup its own
// generous ceiling so a slow start is never charged to the submitted code.
const BOOT_TIMEOUT_MS = 60_000;

// The worker chunk is served from the host's assets origin, which is not the
// origin serving the page: realm-server serves the app HTML from the realm
// origin and points it at the host assets elsewhere. In a build, vite's
// `renderBuiltUrl` hook already prefixes this URL with the assets origin; in
// dev it stays root-relative, so resolving it against the document would ask
// the realm origin for a file only the asset origin has.
function assetsBaseURL(): URL {
  let assetsURL = (
    globalThis as typeof globalThis & {
      __boxelAssetsURL?: string;
    }
  ).__boxelAssetsURL;
  return new URL(assetsURL ?? '/', window.location.href);
}

function resolveWorkerURL(workerURL: string): URL {
  return new URL(workerURL, assetsBaseURL());
}

function makeRealmWorker(absoluteURL: URL): Worker {
  if (absoluteURL.origin === window.location.origin) {
    return new Worker(absoluteURL, { type: 'module' });
  }

  // A worker's own script must be same-origin, so a cross-origin chunk cannot
  // be passed to the constructor. A same-origin Blob module may import it.
  // In a build, vite's `renderBuiltUrl` hook writes the chunk's asset URLs
  // (QuickJS's `emscripten-module.wasm` among them) as
  // `new URL(globalThis.__boxelAssetsURL + file, self.location.href)`. The
  // page sets that global, but a worker has its own globals, and its
  // `self.location` is the `blob:` URL, which cannot be a base for a
  // root-relative path. So the Blob sets the global to the absolute assets
  // origin first, then imports the chunk. The import is dynamic because a
  // static one would run before the assignment.
  //
  // With a dynamic import the worker accepts messages as soon as the Blob
  // module has run, before the chunk installs its `message` handler, so the
  // `run` request posted right after construction would be dropped. The Blob
  // holds messages until the chunk has loaded and then dispatches them again.
  // A failed dynamic import does not fire the worker's `error` event, so it
  // reports as the worker does.
  let blob = new Blob(
    [
      `globalThis.__boxelAssetsURL = ${JSON.stringify(assetsBaseURL().href)};\n`,
      `const held = [];\n`,
      `const hold = (event) => held.push(event.data);\n`,
      `self.addEventListener('message', hold);\n`,
      `import(${JSON.stringify(absoluteURL.href)}).then(\n`,
      `  () => {\n`,
      `    self.removeEventListener('message', hold);\n`,
      `    for (const data of held) self.dispatchEvent(new MessageEvent('message', { data }));\n`,
      `  },\n`,
      `  (e) => self.postMessage({ type: 'error', error: 'Realm runner failed to load: ' + (e && e.message || e) }),\n`,
      `);\n`,
    ],
    { type: 'text/javascript' },
  );
  let blobURL = URL.createObjectURL(blob);
  try {
    return new Worker(blobURL, { type: 'module' });
  } finally {
    URL.revokeObjectURL(blobURL);
  }
}

// `onCall` does the work of each `realm.*` call the script makes. Its answer,
// or the message of what it throws, goes back into the sandbox.
// `signal` ends the run from outside: the worker stops and the promise
// rejects with the signal's reason, so a caller with its own deadline is never
// outlived by the run.
export default function runRealmCode(
  request: Omit<Extract<RealmRunnerRequest, { type: 'run' }>, 'type'>,
  onCall: RealmRunnerCallHandler,
  signal?: AbortSignal,
): Promise<RealmRunnerResult> {
  return new Promise((resolve, reject) => {
    let workerURL = resolveWorkerURL(WorkerURL);
    let worker = makeRealmWorker(workerURL);
    let timer: number;
    let settled = false;
    let onAbort = () =>
      settle(() =>
        reject(
          signal?.reason instanceof Error
            ? signal.reason
            : new Error('Realm code was stopped'),
        ),
      );
    let settle = (finish: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      worker.terminate();
      finish();
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort);

    timer = window.setTimeout(() => {
      settle(() =>
        reject(
          new Error(
            `Realm runner did not start within ${BOOT_TIMEOUT_MS}ms (${workerURL.href})`,
          ),
        ),
      );
    }, BOOT_TIMEOUT_MS);

    let answer = (message: RealmRunnerRequest) => worker.postMessage(message);

    worker.onmessage = (event: MessageEvent<RealmRunnerResponse>) => {
      let message = event.data;
      if (message.type === 'call') {
        let { id, method, args } = message;
        onCall(method, args).then(
          (value) =>
            answer({
              type: 'callResult',
              id,
              value: JSON.stringify(value ?? null),
            }),
          (error: unknown) =>
            answer({
              type: 'callResult',
              id,
              error: error instanceof Error ? error.message : String(error),
            }),
        );
        return;
      }
      if (message.type === 'ready') {
        // The sandbox is up, so the script's own allowance starts here. The
        // extra second covers the message round trip; QuickJS enforces
        // `timeoutMs` on the script itself and reports a clearer error, so
        // this timer should only fire if the worker stops answering.
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          settle(() =>
            reject(
              new Error(
                `Realm code exceeded the ${request.timeoutMs}ms time limit`,
              ),
            ),
          );
        }, request.timeoutMs + 1000);
        return;
      }
      settle(() => {
        if (message.type === 'error') reject(new Error(message.error));
        else resolve(message.result);
      });
    };

    worker.onerror = (event) => {
      // A worker that fails to load reports an ErrorEvent the browser has
      // stripped of message, filename and line — naming the URL we asked for
      // is then the only clue to why.
      settle(() =>
        reject(
          new Error(
            event.message ||
              `Realm runner worker failed to load from ${workerURL.href}`,
          ),
        ),
      );
    };

    answer({ type: 'run', ...request });
  });
}
