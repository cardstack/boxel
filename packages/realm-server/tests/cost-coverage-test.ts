import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { CREDITS_PER_USD, query, ri, param } from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
import {
  addToCreditsLedger,
  getCostCoverage,
  spendCredits,
  type CostCoverage,
} from '@cardstack/billing/billing-queries';
import { spendUsageCost } from '@cardstack/billing/ai-billing';
import { insertUser, setupDB } from './helpers/index.ts';
import {
  chargeMetered,
  meteredCredits,
  meteredUsd,
  recordPricing,
} from '../lib/metered-charge.ts';
import {
  PRICING_VARIABLES,
  readPricing,
  type Pricing,
} from '../lib/pricing.ts';

const REALM = ri('http://127.0.0.1:4444/payroll/');
const PAYER = '@owner:localhost';
const SHORT_PAYER = '@short:localhost';
const AUTOMATION = 'http://127.0.0.1:4444/payroll/Automation/nightly-sync';
const RUN_A = '0b9f1a52-6c43-4c0e-8f1d-3f6a9d6c1e01';
const RUN_B = '0b9f1a52-6c43-4c0e-8f1d-3f6a9d6c1e02';
const RUN_C = '0b9f1a52-6c43-4c0e-8f1d-3f6a9d6c1e03';
const RUN_D = '0b9f1a52-6c43-4c0e-8f1d-3f6a9d6c1e04';

// The report's period: all of 2026-11-16, UTC.
const FROM = new Date('2026-11-16T00:00:00Z');
const TO = new Date('2026-11-17T00:00:00Z');
const IN_PERIOD = Date.parse('2026-11-16T12:00:00Z') / 1000;
const BEFORE_PERIOD = Date.parse('2026-11-15T23:59:59Z') / 1000;
const AT_PERIOD_END = TO.getTime() / 1000;

function testPricing(margin = '2'): Pricing {
  let check = readPricing({
    PRICING_PRERENDER_USD_PER_VCPU_HOUR: '0.04048',
    PRICING_PRERENDER_USD_PER_MEMORY_GB_HOUR: '0.004445',
    PRICING_PRERENDER_TASK_VCPUS: '4',
    PRICING_PRERENDER_TASK_MEMORY_GB: '16',
    PRICING_PRERENDER_TASK_TABS: '8',
    PRICING_WORKER_USD_PER_VCPU_HOUR: '0.03238',
    PRICING_WORKER_USD_PER_MEMORY_GB_HOUR: '0.00356',
    PRICING_WORKER_TASK_VCPUS: '2',
    PRICING_WORKER_TASK_MEMORY_GB: '4',
    PRICING_WORKER_TASK_PROCESSES: '2',
    PRICING_USD_PER_DOWNLOADED_GB: '0.045',
    PRICING_USD_PER_FILE_STORAGE_GB_MONTH: '0.30',
    PRICING_USD_PER_DATABASE_STORAGE_GB_MONTH: '0.115',
    PRICING_MARGIN: margin,
    PRICING_MINIMUM_BALANCE_FLOOR_CREDITS: '1000',
  });
  if (!check.ok) {
    throw new Error('expected the test prices to pass their check');
  }
  return check.pricing;
}

function closeTo(
  assert: Assert,
  actual: number | null,
  expected: number,
  message: string,
) {
  assert.ok(
    actual !== null && Math.abs(actual - expected) < 1e-9,
    `${message}: expected ${expected}, got ${actual}`,
  );
}

module(basename(import.meta.filename), function (hooks) {
  let dbAdapter: PgAdapter;
  let payerId: string;
  let shortPayerId: string;
  let pricing: Pricing;

  setupDB(hooks, {
    beforeEach: async (_dbAdapter) => {
      dbAdapter = _dbAdapter;
      pricing = testPricing();
      payerId = (await insertUser(dbAdapter, PAYER, 'cus_owner', null)).id;
      shortPayerId = (
        await insertUser(dbAdapter, SHORT_PAYER, 'cus_short', null)
      ).id;
      await addToCreditsLedger(dbAdapter, {
        userId: payerId,
        creditAmount: 1_000_000,
        creditType: 'extra_credit',
        subscriptionCycleId: null,
      });
      await addToCreditsLedger(dbAdapter, {
        userId: shortPayerId,
        creditAmount: 5,
        creditType: 'extra_credit',
        subscriptionCycleId: null,
      });
    },
  });

  // Moves every ledger and usage row written since `since` to `createdAt`,
  // so a test can place charges inside or outside the report's period.
  async function dateChargesAfter(since: number, createdAt: number) {
    await query(dbAdapter, [
      `UPDATE credit_charge_usage SET created_at =`,
      param(createdAt),
      `WHERE created_at >=`,
      param(since),
    ]);
    await query(dbAdapter, [
      `UPDATE credits_ledger SET created_at =`,
      param(createdAt),
      `WHERE created_at >=`,
      param(since),
      `AND credit_amount < 0`,
    ]);
  }

  function lineFor(
    report: CostCoverage[],
    chargeKind: CostCoverage['chargeKind'],
    pricingVersion: string | null,
  ): CostCoverage {
    let line = report.find(
      (l) => l.chargeKind === chargeKind && l.pricingVersion === pricingVersion,
    );
    if (!line) {
      throw new Error(
        `no ${chargeKind} line at ${pricingVersion}: ${JSON.stringify(report)}`,
      );
    }
    return line;
  }

  test('records a pricing version once, with its values and unit rates', async function (assert) {
    await recordPricing(dbAdapter, pricing);
    await recordPricing(dbAdapter, pricing);

    let versions = await query(dbAdapter, [
      `SELECT version, margin FROM pricing_versions`,
    ]);
    assert.deepEqual(
      versions.map((v) => [v.version, Number(v.margin)]),
      [[pricing.version, 2]],
    );

    let values = await query(dbAdapter, [
      `SELECT variable, value FROM pricing_version_values WHERE pricing_version =`,
      param(pricing.version),
    ]);
    assert.deepEqual(
      Object.fromEntries(values.map((v) => [v.variable, Number(v.value)])),
      Object.fromEntries(
        (
          Object.keys(PRICING_VARIABLES) as (keyof typeof PRICING_VARIABLES)[]
        ).map((name) => [PRICING_VARIABLES[name], pricing.values[name]]),
      ),
      'every value is recorded under its variable',
    );

    let rates = await query(dbAdapter, [
      `SELECT unit, usd_per_unit FROM pricing_version_rates WHERE pricing_version =`,
      param(pricing.version),
    ]);
    let byUnit = Object.fromEntries(
      rates.map((r) => [r.unit, Number(r.usd_per_unit)]),
    );
    assert.deepEqual(Object.keys(byUnit).sort(), [
      'database_storage_gb_months',
      'downloaded_gb',
      'file_storage_gb_months',
      'prerender_tab_seconds',
      'worker_process_seconds',
    ]);
    closeTo(
      assert,
      byUnit.prerender_tab_seconds,
      pricing.prerenderTabUsdPerSecond,
      'a tab-second is the tab share of the prerender task',
    );
    closeTo(
      assert,
      byUnit.worker_process_seconds,
      pricing.workerProcessUsdPerSecond,
      'a worker-second is the process share of the worker task',
    );
    closeTo(assert, byUnit.downloaded_gb, 0.045, 'a GB downloaded');
  });

  test('compares each kind of charge with the cost of the usage it priced', async function (assert) {
    await recordPricing(dbAdapter, pricing);
    let since = Math.floor(Date.now() / 1000) - 1;

    let runUsage = { prerender_tab_seconds: 120, downloaded_gb: 2.5 };
    let indexingUsage = {
      worker_process_seconds: 300,
      prerender_tab_seconds: 45,
    };
    let storageUsage = {
      file_storage_gb_months: 3,
      database_storage_gb_months: 1.5,
    };
    for (let [charge, usage] of [
      [{ kind: 'run', realm: REALM, runId: RUN_A }, runUsage],
      [{ kind: 'run', realm: REALM, runId: RUN_B }, runUsage],
      [{ kind: 'run_indexing', realm: REALM, runId: RUN_A }, indexingUsage],
      [
        {
          kind: 'storage',
          realm: REALM,
          automationId: AUTOMATION,
          day: '2026-11-15',
        },
        storageUsage,
      ],
    ] as const) {
      assert.strictEqual(
        await chargeMetered(dbAdapter, {
          payer: PAYER,
          charge,
          usage,
          pricing,
        }),
        'charged',
      );
    }
    // An AI request a run made: billed at the provider's cost, no margin.
    await spendCredits(
      dbAdapter,
      payerId,
      12,
      { kind: 'ai', realm: REALM, runId: RUN_A },
      { ai_provider_usd: 0.012, ai_input_tokens: 900 },
    );
    // A batch: billed at the provider's cost, no margin.
    await spendCredits(
      dbAdapter,
      payerId,
      40,
      { kind: 'batched_ai', realm: REALM, runId: RUN_A, batchId: 'batch-1' },
      { ai_provider_usd: 0.04 },
    );
    await dateChargesAfter(since, IN_PERIOD);

    let report = await getCostCoverage(dbAdapter, { from: FROM, to: TO });
    assert.deepEqual(
      report.map((l) => [l.chargeKind, l.pricingVersion]),
      [
        ['ai', null],
        ['batched_ai', null],
        ['run', pricing.version],
        ['run_indexing', pricing.version],
        ['storage', pricing.version],
      ],
      'one line per kind and pricing version',
    );

    let run = lineFor(report, 'run', pricing.version);
    let runUsd = 120 * pricing.prerenderTabUsdPerSecond + 2.5 * 0.045;
    assert.strictEqual(run.charges, 2);
    assert.strictEqual(run.pricedCharges, 2);
    assert.strictEqual(run.credits, 2 * meteredCredits(runUsage, pricing));
    assert.strictEqual(run.pricedCredits, run.credits);
    closeTo(assert, run.costUsd, 2 * runUsd, 'run cost in USD');
    closeTo(
      assert,
      run.costCredits,
      2 * runUsd * CREDITS_PER_USD,
      'run cost in credits',
    );
    closeTo(
      assert,
      run.costAtMarginCredits,
      2 * runUsd * 2 * CREDITS_PER_USD,
      'run cost at its margin',
    );
    assert.strictEqual(
      run.fullCredits,
      run.credits,
      'a fully paid charge draws what it costs in full',
    );
    assert.strictEqual(run.shortfallCredits, 0, 'a paid kind falls short by 0');
    assert.strictEqual(run.shortChargedCharges, 0);
    closeTo(
      assert,
      run.coverage,
      run.credits / (2 * runUsd * CREDITS_PER_USD),
      'run coverage',
    );
    assert.ok(
      run.coverage! >= 2,
      `a fully paid metered kind covers at least its margin, got ${run.coverage}`,
    );
    // Each of the two charges rounds up by less than one credit.
    let roundingUp = run.fullCredits - run.costAtMarginCredits;
    assert.ok(
      roundingUp >= 0,
      `rounding each charge up never draws less than its cost, got ${roundingUp}`,
    );
    assert.ok(
      roundingUp < 2,
      `rounding each charge up draws less than a credit more, got ${roundingUp}`,
    );

    let indexing = lineFor(report, 'run_indexing', pricing.version);
    closeTo(
      assert,
      indexing.costUsd,
      300 * pricing.workerProcessUsdPerSecond +
        45 * pricing.prerenderTabUsdPerSecond,
      'indexing cost prices worker and tab time',
    );
    closeTo(
      assert,
      indexing.costUsd,
      meteredUsd(indexingUsage, pricing),
      'the report prices usage the way the charge did',
    );

    let storage = lineFor(report, 'storage', pricing.version);
    closeTo(
      assert,
      storage.costUsd,
      3 * 0.3 + 1.5 * 0.115,
      'storage cost prices files and index rows',
    );
    assert.strictEqual(storage.credits, meteredCredits(storageUsage, pricing));

    let ai = lineFor(report, 'ai', null);
    assert.strictEqual(ai.credits, 12);
    closeTo(assert, ai.costUsd, 0.012, 'AI cost is the provider cost');
    closeTo(assert, ai.coverage, 1, 'AI recovers its cost, no margin');
    assert.strictEqual(ai.fullCredits, 12, 'AI is charged at margin 1');
    assert.strictEqual(ai.shortfallCredits, 0);

    let batched = lineFor(report, 'batched_ai', null);
    closeTo(assert, batched.costUsd, 0.04, 'a batch costs what was reported');
    closeTo(assert, batched.coverage, 1, 'a batch recovers its cost');
  });

  test('shows the shortfall of a charge the balance could not cover', async function (assert) {
    await recordPricing(dbAdapter, pricing);
    let since = Math.floor(Date.now() / 1000) - 1;
    // A pass whose cost at the margin is far above the 5 credits the payer
    // holds, so the charge draws 5 and records all the usage it priced.
    let usage = { worker_process_seconds: 36_000 };
    assert.strictEqual(
      await chargeMetered(dbAdapter, {
        payer: SHORT_PAYER,
        charge: { kind: 'run_indexing', realm: REALM, runId: RUN_C },
        usage,
        pricing,
      }),
      'charged',
    );
    await dateChargesAfter(since, IN_PERIOD);

    let [line] = await getCostCoverage(dbAdapter, { from: FROM, to: TO });
    let usd = 36_000 * pricing.workerProcessUsdPerSecond;
    assert.strictEqual(line.chargeKind, 'run_indexing');
    assert.strictEqual(
      line.credits,
      5,
      'the charge drew what the balance held',
    );
    closeTo(assert, line.costUsd, usd, 'the cost is of all the usage');
    assert.strictEqual(
      line.fullCredits,
      meteredCredits(usage, pricing),
      'in full, the charge draws its cost at the margin, rounded up',
    );
    assert.strictEqual(
      line.shortfallCredits,
      meteredCredits(usage, pricing) - 5,
      'the shortfall is the unpaid part',
    );
    assert.strictEqual(line.shortChargedCharges, 1);
    assert.ok(
      line.coverage! < 1,
      `an under-paid kind covers less than its cost, got ${line.coverage}`,
    );
  });

  test('leaves unpriced the charges whose usage cannot be priced', async function (assert) {
    await recordPricing(dbAdapter, pricing);
    let since = Math.floor(Date.now() / 1000) - 1;
    // A charge at a pricing version no process recorded.
    await spendCredits(
      dbAdapter,
      payerId,
      30,
      {
        kind: 'run',
        realm: REALM,
        runId: RUN_D,
        pricingVersion: 'pv-unrecorded',
      },
      { prerender_tab_seconds: 60 },
    );
    // A recorded version's charge with no usage.
    await spendCredits(dbAdapter, payerId, 9, {
      kind: 'run',
      realm: REALM,
      runId: RUN_A,
      pricingVersion: pricing.version,
    });
    // An AI spend written with no charge kind and no usage, which reads as AI.
    await addToCreditsLedger(dbAdapter, {
      userId: payerId,
      creditAmount: -7,
      creditType: 'extra_credit_used',
      subscriptionCycleId: null,
    });
    await dateChargesAfter(since, IN_PERIOD);

    let report = await getCostCoverage(dbAdapter, { from: FROM, to: TO });

    let unrecorded = lineFor(report, 'run', 'pv-unrecorded');
    assert.strictEqual(unrecorded.charges, 1);
    assert.strictEqual(unrecorded.credits, 30);
    assert.strictEqual(unrecorded.pricedCharges, 0);
    assert.strictEqual(unrecorded.pricedCredits, 0);
    assert.strictEqual(unrecorded.costUsd, 0);
    assert.strictEqual(unrecorded.coverage, null);

    let noUsage = lineFor(report, 'run', pricing.version);
    assert.strictEqual(noUsage.charges, 1);
    assert.strictEqual(noUsage.pricedCharges, 0);
    assert.strictEqual(noUsage.coverage, null);

    let ai = lineFor(report, 'ai', null);
    assert.strictEqual(ai.charges, 1, 'a spend with no kind reads as AI');
    assert.strictEqual(ai.credits, 7);
    assert.strictEqual(ai.pricedCharges, 0);
  });

  test("prices an AI charge at its provider's cost, whatever pricing version it records", async function (assert) {
    await recordPricing(dbAdapter, pricing);
    let since = Math.floor(Date.now() / 1000) - 1;
    await spendUsageCost(dbAdapter, PAYER, 0.004, {
      kind: 'ai',
      pricingVersion: pricing.version,
    });
    // A version no process recorded: an AI charge needs none of its rates.
    await spendUsageCost(dbAdapter, PAYER, 0.003, {
      kind: 'ai',
      pricingVersion: 'pv-unrecorded',
    });
    // An AI charge that records no version.
    await spendUsageCost(dbAdapter, PAYER, 0.002);
    await dateChargesAfter(since, IN_PERIOD);

    let report = await getCostCoverage(dbAdapter, { from: FROM, to: TO });

    for (let [version, credits] of [
      [pricing.version, 4],
      ['pv-unrecorded', 3],
      [null, 2],
    ] as const) {
      let line = lineFor(report, 'ai', version);
      assert.strictEqual(line.charges, 1, `one AI charge at ${version}`);
      assert.strictEqual(line.credits, credits);
      assert.strictEqual(
        line.pricedCharges,
        1,
        `the charge at ${version} is priced`,
      );
      assert.ok(
        Math.abs(line.costUsd * CREDITS_PER_USD - credits) < 1e-9,
        `its cost is the provider's (${line.costUsd})`,
      );
      assert.ok(
        Math.abs(line.coverage! - 1) < 1e-9,
        `with no margin (${line.coverage})`,
      );
    }
  });

  test('counts one charge once across the credit buckets it drew on', async function (assert) {
    await recordPricing(dbAdapter, pricing);
    // The short payer holds 5 extra credits and is granted 3 daily credits,
    // so a 7-credit charge draws on both buckets.
    await addToCreditsLedger(dbAdapter, {
      userId: shortPayerId,
      creditAmount: 3,
      creditType: 'daily_credit',
      subscriptionCycleId: null,
    });
    let since = Math.floor(Date.now() / 1000) - 1;
    await spendCredits(
      dbAdapter,
      shortPayerId,
      7,
      {
        kind: 'run',
        realm: REALM,
        runId: RUN_A,
        pricingVersion: pricing.version,
      },
      { prerender_tab_seconds: 10 },
    );
    let rows = await query(dbAdapter, [
      `SELECT COUNT(*) AS n FROM credits_ledger WHERE run_id =`,
      param(RUN_A),
    ]);
    assert.ok(
      Number(rows[0].n) > 1,
      'the charge wrote one ledger row per bucket',
    );
    await dateChargesAfter(since, IN_PERIOD);

    let [line] = await getCostCoverage(dbAdapter, { from: FROM, to: TO });
    assert.strictEqual(line.charges, 1);
    assert.strictEqual(line.credits, 7);
    closeTo(
      assert,
      line.costUsd,
      10 * pricing.prerenderTabUsdPerSecond,
      'the usage is priced once',
    );
  });

  test('reports only the charges written in the period, by pricing version', async function (assert) {
    let raised = testPricing('3');
    await recordPricing(dbAdapter, pricing);
    await recordPricing(dbAdapter, raised);
    let usage = { prerender_tab_seconds: 600 };

    let since = Math.floor(Date.now() / 1000) - 1;
    await chargeMetered(dbAdapter, {
      payer: PAYER,
      charge: { kind: 'run', realm: REALM, runId: RUN_A },
      usage,
      pricing,
    });
    await dateChargesAfter(since, BEFORE_PERIOD);

    since = Math.floor(Date.now() / 1000) - 1;
    await chargeMetered(dbAdapter, {
      payer: PAYER,
      charge: { kind: 'run', realm: REALM, runId: RUN_B },
      usage,
      pricing,
    });
    await chargeMetered(dbAdapter, {
      payer: PAYER,
      charge: { kind: 'run', realm: REALM, runId: RUN_C },
      usage,
      pricing: raised,
    });
    await dateChargesAfter(since, IN_PERIOD);

    since = Math.floor(Date.now() / 1000) - 1;
    await chargeMetered(dbAdapter, {
      payer: PAYER,
      charge: { kind: 'run', realm: REALM, runId: RUN_D },
      usage,
      pricing,
    });
    await dateChargesAfter(since, AT_PERIOD_END);

    let report = await getCostCoverage(dbAdapter, { from: FROM, to: TO });
    assert.strictEqual(report.length, 2, 'one line per pricing version');
    let atTwo = lineFor(report, 'run', pricing.version);
    let atThree = lineFor(report, 'run', raised.version);
    assert.strictEqual(atTwo.charges, 1, 'only the in-period charge counts');
    assert.strictEqual(atThree.charges, 1);
    closeTo(
      assert,
      atTwo.costUsd,
      atThree.costUsd,
      'the same usage costs the same at either margin',
    );
    closeTo(
      assert,
      atThree.costAtMarginCredits,
      atThree.costCredits * 3,
      'each version is held to its own margin',
    );
    assert.strictEqual(atThree.credits, meteredCredits(usage, raised));
  });
  test('a charge that rounded up never offsets one the balance could not cover', async function (assert) {
    await recordPricing(dbAdapter, pricing);
    let since = Math.floor(Date.now() / 1000) - 1;
    // Ten small passes, each well under a credit, round up to 1 credit each.
    let small = { worker_process_seconds: 1 };
    assert.strictEqual(meteredCredits(small, pricing), 1);
    for (let i = 0; i < 10; i++) {
      await chargeMetered(dbAdapter, {
        payer: PAYER,
        charge: {
          kind: 'run_indexing',
          realm: REALM,
          runId: `0b9f1a52-6c43-4c0e-8f1d-3f6a9d6c1f0${i}`,
        },
        usage: small,
        pricing,
      });
    }
    // One large pass drawn against a balance of 5 credits.
    let large = { worker_process_seconds: 400 };
    await chargeMetered(dbAdapter, {
      payer: SHORT_PAYER,
      charge: { kind: 'run_indexing', realm: REALM, runId: RUN_C },
      usage: large,
      pricing,
    });
    await dateChargesAfter(since, IN_PERIOD);

    let [line] = await getCostCoverage(dbAdapter, { from: FROM, to: TO });
    let unpaid = meteredCredits(large, pricing) - 5;
    assert.ok(unpaid > 0, `the large pass went partly unpaid by ${unpaid}`);
    assert.ok(
      line.fullCredits - line.costAtMarginCredits > unpaid,
      'rounding the small passes up adds more than the large pass left unpaid',
    );
    assert.strictEqual(
      line.shortfallCredits,
      unpaid,
      'the shortfall is the unpaid charge alone',
    );
    assert.strictEqual(line.shortChargedCharges, 1);
  });

  test('prices each charge at the rates of its own pricing version', async function (assert) {
    // A second version whose prerender tab costs twice as much per vCPU-hour
    // and per GB-hour, so its tab-second rate is twice the first's.
    let check = readPricing({
      ...Object.fromEntries(
        (
          Object.keys(PRICING_VARIABLES) as (keyof typeof PRICING_VARIABLES)[]
        ).map((name) => [
          PRICING_VARIABLES[name],
          String(pricing.values[name]),
        ]),
      ),
      PRICING_PRERENDER_USD_PER_VCPU_HOUR: '0.08096',
      PRICING_PRERENDER_USD_PER_MEMORY_GB_HOUR: '0.00889',
    });
    if (!check.ok) {
      throw new Error('expected the second prices to pass their check');
    }
    let pricier = check.pricing;
    assert.notStrictEqual(pricier.version, pricing.version);
    await recordPricing(dbAdapter, pricing);
    await recordPricing(dbAdapter, pricier);

    let usage = { prerender_tab_seconds: 600 };
    let since = Math.floor(Date.now() / 1000) - 1;
    await chargeMetered(dbAdapter, {
      payer: PAYER,
      charge: { kind: 'run', realm: REALM, runId: RUN_A },
      usage,
      pricing,
    });
    await chargeMetered(dbAdapter, {
      payer: PAYER,
      charge: { kind: 'run', realm: REALM, runId: RUN_B },
      usage,
      pricing: pricier,
    });
    await dateChargesAfter(since, IN_PERIOD);

    let report = await getCostCoverage(dbAdapter, { from: FROM, to: TO });
    let cheap = lineFor(report, 'run', pricing.version);
    let dear = lineFor(report, 'run', pricier.version);
    closeTo(
      assert,
      cheap.costUsd,
      600 * pricing.prerenderTabUsdPerSecond,
      'the first charge is priced at the first rates',
    );
    closeTo(
      assert,
      dear.costUsd,
      600 * pricier.prerenderTabUsdPerSecond,
      'the second charge is priced at the second rates',
    );
    closeTo(
      assert,
      dear.costUsd,
      2 * cheap.costUsd,
      'twice the rate costs twice as much',
    );
    assert.strictEqual(dear.shortfallCredits, 0);
    assert.strictEqual(cheap.shortfallCredits, 0);
  });
});
