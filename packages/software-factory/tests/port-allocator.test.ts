import { createServer } from 'node:net';
import { module, test } from 'qunit';

import {
  TEST_WORKER_PORT_RANGE_END,
  TEST_WORKER_PORT_RANGE_START,
  allocateTestWorkerPortSet,
  tryHoldPort,
} from './helpers/port-allocator.ts';

async function isListeningOn(port: number): Promise<boolean> {
  // Returns true if attempting to bind a fresh server to the port fails
  // with EADDRINUSE — i.e., something else holds it.
  return await new Promise<boolean>((resolve, reject) => {
    let server = createServer();
    server.once('error', (error: NodeJS.ErrnoException) => {
      server.close(() => {
        if (error.code === 'EADDRINUSE') {
          resolve(true);
        } else {
          reject(error);
        }
      });
    });
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(false));
    });
  });
}

module('port-allocator', function () {
  test('reserved ports live below the Linux ephemeral port range', function (assert) {
    // The Linux default ephemeral range is 32768-60999. Anything up to 32768
    // is safe. We keep an extra 768-port margin for good measure.
    assert.ok(
      TEST_WORKER_PORT_RANGE_START >= 1024,
      `range start ${TEST_WORKER_PORT_RANGE_START} is above the privileged-port range`,
    );
    assert.ok(
      TEST_WORKER_PORT_RANGE_END <= 32768,
      `range end ${TEST_WORKER_PORT_RANGE_END} is below the ephemeral port range (32768-60999)`,
    );
  });

  test('concurrent allocations produce disjoint blocks entirely inside the safe range', async function (assert) {
    // Simulate 8 Playwright workers concurrently asking for reservations.
    let reservations = await Promise.all(
      Array.from({ length: 8 }, (_, i) => allocateTestWorkerPortSet(i)),
    );
    try {
      let allPorts = reservations.flatMap((r) => [
        r.compatRealmServerPort,
        r.realmServerPort,
        r.prerenderPort,
      ]);
      // All distinct.
      assert.strictEqual(
        new Set(allPorts).size,
        allPorts.length,
        'every reserved port is unique across workers',
      );
      // All in the safe range.
      for (let port of allPorts) {
        let inRange =
          port >= TEST_WORKER_PORT_RANGE_START &&
          port < TEST_WORKER_PORT_RANGE_END;
        assert.true(
          inRange,
          `port ${port} lives in [${TEST_WORKER_PORT_RANGE_START}, ${TEST_WORKER_PORT_RANGE_END})`,
        );
      }
    } finally {
      await Promise.allSettled(reservations.map((r) => r.stop()));
    }
  });

  test('holder socket actually binds the port — another listener sees EADDRINUSE', async function (assert) {
    let reservation = await allocateTestWorkerPortSet(0);
    try {
      for (let port of [
        reservation.compatRealmServerPort,
        reservation.realmServerPort,
        reservation.prerenderPort,
      ]) {
        assert.true(
          await isListeningOn(port),
          `port ${port} is held by our allocator (bind fails with EADDRINUSE)`,
        );
      }
    } finally {
      await reservation.stop();
    }
  });

  test('IPv4 holder blocks a default (dual-stack) bind on the same port', async function (assert) {
    // prerender-server and realm-server call .listen(port) without a host,
    // which Node resolves to '::' (IPv6 wildcard, dual-stack on Linux). The
    // holder must block that bind pattern, not just explicit 127.0.0.1.
    let reservation = await allocateTestWorkerPortSet(0);
    let port = reservation.prerenderPort;
    let attempt = await new Promise<{ ok: boolean; code?: string }>(
      (resolve) => {
        let s = createServer();
        s.once('error', (err: NodeJS.ErrnoException) =>
          resolve({ ok: false, code: err.code }),
        );
        s.listen(port, () => {
          s.close(() => resolve({ ok: true }));
        });
      },
    );
    try {
      assert.false(
        attempt.ok,
        `default (::) bind to held port ${port} should fail`,
      );
      assert.strictEqual(
        attempt.code,
        'EADDRINUSE',
        `default (::) bind fails with EADDRINUSE, got ${attempt.code}`,
      );
    } finally {
      await reservation.stop();
    }
  });

  test('a dynamic (OS-assigned) port never lands inside our reserved block', async function (assert) {
    // This is the exact collision vector that caused the CI failure:
    // another worker's `findAvailablePort()` landed on a pre-reserved port.
    // Because our reserved range is below 32768, OS port-0 allocation (which
    // picks from 32768-60999) cannot hand out any of these ports.
    let reservation = await allocateTestWorkerPortSet(0);
    try {
      // Do many port-0 allocations and assert none fall in the reserved range.
      let dynamicPorts = await Promise.all(
        Array.from(
          { length: 50 },
          () =>
            new Promise<number>((resolve, reject) => {
              let s = createServer();
              s.once('error', reject);
              s.listen(0, '127.0.0.1', () => {
                let address = s.address();
                if (!address || typeof address === 'string') {
                  reject(new Error('no address'));
                  return;
                }
                let port = address.port;
                s.close(() => resolve(port));
              });
            }),
        ),
      );
      for (let port of dynamicPorts) {
        let outsideRange =
          port < TEST_WORKER_PORT_RANGE_START ||
          port >= TEST_WORKER_PORT_RANGE_END;
        assert.true(
          outsideRange,
          `OS-assigned port ${port} is outside the reserved range [${TEST_WORKER_PORT_RANGE_START}, ${TEST_WORKER_PORT_RANGE_END})`,
        );
      }
    } finally {
      await reservation.stop();
    }
  });

  test('release + reacquire round-trip keeps ownership', async function (assert) {
    let reservation = await allocateTestWorkerPortSet(0);
    try {
      // releaseRealmServerPorts only releases the realm-server holder
      // now — the compat holder is released once by the worker fixture
      // (the worker-scoped proxy takes over the port for the rest of
      // the worker's lifetime) and there is no matching reacquire.
      let port = reservation.realmServerPort;
      assert.true(await isListeningOn(port), 'port is held initially');

      await reservation.releaseRealmServerPorts();
      assert.false(
        await isListeningOn(port),
        'port is free right after releaseRealmServerPorts()',
      );

      await reservation.reacquireRealmServerPorts();
      assert.true(
        await isListeningOn(port),
        'port is held again after reacquireRealmServerPorts()',
      );
    } finally {
      await reservation.stop();
    }
  });

  test('stop() releases all holders (port becomes free)', async function (assert) {
    let reservation = await allocateTestWorkerPortSet(0);
    let ports = [
      reservation.compatRealmServerPort,
      reservation.realmServerPort,
      reservation.prerenderPort,
    ];
    await reservation.stop();
    for (let port of ports) {
      assert.false(
        await isListeningOn(port),
        `port ${port} is free after stop()`,
      );
    }
  });

  test('tryHoldPort returns null when the port is already in use', async function (assert) {
    // Take any free port, then try to hold it again.
    let first = await allocateTestWorkerPortSet(0);
    try {
      let conflict = await tryHoldPort(first.compatRealmServerPort);
      assert.strictEqual(
        conflict,
        null,
        'tryHoldPort returns null for an occupied port instead of throwing',
      );
    } finally {
      await first.stop();
    }
  });
});
