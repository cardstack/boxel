import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { PgAdapter } from '@cardstack/postgres';
import {
  notifyRealmAutomationsTouched,
  REALM_AUTOMATIONS_TOUCHED_CHANNEL,
  type DBAdapter,
  type Realm,
} from '@cardstack/runtime-common';
import { RealmAutomationsReindexedListener } from '../lib/realm-automations-reindexed-listener.ts';

// The listener only reads `.url` (through the lookup) and calls
// `.followAutomationKeyApprovalsAfterFromScratchPass()` or
// `.followAutomationKeyApprovalsAfterWorkerPass()`.
function makeFakeRealm(
  url: string,
  onFollow: () => Promise<void>,
  onWorkerPassFollow?: (
    automationIds: readonly string[],
    opts: { reportChanges: boolean },
  ) => Promise<void>,
): Realm {
  return {
    url,
    followAutomationKeyApprovalsAfterFromScratchPass: onFollow,
    followAutomationKeyApprovalsAfterWorkerPass:
      onWorkerPassFollow ?? (async () => {}),
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

  test("a worker's incremental pass notification has the mounted realm it names follow the automations it names", async function (assert) {
    let followed: {
      url: string;
      automationIds: readonly string[];
      reportChanges: boolean;
    }[] = [];
    let realms = ['http://x.test/a/', 'http://x.test/b/'].map((url) =>
      makeFakeRealm(
        url,
        async () => {},
        async (automationIds, { reportChanges }) => {
          followed.push({ url, automationIds, reportChanges });
        },
      ),
    );
    let listener = new RealmAutomationsReindexedListener({
      dbAdapter: {} as unknown as PgAdapter,
      lookupMountedRealm: (url) => realms.find((realm) => realm.url === url),
    });

    await listener.handleTouchedNotification(
      JSON.stringify({
        realmURL: 'http://x.test/b/',
        automationIds: ['@x/b/one', '@x/b/two'],
        reportChanges: false,
      }),
    );
    await listener.handleTouchedNotification(
      JSON.stringify({
        realmURL: 'http://x.test/a/',
        automationIds: ['@x/a/one'],
      }),
    );

    assert.deepEqual(followed, [
      {
        url: 'http://x.test/b/',
        automationIds: ['@x/b/one', '@x/b/two'],
        reportChanges: false,
      },
      {
        url: 'http://x.test/a/',
        automationIds: ['@x/a/one'],
        reportChanges: true,
      },
    ]);
  });

  test("a malformed worker's incremental pass notification, or one naming a realm not mounted here, follows nothing", async function (assert) {
    let followed = 0;
    let realm = makeFakeRealm(
      'http://x.test/a/',
      async () => {},
      async () => {
        followed++;
      },
    );
    let listener = new RealmAutomationsReindexedListener({
      dbAdapter: {} as unknown as PgAdapter,
      lookupMountedRealm: (url) => (url === realm.url ? realm : undefined),
    });

    for (let payload of [
      undefined,
      '',
      'http://x.test/a/',
      '{"realmURL":"http://x.test/a/"}',
      '{"realmURL":"http://x.test/a/","automationIds":[1]}',
      '{"automationIds":["@x/a/one"]}',
      JSON.stringify({
        realmURL: 'http://x.test/elsewhere/',
        automationIds: ['@x/elsewhere/one'],
      }),
    ]) {
      await listener.handleTouchedNotification(payload);
    }

    assert.strictEqual(followed, 0);
  });

  test("a worker's incremental pass that touched more automations than one notification holds is announced over several, each under Postgres's payload cap", async function (assert) {
    let sent: { channel: string; payload: string }[] = [];
    let dbAdapter = {
      notify: async (channel: string, payload: string) => {
        sent.push({ channel, payload });
      },
    } as unknown as DBAdapter;
    let automationIds = Array.from(
      { length: 500 },
      (_, i) => `@cardstack/some-realm/automations/automation-${i}`,
    );

    await notifyRealmAutomationsTouched(dbAdapter, {
      realmURL: 'http://x.test/a/',
      automationIds,
      reportChanges: true,
    });

    assert.true(sent.length > 1, 'it takes several notifications');
    assert.true(
      sent.every(
        ({ channel, payload }) =>
          channel === REALM_AUTOMATIONS_TOUCHED_CHANNEL &&
          new TextEncoder().encode(payload).byteLength < 8000,
      ),
      'each fits under the cap',
    );
    let parsed = sent.map(({ payload }) => JSON.parse(payload));
    assert.deepEqual(
      parsed.flatMap((p) => p.automationIds),
      automationIds,
      'together they name every automation, once',
    );
    assert.true(
      parsed.every(
        (p) => p.realmURL === 'http://x.test/a/' && p.reportChanges === true,
      ),
    );
  });
});
