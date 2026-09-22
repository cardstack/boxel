import WorkerURL from './worker?worker&url';

import type {
  RealmRunnerRequest,
  RealmRunnerResponse,
  RealmRunnerResult,
} from './types';

function makeRealmWorker(workerURL: string): Worker {
  let absoluteURL = new URL(workerURL, window.location.href);
  if (absoluteURL.origin === window.location.origin) {
    return new Worker(absoluteURL, { type: 'module' });
  }

  // The host bundle can be served from a different origin than the realm page.
  // Browser workers cannot be constructed from that URL directly, but a
  // same-origin Blob worker may import it. Give the worker the host assets URL
  // too, so QuickJS resolves its WASM asset from the same origin.
  let assetsURL = (
    globalThis as typeof globalThis & {
      __boxelAssetsURL?: string;
    }
  ).__boxelAssetsURL;
  let blob = new Blob(
    [
      `globalThis.__boxelAssetsURL = ${JSON.stringify(assetsURL ?? new URL('../', absoluteURL).href)};`,
      `importScripts(${JSON.stringify(absoluteURL.href)});`,
    ],
    { type: 'text/javascript' },
  );
  let blobURL = URL.createObjectURL(blob);
  try {
    return new Worker(blobURL);
  } finally {
    URL.revokeObjectURL(blobURL);
  }
}

export default function runRealmCode(
  request: Omit<RealmRunnerRequest, 'type'>,
): Promise<RealmRunnerResult> {
  return new Promise((resolve, reject) => {
    let worker = makeRealmWorker(WorkerURL);
    let timer = window.setTimeout(() => {
      worker.terminate();
      reject(
        new Error(`Realm code exceeded the ${request.timeoutMs}ms time limit`),
      );
    }, request.timeoutMs + 1000);
    worker.onmessage = (event: MessageEvent<RealmRunnerResponse>) => {
      window.clearTimeout(timer);
      worker.terminate();
      if (event.data.type === 'error') reject(new Error(event.data.error));
      else if (event.data.result) resolve(event.data.result);
      else reject(new Error('Realm runner returned no result'));
    };
    worker.onerror = (event) => {
      window.clearTimeout(timer);
      worker.terminate();
      reject(new Error(event.message || 'Realm runner worker failed'));
    };
    worker.postMessage({ type: 'run', ...request });
  });
}
