import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  REMAINING_RUNS_LIMIT,
  zonedDateTimeToUnixSeconds,
  type AutomationTrigger,
} from '@cardstack/runtime-common/automation-schedule';
import {
  cronRunsPerMonth,
  estimateAutomationCost,
  runCostCeiling,
  type RunCostCaps,
} from '../lib/automation-estimate.ts';
import { BYTES_PER_GB, readPricing, type Pricing } from '../lib/pricing.ts';

const CHICAGO = 'America/Chicago';
const NEW_YORK = 'America/New_York';

// A prerender tab costs (4 × 0.04048 + 16 × 0.004445) / 8 / 3600 USD a
// second, a downloaded GB 0.045 USD, at a margin of 2.
function testPricing(): Pricing {
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
    PRICING_MARGIN: '2',
    PRICING_MINIMUM_BALANCE_FLOOR_CREDITS: '1000',
  });
  if (!check.ok) {
    throw new Error(`test pricing failed: ${JSON.stringify(check.problems)}`);
  }
  return check.pricing;
}

const TAB_USD_PER_SECOND = (4 * 0.04048 + 16 * 0.004445) / 8 / 3600;

// 600 s of compute, 1 GB downloaded and 500 credits of AI.
const CAPS: RunCostCaps = {
  seconds: 600,
  responseBytes: BYTES_PER_GB,
  aiCredits: 500,
};
const COMPUTE_CREDITS = 600 * TAB_USD_PER_SECOND * 2 * 1000;
const NETWORK_CREDITS = 0.045 * 2 * 1000;
const PER_RUN_CREDITS = COMPUTE_CREDITS + NETWORK_CREDITS + 500;

// 2026-11-11 00:00 UTC. The average month after it, 30.4375 days, holds no
// daylight-saving change in the US zones.
const NOW = Date.parse('2026-11-11T00:00:00Z') / 1000;

function close(
  assert: Assert,
  actual: number,
  expected: number,
  message: string,
) {
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `${message}: expected ${expected}, got ${actual}`,
  );
}

function estimate(
  triggers: AutomationTrigger[],
  extra: Partial<Parameters<typeof estimateAutomationCost>[0]> = {},
) {
  return estimateAutomationCost({
    triggers,
    caps: CAPS,
    pricing: testPricing(),
    now: NOW,
    ...extra,
  });
}

module(basename(import.meta.filename), function () {
  module('runCostCeiling', function () {
    test('prices the time limit as tab time and the response bytes as downloads, with the margin, and adds the AI cap as is', function (assert) {
      let ceiling = runCostCeiling(CAPS, testPricing());
      close(assert, ceiling.computeCredits, COMPUTE_CREDITS, 'compute');
      close(assert, ceiling.networkCredits, NETWORK_CREDITS, 'network');
      assert.strictEqual(ceiling.aiCredits, 500, 'AI carries no margin');
      close(assert, ceiling.totalCredits, PER_RUN_CREDITS, 'total');
    });

    test('a zero cap adds nothing for its charge', function (assert) {
      let ceiling = runCostCeiling(
        { seconds: 60, responseBytes: 0, aiCredits: 0 },
        testPricing(),
      );
      assert.strictEqual(ceiling.networkCredits, 0);
      assert.strictEqual(ceiling.aiCredits, 0);
      close(
        assert,
        ceiling.totalCredits,
        60 * TAB_USD_PER_SECOND * 2 * 1000,
        'compute only',
      );
    });
  });

  module('cronRunsPerMonth', function () {
    // The coming average month from NOW ends 2026-12-11 10:30 UTC.
    test('a frequent expression counts its runs in the coming month', function (assert) {
      // 05:30 Chicago is 11:30 UTC: Nov 11 through Dec 10.
      assert.strictEqual(cronRunsPerMonth('30 5 * * *', CHICAGO, NOW), 30);
      assert.strictEqual(cronRunsPerMonth('0 * * * *', NEW_YORK, NOW), 730);
      assert.strictEqual(
        cronRunsPerMonth('*/5 * * * *', CHICAGO, NOW),
        30.4375 * 288,
      );
    });

    test('a rarer expression is averaged over four years', function (assert) {
      assert.strictEqual(cronRunsPerMonth('0 12 1 * *', CHICAGO, NOW), 1);
      assert.strictEqual(cronRunsPerMonth('@yearly', CHICAGO, NOW), 1 / 12);
      // Daily, but only in December: 10 runs in the coming month, under the
      // frequent threshold, so its four Decembers are averaged.
      assert.strictEqual(
        cronRunsPerMonth('0 9 * 12 *', CHICAGO, NOW),
        (31 * 4) / 48,
      );
    });

    test('February 29 gets its share from any starting point', function (assert) {
      let later = Date.parse('2027-03-02T00:00:00Z') / 1000;
      assert.strictEqual(cronRunsPerMonth('0 0 29 2 *', CHICAGO, NOW), 1 / 48);
      assert.strictEqual(
        cronRunsPerMonth('0 0 29 2 *', CHICAGO, later),
        1 / 48,
      );
    });

    test('28 runs in the coming month is frequent, 27 is averaged', function (assert) {
      // Noon in November and December only. Days 1–28: Nov 11–28 and
      // Dec 1–10 make 28 runs, counted as they are, not averaged to 8 × 28 / 48.
      assert.strictEqual(
        cronRunsPerMonth('0 12 1-28 11,12 *', CHICAGO, NOW),
        28,
      );
      // Days 1–27 make 27, so the four years' 8 × 27 runs are averaged.
      assert.strictEqual(
        cronRunsPerMonth('0 12 1-27 11,12 *', CHICAGO, NOW),
        (8 * 27) / 48,
      );
    });
  });

  module('estimateAutomationCost', function () {
    test('an unbounded cron trigger counts its runs in a month', function (assert) {
      let result = estimate([
        {
          kind: 'cron',
          label: 'daily',
          expression: '30 5 * * *',
          timeZone: CHICAGO,
        },
      ]);
      assert.strictEqual(result.unboundedRunsPerMonth, 30);
      assert.deepEqual(result.triggers, [
        { label: 'daily', kind: 'cron', runsPerMonth: 30 },
      ]);
      assert.strictEqual(result.credits, Math.ceil(PER_RUN_CREDITS * 30));
      assert.strictEqual(result.boundedRunsPerMonth, 0);
      assert.strictEqual(result.onceRuns, 0);
      assert.strictEqual(result.pricingVersion, testPricing().version);
    });

    test('names the charges it leaves out', function (assert) {
      assert.deepEqual(estimate([]).uncountedChargeKinds, [
        'run_indexing',
        'storage',
      ]);
    });

    test('unbounded triggers combine: two at the same instant each start a run', function (assert) {
      let result = estimate([
        {
          kind: 'cron',
          label: 'a',
          expression: '30 5 * * *',
          timeZone: CHICAGO,
        },
        {
          kind: 'cron',
          label: 'b',
          expression: '30 5 * * *',
          timeZone: CHICAGO,
        },
        {
          kind: 'cron',
          label: 'month-start',
          expression: '0 12 1 * *',
          timeZone: CHICAGO,
        },
      ]);
      assert.strictEqual(result.unboundedRunsPerMonth, 61);
    });

    test('a count smaller than a month of runs adds its runs left', function (assert) {
      let result = estimate([
        {
          kind: 'cron',
          label: 'next-day',
          expression: '0 * * * *',
          timeZone: CHICAGO,
          count: 24,
        },
      ]);
      assert.strictEqual(result.boundedRunsPerMonth, 24);
      assert.strictEqual(result.unboundedRunsPerMonth, 0);
      assert.deepEqual(result.triggers, [
        {
          label: 'next-day',
          kind: 'cron',
          runsPerMonth: 24,
          remainingRuns: 24,
          remainingRunsAtLeast: false,
        },
      ]);
      assert.strictEqual(result.credits, Math.ceil(PER_RUN_CREDITS * 24));
    });

    test('a count already partly used adds only the runs left', function (assert) {
      let result = estimate(
        [
          {
            kind: 'cron',
            label: 'next-day',
            expression: '0 * * * *',
            timeZone: CHICAGO,
            count: 24,
          },
        ],
        {
          since: NOW - 10 * 3600,
          runState: { 'next-day': { runs: 10, lastSlot: NOW - 3600 } },
        },
      );
      assert.strictEqual(result.boundedRunsPerMonth, 14);
    });

    test('a bound past the coming month counts a month of runs, not every run left', function (assert) {
      let result = estimate([
        {
          // Daily at 05:30 Chicago through 2027-01-09: 60 runs left.
          kind: 'cron',
          label: 'until-quarter',
          expression: '30 5 * * *',
          timeZone: CHICAGO,
          until: zonedDateTimeToUnixSeconds('2027-01-09T05:30', CHICAGO),
        },
        {
          kind: 'cron',
          label: 'hourly-for-a-year',
          expression: '0 * * * *',
          timeZone: NEW_YORK,
          until: NOW + 365 * 24 * 3600,
        },
        {
          kind: 'cron',
          label: 'twenty-new-years',
          expression: '@yearly',
          timeZone: CHICAGO,
          count: 20,
        },
      ]);
      assert.deepEqual(
        result.triggers.map((t) => [
          t.label,
          'runsPerMonth' in t && t.runsPerMonth,
          'remainingRuns' in t && t.remainingRuns,
        ]),
        [
          ['until-quarter', 30, 60],
          ['hourly-for-a-year', 730, 8760],
          ['twenty-new-years', 1 / 12, 20],
        ],
      );
      close(assert, result.boundedRunsPerMonth, 30 + 730 + 1 / 12, 'bounded');
      assert.strictEqual(result.unboundedRunsPerMonth, 0);
    });

    test('a spent bounded trigger adds nothing', function (assert) {
      let result = estimate([
        {
          kind: 'cron',
          label: 'over',
          expression: '0 9 * * *',
          timeZone: CHICAGO,
          until: NOW - 1,
        },
      ]);
      assert.strictEqual(result.boundedRunsPerMonth, 0);
      assert.strictEqual(result.credits, 0);
    });

    test('a trigger with runs left past the counting limit counts a month of runs', function (assert) {
      // Every 5 minutes for a year is over 100,000 runs.
      let result = estimate([
        {
          kind: 'cron',
          label: 'busy',
          expression: '*/5 * * * *',
          timeZone: CHICAGO,
          until: NOW + 365 * 24 * 3600,
        },
      ]);
      assert.deepEqual(result.triggers, [
        {
          label: 'busy',
          kind: 'cron',
          runsPerMonth: 30.4375 * 288,
          remainingRuns: REMAINING_RUNS_LIMIT,
          remainingRunsAtLeast: true,
        },
      ]);
    });

    test('an unspent once trigger adds one run, a spent one none', function (assert) {
      let result = estimate([
        { kind: 'once', label: 'backfill', at: NOW + 3600 },
        { kind: 'once', label: 'already', at: NOW - 3600 },
      ]);
      assert.strictEqual(result.onceRuns, 1);
      assert.deepEqual(result.triggers, [
        { label: 'backfill', kind: 'once', remainingRuns: 1 },
        { label: 'already', kind: 'once', remainingRuns: 0 },
      ]);
      assert.strictEqual(result.credits, Math.ceil(PER_RUN_CREDITS));
    });

    test('a webhook trigger is listed, not counted', function (assert) {
      let result = estimate([{ kind: 'webhook', label: 'stripe' }]);
      assert.deepEqual(result.webhookTriggers, ['stripe']);
      assert.deepEqual(result.triggers, [{ label: 'stripe', kind: 'webhook' }]);
      assert.strictEqual(result.credits, 0);
    });

    test('a trigger with an invalid expression or time zone reports its error and adds nothing', function (assert) {
      let result = estimate([
        {
          kind: 'cron',
          label: 'bad-expression',
          expression: '0 0 30 2 *',
          timeZone: CHICAGO,
        },
        {
          kind: 'cron',
          label: 'bad-zone',
          expression: '0 9 * * *',
          timeZone: 'Mars/Olympus_Mons',
        },
      ]);
      assert.deepEqual(
        result.triggers.map((t) => [t.label, 'error' in t]),
        [
          ['bad-expression', true],
          ['bad-zone', true],
        ],
      );
      assert.strictEqual(result.credits, 0);
    });

    test('a mix adds every kind of trigger a month brings', function (assert) {
      let result = estimate([
        {
          kind: 'cron',
          label: 'daily',
          expression: '30 5 * * *',
          timeZone: CHICAGO,
        },
        {
          kind: 'cron',
          label: 'month-start',
          expression: '0 12 1 * *',
          timeZone: CHICAGO,
        },
        { kind: 'webhook', label: 'stripe' },
        { kind: 'once', label: 'backfill', at: NOW + 3600 },
        {
          kind: 'cron',
          label: 'next-day',
          expression: '0 * * * *',
          timeZone: CHICAGO,
          count: 24,
        },
      ]);
      assert.strictEqual(result.unboundedRunsPerMonth, 31);
      assert.strictEqual(result.boundedRunsPerMonth, 24);
      assert.strictEqual(result.onceRuns, 1);
      assert.deepEqual(result.webhookTriggers, ['stripe']);
      assert.strictEqual(result.credits, Math.ceil(PER_RUN_CREDITS * 56));
      assert.deepEqual(
        result.triggers.map((t) => t.label),
        ['daily', 'month-start', 'stripe', 'backfill', 'next-day'],
        'one entry per trigger, in card order',
      );
    });

    test('recent Preview cost is reported beside the estimate, not added to it', function (assert) {
      let triggers: AutomationTrigger[] = [
        { kind: 'once', label: 'backfill', at: NOW + 3600 },
      ];
      let without = estimate(triggers);
      let withPreview = estimate(triggers, { recentPreviewCredits: 42 });
      assert.strictEqual(withPreview.recentPreviewCredits, 42);
      assert.strictEqual(withPreview.credits, without.credits);
      assert.false('recentPreviewCredits' in without);
    });

    test('no triggers estimates nothing', function (assert) {
      let result = estimate([]);
      assert.strictEqual(result.credits, 0);
      assert.deepEqual(result.triggers, []);
    });
  });
});
