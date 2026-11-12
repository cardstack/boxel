import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { SuperTest, Test } from 'supertest';
import type { PgAdapter } from '@cardstack/postgres';
import {
  insertPermissions,
  internalKeyFor,
  param,
  query,
  ri,
  rri,
  SupportedMimeType,
  type DBAdapter,
  type Realm,
} from '@cardstack/runtime-common';
import {
  automationRef,
  readAutomationDeclaration,
  type AutomationDeclaration,
} from '@cardstack/runtime-common/automation-declaration';
import { zonedDateTimeToUnixSeconds } from '@cardstack/runtime-common/automation-schedule';
import type { AutomationStatusDocument } from '@cardstack/runtime-common/automation-status';
import {
  pauseAutomation,
  switchOnAutomation,
  type AutomationActorOptions,
} from '@cardstack/runtime-common/automations';
import type { RealmHttpServer as Server } from '../server.ts';
import {
  closeServer,
  createJWT,
  createVirtualNetwork,
  insertUser,
  setupPermissionedRealmCached,
} from './helpers/index.ts';
import { setupCatalogTestSubset } from './helpers/catalog-test-subset.ts';

const PAYER = '@payer:localhost';
const ADMIN = '@admin:localhost';
const READER = '@reader:localhost';
const STRANGER = '@stranger:localhost';
const ELSEWHERE = 'http://127.0.0.1:4445/elsewhere/';

// 2026-11-10 12:00 in Chicago, when the automation is switched on.
const NOW = zonedDateTimeToUnixSeconds('2026-11-10T12:00', 'America/Chicago');

function trigger(kind: string, extra: Record<string, unknown> = {}) {
  return {
    kind,
    label: null,
    expression: null,
    timeZone: 'America/Chicago',
    untilDate: null,
    untilTime: null,
    count: null,
    date: null,
    time: null,
    webhookPath: null,
    ...extra,
  };
}

const attributes = {
  cardInfo: { name: 'Nightly import' },
  triggers: [
    // Daily at 02:30 through Dec 31: 51 runs by date, so its count of 30
    // ends it first.
    trigger('cron', {
      label: 'nightly',
      expression: '30 2 * * *',
      untilDate: '2026-12-31',
      count: 30,
    }),
    trigger('cron', { label: 'hourly', expression: '0 * * * *' }),
    trigger('once', { label: 'launch', date: '2026-11-20', time: '15:00' }),
    trigger('webhook', {
      label: 'push',
      timeZone: null,
      webhookPath: 'github-push',
    }),
  ],
  operations: [],
  caps: {
    callApiCalls: 0,
    responseBytes: 0,
    resolveCalls: 0,
    writes: 5,
    seconds: 300,
    dailyCredits: 50,
    monthlyCredits: 500,
  },
  params: [],
  batchedAI: false,
  batchDeadlineMinutes: null,
};

// The route a card's view reads its automation's server state from.
module(basename(import.meta.filename), function (hooks) {
  let testRealm: Realm;
  let testRealmHttpServer: Server;
  let request: SuperTest<Test>;
  let dbAdapter: DBAdapter;

  setupCatalogTestSubset(hooks);

  module('a realm with direct writers and a reader', function (hooks) {
    hooks.afterEach(async function () {
      await closeServer(testRealmHttpServer);
    });

    setupPermissionedRealmCached(hooks, {
      fixture: 'blank',
      permissions: {
        [PAYER]: ['read', 'write'],
        '@node-test_realm:localhost': ['read', 'realm-owner'],
        [ADMIN]: ['read', 'write'],
        [READER]: ['read'],
      },
      onRealmSetup(args) {
        testRealm = args.testRealm;
        testRealmHttpServer = args.testRealmHttpServer;
        request = args.request;
        dbAdapter = args.dbAdapter;
      },
    });

    function automationURL() {
      return `${testRealm.url}automations/nightly`;
    }

    function options(): AutomationActorOptions {
      return {
        matrixServerName: 'localhost',
        virtualNetwork: createVirtualNetwork(),
        now: NOW,
      };
    }

    async function writeAutomation() {
      await testRealm.write(
        'scripts/nightly-import.js',
        "await realm.fs.writeText('imported.txt', 'done');\n",
      );
      await testRealm.write(
        'automations/nightly.json',
        JSON.stringify({
          data: {
            type: 'card',
            attributes,
            relationships: {
              script: { links: { self: '../scripts/nightly-import.js' } },
            },
            meta: { adoptsFrom: automationRef },
          },
        }),
      );
    }

    async function indexedDeclaration(): Promise<AutomationDeclaration> {
      let entry = await testRealm.realmIndexQueryEngine.instance(
        new URL(automationURL()),
      );
      if (entry?.type !== 'instance') {
        throw new Error(
          `the automation card is not indexed: ${JSON.stringify(entry)}`,
        );
      }
      let virtualNetwork = createVirtualNetwork();
      let result = readAutomationDeclaration(
        {
          // The card's id, which switch-on compares with the automation's id;
          // the index row names the file.
          url: automationURL(),
          realmURL: entry.realmURL,
          types: entry.types,
          instance: entry.instance,
        },
        {
          automationTypeKey: internalKeyFor(
            automationRef,
            undefined,
            virtualNetwork,
          ),
          virtualNetwork,
        },
      );
      if (!result.ok) {
        throw new Error(
          `the declaration did not read: ${JSON.stringify(result.problems)}`,
        );
      }
      return result.declaration;
    }

    async function switchOn(user = PAYER) {
      let result = await switchOnAutomation(
        dbAdapter,
        {
          automationId: rri(automationURL()),
          realm: ri(testRealm.url),
          user,
          declaration: await indexedDeclaration(),
        },
        options(),
      );
      if (!result.ok) {
        throw new Error(`expected switch-on, got ${result.reason}`);
      }
    }

    async function setRuns(label: string, runs: number) {
      await query(dbAdapter, [
        `UPDATE automations SET trigger_runs = jsonb_set(trigger_runs, ARRAY[`,
        param(label),
        `], jsonb_build_object('runs',`,
        param(runs),
        `::int)) WHERE automation_id =`,
        param(automationURL()),
      ]);
    }

    function statusOf(
      user: string,
      permissions: ('read' | 'write' | 'realm-owner')[],
      automation: string | null = automationURL(),
    ) {
      let path = automation
        ? `/_automation-status?automation=${encodeURIComponent(automation)}`
        : '/_automation-status';
      return request
        .get(path)
        .set('Accept', SupportedMimeType.JSON)
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, user, permissions)}`,
        );
    }

    function attributesOf(body: AutomationStatusDocument) {
      return body.data.attributes;
    }

    test('an automation that is not switched on reads as off', async function (assert) {
      await writeAutomation();
      let response = await statusOf(ADMIN, ['read', 'write']);
      assert.strictEqual(response.status, 200, 'HTTP 200');
      assert.strictEqual(response.headers['cache-control'], 'no-store');
      assert.deepEqual(response.body, {
        data: {
          type: 'automation-status',
          id: automationURL(),
          attributes: { switchedOn: false },
        },
      });
    });

    test("a switched-on automation reads with its payer, state and each trigger's runs left", async function (assert) {
      await writeAutomation();
      await switchOn();
      await setRuns('nightly', 4);
      await setRuns('hourly', 12);

      let response = await statusOf(PAYER, ['read', 'write']);
      assert.strictEqual(response.status, 200, 'HTTP 200');
      let status = attributesOf(response.body);
      if (!status.switchedOn) {
        throw new Error('expected a switched-on automation');
      }
      assert.strictEqual(status.state, 'active');
      assert.strictEqual(status.pauseReason, null);
      assert.strictEqual(status.payer, PAYER);
      assert.true(status.viewerIsPayer);
      assert.strictEqual(
        status.nextRun,
        new Date(
          zonedDateTimeToUnixSeconds('2026-11-10T13:00', 'America/Chicago') *
            1000,
        ).toISOString(),
        'the earliest next run is the next hourly one',
      );
      assert.deepEqual(
        status.triggers,
        [
          {
            label: 'nightly',
            runs: 4,
            runsLeft: 26,
            until: new Date(
              zonedDateTimeToUnixSeconds(
                '2026-12-31T23:59',
                'America/Chicago',
              ) * 1000,
            ).toISOString(),
            nextRun: new Date(
              zonedDateTimeToUnixSeconds(
                '2026-11-11T02:30',
                'America/Chicago',
              ) * 1000,
            ).toISOString(),
            spent: false,
          },
          {
            label: 'hourly',
            runs: 12,
            nextRun: new Date(
              zonedDateTimeToUnixSeconds(
                '2026-11-10T13:00',
                'America/Chicago',
              ) * 1000,
            ).toISOString(),
            spent: false,
          },
          {
            label: 'launch',
            runs: 0,
            runsLeft: 1,
            until: new Date(
              zonedDateTimeToUnixSeconds(
                '2026-11-20T15:00',
                'America/Chicago',
              ) * 1000,
            ).toISOString(),
            nextRun: new Date(
              zonedDateTimeToUnixSeconds(
                '2026-11-20T15:00',
                'America/Chicago',
              ) * 1000,
            ).toISOString(),
            spent: false,
          },
          { label: 'push', runs: 0, spent: false },
        ],
        'a bounded trigger has runs left, its end and its next run; an unbounded one has no runs left',
      );
    });

    test('a paused, waiting or done automation reads with that state', async function (assert) {
      await writeAutomation();
      await switchOn();
      let paused = await pauseAutomation(
        dbAdapter,
        { automationId: rri(automationURL()), user: ADMIN },
        options(),
      );
      assert.true(paused.ok, 'the automation pauses');

      let status = attributesOf(
        (await statusOf(ADMIN, ['read', 'write'])).body,
      );
      assert.deepEqual(
        status.switchedOn ? [status.state, status.pauseReason] : [],
        ['paused', 'requested'],
      );

      for (let state of ['waiting-for-credits', 'done']) {
        await query(dbAdapter, [
          `UPDATE automations SET pause_reason = NULL, paused_by = NULL, state =`,
          param(state),
          `WHERE automation_id =`,
          param(automationURL()),
        ]);
        let next = attributesOf(
          (await statusOf(ADMIN, ['read', 'write'])).body,
        );
        assert.deepEqual(
          next.switchedOn ? [next.state, next.pauseReason] : [],
          [state, null],
          `reads as ${state}`,
        );
      }
    });

    test('another direct writer who shares a realm with the payer sees who pays', async function (assert) {
      await writeAutomation();
      await switchOn();
      let status = attributesOf(
        (await statusOf(ADMIN, ['read', 'write'])).body,
      );
      assert.deepEqual(
        status.switchedOn ? [status.payer, status.viewerIsPayer] : [],
        [PAYER, false],
      );
    });

    test('a direct writer who shares no realm grant with the payer learns that someone pays, not who', async function (assert) {
      await writeAutomation();
      await switchOn();
      // The payer leaves this realm, so the two share no realm at all.
      await query(dbAdapter, [
        `DELETE FROM realm_user_permissions WHERE username =`,
        param(PAYER),
        `AND realm_url =`,
        param(testRealm.url),
      ]);
      let status = attributesOf(
        (await statusOf(ADMIN, ['read', 'write'])).body,
      );
      assert.deepEqual(
        status.switchedOn ? [status.payer, status.viewerIsPayer] : [],
        [null, false],
      );

      // A grant that names both of them in another realm is enough.
      await insertPermissions(dbAdapter, new URL(ELSEWHERE), {
        [PAYER]: ['read'],
        [ADMIN]: ['read'],
      });
      status = attributesOf((await statusOf(ADMIN, ['read', 'write'])).body);
      assert.strictEqual(status.switchedOn ? status.payer : undefined, PAYER);
    });

    test('a reader and an anonymous caller are refused', async function (assert) {
      await writeAutomation();
      await switchOn();
      let reader = await statusOf(READER, ['read']);
      assert.strictEqual(reader.status, 403, 'a reader gets HTTP 403');
      assert.notOk(
        JSON.stringify(reader.body).includes(PAYER),
        "a reader's refusal doesn't name the payer",
      );

      let anonymous = await request
        .get(
          `/_automation-status?automation=${encodeURIComponent(automationURL())}`,
        )
        .set('Accept', SupportedMimeType.JSON);
      assert.strictEqual(anonymous.status, 401, 'an anonymous caller gets 401');
    });

    test('a request that names no card, or a card in another realm, is refused', async function (assert) {
      let missing = await statusOf(ADMIN, ['read', 'write'], null);
      assert.strictEqual(missing.status, 400, 'no automation named');
      let elsewhere = await statusOf(
        ADMIN,
        ['read', 'write'],
        `${ELSEWHERE}automations/nightly`,
      );
      assert.strictEqual(elsewhere.status, 400, 'a card in another realm');
    });

    test("a card that no longer reads as a declaration still reports each trigger's runs", async function (assert) {
      await writeAutomation();
      await switchOn();
      await setRuns('nightly', 4);
      await testRealm.write(
        'automations/nightly.json',
        JSON.stringify({
          data: {
            type: 'card',
            attributes: {
              ...attributes,
              triggers: [
                trigger('cron', { label: 'nightly', expression: '* * * * *' }),
              ],
            },
            relationships: {
              script: { links: { self: '../scripts/nightly-import.js' } },
            },
            meta: { adoptsFrom: automationRef },
          },
        }),
      );
      let status = attributesOf(
        (await statusOf(ADMIN, ['read', 'write'])).body,
      );
      assert.deepEqual(status.switchedOn ? status.triggers : [], [
        { label: 'nightly', runs: 4 },
      ]);
    });
  });

  module('a realm whose users grant writes', function (hooks) {
    let usersRealm: Realm;
    let usersRequest: SuperTest<Test>;
    let usersServer: Server;
    let usersDB: PgAdapter;

    hooks.afterEach(async function () {
      await closeServer(usersServer);
    });

    setupPermissionedRealmCached(hooks, {
      fixture: 'blank',
      permissions: {
        '@node-test_realm:localhost': ['read', 'realm-owner'],
        users: ['read', 'write'],
      },
      onRealmSetup(args) {
        usersRealm = args.testRealm;
        usersRequest = args.request;
        usersServer = args.testRealmHttpServer;
        usersDB = args.dbAdapter as PgAdapter;
      },
    });

    test('a writer the users grant admits is refused, since the grant names no one', async function (assert) {
      // The users row covers people with a Boxel account.
      await insertUser(usersDB, STRANGER, 'cus_stranger', null);
      let response = await usersRequest
        .get(
          `/_automation-status?automation=${encodeURIComponent(
            `${usersRealm.url}automations/nightly`,
          )}`,
        )
        .set('Accept', SupportedMimeType.JSON)
        .set(
          'Authorization',
          `Bearer ${createJWT(usersRealm, STRANGER, ['read', 'write'])}`,
        );
      assert.strictEqual(response.status, 403, 'HTTP 403');
    });
  });
});
