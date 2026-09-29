import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  ConnectionScheduler,
  currentConnectionTenant,
  markConnectionHeld,
  isSharedWork,
  withConnectionTenant,
  withSharedWork,
} from '@cardstack/postgres';

// The connection scheduler decides which of the database work waiting on a
// replica's pool runs next. These tests pin the policy the realm-server's
// search isolation rests on: lowest-held-first ordering, a per-tenant share
// that applies only while another tenant has work open, untagged work that is
// never held to it, and nested acquisitions that can never deadlock behind
// their own tenant's share.

const REALM_A = 'https://example.test/a/';
const REALM_B = 'https://example.test/b/';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Settles `promise` if it resolves before `ms` elapses; otherwise reports it
// still pending.
async function settledWithin<T>(
  promise: Promise<T>,
  ms: number,
): Promise<{ settled: true; value: T } | { settled: false }> {
  let pending = Symbol('pending');
  let result = await Promise.race([
    promise,
    wait(ms).then(() => pending as unknown as T),
  ]);
  return result === (pending as unknown as T)
    ? { settled: false }
    : { settled: true, value: result };
}

// Holds a tenant's scope open until `close` is called, the way a search
// request holds it for as long as it is being handled. `run` does work charged
// to the tenant, in a scope of its own, as a request's queries run inside its
// handler.
function openScope(tenant: string): {
  close: () => void;
  closed: Promise<void>;
  run: <T>(fn: () => Promise<T>) => Promise<T>;
} {
  let close!: () => void;
  let gate = new Promise<void>((resolve) => (close = resolve));
  let closed = withConnectionTenant(tenant, () => gate);
  return {
    close,
    closed,
    run: (fn) => withConnectionTenant(tenant, fn),
  };
}

// Release everything held, then each queued acquisition as it is granted,
// until nothing is left. Leaves the scheduler empty for the next test.
async function drain(
  held: (() => void)[],
  queued: Promise<() => void>[],
): Promise<void> {
  held.forEach((release) => release());
  for (let acquisition of queued) {
    (await acquisition)();
  }
}

module(basename(import.meta.filename), function () {
  test('grants up to the limit and hands a released connection to the next waiter', async function (assert) {
    let scheduler = new ConnectionScheduler({ limit: 2, tenantShare: 2 });
    let first = await scheduler.acquire();
    let second = await scheduler.acquire();
    assert.strictEqual(scheduler.inUse, 2);

    let third = scheduler.acquire();
    assert.strictEqual(scheduler.waiting, 1, 'the third waits');
    assert.false((await settledWithin(third, 20)).settled);

    first();
    let granted = await settledWithin(third, 200);
    assert.true(granted.settled, 'a release grants the waiter');
    assert.strictEqual(scheduler.inUse, 2, 'the connection changed hands');
    assert.strictEqual(scheduler.waiting, 0);

    first();
    assert.strictEqual(scheduler.inUse, 2, 'a second release is a no-op');
    second();
    (granted as { value: () => void }).value();
    assert.strictEqual(scheduler.inUse, 0);
    scheduler.dispose();
  });

  test('a tenant waiting behind another tenant’s backlog is served first', async function (assert) {
    let scheduler = new ConnectionScheduler({ limit: 3, tenantShare: 3 });
    let a = openScope(REALM_A);
    let b = openScope(REALM_B);

    let held = await a.run(() =>
      Promise.all([
        scheduler.acquire(),
        scheduler.acquire(),
        scheduler.acquire(),
      ]),
    );
    let order: string[] = [];
    let backlog = [1, 2, 3, 4].map((n) =>
      a
        .run(() => scheduler.acquire())
        .then((release) => {
          order.push(`a${n}`);
          return release;
        }),
    );
    let quiet = b
      .run(() => scheduler.acquire())
      .then((release) => {
        order.push('b');
        return release;
      });
    assert.strictEqual(scheduler.waiting, 5);

    held[0]();
    let bRelease = await quiet;
    assert.deepEqual(
      order,
      ['b'],
      'the next free connection goes to the tenant holding none, not to the earlier arrivals',
    );

    held[1]();
    held[2]();
    bRelease();
    let [a1, a2, a3] = await Promise.all(backlog.slice(0, 3));
    a1();
    let a4 = await backlog[3];
    assert.deepEqual(
      order,
      ['b', 'a1', 'a2', 'a3', 'a4'],
      'within a tenant, arrival order',
    );
    [a2, a3, a4].forEach((release) => release());
    a.close();
    b.close();
    await Promise.all([a.closed, b.closed]);
    scheduler.dispose();
  });

  test('a tenant searching alone is not held to its share, however much it asks for', async function (assert) {
    let scheduler = new ConnectionScheduler({ limit: 6, tenantShare: 2 });
    let a = openScope(REALM_A);
    let granted = await a.run(() =>
      Promise.all(Array.from({ length: 6 }, () => scheduler.acquire())),
    );
    let backlog = Array.from({ length: 10 }, () =>
      a.run(() => scheduler.acquire()),
    );
    assert.strictEqual(scheduler.inUse, 6, 'the whole pool');
    assert.strictEqual(scheduler.waiting, 10);
    assert.strictEqual(
      scheduler.waitingAtShare,
      0,
      'its backlog waits for connections, not for a share',
    );
    await drain(granted, backlog);
    a.close();
    await a.closed;
    scheduler.dispose();
  });

  test('a pool with room for everyone’s work holds no one to the share', async function (assert) {
    let scheduler = new ConnectionScheduler({ limit: 6, tenantShare: 2 });
    let a = openScope(REALM_A);
    let b = openScope(REALM_B);
    let granted = await settledWithin(
      a.run(() =>
        Promise.all(Array.from({ length: 5 }, () => scheduler.acquire())),
      ),
      50,
    );
    assert.true(
      granted.settled,
      'five connections past a share of two, while another tenant is open',
    );
    assert.strictEqual(scheduler.inUse, 5);
    assert.strictEqual(scheduler.waitingAtShare, 0);
    (granted as { value: (() => void)[] }).value.forEach((release) =>
      release(),
    );
    a.close();
    b.close();
    await Promise.all([a.closed, b.closed]);
    scheduler.dispose();
  });

  test('once the pool is oversubscribed, a tenant waits at its share even with connections free, until the other tenant closes', async function (assert) {
    let scheduler = new ConnectionScheduler({ limit: 6, tenantShare: 2 });
    let a = openScope(REALM_A);
    let b = openScope(REALM_B);

    let aHeld = await a.run(() =>
      Promise.all(Array.from({ length: 6 }, () => scheduler.acquire())),
    );
    let aBacklog = Array.from({ length: 10 }, () =>
      a.run(() => scheduler.acquire()),
    );
    let bQueued = b.run(() => scheduler.acquire());
    assert.strictEqual(scheduler.waiting, 11, 'demand is past the pool');

    aHeld.pop()!();
    let bGranted = await settledWithin(bQueued, 50);
    assert.true(
      bGranted.settled,
      'the freed connection goes to the other tenant',
    );

    // Three more of the heavy tenant's queries finish. It is down to its share
    // of two, three connections sit free, and its backlog still waits.
    aHeld.pop()!();
    aHeld.pop()!();
    aHeld.pop()!();
    assert.strictEqual(scheduler.inUse, 3);
    assert.strictEqual(scheduler.waitingAtShare, 10);
    assert.false(
      (await settledWithin(aBacklog[0], 20)).settled,
      'the backlog waits though connections are free',
    );

    let bRelease = (bGranted as { value: () => void }).value;
    bRelease();
    b.close();
    await b.closed;
    assert.strictEqual(
      scheduler.inUse,
      6,
      'with no one else open the backlog takes the whole pool',
    );
    assert.strictEqual(scheduler.waitingAtShare, 0);

    await drain(aHeld, aBacklog);
    a.close();
    await a.closed;
    scheduler.dispose();
  });

  test('a tenant at its share still gets its share, and past it once its backlog fits', async function (assert) {
    let scheduler = new ConnectionScheduler({ limit: 4, tenantShare: 1 });
    let a = openScope(REALM_A);
    let b = openScope(REALM_B);

    let aHeld = await a.run(() =>
      Promise.all(Array.from({ length: 4 }, () => scheduler.acquire())),
    );
    let order: number[] = [];
    let aBacklog = Array.from({ length: 5 }, (_unused, n) =>
      a
        .run(() => scheduler.acquire())
        .then((release) => {
          order.push(n);
          return release;
        }),
    );
    aHeld.forEach((release) => release());
    let first = await settledWithin(aBacklog[0], 50);
    assert.true(first.settled, 'dropping under its share lets one through');
    assert.strictEqual(scheduler.inUse, 1, 'and only one');

    (first as { value: () => void }).value();
    let rest = await settledWithin(Promise.all(aBacklog.slice(1)), 200);
    assert.true(
      rest.settled,
      'once what is left fits the pool, the share stops applying',
    );
    assert.deepEqual(order, [0, 1, 2, 3, 4]);
    (rest as { value: (() => void)[] }).value.forEach((release) => release());
    a.close();
    b.close();
    await Promise.all([a.closed, b.closed]);
    scheduler.dispose();
  });

  test('untagged work is never held to the share', async function (assert) {
    let scheduler = new ConnectionScheduler({ limit: 4, tenantShare: 1 });
    let a = openScope(REALM_A);
    let b = openScope(REALM_B);

    let aHeld = await a.run(() =>
      Promise.all(Array.from({ length: 4 }, () => scheduler.acquire())),
    );
    let aBacklog = Array.from({ length: 10 }, () =>
      a.run(() => scheduler.acquire()),
    );
    aHeld.pop()!();
    aHeld.pop()!();
    assert.strictEqual(
      scheduler.inUse,
      2,
      'two connections free while the tenant’s backlog waits at its share',
    );
    assert.strictEqual(currentConnectionTenant(), undefined);
    let untagged = await settledWithin(
      Promise.all([scheduler.acquire(), scheduler.acquire()]),
      50,
    );
    assert.true(untagged.settled, 'untagged work takes the free connections');

    (untagged as { value: (() => void)[] }).value.forEach((release) =>
      release(),
    );
    b.close();
    await b.closed;
    await drain(aHeld, aBacklog);
    a.close();
    await a.closed;
    scheduler.dispose();
  });

  test('untagged activity does not put the only open tenant at its share', async function (assert) {
    let scheduler = new ConnectionScheduler({ limit: 4, tenantShare: 1 });
    let a = openScope(REALM_A);

    let untagged = await Promise.all([
      scheduler.acquire(),
      scheduler.acquire(),
    ]);
    let aHeld = await a.run(() =>
      Promise.all([scheduler.acquire(), scheduler.acquire()]),
    );
    let aBacklog = Array.from({ length: 8 }, () =>
      a.run(() => scheduler.acquire()),
    );
    untagged.pop()!();
    let next = await settledWithin(aBacklog[0], 50);
    assert.true(
      next.settled,
      'past its share on an oversubscribed pool, because no other tenant is open',
    );
    untagged.pop()!();
    await drain(
      [...aHeld, (next as { value: () => void }).value],
      aBacklog.slice(1),
    );
    a.close();
    await a.closed;
    scheduler.dispose();
  });

  test('work nested in a held connection is granted ahead of other waiters and past the share, until the hold ends', async function (assert) {
    let scheduler = new ConnectionScheduler({ limit: 4, tenantShare: 1 });
    let a = openScope(REALM_A);
    let b = openScope(REALM_B);

    let outer = await a.run(() => scheduler.acquire());
    let holding = await a.run(async () => markConnectionHeld());
    let bHeld = await b.run(() =>
      Promise.all(Array.from({ length: 3 }, () => scheduler.acquire())),
    );
    let bBacklog = Array.from({ length: 5 }, () =>
      b.run(() => scheduler.acquire()),
    );
    assert.strictEqual(
      scheduler.inUse,
      4,
      'the pool is full and oversubscribed',
    );

    let nested = a.run(() => holding.run(() => scheduler.acquire()));
    bHeld.pop()!();
    let nestedGranted = await settledWithin(nested, 50);
    assert.true(
      nestedGranted.settled,
      'the nested acquisition takes the freed connection, ahead of the backlog and past its tenant’s share',
    );

    holding.end();
    let afterEnd = a.run(() => holding.run(() => scheduler.acquire()));
    bHeld.pop()!();
    assert.false(
      (await settledWithin(afterEnd, 20)).settled,
      'once the hold ends, the same context waits at its share',
    );

    outer();
    (nestedGranted as { value: () => void }).value();
    b.close();
    await b.closed;
    await drain(bHeld, [...bBacklog, afterEnd]);
    a.close();
    await a.closed;
    assert.strictEqual(scheduler.inUse, 0);
    scheduler.dispose();
  });

  test('shared work inside a tenant’s scope stays that tenant’s but is held to no share', async function (assert) {
    let scheduler = new ConnectionScheduler({ limit: 4, tenantShare: 1 });
    let a = openScope(REALM_A);
    let b = openScope(REALM_B);

    let aHeld = await a.run(() =>
      Promise.all(Array.from({ length: 4 }, () => scheduler.acquire())),
    );
    let aBacklog = Array.from({ length: 5 }, () =>
      a.run(() => scheduler.acquire()),
    );
    aHeld.pop()!();
    aHeld.pop()!();
    assert.strictEqual(
      scheduler.waitingAtShare,
      5,
      'the tenant’s own work waits at its share with two connections free',
    );

    let inside: { tenant: string | undefined; shared: boolean } | undefined;
    let shared = await settledWithin(
      a.run(() =>
        withSharedWork(() => {
          inside = {
            tenant: currentConnectionTenant(),
            shared: isSharedWork(),
          };
          return scheduler.acquire();
        }),
      ),
      50,
    );
    assert.deepEqual(
      inside,
      { tenant: REALM_A, shared: true },
      'still the tenant’s work, marked shared',
    );
    assert.true(shared.settled, 'granted a free connection past the share');

    (shared as { value: () => void }).value();
    b.close();
    await b.closed;
    await drain(aHeld, aBacklog);
    a.close();
    await a.closed;
    scheduler.dispose();
  });

  test('a quiet tenant’s shared work is served ahead of a heavy tenant’s queued shared work', async function (assert) {
    let scheduler = new ConnectionScheduler({ limit: 6, tenantShare: 2 });
    let heavy = openScope(REALM_A);
    let quiet = openScope(REALM_B);

    let heavyHeld = await heavy.run(() =>
      Promise.all(Array.from({ length: 6 }, () => scheduler.acquire())),
    );
    let order: string[] = [];
    let track = (label: string, acquisition: Promise<() => void>) =>
      acquisition.then((release) => (order.push(label), release));
    let heavyShared = Array.from({ length: 5 }, (_unused, n) =>
      track(
        `heavy-shared-${n}`,
        heavy.run(() => withSharedWork(() => scheduler.acquire())),
      ),
    );
    let heavyCapped = Array.from({ length: 5 }, (_unused, n) =>
      track(
        `heavy-${n}`,
        heavy.run(() => scheduler.acquire()),
      ),
    );
    let quietRead = track(
      'quiet',
      quiet.run(() => scheduler.acquire()),
    );
    let quietShared = track(
      'quiet-shared',
      quiet.run(() => withSharedWork(() => scheduler.acquire())),
    );

    heavyHeld.pop()!();
    let quietReadRelease = await quietRead;
    heavyHeld.pop()!();
    let quietSharedRelease = await quietShared;
    assert.deepEqual(
      order,
      ['quiet', 'quiet-shared'],
      'the quiet tenant holds the fewest, so both its read and its shared work go first — ahead of shared work the heavy tenant queued earlier',
    );

    heavyHeld.pop()!();
    let next = await settledWithin(heavyShared[0], 50);
    assert.true(
      next.settled,
      'the heavy tenant’s shared work is granted while its three connections keep it past its share',
    );
    assert.strictEqual(
      scheduler.waitingAtShare,
      5,
      'its other work still waits at its share',
    );

    quietReadRelease();
    quietSharedRelease();
    quiet.close();
    await quiet.closed;
    await drain(
      [...heavyHeld, (next as { value: () => void }).value],
      [...heavyShared.slice(1), ...heavyCapped],
    );
    heavy.close();
    await heavy.closed;
    scheduler.dispose();
  });

  test('shared work keeps the exemption of a connection its caller holds', async function (assert) {
    let scheduler = new ConnectionScheduler({ limit: 2, tenantShare: 1 });
    let a = openScope(REALM_A);
    let b = openScope(REALM_B);

    let outer = await a.run(() => scheduler.acquire());
    let holding = await a.run(async () => markConnectionHeld());
    let bHeld = await b.run(() => scheduler.acquire());
    let bBacklog = Array.from({ length: 3 }, () =>
      b.run(() => scheduler.acquire()),
    );
    let untaggedEarlier = scheduler.acquire();
    let order: string[] = [];
    let nestedShared = a
      .run(() => holding.run(() => withSharedWork(() => scheduler.acquire())))
      .then((release) => (order.push('nested'), release));
    void bBacklog[0].then(() => order.push('b'));
    void untaggedEarlier.then(() => order.push('untagged'));

    bHeld();
    let granted = await settledWithin(nestedShared, 50);
    assert.true(
      granted.settled,
      'the freed connection goes to the nested work',
    );
    assert.deepEqual(
      order,
      ['nested'],
      'ahead of earlier arrivals, as nested work is granted',
    );

    holding.end();
    outer();
    (granted as { value: () => void }).value();
    b.close();
    await b.closed;
    await drain([], [...bBacklog, untaggedEarlier]);
    a.close();
    await a.closed;
    assert.strictEqual(scheduler.inUse, 0);
    scheduler.dispose();
  });

  test('counts that are not positive integers are clamped', function (assert) {
    for (let bad of [0, -3, NaN, Infinity]) {
      let scheduler = new ConnectionScheduler({ limit: bad, tenantShare: bad });
      assert.strictEqual(scheduler.limit, 1, `limit ${bad}`);
      assert.strictEqual(scheduler.tenantShare, 1, `share ${bad}`);
      scheduler.dispose();
    }
    let scheduler = new ConnectionScheduler({ limit: 2.7, tenantShare: 1.2 });
    assert.strictEqual(scheduler.limit, 2);
    assert.strictEqual(scheduler.tenantShare, 1);
    scheduler.dispose();
  });
});
