import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { Worker } from 'node:worker_threads';
import {
  createHeartbeat,
  startEventLoopHeartbeat,
  writeBeat,
  type Heartbeat,
} from '../liveness/event-loop-heartbeat.ts';
import {
  livenessWedgeMs,
  startLivenessResponder,
  type LivenessResponder,
} from '../liveness/index.ts';

// Short thresholds throughout: the responder takes `wedgeMs` directly, so these
// exercise the same code paths a 30s production threshold does without the wait.
const WEDGE_MS = 300;

// Polls the responder from a thread of its own and reports every answer. Neither
// the polling clock nor the requests depend on the thread under test, so answers
// keep arriving while that thread is blocked — the only way to observe what the
// responder does then.
//
// Polling rather than one timed request: a single request has to be aimed at the
// blocked window, which couples the test to scheduling skew between two threads.
// A poll spanning the whole window lands in it regardless, and captures the
// before and after as well.
const POLL_INTERVAL_MS = 100;
const POLL_COUNT = 30;

const CLIENT_WORKER_SOURCE = `
const http = require('node:http');
const { parentPort, workerData } = require('node:worker_threads');
let samples = [];
let polls = 0;
function poll() {
  let req = http.get(
    { host: '127.0.0.1', port: workerData.port, path: '/_liveness' },
    (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => samples.push({ status: res.statusCode, body }));
    },
  );
  req.on('error', (err) => samples.push({ error: err.message }));
}
parentPort.on('message', () => {
  let timer = setInterval(() => {
    poll();
    if (++polls >= workerData.pollCount) {
      clearInterval(timer);
      // One interval's grace for the last response to land before reporting.
      setTimeout(() => parentPort.postMessage({ samples }), workerData.intervalMs);
    }
  }, workerData.intervalMs);
});
parentPort.postMessage({ ready: true });
`;

interface LivenessSample {
  status?: number;
  body?: string;
  error?: string;
}

// Returns the two promises separately rather than one resolving to the other:
// an async function adopts a promise it returns, so handing the report back that
// way would make the caller await every poll before it got to block — and the
// polls would then all land on an unblocked thread.
//
// `polling` resolves once the client thread is up and has started polling;
// `reported` resolves with every answer it collected.
function armPollingFromOwnThread(port: number): {
  polling: Promise<void>;
  reported: Promise<LivenessSample[]>;
} {
  let worker = new Worker(CLIENT_WORKER_SOURCE, {
    eval: true,
    workerData: {
      port,
      intervalMs: POLL_INTERVAL_MS,
      pollCount: POLL_COUNT,
    },
  });
  let reported = new Promise<LivenessSample[]>((resolve, reject) => {
    worker.on(
      'message',
      (message: { ready?: boolean; samples?: LivenessSample[] }) => {
        if (message?.samples) {
          void worker.terminate();
          resolve(message.samples);
        }
      },
    );
    worker.on('error', reject);
  });
  let polling = new Promise<void>((resolve, reject) => {
    worker.once('message', () => {
      worker.postMessage({ type: 'go' });
      resolve();
    });
    worker.once('error', reject);
  });
  return { polling, reported };
}

function blockMainThread(ms: number): void {
  let until = Date.now() + ms;
  while (Date.now() < until) {
    // Deliberately synchronous: nothing on this thread's event loop runs,
    // including the heartbeat that would otherwise report it as turning.
  }
}

module(basename(import.meta.filename), function (hooks) {
  let heartbeat: Heartbeat | undefined;
  let responder: LivenessResponder | undefined;

  hooks.afterEach(async function () {
    await responder?.stop();
    heartbeat?.stop();
    responder = undefined;
    heartbeat = undefined;
  });

  async function serveLiveness(existing: Heartbeat): Promise<number> {
    heartbeat = existing;
    responder = startLivenessResponder({
      buffer: existing.buffer,
      port: 0,
      wedgeMs: WEDGE_MS,
    });
    let port = await responder.listening;
    if (port == null) {
      throw new Error('liveness responder did not bind');
    }
    return port;
  }

  test('reports a fresh beat as alive and a stale one as wedged', async function (assert) {
    // No timer on this heartbeat, so the beat stays exactly where each case
    // puts it.
    let port = await serveLiveness(createHeartbeat());

    writeBeat(heartbeat!.buffer, Date.now() - 10_000);
    let wedged = await fetch(`http://127.0.0.1:${port}/_liveness`);
    assert.strictEqual(wedged.status, 503);
    let wedgedBody = await wedged.json();
    assert.false(wedgedBody.alive);
    assert.true(
      wedgedBody.heartbeatAgeMs >= 10_000,
      `reports the beat's true age, got ${wedgedBody.heartbeatAgeMs}`,
    );
    assert.strictEqual(wedgedBody.wedgeMs, WEDGE_MS);

    writeBeat(heartbeat!.buffer, Date.now());
    let alive = await fetch(`http://127.0.0.1:${port}/_liveness`);
    assert.strictEqual(alive.status, 200);
    assert.true((await alive.json()).alive);
  });

  test('answers, and reports the wedge, while the main thread is blocked', async function (assert) {
    // The property the whole design rests on. The heartbeat stops the moment the
    // block starts; the client keeps asking from its own thread; the responder
    // keeps answering from its own thread off the shared buffer. Nothing in that
    // path is the blocked thread.
    let port = await serveLiveness(startEventLoopHeartbeat());
    let { polling, reported } = armPollingFromOwnThread(port);
    await polling;

    blockMainThread(2_000);

    let samples = await reported;
    assert.deepEqual(
      samples.filter((s) => s.error).map((s) => s.error),
      [],
      'every poll got a response',
    );
    let verdicts = samples.map((s) => ({
      status: s.status,
      ...JSON.parse(s.body!),
    }));
    let wedged = verdicts.filter((v) => v.status === 503);
    assert.true(
      wedged.length > 0,
      `the stalled loop was reported wedged; ages seen: ${verdicts
        .map((v) => v.heartbeatAgeMs)
        .join(',')}`,
    );
    assert.true(
      wedged.every((v) => v.alive === false && v.heartbeatAgeMs > WEDGE_MS),
      'each wedged answer carries the measured stall',
    );
    assert.true(
      verdicts.some((v) => v.status === 200),
      'and a turning loop is reported alive',
    );
  });

  test('recovers to alive once the main thread resumes beating', async function (assert) {
    let port = await serveLiveness(startEventLoopHeartbeat());

    blockMainThread(WEDGE_MS * 3);
    // Back on the loop, the overdue heartbeat interval fires in the timers phase
    // — yield one macrotask so the assertion reads a resumed heartbeat rather
    // than racing it. A stall is not a latch.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    let recovered = await fetch(`http://127.0.0.1:${port}/_liveness`);
    assert.strictEqual(recovered.status, 200);
    assert.true((await recovered.json()).alive);
  });

  test('serves only the liveness path', async function (assert) {
    let port = await serveLiveness(startEventLoopHeartbeat());
    let other = await fetch(`http://127.0.0.1:${port}/`);
    assert.strictEqual(other.status, 404);
    let posted = await fetch(`http://127.0.0.1:${port}/_liveness`, {
      method: 'POST',
    });
    assert.strictEqual(posted.status, 404);
  });

  test('the wedge threshold has a floor a malformed override cannot cross', function (assert) {
    assert.strictEqual(livenessWedgeMs('45000'), 45_000);
    assert.strictEqual(livenessWedgeMs(undefined), 30_000);
    assert.strictEqual(livenessWedgeMs('not-a-number'), 30_000);
    assert.strictEqual(livenessWedgeMs('0'), 5_000);
    assert.strictEqual(livenessWedgeMs('-1'), 5_000);
  });
});
