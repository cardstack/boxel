import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  createAutomationRun,
  getAIBatch,
  getAutomationRun,
  getUnrecordedAIBatch,
  insertPermissions,
  recordAIBatch,
  recordAIBatchSettled,
  recordUnrecordedAIBatches,
  reserveAutomationRunAICredits,
  ri,
  rri,
  startAutomationRunAttempt,
  VirtualNetwork,
  type AutomationRun,
} from '@cardstack/runtime-common';
import { switchOnAutomation } from '@cardstack/runtime-common/automations';
import type { AutomationDeclaration } from '@cardstack/runtime-common/automation-declaration';
import {
  addToCreditsLedger,
  getUnbilledAIBatches,
} from '@cardstack/billing/billing-queries';
import { grafanaSecret, insertUser } from '../helpers/index.ts';
import { setupServerEndpointsTest } from './helpers.ts';

const REALM_URL = 'http://127.0.0.1:4444/payroll/';
const REALM = ri(REALM_URL);
const AUTOMATION = rri(`${REALM_URL}Automation/nightly-sync`);
const PAYER = '@payer:localhost';
const MODEL = 'anthropic/claude-test';

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

module(`server-endpoints/${basename(import.meta.filename)}`, function () {
  module('operator levers for batches', function (hooks) {
    let context = setupServerEndpointsTest(hooks);
    let userId: string;

    hooks.beforeEach(async function () {
      await insertPermissions(context.dbAdapter, new URL(REALM_URL), {
        [PAYER]: ['read', 'write', 'realm-owner'],
      });
      let user = await insertUser(
        context.dbAdapter,
        PAYER,
        'cus_payer',
        'payer@example.com',
      );
      userId = user.id;
      let switched = await switchOnAutomation(
        context.dbAdapter,
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
    });

    // A running run holding an AI reservation on its cap, as a batch submit
    // leaves it.
    async function runWithReservation(): Promise<{
      run: AutomationRun;
      reservationId: string;
    }> {
      let pending = await createAutomationRun(context.dbAdapter, {
        automationId: AUTOMATION,
        realm: REALM,
        trigger: 'daily',
        slot: '2026-11-11T11:30:00.000Z',
        actsAs: PAYER,
      });
      let started = await startAutomationRunAttempt(
        context.dbAdapter,
        pending.id,
        1,
      );
      if (started.kind !== 'run') {
        throw new Error(`expected the attempt to run, got ${started.kind}`);
      }
      let reservation = await reserveAutomationRunAICredits(
        context.dbAdapter,
        started.run.id,
        40,
        100,
      );
      if (reservation.kind !== 'reserved') {
        throw new Error(`expected a reservation, got ${reservation.kind}`);
      }
      return { run: started.run, reservationId: reservation.reservationId };
    }

    // A batch the settle job billed at `usd` while its payer's balance held
    // nothing, so its charge wrote nothing.
    async function unbilledBatch(
      batchId = 'batch_unbilled',
      usd = 0.0042,
      actsAs = PAYER,
    ) {
      let { run, reservationId } = await runWithReservation();
      await recordAIBatch(context.dbAdapter, {
        batchId,
        runId: run.id,
        actsAs,
        realm: REALM,
        automationId: AUTOMATION,
        model: MODEL,
        requestCount: 2,
        estimatedUsd: 0.012,
        runAIReservation: reservationId,
        deadline: new Date(Date.now() + 3600 * 1000),
        expiresAt: null,
        state: 'completed',
      });
      await recordAIBatchSettled(context.dbAdapter, batchId, {
        usd,
        estimated: false,
      });
      return run;
    }

    async function batchCredits(batchId: string): Promise<number> {
      let [row] = (await context.dbAdapter.execute(
        `SELECT COALESCE(-SUM(credit_amount), 0)::int AS credits FROM credits_ledger
         WHERE charge_kind = 'batched_ai' AND batch_id = '${batchId}'`,
      )) as { credits: number }[];
      return row.credits;
    }

    async function topUp(credits: number) {
      await addToCreditsLedger(context.dbAdapter, {
        userId,
        creditAmount: credits,
        creditType: 'extra_credit',
        subscriptionCycleId: null,
      });
    }

    function post(path: string, params: Record<string, string>) {
      return context.request
        .post(`${path}?${new URLSearchParams(params).toString()}`)
        .set('Authorization', `Bearer ${grafanaSecret}`);
    }

    function unbilledNow() {
      return getUnbilledAIBatches(context.dbAdapter, {
        from: new Date(Date.now() - 3600 * 1000),
        to: new Date(Date.now() + 3600 * 1000),
      });
    }

    test('a batch whose payer couldn’t pay is billed once the payer can', async function (assert) {
      await unbilledBatch();

      let refused = await post('/_grafana-bill-ai-batch', {
        batch: 'batch_unbilled',
      });
      assert.strictEqual(refused.status, 409, 'an empty balance is refused');
      assert.strictEqual(await batchCredits('batch_unbilled'), 0);

      await topUp(1_000);
      let billed = await post('/_grafana-bill-ai-batch', {
        batch: 'batch_unbilled',
      });
      assert.strictEqual(billed.status, 200);
      assert.deepEqual(JSON.parse(billed.text), {
        batch: 'batch_unbilled',
        result: 'charged',
        payer: PAYER,
        usd: 0.0042,
      });
      assert.strictEqual(
        await batchCredits('batch_unbilled'),
        4,
        'billed what the settle job billed, at 1,000 credits to the dollar',
      );
      assert.deepEqual(await unbilledNow(), [], 'it leaves the unbilled list');

      let again = await post('/_grafana-bill-ai-batch', {
        batch: 'batch_unbilled',
      });
      assert.strictEqual(again.status, 200);
      assert.strictEqual(JSON.parse(again.text).result, 'already-charged');
      assert.strictEqual(
        await batchCredits('batch_unbilled'),
        4,
        'a second call bills nothing',
      );
    });

    test('a balance that covers only part of a batch is refused unless partial is asked for', async function (assert) {
      await unbilledBatch();
      await topUp(2);

      let refused = await post('/_grafana-bill-ai-batch', {
        batch: 'batch_unbilled',
      });
      assert.strictEqual(refused.status, 409);
      assert.ok(
        refused.text.includes('holds 2 of its 4 credits'),
        `the refusal says what the balance holds: ${refused.text}`,
      );
      assert.strictEqual(await batchCredits('batch_unbilled'), 0);

      let partial = await post('/_grafana-bill-ai-batch', {
        batch: 'batch_unbilled',
        partial: 'true',
      });
      assert.strictEqual(partial.status, 200);
      assert.strictEqual(
        await batchCredits('batch_unbilled'),
        2,
        'it draws what the balance holds',
      );
      assert.deepEqual(
        await unbilledNow(),
        [],
        'a batch with a charge leaves the unbilled list',
      );
    });

    test('a batch whose payer has no users row is refused', async function (assert) {
      await unbilledBatch('batch_ghost', 0.0042, '@ghost:localhost');

      let response = await post('/_grafana-bill-ai-batch', {
        batch: 'batch_ghost',
      });
      assert.strictEqual(response.status, 409);
      assert.ok(response.text.includes('has no users row'), response.text);
      assert.strictEqual(await batchCredits('batch_ghost'), 0);
    });

    test('a written-off batch isn’t billed', async function (assert) {
      await unbilledBatch();
      await post('/_grafana-write-off-ai-batch', {
        batch: 'batch_unbilled',
        reason: 'payer account closed',
      });
      await topUp(1_000);

      let response = await post('/_grafana-bill-ai-batch', {
        batch: 'batch_unbilled',
      });
      assert.strictEqual(response.status, 409);
      assert.strictEqual(await batchCredits('batch_unbilled'), 0);
    });

    test('a batch still unsettled is left to the settle job', async function (assert) {
      let { run, reservationId } = await runWithReservation();
      await recordAIBatch(context.dbAdapter, {
        batchId: 'batch_open',
        runId: run.id,
        actsAs: PAYER,
        realm: REALM,
        automationId: AUTOMATION,
        model: MODEL,
        requestCount: 2,
        estimatedUsd: 0.012,
        runAIReservation: reservationId,
        deadline: new Date(Date.now() + 3600 * 1000),
        expiresAt: null,
        state: 'in_progress',
      });
      await topUp(1_000);

      let response = await post('/_grafana-bill-ai-batch', {
        batch: 'batch_open',
      });
      assert.strictEqual(response.status, 409);
      assert.strictEqual(await batchCredits('batch_open'), 0);

      let missing = await post('/_grafana-bill-ai-batch', {
        batch: 'batch_none',
      });
      assert.strictEqual(missing.status, 404);
    });

    test('a batch written off stays unbilled, with its reason', async function (assert) {
      await unbilledBatch();

      let noReason = await post('/_grafana-write-off-ai-batch', {
        batch: 'batch_unbilled',
      });
      assert.strictEqual(noReason.status, 400, 'a write-off takes a reason');

      let response = await post('/_grafana-write-off-ai-batch', {
        batch: 'batch_unbilled',
        reason: 'payer account closed',
      });
      assert.strictEqual(response.status, 200);
      let batch = await getAIBatch(context.dbAdapter, 'batch_unbilled');
      assert.ok(batch?.writtenOffAt, 'the write-off is recorded');
      assert.strictEqual(batch?.writeOffReason, 'payer account closed');
      let [unbilled] = await unbilledNow();
      assert.strictEqual(unbilled.batchId, 'batch_unbilled');
      assert.strictEqual(unbilled.writeOffReason, 'payer account closed');

      let again = await post('/_grafana-write-off-ai-batch', {
        batch: 'batch_unbilled',
        reason: 'again',
      });
      assert.strictEqual(again.status, 409, 'a batch is written off once');
    });

    test('a batch already charged can’t be written off', async function (assert) {
      await unbilledBatch();
      await topUp(1_000);
      await post('/_grafana-bill-ai-batch', { batch: 'batch_unbilled' });

      let response = await post('/_grafana-write-off-ai-batch', {
        batch: 'batch_unbilled',
        reason: 'changed my mind',
      });
      assert.strictEqual(response.status, 409);
      let batch = await getAIBatch(context.dbAdapter, 'batch_unbilled');
      assert.strictEqual(batch?.writtenOffAt, null);
    });

    test('recording an unrecorded batch gives the settle job a row to bill it from', async function (assert) {
      let { run, reservationId } = await runWithReservation();
      let createdAt = new Date(Date.now() - 2 * 3600 * 1000);
      await recordUnrecordedAIBatches(context.dbAdapter, [
        {
          batchId: 'batch_lost',
          model: MODEL,
          status: 'in_progress',
          requestCount: 3,
          costUsd: null,
          createdAt,
        },
      ]);

      let wrongReservation = await post('/_grafana-record-ai-batch', {
        batch: 'batch_lost',
        run: run.id,
        estimate: '0.02',
        reservation: 'not-a-reservation',
      });
      assert.strictEqual(
        wrongReservation.status,
        400,
        'a reservation the run doesn’t hold is refused',
      );
      assert.notOk(await getAIBatch(context.dbAdapter, 'batch_lost'));

      let response = await post('/_grafana-record-ai-batch', {
        batch: 'batch_lost',
        run: run.id,
        estimate: '0.02',
        reservation: reservationId,
      });
      assert.strictEqual(response.status, 200);
      let batch = (await getAIBatch(context.dbAdapter, 'batch_lost'))!;
      assert.deepEqual(
        {
          runId: batch.runId,
          actsAs: batch.actsAs,
          realm: batch.realm,
          automationId: batch.automationId,
          model: batch.model,
          requestCount: batch.requestCount,
          estimatedUsd: batch.estimatedUsd,
          runAIReservation: batch.runAIReservation,
          state: batch.state,
          submittedAt: batch.submittedAt,
          settledAt: batch.settledAt,
        },
        {
          runId: run.id,
          actsAs: PAYER,
          realm: REALM,
          automationId: AUTOMATION,
          model: MODEL,
          requestCount: 3,
          estimatedUsd: 0.02,
          runAIReservation: reservationId,
          state: 'in_progress',
          submittedAt: createdAt.toISOString(),
          settledAt: null,
        },
        'the row names the run’s payer, realm and automation, and what OpenRouter listed',
      );
      let unrecorded = await getUnrecordedAIBatch(
        context.dbAdapter,
        'batch_lost',
      );
      assert.ok(unrecorded?.resolvedAt, 'the unrecorded row is resolved');
      assert.strictEqual(unrecorded?.resolution, 'recorded');

      let again = await post('/_grafana-record-ai-batch', {
        batch: 'batch_lost',
        run: run.id,
        estimate: '0.02',
        reservation: reservationId,
      });
      assert.strictEqual(again.status, 409, 'a batch is recorded once');

      await recordUnrecordedAIBatches(context.dbAdapter, [
        {
          batchId: 'batch_other',
          model: MODEL,
          status: 'in_progress',
          requestCount: 3,
          costUsd: null,
          createdAt,
        },
      ]);
      let reused = await post('/_grafana-record-ai-batch', {
        batch: 'batch_other',
        run: run.id,
        estimate: '0.02',
        reservation: reservationId,
      });
      assert.strictEqual(
        reused.status,
        400,
        'a reservation another batch holds is refused',
      );
      assert.notOk(await getAIBatch(context.dbAdapter, 'batch_other'));
    });

    test('a batch whose run is gone is recorded from the payer, realm and automation given', async function (assert) {
      await recordUnrecordedAIBatches(context.dbAdapter, [
        {
          batchId: 'batch_orphan',
          model: MODEL,
          status: 'completed',
          requestCount: 2,
          costUsd: 0.01,
          createdAt: new Date(Date.now() - 3600 * 1000),
        },
      ]);
      let goneRun = '0b5f4c9e-6a1d-4e7b-9c3a-2d8e1f7a6b50';
      assert.notOk(await getAutomationRun(context.dbAdapter, goneRun));

      let missingPayer = await post('/_grafana-record-ai-batch', {
        batch: 'batch_orphan',
        run: goneRun,
        estimate: '0.012',
        reservation: 'reservation-from-sentry',
      });
      assert.strictEqual(
        missingPayer.status,
        400,
        'with no run row, the payer must be given',
      );

      let response = await post('/_grafana-record-ai-batch', {
        batch: 'batch_orphan',
        run: goneRun,
        estimate: '0.012',
        reservation: 'reservation-from-sentry',
        acts_as: PAYER,
        realm: REALM,
        automation: AUTOMATION,
      });
      assert.strictEqual(response.status, 200);
      let batch = await getAIBatch(context.dbAdapter, 'batch_orphan');
      assert.strictEqual(batch?.actsAs, PAYER);
      assert.strictEqual(batch?.runId, goneRun);
    });

    test('an unrecorded batch another environment billed is dismissed with its reason', async function (assert) {
      await recordUnrecordedAIBatches(context.dbAdapter, [
        {
          batchId: 'batch_elsewhere',
          model: MODEL,
          status: 'completed',
          requestCount: 2,
          costUsd: 0.01,
          createdAt: new Date(Date.now() - 3600 * 1000),
        },
      ]);

      let reserved = await post('/_grafana-dismiss-unrecorded-ai-batch', {
        batch: 'batch_elsewhere',
        reason: 'recorded',
      });
      assert.strictEqual(
        reserved.status,
        400,
        '"recorded" is kept for batches with a row',
      );

      let response = await post('/_grafana-dismiss-unrecorded-ai-batch', {
        batch: 'batch_elsewhere',
        reason: 'production ai_batches row',
      });
      assert.strictEqual(response.status, 200);
      let unrecorded = await getUnrecordedAIBatch(
        context.dbAdapter,
        'batch_elsewhere',
      );
      assert.ok(unrecorded?.resolvedAt);
      assert.strictEqual(unrecorded?.resolution, 'production ai_batches row');

      let again = await post('/_grafana-dismiss-unrecorded-ai-batch', {
        batch: 'batch_elsewhere',
        reason: 'again',
      });
      assert.strictEqual(again.status, 409, 'a batch is resolved once');

      let missing = await post('/_grafana-dismiss-unrecorded-ai-batch', {
        batch: 'batch_none',
        reason: 'nothing',
      });
      assert.strictEqual(missing.status, 404);
    });

    test('the levers need the Grafana secret', async function (assert) {
      await unbilledBatch();
      await topUp(1_000);
      for (let path of [
        '/_grafana-bill-ai-batch?batch=batch_unbilled',
        '/_grafana-write-off-ai-batch?batch=batch_unbilled&reason=x',
        '/_grafana-record-ai-batch?batch=batch_unbilled',
        '/_grafana-dismiss-unrecorded-ai-batch?batch=batch_unbilled&reason=x',
      ]) {
        let response = await context.request.post(path);
        assert.strictEqual(response.status, 401, path);
      }
      assert.strictEqual(await batchCredits('batch_unbilled'), 0);
    });
  });
});
