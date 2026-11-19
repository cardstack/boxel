import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  chargeAutomationStorage,
  DAYS_PER_AVERAGE_MONTH,
  insertPermissions,
  previousUTCDay,
  recordAutomationFiles,
  ri,
  rri,
  VirtualNetwork,
  dbAdapterQuerier,
} from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
import {
  removeAutomation,
  switchOnAutomation,
  type AutomationActorOptions,
} from '@cardstack/runtime-common/automations';
import type { AutomationDeclaration } from '@cardstack/runtime-common/automation-declaration';
import { addToCreditsLedger } from '@cardstack/billing/billing-queries';
import { insertUser, setupDB } from './helpers/index.ts';
import { meteredChargesFor } from '../lib/metered-charge.ts';
import { BYTES_PER_GB, readPricing, type Pricing } from '../lib/pricing.ts';

const REALM_URL = 'http://127.0.0.1:4444/payroll/';
const REALM = ri(REALM_URL);
const AUTOMATION = rri(`${REALM_URL}Automation/nightly-sync`);
const PAYER = '@owner:localhost';
const RUN_ID = '0b9f1a52-6c43-4c0e-8f1d-3f6a9d6c1e01';

// Files at $0.30 per GB-month and index rows at $0.115, with a margin of 2.
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
    throw new Error('expected the test prices to pass their check');
  }
  return check.pricing;
}

function declaration(): AutomationDeclaration {
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
    caps: {
      callApiCalls: 20,
      responseBytes: 1_000_000,
      resolveCalls: 5,
      aiCredits: 100,
      writes: 50,
      seconds: 300,
      dailyCredits: 100,
      monthlyCredits: 2_000,
    },
    params: {},
    batchedAI: false,
    batchDeadlineMinutes: 60,
  };
}

module(basename(import.meta.filename), function (hooks) {
  let dbAdapter: PgAdapter;
  let userId: string;
  let pricing: Pricing;
  let options: AutomationActorOptions;

  setupDB(hooks, {
    beforeEach: async (_dbAdapter) => {
      dbAdapter = _dbAdapter;
      pricing = testPricing();
      options = {
        matrixServerName: 'localhost',
        virtualNetwork: new VirtualNetwork(),
      };
      await insertPermissions(dbAdapter, new URL(REALM_URL), {
        [PAYER]: ['read', 'write', 'realm-owner'],
      });
      let user = await insertUser(
        dbAdapter,
        PAYER,
        'cus_storage',
        'owner@test.com',
      );
      userId = user.id;
      await addToCreditsLedger(dbAdapter, {
        userId,
        creditAmount: 100_000,
        creditType: 'extra_credit',
        subscriptionCycleId: null,
      });
    },
  });

  async function switchOn(day: string) {
    let result = await switchOnAutomation(
      dbAdapter,
      {
        automationId: AUTOMATION,
        realm: REALM,
        user: PAYER,
        declaration: declaration(),
      },
      options,
    );
    if (!result.ok) {
      throw new Error(`expected switch-on, got ${result.reason}`);
    }
    await dbAdapter.execute(
      `UPDATE automations SET switched_on_at = $1::timestamptz WHERE automation_id = $2`,
      { bind: [`${day}T08:00:00Z`, AUTOMATION] },
    );
  }

  // A file of `bytes` the automation's run created.
  async function createdFile(path: string, bytes: number) {
    await dbAdapter.execute(
      `INSERT INTO realm_file_meta (realm_url, file_path, created_at, content_size) VALUES ($1, $2, 0, $3)`,
      { bind: [REALM_URL, path, bytes] },
    );
    await recordAutomationFiles(
      dbAdapterQuerier(dbAdapter),
      REALM_URL,
      { runId: RUN_ID, automationId: AUTOMATION },
      [path],
    );
  }

  async function charge(day: string) {
    let { charges, failed } = await chargeAutomationStorage(
      dbAdapter,
      meteredChargesFor(dbAdapter, () => pricing),
      day,
    );
    if (failed.length > 0) {
      throw failed[0].error;
    }
    return charges;
  }

  async function storageCharges() {
    return (await dbAdapter.execute(
      `SELECT to_char(charge_day, 'YYYY-MM-DD') AS day, -SUM(credit_amount)::int AS credits,
         MAX(realm) AS realm, MAX(pricing_version) AS pricing_version,
         MAX(charge_id::text) AS charge_id
       FROM credits_ledger WHERE charge_kind = 'storage' AND automation_id = $1
       GROUP BY charge_day ORDER BY charge_day`,
      { bind: [AUTOMATION] },
    )) as {
      day: string;
      credits: number;
      realm: string;
      pricing_version: string;
      charge_id: string;
    }[];
  }

  test("a day's charge prices the automation's files at the file storage rate", async function (assert) {
    await switchOn('2026-11-10');
    await createdFile('logs/sync.jsonl', BYTES_PER_GB);

    let [result] = await charge('2026-11-10');

    let gbMonths = 1 / DAYS_PER_AVERAGE_MONTH;
    // 1 GB for one day of a 1461/48-day month, at $0.30 per GB-month, × 2,
    // × 1,000 credits per dollar: 19.71 credits, rounded up.
    let expected = Math.ceil(gbMonths * 0.3 * 2 * 1000);
    assert.strictEqual(expected, 20);
    assert.strictEqual(result.outcome, 'charged');
    assert.strictEqual(result.firstDay, '2026-11-10');
    assert.strictEqual(result.lastDay, '2026-11-10');
    let [ledger] = await storageCharges();
    assert.deepEqual(
      {
        day: ledger.day,
        credits: ledger.credits,
        realm: ledger.realm,
        pricingVersion: ledger.pricing_version,
      },
      {
        day: '2026-11-10',
        credits: expected,
        realm: REALM,
        pricingVersion: pricing.version,
      },
    );
    let usage = await dbAdapter.execute(
      `SELECT unit, quantity::float AS quantity FROM credit_charge_usage WHERE charge_id = $1 ORDER BY unit`,
      { bind: [ledger.charge_id] },
    );
    assert.deepEqual(
      usage.map((row) => [row.unit, Number(row.quantity).toFixed(9)]),
      [
        ['database_storage_gb_months', (0).toFixed(9)],
        ['file_storage_gb_months', gbMonths.toFixed(9)],
      ],
    );
  });

  test('a file is charged only for the days it existed', async function (assert) {
    await switchOn('2026-11-01');
    for (let day of [
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
    ]) {
      let [result] = await charge(day);
      assert.strictEqual(
        result.outcome,
        'under-a-credit',
        `${day} costs nothing`,
      );
    }
    await createdFile('logs/sync.jsonl', BYTES_PER_GB);

    let [result] = await charge('2026-11-06');

    assert.strictEqual(result.outcome, 'charged');
    assert.strictEqual(result.firstDay, '2026-11-01');
    assert.strictEqual(result.lastDay, '2026-11-06');
    assert.strictEqual(
      result.fileStorageGbMonths,
      1 / DAYS_PER_AVERAGE_MONTH,
      'one GB for the one day it existed',
    );
    assert.deepEqual(
      (await storageCharges()).map(({ day, credits }) => [day, credits]),
      [['2026-11-06', 20]],
    );
  });

  test('each day is charged at the size measured for it', async function (assert) {
    await switchOn('2026-11-10');
    // 40 MB, then 80 MB: about 0.77 and then 1.54 credits.
    await createdFile('logs/sync.jsonl', 40 * 1024 * 1024);
    let [first] = await charge('2026-11-10');
    assert.strictEqual(first.outcome, 'under-a-credit');
    await dbAdapter.execute(
      `UPDATE realm_file_meta SET content_size = $1 WHERE realm_url = $2 AND file_path = $3`,
      { bind: [80 * 1024 * 1024, REALM_URL, 'logs/sync.jsonl'] },
    );

    let [second] = await charge('2026-11-11');

    assert.strictEqual(second.outcome, 'charged');
    assert.strictEqual(
      second.fileStorageGbMonths,
      (40 / 1024 + 80 / 1024) / DAYS_PER_AVERAGE_MONTH,
      'the first day at 40 MB and the second at 80 MB',
    );
  });

  test('an automation is charged once a day, however often the job runs', async function (assert) {
    await switchOn('2026-11-10');
    await createdFile('logs/sync.jsonl', BYTES_PER_GB);

    await charge('2026-11-10');
    let [again] = await charge('2026-11-10');
    assert.strictEqual(again.outcome, 'not-due');
    await charge('2026-11-11');

    assert.deepEqual(
      (await storageCharges()).map(({ day, credits }) => [day, credits]),
      [
        ['2026-11-10', 20],
        ['2026-11-11', 20],
      ],
    );
  });

  test('a day that costs less than a credit is charged with the days after it', async function (assert) {
    await switchOn('2026-11-10');
    // 40 MB: about 0.77 credits a day.
    await createdFile('logs/sync.jsonl', 40 * 1024 * 1024);

    let [first] = await charge('2026-11-10');
    assert.strictEqual(first.outcome, 'under-a-credit');
    assert.deepEqual(await storageCharges(), []);

    let [second] = await charge('2026-11-11');
    assert.strictEqual(second.outcome, 'charged');
    assert.strictEqual(second.firstDay, '2026-11-10');
    assert.strictEqual(second.lastDay, '2026-11-11');
    let gbMonths = ((40 / 1024) * 2) / DAYS_PER_AVERAGE_MONTH;
    assert.strictEqual(second.fileStorageGbMonths, gbMonths);
    assert.deepEqual(
      (await storageCharges()).map(({ day, credits }) => [day, credits]),
      [['2026-11-11', Math.ceil(gbMonths * 0.3 * 2 * 1000)]],
    );
  });

  test('a removed automation is no longer charged', async function (assert) {
    await switchOn('2026-11-10');
    await createdFile('logs/sync.jsonl', BYTES_PER_GB);
    await charge('2026-11-10');

    let removed = await removeAutomation(
      dbAdapter,
      { automationId: AUTOMATION, user: PAYER },
      options,
    );
    assert.true(removed.ok);
    assert.deepEqual(await charge('2026-11-11'), []);
    assert.deepEqual(
      (await storageCharges()).map(({ day }) => day),
      ['2026-11-10'],
    );
  });

  test('an automation switched on again starts a new span on that day', async function (assert) {
    await switchOn('2026-11-10');
    await createdFile('logs/sync.jsonl', BYTES_PER_GB);
    await charge('2026-11-10');
    await removeAutomation(
      dbAdapter,
      { automationId: AUTOMATION, user: PAYER },
      options,
    );

    await switchOn('2026-11-20');
    let [result] = await charge('2026-11-20');
    assert.strictEqual(
      result.firstDay,
      '2026-11-20',
      'the removed days are not charged',
    );
    assert.strictEqual(result.outcome, 'charged');
  });

  test('an automation switched on after the day ended is not charged for it', async function (assert) {
    await switchOn('2026-11-11');
    await createdFile('logs/sync.jsonl', BYTES_PER_GB);
    assert.deepEqual(await charge('2026-11-10'), []);
  });

  test('a file that no longer exists is not charged', async function (assert) {
    await switchOn('2026-11-10');
    await createdFile('logs/sync.jsonl', BYTES_PER_GB);
    await dbAdapter.execute(
      `DELETE FROM realm_file_meta WHERE realm_url = $1 AND file_path = $2`,
      { bind: [REALM_URL, 'logs/sync.jsonl'] },
    );
    let [result] = await charge('2026-11-10');
    assert.strictEqual(result.outcome, 'under-a-credit');
    assert.strictEqual(result.fileStorageGbMonths, 0);
  });

  test('a process with no prices charges nothing', async function (assert) {
    await switchOn('2026-11-10');
    await createdFile('logs/sync.jsonl', BYTES_PER_GB);
    let { charges } = await chargeAutomationStorage(
      dbAdapter,
      meteredChargesFor(dbAdapter, () => undefined),
      '2026-11-10',
    );
    assert.strictEqual(charges[0].outcome, 'no-prices');
    assert.deepEqual(await storageCharges(), []);
  });

  test('the job charges the UTC day that has just ended', function (assert) {
    assert.strictEqual(
      previousUTCDay(new Date('2026-11-12T00:15:00Z')),
      '2026-11-11',
    );
  });
});
