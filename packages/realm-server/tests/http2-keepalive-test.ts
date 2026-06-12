import { module, test } from 'qunit';
import { basename } from 'path';
import { EventEmitter } from 'events';
import type http2 from 'http2';
import { logger } from '@cardstack/runtime-common';

import { startSessionKeepalive } from '../server';

// Unit coverage for the HTTP/2 PING keepalive that tears down wedged sessions
// so a hung browser fetch rejects (and retries) instead of hanging until a
// host-test timeout. Driven against a fake session whose ping behaviour we
// control and with short timers so the whole cycle runs in milliseconds.

type PingCallback = (
  err: Error | null,
  duration: number,
  payload?: Buffer,
) => void;

// Minimal stand-in for an Http2Session: only the surface startSessionKeepalive
// touches (ping/close/destroy + the close/error events + closed/destroyed).
class FakeSession extends EventEmitter {
  closed = false;
  destroyed = false;
  closeCount = 0;
  destroyCount = 0;
  pingCount = 0;
  // Default: a healthy peer that pongs immediately.
  pingImpl: (cb: PingCallback) => boolean = (cb) => {
    setTimeout(() => cb(null, 1), 0);
    return true;
  };

  ping(cb: PingCallback): boolean {
    this.pingCount++;
    return this.pingImpl(cb);
  }

  close() {
    this.closeCount++;
    this.closed = true;
  }

  destroy() {
    this.destroyCount++;
    this.destroyed = true;
  }
}

function asSession(fake: FakeSession): http2.Http2Session {
  return fake as unknown as http2.Http2Session;
}

const log = logger('test:h2-keepalive');

// Fast tuning so a 2-miss teardown completes well under the QUnit timeout.
const FAST = {
  intervalMs: 20,
  pongTimeoutMs: 15,
  maxMissedPings: 2,
  graceMsBeforeDestroy: 10,
};

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module(basename(__filename), function () {
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
