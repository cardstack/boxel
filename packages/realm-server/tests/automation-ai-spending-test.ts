import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  cancelAutomationRun,
  createAutomationRun,
  getAutomationRun,
  ri,
  rri,
  startAutomationRunAttempt,
  type AutomationRun,
  type DBAdapter,
} from '@cardstack/runtime-common';
import type { AIModelPrice } from '@cardstack/runtime-common/automation-ai-cost';
import { setupDB } from './helpers/index.ts';
import {
  admitAutomationRunAIRequest,
  BATCHED_AI_RESERVE_FACTOR,
  settleAutomationRunAIRequest,
  type AutomationRunAIAdmission,
} from '../lib/automation-ai-spending.ts';

const REALM = ri('http://127.0.0.1:4444/payroll/');
const AUTOMATION = rri('http://127.0.0.1:4444/payroll/Automation/nightly-sync');
const PAYER = '@payer:localhost';

// A price that makes the arithmetic plain: a credit (a tenth of a cent) per
// thousand input tokens, ten credits per thousand output tokens.
const PRICE: AIModelPrice = {
  modelId: 'test/model',
  promptUsdPerToken: 0.000001,
  completionUsdPerToken: 0.00001,
  requestUsd: 0,
  contextLength: 200_000,
};

// A request whose worst case is `outputTokens` at 0.01 credits each, plus
// its body's bytes at 0.001 credits each.
function request(outputTokens: number): string {
  return JSON.stringify({
    model: PRICE.modelId,
    max_tokens: outputTokens,
    messages: [{ role: 'user', content: 'Summarize the payroll changes' }],
  });
}

function worstCase(body: string): number {
  let bytes = new TextEncoder().encode(body).length;
  let maxTokens = JSON.parse(body).max_tokens as number;
  return (bytes * 0.000001 + maxTokens * 0.00001) * 1000;
}

function close(assert: Assert, actual: number, expected: number, msg: string) {
  assert.true(
    Math.abs(actual - expected) < 1e-9,
    `${msg}: expected ${expected}, got ${actual}`,
  );
}

module(basename(import.meta.filename), function () {
  module('a run’s AI spending cap', function (hooks) {
    let dbAdapter: DBAdapter;

    setupDB(hooks, {
      beforeEach: async (_dbAdapter) => {
        dbAdapter = _dbAdapter;
      },
    });

    async function runningRun(): Promise<AutomationRun> {
      return await runningRunFor('2026-11-10T05:30:00.000Z');
    }

    async function runningRunFor(slot: string): Promise<AutomationRun> {
      let run = await createAutomationRun(dbAdapter, {
        automationId: AUTOMATION,
        realm: REALM,
        trigger: 'nightly',
        slot,
        actsAs: PAYER,
      });
      let start = await startAutomationRunAttempt(dbAdapter, run.id, 1);
      if (start.kind !== 'run') {
        throw new Error(`expected the run to start, got ${start.kind}`);
      }
      return start.run;
    }

    async function current(id: string): Promise<AutomationRun> {
      let run = await getAutomationRun(dbAdapter, id);
      if (!run) {
        throw new Error('the run is gone');
      }
      return run;
    }

    function admitted(admission: AutomationRunAIAdmission) {
      if (admission.kind !== 'admitted') {
        throw new Error(`expected the request admitted: ${admission.message}`);
      }
      return admission;
    }

    test('a request within the cap is admitted and its worst case reserved', async function (assert) {
      let run = await runningRun();
      assert.strictEqual(run.aiCreditsSpent, 0, 'a new run has spent nothing');
      assert.strictEqual(run.aiCreditsReserved, 0);

      let body = request(1000);
      let admission = admitted(
        await admitAutomationRunAIRequest(dbAdapter, {
          runId: run.id,
          aiCreditsCap: 20,
          body,
          price: PRICE,
        }),
      );
      close(
        assert,
        admission.reservedCredits,
        worstCase(body),
        'the reservation is the input and the output limit at the listed price',
      );
      assert.strictEqual(admission.ceiling.outputTokens, 1000);
      close(
        assert,
        (await current(run.id)).aiCreditsReserved,
        worstCase(body),
        'the reservation is on the run row',
      );
    });

    test('a request whose worst case would pass the cap is refused', async function (assert) {
      let run = await runningRun();
      let body = request(1000);
      // About 10 credits, against a cap of 5.
      let admission = await admitAutomationRunAIRequest(dbAdapter, {
        runId: run.id,
        aiCreditsCap: 5,
        body,
        price: PRICE,
      });
      assert.strictEqual(admission.kind, 'refused');
      assert.strictEqual(
        admission.kind === 'refused' ? admission.reason : undefined,
        'over-cap',
      );
      assert.strictEqual(
        (await current(run.id)).aiCreditsReserved,
        0,
        'a refused request reserves nothing',
      );

      let zero = await admitAutomationRunAIRequest(dbAdapter, {
        runId: run.id,
        aiCreditsCap: 0,
        body: request(1),
        price: PRICE,
      });
      assert.strictEqual(
        zero.kind === 'refused' ? zero.reason : zero.kind,
        'over-cap',
        'a cap of 0 refuses every request that costs anything',
      );
    });

    test('requests in flight count against the cap until their cost replaces them', async function (assert) {
      let run = await runningRun();
      let body = request(1000);
      let each = worstCase(body);
      // Room for two worst cases, not three.
      let cap = Math.floor(each * 2.5);

      let first = admitted(
        await admitAutomationRunAIRequest(dbAdapter, {
          runId: run.id,
          aiCreditsCap: cap,
          body,
          price: PRICE,
        }),
      );
      admitted(
        await admitAutomationRunAIRequest(dbAdapter, {
          runId: run.id,
          aiCreditsCap: cap,
          body,
          price: PRICE,
        }),
      );
      let third = await admitAutomationRunAIRequest(dbAdapter, {
        runId: run.id,
        aiCreditsCap: cap,
        body,
        price: PRICE,
      });
      assert.strictEqual(
        third.kind === 'refused' ? third.reason : third.kind,
        'over-cap',
        'two reservations in flight leave no room for a third worst case',
      );

      // The first request cost a tenth of its worst case.
      await settleAutomationRunAIRequest(dbAdapter, {
        runId: run.id,
        reservationId: first.reservationId,
        costInUsd: each / 10 / 1000,
      });
      let settled = await current(run.id);
      close(assert, settled.aiCreditsSpent, each / 10, 'its cost is spent');
      close(
        assert,
        settled.aiCreditsReserved,
        each,
        'its reservation is released; the other stays',
      );

      admitted(
        await admitAutomationRunAIRequest(dbAdapter, {
          runId: run.id,
          aiCreditsCap: cap,
          body,
          price: PRICE,
        }),
      );
    });

    test('a batched request reserves twice its worst case', async function (assert) {
      let run = await runningRun();
      let body = request(1000);
      let each = worstCase(body);
      let admission = admitted(
        await admitAutomationRunAIRequest(dbAdapter, {
          runId: run.id,
          aiCreditsCap: Math.ceil(each * BATCHED_AI_RESERVE_FACTOR),
          body,
          price: PRICE,
          batched: true,
        }),
      );
      close(
        assert,
        admission.reservedCredits,
        each * 2,
        'once for the batch and once for its normal-price fallback',
      );
      let refused = await admitAutomationRunAIRequest(dbAdapter, {
        runId: (await runningRunFor('2026-11-11T05:30:00.000Z')).id,
        aiCreditsCap: Math.ceil(each * 1.5),
        body,
        price: PRICE,
        batched: true,
      });
      assert.strictEqual(
        refused.kind === 'refused' ? refused.reason : refused.kind,
        'over-cap',
        'a cap that holds one worst case but not two refuses a batched request',
      );
    });

    test('a request whose cost is never learned spends its whole reservation', async function (assert) {
      let run = await runningRun();
      let body = request(500);
      let admission = admitted(
        await admitAutomationRunAIRequest(dbAdapter, {
          runId: run.id,
          aiCreditsCap: 50,
          body,
          price: PRICE,
        }),
      );
      await settleAutomationRunAIRequest(dbAdapter, {
        runId: run.id,
        reservationId: admission.reservationId,
        costInUsd: undefined,
      });
      let settled = await current(run.id);
      close(assert, settled.aiCreditsSpent, admission.reservedCredits, 'spent');
      close(assert, settled.aiCreditsReserved, 0, 'nothing held');
    });

    test('a reservation settles once', async function (assert) {
      let run = await runningRun();
      let body = request(500);
      let first = admitted(
        await admitAutomationRunAIRequest(dbAdapter, {
          runId: run.id,
          aiCreditsCap: 50,
          body,
          price: PRICE,
        }),
      );
      let second = admitted(
        await admitAutomationRunAIRequest(dbAdapter, {
          runId: run.id,
          aiCreditsCap: 50,
          body,
          price: PRICE,
        }),
      );
      assert.true(
        await settleAutomationRunAIRequest(dbAdapter, {
          runId: run.id,
          reservationId: first.reservationId,
          costInUsd: 0.001,
        }),
        'the first settle applies',
      );
      assert.false(
        await settleAutomationRunAIRequest(dbAdapter, {
          runId: run.id,
          reservationId: first.reservationId,
          costInUsd: 0.001,
        }),
        'settling it again does nothing',
      );
      let settled = await current(run.id);
      close(assert, settled.aiCreditsSpent, 1, 'its cost is spent once');
      close(
        assert,
        settled.aiCreditsReserved,
        second.reservedCredits,
        'the other request’s reservation still holds',
      );
    });

    test('a request that was never sent releases its reservation', async function (assert) {
      let run = await runningRun();
      let admission = admitted(
        await admitAutomationRunAIRequest(dbAdapter, {
          runId: run.id,
          aiCreditsCap: 50,
          body: request(500),
          price: PRICE,
        }),
      );
      await settleAutomationRunAIRequest(dbAdapter, {
        runId: run.id,
        reservationId: admission.reservationId,
        costInUsd: 0,
      });
      let settled = await current(run.id);
      assert.strictEqual(settled.aiCreditsSpent, 0);
      close(assert, settled.aiCreditsReserved, 0, 'nothing held');
    });

    test('a request admitted for an attempt a retry has taken the run over from is refused', async function (assert) {
      let run = await runningRun();
      let retry = await startAutomationRunAttempt(dbAdapter, run.id, 2);
      assert.strictEqual(retry.kind, 'run', 'the retry owns the run');

      let stale = await admitAutomationRunAIRequest(dbAdapter, {
        runId: run.id,
        attempt: 1,
        aiCreditsCap: 50,
        body: request(100),
        price: PRICE,
      });
      assert.strictEqual(
        stale.kind === 'refused' ? stale.reason : stale.kind,
        'run-not-running',
      );
      assert.strictEqual(
        (await current(run.id)).aiCreditsReserved,
        0,
        'nothing is reserved for the replaced attempt',
      );

      admitted(
        await admitAutomationRunAIRequest(dbAdapter, {
          runId: run.id,
          attempt: 2,
          aiCreditsCap: 50,
          body: request(100),
          price: PRICE,
        }),
      );
    });

    test('a run that isn’t running can’t make AI requests, but settles those it made', async function (assert) {
      let run = await runningRun();
      let admission = admitted(
        await admitAutomationRunAIRequest(dbAdapter, {
          runId: run.id,
          aiCreditsCap: 50,
          body: request(100),
          price: PRICE,
        }),
      );
      await cancelAutomationRun(dbAdapter, run.id, PAYER);
      let refused = await admitAutomationRunAIRequest(dbAdapter, {
        runId: run.id,
        aiCreditsCap: 50,
        body: request(100),
        price: PRICE,
      });
      assert.strictEqual(
        refused.kind === 'refused' ? refused.reason : refused.kind,
        'run-not-running',
      );
      await settleAutomationRunAIRequest(dbAdapter, {
        runId: run.id,
        reservationId: admission.reservationId,
        costInUsd: 0.0005,
      });
      close(
        assert,
        (await current(run.id)).aiCreditsSpent,
        0.5,
        'a request in flight when the run was canceled still counts what it cost',
      );

      let missing = await admitAutomationRunAIRequest(dbAdapter, {
        runId: '00000000-0000-0000-0000-000000000000',
        aiCreditsCap: 50,
        body: request(100),
        price: PRICE,
      });
      assert.strictEqual(
        missing.kind === 'refused' ? missing.reason : missing.kind,
        'missing-run',
      );
    });

    test('a request that can’t be priced is refused before anything is reserved', async function (assert) {
      let run = await runningRun();
      let admission = await admitAutomationRunAIRequest(dbAdapter, {
        runId: run.id,
        aiCreditsCap: 50,
        body: JSON.stringify({ model: PRICE.modelId, messages: [] }),
        price: { ...PRICE, contextLength: null },
      });
      assert.strictEqual(
        admission.kind === 'refused' ? admission.reason : admission.kind,
        'unbounded-output',
      );
      assert.strictEqual((await current(run.id)).aiCreditsReserved, 0);
    });
  });
});
