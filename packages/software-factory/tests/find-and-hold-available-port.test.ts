import { createServer } from 'node:net';
import { module, test } from 'qunit';

import { findAndHoldAvailablePort } from '@cardstack/realm-test-harness';

async function bindOn(port: number): Promise<{
  ok: boolean;
  code?: string;
  close: () => Promise<void>;
}> {
  return await new Promise((resolve) => {
    let s = createServer();
    s.once('error', (err: NodeJS.ErrnoException) =>
      resolve({
        ok: false,
        code: err.code,
        close: async () => {},
      }),
    );
    s.listen(port, () => {
      resolve({
        ok: true,
        close: () =>
          new Promise<void>((resolveClose) => s.close(() => resolveClose())),
      });
    });
  });
}

module('findAndHoldAvailablePort', function () {
  test('returns a port that is currently bound by the holder', async function (assert) {
    let reservation = await findAndHoldAvailablePort();
    try {
      // The port should be held — a fresh dual-stack bind on it must fail.
      let attempt = await bindOn(reservation.port);
      assert.false(
        attempt.ok,
        `port ${reservation.port} bind attempt should fail while held`,
      );
      assert.strictEqual(
        attempt.code,
        'EADDRINUSE',
        'rejected bind reports EADDRINUSE',
      );
    } finally {
      await reservation.release();
    }
  });

  test('release frees the port for subsequent binders', async function (assert) {
    let reservation = await findAndHoldAvailablePort();
    let port = reservation.port;
    await reservation.release();
    let attempt = await bindOn(port);
    assert.true(attempt.ok, `port ${port} should be free after release`);
    await attempt.close();
  });

  test('release is idempotent', async function (assert) {
    let reservation = await findAndHoldAvailablePort();
    await reservation.release();
    // Second release must not throw.
    await reservation.release();
    assert.true(true, 'release called twice without throwing');
  });

  test('many concurrent reservations all return distinct ports and hold each', async function (assert) {
    // This is the scenario the cache:prepare path was failing on: many
    // concurrent allocations had to coexist without colliding mid-flight.
    let reservations = await Promise.all(
      Array.from({ length: 16 }, () => findAndHoldAvailablePort()),
    );
    try {
      let ports = reservations.map((r) => r.port);
      assert.strictEqual(
        new Set(ports).size,
        ports.length,
        'every concurrently-held reservation has a distinct port',
      );
      // Each one is currently held — bind attempts must all fail.
      for (let port of ports) {
        let attempt = await bindOn(port);
        assert.false(attempt.ok, `port ${port} held — bind rejected`);
      }
    } finally {
      await Promise.allSettled(reservations.map((r) => r.release()));
    }
  });

  test('held port immediately rejects HTTP clients instead of hanging', async function (assert) {
    // Regression test for codex-flagged P1: the indexing-progress poller
    // does `fetch(http://localhost:<port>/_indexing-status)` against the
    // worker-manager port. If the holder were a passive net.Server, fetch
    // would connect, send headers, and hang forever waiting for a
    // response. The holder must destroy the socket on connect so fetch
    // fails fast and the poller retries on its next interval.
    let reservation = await findAndHoldAvailablePort();
    try {
      let abort = new AbortController();
      let timer = setTimeout(() => abort.abort(), 2000);
      let result = await fetch(`http://localhost:${reservation.port}/`, {
        signal: abort.signal,
      })
        .then(() => ({ ok: true }) as const)
        .catch((err: Error) => ({ ok: false, name: err.name }) as const);
      clearTimeout(timer);
      assert.false(
        result.ok,
        'fetch against held port must fail rather than hang',
      );
      if (!result.ok) {
        assert.notStrictEqual(
          result.name,
          'AbortError',
          `fetch errored quickly (got ${result.name}); a hung connection would have been aborted`,
        );
      }
    } finally {
      await reservation.release();
    }
  });

  test('successive findAndHoldAvailablePort + release cycles never produce a duplicate-while-held port', async function (assert) {
    // The exact race that caused the cache:prepare EADDRINUSE: caller A
    // takes a port and holds it, caller B takes a *different* port (must
    // not get A's port back even though A's socket is still listening).
    let outer = await findAndHoldAvailablePort();
    try {
      for (let i = 0; i < 20; i++) {
        let inner = await findAndHoldAvailablePort();
        assert.notStrictEqual(
          inner.port,
          outer.port,
          `iteration ${i}: inner port ${inner.port} differs from held outer port ${outer.port}`,
        );
        await inner.release();
      }
    } finally {
      await outer.release();
    }
  });
});
