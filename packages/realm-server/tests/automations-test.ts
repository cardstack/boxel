import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  createAutomationRun,
  getAutomationRun,
  insertPermissions,
  internalKeyFor,
  ri,
  rri,
  startAutomationRunAttempt,
  VirtualNetwork,
  type DBAdapter,
} from '@cardstack/runtime-common';
import {
  capsRaisedAbove,
  checkAutomationCaps,
  checkAutomationPayer,
  getAutomation,
  pauseAutomation,
  pauseRealmAutomations,
  removeAutomation,
  resumeAutomation,
  switchOnAutomation,
  syncAutomationWithCard,
  type AutomationActorOptions,
  type AutomationCardSource,
  type AutomationRow,
  type AutomationSync,
} from '@cardstack/runtime-common/automations';
import {
  automationRef,
  type AutomationCaps,
  type AutomationDeclaration,
  type AutomationIndexEntry,
} from '@cardstack/runtime-common/automation-declaration';
import { syncAutomationsAfterIndex } from '@cardstack/runtime-common/automation-index-hook';
import type { DefinitionLookup } from '@cardstack/runtime-common';
import { zonedDateTimeToUnixSeconds } from '@cardstack/runtime-common/automation-schedule';
import { createVirtualNetwork, setupDB } from './helpers/index.ts';
import { removeRealmDatabaseArtifacts } from '../handlers/realm-destruction-utils.ts';

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

// Each trigger's run count, last slot and cursor, without the records the
// index hook compares.
function runCounts(automation: AutomationRow) {
  return Object.fromEntries(
    Object.entries(automation.triggerRuns).map(
      ([label, { timing: _timing, live: _live, ...counts }]) => [label, counts],
    ),
  );
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
        assert.deepEqual(
          runCounts(automation),
          { daily: { runs: 0 } },
          'each trigger starts with no runs',
        );
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

    module("the automation's own realm", function (realmHooks) {
      const OTHER_REALM_URL = 'http://127.0.0.1:4444/marketing/';
      const OUTSIDER = '@outsider:localhost';

      realmHooks.beforeEach(async function () {
        await insertPermissions(dbAdapter, new URL(OTHER_REALM_URL), {
          [OUTSIDER]: ['read', 'write'],
        });
      });

      test('switch-on refuses a realm that does not contain the automation', async function (assert) {
        let result = await switchOnAutomation(
          dbAdapter,
          {
            automationId: AUTOMATION,
            realm: ri(OTHER_REALM_URL),
            user: OUTSIDER,
            declaration: declaration(),
          },
          options,
        );
        assert.deepEqual(result, { ok: false, reason: 'outside-realm' });
        assert.strictEqual(
          await getAutomation(dbAdapter, AUTOMATION),
          undefined,
        );
      });

      test("switch-on and resume refuse another card's declaration", async function (assert) {
        let other = declaration({ url: `${REALM_URL}Automation/other` });
        let result = await switchOnAutomation(
          dbAdapter,
          {
            automationId: AUTOMATION,
            realm: REALM,
            user: OWNER,
            declaration: other,
          },
          options,
        );
        assert.deepEqual(result, { ok: false, reason: 'other-card' });

        await switchOn();
        await pauseAutomation(
          dbAdapter,
          { automationId: AUTOMATION, user: OWNER },
          options,
        );
        let resumed = await resumeAutomation(
          dbAdapter,
          { automationId: AUTOMATION, user: ADMIN, declaration: other },
          options,
        );
        assert.deepEqual(resumed, { ok: false, reason: 'other-card' });
        assert.strictEqual(
          (await getAutomation(dbAdapter, AUTOMATION))?.payer,
          OWNER,
        );
      });

      test('a direct writer of another realm cannot pause, resume or remove the automation', async function (assert) {
        await switchOn();
        assert.deepEqual(
          await pauseAutomation(
            dbAdapter,
            { automationId: AUTOMATION, user: OUTSIDER },
            options,
          ),
          { ok: false, reason: 'not-a-direct-writer' },
          'pause',
        );
        await pauseAutomation(
          dbAdapter,
          { automationId: AUTOMATION, user: OWNER },
          options,
        );
        assert.deepEqual(
          await resumeAutomation(
            dbAdapter,
            {
              automationId: AUTOMATION,
              user: OUTSIDER,
              declaration: declaration(),
            },
            options,
          ),
          { ok: false, reason: 'not-a-direct-writer' },
          'resume',
        );
        assert.deepEqual(
          await removeAutomation(
            dbAdapter,
            { automationId: AUTOMATION, user: OUTSIDER },
            options,
          ),
          { ok: false, reason: 'not-a-direct-writer' },
          'remove',
        );
        let automation = await getAutomation(dbAdapter, AUTOMATION);
        assert.strictEqual(automation?.payer, OWNER);
        assert.strictEqual(automation?.pausedBy, OWNER);
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
          runCounts(automation),
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

      test('deleting the realm removes its automations, so a realm made at the same URL starts with none on', async function (assert) {
        await switchOn();
        await removeRealmDatabaseArtifacts({ dbAdapter, realmURL: REALM });
        assert.strictEqual(
          await getAutomation(dbAdapter, AUTOMATION),
          undefined,
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

    module("the card's index hook", function () {
      // The automation card's committed index row, as the hook reads it,
      // with `triggers`, `caps` or `batchedAI` as the card sets them.
      function indexed(
        overrides: {
          triggers?: Record<string, unknown>[];
          caps?: AutomationCaps;
          batchedAI?: boolean;
          types?: string[];
        } = {},
      ): AutomationIndexEntry {
        return {
          url: `${AUTOMATION}.json`,
          realmURL: REALM_URL,
          types: overrides.types ?? [automationTypeKey()],
          instance: {
            id: AUTOMATION,
            type: 'card',
            attributes: {
              triggers: overrides.triggers ?? [cronTrigger()],
              operations: [],
              caps: overrides.caps ?? CAPS,
              params: [],
              batchedAI: overrides.batchedAI ?? false,
              batchDeadlineMinutes: null,
            },
            relationships: {
              script: { links: { self: '../scripts/nightly-sync.js' } },
            },
            meta: { adoptsFrom: automationRef },
          },
        };
      }

      function cronTrigger(
        fields: Record<string, unknown> = {},
      ): Record<string, unknown> {
        return {
          kind: 'cron',
          label: 'daily',
          expression: '30 5 * * *',
          timeZone: 'America/Chicago',
          untilDate: null,
          untilTime: null,
          count: null,
          date: null,
          time: null,
          webhookPath: null,
          ...fields,
        };
      }

      // The catalog type as the index spells it.
      function automationTypeKey() {
        return internalKeyFor(automationRef, undefined, createVirtualNetwork());
      }

      async function sync(
        card: AutomationCardSource | undefined,
        now = NOW,
      ): Promise<AutomationSync | undefined> {
        return await syncAutomationWithCard(
          dbAdapter,
          AUTOMATION,
          async () => card,
          {
            automationTypeKey: automationTypeKey(),
            virtualNetwork: options.virtualNetwork,
            now,
          },
        );
      }

      async function setRuns(label: string, runs: number, lastSlot?: number) {
        await dbAdapter.execute(
          `UPDATE automations SET trigger_runs = jsonb_set(trigger_runs, '{${label}}', trigger_runs->'${label}' || '${JSON.stringify(
            { runs, ...(lastSlot !== undefined ? { lastSlot } : {}) },
          )}'::jsonb)`,
        );
      }

      test('a card indexed unchanged keeps its next run', async function (assert) {
        await switchOn();
        let result = await sync(indexed());
        assert.strictEqual(result?.kind, 'recomputed');
        assert.strictEqual(result?.automation.state, 'active');
        assert.strictEqual(result?.automation.nextRun, NEXT_DAILY);
      });

      test('an edited trigger keeps its run count, and a slot that passed before the edit does not come due', async function (assert) {
        // Switched on three days ago; the daily 05:30 run went this morning.
        let switchedOn = NOW - 3 * 86400;
        await switchOnAutomation(
          dbAdapter,
          {
            automationId: AUTOMATION,
            realm: REALM,
            user: OWNER,
            declaration: declaration(),
          },
          { ...options, now: switchedOn },
        );
        await setRuns('daily', 3, NEXT_DAILY - 86400);

        // At 12:00 the card moves the run to 11:00, which passed this
        // morning after the last run.
        let result = await sync(
          indexed({ triggers: [cronTrigger({ expression: '0 11 * * *' })] }),
        );
        assert.strictEqual(result?.kind, 'recomputed');
        assert.strictEqual(
          result?.automation.nextRun,
          zonedDateTimeToUnixSeconds('2026-11-11T11:00', 'America/Chicago'),
          "the next run is tomorrow's 11:00, not a make-up run for today's",
        );
        assert.deepEqual(
          runCounts(result!.automation),
          { daily: { runs: 3, lastSlot: NEXT_DAILY - 86400, since: NOW } },
          'the count stays, and the cursor moves up to the edit',
        );

        let again = await sync(
          indexed({ triggers: [cronTrigger({ expression: '0 11 * * *' })] }),
          NOW + 600,
        );
        assert.strictEqual(
          runCounts(again!.automation).daily.since,
          NOW,
          'indexing the card again without a timing change keeps the cursor',
        );
      });

      test('a trigger the card adds starts at the edit', async function (assert) {
        let switchedOn = NOW - 3 * 86400;
        await switchOnAutomation(
          dbAdapter,
          {
            automationId: AUTOMATION,
            realm: REALM,
            user: OWNER,
            declaration: declaration({ triggers: [] }),
          },
          { ...options, now: switchedOn },
        );
        let result = await sync(indexed());
        assert.strictEqual(result?.automation.state, 'active');
        assert.strictEqual(
          result?.automation.nextRun,
          NEXT_DAILY,
          'the slots between switch-on and the edit do not come due',
        );
      });

      test('an automation whose triggers are all spent becomes done, and one with a trigger left again becomes active', async function (assert) {
        await switchOn(
          OWNER,
          declaration({
            triggers: [
              {
                kind: 'cron',
                label: 'daily',
                expression: '30 5 * * *',
                timeZone: 'America/Chicago',
                count: 3,
              },
            ],
          }),
        );
        await setRuns('daily', 3, NEXT_DAILY - 86400);

        let spent = await sync(
          indexed({ triggers: [cronTrigger({ count: 3 })] }),
        );
        assert.strictEqual(spent?.automation.state, 'done');
        assert.strictEqual(spent?.automation.nextRun, null);

        // Four days later the count goes up to 5.
        let raisedAt = NOW + 4 * 86400;
        let raised = await sync(
          indexed({ triggers: [cronTrigger({ count: 5 })] }),
          raisedAt,
        );
        assert.strictEqual(raised?.automation.state, 'active');
        assert.strictEqual(
          raised?.automation.nextRun,
          NEXT_DAILY + 4 * 86400,
          'the next run is the first slot after the raise, not a make-up run for the days it was spent',
        );
        assert.strictEqual(
          runCounts(raised!.automation).daily.runs,
          3,
          'raising the count keeps the runs already started',
        );
      });

      test('a trigger the card removes and later adds back starts at the re-add, keeping its count', async function (assert) {
        await switchOn();
        await setRuns('daily', 2, NEXT_DAILY - 86400);
        let removed = await sync(
          indexed({
            triggers: [
              {
                ...cronTrigger(),
                kind: 'webhook',
                label: 'push',
                expression: null,
                timeZone: null,
                webhookPath: 'github-push',
              },
            ],
          }),
        );
        assert.strictEqual(removed?.automation.nextRun, null);

        let readdedAt = NOW + 3 * 86400;
        let readded = await sync(indexed(), readdedAt);
        assert.strictEqual(
          readded?.automation.nextRun,
          NEXT_DAILY + 3 * 86400,
          'the next run is the first slot after the re-add, not a make-up run for the days it was gone',
        );
        assert.strictEqual(runCounts(readded!.automation).daily.runs, 2);
      });

      test('a one-time trigger whose time has passed leaves the automation done', async function (assert) {
        await switchOn();
        let result = await sync(
          indexed({
            triggers: [
              {
                ...cronTrigger(),
                kind: 'once',
                label: 'backfill',
                expression: null,
                date: '2026-11-10',
                time: '09:00',
              },
            ],
          }),
        );
        assert.strictEqual(result?.automation.state, 'done');
        assert.strictEqual(result?.automation.nextRun, null);
      });

      test('a deleted card removes the row and cancels its pending run', async function (assert) {
        await switchOn();
        let run = await pendingRun();
        let result = await sync(undefined);
        assert.strictEqual(result?.kind, 'removed');
        assert.strictEqual(
          (result as Extract<AutomationSync, { kind: 'removed' }>).reason,
          'card-deleted',
        );
        assert.strictEqual(
          await getAutomation(dbAdapter, AUTOMATION),
          undefined,
        );
        let canceled = await getAutomationRun(dbAdapter, run.id);
        assert.strictEqual(canceled?.state, 'canceled');
        assert.strictEqual(canceled?.canceledBy, null);
        assert.strictEqual(canceled?.errorReason, 'card-deleted');
      });

      test('a card that no longer adopts from the catalog Automation type removes the row', async function (assert) {
        await switchOn();
        let result = await sync(
          indexed({ types: ['http://example/other/Thing'] }),
        );
        assert.strictEqual(result?.kind, 'removed');
        assert.strictEqual(
          (result as Extract<AutomationSync, { kind: 'removed' }>).reason,
          'not-an-automation',
        );
        assert.strictEqual(
          await getAutomation(dbAdapter, AUTOMATION),
          undefined,
        );
      });

      test('a card that failed to index, or does not read, leaves the row as it was', async function (assert) {
        let before = await switchOn();
        let failed = await sync({ ...indexed(), instance: null });
        assert.strictEqual(failed?.kind, 'unchanged');
        let withheld = await sync({
          ...indexed({ triggers: [cronTrigger({ expression: '0 11 * * *' })] }),
          failureWithheld: true,
        });
        assert.strictEqual(
          withheld?.kind,
          'unchanged',
          'a row carrying an earlier visit after a failed one is not read',
        );
        let invalid = await sync(
          indexed({ triggers: [cronTrigger({ expression: 'not cron' })] }),
        );
        assert.strictEqual(invalid?.kind, 'unchanged');
        assert.deepEqual(await getAutomation(dbAdapter, AUTOMATION), before);
      });

      test('a card that raises a cap pauses the automation', async function (assert) {
        await switchOn();
        let result = await sync(indexed({ caps: { ...CAPS, writes: 500 } }));
        assert.strictEqual(result?.kind, 'paused');
        assert.strictEqual(result?.automation.pauseReason, 'caps-raised');
      });

      test('a paused automation keeps its reason and its schedule', async function (assert) {
        await switchOn();
        let paused = await pauseAutomation(
          dbAdapter,
          { automationId: AUTOMATION, user: OWNER },
          options,
        );
        let result = await sync(
          indexed({ triggers: [cronTrigger({ count: 0 })] }),
        );
        assert.strictEqual(result?.kind, 'unchanged');
        assert.deepEqual(
          await getAutomation(dbAdapter, AUTOMATION),
          (paused as { automation: AutomationRow }).automation,
        );
      });

      test('a card whose automation is not switched on is left alone', async function (assert) {
        assert.strictEqual(await sync(indexed()), undefined);
        assert.strictEqual(await sync(undefined), undefined);
      });
    });

    module('the index hook after a pass', function (hooks) {
      // The index holds no row for the card in these tests, so a sync reads
      // it as deleted: whether the row survives shows whether the pass
      // matched the card.
      const definitionLookup = {} as DefinitionLookup;
      // The worker's network, which maps the catalog's prefix.
      let virtualNetwork: VirtualNetwork;
      hooks.beforeEach(function () {
        virtualNetwork = createVirtualNetwork();
      });

      test('an incremental pass syncs an automation whose card file it touched, and only that one', async function (assert) {
        await switchOn();
        let untouched = await syncAutomationsAfterIndex({
          dbAdapter,
          definitionLookup,
          virtualNetwork,
          realmURL: REALM_URL,
          touched: [`${REALM_URL}Automation/other.json`],
        });
        assert.strictEqual(untouched.size, 0);
        assert.notStrictEqual(
          await getAutomation(dbAdapter, AUTOMATION),
          undefined,
        );

        let touched = await syncAutomationsAfterIndex({
          dbAdapter,
          definitionLookup,
          virtualNetwork,
          realmURL: REALM_URL,
          touched: [`${AUTOMATION}.json`],
        });
        assert.strictEqual(touched.get(AUTOMATION)?.kind, 'removed');
        assert.strictEqual(
          await getAutomation(dbAdapter, AUTOMATION),
          undefined,
        );
      });

      test('a pass over the whole realm syncs every automation in it', async function (assert) {
        await switchOn();
        let synced = await syncAutomationsAfterIndex({
          dbAdapter,
          definitionLookup,
          virtualNetwork,
          realmURL: REALM_URL,
        });
        assert.deepEqual([...synced.keys()], [AUTOMATION]);
      });
    });

    module('archiving the realm', function () {
      test('pauses every automation in the realm that is not paused, and cancels their pending runs', async function (assert) {
        await switchOn();
        let run = await pendingRun();
        let paused = await pauseRealmAutomations(dbAdapter, REALM);
        assert.deepEqual(
          paused.map((a) => [a.automationId, a.state, a.pauseReason]),
          [[AUTOMATION, 'paused', 'realm-archived']],
        );
        let canceled = await getAutomationRun(dbAdapter, run.id);
        assert.strictEqual(canceled?.state, 'canceled');
        assert.strictEqual(canceled?.errorReason, 'realm-archived');

        let resumed = await resumeAutomation(
          dbAdapter,
          {
            automationId: AUTOMATION,
            user: ADMIN,
            declaration: declaration(),
          },
          options,
        );
        assert.true(resumed.ok, 'a direct writer resumes it');
      });

      test('an automation paused already keeps its reason, and another realm is untouched', async function (assert) {
        await switchOn();
        await pauseAutomation(
          dbAdapter,
          { automationId: AUTOMATION, user: OWNER },
          options,
        );
        let otherRealmURL = 'http://127.0.0.1:4444/other/';
        await insertPermissions(dbAdapter, new URL(otherRealmURL), {
          [OWNER]: ['read', 'write', 'realm-owner'],
        });
        let other = rri(`${otherRealmURL}Automation/other`);
        await switchOnAutomation(
          dbAdapter,
          {
            automationId: other,
            realm: ri(otherRealmURL),
            user: OWNER,
            declaration: declaration({
              url: other,
              realmURL: otherRealmURL,
              script: rri(`${otherRealmURL}scripts/nightly-sync.js`),
            }),
          },
          options,
        );

        assert.deepEqual(await pauseRealmAutomations(dbAdapter, REALM), []);
        let automation = await getAutomation(dbAdapter, AUTOMATION);
        assert.strictEqual(automation?.pauseReason, 'requested');
        assert.strictEqual(automation?.pausedBy, OWNER);
        assert.strictEqual(
          (await getAutomation(dbAdapter, other))?.state,
          'active',
        );
      });
    });
  });
});
