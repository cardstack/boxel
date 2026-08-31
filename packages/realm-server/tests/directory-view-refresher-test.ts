import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  DirectoryViewRefresher,
  ancestorDirectories,
} from '@cardstack/runtime-common';

module(basename(import.meta.filename), function () {
  test('ancestorDirectories lists the realm root first, then each directory down to the parent', function (assert) {
    assert.deepEqual(ancestorDirectories('c.json'), ['']);
    assert.deepEqual(ancestorDirectories('a/c.json'), ['', 'a']);
    assert.deepEqual(ancestorDirectories('a/b/c.json'), ['', 'a', 'a/b']);
  });

  test('refresh lists every ancestor, root first', async function (assert) {
    let listed: string[] = [];
    let refresher = new DirectoryViewRefresher(async (dir) => {
      listed.push(dir);
    });

    await refresher.refresh('PersonCard/nested/bob.json');

    assert.deepEqual(listed, ['', 'PersonCard', 'PersonCard/nested']);
  });

  test('concurrent refreshes of one directory never overlap listings and coalesce into fewer listings than refreshes', async function (assert) {
    let calls: string[] = [];
    let inFlight = new Map<string, number>();
    let maxInFlight = new Map<string, number>();
    let refresher = new DirectoryViewRefresher(async (dir) => {
      calls.push(dir);
      let now = (inFlight.get(dir) ?? 0) + 1;
      inFlight.set(dir, now);
      maxInFlight.set(dir, Math.max(maxInFlight.get(dir) ?? 0, now));
      // A listing takes a round trip; every refresh below arrives during it.
      await new Promise((r) => setTimeout(r, 5));
      inFlight.set(dir, now - 1);
    });

    // Five notifications for files in the same directory arrive at once (a
    // batch write emits one per file).
    let names = ['a.json', 'b.json', 'c.json', 'd.json', 'e.json'];
    await Promise.all(
      names.map((name) => refresher.refresh(`PersonCard/${name}`)),
    );

    let count = (dir: string) => calls.filter((c) => c === dir).length;
    assert.strictEqual(maxInFlight.get(''), 1, 'root listings never overlap');
    assert.strictEqual(
      maxInFlight.get('PersonCard'),
      1,
      'PersonCard listings never overlap',
    );
    // The five refresh() calls reach their first `await` synchronously, so
    // the first starts the root listing and the other four share one pending
    // follow-up: the root count is structurally exactly 2. The PersonCard
    // count depends on how its first listing interleaves with the root
    // follow-up, so a bound is the honest assertion there.
    assert.strictEqual(
      count(''),
      2,
      'root listed once, then one follow-up for the four that arrived during it',
    );
    let dirBounded = count('PersonCard') <= 3;
    assert.true(
      dirBounded,
      `PersonCard listings stayed bounded (${count('PersonCard')})`,
    );

    calls.length = 0;
    await refresher.refresh('PersonCard/f.json');
    assert.deepEqual(
      calls,
      ['', 'PersonCard'],
      'after everything settles a new refresh lists again',
    );
  });

  test('a request that arrives while the follow-up listing is running queues another one', async function (assert) {
    let resolvers: Array<() => void> = [];
    let refresher = new DirectoryViewRefresher(
      (_dir) =>
        new Promise<void>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    let started = () => resolvers.length;
    let untilStarted = async (n: number) => {
      while (started() < n) {
        await new Promise((r) => setTimeout(r, 0));
      }
    };

    let first = refresher.refresh('a.json'); // starts listing 1
    let second = refresher.refresh('b.json'); // queues listing 2
    assert.strictEqual(started(), 1, 'only listing 1 has started');

    resolvers[0]();
    await untilStarted(2); // listing 2 is now running

    // This request arrives while listing 2 runs; listing 2 started before the
    // write behind this request, so it must get listing 3, not share 2.
    let third = refresher.refresh('c.json');
    resolvers[1]();
    await untilStarted(3);
    resolvers[2]();

    await Promise.all([first, second, third]);
    assert.strictEqual(started(), 3, 'the late request got its own listing');
  });

  test('one ancestor failing does not stop the rest of the chain', async function (assert) {
    let listed: string[] = [];
    let refresher = new DirectoryViewRefresher(async (dir) => {
      listed.push(dir);
      if (dir === '') {
        throw new Error('root EIO');
      }
    });

    await assert.rejects(refresher.refresh('a/b/c.json'), /root EIO/);
    assert.deepEqual(
      listed,
      ['', 'a', 'a/b'],
      'the parent directories were still listed after the root failed',
    );
  });

  test('a listing that never settles is timed out and stops blocking later refreshes', async function (assert) {
    let calls = 0;
    let refresher = new DirectoryViewRefresher(
      (_dir) =>
        new Promise<void>((resolve) => {
          calls++;
          if (calls > 1) {
            resolve();
          }
          // the first listing never settles
        }),
      { timeoutMs: 20 },
    );

    await assert.rejects(refresher.refresh('a.json'), /timed out listing ""/);
    await refresher.refresh('b.json');
    assert.strictEqual(calls, 2, 'the second refresh got a fresh listing');
  });

  test('a failed listing rejects that refresh and does not poison later ones', async function (assert) {
    let attempt = 0;
    let refresher = new DirectoryViewRefresher(async () => {
      attempt++;
      if (attempt === 1) {
        throw new Error('EIO');
      }
    });

    await assert.rejects(refresher.refresh('x.json'), /EIO/);
    await refresher.refresh('x.json');
    assert.strictEqual(attempt, 2, 'the second refresh listed again');
  });
});
