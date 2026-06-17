import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { PgAdapter } from '@cardstack/postgres';
import type { Realm } from '@cardstack/runtime-common';
import { setupDB } from './helpers/index.ts';
import { RealmIndexUpdatedListener } from '../lib/realm-index-updated-listener.ts';

// Minimal fake `Realm` — the listener only calls `.url` (via lookup) and
// `.clearRealmIndexCaches()`, so that's all we need to stub.
function makeFakeRealm(url: string, onClear: () => void): Realm {
  return {
    url,
    clearRealmIndexCaches() {
      onClear();
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

module(basename(import.meta.filename), function () {
  module('RealmIndexUpdatedListener (dispatch)', function () {
    test('handleNotification forwards to the mounted realm', function (assert) {
      let cleared = 0;
      const realmA = makeFakeRealm('http://x.test/a/', () => {
        cleared++;
      });
      const listener = new RealmIndexUpdatedListener({
        dbAdapter: {} as unknown as PgAdapter,
        lookupMountedRealm: (url) =>
          url === 'http://x.test/a/' ? realmA : undefined,
      });

      listener.handleNotification('http://x.test/a/');

      assert.strictEqual(
        cleared,
        1,
        'clearRealmIndexCaches called exactly once for the mounted realm',
      );
    });

    test('handleNotification drops silently when the realm is not mounted', function (assert) {
      const listener = new RealmIndexUpdatedListener({
        dbAdapter: {} as unknown as PgAdapter,
        lookupMountedRealm: () => undefined,
      });

      listener.handleNotification('http://x.test/unmounted/');

      assert.ok(true, 'unmounted-realm payload did not throw');
    });

    test('handleNotification ignores an undefined payload', function (assert) {
      const listener = new RealmIndexUpdatedListener({
        dbAdapter: {} as unknown as PgAdapter,
        lookupMountedRealm: () => {
          throw new Error('should not be called for empty payloads');
        },
      });

      listener.handleNotification(undefined);
      assert.ok(true, 'undefined payload did not throw');
    });

    test('handleNotification ignores an empty payload', function (assert) {
      const listener = new RealmIndexUpdatedListener({
        dbAdapter: {} as unknown as PgAdapter,
        lookupMountedRealm: () => {
          throw new Error('should not be called for empty payloads');
        },
      });

      listener.handleNotification('');
      listener.handleNotification('   ');
      assert.ok(true, 'empty / whitespace-only payload did not throw');
    });
  });

  module('RealmIndexUpdatedListener (LISTEN end-to-end)', function (hooks) {
    let dbAdapter: PgAdapter;

    setupDB(hooks, {
      beforeEach: async (adapter) => {
        dbAdapter = adapter;
      },
    });

    test('NOTIFY realm_index_updated → listener → clearRealmIndexCaches', async function (assert) {
      let cleared = 0;
      const realmUrl = 'http://x.test/listen-e2e/';
      const realmA = makeFakeRealm(realmUrl, () => {
        cleared++;
      });
      const listener = new RealmIndexUpdatedListener({
        dbAdapter,
        lookupMountedRealm: (url) => (url === realmUrl ? realmA : undefined),
      });
      await listener.start();
      try {
        await dbAdapter.notify('realm_index_updated', realmUrl);

        await waitFor(() => (cleared > 0 ? cleared : undefined));
        assert.strictEqual(
          cleared,
          1,
          'clearRealmIndexCaches fired exactly once for the mounted realm',
        );
      } finally {
        await listener.shutDown();
      }
    });

    test('NOTIFY for an unmounted realm is dropped silently', async function (assert) {
      const lookups: string[] = [];
      const listener = new RealmIndexUpdatedListener({
        dbAdapter,
        lookupMountedRealm: (url) => {
          lookups.push(url);
          return undefined;
        },
      });
      await listener.start();
      try {
        await dbAdapter.notify(
          'realm_index_updated',
          'http://x.test/not-mounted/',
        );

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
