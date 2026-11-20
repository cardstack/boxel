import * as QUnit from 'qunit';

// A lifeline from the test page to testem's server that does not ride the
// browser↔testem control socket. When that socket drops mid-run, testem
// reports `Browser timeout exceeded` against whichever test was running and
// nothing else: a renderer crash, a page navigation and a hung main thread
// all look the same from the TAP output. These reports tell them apart in the
// CI debug log (host-testem-debug-<shard>.log):
//
// - A dedicated worker heartbeats every couple of seconds with the running
//   test, the JS heap, and how long ago the main thread last checked in. The
//   worker lives in the page's renderer process but not on its main thread,
//   so heartbeats that continue with a growing `mainThreadAgeMs` mean a hung
//   main thread, and heartbeats that stop with no `navigate` / `pagehide`
//   report mean the renderer died.
// - A cross-document navigation reports its destination and the stack that
//   started it, and `pagehide` reports the page going away for any reason.
//
// testem.js serves the endpoint only in CI, and the page probes for it
// before starting, so a local run sends nothing.
const ENDPOINT = '/__host-test-lifeline';
const HEARTBEAT_MS = 2000;
const MAIN_THREAD_TICK_MS = 1000;

// The worker gets the endpoint as an absolute URL: it runs from a blob: URL,
// which a root-relative path cannot resolve against.
const workerSource = (endpoint: string) => `
let latest = {};
let seq = 0;
self.onmessage = (event) => {
  latest = event.data;
};
setInterval(() => {
  seq++;
  let report = {
    kind: 'heartbeat',
    seq,
    test: latest.test ?? null,
    heapMB: latest.heapMB ?? null,
    mainThreadAgeMs:
      typeof latest.at === 'number'
        ? Math.round(performance.timeOrigin + performance.now() - latest.at)
        : null,
  };
  fetch(${JSON.stringify(endpoint)}, {
    method: 'POST',
    body: JSON.stringify(report),
    keepalive: true,
  }).catch(() => {});
}, ${HEARTBEAT_MS});
`;

let currentTest: string | null = null;

function heapMB(): number | null {
  let memory = (performance as { memory?: { usedJSHeapSize: number } }).memory;
  return memory ? Math.round(memory.usedJSHeapSize / 1048576) : null;
}

function beacon(report: Record<string, unknown>) {
  try {
    navigator.sendBeacon(
      ENDPOINT,
      JSON.stringify({ ...report, test: currentTest, heapMB: heapMB() }),
    );
  } catch {
    // best-effort diagnostics — never let reporting break the run
  }
}

async function endpointAvailable(): Promise<boolean> {
  try {
    let response = await fetch(ENDPOINT, { method: 'GET' });
    return response.status === 204;
  } catch {
    return false;
  }
}

export async function startLifeline(): Promise<void> {
  if (!(await endpointAvailable())) {
    return;
  }

  QUnit.testStart(({ module, name }) => {
    currentTest = `${module}: ${name}`;
  });

  let worker: Worker;
  try {
    worker = new Worker(
      URL.createObjectURL(
        new Blob([workerSource(new URL(ENDPOINT, window.location.href).href)], {
          type: 'text/javascript',
        }),
      ),
    );
  } catch {
    return;
  }
  // Captured now: a test may install fake timers (which can replace
  // `setInterval`, `Date.now` and `performance.now`), and the main thread's
  // check-ins must keep running and stamping on the real clock. The stamp is
  // wall-clock milliseconds from the page's time origin, which the worker
  // reads the same way from its own.
  let realSetInterval = window.setInterval.bind(window);
  let realPerformanceNow = performance.now.bind(performance);
  let timeOrigin = performance.timeOrigin;
  realSetInterval(() => {
    worker.postMessage({
      test: currentTest,
      heapMB: heapMB(),
      at: timeOrigin + realPerformanceNow(),
    });
  }, MAIN_THREAD_TICK_MS);

  let navigation = (
    globalThis as {
      navigation?: {
        addEventListener(
          type: 'navigate',
          listener: (event: {
            destination: { url: string; sameDocument: boolean };
            navigationType: string;
          }) => void,
        ): void;
      };
    }
  ).navigation;
  navigation?.addEventListener('navigate', (event) => {
    // A same-document navigation (pushState, hash) leaves the page and its
    // control socket in place.
    if (event.destination.sameDocument) {
      return;
    }
    beacon({
      kind: 'navigate',
      destination: event.destination.url,
      navigationType: event.navigationType,
      stack: new Error('navigate').stack,
    });
  });

  window.addEventListener('pagehide', (event) => {
    beacon({ kind: 'pagehide', persisted: event.persisted });
  });

  beacon({ kind: 'start', page: window.location.href });
}
