import QUnit from 'qunit';
const { module, test } = QUnit;
import sinon from 'sinon';
import { basename } from 'path';
import {
  aiBatchCost,
  createAutomationRun,
  getAIBatch,
  getAutomationRun,
  insertPermissions,
  listUnsettledAIBatches,
  recordAIBatch,
  reserveAutomationRunAICredits,
  ri,
  rri,
  startAutomationRunAttempt,
  VirtualNetwork,
} from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
import { switchOnAutomation } from '@cardstack/runtime-common/automations';
import type { AutomationDeclaration } from '@cardstack/runtime-common/automation-declaration';
import {
  addToCreditsLedger,
  getCostCoverage,
  getUnbilledAIBatches,
} from '@cardstack/billing/billing-queries';
import { chargeAIBatch } from '@cardstack/billing/ai-billing';
import {
  insertProxyEndpoints,
  insertUser,
  setupDB,
  setupSecretsKeyring,
} from './helpers/index.ts';
import { AllowedProxyDestinations } from '../lib/allowed-proxy-destinations.ts';
import { settleAIBatches } from '../lib/ai-batch-settle.ts';

const REALM_URL = 'http://127.0.0.1:4444/payroll/';
const REALM = ri(REALM_URL);
const AUTOMATION = rri(`${REALM_URL}Automation/nightly-sync`);
const PAYER = '@payer:localhost';
const MODEL = 'anthropic/claude-test';
const SYSTEM_KEY = 'sk-or-v1-batches-5c0e2a9d71b3f846';

// What the batch's reservation holds on the run's AI cap, in credits, and
// what the batch is estimated at, in USD.
const RESERVED_CREDITS = 40;
const ESTIMATED_USD = 0.012;

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
    batchedAI: true,
    batchDeadlineMinutes: 60,
  };
}

// A batch as OpenRouter's GET answers it.
function openRouterBatch(
  id: string,
  {
    status,
    cost = null,
    createdAt = Math.floor(Date.now() / 1000) - 3600,
    finalizedAt = null,
  }: {
    status: string;
    cost?: number | null;
    createdAt?: number;
    finalizedAt?: number | null;
  },
) {
  return {
    id,
    object: 'batch',
    endpoint: '/v1/chat/completions',
    model: MODEL,
    completion_window: '24h',
    status,
    created_at: createdAt,
    finalized_at: finalizedAt,
    provider: 'anthropic',
    expires_at: createdAt + 86400,
    request_counts: {
      total: 2,
      completed: status === 'completed' ? 2 : 0,
      failed: 0,
    },
    usage: cost === null ? null : { cost, is_byok: false },
    results: status === 'completed' ? [] : null,
    error: null,
  };
}

module(basename(import.meta.filename), function (hooks) {
  let dbAdapter: PgAdapter;
  let userId: string;
  let fetchStub: sinon.SinonStub;
  // What the stubbed OpenRouter answers for each batch's GET, and the pages
  // of its batch list, in order.
  let batchAnswers: Map<string, { status: number; body: unknown }>;
  let listPages: {
    data: unknown[];
    last_id: string | null;
    has_more: boolean;
  }[];
  let sent: string[];

  setupSecretsKeyring(hooks);

  setupDB(hooks, {
    beforeEach: async (_dbAdapter) => {
      dbAdapter = _dbAdapter;
      await insertProxyEndpoints(dbAdapter, [
        {
          url: 'https://openrouter.ai/api/v1/batches',
          apiKey: SYSTEM_KEY,
          creditStrategy: 'no-credit',
          supportsStreaming: false,
        },
      ]);
      await insertPermissions(dbAdapter, new URL(REALM_URL), {
        [PAYER]: ['read', 'write', 'realm-owner'],
      });
      let user = await insertUser(
        dbAdapter,
        PAYER,
        'cus_payer',
        'payer@example.com',
      );
      userId = user.id;
      await addToCreditsLedger(dbAdapter, {
        userId,
        creditAmount: 100_000,
        creditType: 'extra_credit',
        subscriptionCycleId: null,
      });
      let switched = await switchOnAutomation(
        dbAdapter,
        {
          automationId: AUTOMATION,
          realm: REALM,
          user: PAYER,
          declaration: declaration(),
        },
        { matrixServerName: 'localhost', virtualNetwork: new VirtualNetwork() },
      );
      if (!switched.ok) {
        throw new Error(`expected switch-on, got ${switched.reason}`);
      }

      batchAnswers = new Map();
      listPages = [{ data: [], last_id: null, has_more: false }];
      sent = [];
      fetchStub = sinon
        .stub(global, 'fetch')
        .callsFake(async (input: string | URL | Request) => {
          let url = new URL(
            input instanceof Request ? input.url : input.toString(),
          );
          sent.push(url.href);
          let answer: { status: number; body: unknown };
          if (url.pathname === '/api/v1/batches') {
            let page = url.searchParams.get('after')
              ? listPages.find(
                  (_p, index) =>
                    listPages[index - 1]?.last_id ===
                    url.searchParams.get('after'),
                )
              : listPages[0];
            answer = {
              status: 200,
              body: { object: 'list', first_id: null, ...page },
            };
          } else {
            let id = decodeURIComponent(url.pathname.split('/').pop()!);
            answer = batchAnswers.get(id) ?? {
              status: 404,
              body: { error: { code: 404, message: 'Batch not found' } },
            };
          }
          return new Response(JSON.stringify(answer.body), {
            status: answer.status,
            headers: { 'content-type': 'application/json' },
          });
        });
    },
    afterEach: async () => {
      fetchStub.restore();
      AllowedProxyDestinations.reset();
    },
  });

  // A running run that submitted `batchId`, holding the batch's reservation
  // on its AI cap, as the batch path leaves it.
  async function submittedBatch(
    batchId = 'batch_123',
    slot = '2026-11-11T11:30:00.000Z',
  ) {
    let pending = await createAutomationRun(dbAdapter, {
      automationId: AUTOMATION,
      realm: REALM,
      trigger: 'daily',
      slot,
      actsAs: PAYER,
    });
    let started = await startAutomationRunAttempt(dbAdapter, pending.id, 1);
    if (started.kind !== 'run') {
      throw new Error(`expected the attempt to run, got ${started.kind}`);
    }
    let reservation = await reserveAutomationRunAICredits(
      dbAdapter,
      started.run.id,
      RESERVED_CREDITS,
      100,
    );
    if (reservation.kind !== 'reserved') {
      throw new Error(`expected a reservation, got ${reservation.kind}`);
    }
    await recordAIBatch(dbAdapter, {
      batchId,
      runId: started.run.id,
      actsAs: PAYER,
      realm: REALM,
      automationId: AUTOMATION,
      model: MODEL,
      requestCount: 2,
      estimatedUsd: ESTIMATED_USD,
      runAIReservation: reservation.reservationId,
      reservedCredits: RESERVED_CREDITS,
      deadline: new Date(Date.now() + 3600 * 1000),
      expiresAt: null,
      state: 'validating',
    });
    return started.run;
  }

  async function batchCharges(batchId = 'batch_123') {
    return (await dbAdapter.execute(
      `SELECT l.charge_id, l.realm, l.run_id, -SUM(l.credit_amount)::int AS credits,
         (SELECT json_object_agg(u.unit, u.quantity::float) FROM credit_charge_usage u
           WHERE u.charge_id = l.charge_id) AS usage
       FROM credits_ledger l
       WHERE l.charge_kind = 'batched_ai' AND l.batch_id = $1
       GROUP BY l.charge_id, l.realm, l.run_id`,
      { bind: [batchId] },
    )) as {
      charge_id: string;
      realm: string;
      run_id: string;
      credits: number;
      usage: Record<string, number>;
    }[];
  }

  function hour() {
    let now = Date.now();
    return { from: new Date(now - 3600_000), to: new Date(now + 3600_000) };
  }

  test('a completed batch is billed once, at the cost OpenRouter reported, to the person its run acted as', async function (assert) {
    let run = await submittedBatch();
    batchAnswers.set('batch_123', {
      status: 200,
      body: openRouterBatch('batch_123', {
        status: 'completed',
        cost: 0.0042,
        finalizedAt: Math.floor(Date.now() / 1000) - 60,
      }),
    });

    let result = await settleAIBatches(dbAdapter);

    assert.strictEqual(result.settled, 1, 'the batch is settled');
    assert.ok(
      sent.includes('https://openrouter.ai/api/v1/batches/batch_123'),
      'the batch is read from OpenRouter',
    );
    let charges = await batchCharges();
    assert.strictEqual(charges.length, 1, 'one charge names the batch');
    assert.strictEqual(charges[0].credits, 4, 'its cost, with no margin');
    assert.strictEqual(charges[0].run_id, run.id, 'it names the run');
    assert.strictEqual(charges[0].realm, REALM, 'and the realm');
    assert.deepEqual(
      charges[0].usage,
      { ai_provider_usd: 0.0042 },
      "it records OpenRouter's cost as its usage",
    );
    let [{ user_id }] = (await dbAdapter.execute(
      `SELECT DISTINCT user_id FROM credits_ledger WHERE batch_id = 'batch_123'`,
    )) as { user_id: string }[];
    assert.strictEqual(user_id, userId, 'billed to the run’s identity');

    let batch = (await getAIBatch(dbAdapter, 'batch_123'))!;
    assert.strictEqual(batch.state, 'completed');
    assert.ok(batch.settledAt, 'the batch is recorded as settled');
    assert.deepEqual(aiBatchCost(batch), {
      kind: 'settled',
      usd: 0.0042,
      estimated: false,
    });

    let settledRun = (await getAutomationRun(dbAdapter, run.id))!;
    assert.strictEqual(
      settledRun.aiCreditsReserved,
      0,
      'the batch’s reservation on the run’s AI cap is released',
    );
    assert.ok(
      Math.abs(settledRun.aiCreditsSpent - 4.2) < 1e-9,
      `the run's AI spending gains what the batch cost (${settledRun.aiCreditsSpent})`,
    );

    let again = await settleAIBatches(dbAdapter);
    assert.strictEqual(again.settled, 0, 'a settled batch isn’t read again');
    assert.strictEqual(
      (await batchCharges()).length,
      1,
      'and isn’t charged again',
    );
  });

  test('a batch still running stays unsettled, and its cost reads as pending', async function (assert) {
    let run = await submittedBatch();
    batchAnswers.set('batch_123', {
      status: 200,
      body: openRouterBatch('batch_123', { status: 'in_progress' }),
    });

    let result = await settleAIBatches(dbAdapter);

    assert.strictEqual(result.open, 1);
    assert.strictEqual(result.settled, 0);
    let batch = (await getAIBatch(dbAdapter, 'batch_123'))!;
    assert.strictEqual(batch.state, 'in_progress', 'its status is recorded');
    assert.strictEqual(batch.finalizedAt, null);
    assert.deepEqual(aiBatchCost(batch), { kind: 'pending' });
    assert.strictEqual((await batchCharges()).length, 0, 'nothing is charged');
    assert.strictEqual(
      (await getAutomationRun(dbAdapter, run.id))!.aiCreditsReserved,
      RESERVED_CREDITS,
      'the reservation still holds against the run’s AI cap',
    );
  });

  test('an expired batch with no reported cost is billed at its estimate, and the coverage report says so', async function (assert) {
    let run = await submittedBatch();
    batchAnswers.set('batch_123', {
      status: 200,
      body: openRouterBatch('batch_123', { status: 'expired' }),
    });

    let result = await settleAIBatches(dbAdapter);

    assert.strictEqual(result.settled, 1);
    let charges = await batchCharges();
    assert.strictEqual(charges.length, 1);
    assert.strictEqual(charges[0].credits, 12, 'the estimate, with no margin');
    assert.deepEqual(
      charges[0].usage,
      { ai_estimated_usd: ESTIMATED_USD },
      'it records the estimate, not a provider cost',
    );
    let batch = (await getAIBatch(dbAdapter, 'batch_123'))!;
    assert.deepEqual(aiBatchCost(batch), {
      kind: 'settled',
      usd: ESTIMATED_USD,
      estimated: true,
    });
    assert.ok(
      batch.finalizedAt,
      'when it reached its final status is recorded',
    );
    assert.ok(
      Math.abs(
        (await getAutomationRun(dbAdapter, run.id))!.aiCreditsSpent - 12,
      ) < 1e-9,
      'the run’s AI spending gains the estimate',
    );

    let [line] = (await getCostCoverage(dbAdapter, hour())).filter(
      (l) => l.chargeKind === 'batched_ai',
    );
    assert.strictEqual(line.charges, 1);
    assert.strictEqual(
      line.estimatedCharges,
      1,
      'the charge is flagged as estimated',
    );
    assert.strictEqual(line.estimatedCredits, 12);
    assert.strictEqual(line.pricedCharges, 1, 'priced at its estimate');
    assert.ok(Math.abs(line.costUsd - ESTIMATED_USD) < 1e-12);
  });

  test('a batch billed at its reported cost is not flagged as estimated', async function (assert) {
    await submittedBatch();
    batchAnswers.set('batch_123', {
      status: 200,
      body: openRouterBatch('batch_123', { status: 'completed', cost: 0.0042 }),
    });
    await settleAIBatches(dbAdapter);

    let [line] = (await getCostCoverage(dbAdapter, hour())).filter(
      (l) => l.chargeKind === 'batched_ai',
    );
    assert.strictEqual(line.charges, 1);
    assert.strictEqual(line.estimatedCharges, 0);
    assert.strictEqual(line.estimatedCredits, 0);
  });

  test('a retry after the charge was written doesn’t bill twice', async function (assert) {
    let run = await submittedBatch();
    // A pass charged the batch and stopped before settling the rest.
    await chargeAIBatch(dbAdapter, {
      payer: PAYER,
      charge: {
        kind: 'batched_ai',
        realm: REALM,
        runId: run.id,
        batchId: 'batch_123',
      },
      usd: 0.0042,
      estimated: false,
    });
    batchAnswers.set('batch_123', {
      status: 200,
      body: openRouterBatch('batch_123', { status: 'completed', cost: 0.0042 }),
    });

    let result = await settleAIBatches(dbAdapter);

    assert.strictEqual(result.settled, 1, 'the next pass finishes settling it');
    let charges = await batchCharges();
    assert.strictEqual(charges.length, 1, 'the batch is charged once');
    assert.strictEqual(charges[0].credits, 4);
    let settledRun = (await getAutomationRun(dbAdapter, run.id))!;
    assert.strictEqual(settledRun.aiCreditsReserved, 0);
    assert.ok(
      Math.abs(settledRun.aiCreditsSpent - 4.2) < 1e-9,
      'the run’s AI spending gains the cost once',
    );
    assert.ok((await getAIBatch(dbAdapter, 'batch_123'))!.settledAt);
  });

  test('a batch whose results OpenRouter has deleted is billed at its estimate', async function (assert) {
    await submittedBatch();
    batchAnswers.set('batch_123', {
      status: 410,
      body: { error: { code: 410, message: 'Batch results have expired' } },
    });

    let result = await settleAIBatches(dbAdapter);

    assert.strictEqual(result.settled, 1);
    let charges = await batchCharges();
    assert.strictEqual(charges.length, 1);
    assert.deepEqual(charges[0].usage, { ai_estimated_usd: ESTIMATED_USD });
  });

  test('a batch OpenRouter withholds for the platform’s balance waits for its cost', async function (assert) {
    await submittedBatch();
    batchAnswers.set('batch_123', {
      status: 402,
      body: {
        ...openRouterBatch('batch_123', { status: 'completed' }),
        results: null,
        error: { code: 402, message: 'Insufficient balance' },
      },
    });

    let result = await settleAIBatches(dbAdapter);

    assert.strictEqual(result.open, 1, 'it isn’t billed at its estimate yet');
    assert.strictEqual((await batchCharges()).length, 0);
    let batch = (await getAIBatch(dbAdapter, 'batch_123'))!;
    assert.strictEqual(batch.state, 'completed', 'its status is recorded');
    assert.deepEqual(aiBatchCost(batch), { kind: 'pending' });

    batchAnswers.set('batch_123', {
      status: 402,
      body: {
        ...openRouterBatch('batch_123', { status: 'completed', cost: 0.0042 }),
        results: null,
        error: { code: 402, message: 'Insufficient balance' },
      },
    });
    result = await settleAIBatches(dbAdapter);

    assert.strictEqual(result.settled, 1, 'a reported cost settles it');
    assert.strictEqual((await batchCharges())[0].credits, 4);
  });

  test('a batch OpenRouter doesn’t know stays unsettled', async function (assert) {
    let run = await submittedBatch();

    let result = await settleAIBatches(dbAdapter);

    assert.strictEqual(result.failed, 1);
    assert.strictEqual((await batchCharges()).length, 0);
    assert.deepEqual(aiBatchCost((await getAIBatch(dbAdapter, 'batch_123'))!), {
      kind: 'pending',
    });
    assert.strictEqual(
      (await getAutomationRun(dbAdapter, run.id))!.aiCreditsReserved,
      RESERVED_CREDITS,
    );
  });

  test('a batch whose run is gone is still billed', async function (assert) {
    let run = await submittedBatch();
    await dbAdapter.execute(`DELETE FROM automation_runs WHERE id = $1`, {
      bind: [run.id],
    });
    batchAnswers.set('batch_123', {
      status: 200,
      body: openRouterBatch('batch_123', { status: 'completed', cost: 0.0042 }),
    });

    let result = await settleAIBatches(dbAdapter);

    assert.strictEqual(result.settled, 1);
    let charges = await batchCharges();
    assert.strictEqual(charges.length, 1);
    assert.strictEqual(charges[0].run_id, run.id);
  });

  test('a batch its payer’s balance can’t cover is settled, and the coverage report lists it as unbilled', async function (assert) {
    await submittedBatch();
    await addToCreditsLedger(dbAdapter, {
      userId,
      creditAmount: -100_000,
      creditType: 'extra_credit_used',
      subscriptionCycleId: null,
    });
    batchAnswers.set('batch_123', {
      status: 200,
      body: openRouterBatch('batch_123', { status: 'completed', cost: 0.0042 }),
    });

    let result = await settleAIBatches(dbAdapter);

    assert.strictEqual(result.settled, 1);
    assert.strictEqual((await batchCharges()).length, 0, 'nothing was drawn');
    let unbilled = await getUnbilledAIBatches(dbAdapter, hour());
    assert.deepEqual(
      unbilled.map(({ batchId, actsAs, billedUsd, billedAtEstimate }) => ({
        batchId,
        actsAs,
        billedUsd,
        billedAtEstimate,
      })),
      [
        {
          batchId: 'batch_123',
          actsAs: PAYER,
          billedUsd: 0.0042,
          billedAtEstimate: false,
        },
      ],
    );
  });

  test('a batch charged in full is not listed as unbilled', async function (assert) {
    await submittedBatch();
    batchAnswers.set('batch_123', {
      status: 200,
      body: openRouterBatch('batch_123', { status: 'completed', cost: 0.0042 }),
    });
    await settleAIBatches(dbAdapter);

    assert.deepEqual(await getUnbilledAIBatches(dbAdapter, hour()), []);
  });

  test('a batch OpenRouter lists with no row is recorded and reported once', async function (assert) {
    await submittedBatch();
    batchAnswers.set('batch_123', {
      status: 200,
      body: openRouterBatch('batch_123', { status: 'in_progress' }),
    });
    let now = Math.floor(Date.now() / 1000);
    listPages = [
      {
        data: [
          openRouterBatch('batch_just_submitted', {
            status: 'validating',
            createdAt: now - 60,
          }),
          openRouterBatch('batch_123', { status: 'in_progress' }),
        ],
        last_id: 'batch_123',
        has_more: true,
      },
      {
        data: [
          openRouterBatch('batch_orphan', {
            status: 'completed',
            cost: 0.003,
            createdAt: now - 7200,
          }),
        ],
        last_id: 'batch_orphan',
        has_more: false,
      },
    ];

    let result = await settleAIBatches(dbAdapter);

    assert.strictEqual(result.unrecorded, 1, 'one batch has no row');
    let listCalls = sent.filter((url) =>
      url.startsWith('https://openrouter.ai/api/v1/batches?'),
    );
    assert.strictEqual(listCalls.length, 2, 'every page is read');
    assert.ok(
      new URL(listCalls[0]).searchParams.get('created_after'),
      'the list is bounded by when a batch was created',
    );
    assert.strictEqual(
      new URL(listCalls[1]).searchParams.get('after'),
      'batch_123',
      'the next page continues after the last batch',
    );
    let rows = (await dbAdapter.execute(
      `SELECT batch_id, model, status, request_count, cost_usd::float AS cost_usd
       FROM unrecorded_ai_batches ORDER BY batch_id`,
    )) as Record<string, unknown>[];
    assert.deepEqual(
      rows,
      [
        {
          batch_id: 'batch_orphan',
          model: MODEL,
          status: 'completed',
          request_count: 2,
          cost_usd: 0.003,
        },
      ],
      'only the batch past the grace period with no row is recorded',
    );

    let again = await settleAIBatches(dbAdapter);
    assert.strictEqual(again.unrecorded, 0, 'it isn’t reported a second time');
  });

  test('a batch OpenRouter can’t answer for takes its turn behind the batches not yet read', async function (assert) {
    await submittedBatch('batch_unknown', '2026-11-11T11:30:00.000Z');
    await submittedBatch('batch_newer', '2026-11-11T11:31:00.000Z');
    // Only the older batch has been read, and OpenRouter doesn't know it.
    await dbAdapter.execute(
      `UPDATE ai_batches SET submitted_at = now() - interval '1 hour' WHERE batch_id = 'batch_unknown'`,
    );
    let [first] = await listUnsettledAIBatches(dbAdapter, { limit: 1 });
    assert.strictEqual(
      first.batchId,
      'batch_unknown',
      'oldest first while unread',
    );
    batchAnswers.set('batch_newer', {
      status: 200,
      body: openRouterBatch('batch_newer', { status: 'in_progress' }),
    });
    await settleAIBatches(dbAdapter);

    batchAnswers.set('batch_newer', {
      status: 200,
      body: openRouterBatch('batch_newer', { status: 'in_progress' }),
    });
    await dbAdapter.execute(
      `UPDATE ai_batches SET settle_read_at = now() - interval '1 minute' WHERE batch_id = 'batch_newer'`,
    );
    await dbAdapter.execute(
      `UPDATE ai_batches SET settle_read_at = now() WHERE batch_id = 'batch_unknown'`,
    );
    [first] = await listUnsettledAIBatches(dbAdapter, { limit: 1 });
    assert.strictEqual(
      first.batchId,
      'batch_newer',
      'the batch read longest ago comes first, so a batch that never settles can’t hold back the rest',
    );
    assert.ok(
      (await getAIBatch(dbAdapter, 'batch_unknown'))!.settleReadAt,
      'every read is recorded, whatever OpenRouter answers',
    );
  });

  test('a pass reports progress after each batch and each page of the list', async function (assert) {
    await submittedBatch();
    batchAnswers.set('batch_123', {
      status: 200,
      body: openRouterBatch('batch_123', { status: 'in_progress' }),
    });
    let progress = 0;

    await settleAIBatches(dbAdapter, { onProgress: () => progress++ });

    assert.strictEqual(progress, 2, 'one batch and one page');
  });

  test('an unrecorded batch whose row lands later is resolved', async function (assert) {
    let now = Math.floor(Date.now() / 1000);
    listPages = [
      {
        data: [
          openRouterBatch('batch_slow', {
            status: 'in_progress',
            createdAt: now - 7200,
          }),
        ],
        last_id: 'batch_slow',
        has_more: false,
      },
    ];
    let first = await settleAIBatches(dbAdapter);
    assert.strictEqual(first.unrecorded, 1);

    // The submit's row lands after the grace period.
    await submittedBatch('batch_slow');
    batchAnswers.set('batch_slow', {
      status: 200,
      body: openRouterBatch('batch_slow', { status: 'in_progress' }),
    });
    let second = await settleAIBatches(dbAdapter);

    assert.strictEqual(second.unrecorded, 0);
    let [row] = (await dbAdapter.execute(
      `SELECT resolved_at, resolution FROM unrecorded_ai_batches WHERE batch_id = 'batch_slow'`,
    )) as { resolved_at: string | null; resolution: string | null }[];
    assert.ok(row.resolved_at, 'its unrecorded row is resolved');
    assert.strictEqual(row.resolution, 'recorded');
  });

  test('a lost batch an operator records is billed by the next pass, and its reservation settled', async function (assert) {
    let now = Math.floor(Date.now() / 1000);
    let createdAt = now - 7200;
    listPages = [
      {
        data: [
          openRouterBatch('batch_lost', { status: 'completed', createdAt }),
        ],
        last_id: 'batch_lost',
        has_more: false,
      },
    ];
    let pending = await createAutomationRun(dbAdapter, {
      automationId: AUTOMATION,
      realm: REALM,
      trigger: 'daily',
      slot: '2026-11-11T11:30:00.000Z',
      actsAs: PAYER,
    });
    let started = await startAutomationRunAttempt(dbAdapter, pending.id, 1);
    if (started.kind !== 'run') {
      throw new Error(`expected the attempt to run, got ${started.kind}`);
    }
    let reservation = await reserveAutomationRunAICredits(
      dbAdapter,
      started.run.id,
      RESERVED_CREDITS,
      100,
    );
    if (reservation.kind !== 'reserved') {
      throw new Error(`expected a reservation, got ${reservation.kind}`);
    }
    let first = await settleAIBatches(dbAdapter);
    assert.strictEqual(first.unrecorded, 1, 'the lost batch is reported');

    // The row the record lever writes from the submit's Sentry event.
    await recordAIBatch(dbAdapter, {
      batchId: 'batch_lost',
      runId: started.run.id,
      actsAs: PAYER,
      realm: REALM,
      automationId: AUTOMATION,
      model: MODEL,
      requestCount: 2,
      estimatedUsd: ESTIMATED_USD,
      runAIReservation: reservation.reservationId,
      reservedCredits: RESERVED_CREDITS,
      deadline: new Date((createdAt + 86400) * 1000),
      expiresAt: null,
      state: 'completed',
      submittedAt: new Date(createdAt * 1000),
    });
    batchAnswers.set('batch_lost', {
      status: 200,
      body: openRouterBatch('batch_lost', {
        status: 'completed',
        cost: 0.0042,
        createdAt,
      }),
    });
    let second = await settleAIBatches(dbAdapter);

    assert.strictEqual(second.settled, 1, 'the next pass bills it');
    let charges = await batchCharges('batch_lost');
    assert.strictEqual(charges.length, 1);
    assert.strictEqual(
      charges[0].credits,
      4,
      'at the cost OpenRouter reported',
    );
    let run = (await getAutomationRun(dbAdapter, started.run.id))!;
    assert.strictEqual(
      run.aiCreditsReserved,
      0,
      'the reservation the submit held is settled',
    );
    let [row] = (await dbAdapter.execute(
      `SELECT resolution FROM unrecorded_ai_batches WHERE batch_id = 'batch_lost'`,
    )) as { resolution: string | null }[];
    assert.strictEqual(row.resolution, 'recorded');
  });
});
