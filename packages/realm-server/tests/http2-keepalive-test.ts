import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { EventEmitter } from 'events';
import type http2 from 'http2';
import { logger } from '@cardstack/runtime-common';

import { startSessionKeepalive } from '../server.ts';

// Unit coverage for the HTTP/2 PING keepalive that tears down wedged sessions
// so a hung browser fetch rejects (and retries) instead of hanging until a
// host-test timeout. Driven against a fake session whose ping behaviour we
// control and with short timers so the whole cycle runs in milliseconds.

type PingCallback = (
  err: Error | null,
  duration: number,
  payload?: Buffer,
) => void;

// Minimal stand-in for the Http2Session.socket proxy: the teardown only reads
// these fields for its diagnostics (the real proxy forbids mutators).
class FakeSocket {
  destroyed = false;
  writable = true;
  writableLength = 0;
  bytesRead = 0;
  bytesWritten = 0;
}

// Minimal stand-in for an Http2Session: only the surface startSessionKeepalive
// touches (ping/close/destroy + socket + the close/error events +
// closed/destroyed).
class FakeSession extends EventEmitter {
  closed = false;
  destroyed = false;
  closeCount = 0;
  destroyCount = 0;
  pingCount = 0;
  socket = new FakeSocket();
  // When true, destroy() releases the peer cleanly by emitting 'close' on the
  // next tick — the success path the confirm window should observe.
  emitCloseOnDestroy = false;
  // Default: a healthy peer that pongs immediately.
  pingImpl: (cb: PingCallback) => boolean = (cb) => {
    setTimeout(() => cb(null, 1), 0);
    return true;
  };

  // When each ping was sent, in ms since the fake was made. A timing assertion
  // that fails prints these, so a late timer shows in the failure.
  createdAt = Date.now();
  pingTimes: number[] = [];
  private pingWaiters: { count: number; resolve: () => void }[] = [];

  ping(cb: PingCallback): boolean {
    this.pingCount++;
    this.pingTimes.push(Date.now() - this.createdAt);
    let result = this.pingImpl(cb);
    this.pingWaiters = this.pingWaiters.filter((waiter) => {
      if (this.pingCount >= waiter.count) {
        waiter.resolve();
        return false;
      }
      return true;
    });
    return result;
  }

  // Resolves once `count` pings have been sent, or after `timeoutMs` so a
  // keepalive that stops pinging fails the test instead of hanging it.
  waitForPings(count: number, timeoutMs = 2000): Promise<void> {
    if (this.pingCount >= count) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let timer = setTimeout(resolve, timeoutMs);
      this.pingWaiters.push({
        count,
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
      });
    });
  }

  timeline() {
    return `pings sent at [${this.pingTimes.join(', ')}]ms, now ${
      Date.now() - this.createdAt
    }ms`;
  }

  close() {
    this.closeCount++;
    this.closed = true;
  }

  destroy() {
    this.destroyCount++;
    this.destroyed = true;
    if (this.emitCloseOnDestroy) {
      setTimeout(() => this.emit('close'), 0);
    }
  }
}

function asSession(fake: FakeSession): http2.Http2Session {
  return fake as unknown as http2.Http2Session;
}

const log = logger('test:h2-keepalive');

// A logger that records its warnings so a test can assert which teardown
// branch fired. startSessionKeepalive only emits via warn().
function recordingLog(): {
  log: ReturnType<typeof logger>;
  warnings: string[];
} {
  let warnings: string[] = [];
  let noop = () => {};
  let log = {
    warn: (...args: unknown[]) => warnings.push(args.join(' ')),
    info: noop,
    error: noop,
    debug: noop,
    trace: noop,
    setLevel: noop,
  } as unknown as ReturnType<typeof logger>;
  return { log, warnings };
}

// Fast tuning so a 2-miss teardown completes well under the QUnit timeout.
const FAST = {
  intervalMs: 20,
  pongTimeoutMs: 15,
  maxMissedPings: 2,
  graceMsBeforeDestroy: 10,
  postDestroyConfirmMs: 20,
};

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module(basename(import.meta.filename), function () {
  test('a responsive session is pinged and never torn down', async function (assert) {
    let fake = new FakeSession();
    let stopKeepalive = startSessionKeepalive(asSession(fake), log, FAST);
    try {
      await wait(120);
      assert.ok(
        fake.pingCount >= 2,
        `session was pinged repeatedly (${fake.pingCount})`,
      );
      assert.strictEqual(
        fake.closeCount,
        0,
        'responsive session is not closed',
      );
      assert.strictEqual(
        fake.destroyCount,
        0,
        'responsive session is not destroyed',
      );
    } finally {
      stopKeepalive();
    }
  });

  test('a session that never pongs is closed then force-destroyed', async function (assert) {
    let fake = new FakeSession();
    // PING frame is sent but no PONG ever arrives — the wedge signature.
    fake.pingImpl = () => true;
    let stopKeepalive = startSessionKeepalive(asSession(fake), log, FAST);
    try {
      await wait(200);
      assert.strictEqual(fake.closeCount, 1, 'wedged session is closed once');
      assert.ok(
        fake.destroyCount >= 1,
        'wedged session is force-destroyed after the grace period',
      );
    } finally {
      stopKeepalive();
    }
  });

  // The unreachable warning ("STILL not closed …") and the success line
  // ("closed Nms after force-destroy") both end in "after force-destroy", so
  // match the success path by that suffix while excluding the unreachable one.
  let isUnreachable = (w: string) => w.includes('STILL not closed');
  let isCloseSuccess = (w: string) =>
    w.includes('after force-destroy') && !isUnreachable(w);

  test('a wedged session that never emits close is reported as unreachable', async function (assert) {
    let fake = new FakeSession();
    // Never pong, and never emit 'close' from destroy() — the transport-wedge
    // signature where session.destroy() leaves a zombie.
    fake.pingImpl = () => true;
    let { log: recLog, warnings } = recordingLog();
    let stopKeepalive = startSessionKeepalive(asSession(fake), recLog, FAST);
    try {
      await wait(200);
      assert.ok(fake.destroyCount >= 1, 'wedged session is force-destroyed');
      assert.ok(
        warnings.some(isUnreachable),
        'logs that the teardown did not reach the peer',
      );
      assert.notOk(
        warnings.some(isCloseSuccess),
        'does not log the success path',
      );
    } finally {
      stopKeepalive();
    }
  });

  test('a session that closes after force-destroy logs the success path', async function (assert) {
    let fake = new FakeSession();
    fake.pingImpl = () => true; // wedge → triggers teardown
    fake.emitCloseOnDestroy = true; // but destroy() releases the peer
    let { log: recLog, warnings } = recordingLog();
    let stopKeepalive = startSessionKeepalive(asSession(fake), recLog, FAST);
    try {
      await wait(200);
      assert.ok(
        warnings.some(isCloseSuccess),
        'logs that the session closed after force-destroy',
      );
      assert.notOk(
        warnings.some(isUnreachable),
        'does not log the transport-wedge-unreachable warning',
      );
    } finally {
      stopKeepalive();
    }
  });

  test('a session that cannot queue a PING frame is torn down', async function (assert) {
    let fake = new FakeSession();
    // ping() returning false means the outbound path is backed up.
    fake.pingImpl = () => false;
    let stopKeepalive = startSessionKeepalive(asSession(fake), log, FAST);
    try {
      await wait(120);
      assert.strictEqual(
        fake.closeCount,
        1,
        'session with unqueueable pings is closed',
      );
    } finally {
      stopKeepalive();
    }
  });

  test('one missed pong does not tear down a session that then recovers', async function (assert) {
    let fake = new FakeSession();
    let pings = 0;
    // First ping never pongs (one miss); subsequent pings pong normally.
    fake.pingImpl = (cb) => {
      pings++;
      if (pings > 1) {
        setTimeout(() => cb(null, 1), 0);
      }
      return true;
    };
    let stopKeepalive = startSessionKeepalive(asSession(fake), log, FAST);
    try {
      await wait(160);
      assert.strictEqual(
        fake.closeCount,
        0,
        'a single transient miss does not close the session',
      );
    } finally {
      stopKeepalive();
    }
  });

  test('a successful pong resets the miss counter', async function (assert) {
    let fake = new FakeSession();
    let pings = 0;
    // Alternate miss / pong forever: consecutive misses never accumulate to
    // the teardown threshold even though total misses do.
    fake.pingImpl = (cb) => {
      pings++;
      if (pings % 2 === 0) {
        setTimeout(() => cb(null, 1), 0);
      }
      return true;
    };
    let stopKeepalive = startSessionKeepalive(asSession(fake), log, FAST);
    try {
      await wait(300);
      assert.ok(pings >= 4, `alternating pattern exercised (${pings} pings)`);
      assert.strictEqual(
        fake.closeCount,
        0,
        'non-consecutive misses never trigger teardown',
      );
    } finally {
      stopKeepalive();
    }
  });

  test('stop() halts pinging', async function (assert) {
    let fake = new FakeSession();
    let stopKeepalive = startSessionKeepalive(asSession(fake), log, FAST);
    await wait(50);
    let countAtStop = fake.pingCount;
    stopKeepalive();
    await wait(80);
    assert.strictEqual(
      fake.pingCount,
      countAtStop,
      'no further pings are sent after stop()',
    );
  });

  test('a ping in flight when the session closes does not trigger teardown', async function (assert) {
    let fake = new FakeSession();
    // Never pong, so the first ping scores a miss and the second is one
    // pong-timeout away from the 2-miss teardown threshold when the session
    // closes out from under it.
    fake.pingImpl = () => true;
    let stopKeepalive = startSessionKeepalive(asSession(fake), log, FAST);
    try {
      // FAST timeline: ping1 @20ms, miss1 @35ms, ping2 @55ms, and ping2's
      // pong timeout would fire @70ms. Wait for ping2 to be sent rather than
      // a fixed time: each of those timers can fire late on a loaded runner,
      // so no fixed wait reliably lands between ping2 and its pong timeout.
      await fake.waitForPings(2);
      assert.strictEqual(
        fake.pingCount,
        2,
        `second ping is in flight (${fake.timeline()})`,
      );
      // Close while ping2 is in flight, then wait past its pong timeout. The
      // pong timer was set before this wait's timer with a shorter delay, so
      // it fires first however late both are.
      fake.emit('close');
      await wait(FAST.pongTimeoutMs * 4);
      assert.strictEqual(
        fake.closeCount,
        0,
        `late pong timeout after session close does not tear down (${fake.timeline()})`,
      );
      assert.strictEqual(
        fake.destroyCount,
        0,
        `no force-destroy after session close (${fake.timeline()})`,
      );
    } finally {
      stopKeepalive();
    }
  });

  test('a session close event halts pinging without tearing down', async function (assert) {
    let fake = new FakeSession();
    fake.pingImpl = () => true; // would otherwise wedge and get closed
    let stopKeepalive = startSessionKeepalive(asSession(fake), log, FAST);
    try {
      fake.emit('close');
      await wait(120);
      assert.strictEqual(
        fake.closeCount,
        0,
        'keepalive does not re-close an already-closed session',
      );
    } finally {
      stopKeepalive();
    }
  });
});
