import http from 'node:http';
import { parentPort, workerData } from 'node:worker_threads';
import { createBeatReader } from './event-loop-heartbeat.ts';
import { judgeLiveness } from './liveness-verdict.ts';

// Serves the main thread's liveness verdict from a thread of its own, so the
// answer is available in the one situation an answer is worth having: the main
// thread has no capacity to give one.
//
// Everything on the request path reads the shared heartbeat buffer and nothing
// else. In particular this worker must not, while serving:
//
//   - `postMessage` the parent and await a reply — a wedged parent never replies;
//   - write to `console` / `process.stdout` / `process.stderr` — worker stdio is
//     piped through the parent, so those bytes queue behind the wedge.
//
// Logging is therefore confined to bind and error events, which happen at
// startup while the parent is healthy, and travels over `parentPort` for the
// parent to log through its own logger.

export interface LivenessResponderWorkerData {
  buffer: SharedArrayBuffer;
  port: number;
  host: string;
  wedgeMs: number;
}

const LIVENESS_PATH = '/_liveness';

let { buffer, port, host, wedgeMs } = workerData as LivenessResponderWorkerData;
let readBeat = createBeatReader(buffer);

let server = http.createServer((req, res) => {
  // `req.url` is a path, never absolute-form, for the requests this endpoint
  // serves; compare on the path prefix so a query string doesn't miss.
  let path = (req.url ?? '').split('?')[0];
  if (
    path !== LIVENESS_PATH ||
    (req.method !== 'GET' && req.method !== 'HEAD')
  ) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
    return;
  }
  let verdict = judgeLiveness({
    nowMs: Date.now(),
    beatMs: readBeat(),
    wedgeMs,
  });
  let body = JSON.stringify(verdict);
  res.writeHead(verdict.alive ? 200 : 503, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  res.end(body);
});

server.on('error', (err: Error) => {
  parentPort?.postMessage({ type: 'error', message: err.message });
});

// Loopback only. The endpoint is unauthenticated and exists for a check running
// inside this container; binding it to the task's routable address would put it
// on the network for no gain.
server.listen(port, host, () => {
  // Report the address actually bound, not the one requested: a caller may pass
  // 0 for an ephemeral port and needs to learn which one it got.
  let bound = server.address();
  parentPort?.postMessage({
    type: 'listening',
    port: typeof bound === 'object' && bound ? bound.port : port,
    wedgeMs,
  });
});
