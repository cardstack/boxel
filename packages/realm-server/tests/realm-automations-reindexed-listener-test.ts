import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { PgAdapter } from '@cardstack/postgres';
import type { Realm } from '@cardstack/runtime-common';
import { RealmAutomationsReindexedListener } from '../lib/realm-automations-reindexed-listener.ts';

// The listener only reads `.url` (through the lookup) and calls
// `.followAutomationKeyApprovalsAfterFromScratchPass()`.
function makeFakeRealm(url: string, onFollow: () => Promise<void>): Realm {
  return {
    url,
    followAutomationKeyApprovalsAfterFromScratchPass: onFollow,
  } as unknown as Realm;
}

module(basename(import.meta.filename), function () {
  test('a notification has the mounted realm it names follow its automations’ key approvals', async function (assert) {
    let followed: string[] = [];
    let realms = ['http://x.test/a/', 'http://x.test/b/'].map((url) =>
      makeFakeRealm(url, async () => {
        followed.push(url);
      }),
    );
    let listener = new RealmAutomationsReindexedListener({
      dbAdapter: {} as unknown as PgAdapter,
      lookupMountedRealm: (url) => realms.find((realm) => realm.url === url),
    });

    await listener.handleNotification('http://x.test/b/');

    assert.deepEqual(followed, ['http://x.test/b/']);
  });

  test('a notification naming a realm not mounted here, or naming none, follows nothing', async function (assert) {
    let followed = 0;
    let realm = makeFakeRealm('http://x.test/a/', async () => {
      followed++;
    });
    let listener = new RealmAutomationsReindexedListener({
      dbAdapter: {} as unknown as PgAdapter,
      lookupMountedRealm: (url) => (url === realm.url ? realm : undefined),
    });

    await listener.handleNotification('http://x.test/elsewhere/');
    await listener.handleNotification('');
    await listener.handleNotification(undefined);

    assert.strictEqual(followed, 0);
  });

  test('a lookup that throws is logged, and the notification settles', async function (assert) {
    let listener = new RealmAutomationsReindexedListener({
      dbAdapter: {} as unknown as PgAdapter,
      lookupMountedRealm: () => {
        throw new Error('lookup failed');
      },
    });

    await listener.handleNotification('http://x.test/a/');

    assert.ok(true, 'the notification settled');
  });
});
