import WorkerURL from './worker?worker&url';

import type {
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
function resolveWorkerURL(workerURL: string): URL {
  let assetsURL = (
    globalThis as typeof globalThis & {
      __boxelAssetsURL?: string;
    }
  ).__boxelAssetsURL;
  let base = assetsURL
    ? new URL(assetsURL, window.location.href)
    : window.location.href;
  return new URL(workerURL, base);
}

function makeRealmWorker(absoluteURL: URL): Worker {
  if (absoluteURL.origin === window.location.origin) {
    return new Worker(absoluteURL, { type: 'module' });
  }

  // A worker's own script must be same-origin, so a cross-origin chunk cannot
  // be passed to the constructor. A same-origin Blob module may import it,
  // and the imported module keeps its real URL — which is what lets QuickJS
  // find `emscripten-module.wasm` next to itself.
  let blob = new Blob([`import ${JSON.stringify(absoluteURL.href)};`], {
    type: 'text/javascript',
  });
  let blobURL = URL.createObjectURL(blob);
  try {
    return new Worker(blobURL, { type: 'module' });
  } finally {
    URL.revokeObjectURL(blobURL);
  }
}

export default function runRealmCode(
  request: Omit<RealmRunnerRequest, 'type'>,
): Promise<RealmRunnerResult> {
  return new Promise((resolve, reject) => {
    let workerURL = resolveWorkerURL(WorkerURL);
    let worker = makeRealmWorker(workerURL);
    let timer: number;
    let settle = (finish: () => void) => {
      window.clearTimeout(timer);
      worker.terminate();
      finish();
    };

    timer = window.setTimeout(() => {
      settle(() =>
        reject(
          new Error(
            `Realm runner did not start within ${BOOT_TIMEOUT_MS}ms (${workerURL.href})`,
          ),
        ),
      );
    }, BOOT_TIMEOUT_MS);

    worker.onmessage = (event: MessageEvent<RealmRunnerResponse>) => {
      if (event.data.type === 'ready') {
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
        if (event.data.type === 'error') reject(new Error(event.data.error));
        else if (event.data.result) resolve(event.data.result);
        else reject(new Error('Realm runner returned no result'));
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

    worker.postMessage({ type: 'run', ...request });
  });
}
