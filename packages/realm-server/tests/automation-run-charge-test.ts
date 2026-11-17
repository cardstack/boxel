import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { PgAdapter } from '@cardstack/postgres';
import {
  addToCreditsLedger,
  getLedgerEntries,
  getLedgerUsage,
} from '@cardstack/billing/billing-queries';
import { ri, rri, type DBAdapter } from '@cardstack/runtime-common';
import {
  addAutomationRunCounts,
  addAutomationRunTabTime,
  cancelAutomationRun,
  createAutomationRun,
  finishAutomationRun,
  getAutomationRun,
  startAutomationRunAttempt,
  type AutomationRun,
} from '@cardstack/runtime-common/automation-runs';
import {
  automationRunUsage,
  chargeAutomationRun,
} from '@cardstack/runtime-common/automation-run-charge';
import { BYTES_PER_GB } from '@cardstack/runtime-common/metered-charges';

import { meteredChargesFor } from '../lib/metered-charge.ts';
import { insertUser, setupDB, testPricing } from './helpers/index.ts';

const REALM = ri('http://127.0.0.1:4444/payroll/');
const AUTOMATION = rri('http://127.0.0.1:4444/payroll/Automation/nightly-sync');
const PAYER = '@run-charge-payer:localhost';
const STARTING_CREDITS = 100_000;

interface LogLine {
  level: 'info' | 'warn' | 'error';
  message: string;
}

// A run's own compute and network are charged to the run's identity once the
// run has ended, as one `run` charge referencing the run, priced from the tab
// time and downloaded bytes its row holds.
module(basename(import.meta.filename), function (hooks) {
  let dbAdapter: DBAdapter;
  let lines: LogLine[];
  let slots = 0;

  setupDB(hooks, {
    beforeEach: async (_dbAdapter) => {
      dbAdapter = _dbAdapter;
    },
  });

  hooks.beforeEach(async function () {
    lines = [];
    let user = await insertUser(
      dbAdapter as PgAdapter,
      PAYER,
      'cus_run_charge',
      null,
    );
    await addToCreditsLedger(dbAdapter, {
      userId: user.id,
      creditAmount: STARTING_CREDITS,
      creditType: 'extra_credit',
      subscriptionCycleId: null,
    });
  });

  let log = {
    info: (message: string) => lines.push({ level: 'info', message }),
    warn: (message: string) => lines.push({ level: 'warn', message }),
    error: (message: string) => lines.push({ level: 'error', message }),
  };

  async function newRun(actsAs = PAYER): Promise<AutomationRun> {
    return await createAutomationRun(dbAdapter, {
      automationId: AUTOMATION,
      realm: REALM,
      trigger: 'nightly',
      slot: `2026-11-1${slots++}T05:30:00.000Z`,
      actsAs,
    });
  }

  // A run whose script took `tabMs` of tab time and downloaded `bytes`, left
  // running by its attempt.
  async function runningRun({
    tabMs,
    bytes,
  }: {
    tabMs: number;
    bytes: number;
  }): Promise<AutomationRun> {
    let run = await newRun();
    let start = await startAutomationRunAttempt(dbAdapter, run.id, 1);
    if (start.kind !== 'run') {
      throw new Error(`expected the run to start, got ${start.kind}`);
    }
    await addAutomationRunTabTime(dbAdapter, run.id, tabMs);
    await addAutomationRunCounts(dbAdapter, run.id, {
      callApiResponseBytes: bytes,
    });
    return (await getAutomationRun(dbAdapter, run.id))!;
  }

  async function charge(runId: string, delays: number[] = [0]) {
    await chargeAutomationRun({
      dbAdapter,
      meteredCharges: meteredChargesFor(dbAdapter, testPricing),
      runId,
      log,
      attemptDelaysMs: delays,
    });
  }

  async function runCharges(runId: string) {
    return await getLedgerEntries(dbAdapter, { runId, chargeKind: 'run' });
  }

  function creditsOf(entries: { creditAmount: number }[]): number {
    return -entries.reduce((sum, e) => sum + e.creditAmount, 0);
  }

  test('a finished run is charged its tab time and downloaded bytes at the tab-second and per-GB rates times the margin', async function (assert) {
    // One hour of tab time and 2 GB downloaded. With the test prices a tab
    // costs (4 vCPU × $0.04048 + 16 GB × $0.004445) / 8 tabs per hour, so an
    // hour is $0.02913, and 2 GB at $0.045 is $0.09. ($0.02913 + $0.09) × 2
    // × 1,000 = 238.26 credits, rounded up to 239.
    let run = await runningRun({ tabMs: 3_600_000, bytes: 2 * BYTES_PER_GB });
    await finishAutomationRun(dbAdapter, run.id, 1, { state: 'complete' });

    await charge(run.id);

    let entries = await runCharges(run.id);
    assert.strictEqual(creditsOf(entries), 239, 'the run cost 239 credits');
    assert.true(entries.length > 0, 'the charge is in the ledger');
    for (let entry of entries) {
      assert.strictEqual(entry.chargeKind, 'run');
      assert.strictEqual(entry.realm, REALM, 'it names the run’s realm');
      assert.strictEqual(entry.runId, run.id, 'it references the run');
      assert.strictEqual(
        entry.pricingVersion,
        testPricing().version,
        'it records the pricing version that priced it',
      );
    }
    let usage = Object.fromEntries(
      (await getLedgerUsage(dbAdapter, { runId: run.id })).map(
        ({ unit, quantity }) => [unit, quantity],
      ),
    );
    assert.deepEqual(
      usage,
      { prerender_tab_seconds: 3600, downloaded_gb: 2 },
      'the charge records the usage it priced',
    );
  });

  test('a run is charged once, however many times its charge is written', async function (assert) {
    let run = await runningRun({ tabMs: 90_000, bytes: 5_000_000 });
    await finishAutomationRun(dbAdapter, run.id, 1, { state: 'complete' });

    await charge(run.id);
    let first = await runCharges(run.id);
    // More usage reaching the row afterwards changes nothing: the charge
    // that was first written stands.
    await addAutomationRunTabTime(dbAdapter, run.id, 60_000);
    await charge(run.id);
    await charge(run.id);

    let entries = await runCharges(run.id);
    assert.deepEqual(entries, first, 'only the first charge was written');
    assert.strictEqual(
      new Set(entries.map((e) => e.chargeId)).size,
      1,
      'its entries are one charge',
    );
    assert.ok(
      lines.some((l) => l.message.endsWith(': already-charged')),
      'a second write is answered as already charged',
    );
  });

  test('a run that ended as an error is charged for the time and bytes it used', async function (assert) {
    let run = await runningRun({ tabMs: 30_000, bytes: BYTES_PER_GB });
    await finishAutomationRun(dbAdapter, run.id, 1, {
      state: 'error',
      reason: 'script-error',
      message: 'upstream said no',
    });

    await charge(run.id);

    assert.strictEqual(
      creditsOf(await runCharges(run.id)),
      Math.ceil(
        (30 * testPricing().prerenderTabUsdPerSecond + 0.045) * 2 * 1000,
      ),
    );
  });

  test('a run canceled while its script ran is charged for the time and bytes it used', async function (assert) {
    let run = await runningRun({ tabMs: 45_000, bytes: 0 });
    await cancelAutomationRun(dbAdapter, run.id, '@someone:localhost');
    // The script's tab answers after the cancel, and its time reaches the row.
    await addAutomationRunTabTime(dbAdapter, run.id, 5_000);

    await charge(run.id);

    let usage = automationRunUsage(
      (await getAutomationRun(dbAdapter, run.id))!,
    );
    assert.deepEqual(usage, { prerender_tab_seconds: 50, downloaded_gb: 0 });
    assert.strictEqual(
      creditsOf(await runCharges(run.id)),
      Math.ceil(50 * testPricing().prerenderTabUsdPerSecond * 2 * 1000),
    );
  });

  test('a run still running is not charged', async function (assert) {
    let run = await runningRun({ tabMs: 45_000, bytes: 1_000 });

    await charge(run.id);

    assert.deepEqual(await runCharges(run.id), []);
  });

  test('a run canceled before it started used nothing, and is not charged', async function (assert) {
    let run = await newRun();
    await cancelAutomationRun(dbAdapter, run.id, '@someone:localhost');

    await charge(run.id);

    assert.deepEqual(await runCharges(run.id), []);
    assert.ok(
      lines.some((l) => l.message.includes('used nothing to charge for')),
    );
  });

  test('the run is charged to the identity it acted as', async function (assert) {
    let clicker = '@run-charge-clicker:localhost';
    let clickerUser = await insertUser(
      dbAdapter as PgAdapter,
      clicker,
      'cus_run_charge_clicker',
      null,
    );
    await addToCreditsLedger(dbAdapter, {
      userId: clickerUser.id,
      creditAmount: 1_000,
      creditType: 'extra_credit',
      subscriptionCycleId: null,
    });
    let run = await newRun(clicker);
    await startAutomationRunAttempt(dbAdapter, run.id, 1);
    await addAutomationRunTabTime(dbAdapter, run.id, 10_000);
    await finishAutomationRun(dbAdapter, run.id, 1, { state: 'complete' });

    await charge(run.id);

    let entries = await runCharges(run.id);
    assert.true(entries.length > 0);
    assert.true(
      entries.every((e) => e.userId === clickerUser.id),
      'the person it acted as paid',
    );
  });

  test('a charge with no prices or no payer writes nothing and says why', async function (assert) {
    let run = await newRun('@no-such-user:localhost');
    await startAutomationRunAttempt(dbAdapter, run.id, 1);
    await addAutomationRunTabTime(dbAdapter, run.id, 10_000);
    await finishAutomationRun(dbAdapter, run.id, 1, { state: 'complete' });

    await charge(run.id);
    await chargeAutomationRun({
      dbAdapter,
      meteredCharges: meteredChargesFor(dbAdapter, () => undefined),
      runId: run.id,
      log,
      attemptDelaysMs: [0],
    });

    assert.deepEqual(await runCharges(run.id), []);
    assert.deepEqual(
      lines
        .filter((l) => l.level === 'error')
        .map((l) => l.message.split(': ').pop()),
      ['no-payer', 'no-prices'],
    );
  });

  test('a charge that keeps failing is logged, never thrown', async function (assert) {
    let run = await runningRun({ tabMs: 10_000, bytes: 0 });
    await finishAutomationRun(dbAdapter, run.id, 1, { state: 'complete' });
    let tries = 0;

    await chargeAutomationRun({
      dbAdapter,
      meteredCharges: {
        exactCredits: () => undefined,
        async charge() {
          tries++;
          throw new Error('the database went away');
        },
      },
      runId: run.id,
      log,
      attemptDelaysMs: [0, 0, 0],
    });

    assert.strictEqual(tries, 3, 'it was tried once per attempt delay');
    assert.ok(
      lines.some(
        (l) =>
          l.level === 'error' && l.message === `failed to charge run ${run.id}`,
      ),
    );
  });
});
