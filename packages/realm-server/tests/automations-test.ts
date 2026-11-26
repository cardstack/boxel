import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  claimAutomationRunCommit,
  createAutomationRun,
  dbAdapterQuerier,
  finishAutomationRun,
  getAutomationRun,
  insertPermissions,
  internalKeyFor,
  param,
  query,
  ri,
  rri,
  recordAutomationRunCommitted,
  startAutomationRunAttempt,
  VirtualNetwork,
  type DBAdapter,
  type QueuePublisher,
} from '@cardstack/runtime-common';
import { startWebhookAutomationRuns } from '@cardstack/runtime-common/automation-webhook-runs';
import {
  cancelAutomationRunFor,
  capsRaisedAbove,
  checkAutomationCaps,
  checkAutomationPayer,
  getAutomation,
  pauseAfterRepeatedFailures,
  pauseAutomation,
  pauseForInvalidDeclaration,
  pauseForPayerLostAccess,
  PLATFORM_FAILURE_REASONS,
  SPENDING_REFUSAL_REASONS,
  pauseRealmAutomations,
  readAutomationFailures,
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
  MANUAL_RUN_TRIGGER,
  readAutomationDeclaration,
  type AutomationCaps,
  type AutomationDeclaration,
  type AutomationIndexEntry,
} from '@cardstack/runtime-common/automation-declaration';
import { readRunLog } from '@cardstack/runtime-common/automation-run-log';
import {
  countRunCall,
  endRunAtCap,
} from '@cardstack/runtime-common/automation-run-limits';
import type { ReportRunChange } from '@cardstack/runtime-common';
import { stageRunOverlayFile } from '@cardstack/runtime-common/run-overlay';
import { syncAutomationsAfterIndex } from '@cardstack/runtime-common/automation-index-hook';
import type { DefinitionLookup } from '@cardstack/runtime-common';
import { zonedDateTimeToUnixSeconds } from '@cardstack/runtime-common/automation-schedule';
import type { ChangedAutomation } from '@cardstack/runtime-common/automation-change-events';
import {
  admitAnyPayer,
  createVirtualNetwork,
  insertIncomingWebhookRow,
  setupDB,
  setupSecretsKeyring,
} from './helpers/index.ts';
import type { PgAdapter } from '@cardstack/postgres';
import { removeRealmDatabaseArtifacts } from '../handlers/realm-destruction-utils.ts';

const REALM_URL = 'http://127.0.0.1:4444/payroll/';
const REALM = ri(REALM_URL);
const AUTOMATION = rri(`${REALM_URL}Automation/nightly-sync`);
const OWNER = '@owner:localhost';
const ADMIN = '@admin:localhost';
const READER = '@reader:localhost';
const OUTSIDER = '@outsider:localhost';

// Incoming webhooks: two the realm's direct writers made, one a reader of the
// realm made, and one a person with no row in the realm made.
const OWNER_WEBHOOK = 'whk_owner';
const ADMIN_WEBHOOK = 'whk_admin';
const READER_WEBHOOK = 'whk_reader';
const OUTSIDER_WEBHOOK = 'whk_outsider';

async function insertWebhooks(dbAdapter: DBAdapter) {
  for (let [username, webhookPath] of [
    [OWNER, OWNER_WEBHOOK],
    [ADMIN, ADMIN_WEBHOOK],
    [READER, READER_WEBHOOK],
    [OUTSIDER, OUTSIDER_WEBHOOK],
  ]) {
    await insertIncomingWebhookRow(dbAdapter as PgAdapter, {
      username,
      webhookPath,
      signingSecret: `secret-${webhookPath}`,
    });
  }
}

function webhookTrigger(webhookPath: string, label = 'deliveries') {
  return { kind: 'webhook' as const, label, webhookPath };
}

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
  aiCredits: 100,
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
      ([
        label,
        { timing: _timing, live: _live, declared: _declared, ...counts },
      ]) => [label, counts],
    ),
  );
}

// The adapter as `PgAdapter.withTransaction` behaves when the database
// aborts a transaction (a deadlock or a serialization failure): its first
// transaction runs the whole callback and is rolled back, and the callback
// runs again in a new one.
function rollsBackFirstTransaction(db: DBAdapter): DBAdapter {
  class RolledBack extends Error {}
  let rolledBack = false;
  return new Proxy(db, {
    get(target, prop) {
      if (prop === 'withTransaction') {
        return async (
          change: Parameters<DBAdapter['withTransaction']>[0],
          ...rest: unknown[]
        ) => {
          if (!rolledBack) {
            rolledBack = true;
            try {
              await (target.withTransaction as any)(
                async (txQuery: unknown) => {
                  await (change as any)(txQuery);
                  throw new RolledBack();
                },
                ...rest,
              );
            } catch (e) {
              if (!(e instanceof RolledBack)) {
                throw e;
              }
            }
          }
          return await (target.withTransaction as any)(change, ...rest);
        };
      }
      let value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

module(basename(import.meta.filename), function () {
  module('the automation row', function (hooks) {
    setupSecretsKeyring(hooks);
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

    async function overlayPaths(runId: string): Promise<string[]> {
      let rows = (await dbAdapter.execute(
        `SELECT path FROM run_overlay_files WHERE run_id = '${runId}' ORDER BY path`,
      )) as { path: string }[];
      return rows.map(({ path }) => path);
    }

    module('pause after repeated failures', function () {
      let slotCount = 0;

      // A run of the automation that has ended: `error` with `reason`, or
      // `complete`. Each ends in its own transaction, so later runs finish
      // later.
      async function endedRun(
        outcome: 'complete' | 'error' | 'canceled',
        {
          reason = 'script-error',
          message = 'Error: upstream said no',
          trigger = 'daily',
          dryRun = false,
        }: {
          reason?: string;
          message?: string;
          trigger?: string;
          dryRun?: boolean;
        } = {},
      ) {
        let run = await createAutomationRun(dbAdapter, {
          automationId: AUTOMATION,
          realm: REALM,
          trigger,
          slot: `slot-${++slotCount}`,
          actsAs: OWNER,
          dryRun,
        });
        await startAutomationRunAttempt(dbAdapter, run.id, 1);
        if (outcome === 'canceled') {
          await cancelAutomationRunFor(
            dbAdapter,
            { runId: run.id, user: OWNER },
            options,
          );
        } else {
          await finishAutomationRun(
            dbAdapter,
            run.id,
            1,
            outcome === 'complete'
              ? { state: 'complete' }
              : { state: 'error', reason, message },
          );
        }
        return run;
      }

      async function failures() {
        return await readAutomationFailures(
          dbAdapterQuerier(dbAdapter),
          AUTOMATION,
        );
      }

      async function failTimes(n: number) {
        let last;
        for (let i = 0; i < n; i++) {
          last = await endedRun('error');
          await pauseAfterRepeatedFailures(dbAdapter, AUTOMATION);
        }
        return last!;
      }

      test('the pause reports the automation and the pending run it cancels once each, after it commits', async function (assert) {
        await switchOn();
        await failTimes(1);
        let pending = await pendingRun('2026-11-12T11:30:00.000Z');
        // Each report with what the rows hold when it arrives: a report made
        // inside the pause's transaction would still see them as they were.
        let reports: string[] = [];
        let result = await pauseAfterRepeatedFailures(
          rollsBackFirstTransaction(dbAdapter),
          AUTOMATION,
          { failuresBeforePause: 1 },
          {
            reportAutomationChange: async ({ automationId, realm }) => {
              let automation = await getAutomation(dbAdapter, automationId);
              reports.push(
                `automation ${automationId} in ${realm} ${automation?.state}`,
              );
            },
            reportRunChange: async (runId) => {
              let run = await getAutomationRun(dbAdapter, runId);
              reports.push(`run ${runId} ${run?.state}`);
            },
          },
        );
        assert.true(result?.paused);
        assert.deepEqual(
          [...reports].sort(),
          [
            `automation ${AUTOMATION} in ${REALM} paused`,
            `run ${pending.id} canceled`,
          ].sort(),
          'the paused automation and the canceled run are each reported once, even when the transaction is retried',
        );
      });

      test('five failed runs in a row pause the automation with repeated-failures, and the streak names the last error', async function (assert) {
        await switchOn();
        await failTimes(4);
        assert.strictEqual(
          (await getAutomation(dbAdapter, AUTOMATION))?.state,
          'active',
          'four failures in a row leave the automation running',
        );
        let pending = await pendingRun('2026-11-12T11:30:00.000Z');
        let fifth = await endedRun('error', {
          reason: 'timed-out',
          message: 'The run reached its time limit',
        });
        let result = await pauseAfterRepeatedFailures(dbAdapter, AUTOMATION);
        assert.true(result?.paused, 'this call paused it');
        let automation = result?.automation;
        assert.strictEqual(automation?.state, 'paused');
        assert.strictEqual(automation?.pauseReason, 'repeated-failures');
        assert.strictEqual(automation?.pausedBy, null);
        let streak = await failures();
        assert.strictEqual(streak.inARow, 5);
        assert.strictEqual(streak.last?.runId, fifth.id);
        assert.strictEqual(streak.last?.reason, 'timed-out');
        assert.strictEqual(
          streak.last?.message,
          'The run reached its time limit',
        );
        let canceled = await getAutomationRun(dbAdapter, pending.id);
        assert.strictEqual(
          canceled?.state,
          'canceled',
          'the pause cancels the pending run',
        );
        assert.strictEqual(canceled?.errorReason, 'repeated-failures');
      });

      test("five runs in a row that a realm call of the script's failed pause the automation, while runs the platform failed don't count", async function (assert) {
        await switchOn();
        for (let i = 0; i < 4; i++) {
          await endedRun('error', {
            reason: 'call-failed',
            message: 'File not found: notes/missing.md',
          });
          await endedRun('error', { reason: 'run-failed' });
          await pauseAfterRepeatedFailures(dbAdapter, AUTOMATION);
        }
        assert.strictEqual(
          (await getAutomation(dbAdapter, AUTOMATION))?.state,
          'active',
        );
        assert.strictEqual((await failures()).inARow, 4);
        await endedRun('error', {
          reason: 'call-failed',
          message: 'File not found: notes/missing.md',
        });
        let result = await pauseAfterRepeatedFailures(dbAdapter, AUTOMATION);
        assert.true(result?.paused);
        assert.strictEqual(result?.automation.pauseReason, 'repeated-failures');
        assert.strictEqual((await failures()).last?.reason, 'call-failed');
      });

      test('a complete run in between resets the streak', async function (assert) {
        await switchOn();
        await failTimes(4);
        await endedRun('complete');
        assert.deepEqual(await failures(), { inARow: 0, last: null });
        await failTimes(4);
        assert.strictEqual(
          (await getAutomation(dbAdapter, AUTOMATION))?.state,
          'active',
        );
        assert.strictEqual((await failures()).inARow, 4);
        await failTimes(1);
        assert.strictEqual(
          (await getAutomation(dbAdapter, AUTOMATION))?.pauseReason,
          'repeated-failures',
        );
      });

      test('resuming clears the streak', async function (assert) {
        await switchOn();
        await failTimes(5);
        assert.strictEqual(
          (await getAutomation(dbAdapter, AUTOMATION))?.pauseReason,
          'repeated-failures',
        );
        let resumed = await resumeAutomation(
          dbAdapter,
          {
            automationId: AUTOMATION,
            user: ADMIN,
            declaration: declaration(),
            admit: admitAnyPayer,
          },
          options,
        );
        assert.true(resumed.ok);
        assert.deepEqual(await failures(), { inARow: 0, last: null });
        await failTimes(4);
        let automation = await getAutomation(dbAdapter, AUTOMATION);
        assert.strictEqual(automation?.state, 'active');
        assert.strictEqual(automation?.payer, ADMIN);
        await failTimes(1);
        assert.strictEqual(
          (await getAutomation(dbAdapter, AUTOMATION))?.pauseReason,
          'repeated-failures',
          'five new failures after the resume pause it again',
        );
      });

      test("a Preview, a Run now, a canceled run, a run refused for the payer's spending and a run the platform failed neither extend nor break the streak", async function (assert) {
        await switchOn();
        await failTimes(3);
        await endedRun('error', { trigger: MANUAL_RUN_TRIGGER });
        await endedRun('error', { trigger: MANUAL_RUN_TRIGGER, dryRun: true });
        await endedRun('complete', { trigger: MANUAL_RUN_TRIGGER });
        await endedRun('complete', {
          trigger: MANUAL_RUN_TRIGGER,
          dryRun: true,
        });
        await endedRun('canceled');
        for (let reason of [
          ...SPENDING_REFUSAL_REASONS,
          ...PLATFORM_FAILURE_REASONS,
        ]) {
          await endedRun('error', { reason });
        }
        await pauseAfterRepeatedFailures(dbAdapter, AUTOMATION);
        assert.strictEqual((await failures()).inARow, 3);
        assert.strictEqual(
          (await getAutomation(dbAdapter, AUTOMATION))?.state,
          'active',
        );
      });

      test('a run recorded as an error whose commit lands after all ends the streak', async function (assert) {
        await switchOn();
        await failTimes(3);
        let run = await createAutomationRun(dbAdapter, {
          automationId: AUTOMATION,
          realm: REALM,
          trigger: 'daily',
          slot: 'late-commit',
          actsAs: OWNER,
        });
        await startAutomationRunAttempt(dbAdapter, run.id, 1);
        await claimAutomationRunCommit(dbAdapter, run.id, 1);
        // The realm refused the commit with a code of its own, which the
        // streak counts, and then the batch landed after all.
        await finishAutomationRun(dbAdapter, run.id, 1, {
          state: 'error',
          reason: 'overlay-changed',
        });
        assert.strictEqual((await failures()).inARow, 4);
        await recordAutomationRunCommitted(dbAdapter, run.id);
        assert.deepEqual(await failures(), { inARow: 0, last: null });
      });

      test('the number of failures that pause an automation is configurable', async function (assert) {
        await switchOn();
        await endedRun('error');
        await endedRun('error');
        assert.strictEqual(
          (await pauseAfterRepeatedFailures(dbAdapter, AUTOMATION))?.automation
            .state,
          'active',
          'two failures are under the default',
        );
        let result = await pauseAfterRepeatedFailures(dbAdapter, AUTOMATION, {
          failuresBeforePause: 2,
        });
        assert.strictEqual(result?.automation.pauseReason, 'repeated-failures');
      });

      test('an automation already paused keeps its reason, and one not switched on is left alone', async function (assert) {
        assert.strictEqual(
          await pauseAfterRepeatedFailures(dbAdapter, AUTOMATION),
          undefined,
        );
        await switchOn();
        await pauseAutomation(
          dbAdapter,
          { automationId: AUTOMATION, user: OWNER },
          options,
        );
        await failTimes(5);
        let automation = await getAutomation(dbAdapter, AUTOMATION);
        assert.strictEqual(automation?.pauseReason, 'requested');
        assert.strictEqual(automation?.pausedBy, OWNER);
        assert.false(
          (await pauseAfterRepeatedFailures(dbAdapter, AUTOMATION))?.paused,
        );
      });

      test('an automation that is done has no runs left to stop, and stays done', async function (assert) {
        await switchOn();
        await dbAdapter.execute(
          `UPDATE automations SET state = 'done', next_run = NULL`,
        );
        await failTimes(5);
        let automation = await getAutomation(dbAdapter, AUTOMATION);
        assert.strictEqual(automation?.state, 'done');
        assert.strictEqual(automation?.pauseReason, null);
        assert.strictEqual((await failures()).inARow, 5);
      });

      test('an automation waiting for credits pauses after repeated failures too', async function (assert) {
        await switchOn();
        await dbAdapter.execute(
          `UPDATE automations SET state = 'waiting-for-credits'`,
        );
        await failTimes(5);
        assert.strictEqual(
          (await getAutomation(dbAdapter, AUTOMATION))?.pauseReason,
          'repeated-failures',
        );
      });
    });

    module('cancel a run', function () {
      test('a direct writer cancels a running run: its row records who, and what it staged is discarded', async function (assert) {
        await switchOn();
        let run = await pendingRun('2026-11-10T11:30:00.000Z');
        await startAutomationRunAttempt(dbAdapter, run.id, 1);
        await stageRunOverlayFile(
          dbAdapter,
          { runId: run.id, attempt: 1 },
          'staged.json',
          new TextEncoder().encode('{}'),
          10,
        );

        let result = await cancelAutomationRunFor(
          dbAdapter,
          { runId: run.id, user: ADMIN },
          options,
        );
        assert.true(result.ok);
        let canceled = (result as { run: { state: string } }).run;
        assert.strictEqual(canceled.state, 'canceled');
        let row = await getAutomationRun(dbAdapter, run.id);
        assert.strictEqual(row?.state, 'canceled');
        assert.strictEqual(row?.canceledBy, ADMIN);
        assert.notStrictEqual(row?.finishedAt, null);
        assert.deepEqual(await overlayPaths(run.id), []);
        assert.deepEqual(
          (await readRunLog(dbAdapter, run.id))?.lines.map(
            ({ kind, message }) => ({
              kind,
              message,
            }),
          ),
          [{ kind: 'finish', message: `The run was canceled by ${ADMIN}` }],
        );
        assert.strictEqual(
          (await getAutomation(dbAdapter, AUTOMATION))?.state,
          'active',
          'canceling a run leaves the automation as it was',
        );
      });

      test('a direct writer cancels a pending run, which then never starts', async function (assert) {
        await switchOn();
        let run = await pendingRun();
        let result = await cancelAutomationRunFor(
          dbAdapter,
          { runId: run.id, user: OWNER },
          options,
        );
        assert.true(result.ok);
        assert.strictEqual(
          (await startAutomationRunAttempt(dbAdapter, run.id, 1)).kind,
          'over',
        );
      });

      test("someone who is not a direct writer of the run's realm cannot cancel it", async function (assert) {
        await switchOn();
        await insertPermissions(
          dbAdapter,
          new URL('http://127.0.0.1:4444/marketing/'),
          { '@outsider:localhost': ['read', 'write'] },
        );
        let run = await pendingRun('2026-11-10T11:30:00.000Z');
        await startAutomationRunAttempt(dbAdapter, run.id, 1);
        for (let user of [READER, '@outsider:localhost']) {
          assert.deepEqual(
            await cancelAutomationRunFor(
              dbAdapter,
              { runId: run.id, user },
              options,
            ),
            { ok: false, reason: 'not-a-direct-writer' },
            `${user} is refused`,
          );
        }
        assert.strictEqual(
          (await getAutomationRun(dbAdapter, run.id))?.state,
          'running',
        );
      });

      test('a run whose commit was claimed, or that ended, cannot be canceled', async function (assert) {
        await switchOn();
        let committing = await pendingRun('2026-11-10T11:30:00.000Z');
        await startAutomationRunAttempt(dbAdapter, committing.id, 1);
        await claimAutomationRunCommit(dbAdapter, committing.id, 1);
        let result = await cancelAutomationRunFor(
          dbAdapter,
          { runId: committing.id, user: OWNER },
          options,
        );
        assert.false(result.ok);
        assert.strictEqual(
          (result as { reason: string }).reason,
          'not-cancelable',
        );
        assert.strictEqual(
          (result as { run: { state: string } }).run.state,
          'running',
          'the refusal answers the run as it stands',
        );

        let pending = await pendingRun();
        await cancelAutomationRunFor(
          dbAdapter,
          { runId: pending.id, user: OWNER },
          options,
        );
        let again = await cancelAutomationRunFor(
          dbAdapter,
          { runId: pending.id, user: ADMIN },
          options,
        );
        assert.strictEqual(
          (again as { reason: string }).reason,
          'not-cancelable',
        );
        assert.strictEqual(
          (await getAutomationRun(dbAdapter, pending.id))?.canceledBy,
          OWNER,
          'the first cancel keeps who canceled it',
        );
      });

      test('canceling a run that does not exist finds nothing', async function (assert) {
        assert.deepEqual(
          await cancelAutomationRunFor(
            dbAdapter,
            { runId: '00000000-0000-0000-0000-000000000000', user: OWNER },
            options,
          ),
          { ok: false, reason: 'missing' },
        );
      });
    });

    module('reporting run changes', function () {
      // A reporter that records, for each report, the run's state as its row
      // holds it when the report arrives: a report made inside the change's
      // transaction would still see the run as it was before.
      function recordingReporter() {
        let reports: { runId: string; state: string | undefined }[] = [];
        let report: ReportRunChange = async (runId) => {
          reports.push({
            runId,
            state: (await getAutomationRun(dbAdapter, runId))?.state,
          });
        };
        return { reports, report };
      }

      test('a pause reports each run it cancels once, after it commits, and not a run left to finish', async function (assert) {
        await switchOn();
        let pending = await pendingRun();
        let running = await pendingRun('2026-11-10T11:30:00.000Z');
        await startAutomationRunAttempt(dbAdapter, running.id, 1);
        let committing = await pendingRun('2026-11-09T11:30:00.000Z');
        await startAutomationRunAttempt(dbAdapter, committing.id, 1);
        await claimAutomationRunCommit(dbAdapter, committing.id, 1);

        let { reports, report } = recordingReporter();
        let result = await pauseAutomation(
          rollsBackFirstTransaction(dbAdapter),
          { automationId: AUTOMATION, user: ADMIN },
          { ...options, reportRunChange: report },
        );
        assert.true(result.ok);
        assert.deepEqual(
          [...reports].sort((a, b) => a.runId.localeCompare(b.runId)),
          [
            { runId: pending.id, state: 'canceled' },
            { runId: running.id, state: 'canceled' },
          ].sort((a, b) => a.runId.localeCompare(b.runId)),
          'each canceled run is reported once, as canceled, even when the transaction is retried; the run whose commit was claimed is not',
        );
      });

      test('removing an automation and checks that pause it report the runs they cancel', async function (assert) {
        await switchOn();
        let removed = await pendingRun();
        let { reports, report } = recordingReporter();
        await removeAutomation(
          dbAdapter,
          { automationId: AUTOMATION, user: ADMIN },
          { ...options, reportRunChange: report },
        );
        assert.deepEqual(reports, [{ runId: removed.id, state: 'canceled' }]);

        await switchOn();
        let pausedForPayer = await pendingRun('2026-11-12T11:30:00.000Z');
        reports.length = 0;
        await pauseForPayerLostAccess(dbAdapter, AUTOMATION, OWNER, {
          reportRunChange: report,
        });
        assert.deepEqual(
          reports,
          [{ runId: pausedForPayer.id, state: 'canceled' }],
          "a pause for the payer's lost access reports",
        );

        await resumeAutomation(
          dbAdapter,
          {
            automationId: AUTOMATION,
            user: OWNER,
            declaration: declaration(),
            admit: admitAnyPayer,
          },
          options,
        );
        let pausedForRealm = await pendingRun('2026-11-13T11:30:00.000Z');
        reports.length = 0;
        await pauseRealmAutomations(dbAdapter, REALM, {
          reportRunChange: report,
        });
        assert.deepEqual(
          reports,
          [{ runId: pausedForRealm.id, state: 'canceled' }],
          "pausing the realm's automations reports",
        );
      });

      test("a person's cancel reports the run once, and a refused cancel reports nothing", async function (assert) {
        await switchOn();
        let run = await pendingRun();
        let { reports, report } = recordingReporter();
        let refused = await cancelAutomationRunFor(
          dbAdapter,
          { runId: run.id, user: READER },
          { ...options, reportRunChange: report },
        );
        assert.false(refused.ok);
        assert.deepEqual(reports, [], 'a refused cancel reports nothing');

        let result = await cancelAutomationRunFor(
          dbAdapter,
          { runId: run.id, user: ADMIN },
          { ...options, reportRunChange: report },
        );
        assert.true(result.ok);
        assert.deepEqual(reports, [{ runId: run.id, state: 'canceled' }]);

        let again = await cancelAutomationRunFor(
          dbAdapter,
          { runId: run.id, user: ADMIN },
          { ...options, reportRunChange: report },
        );
        assert.false(again.ok);
        assert.strictEqual(
          reports.length,
          1,
          'canceling a run that has ended reports nothing more',
        );
      });

      test('a run ended at a cap is reported once, and a run that already ended is not', async function (assert) {
        await switchOn();
        let run = await pendingRun();
        await startAutomationRunAttempt(dbAdapter, run.id, 1);
        let limited = { runId: run.id, attempt: 1, automationId: AUTOMATION };
        let { reports, report } = recordingReporter();

        await endRunAtCap(dbAdapter, limited, 'writes', report);
        assert.deepEqual(reports, [{ runId: run.id, state: 'error' }]);

        await endRunAtCap(dbAdapter, limited, 'writes', report);
        assert.strictEqual(
          reports.length,
          1,
          'ending a run that already ended reports nothing',
        );

        let counted = await pendingRun('2026-11-10T11:30:00.000Z');
        await startAutomationRunAttempt(dbAdapter, counted.id, 1);
        reports.length = 0;
        let within = await countRunCall(
          dbAdapter,
          { runId: counted.id, attempt: 1, automationId: AUTOMATION },
          'callApiCalls',
          1,
          report,
        );
        assert.true(within.ok);
        assert.deepEqual(reports, [], 'a call within the cap reports nothing');
        let past = await countRunCall(
          dbAdapter,
          { runId: counted.id, attempt: 1, automationId: AUTOMATION },
          'callApiCalls',
          1,
          report,
        );
        assert.false(past.ok);
        assert.deepEqual(
          reports,
          [{ runId: counted.id, state: 'error' }],
          'the call past the cap ends the run and reports it once',
        );
      });
    });

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
          webhookPaths: [],
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
        await insertWebhooks(dbAdapter);
        let automation = await switchOn(
          OWNER,
          declaration({ triggers: [webhookTrigger(OWNER_WEBHOOK, 'stripe')] }),
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
          {
            automationId: AUTOMATION,
            user: ADMIN,
            declaration: other,
            admit: admitAnyPayer,
          },
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
              admit: admitAnyPayer,
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
      test('a direct writer pauses an automation, which cancels its pending run and its running one', async function (assert) {
        await switchOn();
        let pending = await pendingRun();
        let running = await pendingRun('2026-11-10T11:30:00.000Z');
        await startAutomationRunAttempt(dbAdapter, running.id, 1);
        await stageRunOverlayFile(
          dbAdapter,
          { runId: running.id, attempt: 1 },
          'staged.json',
          new TextEncoder().encode('{}'),
          10,
        );

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
        let stopped = await getAutomationRun(dbAdapter, running.id);
        assert.strictEqual(stopped?.state, 'canceled', 'the running run stops');
        assert.strictEqual(stopped?.canceledBy, ADMIN);
        assert.deepEqual(
          await overlayPaths(running.id),
          [],
          'what the running run staged is discarded',
        );
        let log = await readRunLog(dbAdapter, running.id);
        assert.deepEqual(
          log?.lines.map(({ kind, message }) => ({ kind, message })),
          [{ kind: 'finish', message: `The run was canceled by ${ADMIN}` }],
          'its log ends with who canceled it',
        );
      });

      test('a pause the database rolls back and retries logs each canceled run once', async function (assert) {
        await switchOn();
        let running = await pendingRun('2026-11-10T11:30:00.000Z');
        await startAutomationRunAttempt(dbAdapter, running.id, 1);

        let result = await pauseAutomation(
          rollsBackFirstTransaction(dbAdapter),
          { automationId: AUTOMATION, user: ADMIN },
          options,
        );
        assert.true(result.ok);
        assert.deepEqual(
          (await readRunLog(dbAdapter, running.id))?.lines.map(
            ({ kind, message }) => ({ kind, message }),
          ),
          [{ kind: 'finish', message: `The run was canceled by ${ADMIN}` }],
          'the rolled-back attempt adds no line of its own',
        );
      });

      test('a running run whose commit was claimed is left to finish', async function (assert) {
        await switchOn();
        let committing = await pendingRun('2026-11-10T11:30:00.000Z');
        await startAutomationRunAttempt(dbAdapter, committing.id, 1);
        await claimAutomationRunCommit(dbAdapter, committing.id, 1);

        await pauseAutomation(
          dbAdapter,
          { automationId: AUTOMATION, user: ADMIN },
          options,
        );
        assert.strictEqual(
          (await getAutomationRun(dbAdapter, committing.id))?.state,
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
            admit: admitAnyPayer,
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
          webhookPaths: [],
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
            admit: admitAnyPayer,
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
            admit: admitAnyPayer,
          },
          options,
        );
        assert.deepEqual(result, { ok: false, reason: 'not-a-direct-writer' });
        let automation = await getAutomation(dbAdapter, AUTOMATION);
        assert.strictEqual(automation?.state, 'paused');
        assert.strictEqual(automation?.payer, OWNER);
      });

      test('a resume whose admission refuses its caller leaves the automation paused under its payer', async function (assert) {
        await switchOn(OWNER);
        await pauseAutomation(
          dbAdapter,
          { automationId: AUTOMATION, user: OWNER },
          options,
        );
        let asked: [string, { at: number | null }][] = [];
        let result = await resumeAutomation(
          dbAdapter,
          {
            automationId: AUTOMATION,
            user: ADMIN,
            declaration: declaration(),
            admit: async (payer, firstRun) => {
              asked.push([payer, firstRun]);
              return { reason: 'insufficient-credits', message: 'short' };
            },
          },
          options,
        );
        assert.deepEqual(result, {
          ok: false,
          reason: 'not-admitted',
          refusal: { reason: 'insufficient-credits', message: 'short' },
        });
        assert.deepEqual(
          asked,
          [[ADMIN, { at: NEXT_DAILY }]],
          'admission is asked once, of the caller, with when the first run after the resume would start',
        );
        let automation = await getAutomation(dbAdapter, AUTOMATION);
        assert.strictEqual(automation?.state, 'paused');
        assert.strictEqual(automation?.payer, OWNER);
      });

      test('admission is not asked of a resume refused for another reason', async function (assert) {
        await switchOn(OWNER);
        let asked = 0;
        let admit = async () => {
          asked++;
          return undefined;
        };
        let active = await resumeAutomation(
          dbAdapter,
          {
            automationId: AUTOMATION,
            user: ADMIN,
            declaration: declaration(),
            admit,
          },
          options,
        );
        assert.strictEqual((active as { reason: string }).reason, 'not-paused');
        await pauseAutomation(
          dbAdapter,
          { automationId: AUTOMATION, user: OWNER },
          options,
        );
        let reader = await resumeAutomation(
          dbAdapter,
          {
            automationId: AUTOMATION,
            user: READER,
            declaration: declaration(),
            admit,
          },
          options,
        );
        assert.strictEqual(
          (reader as { reason: string }).reason,
          'not-a-direct-writer',
        );
        assert.strictEqual(asked, 0);
      });

      test('a pause that commits after the resume read the automation as active still has the caller admitted', async function (assert) {
        await switchOn(OWNER);
        // The pause commits just before the resume's transaction starts: the
        // resume read the automation as active, so it didn't admit anyone.
        let pausedFirst = false;
        let racing = new Proxy(dbAdapter, {
          get(target, property) {
            if (property === 'withTransaction') {
              return async (...args: unknown[]) => {
                if (!pausedFirst) {
                  pausedFirst = true;
                  await pauseAutomation(
                    dbAdapter,
                    { automationId: AUTOMATION, user: OWNER },
                    options,
                  );
                }
                return (target.withTransaction as Function).apply(target, args);
              };
            }
            let value = Reflect.get(target, property, target);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        }) as DBAdapter;
        let asked = 0;
        let result = await resumeAutomation(
          racing,
          {
            automationId: AUTOMATION,
            user: ADMIN,
            declaration: declaration(),
            admit: async () => {
              asked++;
              return { reason: 'binding-not-approved', message: 'no key' };
            },
          },
          options,
        );
        assert.true(
          pausedFirst,
          'the pause committed between the read and the transaction',
        );
        assert.strictEqual(
          asked,
          1,
          'the caller was admitted once the transaction found it paused',
        );
        assert.strictEqual(
          (result as { reason: string }).reason,
          'not-admitted',
        );
        let automation = await getAutomation(dbAdapter, AUTOMATION);
        assert.strictEqual(automation?.state, 'paused');
        assert.strictEqual(automation?.payer, OWNER);
      });
    });

    module('remove', function () {
      test('a direct writer removes an automation, which deletes its row and cancels its pending and running runs', async function (assert) {
        let automation = await switchOn();
        let pending = await pendingRun();
        let running = await pendingRun('2026-11-10T11:30:00.000Z');
        await startAutomationRunAttempt(dbAdapter, running.id, 1);
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
        for (let run of [pending, running]) {
          let canceled = await getAutomationRun(dbAdapter, run.id);
          assert.strictEqual(canceled?.state, 'canceled');
          assert.strictEqual(canceled?.canceledBy, ADMIN);
        }

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
      test('raising the AI spending cap pauses the automation', async function (assert) {
        await switchOn();
        let automation = await checkAutomationCaps(dbAdapter, AUTOMATION, {
          caps: { ...CAPS, aiCredits: CAPS.aiCredits + 1 },
          batchedAI: false,
        });
        assert.strictEqual(automation?.state, 'paused');
        assert.strictEqual(automation?.pauseReason, 'caps-raised');
        assert.strictEqual(
          automation?.capsSnapshot.aiCredits,
          CAPS.aiCredits,
          'the snapshot keeps the AI spending cap the payer agreed to',
        );
      });

      test('raising a run cap pauses the automation, cancels its pending and running runs, and keeps the payer', async function (assert) {
        await switchOn();
        let pending = await pendingRun();
        let running = await pendingRun('2026-11-10T11:30:00.000Z');
        await startAutomationRunAttempt(dbAdapter, running.id, 1);
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
        let stopped = await getAutomationRun(dbAdapter, running.id);
        assert.strictEqual(stopped?.state, 'canceled');
        assert.strictEqual(stopped?.canceledBy, null);
        assert.strictEqual(stopped?.errorReason, 'caps-raised');
        assert.deepEqual(
          (await readRunLog(dbAdapter, running.id))?.lines.map(
            ({ kind, message }) => ({ kind, message }),
          ),
          [{ kind: 'finish', message: 'The run was canceled (caps-raised)' }],
          'its log ends with the pause that canceled it',
        );
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
            admit: admitAnyPayer,
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
          webhookPaths: [],
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
            admit: admitAnyPayer,
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
            admit: admitAnyPayer,
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

      test('a sync reports the automation when it removes, pauses, or moves it between active and done, and nothing else', async function (assert) {
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
        let reported: string[] = [];
        let syncReporting = async (
          card: AutomationCardSource | undefined,
          now = NOW,
        ) => {
          let before = reported.length;
          let result = await syncAutomationWithCard(
            dbAdapter,
            AUTOMATION,
            async () => card,
            {
              automationTypeKey: automationTypeKey(),
              virtualNetwork: options.virtualNetwork,
              now,
              reportAutomationChange: async ({ automationId }) => {
                reported.push(automationId);
              },
            },
          );
          return { kind: result?.kind, reports: reported.length - before };
        };

        assert.deepEqual(
          await syncReporting(
            indexed({ triggers: [cronTrigger({ count: 3 })] }),
          ),
          { kind: 'recomputed', reports: 0 },
          'a sync that leaves the automation active reports nothing',
        );
        await setRuns('daily', 3, NEXT_DAILY - 86400);
        assert.deepEqual(
          await syncReporting(
            indexed({ triggers: [cronTrigger({ count: 3 })] }),
          ),
          { kind: 'recomputed', reports: 1 },
          'a sync that makes it done reports it',
        );
        assert.deepEqual(
          await syncReporting(
            indexed({ triggers: [cronTrigger({ count: 5 })] }),
            NOW + 86400,
          ),
          { kind: 'recomputed', reports: 1 },
          'a sync that makes it active again reports it',
        );
        assert.deepEqual(
          await syncReporting(
            indexed({
              triggers: [cronTrigger({ count: 5 })],
              caps: { ...CAPS, aiCredits: CAPS.aiCredits + 1 },
            }),
          ),
          { kind: 'paused', reports: 1 },
          'a sync that pauses it reports it',
        );
        assert.deepEqual(
          await syncReporting(indexed()),
          { kind: 'unchanged', reports: 0 },
          'a sync that leaves a paused automation as it was reports nothing',
        );
        assert.deepEqual(
          await syncReporting(undefined),
          { kind: 'removed', reports: 1 },
          'a sync that removes it reports it',
        );
        assert.deepEqual(reported, [
          AUTOMATION,
          AUTOMATION,
          AUTOMATION,
          AUTOMATION,
        ]);
      });

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

      test('a label the card drops is recorded as not declared, while active and while paused alike', async function (assert) {
        let hourly = {
          kind: 'cron' as const,
          label: 'hourly',
          expression: '0 * * * *',
          timeZone: 'America/Chicago',
        };
        await switchOn(
          OWNER,
          declaration({ triggers: [...declaration().triggers, hourly] }),
        );
        let declared = (automation: AutomationRow | undefined) =>
          Object.fromEntries(
            Object.entries(automation?.triggerRuns ?? {}).map(
              ([label, { declared }]) => [label, declared],
            ),
          );

        let dropped = await sync(indexed({ triggers: [cronTrigger()] }));
        assert.strictEqual(dropped?.kind, 'recomputed');
        assert.deepEqual(
          declared(dropped?.automation),
          { daily: true, hourly: false },
          'an edit that drops a trigger keeps its run state, marked not declared',
        );

        await pauseAutomation(
          dbAdapter,
          { automationId: AUTOMATION, user: OWNER },
          options,
        );
        let restored = await sync(
          indexed({
            triggers: [
              cronTrigger(),
              cronTrigger({ label: 'hourly', expression: '0 * * * *' }),
            ],
          }),
        );
        assert.strictEqual(
          restored?.kind,
          'unchanged',
          'a paused automation keeps its schedule',
        );
        assert.deepEqual(
          declared(restored?.automation),
          { daily: true, hourly: true },
          'an edit while paused that brings the trigger back marks it declared',
        );
        assert.false(
          restored?.automation.triggerRuns.hourly.live,
          'the paused row leaves `live` as it was, so the trigger starts at the edit that resumes it',
        );

        let droppedWhilePaused = await sync(
          indexed({ triggers: [cronTrigger()] }),
        );
        assert.deepEqual(
          declared(droppedWhilePaused?.automation),
          { daily: true, hourly: false },
          'an edit while paused that drops the trigger marks it not declared',
        );

        let addedWhilePaused = await sync(
          indexed({
            triggers: [
              cronTrigger(),
              cronTrigger({ label: 'weekly', expression: '0 9 * * 1' }),
            ],
          }),
        );
        assert.deepEqual(
          addedWhilePaused?.automation.triggerRuns.weekly,
          { runs: 0, live: false, declared: true },
          'an edit while paused that adds a trigger records the trigger as declared, with no cursor and not live',
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
        await insertWebhooks(dbAdapter);
        await switchOn(
          OWNER,
          declaration({
            triggers: [
              ...declaration().triggers,
              webhookTrigger(OWNER_WEBHOOK, 'push'),
            ],
          }),
        );
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
                webhookPath: OWNER_WEBHOOK,
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

      test('a card that failed to index leaves the row as it was', async function (assert) {
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
        assert.deepEqual(await getAutomation(dbAdapter, AUTOMATION), before);
      });

      test('a card that indexed but does not read as a declaration leaves the row as it was', async function (assert) {
        let before = await switchOn();
        // The card saves itself mid-edit: a trigger just added has no label
        // or kind yet, and an expression can be half typed.
        for (let triggers of [
          [cronTrigger(), { kind: null, label: null }],
          [cronTrigger({ expression: '58,1 0,23 * * *' })],
        ]) {
          let result = await sync(indexed({ triggers }));
          assert.strictEqual(result?.kind, 'unchanged');
        }
        assert.deepEqual(await getAutomation(dbAdapter, AUTOMATION), before);
      });

      test('an automation paused for an invalid declaration follows the card: its problems update, and it resumes once the card reads', async function (assert) {
        await switchOn();
        let pending = await pendingRun();
        let running = await pendingRun('2026-11-11T11:00:00.000Z');
        await query(dbAdapter, [
          "UPDATE automation_runs SET state = 'running', started_at = now() WHERE id =",
          param(running.id),
        ]);
        let reported: string[] = [];
        // 23:58 and the next day's 00:01 are 3 minutes apart, which a check
        // of times within one day misses.
        let tooFrequent = indexed({
          triggers: [cronTrigger({ expression: '58,1 0,23 * * *' })],
        });
        let paused = await pauseForInvalidDeclaration(
          dbAdapter,
          AUTOMATION,
          async () => {
            let read = readAutomationDeclaration(
              { ...tooFrequent, url: AUTOMATION },
              {
                automationTypeKey: automationTypeKey(),
                virtualNetwork: options.virtualNetwork,
              },
            );
            return read.ok ? undefined : read.problems;
          },
          {
            reportAutomationChange: async ({ automationId }) => {
              reported.push(automationId);
            },
          },
        );
        assert.strictEqual(paused?.state, 'paused');
        assert.strictEqual(paused?.pauseReason, 'invalid-declaration');
        assert.deepEqual(
          paused?.pauseProblems?.map(({ code, path }) => [code, path]),
          [['cron-too-frequent', 'triggers.0.expression']],
        );
        assert.deepEqual(reported, [AUTOMATION], 'the pause is reported');
        assert.strictEqual(
          (await getAutomationRun(dbAdapter, pending.id))?.state,
          'canceled',
          'a pending run is canceled',
        );
        assert.strictEqual(
          (await getAutomationRun(dbAdapter, running.id))?.state,
          'running',
          'a running run is left to finish',
        );

        let followed = await sync(
          indexed({ triggers: [cronTrigger({ expression: 'not cron' })] }),
        );
        assert.strictEqual(followed?.kind, 'recomputed');
        assert.deepEqual(
          followed?.automation.pauseProblems?.map(({ code }) => code),
          ['invalid-cron'],
          'the problems follow the card',
        );
        assert.strictEqual(followed?.automation.state, 'paused');
        assert.strictEqual(
          (
            await sync(
              indexed({ triggers: [cronTrigger({ expression: 'not cron' })] }),
            )
          )?.kind,
          'unchanged',
          'the same problems change nothing',
        );

        let resumed = await sync(indexed(), NOW + 3600);
        assert.strictEqual(resumed?.kind, 'resumed');
        let after = await getAutomation(dbAdapter, AUTOMATION);
        assert.strictEqual(after?.state, 'active');
        assert.strictEqual(after?.pauseReason, null);
        assert.strictEqual(after?.pauseProblems, null);
        assert.strictEqual(after?.payer, OWNER, 'the payer stays');
        assert.strictEqual(
          after?.scheduledSince,
          paused?.scheduledSince,
          'scheduled_since stays the payer’s switch-on, the moment a revocation of their sessions is held against',
        );
        assert.true(
          Object.values(after!.triggerRuns).every(
            ({ since }) => since === NOW + 3600,
          ),
          'each trigger’s cursor moves up to the resume, so no slot from the pause runs',
        );
        assert.true(
          (after?.nextRun ?? 0) > NOW + 3600,
          'the next run comes after the resume',
        );
      });

      test('an automation paused for an invalid declaration whose fixed card raises a cap pauses for the cap', async function (assert) {
        await switchOn();
        await pauseForInvalidDeclaration(dbAdapter, AUTOMATION, async () => [
          { code: 'invalid-cron', path: 'triggers.0.expression', message: 'x' },
        ]);
        let result = await sync(indexed({ caps: { ...CAPS, writes: 500 } }));
        assert.strictEqual(result?.kind, 'paused');
        assert.strictEqual(result?.automation.pauseReason, 'caps-raised');
        assert.strictEqual(result?.automation.pauseProblems, null);
      });

      test('a paused automation is not paused again for an invalid declaration, and a readable card does not pause', async function (assert) {
        await switchOn();
        let fine = await pauseForInvalidDeclaration(
          dbAdapter,
          AUTOMATION,
          async () => undefined,
        );
        assert.strictEqual(fine?.state, 'active');
        await pauseAutomation(
          dbAdapter,
          { automationId: AUTOMATION, user: OWNER },
          options,
        );
        let kept = await pauseForInvalidDeclaration(
          dbAdapter,
          AUTOMATION,
          async () => [
            {
              code: 'invalid-cron',
              path: 'triggers.0.expression',
              message: 'x',
            },
          ],
        );
        assert.strictEqual(kept?.pauseReason, 'requested');
        assert.strictEqual(kept?.pauseProblems, null);
        let stillPaused = await sync(indexed());
        assert.strictEqual(
          stillPaused?.kind,
          'unchanged',
          'a person’s pause is not lifted when the card reads',
        );
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

      module('webhook triggers', function (hooks) {
        hooks.beforeEach(async function () {
          await insertWebhooks(dbAdapter);
        });

        function webhookCard(...paths: string[]): Record<string, unknown>[] {
          return paths.map((webhookPath, index) => ({
            ...cronTrigger(),
            kind: 'webhook',
            label: `deliveries-${index}`,
            expression: null,
            timeZone: null,
            webhookPath,
          }));
        }

        function webhookDeclaration(...paths: string[]) {
          return declaration({
            triggers: paths.map((path, index) =>
              webhookTrigger(path, `deliveries-${index}`),
            ),
          });
        }

        test('switch-on accepts a webhook any direct writer of the realm made, and snapshots it', async function (assert) {
          let automation = await switchOn(
            OWNER,
            webhookDeclaration(ADMIN_WEBHOOK, OWNER_WEBHOOK),
          );
          assert.deepEqual(
            automation.capsSnapshot.webhookPaths,
            [ADMIN_WEBHOOK, OWNER_WEBHOOK],
            'the snapshot holds each webhook the payer agreed to',
          );
        });

        test('switch-on refuses a foreign webhook, a reader’s webhook and an unknown one, naming each trigger', async function (assert) {
          let result = await switchOnAutomation(
            dbAdapter,
            {
              automationId: AUTOMATION,
              realm: REALM,
              user: OWNER,
              declaration: webhookDeclaration(
                OUTSIDER_WEBHOOK,
                OWNER_WEBHOOK,
                READER_WEBHOOK,
                'whk_nowhere',
              ),
            },
            options,
          );
          assert.false(result.ok);
          let refusal = result as { reason: string; problems: unknown[] };
          assert.strictEqual(refusal.reason, 'unusable-webhook');
          assert.deepEqual(
            (refusal.problems as { code: string; path: string }[]).map(
              ({ code, path }) => ({ code, path }),
            ),
            [
              { code: 'foreign-webhook', path: 'triggers.0.webhookPath' },
              { code: 'foreign-webhook', path: 'triggers.2.webhookPath' },
              { code: 'unknown-webhook', path: 'triggers.3.webhookPath' },
            ],
          );
          assert.strictEqual(
            await getAutomation(dbAdapter, AUTOMATION),
            undefined,
            'nothing is switched on',
          );
        });

        test('a webhook stops being the realm’s once its owner loses write', async function (assert) {
          await insertPermissions(dbAdapter, new URL(REALM_URL), {
            [ADMIN]: ['read'],
          });
          let result = await switchOnAutomation(
            dbAdapter,
            {
              automationId: AUTOMATION,
              realm: REALM,
              user: OWNER,
              declaration: webhookDeclaration(ADMIN_WEBHOOK),
            },
            options,
          );
          assert.strictEqual(
            (result as { reason: string }).reason,
            'unusable-webhook',
          );
        });

        test('pointing a switched-on automation’s webhook trigger at another webhook pauses it until a resume', async function (assert) {
          await switchOn(OWNER, webhookDeclaration(OWNER_WEBHOOK));
          let pending = await createAutomationRun(dbAdapter, {
            automationId: AUTOMATION,
            realm: REALM,
            trigger: 'deliveries-0',
            slot: 'delivery-1',
            actsAs: OWNER,
          });

          let result = await sync(
            indexed({ triggers: webhookCard(OUTSIDER_WEBHOOK) }),
          );
          assert.strictEqual(result?.kind, 'paused');
          assert.strictEqual(result?.automation.pauseReason, 'webhook-changed');
          assert.deepEqual(
            result?.automation.capsSnapshot.webhookPaths,
            [OWNER_WEBHOOK],
            'the snapshot keeps the webhook the payer agreed to',
          );
          let canceled = await getAutomationRun(dbAdapter, pending.id);
          assert.strictEqual(canceled?.state, 'canceled');
          assert.strictEqual(canceled?.errorReason, 'webhook-changed');

          let refused = await resumeAutomation(
            dbAdapter,
            {
              automationId: AUTOMATION,
              user: OWNER,
              declaration: webhookDeclaration(OUTSIDER_WEBHOOK),
              admit: admitAnyPayer,
            },
            options,
          );
          assert.strictEqual(
            (refused as { reason: string }).reason,
            'unusable-webhook',
            'the payer cannot confirm a foreign webhook',
          );

          let confirmed = await resumeAutomation(
            dbAdapter,
            {
              automationId: AUTOMATION,
              user: ADMIN,
              declaration: webhookDeclaration(ADMIN_WEBHOOK),
              admit: admitAnyPayer,
            },
            options,
          );
          assert.true(confirmed.ok);
          let automation = (confirmed as { automation: AutomationRow })
            .automation;
          assert.strictEqual(automation.state, 'active');
          assert.strictEqual(automation.payer, ADMIN);
          assert.deepEqual(automation.capsSnapshot.webhookPaths, [
            ADMIN_WEBHOOK,
          ]);
          let after = await sync(
            indexed({ triggers: webhookCard(ADMIN_WEBHOOK) }),
          );
          assert.strictEqual(
            after?.kind,
            'recomputed',
            'the confirmed webhook doesn’t pause it again',
          );
        });

        test('adding a webhook trigger pauses a switched-on automation, and removing one does not', async function (assert) {
          await switchOn(
            OWNER,
            webhookDeclaration(OWNER_WEBHOOK, ADMIN_WEBHOOK),
          );
          let removed = await sync(
            indexed({ triggers: webhookCard(OWNER_WEBHOOK) }),
          );
          assert.strictEqual(removed?.kind, 'recomputed');
          assert.strictEqual(removed?.automation.state, 'active');

          await removeAutomation(
            dbAdapter,
            { automationId: AUTOMATION, user: OWNER },
            options,
          );
          await switchOn();
          let added = await sync(
            indexed({
              triggers: [cronTrigger(), ...webhookCard(OWNER_WEBHOOK)],
            }),
          );
          assert.strictEqual(added?.kind, 'paused');
          assert.strictEqual(added?.automation.pauseReason, 'webhook-changed');
        });

        test('checkAutomationCaps pauses for a new webhook when the card it is given carries its triggers', async function (assert) {
          await switchOn(OWNER, webhookDeclaration(OWNER_WEBHOOK));
          let capsOnly = await checkAutomationCaps(dbAdapter, AUTOMATION, {
            caps: CAPS,
            batchedAI: false,
          });
          assert.strictEqual(capsOnly?.state, 'active');
          let paused = await checkAutomationCaps(dbAdapter, AUTOMATION, {
            caps: CAPS,
            batchedAI: false,
            triggers: webhookDeclaration(ADMIN_WEBHOOK).triggers,
          });
          assert.strictEqual(paused?.pauseReason, 'webhook-changed');
        });

        test('a snapshot without webhookPaths agreed to no webhook, so the webhook its card names pauses the automation', async function (assert) {
          await switchOn(OWNER, webhookDeclaration(OWNER_WEBHOOK));
          await dbAdapter.execute(
            `UPDATE automations SET caps_snapshot = caps_snapshot - 'webhookPaths'`,
          );
          assert.deepEqual(
            (await getAutomation(dbAdapter, AUTOMATION))?.capsSnapshot
              .webhookPaths,
            [],
            'the snapshot reads as agreeing to no webhook',
          );
          let result = await sync(
            indexed({ triggers: webhookCard(OWNER_WEBHOOK) }),
          );
          assert.strictEqual(result?.kind, 'paused');
          assert.strictEqual(result?.automation.pauseReason, 'webhook-changed');
        });

        test('a snapshot without webhookPaths leaves an automation whose card names no webhook running', async function (assert) {
          await switchOn();
          await dbAdapter.execute(
            `UPDATE automations SET caps_snapshot = caps_snapshot - 'webhookPaths'`,
          );
          let result = await sync(indexed());
          assert.strictEqual(result?.automation.state, 'active');
          assert.strictEqual(result?.automation.pauseReason, null);
        });

        test('a delivery never takes an automation whose snapshot has no webhookPaths as a candidate', async function (assert) {
          await switchOn(OWNER, webhookDeclaration(OWNER_WEBHOOK));
          // A card that doesn't read ends a candidate's handling before any
          // run or job, so `unreadable` shows the automation was a candidate.
          let reads = 0;
          let deliver = (deliveryId: string) =>
            startWebhookAutomationRuns(
              dbAdapter,
              {
                webhookPath: OWNER_WEBHOOK,
                owner: OWNER,
                deliveryId,
                payload: {},
              },
              {
                queue: {} as QueuePublisher,
                readDeclaration: async () => {
                  reads++;
                  return { ok: false, message: 'not read in this test' };
                },
                virtualNetwork: options.virtualNetwork,
                matrixServerName: 'localhost',
              },
            );
          assert.deepEqual(
            await deliver('agreed'),
            [
              {
                kind: 'skipped',
                automationId: AUTOMATION,
                reason: 'unreadable',
              },
            ],
            'a snapshot that lists the webhook makes the automation a candidate',
          );
          await dbAdapter.execute(
            `UPDATE automations SET caps_snapshot = caps_snapshot - 'webhookPaths'`,
          );
          assert.deepEqual(await deliver('unagreed'), [], 'no candidate');
          assert.strictEqual(reads, 1, 'the card is read only as a candidate');
        });

        test('an automation paused for an invalid declaration whose fixed card names another webhook pauses for the webhook', async function (assert) {
          await switchOn(OWNER, webhookDeclaration(OWNER_WEBHOOK));
          await pauseForInvalidDeclaration(dbAdapter, AUTOMATION, async () => [
            {
              code: 'missing-webhook-path',
              path: 'triggers.0.webhookPath',
              message: 'x',
            },
          ]);
          let result = await sync(
            indexed({ triggers: webhookCard(ADMIN_WEBHOOK) }),
          );
          assert.strictEqual(result?.kind, 'paused');
          assert.strictEqual(result?.automation.pauseReason, 'webhook-changed');
          assert.strictEqual(result?.automation.pauseProblems, null);
        });
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

        let reported: string[] = [];
        let touched = await syncAutomationsAfterIndex({
          dbAdapter,
          definitionLookup,
          virtualNetwork,
          realmURL: REALM_URL,
          touched: [`${AUTOMATION}.json`],
          reportAutomationChange: async ({ automationId }) => {
            reported.push(automationId);
          },
        });
        assert.strictEqual(touched.get(AUTOMATION)?.kind, 'removed');
        assert.deepEqual(
          reported,
          [AUTOMATION],
          'the hook hands its reporter to the sync, which reports the removal',
        );
        assert.strictEqual(
          await getAutomation(dbAdapter, AUTOMATION),
          undefined,
        );
      });

      test("one automation's failed sync doesn't stop the rest of the realm's", async function (assert) {
        await switchOn();
        // An id the network can't resolve sorts first and fails its sync.
        await dbAdapter.execute(
          `INSERT INTO automations (automation_id, realm, payer, caps_snapshot, scheduled_since) VALUES ('@nowhere/broken', '${REALM}', '${OWNER}', '{}'::jsonb, now())`,
        );
        let synced = await syncAutomationsAfterIndex({
          dbAdapter,
          definitionLookup,
          virtualNetwork,
          realmURL: REALM_URL,
        });
        assert.strictEqual(synced.get('@nowhere/broken')?.kind, 'failed');
        assert.strictEqual(
          synced.get(AUTOMATION)?.kind,
          'removed',
          'the automation after it still syncs',
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
            admit: admitAnyPayer,
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

    module('reporting what a change did', function (hooks) {
      // Every report, in order: `automation` for an automation's row,
      // `run` for a run.
      let reports: string[];

      hooks.beforeEach(function () {
        reports = [];
        options = {
          ...options,
          reportAutomationChange: async ({
            automationId,
            realm,
          }: ChangedAutomation) => {
            reports.push(`automation ${automationId} in ${realm}`);
          },
          reportRunChange: async (runId: string) => {
            reports.push(`run ${runId}`);
          },
        };
      });

      const CHANGED = `automation ${AUTOMATION} in ${REALM}`;

      test('switching on, pausing, resuming and removing each report the automation once it has committed', async function (assert) {
        await switchOn();
        assert.deepEqual(reports, [CHANGED], 'switch-on');

        reports = [];
        let run = await pendingRun();
        await pauseAutomation(
          dbAdapter,
          { automationId: AUTOMATION, user: OWNER },
          options,
        );
        assert.deepEqual(
          reports,
          [`run ${run.id}`, CHANGED],
          'a pause reports the run it canceled, then the automation',
        );

        reports = [];
        await resumeAutomation(
          dbAdapter,
          {
            automationId: AUTOMATION,
            user: ADMIN,
            declaration: declaration(),
            admit: admitAnyPayer,
          },
          options,
        );
        assert.deepEqual(reports, [CHANGED], 'resume');

        reports = [];
        await removeAutomation(
          dbAdapter,
          { automationId: AUTOMATION, user: OWNER },
          options,
        );
        assert.deepEqual(reports, [CHANGED], 'remove');
      });

      test('a pause reports the automation even with no run to cancel', async function (assert) {
        await switchOn();
        reports = [];
        await pauseAutomation(
          dbAdapter,
          { automationId: AUTOMATION, user: OWNER },
          options,
        );
        assert.deepEqual(reports, [CHANGED]);
      });

      test('a refused change reports nothing', async function (assert) {
        await switchOn();
        reports = [];
        let refusals = [
          await switchOnAutomation(
            dbAdapter,
            {
              automationId: AUTOMATION,
              realm: REALM,
              user: OWNER,
              declaration: declaration(),
            },
            options,
          ),
          await pauseAutomation(
            dbAdapter,
            { automationId: AUTOMATION, user: READER },
            options,
          ),
          await resumeAutomation(
            dbAdapter,
            {
              automationId: AUTOMATION,
              user: OWNER,
              declaration: declaration(),
              admit: admitAnyPayer,
            },
            options,
          ),
          await removeAutomation(
            dbAdapter,
            { automationId: AUTOMATION, user: READER },
            options,
          ),
        ];
        assert.deepEqual(
          refusals.map((r) => (r.ok ? 'ok' : r.reason)),
          [
            'already-switched-on',
            'not-a-direct-writer',
            'not-paused',
            'not-a-direct-writer',
          ],
        );
        assert.deepEqual(reports, []);
      });

      test('a pause the database rolls back and retries reports the automation once', async function (assert) {
        await switchOn();
        reports = [];
        await pauseAutomation(
          rollsBackFirstTransaction(dbAdapter),
          { automationId: AUTOMATION, user: OWNER },
          options,
        );
        assert.deepEqual(reports, [CHANGED]);
      });

      test('a pause no person asked for reports the automation, and a check that pauses nothing reports nothing', async function (assert) {
        await switchOn();
        reports = [];
        await checkAutomationCaps(
          dbAdapter,
          AUTOMATION,
          declaration(),
          options,
        );
        assert.deepEqual(reports, [], 'caps kept: nothing changed');

        await checkAutomationCaps(
          dbAdapter,
          AUTOMATION,
          declaration({ caps: { ...CAPS, writes: CAPS.writes + 1 } }),
          options,
        );
        assert.deepEqual(reports, [CHANGED], 'a raised cap pauses it');
      });

      test('the payer losing direct write reports the automation', async function (assert) {
        await switchOn();
        reports = [];
        await insertPermissions(dbAdapter, new URL(REALM_URL), {
          [OWNER]: ['read'],
        });
        await checkAutomationPayer(dbAdapter, AUTOMATION, options);
        assert.strictEqual(
          (await getAutomation(dbAdapter, AUTOMATION))?.state,
          'paused',
        );
        assert.deepEqual(reports, [CHANGED]);
      });

      test('archiving the realm reports each automation it pauses', async function (assert) {
        await switchOn();
        reports = [];
        await pauseRealmAutomations(dbAdapter, REALM, options);
        assert.deepEqual(reports, [CHANGED]);

        reports = [];
        await pauseRealmAutomations(dbAdapter, REALM, options);
        assert.deepEqual(reports, [], 'one paused already is not reported');
      });

      test('canceling a run reports the run and not the automation', async function (assert) {
        await switchOn();
        let run = await pendingRun();
        reports = [];
        await cancelAutomationRunFor(
          dbAdapter,
          { runId: run.id, user: OWNER },
          options,
        );
        assert.deepEqual(reports, [`run ${run.id}`]);
      });
    });
  });
});
