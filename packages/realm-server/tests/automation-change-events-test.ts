import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { randomUUID } from 'crypto';
import type { PgAdapter } from '@cardstack/postgres';
import {
  insertRealmEventRoom,
  logger,
  param,
  query,
  ri,
  rri,
  taskAutomationChangeReporter,
  upsertSessionRoom,
  type Realm,
  type RealmAdapter,
  type ReportAutomationChange,
  type VirtualNetwork,
} from '@cardstack/runtime-common';
import {
  pauseAutomation,
  removeAutomation,
  resumeAutomation,
  switchOnAutomation,
  type AutomationActorOptions,
} from '@cardstack/runtime-common/automations';
import type { AutomationDeclaration } from '@cardstack/runtime-common/automation-declaration';
import type {
  AutomationEventContent,
  RealmEventContent,
} from '@cardstack/base/matrix-event';
import type { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import { realmServerAutomationChangeReporter } from '../lib/run-change-reporter.ts';
import {
  ensureTestUser,
  setupPermissionedRealmCached,
  waitUntil,
} from './helpers/index.ts';

// The `automation` realm event: a change to an automation's own row (switch
// on, pause, resume, remove) is reported to the realm, which sends an event
// naming the automation to the session rooms of its direct writers, and to no
// reader and not into the realm's own event room. The realm's adapter sends
// through a client that records each room, so the test sees which rooms the
// event reaches.

const realmURL = new URL(
  'http://127.0.0.1:4444/automation-change-events-test/',
);
const OWNER = '@change-owner:localhost';
const ADMIN = '@change-admin:localhost';
const READER = '@change-reader:localhost';
const REALM_USER = '@node-test_realm:localhost';

const log = logger('automation-change-events-test');

module(basename(import.meta.filename), function (hooks) {
  let realm: Realm;
  let realmAdapter: RealmAdapter;
  let dbAdapter: PgAdapter;
  let virtualNetwork: VirtualNetwork;

  setupPermissionedRealmCached(hooks, {
    realmURL,
    permissions: {
      [OWNER]: ['read', 'write'],
      [ADMIN]: ['read', 'write'],
      [READER]: ['read'],
      [REALM_USER]: ['read', 'write', 'realm-owner'],
    },
    fileSystem: {
      'scripts/nightly.js': `return 'done';\n`,
    },
    onRealmSetup(args) {
      realm = args.testRealm;
      realmAdapter = args.testRealmAdapter;
      dbAdapter = args.dbAdapter;
      virtualNetwork = args.virtualNetwork;
    },
  });

  // Each event the realm handed its adapter, with the recipients it named,
  // and every room the adapter then sent to.
  let delivered: { event: RealmEventContent; recipients?: string[] }[];
  let rooms: string[];
  let restore: (() => void) | undefined;

  hooks.beforeEach(async function () {
    delivered = [];
    rooms = [];
    for (let [user, room] of [
      [OWNER, '!owner:localhost'],
      [ADMIN, '!admin:localhost'],
      [READER, '!reader:localhost'],
    ]) {
      await ensureTestUser(dbAdapter, user);
      await upsertSessionRoom(dbAdapter, user, room);
    }
    await insertRealmEventRoom(dbAdapter, realm.url, '!events:localhost');
    let recording = {
      login: async () => undefined,
      getUserId: () => '@realm_server:localhost',
      isLoggedIn: () => true,
      nextTxnId: () => randomUUID(),
      sendEvent: async (roomId: string) => {
        rooms.push(roomId);
        return '$event';
      },
    } as unknown as MatrixClient;
    let original = realmAdapter.broadcastRealmEvent.bind(realmAdapter);
    realmAdapter.broadcastRealmEvent = (async (
      event,
      realmUrl,
      matrixClient,
      db,
      delivery,
    ) => {
      if (event.eventName !== 'automation') {
        return await original(event, realmUrl, matrixClient, db, delivery);
      }
      delivered.push({ event, recipients: delivery?.recipients });
      return await original(event, realmUrl, recording, db, delivery);
    }) as RealmAdapter['broadcastRealmEvent'];
    restore = () => {
      realmAdapter.broadcastRealmEvent = original;
    };
  });

  hooks.afterEach(function () {
    restore?.();
  });

  function automationId() {
    return rri(`${realm.url}Automation/nightly`);
  }

  function declaration(): AutomationDeclaration {
    return {
      url: automationId(),
      realmURL: realm.url,
      script: rri(`${realm.url}scripts/nightly.js`),
      triggers: [
        {
          kind: 'cron',
          label: 'nightly',
          expression: '0 3 * * *',
          timeZone: 'UTC',
        },
      ],
      operations: [],
      caps: {
        callApiCalls: 10,
        responseBytes: 100_000,
        resolveCalls: 5,
        aiCredits: 10,
        writes: 10,
        seconds: 60,
        dailyCredits: 10,
        monthlyCredits: 100,
      },
      params: {},
      batchedAI: false,
      batchDeadlineMinutes: 60,
    };
  }

  function options(
    reportAutomationChange: ReportAutomationChange,
  ): AutomationActorOptions {
    return {
      matrixServerName: 'localhost',
      virtualNetwork,
      reportAutomationChange,
    };
  }

  // Waits until each of the direct writers' session rooms has received
  // `count` events: the realm's line of events sends them after the
  // adapter has taken them.
  async function sentToWriters(count: number) {
    await waitUntil(
      async () =>
        rooms.filter((r) => r === '!owner:localhost').length >= count &&
        rooms.filter((r) => r === '!admin:localhost').length >= count,
      {
        timeout: 5000,
        interval: 20,
        timeoutMessage: () => `rooms sent to: ${JSON.stringify(rooms)}`,
      },
    );
  }

  // The realm's own reporter, as a route of the realm passes it.
  let fromRealm: ReportAutomationChange = (automation) =>
    realm.reportAutomationChange(automation);

  test("switching on, pausing, resuming and removing an automation each send its realm's direct writers an automation event, and no reader or the realm's room", async function (assert) {
    let id = automationId();
    let realmId = ri(realm.url);
    let switchedOn = await switchOnAutomation(
      dbAdapter,
      {
        automationId: id,
        realm: realmId,
        user: OWNER,
        declaration: declaration(),
      },
      options(fromRealm),
    );
    assert.true(switchedOn.ok, 'switched on');
    let paused = await pauseAutomation(
      dbAdapter,
      { automationId: id, user: OWNER },
      options(fromRealm),
    );
    assert.true(paused.ok, 'paused, with no run to cancel');
    let resumed = await resumeAutomation(
      dbAdapter,
      { automationId: id, user: ADMIN, declaration: declaration() },
      options(fromRealm),
    );
    assert.true(resumed.ok, 'resumed');
    let removed = await removeAutomation(
      dbAdapter,
      { automationId: id, user: OWNER },
      options(fromRealm),
    );
    assert.true(removed.ok, 'removed');

    await sentToWriters(4);
    assert.strictEqual(delivered.length, 4, 'one event for each change');
    for (let { event, recipients } of delivered) {
      assert.deepEqual(
        event,
        { eventName: 'automation', automation: id, realmURL: realm.url },
        'the event names the automation and no person',
      );
      assert.deepEqual(
        [...(recipients ?? [])].sort(),
        [ADMIN, OWNER],
        'it is meant for the direct writers alone',
      );
    }
    assert.deepEqual(
      [...new Set(rooms)].sort(),
      ['!admin:localhost', '!owner:localhost'],
      "only the direct writers' session rooms receive it: not the reader's, not the realm's event room",
    );
  });

  test("a worker's report reaches the realm's direct writers the same way", async function (assert) {
    let sent: AutomationEventContent[] = [];
    let fromWorker = taskAutomationChangeReporter({
      virtualNetwork,
      log,
      // The worker hands the event to the realm server, which broadcasts it
      // as the realm's own (`Realm.broadcastEvent`).
      reportRealmEvent: (event) => {
        sent.push(event);
        void realm.broadcastEvent(event);
      },
    })!;
    await switchOnAutomation(
      dbAdapter,
      {
        automationId: automationId(),
        realm: ri(realm.url),
        user: OWNER,
        declaration: declaration(),
      },
      options(fromWorker),
    );
    assert.deepEqual(sent, [
      {
        eventName: 'automation',
        automation: automationId(),
        realmURL: realm.url,
      },
    ]);
    await sentToWriters(1);
    assert.deepEqual([...new Set(rooms)].sort(), [
      '!admin:localhost',
      '!owner:localhost',
    ]);
  });

  test("a route that serves no one realm, such as archiving, finds the automation's realm and reaches its direct writers", async function (assert) {
    let asked: string[] = [];
    let report = realmServerAutomationChangeReporter({
      virtualNetwork,
      reconciler: {
        lookupOrMount: async (url: string) => {
          asked.push(url);
          return url === realm.url ? realm : undefined;
        },
      } as any,
    });
    await report({ automationId: automationId(), realm: ri(realm.url) });
    assert.deepEqual(asked, [realm.url], "the automation's realm is looked up");
    await sentToWriters(1);
    assert.deepEqual(
      delivered.map(({ event }) => event),
      [
        {
          eventName: 'automation',
          automation: automationId(),
          realmURL: realm.url,
        },
      ],
    );
    assert.deepEqual([...new Set(rooms)].sort(), [
      '!admin:localhost',
      '!owner:localhost',
    ]);
  });

  test('a realm with no direct writer sends an automation event to no one', async function (assert) {
    await query(dbAdapter, [
      'UPDATE realm_user_permissions SET write = false WHERE realm_url =',
      param(realm.url),
      'AND username IN (',
      param(OWNER),
      ',',
      param(ADMIN),
      ')',
    ]);
    await realm.broadcastEvent({
      eventName: 'automation',
      automation: automationId(),
      realmURL: realm.url,
    });
    assert.deepEqual(delivered, [], 'nothing is handed to the adapter');
    assert.deepEqual(rooms, [], 'and no room receives it');
  });
});
