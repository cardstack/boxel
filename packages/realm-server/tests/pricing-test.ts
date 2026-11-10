import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  PRICING_VARIABLES,
  checkPricingAtStartup,
  currentPricing,
  readPricing,
  type PricingCheck,
} from '../lib/pricing.ts';

function validEnv(): Record<string, string> {
  return {
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
  };
}

function problemsOf(check: PricingCheck) {
  if (check.ok) {
    throw new Error('expected the pricing check to fail');
  }
  return check.problems;
}

function pricingOf(check: PricingCheck) {
  if (!check.ok) {
    throw new Error(
      `expected the pricing check to pass: ${JSON.stringify(check.problems)}`,
    );
  }
  return check.pricing;
}

module(basename(import.meta.filename), function () {
  module('readPricing', function () {
    test('a valid set passes with every value, a version and the per-second rates', function (assert) {
      let pricing = pricingOf(readPricing(validEnv()));
      assert.deepEqual(pricing.values, {
        prerenderUsdPerVcpuHour: 0.04048,
        prerenderUsdPerMemoryGbHour: 0.004445,
        prerenderTaskVcpus: 4,
        prerenderTaskMemoryGb: 16,
        prerenderTaskTabs: 8,
        workerUsdPerVcpuHour: 0.03238,
        workerUsdPerMemoryGbHour: 0.00356,
        workerTaskVcpus: 2,
        workerTaskMemoryGb: 4,
        workerTaskProcesses: 2,
        usdPerDownloadedGb: 0.045,
        usdPerFileStorageGbMonth: 0.3,
        usdPerDatabaseStorageGbMonth: 0.115,
        margin: 2,
        minimumBalanceFloorCredits: 1000,
      });
      assert.ok(
        /^[0-9a-f]{16}$/.test(pricing.version),
        `version is a 16-character hex hash, got ${pricing.version}`,
      );
      // (4 × 0.04048 + 16 × 0.004445) / 8 tabs / 3600 s
      assert.strictEqual(
        pricing.prerenderTabUsdPerSecond,
        (4 * 0.04048 + 16 * 0.004445) / 8 / 3600,
      );
      // (2 × 0.03238 + 4 × 0.00356) / 2 processes / 3600 s
      assert.strictEqual(
        pricing.workerProcessUsdPerSecond,
        (2 * 0.03238 + 4 * 0.00356) / 2 / 3600,
      );
    });

    test('the version is the same for equal values however they are written', function (assert) {
      let a = pricingOf(readPricing(validEnv()));
      let b = pricingOf(
        readPricing({
          ...validEnv(),
          PRICING_USD_PER_FILE_STORAGE_GB_MONTH: '0.3',
          PRICING_MARGIN: '2.00',
        }),
      );
      assert.strictEqual(a.version, b.version);
    });

    test('the version changes when any value changes', function (assert) {
      let base = pricingOf(readPricing(validEnv())).version;
      let versions = new Set([base]);
      for (let variable of Object.values(PRICING_VARIABLES)) {
        let env = validEnv();
        env[variable] = String(Number(env[variable]) + 1);
        let version = pricingOf(readPricing(env)).version;
        assert.notStrictEqual(version, base, `${variable} changes the version`);
        versions.add(version);
      }
      assert.strictEqual(
        versions.size,
        Object.keys(PRICING_VARIABLES).length + 1,
        'each change gives a distinct version',
      );
    });

    test('a missing or empty value fails the check', function (assert) {
      let missing = validEnv();
      delete missing.PRICING_WORKER_TASK_VCPUS;
      assert.deepEqual(problemsOf(readPricing(missing)), [
        { variable: 'PRICING_WORKER_TASK_VCPUS', problem: 'is not set' },
      ]);

      assert.deepEqual(
        problemsOf(readPricing({ ...validEnv(), PRICING_MARGIN: '' })),
        [{ variable: 'PRICING_MARGIN', problem: 'is not set' }],
      );
    });

    test('with nothing set, every value is reported', function (assert) {
      let problems = problemsOf(readPricing({}));
      assert.deepEqual(
        problems.map(({ variable }) => variable),
        Object.values(PRICING_VARIABLES),
      );
      assert.ok(problems.every(({ problem }) => problem === 'is not set'));
    });

    test('a malformed decimal fails the check', function (assert) {
      for (let raw of [
        'abc',
        '-0.04',
        '+0.04',
        '1e3',
        '0x10',
        ' 0.04',
        '0.04 ',
        '1,000',
        '.5',
        '5.',
        'Infinity',
        'NaN',
      ]) {
        assert.deepEqual(
          problemsOf(
            readPricing({
              ...validEnv(),
              PRICING_PRERENDER_USD_PER_VCPU_HOUR: raw,
            }),
          ),
          [
            {
              variable: 'PRICING_PRERENDER_USD_PER_VCPU_HOUR',
              problem: `must be a plain decimal number, got ${JSON.stringify(raw)}`,
            },
          ],
          `${JSON.stringify(raw)} is refused`,
        );
      }
    });

    test('a rate or task size of zero fails the check', function (assert) {
      for (let variable of [
        'PRICING_PRERENDER_USD_PER_VCPU_HOUR',
        'PRICING_WORKER_TASK_MEMORY_GB',
        'PRICING_USD_PER_DOWNLOADED_GB',
        'PRICING_USD_PER_DATABASE_STORAGE_GB_MONTH',
      ]) {
        assert.deepEqual(
          problemsOf(readPricing({ ...validEnv(), [variable]: '0' })),
          [{ variable, problem: 'must be above 0, got 0' }],
          `${variable}=0 is refused`,
        );
      }
    });

    test('tabs, processes and the floor must be whole numbers', function (assert) {
      for (let variable of [
        'PRICING_PRERENDER_TASK_TABS',
        'PRICING_WORKER_TASK_PROCESSES',
        'PRICING_MINIMUM_BALANCE_FLOOR_CREDITS',
      ]) {
        assert.deepEqual(
          problemsOf(readPricing({ ...validEnv(), [variable]: '2.5' })),
          [{ variable, problem: 'must be a whole number, got "2.5"' }],
          `${variable}=2.5 is refused`,
        );
      }
      assert.deepEqual(
        problemsOf(
          readPricing({ ...validEnv(), PRICING_PRERENDER_TASK_TABS: '0' }),
        ),
        [
          {
            variable: 'PRICING_PRERENDER_TASK_TABS',
            problem: 'must be above 0, got 0',
          },
        ],
        'zero tabs is refused',
      );
      assert.deepEqual(
        problemsOf(
          readPricing({
            ...validEnv(),
            PRICING_MINIMUM_BALANCE_FLOOR_CREDITS: '99999999999999999999',
          }),
        ),
        [
          {
            variable: 'PRICING_MINIMUM_BALANCE_FLOOR_CREDITS',
            problem: 'is out of range, got "99999999999999999999"',
          },
        ],
        'a floor past the safe integer range is refused',
      );
    });

    test('a floor of zero passes', function (assert) {
      let pricing = pricingOf(
        readPricing({
          ...validEnv(),
          PRICING_MINIMUM_BALANCE_FLOOR_CREDITS: '0',
        }),
      );
      assert.strictEqual(pricing.values.minimumBalanceFloorCredits, 0);
    });

    test('a margin below 1 fails the check, and a margin of exactly 1 passes', function (assert) {
      for (let raw of ['0.99', '0.1', '0']) {
        assert.deepEqual(
          problemsOf(readPricing({ ...validEnv(), PRICING_MARGIN: raw })),
          [
            {
              variable: 'PRICING_MARGIN',
              problem: `must be at least 1, got ${raw}`,
            },
          ],
          `a margin of ${raw} is refused`,
        );
      }
      assert.strictEqual(
        pricingOf(readPricing({ ...validEnv(), PRICING_MARGIN: '1' })).values
          .margin,
        1,
      );
    });

    test('one bad value fails the whole set and every problem is reported', function (assert) {
      let check = readPricing({
        ...validEnv(),
        PRICING_MARGIN: '0.5',
        PRICING_USD_PER_DOWNLOADED_GB: 'free',
      });
      assert.false(check.ok, 'no prices are returned');
      assert.deepEqual(problemsOf(check), [
        {
          variable: 'PRICING_USD_PER_DOWNLOADED_GB',
          problem: 'must be a plain decimal number, got "free"',
        },
        { variable: 'PRICING_MARGIN', problem: 'must be at least 1, got 0.5' },
      ]);
    });
  });

  module('checkPricingAtStartup', function () {
    test('a passing check sets the current prices, and a failing check clears them', function (assert) {
      let passed = pricingOf(checkPricingAtStartup('test', validEnv()));
      assert.strictEqual(currentPricing()?.version, passed.version);

      checkPricingAtStartup('test', { ...validEnv(), PRICING_MARGIN: '0.9' });
      assert.strictEqual(
        currentPricing(),
        undefined,
        'a process whose check failed has no prices',
      );
    });
  });
});
