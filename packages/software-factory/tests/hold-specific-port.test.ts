import { createServer } from 'node:net';
import QUnit from 'qunit';
const { module, test } = QUnit;

import {
  findAndHoldAvailablePort,
  holdSpecificPort,
} from '@cardstack/realm-test-harness';

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

module('holdSpecificPort', function () {
  test('holds exactly the requested port', async function (assert) {
    // Pick a known-free port via the OS, release it, then re-acquire that
    // exact number — the scenario where a public port chosen earlier needs
    // to be re-held across a runtime restart.
    let probe = await findAndHoldAvailablePort();
    let port = probe.port;
    await probe.release();

    let reservation = await holdSpecificPort(port);
    try {
      assert.strictEqual(reservation.port, port, 'holds the requested port');
      let attempt = await bindOn(port);
      assert.false(attempt.ok, `port ${port} bind attempt fails while held`);
      assert.strictEqual(attempt.code, 'EADDRINUSE', 'reports EADDRINUSE');
    } finally {
      await reservation.release();
    }
  });

  test('release frees the port and is idempotent', async function (assert) {
    let probe = await findAndHoldAvailablePort();
    let port = probe.port;
    await probe.release();

    let reservation = await holdSpecificPort(port);
    await reservation.release();
    // Second release must not throw.
    await reservation.release();

    let attempt = await bindOn(port);
    assert.true(attempt.ok, `port ${port} is free after release`);
    await attempt.close();
  });

  test('rejects with a port-conflict probe when the port is already taken', async function (assert) {
    // The fail-fast path: if the public port was stolen before we could
    // hold it, surface the collision immediately with the holder's identity
    // rather than as an opaque late EADDRINUSE on the compat-proxy bind.
    let probe = await findAndHoldAvailablePort();
    let port = probe.port;
    await probe.release();

    let occupier = await bindOn(port);
    assert.true(occupier.ok, 'occupier bound the port first');
    try {
      let error: NodeJS.ErrnoException | undefined;
      try {
        let reservation = await holdSpecificPort(port);
        await reservation.release();
      } catch (e) {
        error = e as NodeJS.ErrnoException;
      }
      assert.ok(error, 'holdSpecificPort rejected on a taken port');
      assert.strictEqual(error?.code, 'EADDRINUSE', 'error is EADDRINUSE');
      assert.ok(
        error?.message.includes('port-conflict probe'),
        'error message carries the diagnostic probe',
      );
    } finally {
      await occupier.close();
    }
  });

  test('a held specific port is not handed to a sibling allocator', async function (assert) {
    // The core invariant the fix relies on: while the public port is held
    // here, the sibling findAndHoldAvailablePort() calls (worker-manager,
    // realm-server child, prerender) the harness makes before the
    // compat-proxy bind must never be handed this number back.
    let probe = await findAndHoldAvailablePort();
    let port = probe.port;
    await probe.release();

    let held = await holdSpecificPort(port);
    try {
      let siblings = await Promise.all(
        Array.from({ length: 16 }, () => findAndHoldAvailablePort()),
      );
      try {
        for (let sibling of siblings) {
          assert.notStrictEqual(
            sibling.port,
            port,
            `sibling allocation ${sibling.port} avoided the held port ${port}`,
          );
        }
      } finally {
        await Promise.allSettled(siblings.map((s) => s.release()));
      }
    } finally {
      await held.release();
    }
  });
});
