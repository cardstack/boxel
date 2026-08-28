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
    let rootCoalesced = count('') < names.length;
    let dirCoalesced = count('PersonCard') < names.length;
    assert.true(
      rootCoalesced,
      `root listed fewer times than refreshes (${count('')})`,
    );
    assert.true(
      dirCoalesced,
      `PersonCard listed fewer times than refreshes (${count('PersonCard')})`,
    );
    let followUpRan = count('') >= 2;
    assert.true(
      followUpRan,
      'a refresh that arrived mid-listing got a follow-up listing',
    );

    calls.length = 0;
    await refresher.refresh('PersonCard/f.json');
    assert.deepEqual(
      calls,
      ['', 'PersonCard'],
      'after everything settles a new refresh lists again',
    );
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
