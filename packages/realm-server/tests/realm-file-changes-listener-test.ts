import { module, test } from 'qunit';
import { basename } from 'path';
import type { PgAdapter } from '@cardstack/postgres';
import type { Realm } from '@cardstack/runtime-common';
import { setupDB } from './helpers';
import {
  RealmFileChangesListener,
  parsePayload,
} from '../lib/realm-file-changes-listener';

// Minimal fake `Realm` — the listener calls `.url` (via lookup),
// `.invalidateCache(path)`, and (for `.realm.json` / `realm.json` paths)
// `.invalidateCachedRealmInfo()`. Stub all three.
function makeFakeRealm(
  url: string,
  onInvalidate: (path: string) => void,
  onInvalidateRealmInfo?: () => void,
): Realm {
  return {
    url,
    invalidateCache(path: string) {
      onInvalidate(path);
    },
    invalidateCachedRealmInfo() {
      onInvalidateRealmInfo?.();
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

    test('handleNotification invalidates cachedRealmInfo when path is .realm.json (CS-11127)', function (assert) {
      const realmInfoInvalidations: string[] = [];
      const byteCacheInvalidations: string[] = [];
      const url = 'http://x.test/a/';
      const realmA = makeFakeRealm(
        url,
        (path) => byteCacheInvalidations.push(path),
        () => realmInfoInvalidations.push(url),
      );
      const listener = new RealmFileChangesListener({
        dbAdapter: {} as unknown as PgAdapter,
        lookupMountedRealm: (u) => (u === url ? realmA : undefined),
      });

      listener.handleNotification(`${url}:.realm.json`);

      assert.deepEqual(
        byteCacheInvalidations,
        ['.realm.json'],
        'byte caches are still invalidated alongside realmInfo',
      );
      assert.deepEqual(
        realmInfoInvalidations,
        [url],
        'cachedRealmInfo invalidated for the .realm.json path',
      );
    });

    test('handleNotification invalidates cachedRealmInfo when path is realm.json (alternate name)', function (assert) {
      const realmInfoInvalidations: string[] = [];
      const url = 'http://x.test/a/';
      const realmA = makeFakeRealm(
        url,
        () => {},
        () => realmInfoInvalidations.push(url),
      );
      const listener = new RealmFileChangesListener({
        dbAdapter: {} as unknown as PgAdapter,
        lookupMountedRealm: (u) => (u === url ? realmA : undefined),
      });

      listener.handleNotification(`${url}:realm.json`);

      assert.deepEqual(realmInfoInvalidations, [url]);
    });

    test('handleNotification does NOT invalidate cachedRealmInfo for non-config paths', function (assert) {
      const realmInfoInvalidations: string[] = [];
      const byteCacheInvalidations: string[] = [];
      const url = 'http://x.test/a/';
      const realmA = makeFakeRealm(
        url,
        (path) => byteCacheInvalidations.push(path),
        () => realmInfoInvalidations.push(url),
      );
      const listener = new RealmFileChangesListener({
        dbAdapter: {} as unknown as PgAdapter,
        lookupMountedRealm: (u) => (u === url ? realmA : undefined),
      });

      // A nested path that happens to end in `.realm.json` must not trigger
      // realmInfo invalidation — only the realm-root config file does.
      listener.handleNotification(`${url}:cards/foo.gts`);
      listener.handleNotification(`${url}:nested/.realm.json`);

      assert.deepEqual(byteCacheInvalidations, [
        'cards/foo.gts',
        'nested/.realm.json',
      ]);
      assert.deepEqual(realmInfoInvalidations, []);
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
        await dbAdapter.notify(
          'realm_file_changes',
          `${realmUrl}:src/greeting.gts`,
        );

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
        await dbAdapter.notify(
          'realm_file_changes',
          `http://x.test/not-mounted/:file.gts`,
        );

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
