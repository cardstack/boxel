import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  automationInitiatedPriority,
  createAutomationRun,
  getAutomationRun,
  insertPermissions,
  query,
  ri,
  rri,
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
import type {
  AutomationCaps,
  AutomationDeclaration,
} from '@cardstack/runtime-common/automation-declaration';
import {
  tickAutomations,
  type AutomationDeclarationRead,
  type AutomationTickOutcome,
} from '@cardstack/runtime-common/automation-tick';
import { readRunLog } from '@cardstack/runtime-common/automation-run-log';
import {
  AUTOMATION_COMMAND,
  automationJobTimeoutSec,
} from '@cardstack/runtime-common/automation-run-command';
import { enqueueAutomationRunJob } from '@cardstack/runtime-common/jobs/run-command';
import { setupDB } from './helpers/index.ts';

const REALM_URL = 'http://127.0.0.1:4444/payroll/';
const REALM = ri(REALM_URL);
const AUTOMATION = rri(`${REALM_URL}Automation/hourly-sync`);
const OWNER = '@owner:localhost';

function at(iso: string): number {
  return Date.parse(iso) / 1000;
}

// Switched on a minute before the hour, so the hourly trigger's first slot is
// 12:00 UTC.
const SWITCHED_ON = at('2026-11-10T11:59:00Z');
const NOON = at('2026-11-10T12:00:00Z');
const NOON_SLOT = '2026-11-10T12:00:00.000Z';
const ONE = at('2026-11-10T13:00:00Z');

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
  concurrencyGroup: string;
  priority: number;
  timeout: number;
  runAs: string;
  realmURL: string;
  command: string;
  dedupeKey: string;
  input: { runId: string; scheduledAt: string; dryRun: boolean };
}

module(basename(import.meta.filename), function (hooks) {
  let dbAdapter: DBAdapter;
  let publisher: QueuePublisher;
  let virtualNetwork: VirtualNetwork;
  // The card as the index holds it, which the tick reads.
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

  async function switchOn(
    triggers: AutomationDeclaration['triggers'] = [HOURLY],
  ): Promise<AutomationRow> {
    card = { ok: true, declaration: declaration({ triggers }) };
    let result = await switchOnAutomation(
      dbAdapter,
      {
        automationId: AUTOMATION,
        realm: REALM,
        user: OWNER,
        declaration: card.declaration,
      },
      { matrixServerName: 'localhost', virtualNetwork, now: SWITCHED_ON },
    );
    if (!result.ok) {
      throw new Error(`expected switch-on, got ${result.reason}`);
    }
    return result.automation;
  }

  async function tick(now: number): Promise<AutomationTickOutcome[]> {
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
      `SELECT id, concurrency_group, priority, timeout, args FROM jobs WHERE job_type = 'run-command' ORDER BY id`,
    ]);
    return rows.map((r) => {
      let args = (
        typeof r.args === 'string' ? JSON.parse(r.args) : r.args
      ) as Record<string, any>;
      return {
        id: Number(r.id),
        concurrencyGroup: String(r.concurrency_group),
        priority: Number(r.priority),
        timeout: Number(r.timeout),
        runAs: args.runAs,
        realmURL: args.realmURL,
        command: args.command,
        dedupeKey: args.dedupeKey,
        input: args.commandInput,
      };
    });
  }

  function counts(automation: AutomationRow) {
    return Object.fromEntries(
      Object.entries(automation.triggerRuns).map(
        ([label, { runs, lastSlot }]) => [label, { runs, lastSlot }],
      ),
    );
  }

  test('nothing is enqueued before a trigger comes due', async function (assert) {
    await switchOn();
    assert.deepEqual(await tick(NOON - 1), [], 'no automation is due');
    assert.deepEqual(await runs(), []);
    assert.deepEqual(await queuedRuns(), []);
  });

  test("a due trigger's run is made and enqueued as its payer, in its concurrency group, at the automation tier, with a timeout from its seconds cap", async function (assert) {
    await switchOn();
    let outcomes = await tick(NOON + 30);

    let [run] = await runs();
    assert.ok(run, 'a run is made');
    assert.strictEqual(run.trigger, 'hourly');
    assert.strictEqual(
      run.slot,
      NOON_SLOT,
      'its slot is the scheduled instant',
    );
    assert.strictEqual(run.actsAs, OWNER, 'it acts as the payer');
    assert.strictEqual(run.state, 'pending');

    let [job] = await queuedRuns();
    assert.deepEqual(job, {
      id: job.id,
      concurrencyGroup: `automation:${AUTOMATION}`,
      priority: automationInitiatedPriority,
      timeout: automationJobTimeoutSec(CAPS.seconds),
      runAs: OWNER,
      realmURL: REALM_URL,
      command: AUTOMATION_COMMAND,
      dedupeKey: `automation:${AUTOMATION}:hourly:${NOON_SLOT}`,
      input: { runId: run.id, scheduledAt: NOON_SLOT, dryRun: false },
    });

    assert.deepEqual(outcomes, [
      {
        kind: 'enqueued',
        automationId: AUTOMATION,
        triggers: [
          {
            kind: 'started',
            trigger: 'hourly',
            slot: NOON_SLOT,
            runId: run.id,
            jobId: job.id,
          },
        ],
        state: 'active',
        nextRun: ONE,
      },
    ]);

    let automation = await row();
    assert.deepEqual(counts(automation), {
      hourly: { runs: 1, lastSlot: NOON },
    });
    assert.strictEqual(automation.nextRun, ONE, 'the next run moves on');
    assert.ok(automation.lastEnqueuedAt, 'the enqueue is recorded');

    let log = await readRunLog(dbAdapter, run.id);
    assert.deepEqual(
      log?.lines.map(({ kind, source, message }) => ({
        kind,
        source,
        message,
      })),
      [
        {
          kind: 'trigger',
          source: 'platform',
          message: `The hourly trigger started this run for ${NOON_SLOT}`,
        },
      ],
      "the run's log says which trigger started it",
    );
  });

  test('a due automation is enqueued once across two ticks', async function (assert) {
    await switchOn();
    await tick(NOON + 30);
    let second = await tick(NOON + 90);
    assert.deepEqual(second, [], 'the second tick finds nothing due');
    assert.strictEqual((await runs()).length, 1, 'one run');
    assert.strictEqual((await queuedRuns()).length, 1, 'one job');
    assert.deepEqual(counts(await row()), {
      hourly: { runs: 1, lastSlot: NOON },
    });
  });

  test('two ticks at once enqueue a due automation once', async function (assert) {
    await switchOn();
    let [a, b] = await Promise.all([tick(NOON + 30), tick(NOON + 30)]);
    assert.strictEqual(
      a.length + b.length,
      1,
      'one tick claims the automation; the other skips it or finds it handled',
    );
    assert.strictEqual((await runs()).length, 1, 'one run');
    assert.strictEqual((await queuedRuns()).length, 1, 'one job');
    assert.deepEqual(counts(await row()), {
      hourly: { runs: 1, lastSlot: NOON },
    });
  });

  test('two triggers due at once start two runs, one after the other in the automation’s concurrency group', async function (assert) {
    await switchOn([
      HOURLY,
      {
        kind: 'cron',
        label: 'noon',
        expression: '0 12 * * *',
        timeZone: 'UTC',
      },
    ]);
    let [outcome] = await tick(NOON + 30);
    assert.deepEqual(
      outcome.kind === 'enqueued'
        ? outcome.triggers.map(({ kind, trigger, slot }) => ({
            kind,
            trigger,
            slot,
          }))
        : outcome,
      [
        { kind: 'started', trigger: 'hourly', slot: NOON_SLOT },
        { kind: 'started', trigger: 'noon', slot: NOON_SLOT },
      ],
      'each trigger starts its own run',
    );
    let made = await runs();
    assert.deepEqual(
      made.map(({ trigger, slot }) => ({ trigger, slot })),
      [
        { trigger: 'hourly', slot: NOON_SLOT },
        { trigger: 'noon', slot: NOON_SLOT },
      ],
    );
    let jobs = await queuedRuns();
    assert.strictEqual(jobs.length, 2, 'two jobs');
    assert.deepEqual(
      jobs.map(({ concurrencyGroup }) => concurrencyGroup),
      [`automation:${AUTOMATION}`, `automation:${AUTOMATION}`],
      'both jobs are in the automation’s concurrency group, so the queue runs one after the other',
    );
    assert.notStrictEqual(
      jobs[0].dedupeKey,
      jobs[1].dedupeKey,
      'their keys differ by trigger',
    );
    assert.deepEqual(counts(await row()), {
      hourly: { runs: 1, lastSlot: NOON },
      noon: { runs: 1, lastSlot: NOON },
    });
  });

  test('a slot that comes due while a run is still pending joins it, and its trigger’s run count stays as it was', async function (assert) {
    await switchOn();
    await tick(NOON + 30);
    let [pending] = await runs();

    // The noon run is still waiting for a worker when 13:00 comes due.
    let [outcome] = await tick(ONE + 30);
    assert.deepEqual(outcome, {
      kind: 'enqueued',
      automationId: AUTOMATION,
      triggers: [
        {
          kind: 'skipped',
          trigger: 'hourly',
          slot: '2026-11-10T13:00:00.000Z',
          joinedRunId: pending.id,
        },
      ],
      state: 'active',
      nextRun: at('2026-11-10T14:00:00Z'),
    });
    assert.strictEqual((await runs()).length, 1, 'no run is made');
    assert.strictEqual((await queuedRuns()).length, 1, 'no job is enqueued');
    assert.deepEqual(
      counts(await row()),
      { hourly: { runs: 1, lastSlot: ONE } },
      'the skipped slot moves the cursor and is not counted',
    );
    let log = await readRunLog(dbAdapter, pending.id);
    assert.deepEqual(
      log?.lines.map(({ kind, message, data }) => ({ kind, message, data })),
      [
        {
          kind: 'trigger',
          message: `The hourly trigger started this run for ${NOON_SLOT}`,
          data: { trigger: 'hourly', slot: NOON_SLOT },
        },
        {
          kind: 'trigger',
          message:
            "The hourly trigger's 2026-11-10T13:00:00.000Z slot joined this run, which was still pending",
          data: {
            trigger: 'hourly',
            slot: '2026-11-10T13:00:00.000Z',
            skipped: true,
          },
        },
      ],
      "the pending run's log names the slot that joined it",
    );
  });

  test('a run that has started is not joined: the next slot starts its own run', async function (assert) {
    await switchOn();
    await tick(NOON + 30);
    let [first] = await runs();
    await query(dbAdapter, [
      `UPDATE automation_runs SET state = 'running', started_at = now() WHERE id = '${first.id}'`,
    ]);
    await tick(ONE + 30);
    assert.deepEqual(
      (await runs()).map(({ slot, state }) => ({ slot, state })),
      [
        { slot: NOON_SLOT, state: 'running' },
        { slot: '2026-11-10T13:00:00.000Z', state: 'pending' },
      ],
    );
    assert.deepEqual(counts(await row()), {
      hourly: { runs: 2, lastSlot: ONE },
    });
  });

  test('a tick that stopped after enqueueing and before advancing the row is finished by the next tick, with the same run and job', async function (assert) {
    await switchOn();
    // What a tick writes before it advances the row.
    let run = await createAutomationRun(dbAdapter, {
      automationId: AUTOMATION,
      realm: REALM,
      trigger: 'hourly',
      slot: NOON_SLOT,
      actsAs: OWNER,
    });
    let job = await enqueueAutomationRunJob(publisher, {
      automationId: AUTOMATION,
      realmURL: REALM_URL,
      actsAs: OWNER,
      trigger: 'hourly',
      slot: NOON_SLOT,
      secondsCap: CAPS.seconds,
      input: { runId: run.id, scheduledAt: NOON_SLOT, dryRun: false },
    });

    let [outcome] = await tick(NOON + 30);
    assert.deepEqual(
      outcome.kind === 'enqueued' ? outcome.triggers : outcome,
      [
        {
          kind: 'started',
          trigger: 'hourly',
          slot: NOON_SLOT,
          runId: run.id,
          jobId: job.id,
        },
      ],
      'the pending run for this very slot is the run the trigger starts, not one it joins',
    );
    assert.strictEqual((await runs()).length, 1, 'one run');
    assert.strictEqual((await queuedRuns()).length, 1, 'one job');
    assert.deepEqual(counts(await row()), {
      hourly: { runs: 1, lastSlot: NOON },
    });
  });

  test('`count` stops a trigger: its last run makes the automation done', async function (assert) {
    await switchOn([{ ...HOURLY, count: 2 }]);
    await tick(NOON + 30);
    await query(dbAdapter, [
      `UPDATE automation_runs SET state = 'complete', finished_at = now()`,
    ]);
    let [outcome] = await tick(ONE + 30);
    assert.strictEqual(outcome.kind, 'enqueued');
    let automation = await row();
    assert.deepEqual(counts(automation), {
      hourly: { runs: 2, lastSlot: ONE },
    });
    assert.strictEqual(automation.state, 'done', 'every trigger is spent');
    assert.strictEqual(automation.nextRun, null, 'no next run is left');
    assert.false(
      automation.triggerRuns.hourly.live,
      'the trigger is recorded as no longer live',
    );

    assert.deepEqual(
      await tick(at('2026-11-10T14:00:30Z')),
      [],
      'a done automation is not due',
    );
    assert.strictEqual((await runs()).length, 2, 'two runs in all');
  });

  test('`until` stops a trigger: no slot after it runs', async function (assert) {
    await switchOn([
      { ...HOURLY, until: at('2026-11-10T13:30:00Z') },
      { kind: 'webhook', label: 'push', webhookPath: 'hooks/push' },
    ]);
    await tick(NOON + 30);
    await query(dbAdapter, [
      `UPDATE automation_runs SET state = 'complete', finished_at = now()`,
    ]);
    await tick(ONE + 30);
    let automation = await row();
    assert.deepEqual(counts(automation), {
      hourly: { runs: 2, lastSlot: ONE },
      push: { runs: 0, lastSlot: undefined },
    });
    assert.strictEqual(
      automation.nextRun,
      null,
      'the 14:00 slot is past `until`',
    );
    assert.strictEqual(
      automation.state,
      'active',
      'a webhook trigger keeps the automation from being done',
    );
    assert.deepEqual(await tick(at('2026-11-10T14:00:30Z')), []);
    assert.strictEqual((await runs()).length, 2);
  });

  test('a one-time trigger runs once', async function (assert) {
    await switchOn([
      { kind: 'once', label: 'backfill', at: NOON, timeZone: 'UTC' },
    ]);
    await tick(NOON + 30);
    let automation = await row();
    assert.deepEqual(counts(automation), {
      backfill: { runs: 1, lastSlot: NOON },
    });
    assert.strictEqual(automation.state, 'done');
    assert.strictEqual((await runs()).length, 1);
  });

  test('after an outage, a trigger owes one make-up run at its latest missed slot', async function (assert) {
    await switchOn();
    let [outcome] = await tick(at('2026-11-10T15:20:00Z'));
    assert.deepEqual(
      outcome.kind === 'enqueued'
        ? outcome.triggers.map(({ kind, slot }) => ({ kind, slot }))
        : outcome,
      [{ kind: 'started', slot: '2026-11-10T15:00:00.000Z' }],
    );
    assert.deepEqual(counts(await row()), {
      hourly: { runs: 1, lastSlot: at('2026-11-10T15:00:00Z') },
    });
    assert.strictEqual((await row()).nextRun, at('2026-11-10T16:00:00Z'));
  });

  test("the tick keeps each trigger's timing record, so a later edit to the trigger is still noticed", async function (assert) {
    let before = await switchOn();
    await tick(NOON + 30);
    let after = await row();
    assert.strictEqual(
      after.triggerRuns.hourly.timing,
      before.triggerRuns.hourly.timing,
      'the timing switch-on recorded is kept',
    );
    assert.true(after.triggerRuns.hourly.live);
  });

  test('a card edit the index hook has not applied yet moves the edited trigger’s cursor, so a slot from before the edit does not run', async function (assert) {
    await switchOn();
    // The card now runs at half past instead; 12:30 came due before the
    // row followed the edit.
    card = {
      ok: true,
      declaration: declaration({
        triggers: [{ ...HOURLY, expression: '30 * * * *' }],
      }),
    };
    let [outcome] = await tick(at('2026-11-10T12:30:30Z'));
    assert.deepEqual(outcome, {
      kind: 'not-due',
      automationId: AUTOMATION,
      state: 'active',
      nextRun: at('2026-11-10T13:30:00Z'),
    });
    assert.deepEqual(await runs(), []);
    assert.strictEqual(
      (await row()).triggerRuns.hourly.since,
      at('2026-11-10T12:30:30Z'),
    );
  });

  test('a card that does not read as a declaration leaves the row due and unchanged', async function (assert) {
    let before = await switchOn();
    card = { ok: false, message: 'triggers.0.expression: not a cron' };
    let outcomes = await tick(NOON + 30);
    assert.deepEqual(outcomes, [
      {
        kind: 'unreadable',
        automationId: AUTOMATION,
        message: 'triggers.0.expression: not a cron',
      },
    ]);
    assert.deepEqual(await runs(), []);
    let after = await row();
    assert.strictEqual(after.nextRun, before.nextRun);
    assert.deepEqual(after.triggerRuns, before.triggerRuns);
  });

  test('a card that raises a cap above the snapshot enqueues nothing', async function (assert) {
    await switchOn();
    card = {
      ok: true,
      declaration: declaration({ caps: { ...CAPS, writes: 500 } }),
    };
    let outcomes = await tick(NOON + 30);
    assert.deepEqual(outcomes, [
      { kind: 'caps-raised', automationId: AUTOMATION, reason: 'caps-raised' },
    ]);
    assert.deepEqual(await runs(), []);
    assert.deepEqual(await queuedRuns(), []);
  });

  test('a paused automation is not due', async function (assert) {
    await switchOn();
    await query(dbAdapter, [
      `UPDATE automations SET state = 'paused', pause_reason = 'requested'`,
    ]);
    assert.deepEqual(await tick(NOON + 30), []);
    assert.deepEqual(await runs(), []);
  });

  test('an automation waiting for credits is still due, and keeps its state', async function (assert) {
    await switchOn();
    await query(dbAdapter, [
      `UPDATE automations SET state = 'waiting-for-credits'`,
    ]);
    let [outcome] = await tick(NOON + 30);
    assert.strictEqual(outcome.kind, 'enqueued');
    assert.strictEqual((await runs()).length, 1, 'its run is enqueued');
    assert.strictEqual((await row()).state, 'waiting-for-credits');
  });

  test('every due automation is handled, across pages', async function (assert) {
    let ids = [0, 1, 2].map((n) => rri(`${REALM_URL}Automation/sync-${n}`));
    for (let automationId of ids) {
      let result = await switchOnAutomation(
        dbAdapter,
        {
          automationId,
          realm: REALM,
          user: OWNER,
          declaration: declaration({ url: automationId }),
        },
        { matrixServerName: 'localhost', virtualNetwork, now: SWITCHED_ON },
      );
      assert.true(result.ok);
    }
    let outcomes = await tickAutomations(dbAdapter, {
      queue: publisher,
      virtualNetwork,
      readDeclaration: async (automationId) => ({
        ok: true,
        declaration: declaration({ url: automationId }),
      }),
      now: NOON + 30,
      pageSize: 2,
    });
    assert.deepEqual(
      outcomes.map(({ automationId }) => automationId).sort(),
      [...ids].sort(),
    );
    assert.strictEqual((await queuedRuns()).length, 3);
  });
});
