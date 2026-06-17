import { module, test } from 'qunit';
import { basename } from 'path';
import type { PgAdapter } from '@cardstack/postgres';
import { query, param } from '@cardstack/runtime-common';
import { setupDB } from './helpers/index.ts';

// Tests for the multiplexed LISTEN API on PgAdapter. Every assertion exercises
// the shared notification client — there is no way to "stub" subscribe(); the
// API is end-to-end with real LISTEN/NOTIFY round-trips.
//
// These tests assume `setupDB` provisions a PgAdapter pointed at the local
// test postgres (matching the rest of the realm-server test suite).

function waitFor<T>(
  getValue: () => T | undefined,
  timeoutMs = 3000,
  pollMs = 20,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const value = getValue();
      if (value !== undefined) {
        resolve(value);
        return;
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`timeout after ${timeoutMs}ms`));
        return;
      }
      setTimeout(tick, pollMs);
    };
    tick();
  });
}

async function notify(
  dbAdapter: PgAdapter,
  channel: string,
  payload: string,
): Promise<void> {
  await query(dbAdapter, [
    `SELECT pg_notify(`,
    param(channel),
    `,`,
    param(payload),
    `)`,
  ]);
}

module(basename(import.meta.filename), function () {
  module('PgAdapter.subscribe', function (hooks) {
    let dbAdapter: PgAdapter;

    setupDB(hooks, {
      beforeEach: async (adapter) => {
        dbAdapter = adapter;
      },
    });

    test('a single subscriber receives notifications on its channel', async function (assert) {
      const seen: string[] = [];
      const sub = await dbAdapter.subscribe('mux_test_one', (n) => {
        if (n.payload) seen.push(n.payload);
      });
      try {
        await notify(dbAdapter, 'mux_test_one', 'hello');
        const got = await waitFor(() =>
          seen.length > 0 ? [...seen] : undefined,
        );
        assert.deepEqual(got, ['hello']);
      } finally {
        await sub.unsubscribe();
      }
    });

    test('two subscribers on the same channel both receive every notification', async function (assert) {
      const seenA: string[] = [];
      const seenB: string[] = [];
      const subA = await dbAdapter.subscribe('mux_test_same', (n) => {
        if (n.payload) seenA.push(n.payload);
      });
      const subB = await dbAdapter.subscribe('mux_test_same', (n) => {
        if (n.payload) seenB.push(n.payload);
      });
      try {
        await notify(dbAdapter, 'mux_test_same', 'msg-1');
        await waitFor(() => (seenA.length > 0 ? true : undefined));
        await waitFor(() => (seenB.length > 0 ? true : undefined));
        assert.deepEqual(seenA, ['msg-1']);
        assert.deepEqual(seenB, ['msg-1']);
      } finally {
        await subA.unsubscribe();
        await subB.unsubscribe();
      }
    });

    test('subscribers on different channels do not see each other’s notifications', async function (assert) {
      const seenA: string[] = [];
      const seenB: string[] = [];
      const subA = await dbAdapter.subscribe('mux_test_chan_a', (n) => {
        if (n.payload) seenA.push(n.payload);
      });
      const subB = await dbAdapter.subscribe('mux_test_chan_b', (n) => {
        if (n.payload) seenB.push(n.payload);
      });
      try {
        await notify(dbAdapter, 'mux_test_chan_a', 'a-msg');
        await notify(dbAdapter, 'mux_test_chan_b', 'b-msg');
        await waitFor(() => (seenA.length > 0 ? true : undefined));
        await waitFor(() => (seenB.length > 0 ? true : undefined));
        assert.deepEqual(seenA, ['a-msg']);
        assert.deepEqual(seenB, ['b-msg']);
      } finally {
        await subA.unsubscribe();
        await subB.unsubscribe();
      }
    });

    test('unsubscribing one of two same-channel subscribers leaves the other receiving', async function (assert) {
      const seenA: string[] = [];
      const seenB: string[] = [];
      const subA = await dbAdapter.subscribe('mux_test_partial', (n) => {
        if (n.payload) seenA.push(n.payload);
      });
      const subB = await dbAdapter.subscribe('mux_test_partial', (n) => {
        if (n.payload) seenB.push(n.payload);
      });
      try {
        await subA.unsubscribe();
        await notify(dbAdapter, 'mux_test_partial', 'after-unsub');
        await waitFor(() => (seenB.length > 0 ? true : undefined));
        assert.deepEqual(seenA, [], 'unsubscribed handler did not fire');
        assert.deepEqual(seenB, ['after-unsub']);
      } finally {
        await subB.unsubscribe();
      }
    });

    test('after the last subscriber unsubscribes a channel, re-subscribing still receives', async function (assert) {
      const seenFirst: string[] = [];
      const subA = await dbAdapter.subscribe('mux_test_resubscribe', (n) => {
        if (n.payload) seenFirst.push(n.payload);
      });
      await subA.unsubscribe();

      const seenSecond: string[] = [];
      const subB = await dbAdapter.subscribe('mux_test_resubscribe', (n) => {
        if (n.payload) seenSecond.push(n.payload);
      });
      try {
        await notify(dbAdapter, 'mux_test_resubscribe', 'resub');
        await waitFor(() => (seenSecond.length > 0 ? true : undefined));
        assert.deepEqual(seenFirst, []);
        assert.deepEqual(seenSecond, ['resub']);
      } finally {
        await subB.unsubscribe();
      }
    });

    test('repeated unsubscribe is a no-op', async function (assert) {
      const seen: string[] = [];
      const sub = await dbAdapter.subscribe('mux_test_idem', (n) => {
        if (n.payload) seen.push(n.payload);
      });
      await sub.unsubscribe();
      await sub.unsubscribe();
      assert.ok(true, 'second unsubscribe did not throw');
    });

    test('concurrent subscribes on the same empty channel both receive notifications', async function (assert) {
      // Both subscribers race through subscribe() at the same time, joining
      // the same in-flight LISTEN-establishment promise. Once it resolves,
      // both add their handlers and both should see every notification.
      const seenA: string[] = [];
      const seenB: string[] = [];
      const [subA, subB] = await Promise.all([
        dbAdapter.subscribe('mux_test_concurrent', (n) => {
          if (n.payload) seenA.push(n.payload);
        }),
        dbAdapter.subscribe('mux_test_concurrent', (n) => {
          if (n.payload) seenB.push(n.payload);
        }),
      ]);
      try {
        await notify(dbAdapter, 'mux_test_concurrent', 'msg');
        await waitFor(() => (seenA.length > 0 ? true : undefined));
        await waitFor(() => (seenB.length > 0 ? true : undefined));
        assert.deepEqual(seenA, ['msg']);
        assert.deepEqual(seenB, ['msg']);
      } finally {
        await subA.unsubscribe();
        await subB.unsubscribe();
      }
    });

    test('subscribing the same handler reference twice yields independent subscriptions', async function (assert) {
      // Each subscribe() returns its own unsubscribe() that is supposed to
      // remove only that subscription. If we used a Set keyed on handler
      // identity, the same fn registered twice would collapse — and either
      // returned unsubscribe would remove both. The fix is identity-per-call.
      const seen: string[] = [];
      const handler = (n: { payload?: string }) => {
        if (n.payload) seen.push(n.payload);
      };
      const subA = await dbAdapter.subscribe('mux_test_dup_fn', handler);
      const subB = await dbAdapter.subscribe('mux_test_dup_fn', handler);
      try {
        await subA.unsubscribe();
        await notify(dbAdapter, 'mux_test_dup_fn', 'after-A-unsub');
        await waitFor(() => (seen.length > 0 ? true : undefined));
        // B's subscription is still live; the same fn fires once for B.
        assert.deepEqual(seen, ['after-A-unsub']);
      } finally {
        await subB.unsubscribe();
      }
    });

    test('a handler that throws does not break sibling handlers on the same channel', async function (assert) {
      const seen: string[] = [];
      const subThrow = await dbAdapter.subscribe('mux_test_throwing', () => {
        throw new Error('boom');
      });
      const subOk = await dbAdapter.subscribe('mux_test_throwing', (n) => {
        if (n.payload) seen.push(n.payload);
      });
      try {
        await notify(dbAdapter, 'mux_test_throwing', 'ok');
        await waitFor(() => (seen.length > 0 ? true : undefined));
        assert.deepEqual(seen, ['ok']);
      } finally {
        await subThrow.unsubscribe();
        await subOk.unsubscribe();
      }
    });
  });
});
