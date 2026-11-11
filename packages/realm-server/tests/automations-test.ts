import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  capsRaisedAbove,
  checkAutomationCaps,
  checkAutomationPayer,
  createAutomationRun,
  getAutomation,
  getAutomationRun,
  insertPermissions,
  pauseAutomation,
  removeAutomation,
  resumeAutomation,
  ri,
  rri,
  startAutomationRunAttempt,
  switchOnAutomation,
  VirtualNetwork,
  type AutomationActorOptions,
  type AutomationRow,
  type DBAdapter,
} from '@cardstack/runtime-common';
import type {
  AutomationCaps,
  AutomationDeclaration,
} from '@cardstack/runtime-common/automation-declaration';
import { zonedDateTimeToUnixSeconds } from '@cardstack/runtime-common/automation-schedule';
import { setupDB } from './helpers/index.ts';

const REALM_URL = 'http://127.0.0.1:4444/payroll/';
const REALM = ri(REALM_URL);
const AUTOMATION = rri(`${REALM_URL}Automation/nightly-sync`);
const OWNER = '@owner:localhost';
const ADMIN = '@admin:localhost';
const READER = '@reader:localhost';

// 2026-11-10 12:00 in Chicago. The automation's daily 05:30 Chicago run
// comes next on the 11th.
const NOW = zonedDateTimeToUnixSeconds('2026-11-10T12:00', 'America/Chicago');
const NEXT_DAILY = zonedDateTimeToUnixSeconds(
  '2026-11-11T05:30',
  'America/Chicago',
);

const CAPS: AutomationCaps = {
  callApiCalls: 20,
  responseBytes: 1_000_000,
  resolveCalls: 5,
  writes: 50,
  seconds: 300,
  dailyCredits: 100,
  monthlyCredits: 2_000,
};

function declaration(
  overrides: Partial<AutomationDeclaration> = {},
): AutomationDeclaration {
  return {
    url: AUTOMATION,
    realmURL: REALM_URL,
    script: rri(`${REALM_URL}scripts/nightly-sync.js`),
    triggers: [
      {
        kind: 'cron',
        label: 'daily',
        expression: '30 5 * * *',
        timeZone: 'America/Chicago',
      },
    ],
    operations: [],
    caps: CAPS,
    params: {},
    batchedAI: false,
    batchDeadlineMinutes: 60,
    ...overrides,
  };
}

module(basename(import.meta.filename), function () {
  module('the automation row', function (hooks) {
    let dbAdapter: DBAdapter;
    let options: AutomationActorOptions;

    setupDB(hooks, {
      beforeEach: async (_dbAdapter) => {
        dbAdapter = _dbAdapter;
        options = {
          matrixServerName: 'localhost',
          virtualNetwork: new VirtualNetwork(),
          now: NOW,
        };
        await insertPermissions(dbAdapter, new URL(REALM_URL), {
          [OWNER]: ['read', 'write', 'realm-owner'],
          [ADMIN]: ['read', 'write'],
          [READER]: ['read'],
        });
      },
    });

    async function switchOn(
      user = OWNER,
      card = declaration(),
    ): Promise<AutomationRow> {
      let result = await switchOnAutomation(
        dbAdapter,
        { automationId: AUTOMATION, realm: REALM, user, declaration: card },
        options,
      );
      if (!result.ok) {
        throw new Error(`expected switch-on, got ${result.reason}`);
      }
      return result.automation;
    }

    async function pendingRun(slot = '2026-11-11T11:30:00.000Z') {
      return await createAutomationRun(dbAdapter, {
        automationId: AUTOMATION,
        realm: REALM,
        trigger: 'daily',
        slot,
        actsAs: OWNER,
      });
    }

    module('switch-on', function () {
      test('a direct writer switches an automation on and becomes its payer, with its caps snapshotted', async function (assert) {
        let automation = await switchOn();
        assert.strictEqual(automation.automationId, AUTOMATION);
        assert.strictEqual(automation.realm, REALM);
        assert.strictEqual(automation.payer, OWNER);
        assert.strictEqual(automation.state, 'active');
        assert.strictEqual(automation.pauseReason, null);
        assert.deepEqual(automation.capsSnapshot, {
          ...CAPS,
          batchedAI: false,
        });
        assert.deepEqual(automation.triggerRuns, {});
        assert.strictEqual(automation.scheduledSince, NOW);
        assert.strictEqual(
          automation.nextRun,
          NEXT_DAILY,
          'the next run is the first slot after switch-on',
        );
        assert.deepEqual(
          await getAutomation(dbAdapter, AUTOMATION),
          automation,
        );
      });

      test('an automation whose triggers are all spent starts done, with no next run', async function (assert) {
        let automation = await switchOn(
          OWNER,
          declaration({
            triggers: [
              {
                kind: 'once',
                label: 'backfill',
                at: NOW - 3600,
                timeZone: 'America/Chicago',
              },
            ],
          }),
        );
        assert.strictEqual(automation.state, 'done');
        assert.strictEqual(automation.nextRun, null);
      });

      test('an automation with only a webhook trigger is active with no next run', async function (assert) {
        let automation = await switchOn(
          OWNER,
          declaration({
            triggers: [
              {
                kind: 'webhook',
                label: 'stripe',
                webhookPath: 'stripe-events',
              },
            ],
          }),
        );
        assert.strictEqual(automation.state, 'active');
        assert.strictEqual(automation.nextRun, null);
      });

      test('someone who is not a direct writer cannot switch an automation on', async function (assert) {
        await insertPermissions(dbAdapter, new URL(REALM_URL), {
          users: ['read', 'write'],
          '@realm/payroll_1:localhost': ['read', 'write'],
        });
        for (let user of [
          READER,
          '@stranger:localhost',
          '@realm/payroll_1:localhost',
        ]) {
          let result = await switchOnAutomation(
            dbAdapter,
            {
              automationId: AUTOMATION,
              realm: REALM,
              user,
              declaration: declaration(),
            },
            options,
          );
          assert.deepEqual(
            result,
            { ok: false, reason: 'not-a-direct-writer' },
            `${user} is refused`,
          );
        }
        assert.strictEqual(
          await getAutomation(dbAdapter, AUTOMATION),
          undefined,
        );
      });

      test('switching on an automation that is already on is refused and keeps its payer', async function (assert) {
        let automation = await switchOn(OWNER);
        let again = await switchOnAutomation(
          dbAdapter,
          {
            automationId: AUTOMATION,
            realm: REALM,
            user: ADMIN,
            declaration: declaration(),
          },
          options,
        );
        assert.deepEqual(again, {
          ok: false,
          reason: 'already-switched-on',
          automation,
        });
      });
    });

    module('pause', function () {
      test('a direct writer pauses an automation, which cancels its pending run and leaves a running one', async function (assert) {
        await switchOn();
        let pending = await pendingRun();
        let running = await pendingRun('2026-11-10T11:30:00.000Z');
        await startAutomationRunAttempt(dbAdapter, running.id, 1);

        let result = await pauseAutomation(
          dbAdapter,
          { automationId: AUTOMATION, user: ADMIN },
          options,
        );
        assert.true(result.ok);
        let automation = (result as { automation: AutomationRow }).automation;
        assert.strictEqual(automation.state, 'paused');
        assert.strictEqual(automation.pauseReason, 'requested');
        assert.strictEqual(automation.pausedBy, ADMIN);
        assert.strictEqual(automation.payer, OWNER, 'pausing keeps the payer');

        let canceled = await getAutomationRun(dbAdapter, pending.id);
        assert.strictEqual(canceled?.state, 'canceled');
        assert.strictEqual(canceled?.canceledBy, ADMIN);
        assert.strictEqual(
          (await getAutomationRun(dbAdapter, running.id))?.state,
          'running',
        );
      });

      test('pausing a paused automation is refused and keeps its reason', async function (assert) {
        await switchOn();
        await pauseAutomation(
          dbAdapter,
          { automationId: AUTOMATION, user: OWNER },
          options,
        );
        let again = await pauseAutomation(
          dbAdapter,
          { automationId: AUTOMATION, user: ADMIN },
          options,
        );
        assert.false(again.ok);
        assert.strictEqual(
          (again as { reason: string }).reason,
          'not-pausable',
        );
        let automation = await getAutomation(dbAdapter, AUTOMATION);
        assert.strictEqual(automation?.pausedBy, OWNER);
      });

      test('someone who is not a direct writer cannot pause an automation', async function (assert) {
        await switchOn();
        let pending = await pendingRun();
        let result = await pauseAutomation(
          dbAdapter,
          { automationId: AUTOMATION, user: READER },
          options,
        );
        assert.deepEqual(result, { ok: false, reason: 'not-a-direct-writer' });
        assert.strictEqual(
          (await getAutomation(dbAdapter, AUTOMATION))?.state,
          'active',
        );
        assert.strictEqual(
          (await getAutomationRun(dbAdapter, pending.id))?.state,
          'pending',
        );
      });

      test('pausing an automation that is not switched on finds nothing', async function (assert) {
        let result = await pauseAutomation(
          dbAdapter,
          { automationId: AUTOMATION, user: OWNER },
          options,
        );
        assert.deepEqual(result, { ok: false, reason: 'missing' });
      });
    });

    module('resume', function () {
      test('another direct writer resumes a paused automation, becomes its payer, and takes a new snapshot', async function (assert) {
        await switchOn(OWNER);
        await dbAdapter.execute(
          `UPDATE automations SET trigger_runs = '{"daily":{"runs":3,"lastSlot":${NOW - 86400}}}'::jsonb`,
        );
        await pauseAutomation(
          dbAdapter,
          { automationId: AUTOMATION, user: OWNER },
          options,
        );

        let later = NOW + 3 * 86400;
        let lowered = { ...CAPS, writes: 10 };
        let result = await resumeAutomation(
          dbAdapter,
          {
            automationId: AUTOMATION,
            user: ADMIN,
            declaration: declaration({ caps: lowered, batchedAI: true }),
          },
          { ...options, now: later },
        );
        assert.true(result.ok);
        let automation = (result as { automation: AutomationRow }).automation;
        assert.strictEqual(automation.payer, ADMIN);
        assert.strictEqual(automation.state, 'active');
        assert.strictEqual(automation.pauseReason, null);
        assert.strictEqual(automation.pausedBy, null);
        assert.deepEqual(automation.capsSnapshot, {
          ...lowered,
          batchedAI: true,
        });
        assert.strictEqual(
          automation.scheduledSince,
          later,
          'the schedule starts again at the resume',
        );
        assert.strictEqual(
          automation.nextRun,
          NEXT_DAILY + 3 * 86400,
          'the slots that passed while paused do not run',
        );
        assert.deepEqual(
          automation.triggerRuns,
          { daily: { runs: 3, lastSlot: NOW - 86400 } },
          'each trigger keeps its run count',
        );
      });

      test('resuming an automation that is not paused is refused', async function (assert) {
        let automation = await switchOn();
        let result = await resumeAutomation(
          dbAdapter,
          {
            automationId: AUTOMATION,
            user: ADMIN,
            declaration: declaration(),
          },
          options,
        );
        assert.deepEqual(result, {
          ok: false,
          reason: 'not-paused',
          automation,
        });
      });

      test('someone who is not a direct writer cannot resume an automation or become its payer', async function (assert) {
        await switchOn();
        await pauseAutomation(
          dbAdapter,
          { automationId: AUTOMATION, user: OWNER },
          options,
        );
        let result = await resumeAutomation(
          dbAdapter,
          {
            automationId: AUTOMATION,
            user: READER,
            declaration: declaration(),
          },
          options,
        );
        assert.deepEqual(result, { ok: false, reason: 'not-a-direct-writer' });
        let automation = await getAutomation(dbAdapter, AUTOMATION);
        assert.strictEqual(automation?.state, 'paused');
        assert.strictEqual(automation?.payer, OWNER);
      });
    });

    module('remove', function () {
      test('a direct writer removes an automation, which deletes its row and cancels its pending run', async function (assert) {
        let automation = await switchOn();
        let pending = await pendingRun();
        let result = await removeAutomation(
          dbAdapter,
          { automationId: AUTOMATION, user: ADMIN },
          options,
        );
        assert.deepEqual(result, { ok: true, automation });
        assert.strictEqual(
          await getAutomation(dbAdapter, AUTOMATION),
          undefined,
        );
        let canceled = await getAutomationRun(dbAdapter, pending.id);
        assert.strictEqual(canceled?.state, 'canceled');
        assert.strictEqual(canceled?.canceledBy, ADMIN);

        let again = await removeAutomation(
          dbAdapter,
          { automationId: AUTOMATION, user: ADMIN },
          options,
        );
        assert.deepEqual(again, { ok: false, reason: 'missing' });
      });

      test('a paused automation can be removed', async function (assert) {
        await switchOn();
        await pauseAutomation(
          dbAdapter,
          { automationId: AUTOMATION, user: OWNER },
          options,
        );
        let result = await removeAutomation(
          dbAdapter,
          { automationId: AUTOMATION, user: OWNER },
          options,
        );
        assert.true(result.ok);
        assert.strictEqual(
          await getAutomation(dbAdapter, AUTOMATION),
          undefined,
        );
      });

      test('someone who is not a direct writer cannot remove an automation', async function (assert) {
        await switchOn();
        let result = await removeAutomation(
          dbAdapter,
          { automationId: AUTOMATION, user: READER },
          options,
        );
        assert.deepEqual(result, { ok: false, reason: 'not-a-direct-writer' });
        assert.strictEqual(
          (await getAutomation(dbAdapter, AUTOMATION))?.state,
          'active',
        );
      });
    });

    module('a card edit that asks for more than the snapshot', function () {
      test('raising a run cap pauses the automation, cancels its pending run, and keeps the payer', async function (assert) {
        await switchOn();
        let pending = await pendingRun();
        let automation = await checkAutomationCaps(dbAdapter, AUTOMATION, {
          caps: { ...CAPS, writes: CAPS.writes + 1 },
          batchedAI: false,
        });
        assert.strictEqual(automation?.state, 'paused');
        assert.strictEqual(automation?.pauseReason, 'caps-raised');
        assert.strictEqual(automation?.pausedBy, null);
        assert.strictEqual(automation?.payer, OWNER);
        let canceled = await getAutomationRun(dbAdapter, pending.id);
        assert.strictEqual(canceled?.state, 'canceled');
        assert.strictEqual(canceled?.canceledBy, null);
        assert.strictEqual(canceled?.errorReason, 'caps-raised');
      });

      test('unsetting a credit cap the snapshot set is a raise', async function (assert) {
        await switchOn();
        let automation = await checkAutomationCaps(dbAdapter, AUTOMATION, {
          caps: { ...CAPS, dailyCredits: null },
          batchedAI: false,
        });
        assert.strictEqual(automation?.pauseReason, 'caps-raised');
      });

      test('turning on batched AI pauses the automation', async function (assert) {
        await switchOn();
        let automation = await checkAutomationCaps(dbAdapter, AUTOMATION, {
          caps: CAPS,
          batchedAI: true,
        });
        assert.strictEqual(automation?.state, 'paused');
        assert.strictEqual(automation?.pauseReason, 'batched-ai-enabled');
      });

      test('lowering a cap, or keeping every cap, leaves the automation running', async function (assert) {
        let switchedOn = await switchOn();
        for (let caps of [
          CAPS,
          { ...CAPS, seconds: 60, monthlyCredits: 500 },
        ]) {
          let automation = await checkAutomationCaps(dbAdapter, AUTOMATION, {
            caps,
            batchedAI: false,
          });
          assert.deepEqual(automation, switchedOn);
        }
      });

      test('an automation already paused keeps the reason it has', async function (assert) {
        await switchOn();
        await pauseAutomation(
          dbAdapter,
          { automationId: AUTOMATION, user: OWNER },
          options,
        );
        let automation = await checkAutomationCaps(dbAdapter, AUTOMATION, {
          caps: { ...CAPS, writes: 1_000 },
          batchedAI: true,
        });
        assert.strictEqual(automation?.pauseReason, 'requested');
      });

      test('the payer resumes the automation at the raised caps, which then no longer pause it', async function (assert) {
        await switchOn();
        let raised = { ...CAPS, writes: 500 };
        await checkAutomationCaps(dbAdapter, AUTOMATION, {
          caps: raised,
          batchedAI: false,
        });
        let result = await resumeAutomation(
          dbAdapter,
          {
            automationId: AUTOMATION,
            user: OWNER,
            declaration: declaration({ caps: raised }),
          },
          options,
        );
        assert.true(result.ok);
        let automation = await checkAutomationCaps(dbAdapter, AUTOMATION, {
          caps: raised,
          batchedAI: false,
        });
        assert.strictEqual(automation?.state, 'active');
        assert.strictEqual(automation?.capsSnapshot.writes, 500);
      });

      test('an automation that is not switched on has nothing to check', async function (assert) {
        assert.strictEqual(
          await checkAutomationCaps(dbAdapter, AUTOMATION, {
            caps: CAPS,
            batchedAI: true,
          }),
          undefined,
        );
      });

      test('a cap the snapshot does not limit cannot be raised', function (assert) {
        let snapshot = {
          ...CAPS,
          dailyCredits: null,
          batchedAI: false,
        };
        assert.strictEqual(
          capsRaisedAbove(snapshot, {
            caps: { ...CAPS, dailyCredits: 1_000_000 },
            batchedAI: false,
          }),
          undefined,
          'an unset credit cap set to anything',
        );
        let { writes: _writes, ...withoutWrites } = snapshot;
        assert.strictEqual(
          capsRaisedAbove(withoutWrites as typeof snapshot, {
            caps: { ...CAPS, writes: 1_000_000 },
            batchedAI: false,
          }),
          undefined,
          'a cap the snapshot was taken without',
        );
      });
    });

    module('the payer losing direct write', function () {
      test('pauses the automation with that reason, and another direct writer resumes it as payer', async function (assert) {
        await switchOn(OWNER);
        let unchanged = await checkAutomationPayer(
          dbAdapter,
          AUTOMATION,
          options,
        );
        assert.strictEqual(unchanged?.state, 'active');

        await insertPermissions(dbAdapter, new URL(REALM_URL), {
          [OWNER]: ['read'],
        });
        let automation = await checkAutomationPayer(
          dbAdapter,
          AUTOMATION,
          options,
        );
        assert.strictEqual(automation?.state, 'paused');
        assert.strictEqual(automation?.pauseReason, 'payer-lost-access');

        let resumed = await resumeAutomation(
          dbAdapter,
          {
            automationId: AUTOMATION,
            user: ADMIN,
            declaration: declaration(),
          },
          options,
        );
        assert.true(resumed.ok);
        assert.strictEqual(
          (resumed as { automation: AutomationRow }).automation.payer,
          ADMIN,
        );
      });

      test('the former payer cannot resume it', async function (assert) {
        await switchOn(OWNER);
        await insertPermissions(dbAdapter, new URL(REALM_URL), {
          [OWNER]: ['read'],
        });
        await checkAutomationPayer(dbAdapter, AUTOMATION, options);
        let result = await resumeAutomation(
          dbAdapter,
          {
            automationId: AUTOMATION,
            user: OWNER,
            declaration: declaration(),
          },
          options,
        );
        assert.deepEqual(result, { ok: false, reason: 'not-a-direct-writer' });
      });
    });
  });
});
