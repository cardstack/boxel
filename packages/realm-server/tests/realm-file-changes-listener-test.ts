import { module, test } from 'qunit';
import { basename } from 'path';
import type { PgAdapter } from '@cardstack/postgres';
import type { Realm } from '@cardstack/runtime-common';
import { query, param } from '@cardstack/runtime-common';
import { setupDB } from './helpers';
import {
  RealmFileChangesListener,
  parsePayload,
} from '../lib/realm-file-changes-listener';

// Minimal fake `Realm` — the listener only calls `.url` (via lookup) and
// `.invalidateCache(path)`, so that's all we need to stub.
function makeFakeRealm(
  url: string,
  onInvalidate: (path: string) => void,
): Realm {
  return {
    url,
    invalidateCache(path: string) {
      onInvalidate(path);
    },
  } as unknown as Realm;
}

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

module(basename(__filename), function () {
  module('parsePayload', function () {
    test('parses url:path with a port in the url', function (assert) {
      assert.deepEqual(
        parsePayload('http://localhost:4201/luke/src/:cards/person.gts'),
        { url: 'http://localhost:4201/luke/src/', path: 'cards/person.gts' },
      );
    });

    test('parses url:path without a port in the url', function (assert) {
      assert.deepEqual(
        parsePayload('https://cardstack.com/base/:card-api.gts'),
        {
          url: 'https://cardstack.com/base/',
          path: 'card-api.gts',
        },
      );
    });

    test('parses a nested path', function (assert) {
      assert.deepEqual(
        parsePayload('http://x.test/r/:a/b/c/deeply-nested.json'),
        { url: 'http://x.test/r/', path: 'a/b/c/deeply-nested.json' },
      );
    });

    test('returns undefined for a malformed payload missing the `/:` boundary', function (assert) {
      assert.strictEqual(parsePayload('garbage-no-separator'), undefined);
    });

    test('returns undefined when the path is empty', function (assert) {
      assert.strictEqual(parsePayload('http://x/:'), undefined);
    });
  });

  module('RealmFileChangesListener (dispatch)', function () {
    test('handleNotification forwards to the mounted realm', function (assert) {
      const invalidations: Array<{ url: string; path: string }> = [];
      const realmA = makeFakeRealm('http://x.test/a/', (path) =>
        invalidations.push({ url: 'http://x.test/a/', path }),
      );
      const listener = new RealmFileChangesListener({
        dbAdapter: {} as unknown as PgAdapter,
        lookupMountedRealm: (url) =>
          url === 'http://x.test/a/' ? realmA : undefined,
      });

      listener.handleNotification('http://x.test/a/:cards/foo.gts');

      assert.deepEqual(invalidations, [
        { url: 'http://x.test/a/', path: 'cards/foo.gts' },
      ]);
    });

    test('handleNotification drops silently when the url is not mounted', function (assert) {
      const invalidations: string[] = [];
      const listener = new RealmFileChangesListener({
        dbAdapter: {} as unknown as PgAdapter,
        lookupMountedRealm: () => undefined,
      });

      listener.handleNotification('http://x.test/unmounted/:file.gts');

      assert.deepEqual(
        invalidations,
        [],
        'no invalidations attempted for unmounted url',
      );
    });

    test('handleNotification ignores a malformed payload without throwing', function (assert) {
      const listener = new RealmFileChangesListener({
        dbAdapter: {} as unknown as PgAdapter,
        lookupMountedRealm: () => {
          throw new Error('should not be called for malformed payloads');
        },
      });

      // Must not throw. Behavior: warn and return.
      listener.handleNotification('not a valid payload');
      assert.ok(true, 'malformed payload did not throw');
    });

    test('handleNotification ignores an empty payload', function (assert) {
      const listener = new RealmFileChangesListener({
        dbAdapter: {} as unknown as PgAdapter,
        lookupMountedRealm: () => {
          throw new Error('should not be called for empty payloads');
        },
      });

      listener.handleNotification(undefined);
      listener.handleNotification('');
      assert.ok(true, 'empty payload did not throw');
    });
  });

  module('RealmFileChangesListener (LISTEN end-to-end)', function (hooks) {
    let dbAdapter: PgAdapter;

    setupDB(hooks, {
      beforeEach: async (adapter) => {
        dbAdapter = adapter;
      },
    });

    test('NOTIFY realm_file_changes → listener → invalidateCache', async function (assert) {
      const invalidations: Array<{ url: string; path: string }> = [];
      const realmUrl = 'http://x.test/listen-e2e/';
      const realmA = makeFakeRealm(realmUrl, (path) =>
        invalidations.push({ url: realmUrl, path }),
      );
      const listener = new RealmFileChangesListener({
        dbAdapter,
        lookupMountedRealm: (url) => (url === realmUrl ? realmA : undefined),
      });
      await listener.start();
      try {
        await query(dbAdapter, [
          `SELECT pg_notify(`,
          param('realm_file_changes'),
          `,`,
          param(`${realmUrl}:src/greeting.gts`),
          `)`,
        ]);

        const received = await waitFor(() =>
          invalidations.length > 0 ? invalidations : undefined,
        );
        assert.deepEqual(received, [
          { url: realmUrl, path: 'src/greeting.gts' },
        ]);
      } finally {
        await listener.shutDown();
      }
    });

    test('NOTIFY for an unmounted realm is dropped silently', async function (assert) {
      const lookups: string[] = [];
      const listener = new RealmFileChangesListener({
        dbAdapter,
        lookupMountedRealm: (url) => {
          lookups.push(url);
          return undefined;
        },
      });
      await listener.start();
      try {
        await query(dbAdapter, [
          `SELECT pg_notify(`,
          param('realm_file_changes'),
          `,`,
          param(`http://x.test/not-mounted/:file.gts`),
          `)`,
        ]);

        // Wait for the lookup to be recorded (proves the NOTIFY was received
        // and dispatched; the lookup miss then silently drops).
        const seen = await waitFor(() =>
          lookups.length > 0 ? lookups : undefined,
        );
        assert.deepEqual(seen, ['http://x.test/not-mounted/']);
      } finally {
        await listener.shutDown();
      }
    });
  });
});
