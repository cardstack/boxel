import QUnit from 'qunit';
const { module, test } = QUnit;
import { randomUUID } from 'crypto';
import { basename } from 'path';
import type { SuperTest, Test } from 'supertest';
import jsonwebtoken from 'jsonwebtoken';
import type { PgAdapter } from '@cardstack/postgres';
import {
  addToCreditsLedger,
  getUserByMatrixUserId,
} from '@cardstack/billing/billing-queries';
import {
  insertPermissions,
  internalKeyFor,
  param,
  query,
  ri,
  revokeUserSessions,
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
import type { AutomationListDocument } from '@cardstack/runtime-common/automation-list';
import { appendRunLog } from '@cardstack/runtime-common/automation-run-log';
import {
  createAutomationRun,
  finishAutomationRun,
  startAutomationRunAttempt,
} from '@cardstack/runtime-common/automation-runs';
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
  ensureTestUser,
  insertIncomingWebhookRow,
  insertUser,
  realmSecretSeed,
  setupPermissionedRealmCached,
  setupSecretsKeyring,
  testPricing,
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
    aiCredits: 0,
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
  // The tests seal incoming webhooks' signing secrets.
  setupSecretsKeyring(hooks);

  module('a realm with direct writers and a reader', function (hooks) {
    // The route reads the realm's clock for each trigger's next run.
    hooks.beforeEach(function () {
      (globalThis as { __boxelNow?: number }).__boxelNow = NOW * 1000;
    });
    hooks.afterEach(function () {
      delete (globalThis as { __boxelNow?: number }).__boxelNow;
    });

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

    // The card's webhook trigger names `github-push`, which the payer made.
    async function insertPayerWebhook() {
      let [found] = await query(dbAdapter, [
        `SELECT 1 FROM incoming_webhooks WHERE webhook_path = 'github-push'`,
      ]);
      if (!found) {
        await insertIncomingWebhookRow(dbAdapter as PgAdapter, {
          username: PAYER,
          webhookPath: 'github-push',
          signingSecret: 'payer-secret',
        });
      }
    }

    async function switchOn(user = PAYER) {
      await insertPayerWebhook();
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
          attributes: {
            switchedOn: false,
            webhookDeliveriesStartRuns: false,
            lastRun: null,
            currentRun: null,
          },
        },
      });
    });

    // A run of the automation that reached `names` in order, then ended as
    // `outcome`. With `dryRun`, a Preview.
    async function ranThrough(
      names: string[],
      plan: string[],
      outcome: Parameters<typeof finishAutomationRun>[3],
      { dryRun = false }: { dryRun?: boolean } = {},
    ) {
      let created = await createAutomationRun(dbAdapter, {
        automationId: rri(automationURL()),
        realm: ri(testRealm.url),
        trigger: 'nightly',
        slot: `slot-${names.join('-')}-${outcome.state}${dryRun ? '-preview' : ''}`,
        actsAs: PAYER,
        dryRun,
      });
      await startAutomationRunAttempt(dbAdapter, created.id, 1);
      let at = Date.parse('2026-11-10T18:00:00.000Z');
      await appendRunLog(dbAdapter, created.id, [
        {
          at,
          source: 'script',
          kind: 'plan',
          message: `Plan: ${plan.join(' → ')}`,
          data: { milestones: plan },
        },
        ...names.map((name, index) => ({
          at: at + index * 1_000,
          source: 'script' as const,
          kind: 'milestone' as const,
          message: `Milestone: ${name}`,
          data: { name },
        })),
      ]);
      await finishAutomationRun(dbAdapter, created.id, 1, outcome);
      return created.id;
    }

    test("the automation's last run reads with the milestones its script reported, switched on or not", async function (assert) {
      await writeAutomation();
      let runId = await ranThrough(
        ['Import', 'Index'],
        ['Import', 'Index', 'Notify'],
        {
          state: 'error',
          reason: 'script-error',
          message: 'Error: the feed was empty',
        },
      );

      let off = attributesOf((await statusOf(ADMIN, ['read', 'write'])).body);
      assert.false(off.switchedOn);
      let lastRun = off.lastRun!;
      assert.strictEqual(lastRun.runId, runId);
      assert.strictEqual(lastRun.state, 'error');
      assert.deepEqual(lastRun.plan, ['Import', 'Index', 'Notify']);
      assert.deepEqual(
        lastRun.milestones.map(({ name, planned, ms }) => ({
          name,
          planned,
          ms,
        })),
        [
          { name: 'Import', planned: true, ms: 1_000 },
          { name: 'Index', planned: true, ms: lastRun.milestones[1].ms },
        ],
      );
      assert.strictEqual(
        lastRun.failedIn,
        'Index',
        'the milestone it failed in',
      );
      assert.deepEqual(lastRun.ahead, ['Notify']);

      await switchOn();
      let on = attributesOf((await statusOf(ADMIN, ['read', 'write'])).body);
      assert.true(on.switchedOn);
      assert.strictEqual(on.lastRun?.runId, runId);

      let reader = await statusOf(READER, ['read']);
      assert.strictEqual(reader.status, 403, 'a reader never sees a run');
    });

    test('a Preview never reads as the last run or the run in progress', async function (assert) {
      await writeAutomation();
      let runId = await ranThrough(['Import'], ['Import'], {
        state: 'complete',
      });
      await ranThrough(
        ['Import', 'Index'],
        ['Import', 'Index'],
        { state: 'complete' },
        { dryRun: true },
      );
      let running = await createAutomationRun(dbAdapter, {
        automationId: rri(automationURL()),
        realm: ri(testRealm.url),
        trigger: 'nightly',
        slot: 'running-preview-slot',
        actsAs: PAYER,
        dryRun: true,
      });
      await startAutomationRunAttempt(dbAdapter, running.id, 2);

      let attributes = attributesOf(
        (await statusOf(ADMIN, ['read', 'write'])).body,
      );
      assert.strictEqual(
        attributes.lastRun?.runId,
        runId,
        'the last run is the run before the Preview',
      );
      assert.strictEqual(attributes.currentRun, null, 'no run is in progress');
    });

    test('a run in progress reads as currentRun, with the milestone it is in', async function (assert) {
      await writeAutomation();
      let created = await createAutomationRun(dbAdapter, {
        automationId: rri(automationURL()),
        realm: ri(testRealm.url),
        trigger: 'nightly',
        slot: 'running-slot',
        actsAs: PAYER,
      });
      await startAutomationRunAttempt(dbAdapter, created.id, 1);
      let at = Date.parse('2026-11-10T18:00:00.000Z');
      await appendRunLog(dbAdapter, created.id, [
        {
          at,
          source: 'script',
          kind: 'plan',
          message: 'Plan: Import → Index',
          data: { milestones: ['Import', 'Index'] },
        },
        {
          at,
          source: 'script',
          kind: 'milestone',
          message: 'Milestone: Import',
          data: { name: 'Import' },
        },
        {
          at,
          source: 'script',
          kind: 'count',
          message: '3 of 9',
          data: { done: 3, total: 9 },
        },
      ]);
      let attributes = attributesOf(
        (await statusOf(ADMIN, ['read', 'write'])).body,
      );
      let current = attributes.currentRun!;
      assert.strictEqual(current.runId, created.id);
      assert.strictEqual(current.state, 'running');
      assert.strictEqual(current.current, 'Import');
      assert.deepEqual(current.ahead, ['Index']);
      assert.strictEqual(current.milestones[0].done, 3);
      assert.strictEqual(current.milestones[0].endedAt, null);
      assert.strictEqual(attributes.lastRun, null, 'no run has ended');
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

    test('an automation paused for an invalid declaration reads with the problems the reader found', async function (assert) {
      await writeAutomation();
      await switchOn();
      let active = attributesOf(
        (await statusOf(ADMIN, ['read', 'write'])).body,
      );
      assert.strictEqual(
        active.switchedOn ? active.pauseProblems : undefined,
        null,
        'an active automation has no problems',
      );
      let problems = [
        {
          code: 'cron-too-frequent',
          path: 'triggers.0.expression',
          message:
            '"58,1 0,23 * * *" can fire twice 3 minutes apart, and Boxel runs an automation\'s cron trigger at most once every 5 minutes',
        },
      ];
      await query(dbAdapter, [
        `UPDATE automations SET state = 'paused', pause_reason = 'invalid-declaration', pause_problems =`,
        param(JSON.stringify(problems)),
        `::jsonb WHERE automation_id =`,
        param(automationURL()),
      ]);
      let status = attributesOf(
        (await statusOf(ADMIN, ['read', 'write'])).body,
      );
      assert.deepEqual(
        status.switchedOn
          ? [status.state, status.pauseReason, status.pauseProblems]
          : [],
        ['paused', 'invalid-declaration', problems],
      );
    });

    test("a switched-on automation reads with its failure streak and the streak's last error", async function (assert) {
      await writeAutomation();
      await switchOn();
      let fresh = attributesOf((await statusOf(ADMIN, ['read', 'write'])).body);
      assert.deepEqual(
        fresh.switchedOn ? [fresh.failuresInARow, fresh.lastFailure] : [],
        [0, null],
        'no runs, no streak',
      );

      await ranThrough(['Import'], ['Import', 'Index'], {
        state: 'error',
        reason: 'script-error',
        message: 'Error: the feed was empty',
      });
      let lastId = await ranThrough(['Index'], ['Import', 'Index'], {
        state: 'error',
        reason: 'timed-out',
        message: 'The run reached its time limit',
      });
      let status = attributesOf(
        (await statusOf(ADMIN, ['read', 'write'])).body,
      );
      if (!status.switchedOn) {
        throw new Error('expected a switched-on automation');
      }
      assert.strictEqual(status.failuresInARow, 2);
      assert.strictEqual(status.lastFailure?.runId, lastId);
      assert.strictEqual(status.lastFailure?.reason, 'timed-out');
      assert.strictEqual(
        status.lastFailure?.message,
        'The run reached its time limit',
      );
      assert.strictEqual(typeof status.lastFailure?.finishedAt, 'string');

      await ranThrough(['Import', 'Index'], ['Import', 'Index'], {
        state: 'complete',
      });
      let reset = attributesOf((await statusOf(ADMIN, ['read', 'write'])).body);
      assert.deepEqual(
        reset.switchedOn ? [reset.failuresInARow, reset.lastFailure] : [],
        [0, null],
        'a complete run ends the streak',
      );
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
      // Without a declaration the route reports each trigger the row has
      // counted. Switch-on records every trigger the card declared, and an
      // edit that fails to read leaves the row as it was, so all four
      // triggers report, with only their run counts. The row keeps its
      // labels in jsonb's key order, so they are compared by label.
      let [row] = await query(dbAdapter, [
        'SELECT trigger_runs FROM automations WHERE automation_id =',
        param(automationURL()),
      ]);
      let triggers = status.switchedOn
        ? [...status.triggers].sort((a, b) => a.label.localeCompare(b.label))
        : [];
      assert.deepEqual(
        triggers,
        [
          { label: 'hourly', runs: 0 },
          { label: 'launch', runs: 0 },
          { label: 'nightly', runs: 4 },
          { label: 'push', runs: 0 },
        ],
        `each trigger the row counted reports its runs; the row's trigger_runs: ${JSON.stringify(row?.trigger_runs)}`,
      );
    });

    module('the webhooks an automation may name', function () {
      function webhooksOf(
        user: string,
        permissions: ('read' | 'write' | 'realm-owner')[],
      ) {
        return request
          .get('/_automation-webhooks')
          .set('Accept', SupportedMimeType.JSON)
          .set(
            'Authorization',
            `Bearer ${createJWT(testRealm, user, permissions)}`,
          );
      }

      test("a direct writer lists the webhooks the realm's direct writers made, and no one else's", async function (assert) {
        await insertPayerWebhook();
        await insertIncomingWebhookRow(dbAdapter as PgAdapter, {
          username: ADMIN,
          webhookPath: 'admin-hook',
          signingSecret: 'admin-secret',
        });
        await insertIncomingWebhookRow(dbAdapter as PgAdapter, {
          username: READER,
          webhookPath: 'reader-hook',
          signingSecret: 'reader-secret',
        });
        await insertIncomingWebhookRow(dbAdapter as PgAdapter, {
          username: STRANGER,
          webhookPath: 'stranger-hook',
          signingSecret: 'stranger-secret',
        });
        let response = await webhooksOf(ADMIN, ['read', 'write']);
        assert.strictEqual(response.status, 200, 'HTTP 200');
        assert.strictEqual(response.headers['cache-control'], 'no-store');
        let listed = (
          response.body.data as {
            type: string;
            id: string;
            attributes: { webhookPath: string; owner: string };
          }[]
        )
          .map(({ type, id, attributes: { webhookPath, owner } }) => ({
            type,
            id,
            webhookPath,
            owner,
          }))
          .sort((a, b) => a.id.localeCompare(b.id));
        assert.deepEqual(listed, [
          {
            type: 'automation-webhook',
            id: 'admin-hook',
            webhookPath: 'admin-hook',
            owner: ADMIN,
          },
          {
            type: 'automation-webhook',
            id: 'github-push',
            webhookPath: 'github-push',
            owner: PAYER,
          },
        ]);
        assert.deepEqual(response.body.meta, {
          webhookDeliveriesStartRuns: false,
        });
        assert.notOk(
          JSON.stringify(response.body).includes('secret'),
          'no signing secret is listed',
        );
      });

      test('a reader and an anonymous caller are refused the list', async function (assert) {
        await insertPayerWebhook();
        let reader = await webhooksOf(READER, ['read']);
        assert.strictEqual(reader.status, 403, 'a reader gets HTTP 403');
        assert.notOk(
          JSON.stringify(reader.body).includes('github-push'),
          "a reader's refusal names no webhook",
        );
        let anonymous = await request
          .get('/_automation-webhooks')
          .set('Accept', SupportedMimeType.JSON);
        assert.strictEqual(
          anonymous.status,
          401,
          'an anonymous caller gets 401',
        );
      });
    });

    // The route the realm config's Automations entry and the automations
    // console list a realm's automations from.
    module("the realm's automation list", function () {
      function list(user: string, permissions: ('read' | 'write')[]) {
        return request
          .get('/_automations')
          .set('Accept', SupportedMimeType.JSON)
          .set(
            'Authorization',
            `Bearer ${createJWT(testRealm, user, permissions)}`,
          );
      }

      async function entries(user = ADMIN) {
        let response = await list(user, ['read', 'write']);
        if (response.status !== 200) {
          throw new Error(
            `expected the list, got ${response.status}: ${response.text}`,
          );
        }
        return (response.body as AutomationListDocument).data;
      }

      // A second automation card, never switched on, named `name`.
      async function writeOtherAutomation(name: string) {
        await testRealm.write(
          'automations/weekly.json',
          JSON.stringify({
            data: {
              type: 'card',
              attributes: {
                ...attributes,
                cardInfo: { name },
                caps: { ...attributes.caps, monthlyCredits: 80 },
                triggers: [attributes.triggers[1]],
              },
              relationships: {
                script: { links: { self: '../scripts/nightly-import.js' } },
              },
              meta: { adoptsFrom: automationRef },
            },
          }),
        );
      }

      // Charges the payer `credits` for a run of the automation, dated
      // `seconds` (unix).
      async function chargeRun(credits: number, seconds: number) {
        let run = await createAutomationRun(dbAdapter, {
          automationId: rri(automationURL()),
          realm: ri(testRealm.url),
          trigger: 'nightly',
          slot: randomUUID(),
          actsAs: PAYER,
        });
        await ensureTestUser(dbAdapter as PgAdapter, PAYER);
        let { id: userId } = (await getUserByMatrixUserId(dbAdapter, PAYER))!;
        let chargeId = randomUUID();
        await addToCreditsLedger(dbAdapter, {
          userId,
          creditAmount: -credits,
          creditType: 'extra_credit_used',
          subscriptionCycleId: null,
          charge: {
            kind: 'run',
            realm: ri(testRealm.url),
            runId: run.id,
            pricingVersion: testPricing().version,
          },
          chargeId,
        });
        await query(dbAdapter, [
          'UPDATE credits_ledger SET created_at =',
          param(seconds),
          'WHERE charge_id =',
          param(chargeId),
        ]);
      }

      test('a realm with no automations lists none', async function (assert) {
        let response = await list(ADMIN, ['read', 'write']);
        assert.strictEqual(response.status, 200, 'HTTP 200');
        assert.strictEqual(response.headers['cache-control'], 'no-store');
        assert.deepEqual(response.body, { data: [] });
      });

      test('every automation card is listed by name, switched on or not, with its triggers and monthly cap', async function (assert) {
        await writeAutomation();
        await writeOtherAutomation('A weekly digest');
        let [weekly, nightly] = await entries();
        assert.deepEqual(
          [weekly.id, nightly.id],
          [`${testRealm.url}automations/weekly`, automationURL()],
          'in order of name',
        );
        assert.deepEqual(weekly.attributes, {
          title: 'A weekly digest',
          switchedOn: false,
          state: null,
          pauseReason: null,
          triggers: [
            {
              label: 'hourly',
              kind: 'cron',
              expression: '0 * * * *',
              timeZone: 'America/Chicago',
            },
          ],
          nextRun: null,
          payer: null,
          viewerIsPayer: false,
          monthlyCredits: 80,
          spentThisMonth: 0,
          lastResult: null,
          lastFinishedAt: null,
          currentRun: null,
        });
        assert.deepEqual(
          nightly.attributes.triggers.map(({ label, kind }) => [label, kind]),
          [
            ['nightly', 'cron'],
            ['hourly', 'cron'],
            ['launch', 'once'],
            ['push', 'webhook'],
          ],
          "each trigger the card declares, in the card's order",
        );
        assert.deepEqual(nightly.attributes.triggers[2], {
          label: 'launch',
          kind: 'once',
          date: '2026-11-20',
          time: '15:00',
          timeZone: 'America/Chicago',
        });
        assert.deepEqual(nightly.attributes.triggers[3], {
          label: 'push',
          kind: 'webhook',
          webhookPath: 'github-push',
        });
      });

      test('a switched-on automation lists its state, next run, payer, the cap the payer agreed to and its spend this month', async function (assert) {
        await writeAutomation();
        await switchOn();
        // This month's charges count; last month's don't.
        await chargeRun(30, NOW - 60);
        await chargeRun(12, NOW - 3_600);
        await chargeRun(500, Date.UTC(2026, 9, 31, 23) / 1000);

        let [nightly] = await entries(PAYER);
        let status = (
          (await statusOf(PAYER, ['read', 'write']))
            .body as AutomationStatusDocument
        ).data.attributes;
        assert.true(nightly.attributes.switchedOn);
        assert.strictEqual(nightly.attributes.state, 'active');
        assert.strictEqual(
          nightly.attributes.nextRun,
          status.switchedOn ? status.nextRun : undefined,
          "the row's next run, as the card's status reads it",
        );
        assert.strictEqual(nightly.attributes.payer, PAYER);
        assert.true(nightly.attributes.viewerIsPayer);
        assert.strictEqual(nightly.attributes.monthlyCredits, 500);
        assert.strictEqual(nightly.attributes.spentThisMonth, 42);
      });

      test('a paused, waiting or done automation lists that state, and a running one the milestone its run is in', async function (assert) {
        await writeAutomation();
        await switchOn();
        let paused = await pauseAutomation(
          dbAdapter,
          { automationId: rri(automationURL()), user: ADMIN },
          options(),
        );
        assert.true(paused.ok, 'the automation pauses');
        let [entry] = await entries();
        assert.deepEqual(
          [entry.attributes.state, entry.attributes.pauseReason],
          ['paused', 'requested'],
        );

        for (let state of ['waiting-for-credits', 'done', 'active']) {
          await query(dbAdapter, [
            `UPDATE automations SET pause_reason = NULL, paused_by = NULL, state =`,
            param(state),
            `WHERE automation_id =`,
            param(automationURL()),
          ]);
          [entry] = await entries();
          assert.deepEqual(
            [entry.attributes.state, entry.attributes.pauseReason],
            [state, null],
            `lists as ${state}`,
          );
        }

        let created = await createAutomationRun(dbAdapter, {
          automationId: rri(automationURL()),
          realm: ri(testRealm.url),
          trigger: 'nightly',
          slot: 'running-slot',
          actsAs: PAYER,
        });
        await startAutomationRunAttempt(dbAdapter, created.id, 1);
        let at = Date.parse('2026-11-10T18:00:00.000Z');
        await appendRunLog(dbAdapter, created.id, [
          {
            at,
            source: 'script',
            kind: 'plan',
            message: 'Plan: Import → Index',
            data: { milestones: ['Import', 'Index'] },
          },
          {
            at,
            source: 'script',
            kind: 'milestone',
            message: 'Milestone: Import',
            data: { name: 'Import' },
          },
          {
            at,
            source: 'script',
            kind: 'count',
            message: '3 of 9',
            data: { done: 3, total: 9 },
          },
        ]);
        [entry] = await entries();
        assert.deepEqual(entry.attributes.currentRun, {
          runId: created.id,
          startedAt: entry.attributes.currentRun?.startedAt ?? null,
          milestone: 'Import',
          done: 3,
          total: 9,
        });
        assert.ok(entry.attributes.currentRun?.startedAt, 'with its start');
      });

      test('an automation that is not switched on lists how its last run ended', async function (assert) {
        await writeAutomation();
        let run = await createAutomationRun(dbAdapter, {
          automationId: rri(automationURL()),
          realm: ri(testRealm.url),
          trigger: 'manual',
          slot: 'run-now-slot',
          actsAs: ADMIN,
        });
        await startAutomationRunAttempt(dbAdapter, run.id, 1);
        await finishAutomationRun(dbAdapter, run.id, 1, {
          state: 'error',
          reason: 'script-error',
          message: 'Error: the feed was empty',
        });
        let [entry] = await entries();
        assert.false(entry.attributes.switchedOn);
        assert.strictEqual(entry.attributes.lastResult, 'error');
        assert.ok(entry.attributes.lastFinishedAt, 'with when it ended');
      });

      test('a direct writer who shares no realm grant with the payer learns that someone pays, not who', async function (assert) {
        await writeAutomation();
        await switchOn();
        await query(dbAdapter, [
          `DELETE FROM realm_user_permissions WHERE username =`,
          param(PAYER),
          `AND realm_url =`,
          param(testRealm.url),
        ]);
        let [entry] = await entries();
        assert.deepEqual(
          [entry.attributes.payer, entry.attributes.viewerIsPayer],
          [null, false],
        );
      });

      test('a switched-on automation whose card the index lacks is listed from its row', async function (assert) {
        await writeAutomation();
        await switchOn();
        await setRuns('nightly', 4);
        await query(dbAdapter, [
          `UPDATE boxel_index SET is_deleted = TRUE WHERE url =`,
          param(`${automationURL()}.json`),
          `OR file_alias =`,
          param(automationURL()),
        ]);
        let [entry] = await entries();
        assert.strictEqual(entry.id, automationURL());
        assert.strictEqual(entry.attributes.title, null);
        assert.strictEqual(entry.attributes.state, 'active');
        assert.true(
          entry.attributes.triggers.some(
            ({ label, kind }) => label === 'nightly' && kind === null,
          ),
          'each trigger the row has counted, by its label',
        );
      });

      test('a reader and an anonymous caller are refused', async function (assert) {
        await writeAutomation();
        await switchOn();
        let reader = await list(READER, ['read']);
        assert.strictEqual(reader.status, 403, 'a reader gets HTTP 403');
        assert.notOk(
          JSON.stringify(reader.body).includes(PAYER),
          "a reader's refusal doesn't name the payer",
        );
        let anonymous = await request
          .get('/_automations')
          .set('Accept', SupportedMimeType.JSON);
        assert.strictEqual(
          anonymous.status,
          401,
          'an anonymous caller gets 401',
        );
      });
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

    test('a writer the users grant admits is refused the automation list', async function (assert) {
      await ensureTestUser(usersDB, STRANGER);
      let response = await usersRequest
        .get('/_automations')
        .set('Accept', SupportedMimeType.JSON)
        .set(
          'Authorization',
          `Bearer ${createJWT(usersRealm, STRANGER, ['read', 'write'])}`,
        );
      assert.strictEqual(response.status, 403, 'HTTP 403');
    });
  });

  module('a realm anyone can read', function (hooks) {
    let publicRealm: Realm;
    let publicRequest: SuperTest<Test>;
    let publicServer: Server;
    let publicDB: PgAdapter;

    hooks.afterEach(async function () {
      await closeServer(publicServer);
    });

    setupPermissionedRealmCached(hooks, {
      fixture: 'blank',
      permissions: {
        '*': ['read'],
        '@node-test_realm:localhost': ['read', 'realm-owner'],
        [ADMIN]: ['read', 'write'],
      },
      onRealmSetup(args) {
        publicRealm = args.testRealm;
        publicRequest = args.request;
        publicServer = args.testRealmHttpServer;
        publicDB = args.dbAdapter as PgAdapter;
      },
    });

    // A realm session issued a minute ago, so a revocation recorded now
    // postdates it.
    function backdatedSession(user: string) {
      let iat = Math.floor(Date.now() / 1000) - 60;
      return jsonwebtoken.sign(
        {
          user,
          realm: publicRealm.url,
          permissions: ['read', 'write'],
          sessionRoom: `test-session-room-for-${user}`,
          realmServerURL: publicRealm.realmServerURL,
          iat,
          exp: iat + 900,
        },
        realmSecretSeed,
      );
    }

    function status(authorization?: string) {
      let request = publicRequest
        .get(
          `/_automation-status?automation=${encodeURIComponent(
            `${publicRealm.url}automations/nightly`,
          )}`,
        )
        .set('Accept', SupportedMimeType.JSON);
      return authorization
        ? request.set('Authorization', authorization)
        : request;
    }

    test('an anonymous reader is refused', async function (assert) {
      assert.strictEqual((await status()).status, 403);
    });

    test("a direct writer's revoked session asks as no one", async function (assert) {
      let session = backdatedSession(ADMIN);
      assert.strictEqual(
        (await status(`Bearer ${session}`)).status,
        200,
        'the session answers before it is revoked',
      );
      await revokeUserSessions(publicDB, ADMIN);
      assert.strictEqual(
        (await status(`Bearer ${session}`)).status,
        403,
        'the revoked session is refused',
      );
    });
  });
});
