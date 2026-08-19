import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { PgAdapter } from '@cardstack/postgres';
import { notifyAllFileChanges, type Realm } from '@cardstack/runtime-common';
import { setupDB } from './helpers/index.ts';
import {
  RealmFileChangesListener,
  parsePayload,
} from '../lib/realm-file-changes-listener.ts';

// Minimal fake `Realm` — the listener calls `.url` (via lookup),
// `.invalidateCache(path)` for per-path payloads, and `.clearLocalSourceCaches()`
// for wildcard payloads (CS-11156). Stub both; tests pick whichever they
// care about.
function makeFakeRealm(
  url: string,
  hooks: {
    onInvalidate?: (path: string) => void;
    onClearAll?: () => void;
  },
): Realm {
  return {
    url,
    invalidateCache(path: string) {
      hooks.onInvalidate?.(path);
    },
    clearLocalSourceCaches() {
      hooks.onClearAll?.();
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
  module('parsePayload', function () {
    test('parses url:path with a port in the url', function (assert) {
      assert.deepEqual(
        parsePayload('http://localhost:4201/luke/src/:cards/person.gts'),
        { url: 'http://localhost:4201/luke/src/', path: 'cards/person.gts' },
      );
    });

    test('parses url:path without a port in the url', function (assert) {
      assert.deepEqual(parsePayload('@cardstack/base/:card-api.gts'), {
        url: '@cardstack/base/',
        path: 'card-api.gts',
      });
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

    test('parses a wildcard payload (bulk invalidation, CS-11156)', function (assert) {
      assert.deepEqual(parsePayload('http://x.test/r/:*'), {
        url: 'http://x.test/r/',
        path: '*',
      });
    });

    test('parses a wildcard payload against a url with a port (CS-11156)', function (assert) {
      assert.deepEqual(parsePayload('http://localhost:4201/luke/src/:*'), {
        url: 'http://localhost:4201/luke/src/',
        path: '*',
      });
    });
  });

  module('RealmFileChangesListener (dispatch)', function () {
    test('handleNotification forwards to the mounted realm', function (assert) {
      const invalidations: Array<{ url: string; path: string }> = [];
      const realmA = makeFakeRealm('http://x.test/a/', {
        onInvalidate: (path) =>
          invalidations.push({ url: 'http://x.test/a/', path }),
      });
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

    test('handleNotification with wildcard payload calls clearLocalSourceCaches and not invalidateCache (CS-11156)', function (assert) {
      const invalidations: string[] = [];
      const clearAllCount = { value: 0 };
      const realmA = makeFakeRealm('http://x.test/a/', {
        onInvalidate: (path) => invalidations.push(path),
        onClearAll: () => clearAllCount.value++,
      });
      const listener = new RealmFileChangesListener({
        dbAdapter: {} as unknown as PgAdapter,
        lookupMountedRealm: (url) =>
          url === 'http://x.test/a/' ? realmA : undefined,
      });

      listener.handleNotification('http://x.test/a/:*');

      assert.strictEqual(
        clearAllCount.value,
        1,
        'clearLocalSourceCaches called exactly once',
      );
      assert.deepEqual(
        invalidations,
        [],
        'invalidateCache not called for wildcard payload',
      );
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
      const realmA = makeFakeRealm(realmUrl, {
        onInvalidate: (path) => invalidations.push({ url: realmUrl, path }),
      });
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

    test('notifyAllFileChanges round-trip: emitter → NOTIFY → listener → clearLocalSourceCaches (CS-11156)', async function (assert) {
      // Models the cross-replica case: the emitter is what the publish /
      // unpublish / delete realm handlers call after the FS swap; the
      // listener is a peer replica's subscription. End-to-end through the
      // shared Postgres NOTIFY channel.
      const clearAllCount = { value: 0 };
      const realmUrl = 'http://x.test/listen-e2e-bulk-emit/';
      const realmA = makeFakeRealm(realmUrl, {
        onClearAll: () => clearAllCount.value++,
      });
      const listener = new RealmFileChangesListener({
        dbAdapter,
        lookupMountedRealm: (url) => (url === realmUrl ? realmA : undefined),
      });
      await listener.start();
      try {
        await notifyAllFileChanges(dbAdapter, realmUrl);

        await waitFor(() =>
          clearAllCount.value > 0 ? clearAllCount.value : undefined,
        );
        assert.strictEqual(
          clearAllCount.value,
          1,
          'peer-side clearLocalSourceCaches called once after the bulk emit',
        );
      } finally {
        await listener.shutDown();
      }
    });

    test('NOTIFY realm_file_changes wildcard → listener → clearLocalSourceCaches (CS-11156)', async function (assert) {
      const invalidations: string[] = [];
      const clearAllCount = { value: 0 };
      const realmUrl = 'http://x.test/listen-e2e-bulk/';
      const realmA = makeFakeRealm(realmUrl, {
        onInvalidate: (path) => invalidations.push(path),
        onClearAll: () => clearAllCount.value++,
      });
      const listener = new RealmFileChangesListener({
        dbAdapter,
        lookupMountedRealm: (url) => (url === realmUrl ? realmA : undefined),
      });
      await listener.start();
      try {
        await dbAdapter.notify('realm_file_changes', `${realmUrl}:*`);

        await waitFor(() =>
          clearAllCount.value > 0 ? clearAllCount.value : undefined,
        );
        assert.strictEqual(
          clearAllCount.value,
          1,
          'clearLocalSourceCaches called exactly once',
        );
        assert.deepEqual(
          invalidations,
          [],
          'invalidateCache not called for wildcard',
        );
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
