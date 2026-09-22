import WorkerURL from './worker?worker&url';

import type {
  RealmRunnerRequest,
  RealmRunnerResponse,
  RealmRunnerResult,
} from './types';

export default function runRealmCode(
  request: Omit<RealmRunnerRequest, 'type'>,
): Promise<RealmRunnerResult> {
  return new Promise((resolve, reject) => {
    let worker = new Worker(new URL(WorkerURL, window.location.href), {
      type: 'module',
    });
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
