import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  ConnectionScheduler,
  currentConnectionTenant,
  markConnectionHeld,
  withConnectionTenant,
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

  test('a tenant searching alone is not held to its share', async function (assert) {
    let scheduler = new ConnectionScheduler({ limit: 6, tenantShare: 2 });
    let a = openScope(REALM_A);
    let releases = await a.run(() =>
      Promise.all(Array.from({ length: 6 }, () => scheduler.acquire())),
    );
    assert.strictEqual(scheduler.inUse, 6, 'the whole pool');
    assert.strictEqual(scheduler.waitingAtShare, 0);
    releases.forEach((release) => release());
    a.close();
    await a.closed;
    scheduler.dispose();
  });

  test('while another tenant has work open, a tenant waits at its share even with connections free', async function (assert) {
    let scheduler = new ConnectionScheduler({ limit: 6, tenantShare: 2 });
    let a = openScope(REALM_A);
    let b = openScope(REALM_B);

    let first = await a.run(() => scheduler.acquire());
    let second = await a.run(() => scheduler.acquire());
    let third = a.run(() => scheduler.acquire());
    assert.false(
      (await settledWithin(third, 20)).settled,
      'the third waits though four connections are free',
    );
    assert.strictEqual(scheduler.inUse, 2);
    assert.strictEqual(scheduler.waitingAtShare, 1);

    let quiet = await settledWithin(
      b.run(() => scheduler.acquire()),
      50,
    );
    assert.true(quiet.settled, 'the other tenant is granted at once');

    first();
    let granted = await settledWithin(third, 200);
    assert.true(
      granted.settled,
      'dropping under its share lets the waiter through',
    );

    second();
    (granted as { value: () => void }).value();
    (quiet as { value: () => void }).value();
    a.close();
    b.close();
    await Promise.all([a.closed, b.closed]);
    scheduler.dispose();
  });

  test('the share lifts when the other tenant’s last scope closes', async function (assert) {
    let scheduler = new ConnectionScheduler({ limit: 6, tenantShare: 2 });
    let a = openScope(REALM_A);
    let b = openScope(REALM_B);

    let held = await a.run(() =>
      Promise.all([scheduler.acquire(), scheduler.acquire()]),
    );
    let waiters = [
      a.run(() => scheduler.acquire()),
      a.run(() => scheduler.acquire()),
    ];
    assert.strictEqual(scheduler.waitingAtShare, 2);

    b.close();
    await b.closed;
    let granted = await settledWithin(Promise.all(waiters), 200);
    assert.true(
      granted.settled,
      'the queued work runs once no other tenant is open',
    );
    assert.strictEqual(scheduler.inUse, 4);

    held.forEach((release) => release());
    (granted as { value: (() => void)[] }).value.forEach((release) =>
      release(),
    );
    a.close();
    await a.closed;
    scheduler.dispose();
  });

  test('untagged work is never held to the share and holds no one else to it', async function (assert) {
    let scheduler = new ConnectionScheduler({ limit: 6, tenantShare: 2 });
    let a = openScope(REALM_A);

    let untagged = await Promise.all(
      Array.from({ length: 3 }, () => scheduler.acquire()),
    );
    assert.strictEqual(
      currentConnectionTenant(),
      undefined,
      'these acquisitions are untagged',
    );
    let tenantWork = await settledWithin(
      a.run(() =>
        Promise.all(Array.from({ length: 3 }, () => scheduler.acquire())),
      ),
      50,
    );
    assert.true(
      tenantWork.settled,
      'untagged activity does not put the only open tenant at its share',
    );
    assert.strictEqual(scheduler.inUse, 6);

    untagged.forEach((release) => release());
    (tenantWork as { value: (() => void)[] }).value.forEach((release) =>
      release(),
    );
    a.close();
    await a.closed;
    scheduler.dispose();
  });

  test('work nested in a held connection is granted past the share and ahead of other waiters', async function (assert) {
    let scheduler = new ConnectionScheduler({ limit: 3, tenantShare: 1 });
    let a = openScope(REALM_A);
    let b = openScope(REALM_B);

    let outer = await a.run(() => scheduler.acquire());
    let holding = await a.run(async () => markConnectionHeld());
    let nested = await settledWithin(
      a.run(() => holding.run(() => scheduler.acquire())),
      50,
    );
    assert.true(
      nested.settled,
      'the nested acquisition is granted though its tenant is at its share',
    );

    let other = await b.run(() => scheduler.acquire());
    assert.strictEqual(scheduler.inUse, 3, 'the pool is full');
    let queuedB = b.run(() => scheduler.acquire());
    let queuedNested = a.run(() => holding.run(() => scheduler.acquire()));
    other();
    let first = await Promise.race([
      queuedNested.then(() => 'nested'),
      queuedB.then(() => 'b'),
    ]);
    assert.strictEqual(first, 'nested', 'nested work goes first');

    holding.end();
    let afterEnd = a.run(() => holding.run(() => scheduler.acquire()));
    assert.false(
      (await settledWithin(afterEnd, 20)).settled,
      'once the hold ends, the same context waits at its share again',
    );

    outer();
    (nested as { value: () => void }).value();
    (await queuedNested)();
    (await queuedB)();
    (await afterEnd)();
    a.close();
    b.close();
    await Promise.all([a.closed, b.closed]);
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
