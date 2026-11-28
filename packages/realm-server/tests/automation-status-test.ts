import QUnit from 'qunit';
const { module, test } = QUnit;
import { randomUUID } from 'crypto';
import { basename } from 'path';
import type { SuperTest, Test } from 'supertest';
import jsonwebtoken from 'jsonwebtoken';
import { PgQueuePublisher, type PgAdapter } from '@cardstack/postgres';
import {
  addToCreditsLedger,
  getUserByMatrixUserId,
} from '@cardstack/billing/billing-queries';
import {
  archiveRealm,
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
  OPEN_AI_BATCHES_LISTED,
  recordAIBatch,
} from '@cardstack/runtime-common/ai-batches';
import {
  automationRef,
  readAutomationDeclaration,
  type AutomationDeclaration,
} from '@cardstack/runtime-common/automation-declaration';
import { zonedDateTimeToUnixSeconds } from '@cardstack/runtime-common/automation-schedule';
import type { AutomationStatusDocument } from '@cardstack/runtime-common/automation-status';
import type { AutomationListDocument } from '@cardstack/runtime-common/automation-list';
import type { AutomationRunListDocument } from '@cardstack/runtime-common/automation-run-list';
import { scriptErrorText } from '@cardstack/runtime-common/automation-run-command';
import { tickAutomations } from '@cardstack/runtime-common/automation-tick';
import {
  appendRunLog,
  logRunPlatformLine,
} from '@cardstack/runtime-common/automation-run-log';
import {
  automationNotices,
  type AutomationCredentialNotice,
} from '@cardstack/runtime-common/automation-notices';
import {
  cancelAutomationRun,
  createAutomationRun,
  endAutomationRunAtCap,
  finishAutomationRun,
  recordAutomationRunAdmitted,
  startAutomationRunAttempt,
} from '@cardstack/runtime-common/automation-runs';
import {
  checkAutomationCaps,
  getAutomation,
  pauseAutomation,
  switchOnAutomation,
  type AutomationActorOptions,
} from '@cardstack/runtime-common/automations';
import type { RealmHttpServer as Server } from '../server.ts';
import { createJWT as createRealmServerJWT } from '../utils/jwt.ts';
import {
  closeServer,
  createJWT,
  createVirtualNetwork,
  ensureTestUser,
  insertIncomingWebhookRow,
  insertUser,
  realmConfigCardJSON,
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
            lastRun: null,
            currentRun: null,
            lastRunUsage: null,
          },
        },
        meta: { directWriter: true },
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
      assert.deepEqual(
        reader.body,
        { data: null, meta: { directWriter: false } },
        'a reader never sees a run',
      );
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

    test('a run in progress reads as currentRun, with the milestone it is in and the tasks inside it', async function (assert) {
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
          kind: 'task',
          message: 'Task: Imported the March invoices',
          data: { text: 'Imported the March invoices' },
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
      assert.deepEqual(current.milestones[0].tasks, [
        { text: 'Imported the March invoices', at: new Date(at).toISOString() },
      ]);
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

    test('a switched-on automation reads with its open batches, and a pause holds their follow-ups', async function (assert) {
      await writeAutomation();
      await switchOn();
      let submitting = await createAutomationRun(dbAdapter, {
        automationId: rri(automationURL()),
        realm: ri(testRealm.url),
        trigger: 'nightly',
        slot: 'slot-submitting',
        actsAs: PAYER,
      });
      async function submit(
        batchId: string,
        deadline: string,
        submittedAt?: string,
      ) {
        await recordAIBatch(dbAdapter, {
          batchId,
          runId: submitting.id,
          actsAs: PAYER,
          realm: ri(testRealm.url),
          automationId: rri(automationURL()),
          model: 'openai/gpt-4.1-mini',
          requestCount: 3,
          estimatedUsd: 0.01,
          runAIReservation: `reservation-${batchId}`,
          reservedCredits: 2,
          deadline: new Date(deadline),
          expiresAt: null,
          state: 'in_progress',
          submittedAt: submittedAt ? new Date(submittedAt) : undefined,
        });
      }
      await submit('batch_late', '2026-11-10T20:00:00.000Z');
      await submit('batch_soon', '2026-11-10T19:00:00.000Z');
      // A batch whose follow-up ran to the end is no longer open.
      await submit('batch_done', '2026-11-10T18:30:00.000Z');
      let followUp = await createAutomationRun(dbAdapter, {
        automationId: rri(automationURL()),
        realm: ri(testRealm.url),
        trigger: 'batch',
        slot: 'batch_done',
        actsAs: PAYER,
      });
      await query(dbAdapter, [
        `UPDATE automation_runs SET state = 'complete' WHERE id =`,
        param(followUp.id),
      ]);
      await query(dbAdapter, [
        `UPDATE ai_batches SET follow_up_run_id =`,
        param(followUp.id),
        `WHERE batch_id = 'batch_done'`,
      ]);
      // A batch submitted before the automation's switch-on gets no
      // follow-up, and neither does a batch marked dropped.
      await submit(
        'batch_before',
        '2026-11-10T18:45:00.000Z',
        '2020-01-01T00:00:00.000Z',
      );
      await submit('batch_dropped', '2026-11-10T18:50:00.000Z');
      await query(dbAdapter, [
        `UPDATE ai_batches SET follow_up_dropped_at = now() WHERE batch_id = 'batch_dropped'`,
      ]);

      let active = attributesOf(
        (await statusOf(ADMIN, ['read', 'write'])).body,
      );
      assert.deepEqual(
        active.switchedOn
          ? [active.openBatches, active.openBatchCount]
          : undefined,
        [
          [
            {
              batchId: 'batch_soon',
              deadline: '2026-11-10T19:00:00.000Z',
              requestCount: 3,
              followUpHeld: false,
            },
            {
              batchId: 'batch_late',
              deadline: '2026-11-10T20:00:00.000Z',
              requestCount: 3,
              followUpHeld: false,
            },
          ],
          2,
        ],
        'an active automation lists each open batch, earliest deadline first, its follow-up not held',
      );

      let paused = await pauseAutomation(
        dbAdapter,
        { automationId: rri(automationURL()), user: ADMIN },
        options(),
      );
      assert.true(paused.ok, 'the automation pauses');
      let held = attributesOf((await statusOf(ADMIN, ['read', 'write'])).body);
      assert.deepEqual(
        held.switchedOn
          ? held.openBatches.map(({ batchId, followUpHeld }) => [
              batchId,
              followUpHeld,
            ])
          : undefined,
        [
          ['batch_soon', true],
          ['batch_late', true],
        ],
        'a paused automation holds the follow-up of each open batch',
      );
    });

    test("an open batch's follow-up reads as held only while it waits: a held or unstarted follow-up does, one left running doesn't, and the count goes past the batches listed", async function (assert) {
      await writeAutomation();
      await switchOn();
      let submitting = await createAutomationRun(dbAdapter, {
        automationId: rri(automationURL()),
        realm: ri(testRealm.url),
        trigger: 'nightly',
        slot: 'slot-submitting-2',
        actsAs: PAYER,
      });
      async function submit(batchId: string, deadline: string) {
        await recordAIBatch(dbAdapter, {
          batchId,
          runId: submitting.id,
          actsAs: PAYER,
          realm: ri(testRealm.url),
          automationId: rri(automationURL()),
          model: 'openai/gpt-4.1-mini',
          requestCount: 2,
          estimatedUsd: 0.01,
          runAIReservation: `reservation-${batchId}`,
          reservedCredits: 2,
          deadline: new Date(deadline),
          expiresAt: null,
          state: 'in_progress',
        });
      }
      async function followUp(batchId: string, state: string) {
        let run = await createAutomationRun(dbAdapter, {
          automationId: rri(automationURL()),
          realm: ri(testRealm.url),
          trigger: 'batch',
          slot: batchId,
          actsAs: PAYER,
        });
        await query(dbAdapter, [
          `UPDATE automation_runs SET state =`,
          param(state),
          `WHERE id =`,
          param(run.id),
        ]);
        await query(dbAdapter, [
          `UPDATE ai_batches SET follow_up_run_id =`,
          param(run.id),
          `WHERE batch_id =`,
          param(batchId),
        ]);
      }
      // A follow-up that is running stays open; one still pending too.
      await submit('batch_running', '2026-11-10T18:10:00.000Z');
      await followUp('batch_running', 'running');
      await submit('batch_pending', '2026-11-10T18:20:00.000Z');
      await followUp('batch_pending', 'pending');
      // A batch that couldn't be read records a hold while its automation
      // is active, and waits for its retry.
      await submit('batch_retry', '2026-11-10T18:30:00.000Z');
      await query(dbAdapter, [
        `UPDATE ai_batches SET follow_up_held_at = now() WHERE batch_id = 'batch_retry'`,
      ]);

      async function held() {
        let status = attributesOf(
          (await statusOf(ADMIN, ['read', 'write'])).body,
        );
        return status.switchedOn
          ? Object.fromEntries(
              status.openBatches.map(({ batchId, followUpHeld }) => [
                batchId,
                followUpHeld,
              ]),
            )
          : undefined;
      }

      assert.deepEqual(
        await held(),
        { batch_running: false, batch_pending: false, batch_retry: true },
        'an active automation holds only the batch that records a hold',
      );

      // Waiting for a key approval holds pending follow-ups and leaves a
      // running one to finish.
      await query(dbAdapter, [
        `UPDATE automations SET state = 'waiting-for-key-approval' WHERE automation_id =`,
        param(automationURL()),
      ]);
      assert.deepEqual(
        await held(),
        { batch_running: false, batch_pending: true, batch_retry: true },
        'a follow-up left running is not held',
      );

      // More open batches than the status lists: the count names them all.
      for (let i = 0; i < OPEN_AI_BATCHES_LISTED; i++) {
        await submit(
          `batch_more_${String(i).padStart(2, '0')}`,
          '2026-11-11T00:00:00.000Z',
        );
      }
      let status = attributesOf(
        (await statusOf(ADMIN, ['read', 'write'])).body,
      );
      assert.deepEqual(
        status.switchedOn
          ? [status.openBatches.length, status.openBatchCount]
          : undefined,
        [OPEN_AI_BATCHES_LISTED, OPEN_AI_BATCHES_LISTED + 3],
        'the status lists the earliest batches and counts every open one',
      );
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

    test('a reader is shown nothing, and an anonymous caller is refused', async function (assert) {
      await writeAutomation();
      await switchOn();
      let reader = await statusOf(READER, ['read']);
      assert.strictEqual(
        reader.status,
        200,
        "a reader isn't refused, since the host takes a refusal as an auth failure of what it renders",
      );
      assert.deepEqual(
        reader.body,
        { data: null, meta: { directWriter: false } },
        'a reader is told it is not a direct writer, and shown nothing',
      );
      // The route checks the `automation` parameter only for a direct
      // writer, so a reader learns nothing from it either.
      for (let automation of [null, `${ELSEWHERE}automations/nightly`]) {
        let unchecked = await statusOf(READER, ['read'], automation);
        assert.deepEqual(
          [unchecked.status, unchecked.body],
          [200, { data: null, meta: { directWriter: false } }],
          `a reader naming ${automation ?? 'no card'} is told the same`,
        );
      }

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
      // Without a declaration the route reports each trigger of the card's
      // last readable edit. Switch-on records every trigger the card
      // declared, and an edit that fails to read leaves the row as it was,
      // so all four triggers report, with only their run counts. The row
      // keeps its labels in jsonb's key order, so they are compared by label.
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

    test('a card that no longer reads as a declaration leaves out a trigger an earlier edit removed', async function (assert) {
      await writeAutomation();
      await switchOn();
      await setRuns('hourly', 7);
      // Spent, so not live, yet still declared.
      await setRuns('nightly', 30);
      function cardWith(triggers: Record<string, unknown>[]) {
        return JSON.stringify({
          data: {
            type: 'card',
            attributes: { ...attributes, triggers },
            relationships: {
              script: { links: { self: '../scripts/nightly-import.js' } },
            },
            meta: { adoptsFrom: automationRef },
          },
        });
      }
      let withoutHourly = attributes.triggers.filter(
        (t: Record<string, unknown>) => t.label !== 'hourly',
      );
      // The first edit removes `hourly`, and the card reads.
      await testRealm.write(
        'automations/nightly.json',
        cardWith(withoutHourly),
      );
      // The next edit leaves a cron trigger without an expression, so the
      // card fails to read.
      await testRealm.write(
        'automations/nightly.json',
        cardWith([...withoutHourly, trigger('cron', { label: 'half-typed' })]),
      );
      let status = attributesOf(
        (await statusOf(ADMIN, ['read', 'write'])).body,
      );
      let [row] = await query(dbAdapter, [
        'SELECT trigger_runs FROM automations WHERE automation_id =',
        param(automationURL()),
      ]);
      let labels = status.switchedOn
        ? status.triggers.map(({ label }) => label).sort()
        : [];
      assert.deepEqual(
        labels,
        ['launch', 'nightly', 'push'],
        `the removed trigger is left out; the row's trigger_runs: ${JSON.stringify(row?.trigger_runs)}`,
      );
      assert.strictEqual(
        (row?.trigger_runs as Record<string, { runs: number }>)?.hourly?.runs,
        7,
        "the row keeps the removed trigger's count, should the label come back",
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
        assert.deepEqual(response.body.meta, { directWriter: true });
        assert.notOk(
          JSON.stringify(response.body).includes('secret'),
          'no signing secret is listed',
        );
      });

      test('a reader is listed no webhooks, and an anonymous caller is refused', async function (assert) {
        await insertPayerWebhook();
        let reader = await webhooksOf(READER, ['read']);
        assert.strictEqual(
          reader.status,
          200,
          "a reader isn't refused, since the host takes a refusal as an auth failure of what it renders",
        );
        assert.deepEqual(
          reader.body,
          { data: [], meta: { directWriter: false } },
          'a reader is told it is not a direct writer, and listed no webhook',
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

    // The route the Automation card's isolated view lists the automation's
    // runs from.
    module("an automation's runs", function () {
      function runsOf(
        user: string,
        permissions: ('read' | 'write')[],
        query: Record<string, string> | null = {
          automation: automationURL(),
        },
      ) {
        let search = query ? `?${new URLSearchParams(query)}` : '';
        return request
          .get(`/_automation-runs${search}`)
          .set('Accept', SupportedMimeType.JSON)
          .set(
            'Authorization',
            `Bearer ${createJWT(testRealm, user, permissions)}`,
          );
      }

      async function listed(
        user = ADMIN,
        query?: Record<string, string>,
      ): Promise<AutomationRunListDocument> {
        let response = await runsOf(user, ['read', 'write'], {
          automation: automationURL(),
          ...query,
        });
        if (response.status !== 200) {
          throw new Error(
            `expected the runs, got ${response.status}: ${response.text}`,
          );
        }
        return response.body as AutomationRunListDocument;
      }

      // A run of the automation, made `minutesAgo` minutes before the others
      // so the list's order is the order the test made them in, and started
      // by its first attempt unless it is `waiting`.
      async function made(
        trigger: string,
        slot: string,
        minutesAgo: number,
        extra: { dryRun?: boolean; actsAs?: string; waiting?: boolean } = {},
      ) {
        let run = await createAutomationRun(dbAdapter, {
          automationId: rri(automationURL()),
          realm: ri(testRealm.url),
          trigger,
          slot,
          actsAs: extra.actsAs ?? ADMIN,
          dryRun: extra.dryRun,
        });
        await query(dbAdapter, [
          `UPDATE automation_runs SET created_at = now() - make_interval(mins =>`,
          param(minutesAgo),
          `) WHERE id =`,
          param(run.id),
        ]);
        if (!extra.waiting) {
          await startAutomationRunAttempt(dbAdapter, run.id, 1);
        }
        return run;
      }

      async function ended(
        runId: string,
        outcome:
          | { state: 'complete' }
          | { state: 'error'; reason: string; message: string },
        { admit = true }: { admit?: boolean } = {},
      ) {
        await startAutomationRunAttempt(dbAdapter, runId, 1);
        if (admit) {
          await recordAutomationRunAdmitted(dbAdapter, runId, 1);
        }
        await finishAutomationRun(dbAdapter, runId, 1, outcome);
      }

      test('an automation with no runs lists none', async function (assert) {
        await writeAutomation();
        let response = await runsOf(ADMIN, ['read', 'write']);
        assert.strictEqual(response.status, 200, 'HTTP 200');
        assert.strictEqual(response.headers['cache-control'], 'no-store');
        assert.deepEqual(response.body, {
          data: [],
          meta: { directWriter: true, page: 1, pages: 1, total: 0 },
        });
      });

      test('each run lists what started it, its state and step, newest first, from the moment the run is made', async function (assert) {
        await writeAutomation();
        let scheduled = await made('nightly', '2026-11-10T08:30:00.000Z', 40);
        await ended(scheduled.id, { state: 'complete' });
        let preview = await made('manual', randomUUID(), 30, { dryRun: true });
        await ended(preview.id, { state: 'complete' });
        let runNow = await made('manual', randomUUID(), 20);
        await recordAutomationRunAdmitted(dbAdapter, runNow.id, 1);
        let waiting = await made('hourly', '2026-11-10T18:00:00.000Z', 10, {
          waiting: true,
        });

        let { data, meta } = await listed();
        assert.deepEqual(
          data.map(({ id, attributes: a }) => [
            id,
            a.startedBy,
            a.trigger,
            a.slot,
            a.state,
            a.step,
          ]),
          [
            [
              waiting.id,
              'trigger',
              'hourly',
              '2026-11-10T18:00:00.000Z',
              'pending',
              null,
            ],
            [runNow.id, 'run-now', null, null, 'running', 'script'],
            [preview.id, 'preview', null, null, 'complete', 'script'],
            [
              scheduled.id,
              'trigger',
              'nightly',
              '2026-11-10T08:30:00.000Z',
              'complete',
              'script',
            ],
          ],
          "a run still waiting for its first attempt is listed, and a click's slot means nothing to a person, so a Preview and a Run now list none",
        );
        assert.deepEqual(
          [meta.page, meta.pages, meta.total],
          [1, 1, 4],
          'one page holds them all',
        );
        assert.deepEqual(
          data.map(({ attributes: a }) => a.waitingFor),
          [
            {
              kind: 'run',
              runId: runNow.id,
              startedBy: 'run-now',
              trigger: null,
              slot: null,
              state: 'running',
            },
            null,
            null,
            null,
          ],
          'a waiting run names the run ahead of it in the automation’s queue',
        );
        let complete = data[3].attributes;
        assert.ok(complete.startedAt, 'with when it started');
        assert.ok(complete.finishedAt, 'and when it ended');
        assert.strictEqual(complete.errorReason, null);
        assert.deepEqual(complete.joined, []);
      });

      test("an error lists its reason and message, a script's error the line it points at, and a capped run its cap", async function (assert) {
        await writeAutomation();
        let threw = await made('nightly', '2026-11-08T08:30:00.000Z', 50);
        await ended(threw.id, {
          state: 'error',
          reason: 'script-error',
          message: scriptErrorText('TypeError: feed.items is undefined', 7),
        });
        let timedOut = await made('nightly', '2026-11-09T08:30:00.000Z', 40);
        await ended(timedOut.id, {
          state: 'error',
          reason: 'timed-out',
          message: 'The run reached its 300-second time limit',
        });
        let capped = await made('nightly', '2026-11-10T08:30:00.000Z', 30);
        await startAutomationRunAttempt(dbAdapter, capped.id, 1);
        await recordAutomationRunAdmitted(dbAdapter, capped.id, 1);
        await endAutomationRunAtCap(dbAdapter, capped.id, 1, 'writes');
        let refused = await made('hourly', '2026-11-10T18:00:00.000Z', 20);
        await ended(
          refused.id,
          {
            state: 'error',
            reason: 'insufficient-credits',
            message: `${PAYER} has 2 credits, less than the run's minimum of 5`,
          },
          { admit: false },
        );

        let { data } = await listed();
        assert.deepEqual(
          data.map(({ attributes: a }) => [
            a.state,
            a.step,
            a.errorReason,
            a.errorMessage,
            a.scriptLine,
            a.cap,
          ]),
          [
            [
              'error',
              'admission',
              'insufficient-credits',
              `${PAYER} has 2 credits, less than the run's minimum of 5`,
              null,
              null,
            ],
            [
              'error',
              'script',
              'hit-a-cap',
              'The run hit its writes cap',
              null,
              'writes',
            ],
            [
              'error',
              'script',
              'timed-out',
              'The run reached its 300-second time limit',
              null,
              null,
            ],
            [
              'error',
              'script',
              'script-error',
              'TypeError: feed.items is undefined',
              7,
              null,
            ],
          ],
          'a run admission refused stays at the admission step: its script never started',
        );
      });

      test('each run lists its milestones: the one a running run is in, and the one a failed run failed in', async function (assert) {
        await writeAutomation();
        let plan = ['Fetch open issues', 'Group by label', 'Write digest'];
        async function reached(runId: string, names: string[]) {
          let at = Date.parse('2026-11-10T18:00:00.000Z');
          await appendRunLog(dbAdapter, runId, [
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
        }
        let failed = await made('nightly', '2026-11-09T08:30:00.000Z', 20);
        await recordAutomationRunAdmitted(dbAdapter, failed.id, 1);
        await reached(failed.id, ['Fetch open issues', 'Group by label']);
        await finishAutomationRun(dbAdapter, failed.id, 1, {
          state: 'error',
          reason: 'script-error',
          message: scriptErrorText('TypeError: labels is undefined', 12),
        });
        let running = await made('nightly', '2026-11-10T08:30:00.000Z', 10);
        await recordAutomationRunAdmitted(dbAdapter, running.id, 1);
        await reached(running.id, ['Fetch open issues']);

        let { data } = await listed();
        let [inProgress, ended] = data.map(({ attributes }) => attributes);
        assert.deepEqual(
          [
            inProgress.milestones?.current,
            inProgress.milestones?.milestones.map(({ name }) => name),
            inProgress.milestones?.ahead,
          ],
          [
            'Fetch open issues',
            ['Fetch open issues'],
            ['Group by label', 'Write digest'],
          ],
          'a running run is in its last milestone, with the rest of the plan ahead',
        );
        assert.deepEqual(
          [ended.milestones?.failedIn, ended.milestones?.ahead],
          ['Group by label', ['Write digest']],
          'a failed run names the milestone it failed in',
        );
      });

      test('each run lists the tasks its script reported under the milestone each task belongs to', async function (assert) {
        await writeAutomation();
        let at = Date.parse('2026-11-10T18:00:00.000Z');
        let line = (
          offset: number,
          kind: 'milestone' | 'task',
          text: string,
        ) => ({
          at: at + offset,
          source: 'script' as const,
          kind,
          message: `${kind === 'task' ? 'Task' : 'Milestone'}: ${text}`,
          data: kind === 'task' ? { text } : { name: text },
        });
        let ended = await made('nightly', '2026-11-09T08:30:00.000Z', 20);
        await recordAutomationRunAdmitted(dbAdapter, ended.id, 1);
        await appendRunLog(dbAdapter, ended.id, [
          line(0, 'milestone', 'Fetch open issues'),
          line(100, 'task', 'Fetched 42 open issues'),
          line(1_000, 'milestone', 'Group by label'),
        ]);
        let running = await made('nightly', '2026-11-10T08:30:00.000Z', 10);
        await recordAutomationRunAdmitted(dbAdapter, running.id, 1);
        await appendRunLog(dbAdapter, running.id, [
          line(0, 'milestone', 'Fetch open issues'),
          line(100, 'task', 'Skipped 3 archived issues'),
          line(200, 'task', 'Fetched 17 open issues'),
        ]);

        let { data } = await listed();
        let byRun = new Map(
          data.map(({ id, attributes }) => [
            id,
            attributes.milestones?.milestones.map(({ name, tasks }) => [
              name,
              tasks.map(({ text }) => text),
            ]),
          ]),
        );
        assert.deepEqual(
          byRun.get(running.id),
          [
            [
              'Fetch open issues',
              ['Skipped 3 archived issues', 'Fetched 17 open issues'],
            ],
          ],
          'a running run lists the tasks of the milestone the run is in, in order',
        );
        assert.deepEqual(
          byRun.get(ended.id),
          [
            ['Fetch open issues', ['Fetched 42 open issues']],
            ['Group by label', []],
          ],
          'each task sits under the milestone the run was in when the script reported the task',
        );
      });

      test('every waiting run names the running run as what the run waits for, or waits for a worker when none runs', async function (assert) {
        await writeAutomation();
        let earlier = await made('nightly', '2026-11-10T08:30:00.000Z', 40, {
          waiting: true,
        });
        let later = await made('hourly', '2026-11-10T18:00:00.000Z', 30, {
          waiting: true,
        });
        let byWaiting = async () =>
          new Map(
            (await listed()).data.map(({ id, attributes }) => [
              id,
              attributes.waitingFor,
            ]),
          );
        let waiting = await byWaiting();
        assert.deepEqual(
          [waiting.get(earlier.id), waiting.get(later.id)],
          [{ kind: 'worker' }, { kind: 'worker' }],
          'with nothing running, every waiting run waits for a worker',
        );

        let running = await made('manual', randomUUID(), 20);
        await recordAutomationRunAdmitted(dbAdapter, running.id, 1);
        waiting = await byWaiting();
        let ahead = {
          kind: 'run',
          runId: running.id,
          startedBy: 'run-now',
          trigger: null,
          slot: null,
          state: 'running',
        };
        assert.deepEqual(
          [waiting.get(earlier.id), waiting.get(later.id)],
          [ahead, ahead],
          'each waiting run names the running run, not the waiting run made just before it',
        );
      });

      test('a canceled run lists who canceled it, and a pause no person asked for lists its reason', async function (assert) {
        await writeAutomation();
        await switchOn();
        let byPerson = await made('nightly', '2026-11-10T08:30:00.000Z', 20);
        await cancelAutomationRun(dbAdapter, byPerson.id, PAYER);
        let byPause = await made('hourly', '2026-11-10T18:00:00.000Z', 10);
        await query(dbAdapter, [
          `UPDATE automations SET caps_snapshot = jsonb_set(caps_snapshot, '{writes}', '1') WHERE automation_id =`,
          param(automationURL()),
        ]);
        let paused = await checkAutomationCaps(
          dbAdapter,
          rri(automationURL()),
          await indexedDeclaration(),
        );
        assert.deepEqual(
          [paused?.state, paused?.pauseReason],
          ['paused', 'caps-raised'],
          'a card asking for more than its caps snapshot pauses it',
        );

        let { data } = await listed();
        assert.deepEqual(
          data.map(({ id, attributes: a }) => [
            id,
            a.state,
            a.errorReason,
            a.canceledBy,
            a.canceledByAPerson,
            a.viewerCanceled,
          ]),
          [
            [byPause.id, 'canceled', 'caps-raised', null, false, false],
            [byPerson.id, 'canceled', null, PAYER, true, false],
          ],
        );
        let own = (await listed(PAYER)).data[1].attributes;
        assert.deepEqual(
          [own.canceledBy, own.viewerCanceled],
          [PAYER, true],
          'the person who canceled it reads as the viewer',
        );
      });

      test("a person's pause lists them as who canceled each run, and the pause as why", async function (assert) {
        await writeAutomation();
        await switchOn();
        let running = await made('nightly', '2026-11-10T08:30:00.000Z', 20);
        let paused = await pauseAutomation(
          dbAdapter,
          { automationId: rri(automationURL()), user: ADMIN },
          options(),
        );
        assert.true(paused.ok, 'the automation pauses');
        let run = (await listed()).data.find(({ id }) => id === running.id);
        assert.deepEqual(
          [
            run?.attributes.state,
            run?.attributes.errorReason,
            run?.attributes.canceledBy,
            run?.attributes.canceledByAPerson,
          ],
          ['canceled', 'requested', ADMIN, true],
        );
      });

      test('who canceled a run and who it acts as are hidden from a writer who shares no grant with them', async function (assert) {
        await writeAutomation();
        let run = await made('manual', randomUUID(), 10, { actsAs: PAYER });
        await cancelAutomationRun(dbAdapter, run.id, PAYER);
        await query(dbAdapter, [
          `DELETE FROM realm_user_permissions WHERE username =`,
          param(PAYER),
          `AND realm_url =`,
          param(testRealm.url),
        ]);
        let [hidden] = (await listed()).data;
        assert.deepEqual(
          [
            hidden.attributes.canceledBy,
            hidden.attributes.canceledByAPerson,
            hidden.attributes.actsAs,
            hidden.attributes.viewerIsActsAs,
          ],
          [null, true, null, false],
          'a person canceled it, and the run acts as a person, but not who',
        );

        await insertPermissions(dbAdapter, new URL(ELSEWHERE), {
          [PAYER]: ['read'],
          [ADMIN]: ['read'],
        });
        let [shown] = (await listed()).data;
        assert.deepEqual(
          [shown.attributes.canceledBy, shown.attributes.actsAs],
          [PAYER, PAYER],
          'a grant that names both of them in another realm is enough',
        );
      });

      test('a slot that joined a run still waiting to start lists under that run', async function (assert) {
        await writeAutomation();
        await switchOn();
        let declaration = await indexedDeclaration();
        let publisher = new PgQueuePublisher(dbAdapter as PgAdapter);
        try {
          let tick = (now: number) =>
            tickAutomations(dbAdapter, {
              queue: publisher,
              virtualNetwork: createVirtualNetwork(),
              readDeclaration: async () => ({ ok: true, declaration }),
              now,
            });
          // The hourly trigger's 13:00 run is still waiting for a worker when
          // 14:00 comes due.
          let one = zonedDateTimeToUnixSeconds(
            '2026-11-10T13:00',
            'America/Chicago',
          );
          await tick(one + 30);
          await tick(one + 3600 + 30);
        } finally {
          await publisher.destroy();
        }
        let { data } = await listed();
        assert.strictEqual(data.length, 1, 'the joined slot started no run');
        let [run] = data;
        assert.deepEqual(
          [run.attributes.trigger, run.attributes.slot, run.attributes.state],
          ['hourly', '2026-11-10T19:00:00.000Z', 'pending'],
        );
        assert.deepEqual(
          run.attributes.waitingFor,
          { kind: 'worker' },
          'with no run ahead of it, the run waits for a worker',
        );
        assert.deepEqual(
          run.attributes.joined.map(({ trigger, slot }) => ({ trigger, slot })),
          [{ trigger: 'hourly', slot: '2026-11-10T20:00:00.000Z' }],
          'the 14:00 slot joined the 13:00 run',
        );
        assert.ok(run.attributes.joined[0].at, 'with when it joined');
      });

      test('the runs come a page at a time, with how many pages they fill', async function (assert) {
        await writeAutomation();
        let runs = [];
        for (let i = 0; i < 5; i++) {
          runs.push(await made('manual', randomUUID(), 50 - i * 10));
        }
        let newestFirst = runs.map((run) => run.id).reverse();
        for (let [page, ids] of [
          ['1', newestFirst.slice(0, 2)],
          ['2', newestFirst.slice(2, 4)],
          ['3', newestFirst.slice(4)],
          ['4', []],
        ] as const) {
          let { data, meta } = await listed(ADMIN, { limit: '2', page });
          assert.deepEqual(
            [data.map(({ id }) => id), meta.page, meta.pages, meta.total],
            [ids, Number(page), 3, 5],
            `page ${page}`,
          );
        }

        for (let [name, value] of [
          ['limit', '0'],
          ['limit', '101'],
          ['limit', 'ten'],
          ['page', '0'],
          ['page', 'two'],
          ['page', '1000000000000000000'],
        ]) {
          let response = await runsOf(ADMIN, ['read', 'write'], {
            automation: automationURL(),
            [name]: value,
          });
          assert.strictEqual(response.status, 400, `a ${name} of ${value}`);
        }
      });

      test("another automation's runs are never listed", async function (assert) {
        await writeAutomation();
        let own = await made('manual', randomUUID(), 10);
        let other = await createAutomationRun(dbAdapter, {
          automationId: rri(`${testRealm.url}automations/weekly`),
          realm: ri(testRealm.url),
          trigger: 'manual',
          slot: randomUUID(),
          actsAs: ADMIN,
        });
        await startAutomationRunAttempt(dbAdapter, other.id, 1);
        let { data, meta } = await listed();
        assert.deepEqual([data.map(({ id }) => id), meta.total], [[own.id], 1]);
      });

      test('a reader is listed nothing, a malformed request is refused, and an anonymous caller gets 401', async function (assert) {
        await writeAutomation();
        await made('manual', randomUUID(), 10);
        let reader = await runsOf(READER, ['read']);
        assert.deepEqual(
          [reader.status, reader.body],
          [200, { data: [], meta: { directWriter: false } }],
          "a reader isn't refused, since the host takes a refusal as an auth failure of what it renders",
        );
        let unchecked = await runsOf(READER, ['read'], null);
        assert.deepEqual(
          [unchecked.status, unchecked.body],
          [200, { data: [], meta: { directWriter: false } }],
          'the route checks its parameters only for a direct writer',
        );

        let missing = await runsOf(ADMIN, ['read', 'write'], null);
        assert.strictEqual(missing.status, 400, 'no automation named');
        let elsewhere = await runsOf(ADMIN, ['read', 'write'], {
          automation: `${ELSEWHERE}automations/nightly`,
        });
        assert.strictEqual(elsewhere.status, 400, 'a card in another realm');

        let anonymous = await request
          .get(
            `/_automation-runs?automation=${encodeURIComponent(automationURL())}`,
          )
          .set('Accept', SupportedMimeType.JSON);
        assert.strictEqual(anonymous.status, 401);
      });
    });

    // The route the realm config's Automations entry and the automations
    // console list a realm's automations from.
    module('automation notices', function () {
      // A run of the automation's own (a trigger's), ended with `outcome`.
      // A refusal at admission logs the operation it refused, as a run's
      // admission does.
      async function endedRun(
        outcome:
          | { state: 'complete' }
          | { state: 'error'; reason: string; message: string },
        refused?: { operation: string; module: string; name: string },
      ) {
        let run = await createAutomationRun(dbAdapter, {
          automationId: rri(automationURL()),
          realm: ri(testRealm.url),
          trigger: 'nightly',
          slot: randomUUID(),
          actsAs: PAYER,
        });
        await startAutomationRunAttempt(dbAdapter, run.id, 1);
        if (refused) {
          await logRunPlatformLine(dbAdapter, run.id, {
            kind: 'admission',
            level: 'error',
            message: 'Admission refused the run',
            data: {
              admitted: false,
              reason: outcome.state === 'error' ? outcome.reason : null,
              actsAs: PAYER,
              operation: refused.operation,
              targetModule: refused.module,
              targetName: refused.name,
            },
          });
        } else {
          await recordAutomationRunAdmitted(dbAdapter, run.id, 1);
        }
        await finishAutomationRun(dbAdapter, run.id, 1, outcome);
        return run;
      }

      async function setState(
        state: string,
        pauseReason: string | null = null,
      ) {
        await query(dbAdapter, [
          'UPDATE automations SET state =',
          param(state),
          ', pause_reason =',
          param(pauseReason),
          ', next_run = NULL, updated_at = clock_timestamp() WHERE automation_id =',
          param(automationURL()),
        ]);
      }

      async function noticeOf(user: string) {
        let response = await statusOf(user, ['read', 'write']);
        if (response.status !== 200) {
          throw new Error(
            `expected the status, got ${response.status}: ${response.text}`,
          );
        }
        let attributes = attributesOf(response.body);
        return attributes.switchedOn ? attributes.notice : undefined;
      }

      function noticesRoute(user: string) {
        return request
          .get('/_automation-notices')
          .set('Accept', SupportedMimeType.JSONAPI)
          .set(
            'Authorization',
            `Bearer ${createRealmServerJWT(
              { user, sessionRoom: 'test-session' },
              realmSecretSeed,
            )}`,
          );
      }

      test('an active automation whose runs complete has no notice', async function (assert) {
        await writeAutomation();
        await switchOn();
        await endedRun({ state: 'complete' });
        assert.strictEqual(await noticeOf(PAYER), null);
      });

      test('a pause a realm administrator asked for raises no notice', async function (assert) {
        await writeAutomation();
        await switchOn();
        await pauseAutomation(
          dbAdapter,
          { automationId: rri(automationURL()), user: ADMIN },
          options(),
        );
        assert.strictEqual(await noticeOf(PAYER), null);
        assert.strictEqual(await noticeOf(ADMIN), null);
      });

      test('a pause after repeated failures tells the payer, with the last failed run, once however many runs failed', async function (assert) {
        await writeAutomation();
        await switchOn();
        await endedRun({
          state: 'error',
          reason: 'script-error',
          message: 'first',
        });
        let last = await endedRun({
          state: 'error',
          reason: 'script-error',
          message: 'second',
        });
        await setState('paused', 'repeated-failures');
        let notice = await noticeOf(PAYER);
        assert.strictEqual(notice?.reason, 'repeated-failures');
        assert.strictEqual(notice?.audience, 'payer');
        assert.true(notice?.forViewer, 'the payer is told');
        assert.strictEqual(notice?.run?.runId, last.id, 'the last failure');
        assert.strictEqual(notice?.run?.message, 'second');
        let other = await noticeOf(ADMIN);
        assert.strictEqual(other?.reason, 'repeated-failures');
        assert.false(other?.forViewer, 'another direct writer is not told');

        let listed = await noticesRoute(PAYER);
        assert.strictEqual(listed.status, 200);
        assert.deepEqual(
          listed.body.data.map(
            (resource: { id: string; attributes: { reason: string } }) => [
              resource.id,
              resource.attributes.reason,
            ],
          ),
          [[automationURL(), 'repeated-failures']],
          'one notice for the automation, not one per failed run',
        );
        assert.strictEqual(listed.body.meta.total, 1);
        let other_ = await noticesRoute(ADMIN);
        assert.deepEqual(other_.body.data, [], 'the route lists none to ADMIN');
      });

      test('a payer whose account can no longer pay leaves the notice to every direct writer', async function (assert) {
        await writeAutomation();
        await switchOn();
        await setState('paused', 'payer-lost-access');
        let notice = await noticeOf(ADMIN);
        assert.strictEqual(notice?.reason, 'payer-lost-access');
        assert.strictEqual(notice?.audience, 'direct-writers');
        assert.true(notice?.forViewer, 'another direct writer is told');
        assert.true(
          (await noticeOf(PAYER))?.forViewer,
          'a payer who still writes the realm directly, whose sessions were revoked, is told too',
        );
        let listed = await noticesRoute(ADMIN);
        assert.deepEqual(
          listed.body.data.map(
            (resource: { attributes: { realm: string } }) =>
              resource.attributes.realm,
          ),
          [testRealm.url],
          'the notice names the realm',
        );
      });

      test('a pause a person has to act on tells the payer; a webhook whose owner lost access tells every direct writer', async function (assert) {
        await writeAutomation();
        await switchOn();
        for (let reason of [
          'caps-raised',
          'batched-ai-enabled',
          'webhook-changed',
          'invalid-declaration',
        ]) {
          await setState('paused', reason);
          let notice = await noticeOf(PAYER);
          assert.strictEqual(notice?.reason, reason);
          assert.true(notice?.forViewer, `${reason} tells the payer`);
          assert.false(
            (await noticeOf(ADMIN))?.forViewer,
            `${reason} tells no one else`,
          );
        }
        await setState('paused', 'webhook-owner-lost-access');
        assert.true((await noticeOf(PAYER))?.forViewer);
        assert.true((await noticeOf(ADMIN))?.forViewer);
      });

      test('waiting for key approval names the operation a refused run needs, and ends once the automation is active again', async function (assert) {
        await writeAutomation();
        await switchOn();
        await setState('waiting-for-key-approval');
        let waiting = await noticeOf(PAYER);
        assert.strictEqual(
          waiting?.reason,
          'waiting-for-key-approval',
          'a wait from switch-on or an edit names no run',
        );
        assert.strictEqual(waiting?.run, null);

        let refused = await endedRun(
          {
            state: 'error',
            reason: 'binding-needs-reapproval',
            message: 'The declared operation "fetch" was refused',
          },
          {
            operation: 'fetch',
            module: `${testRealm.url}weather`,
            name: 'Weather',
          },
        );
        let notice = await noticeOf(PAYER);
        assert.strictEqual(notice?.reason, 'binding-needs-reapproval');
        assert.strictEqual(notice?.run?.runId, refused.id);
        assert.deepEqual(notice?.operation, {
          name: 'fetch',
          module: `${testRealm.url}weather`,
          typeName: 'Weather',
        });
        assert.false((await noticeOf(ADMIN))?.forViewer);

        await endedRun(
          {
            state: 'error',
            reason: 'share-suspended',
            message: 'The share is suspended',
          },
          {
            operation: 'fetch',
            module: `${testRealm.url}weather`,
            name: 'Weather',
          },
        );
        let suspended = await noticeOf(ADMIN);
        assert.strictEqual(suspended?.reason, 'share-suspended');
        assert.true(
          suspended?.forViewer,
          'a suspended share tells every direct writer',
        );

        await setState('active');
        assert.strictEqual(
          await noticeOf(PAYER),
          null,
          'the notice ends once the last approval lands',
        );

        // An edit puts the automation back in waiting for another
        // operation: the earlier refusal belongs to a wait that ended.
        await setState('waiting-for-key-approval');
        let rewaiting = await noticeOf(PAYER);
        assert.strictEqual(
          rewaiting?.reason,
          'waiting-for-key-approval',
          'a refusal from an earlier wait names no operation',
        );
        assert.strictEqual(rewaiting?.operation, null);
        assert.strictEqual(rewaiting?.run, null);
      });

      test('a run from before the automation’s latest switch-on or resume raises no notice', async function (assert) {
        await writeAutomation();
        await switchOn();
        let row = (await getAutomation(dbAdapter, rri(automationURL())))!;
        await endedRun({
          state: 'error',
          reason: 'credential-rejected',
          message: 'The vendor refused the connection',
        });
        let credentialNotices = async () => [
          {
            kind: 'reconnect' as const,
            keyId: 'key-1',
            recipients: [PAYER],
          },
        ];
        assert.strictEqual(
          (
            await automationNotices(dbAdapter, [row], {
              viewer: PAYER,
              credentialNotices,
            })
          ).get(row.automationId)?.reason,
          'credential-rejected',
        );
        // A resume (or a remove and a later switch-on) starts the schedule
        // again.
        await query(dbAdapter, [
          'UPDATE automations SET scheduled_since = clock_timestamp() WHERE automation_id =',
          param(automationURL()),
        ]);
        assert.strictEqual(
          (
            await automationNotices(dbAdapter, [row], {
              viewer: PAYER,
              credentialNotices,
            })
          ).get(row.automationId),
          undefined,
          'the run before the resume is not the automation’s latest run of its own',
        );
      });

      test('waiting for credits tells the payer, and ends once a run is admitted', async function (assert) {
        await writeAutomation();
        await switchOn();
        let refused = await endedRun({
          state: 'error',
          reason: 'insufficient-credits',
          message: 'The balance is short',
        });
        await setState('waiting-for-credits');
        let notice = await noticeOf(PAYER);
        assert.strictEqual(notice?.reason, 'waiting-for-credits');
        assert.strictEqual(notice?.run?.runId, refused.id);
        await setState('active');
        assert.strictEqual(await noticeOf(PAYER), null);
      });

      test('a run that ended on a rejected credential tells whom the credential’s fix is for, until the credential is fixed or a later run gets past it', async function (assert) {
        await writeAutomation();
        await switchOn();
        let rejected = await endedRun({
          state: 'error',
          reason: 'credential-rejected',
          message: 'The vendor refused the connection',
        });
        let row = (await getAutomation(dbAdapter, rri(automationURL())))!;
        let current: AutomationCredentialNotice[] = [
          { kind: 'reconnect', keyId: 'key-1', recipients: [PAYER] },
        ];
        let asked: string[] = [];
        let credentialNotices = async (run: { id: string }) => {
          asked.push(run.id);
          return current;
        };
        let notice = (
          await automationNotices(dbAdapter, [row], {
            viewer: PAYER,
            credentialNotices,
          })
        ).get(row.automationId);
        assert.strictEqual(notice?.reason, 'credential-rejected');
        assert.deepEqual(notice?.credential, {
          kind: 'reconnect',
          keyId: 'key-1',
        });
        assert.true(notice?.forViewer);
        assert.strictEqual(notice?.run?.runId, rejected.id);
        assert.deepEqual(asked, [rejected.id]);
        assert.false(
          (
            await automationNotices(dbAdapter, [row], {
              viewer: ADMIN,
              credentialNotices,
            })
          ).get(row.automationId)?.forViewer,
          'a reconnect is for the payer alone',
        );

        current = [];
        assert.strictEqual(
          (
            await automationNotices(dbAdapter, [row], {
              viewer: PAYER,
              credentialNotices,
            })
          ).get(row.automationId),
          undefined,
          'a fixed credential ends the notice',
        );

        current = [
          { kind: 'fix-share', shareId: 'share-1', recipients: [PAYER, ADMIN] },
        ];
        assert.true(
          (
            await automationNotices(dbAdapter, [row], {
              viewer: ADMIN,
              credentialNotices,
            })
          ).get(row.automationId)?.forViewer,
          'a broken share tells the realm’s direct writers',
        );

        await endedRun({ state: 'complete' });
        assert.strictEqual(
          (
            await automationNotices(dbAdapter, [row], {
              viewer: ADMIN,
              credentialNotices,
            })
          ).get(row.automationId),
          undefined,
          'a later run that completes ends the notice',
        );
      });

      test('the automation list carries each automation’s notice', async function (assert) {
        await writeAutomation();
        await switchOn();
        await setState('paused', 'payer-lost-access');
        let response = await request
          .get('/_automations')
          .set('Accept', SupportedMimeType.JSON)
          .set(
            'Authorization',
            `Bearer ${createJWT(testRealm, ADMIN, ['read', 'write'])}`,
          );
        let [entry] = (response.body as AutomationListDocument).data;
        assert.strictEqual(
          entry.attributes.notice?.reason,
          'payer-lost-access',
        );
        assert.true(entry.attributes.notice?.forViewer);
      });

      test('the notices route lists nothing to a reader or a stranger', async function (assert) {
        await writeAutomation();
        await switchOn();
        await setState('paused', 'webhook-owner-lost-access');
        for (let user of [READER, STRANGER]) {
          let response = await noticesRoute(user);
          assert.strictEqual(response.status, 200);
          assert.deepEqual(response.body, { data: [], meta: { total: 0 } });
        }
        assert.strictEqual((await noticesRoute(ADMIN)).body.meta.total, 1);
      });
    });

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
        assert.deepEqual(response.body, {
          data: [],
          meta: { directWriter: true },
        });
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
          notice: null,
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
        assert.deepEqual(
          status.switchedOn
            ? [status.monthlyCredits, status.spentThisMonth]
            : [],
          [500, 42],
          "the card's status reads the same cap and spend",
        );
      });

      test('a paused, waiting or done automation lists that state, and a running one the milestone its run is in with the last task inside it', async function (assert) {
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
            kind: 'task',
            message: 'Task: Imported the March invoices',
            data: { text: 'Imported the March invoices' },
          },
        ]);
        [entry] = await entries();
        assert.deepEqual(entry.attributes.currentRun, {
          runId: created.id,
          startedAt: entry.attributes.currentRun?.startedAt ?? null,
          milestone: 'Import',
          task: 'Imported the March invoices',
        });
        assert.ok(entry.attributes.currentRun?.startedAt, 'with its start');
      });

      test('an automation lists how its last run ended, switched on or not, and the status reads the same', async function (assert) {
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

        await switchOn();
        [entry] = await entries();
        assert.true(entry.attributes.switchedOn);
        assert.strictEqual(
          entry.attributes.lastResult,
          'error',
          'a switched-on automation lists its last run too',
        );
        let status = (
          (await statusOf(ADMIN, ['read', 'write']))
            .body as AutomationStatusDocument
        ).data.attributes;
        assert.deepEqual(
          status.switchedOn ? [status.lastResult, status.lastFinishedAt] : [],
          ['error', entry.attributes.lastFinishedAt],
          "the card's status reads the same last run",
        );
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

      test('an automation whose card the index lacks leaves out a trigger an earlier edit removed', async function (assert) {
        await writeAutomation();
        await switchOn();
        await testRealm.write(
          'automations/nightly.json',
          JSON.stringify({
            data: {
              type: 'card',
              attributes: {
                ...attributes,
                triggers: attributes.triggers.filter(
                  (t: Record<string, unknown>) => t.label !== 'hourly',
                ),
              },
              relationships: {
                script: { links: { self: '../scripts/nightly-import.js' } },
              },
              meta: { adoptsFrom: automationRef },
            },
          }),
        );
        await query(dbAdapter, [
          `UPDATE boxel_index SET is_deleted = TRUE WHERE url =`,
          param(`${automationURL()}.json`),
          `OR file_alias =`,
          param(automationURL()),
        ]);
        let [entry] = await entries();
        assert.deepEqual(
          entry.attributes.triggers
            .map(({ label }: { label: string }) => label)
            .sort(),
          ['launch', 'nightly', 'push'],
          'the list names the triggers of the last edit the card read in',
        );
      });

      test('a reader is listed nothing, and an anonymous caller is refused', async function (assert) {
        await writeAutomation();
        await switchOn();
        let reader = await list(READER, ['read']);
        assert.strictEqual(
          reader.status,
          200,
          "a reader isn't refused, since the host takes a refusal as an auth failure of what it renders",
        );
        assert.deepEqual(
          reader.body,
          { data: [], meta: { directWriter: false } },
          'a reader is told it is not a direct writer, and listed nothing',
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

    test("a writer the users grant admits is shown no automation's status, since the grant names no one", async function (assert) {
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
      assert.strictEqual(response.status, 200, 'HTTP 200');
      assert.deepEqual(
        response.body,
        { data: null, meta: { directWriter: false } },
        'the grant names no one, so the writer is not a direct writer',
      );
    });

    test('a writer the users grant admits is listed no webhooks', async function (assert) {
      await ensureTestUser(usersDB, STRANGER);
      await insertIncomingWebhookRow(usersDB, {
        username: STRANGER,
        webhookPath: 'users-grant-hook',
        signingSecret: 'users-grant-secret',
      });
      let response = await usersRequest
        .get('/_automation-webhooks')
        .set('Accept', SupportedMimeType.JSON)
        .set(
          'Authorization',
          `Bearer ${createJWT(usersRealm, STRANGER, ['read', 'write'])}`,
        );
      assert.strictEqual(response.status, 200, 'HTTP 200');
      assert.deepEqual(
        response.body,
        { data: [], meta: { directWriter: false } },
        'the grant names no one, so the writer is not a direct writer',
      );
    });

    test('a writer the users grant admits is listed no automations', async function (assert) {
      await ensureTestUser(usersDB, STRANGER);
      let response = await usersRequest
        .get('/_automations')
        .set('Accept', SupportedMimeType.JSON)
        .set(
          'Authorization',
          `Bearer ${createJWT(usersRealm, STRANGER, ['read', 'write'])}`,
        );
      assert.strictEqual(response.status, 200, 'HTTP 200');
      assert.deepEqual(
        response.body,
        { data: [], meta: { directWriter: false } },
        'the grant names no one, so the writer is not a direct writer',
      );
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

    test('an anonymous reader is shown nothing', async function (assert) {
      let response = await status();
      assert.strictEqual(response.status, 200, 'HTTP 200');
      assert.deepEqual(response.body, {
        data: null,
        meta: { directWriter: false },
      });
    });

    test("a direct writer's revoked session asks as no one", async function (assert) {
      let session = backdatedSession(ADMIN);
      assert.strictEqual(
        (await status(`Bearer ${session}`)).status,
        200,
        'the session answers before it is revoked',
      );
      await revokeUserSessions(publicDB, ADMIN);
      assert.deepEqual(
        (await status(`Bearer ${session}`)).body,
        { data: null, meta: { directWriter: false } },
        'the revoked session asks as no one, and is shown nothing',
      );
    });
  });

  // A grant can let someone read an Automation card whom the realm's ACL gives
  // nothing. The card's view, its editor and the realm config ask these
  // routes while they render, and the host takes a 401 or 403 as an auth
  // failure of whatever else it is loading, so such a caller is told they
  // aren't a direct writer rather than refused.
  module(
    'a realm whose policy admits a caller its ACL gives nothing',
    function (hooks) {
      const NOT_A_DIRECT_WRITER = { data: null, meta: { directWriter: false } };
      const LISTED_NOTHING = { data: [], meta: { directWriter: false } };

      let policyRealm: Realm;
      let policyRequest: SuperTest<Test>;
      let policyServer: Server;
      let policyDB: PgAdapter;

      hooks.afterEach(async function () {
        await closeServer(policyServer);
      });

      setupPermissionedRealmCached(hooks, {
        fixture: 'blank',
        permissions: {
          '@node-test_realm:localhost': ['read', 'realm-owner'],
          [ADMIN]: ['read', 'write'],
        },
        onRealmSetup(args) {
          policyRealm = args.testRealm;
          policyRequest = args.request;
          policyServer = args.testRealmHttpServer;
          policyDB = args.dbAdapter as PgAdapter;
        },
      });

      function automationURL() {
        return `${policyRealm.url}automations/nightly`;
      }

      // The automation card, a run of it, and a webhook its trigger names, so
      // each route has something a direct writer is shown.
      async function writeAutomation() {
        await policyRealm.write(
          'scripts/nightly-import.js',
          "await realm.fs.writeText('imported.txt', 'done');\n",
        );
        await policyRealm.write(
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
        await createAutomationRun(policyDB, {
          automationId: rri(automationURL()),
          realm: ri(policyRealm.url),
          trigger: 'nightly',
          slot: '2026-11-10T08:30:00.000Z',
          actsAs: ADMIN,
        });
        await insertIncomingWebhookRow(policyDB, {
          username: ADMIN,
          webhookPath: 'github-push',
          signingSecret: 'admin-secret',
        });
      }

      // Points the realm at a policy that lets any signed-in caller read an
      // automation.
      async function nameAPolicy() {
        await policyRealm.write(
          'policies/automations.json',
          JSON.stringify({
            data: {
              type: 'card',
              attributes: {
                rules: [
                  {
                    targetType: automationRef,
                    grants: [
                      // Names no caller, so it admits only signed-in ones.
                      { operation: 'read' },
                    ],
                  },
                ],
              },
              meta: {
                adoptsFrom: {
                  module: rri('@cardstack/catalog/realm-policy/realm-policy'),
                  name: 'RealmPolicy',
                },
              },
            },
          }),
        );
        await policyRealm.write(
          'realm.json',
          realmConfigCardJSON({
            policy: `${policyRealm.url}policies/automations`,
          }),
        );
        await policyRealm.indexing();
      }

      // What the routes a card's view, its editor and the realm config read
      // answer the caller `authorization` names.
      async function answers(authorization: string) {
        let ask = (path: string) =>
          policyRequest
            .get(path)
            .set('Accept', SupportedMimeType.JSON)
            .set('Authorization', authorization);
        let automation = encodeURIComponent(automationURL());
        return {
          status: await ask(`/_automation-status?automation=${automation}`),
          statusNamingNoCard: await ask('/_automation-status'),
          runs: await ask(`/_automation-runs?automation=${automation}`),
          automations: await ask('/_automations'),
          webhooks: await ask('/_automation-webhooks'),
        };
      }

      function signedIn(
        user: string,
        permissions: ('read' | 'write' | 'realm-owner')[] = [],
      ) {
        return `Bearer ${createJWT(policyRealm, user, permissions)}`;
      }

      function assertToldNotADirectWriter(
        assert: Assert,
        answered: Awaited<ReturnType<typeof answers>>,
        who: string,
      ) {
        assert.deepEqual(
          Object.fromEntries(
            Object.entries(answered).map(([route, response]) => [
              route,
              [response.status, response.body],
            ]),
          ),
          {
            status: [200, NOT_A_DIRECT_WRITER],
            statusNamingNoCard: [200, NOT_A_DIRECT_WRITER],
            runs: [200, LISTED_NOTHING],
            automations: [200, LISTED_NOTHING],
            webhooks: [200, LISTED_NOTHING],
          },
          `${who} is told by every route that they aren't a direct writer, and shown nothing`,
        );
        for (let [route, response] of Object.entries(answered)) {
          assert.strictEqual(
            response.headers['cache-control'],
            'no-store',
            `${who}: ${route} is not cached`,
          );
        }
      }

      test('a realm with no policy refuses a signed-in caller its ACL gives nothing', async function (assert) {
        await writeAutomation();
        let answered = await answers(signedIn(STRANGER));
        assert.deepEqual(
          Object.values(answered).map((response) => response.status),
          [403, 403, 403, 403, 403],
          'no policy judges the caller, so the ACL refuses them',
        );
      });

      test("a signed-in caller the policy admits to the card is told by every route that they aren't a direct writer", async function (assert) {
        await writeAutomation();
        await nameAPolicy();
        let card = await policyRequest
          .get('/automations/nightly')
          .set('Accept', SupportedMimeType.CardJson)
          .set('Authorization', signedIn(STRANGER));
        assert.strictEqual(
          card.status,
          200,
          'the grant admits them to the card',
        );

        assertToldNotADirectWriter(
          assert,
          await answers(signedIn(STRANGER)),
          'the caller the policy admits',
        );

        let admin = await answers(signedIn(ADMIN, ['read', 'write']));
        assert.deepEqual(
          [
            admin.status.body.meta,
            admin.runs.body.meta.total,
            admin.automations.body.data.length,
            admin.webhooks.body.data.length,
          ],
          [{ directWriter: true }, 1, 1, 1],
          'a direct writer is shown the automation, its run and the webhook',
        );
      });

      test("an archived realm tells a caller the policy admits the same, and not that it's archived", async function (assert) {
        await writeAutomation();
        await nameAPolicy();
        await archiveRealm(policyDB, new URL(policyRealm.url));
        let sealed = (await answers(signedIn(ADMIN, ['read', 'write']))).status;
        assert.deepEqual(
          [sealed.status, sealed.headers['x-boxel-realm-archived']],
          [403, 'true'],
          'the realm is sealed: a direct writer meets the archived seal',
        );
        let answered = await answers(signedIn(STRANGER));
        assertToldNotADirectWriter(
          assert,
          answered,
          'the caller the policy admits to an archived realm',
        );
        for (let [route, response] of Object.entries(answered)) {
          assert.notOk(
            response.headers['x-boxel-realm-archived'],
            `${route} carries no archived marker`,
          );
        }
      });
    },
  );
});
