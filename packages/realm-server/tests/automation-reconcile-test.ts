import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  claimAutomationRunCommit,
  createAutomationRun,
  getAutomationRun,
  insertPermissions,
  query,
  recordAutomationRunCommitted,
  ri,
  rri,
  startAutomationRunAttempt,
  VirtualNetwork,
  type AutomationRun,
  type DBAdapter,
  type QueuePublisher,
} from '@cardstack/runtime-common';
import {
  getAutomation,
  switchOnAutomation,
  type AutomationRow,
} from '@cardstack/runtime-common/automations';
import {
  MAX_RUN_SECONDS,
  type AutomationCaps,
  type AutomationDeclaration,
} from '@cardstack/runtime-common/automation-declaration';
import { automationJobTimeoutSec } from '@cardstack/runtime-common/automation-run-command';
import {
  tickAutomations,
  type AutomationDeclarationRead,
} from '@cardstack/runtime-common/automation-tick';
import {
  reconcileAutomations,
  registerAutomationReconcileStep,
  JOB_LOST_REASON,
  type AutomationReconcileResult,
} from '@cardstack/runtime-common/automation-reconcile';
import { readRunLog } from '@cardstack/runtime-common/automation-run-log';
import { setupDB } from './helpers/index.ts';

const REALM_URL = 'http://127.0.0.1:4444/payroll/';
const REALM = ri(REALM_URL);
const AUTOMATION = rri(`${REALM_URL}Automation/hourly-sync`);
const OWNER = '@owner:localhost';
const CLICKER = '@clicker:localhost';

function at(iso: string): number {
  return Date.parse(iso) / 1000;
}

function iso(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

// Switched on a minute before the hour, so the hourly trigger's first slot is
// 12:00 UTC.
const SWITCHED_ON = at('2026-11-10T11:59:00Z');
const NOON = at('2026-11-10T12:00:00Z');
const NOON_SLOT = '2026-11-10T12:00:00.000Z';

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

const HOURLY = {
  kind: 'cron' as const,
  label: 'hourly',
  expression: '0 * * * *',
  timeZone: 'UTC',
};

function declaration(
  overrides: Partial<AutomationDeclaration> = {},
): AutomationDeclaration {
  return {
    url: AUTOMATION,
    realmURL: REALM_URL,
    script: rri(`${REALM_URL}scripts/hourly-sync.js`),
    triggers: [HOURLY],
    operations: [],
    caps: CAPS,
    params: {},
    batchedAI: false,
    batchDeadlineMinutes: 60,
    ...overrides,
  };
}

interface QueuedRun {
  id: number;
  status: string;
  timeout: number;
  concurrencyGroup: string;
  dedupeKey: string;
  input: Record<string, unknown>;
}

const silentLog = { info() {}, warn() {}, error() {} };

module(basename(import.meta.filename), function (hooks) {
  let dbAdapter: DBAdapter;
  let publisher: QueuePublisher;
  let virtualNetwork: VirtualNetwork;
  // The card as the index holds it, which reconcile reads.
  let card: AutomationDeclarationRead;

  setupDB(hooks, {
    beforeEach: async (_dbAdapter, _publisher) => {
      dbAdapter = _dbAdapter;
      publisher = _publisher;
      virtualNetwork = new VirtualNetwork();
      card = { ok: true, declaration: declaration() };
      await insertPermissions(dbAdapter, new URL(REALM_URL), {
        [OWNER]: ['read', 'write', 'realm-owner'],
      });
    },
  });

  async function switchOn(): Promise<AutomationRow> {
    let result = await switchOnAutomation(
      dbAdapter,
      {
        automationId: AUTOMATION,
        realm: REALM,
        user: OWNER,
        declaration: card.ok ? card.declaration : declaration(),
      },
      { matrixServerName: 'localhost', virtualNetwork, now: SWITCHED_ON },
    );
    if (!result.ok) {
      throw new Error(`expected switch-on, got ${result.reason}`);
    }
    return result.automation;
  }

  async function reconcile(now: number): Promise<AutomationReconcileResult> {
    return await reconcileAutomations(dbAdapter, {
      queue: publisher,
      virtualNetwork,
      readDeclaration: async () => card,
      log: silentLog,
      now,
    });
  }

  async function tick(now: number) {
    return await tickAutomations(dbAdapter, {
      queue: publisher,
      virtualNetwork,
      readDeclaration: async () => card,
      now,
    });
  }

  async function row(): Promise<AutomationRow> {
    return (await getAutomation(dbAdapter, AUTOMATION))!;
  }

  async function runs(): Promise<AutomationRun[]> {
    let rows = await query(dbAdapter, [
      'SELECT id FROM automation_runs ORDER BY trigger, slot',
    ]);
    return await Promise.all(
      rows.map(async ({ id }) => (await getAutomationRun(dbAdapter, `${id}`))!),
    );
  }

  async function queuedRuns(): Promise<QueuedRun[]> {
    let rows = await query(dbAdapter, [
      `SELECT id, status, timeout, concurrency_group, args FROM jobs WHERE job_type = 'run-command' ORDER BY id`,
    ]);
    return rows.map((r) => {
      let args = (
        typeof r.args === 'string' ? JSON.parse(r.args) : r.args
      ) as Record<string, any>;
      return {
        id: Number(r.id),
        status: String(r.status),
        timeout: Number(r.timeout),
        concurrencyGroup: String(r.concurrency_group),
        dedupeKey: args.dedupeKey,
        input: args.commandInput,
      };
    });
  }

  // The queue gave up on every unfinished run job, as it does after a job's
  // last reservation.
  async function loseJobs() {
    await query(dbAdapter, [
      `UPDATE jobs SET status = 'rejected', finished_at = now() WHERE job_type = 'run-command' AND status = 'unfulfilled'`,
    ]);
  }

  // Ages every run past reconcile's grace at `now`.
  async function madeAt(seconds: number) {
    await query(dbAdapter, [
      'UPDATE automation_runs SET created_at =',
      `'${iso(seconds)}'::timestamptz`,
    ]);
  }

  async function reconciledAt(runId: string): Promise<unknown> {
    let [r] = await query(dbAdapter, [
      `SELECT reconciled_at FROM automation_runs WHERE id = '${runId}'`,
    ]);
    return r.reconciled_at;
  }

  test('several missed instants produce one make-up run, at the latest of them', async function (assert) {
    await switchOn();
    // The tick was down from before noon until after 17:00.
    let now = at('2026-11-10T17:20:00Z');
    let result = await reconcile(now);

    let made = await runs();
    assert.strictEqual(made.length, 1, 'one make-up run');
    assert.strictEqual(
      made[0].slot,
      '2026-11-10T17:00:00.000Z',
      'its slot is the latest missed instant',
    );
    assert.strictEqual(made[0].state, 'pending');
    let jobs = await queuedRuns();
    assert.deepEqual(
      jobs.map(({ dedupeKey }) => dedupeKey),
      [`automation:${AUTOMATION}:hourly:2026-11-10T17:00:00.000Z`],
      'one job, keyed by the missed instant',
    );
    assert.deepEqual(
      result.overdue.map((outcome) =>
        outcome.kind === 'enqueued'
          ? outcome.triggers.map(({ kind, slot }) => ({ kind, slot }))
          : outcome.kind,
      ),
      [[{ kind: 'started', slot: '2026-11-10T17:00:00.000Z' }]],
    );
    let automation = await row();
    assert.deepEqual(
      {
        runs: automation.triggerRuns.hourly.runs,
        lastSlot: automation.triggerRuns.hourly.lastSlot,
      },
      { runs: 1, lastSlot: at('2026-11-10T17:00:00Z') },
      'the make-up counts as one run',
    );
    assert.strictEqual(
      automation.nextRun,
      at('2026-11-10T18:00:00Z'),
      'the schedule carries on',
    );

    await reconcile(now + 30);
    await tick(now + 30);
    assert.strictEqual((await runs()).length, 1, 'nothing more is made up');
  });

  test('an automation that just came due is left to the tick', async function (assert) {
    await switchOn();
    let result = await reconcile(NOON + 60);
    assert.deepEqual(result.overdue, [], 'nothing is overdue yet');
    assert.deepEqual(await runs(), []);
    assert.deepEqual(await queuedRuns(), []);
  });

  test('reconcile and the tick at once start one make-up run', async function (assert) {
    await switchOn();
    let now = at('2026-11-10T15:30:00Z');
    await Promise.all([reconcile(now), tick(now), reconcile(now), tick(now)]);
    let made = await runs();
    assert.deepEqual(
      made.map(({ slot }) => slot),
      ['2026-11-10T15:00:00.000Z'],
      'one run, at the latest missed instant',
    );
    assert.strictEqual((await queuedRuns()).length, 1, 'one job');
    assert.strictEqual((await row()).triggerRuns.hourly.runs, 1);
  });

  test('a pending run whose job is gone is enqueued again with the same slot, and ended if its job is lost again', async function (assert) {
    await switchOn();
    await tick(NOON + 30);
    let [run] = await runs();
    let [firstJob] = await queuedRuns();
    await loseJobs();
    await madeAt(NOON + 30);
    let now = NOON + 10 * 60;

    let result = await reconcile(now);
    let jobs = await queuedRuns();
    assert.strictEqual(jobs.length, 2, 'a new job is enqueued');
    let [, secondJob] = jobs;
    assert.deepEqual(
      result.lostRuns,
      [
        {
          kind: 'requeued',
          runId: run.id,
          automationId: AUTOMATION,
          trigger: 'hourly',
          slot: NOON_SLOT,
          jobId: secondJob.id,
        },
      ],
      'the run is enqueued again',
    );
    assert.strictEqual(secondJob.status, 'unfulfilled');
    assert.strictEqual(secondJob.dedupeKey, firstJob.dedupeKey, 'same key');
    assert.deepEqual(secondJob.input, firstJob.input, 'same input');
    assert.strictEqual(
      secondJob.concurrencyGroup,
      `automation:${AUTOMATION}`,
      "in the automation's concurrency group",
    );
    assert.strictEqual(
      (await getAutomationRun(dbAdapter, run.id))?.state,
      'pending',
      'the run is still pending, for its new job',
    );
    assert.ok(await reconciledAt(run.id), 'the new job is recorded');
    assert.deepEqual(
      (await row()).triggerRuns.hourly.runs,
      1,
      "the trigger's count doesn't change",
    );
    let log = await readRunLog(dbAdapter, run.id);
    assert.true(
      log?.lines.some(
        ({ kind, message }) =>
          kind === 'trigger' &&
          /^Reconcile enqueued this run again/.test(message),
      ),
      "the run's log says reconcile enqueued it again",
    );

    assert.deepEqual(
      (await reconcile(now + 60)).lostRuns,
      [],
      'a run with a live job is left alone',
    );

    await loseJobs();
    result = await reconcile(now + 120);
    assert.strictEqual(result.lostRuns.length, 1);
    let [ended] = result.lostRuns;
    assert.strictEqual(ended.kind, 'ended', 'the run is ended');
    let after = await getAutomationRun(dbAdapter, run.id);
    assert.strictEqual(after?.state, 'error');
    assert.strictEqual(after?.errorReason, JOB_LOST_REASON);
    assert.strictEqual(
      (await queuedRuns()).length,
      2,
      'no third job is enqueued',
    );
    log = await readRunLog(dbAdapter, run.id);
    assert.strictEqual(
      log?.lines[log.lines.length - 1].kind,
      'finish',
      "the run's log ends with its finish line",
    );
  });

  test('a running run whose job is gone is ended, and its trigger carries on', async function (assert) {
    await switchOn();
    await tick(NOON + 30);
    let [run] = await runs();
    await startAutomationRunAttempt(dbAdapter, run.id, 1);
    await loseJobs();
    await madeAt(NOON + 30);

    let [outcome] = (await reconcile(NOON + 10 * 60)).lostRuns;
    assert.strictEqual(outcome.kind, 'ended', 'the run is ended');
    let after = await getAutomationRun(dbAdapter, run.id);
    assert.strictEqual(after?.state, 'error');
    assert.strictEqual(after?.errorReason, JOB_LOST_REASON);
    assert.strictEqual(
      (await queuedRuns()).length,
      1,
      'no job is enqueued for it again',
    );

    await tick(at('2026-11-10T13:00:30Z'));
    assert.deepEqual(
      (await runs()).map(({ slot, state }) => ({ slot, state })),
      [
        { slot: NOON_SLOT, state: 'error' },
        { slot: '2026-11-10T13:00:00.000Z', state: 'pending' },
      ],
      "the trigger's next slot starts its own run",
    );
  });

  test('a running run whose commit landed and whose job is gone ends complete', async function (assert) {
    await switchOn();
    await tick(NOON + 30);
    let [run] = await runs();
    await startAutomationRunAttempt(dbAdapter, run.id, 1);
    await claimAutomationRunCommit(dbAdapter, run.id, 1);
    await recordAutomationRunCommitted(dbAdapter, run.id);
    await loseJobs();
    await madeAt(NOON + 30);

    let [outcome] = (await reconcile(NOON + 10 * 60)).lostRuns;
    assert.strictEqual(outcome.kind, 'ended');
    let after = await getAutomationRun(dbAdapter, run.id);
    assert.strictEqual(after?.state, 'complete', 'its writes landed');
    assert.strictEqual(after?.errorReason, null);
  });

  test('a run in progress is left alone', async function (assert) {
    await switchOn();
    await tick(NOON + 30);
    let [run] = await runs();
    await startAutomationRunAttempt(dbAdapter, run.id, 1);
    await madeAt(NOON + 30);

    let result = await reconcile(NOON + 50 * 60);
    assert.deepEqual(result.lostRuns, [], 'its job is live');
    assert.deepEqual(result.overdue, []);
    assert.strictEqual(
      (await getAutomationRun(dbAdapter, run.id))?.state,
      'running',
    );
    assert.strictEqual((await queuedRuns()).length, 1, 'no job is added');
    assert.strictEqual(await reconciledAt(run.id), null);
  });

  test('a run made within the grace is left alone even with no job yet', async function (assert) {
    await switchOn();
    let run = await createAutomationRun(dbAdapter, {
      automationId: AUTOMATION,
      realm: REALM,
      trigger: 'hourly',
      slot: NOON_SLOT,
      actsAs: OWNER,
    });
    await madeAt(NOON + 30);
    let result = await reconcile(NOON + 60);
    assert.deepEqual(result.lostRuns, []);
    assert.strictEqual(
      (await getAutomationRun(dbAdapter, run.id))?.state,
      'pending',
    );
  });

  test("a lost Run now is enqueued again with its click's input", async function (assert) {
    let run = await createAutomationRun(dbAdapter, {
      automationId: AUTOMATION,
      realm: REALM,
      trigger: 'manual',
      slot: 'click-1',
      actsAs: CLICKER,
    });
    await madeAt(NOON);
    let [outcome] = (await reconcile(NOON + 10 * 60)).lostRuns;
    assert.strictEqual(
      outcome.kind,
      'requeued',
      'a manual run needs no switched-on row',
    );
    let [job] = await queuedRuns();
    assert.strictEqual(
      job.dedupeKey,
      `automation:${AUTOMATION}:manual:click-1`,
    );
    assert.deepEqual(job.input, {
      runId: run.id,
      scheduledAt: (await getAutomationRun(dbAdapter, run.id))!.createdAt,
      dryRun: false,
      triggerKind: 'manual',
    });
  });

  test("a paused automation's lost run is ended, not enqueued again", async function (assert) {
    await switchOn();
    await tick(NOON + 30);
    let [run] = await runs();
    await loseJobs();
    await madeAt(NOON + 30);
    await query(dbAdapter, [
      `UPDATE automations SET state = 'paused', pause_reason = 'requested'`,
    ]);
    let [outcome] = (await reconcile(NOON + 10 * 60)).lostRuns;
    assert.strictEqual(outcome.kind, 'ended');
    assert.strictEqual(
      (await getAutomationRun(dbAdapter, run.id))?.errorReason,
      JOB_LOST_REASON,
    );
    assert.strictEqual((await queuedRuns()).length, 1, 'no job is added');
  });

  test('a lost run whose trigger is gone from the card is ended', async function (assert) {
    await switchOn();
    await tick(NOON + 30);
    let [run] = await runs();
    await loseJobs();
    await madeAt(NOON + 30);
    card = {
      ok: true,
      declaration: declaration({ triggers: [{ ...HOURLY, label: 'daily' }] }),
    };
    let [outcome] = (await reconcile(NOON + 10 * 60)).lostRuns;
    assert.strictEqual(outcome.kind, 'ended');
    assert.strictEqual(
      (await getAutomationRun(dbAdapter, run.id))?.state,
      'error',
    );
  });

  test("a lost run whose card can't be read is enqueued again with the longest time limit, for its admission to end", async function (assert) {
    await switchOn();
    await tick(NOON + 30);
    let [run] = await runs();
    await loseJobs();
    await madeAt(NOON + 30);
    card = { ok: false, message: 'the card failed to index' };
    let [outcome] = (await reconcile(NOON + 10 * 60)).lostRuns;
    assert.strictEqual(outcome.kind, 'requeued');
    let [, job] = await queuedRuns();
    assert.strictEqual(
      job.timeout,
      automationJobTimeoutSec(MAX_RUN_SECONDS),
      'the job gets the longest a run may take',
    );
    assert.ok(await reconciledAt(run.id));
  });

  test('a registered step runs on every pass, and its count is reported', async function (assert) {
    let calls: number[] = [];
    let unregister = registerAutomationReconcileStep(
      'test-step',
      async ({ now }) => {
        calls.push(now);
        return 2;
      },
    );
    try {
      let result = await reconcile(NOON);
      assert.deepEqual(calls, [NOON], 'the step ran with the pass time');
      assert.deepEqual(result.steps, { 'test-step': 2 });
    } finally {
      unregister();
    }
    assert.deepEqual(
      (await reconcile(NOON)).steps,
      {},
      'an unregistered step no longer runs',
    );
  });

  test('a pass reports progress for each run, automation and step it handles', async function (assert) {
    await switchOn();
    // One lost run, and an automation the tick missed by hours.
    await createAutomationRun(dbAdapter, {
      automationId: AUTOMATION,
      realm: REALM,
      trigger: 'manual',
      slot: 'click-1',
      actsAs: OWNER,
    });
    await madeAt(NOON);
    let progress = 0;
    await reconcileAutomations(dbAdapter, {
      queue: publisher,
      virtualNetwork,
      readDeclaration: async () => card,
      log: silentLog,
      now: at('2026-11-10T15:30:00Z'),
      onProgress: () => progress++,
    });
    assert.strictEqual(progress, 2, 'one lost run and one overdue automation');
  });
});
