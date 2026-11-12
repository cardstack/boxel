import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { PgAdapter } from '@cardstack/postgres';
import {
  addToCreditsLedger,
  getLedgerEntries,
  getLedgerUsage,
} from '@cardstack/billing/billing-queries';
import {
  logger,
  ri,
  rri,
  type DBAdapter,
  type Realm,
} from '@cardstack/runtime-common';
import {
  createAutomationRun,
  type AutomationRun,
} from '@cardstack/runtime-common/automation-runs';
import {
  chargeRunIndexing,
  runIndexingFor,
} from '@cardstack/runtime-common/run-indexing';

import {
  exactMeteredCredits,
  meteredChargesFor,
} from '../lib/metered-charge.ts';
import {
  insertUser,
  setupPermissionedRealmCached,
  testPricing,
} from './helpers/index.ts';
import { settlePrerenderHtmlJobs } from './helpers/indexing.ts';

const testRealm = new URL('http://127.0.0.1:4444/test/');
const PAYER = '@payer:localhost';

function personModule(revision: number) {
  return `
    import { contains, field, CardDef, Component } from "@cardstack/base/card-api";
    import StringField from "@cardstack/base/string";

    export class Person extends CardDef {
      @field firstName = contains(StringField);
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <h1><@fields.firstName /> (rev ${revision})</h1>
        </template>
      }
    }
  `;
}

function person(firstName: string) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: { firstName },
      meta: { adoptsFrom: { module: rri('./person'), name: 'Person' } },
    },
  });
}

interface RunJobRow {
  job_type: string;
  status: string;
  run_indexing: {
    runId: string;
    workerProcessSeconds: number;
    prerenderTabSeconds: number;
  } | null;
}

// The indexing an automation run's commit causes is charged to the run's
// identity, once, when the last job the commit causes has finished.
module(basename(import.meta.filename), function (hooks) {
  let realm: Realm;
  let dbAdapter: DBAdapter;
  let payerId: string;
  let run: AutomationRun;

  setupPermissionedRealmCached(hooks, {
    mode: 'beforeEach',
    realmURL: testRealm,
    permissions: {
      '*': ['read', 'write'],
      '@node-test_realm:localhost': ['read', 'write', 'realm-owner'],
    },
    fileSystem: {
      'person.gts': personModule(0),
      'ada.json': person('Ada'),
    },
    onRealmSetup(args) {
      realm = args.testRealm;
      dbAdapter = args.dbAdapter;
    },
  });

  hooks.beforeEach(async function () {
    let user = await insertUser(
      dbAdapter as PgAdapter,
      PAYER,
      'cus_run_indexing',
      null,
    );
    payerId = user.id;
    await addToCreditsLedger(dbAdapter, {
      userId: payerId,
      creditAmount: 100_000,
      creditType: 'extra_credit',
      subscriptionCycleId: null,
    });
    run = await createAutomationRun(dbAdapter, {
      automationId: rri(`${testRealm.href}Automation/sync`),
      realm: ri(testRealm.href),
      trigger: 'nightly',
      slot: '2026-11-12T05:30:00.000Z',
      actsAs: PAYER,
    });
  });

  // Every job that carried the run's indexing, oldest first.
  async function runJobs(runId: string): Promise<RunJobRow[]> {
    return (await dbAdapter.execute(
      `SELECT job_type, status, args->'runIndexing' AS run_indexing
         FROM jobs
        WHERE args->'runIndexing'->>'runId' = $1
        ORDER BY id`,
      { bind: [runId] },
    )) as unknown as RunJobRow[];
  }

  async function runIndexingCharges(runId: string) {
    return await getLedgerEntries(dbAdapter, {
      runId,
      chargeKind: 'run_indexing',
    });
  }

  async function settled() {
    await realm.indexing();
    await settlePrerenderHtmlJobs(dbAdapter, realm.url);
  }

  test('a run’s commit is charged its index and render time once, by the render job that ends it', async function (assert) {
    await realm.writeMany(new Map([['ada.json', person('Ada Lovelace')]]), {
      runId: run.id,
    });
    await settled();

    let jobs = await runJobs(run.id);
    assert.deepEqual(
      jobs.map(({ job_type, status }) => [job_type, status]),
      [
        ['incremental-index', 'resolved'],
        ['prerender_html', 'resolved'],
      ],
      'the commit’s index pass and the render job it spawned both carry the run',
    );
    assert.true(
      jobs[1].run_indexing!.workerProcessSeconds > 0,
      'the render job carries the time the index pass measured',
    );

    let charges = await runIndexingCharges(run.id);
    assert.strictEqual(
      new Set(charges.map(({ chargeId }) => chargeId)).size,
      1,
      'the run’s indexing is one charge',
    );
    let [charge] = charges;
    assert.strictEqual(charge.userId, payerId, 'charged to the run’s identity');
    assert.strictEqual(charge.realm, ri(testRealm.href));
    assert.strictEqual(charge.pricingVersion, testPricing().version);

    let usage = Object.fromEntries(
      (await getLedgerUsage(dbAdapter, { runId: run.id })).map(
        ({ unit, quantity }) => [unit, quantity],
      ),
    );
    assert.true(
      usage.worker_process_seconds > jobs[1].run_indexing!.workerProcessSeconds,
      'worker time covers the index pass and the render job',
    );
    assert.true(usage.prerender_tab_seconds > 0, 'the renders took tab time');
    let credits = -charges.reduce((sum, e) => sum + e.creditAmount, 0);
    assert.strictEqual(
      credits,
      Math.ceil(
        exactMeteredCredits(
          {
            worker_process_seconds: usage.worker_process_seconds,
            prerender_tab_seconds: usage.prerender_tab_seconds,
          },
          testPricing(),
        ),
      ),
      'the credits are the usage at the test prices and margin, rounded up',
    );

    // A job that finishes again after the charge was written, as a retried
    // job does, charges nothing more.
    await chargeRunIndexing({
      dbAdapter,
      meteredCharges: meteredChargesFor(dbAdapter, testPricing),
      runIndexing: {
        ...runIndexingFor(run.id),
        workerProcessSeconds: 100,
      },
      log: logger('run-indexing-charge-test'),
    });
    assert.deepEqual(
      (await runIndexingCharges(run.id)).map(
        ({ creditAmount }) => creditAmount,
      ),
      charges.map(({ creditAmount }) => creditAmount),
      'the run’s indexing is still charged once',
    );
  });

  test('a commit that indexes in two passes is still one charge, covering both', async function (assert) {
    // A module and an instance in one batch: the module is indexed first, in
    // a pass of its own, so the instance can be serialized against it.
    await realm.writeMany(
      new Map([
        ['person.gts', personModule(1)],
        ['ada.json', person('Ada Lovelace')],
      ]),
      { runId: run.id },
    );
    await settled();

    let jobs = await runJobs(run.id);
    let passes = jobs.filter(
      ({ job_type }) => job_type === 'incremental-index',
    );
    assert.strictEqual(passes.length, 2, 'the commit ran two index passes');
    assert.strictEqual(
      passes[0].run_indexing!.workerProcessSeconds,
      0,
      'the first pass starts the run’s indexing',
    );
    assert.true(
      passes[1].run_indexing!.workerProcessSeconds > 0,
      'the second pass carries what the first measured',
    );

    let charges = await runIndexingCharges(run.id);
    assert.strictEqual(
      new Set(charges.map(({ chargeId }) => chargeId)).size,
      1,
      'the run’s indexing is one charge',
    );
    let usage = Object.fromEntries(
      (await getLedgerUsage(dbAdapter, { runId: run.id })).map(
        ({ unit, quantity }) => [unit, quantity],
      ),
    );
    assert.true(
      usage.worker_process_seconds >
        passes[1].run_indexing!.workerProcessSeconds,
      'the charge covers every job the commit caused',
    );
  });

  test('a run that wrote only what was stored causes no indexing and no charge', async function (assert) {
    await realm.writeMany(new Map([['ada.json', person('Ada')]]), {
      runId: run.id,
    });
    await settled();

    assert.deepEqual(await runJobs(run.id), [], 'no job carries the run');
    assert.deepEqual(
      await runIndexingCharges(run.id),
      [],
      'the run is not charged',
    );
  });

  test('a write that is not a run’s commit is not charged', async function (assert) {
    await realm.writeMany(new Map([['ada.json', person('Ada Lovelace')]]));
    await settled();

    let rows = (await dbAdapter.execute(
      `SELECT COUNT(*)::int AS n FROM credits_ledger WHERE charge_kind = 'run_indexing'`,
    )) as { n: number }[];
    assert.strictEqual(rows[0].n, 0, 'nothing is charged for its indexing');
  });
});
