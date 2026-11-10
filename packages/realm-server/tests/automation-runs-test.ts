import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { randomUUID } from 'crypto';
import {
  addAutomationRunCounts,
  cancelAutomationRun,
  claimAutomationRunCommit,
  createAutomationRun,
  finishAutomationRun,
  getAutomationRun,
  recordAutomationRunCommitted,
  recordAutomationRunScript,
  ri,
  rri,
  startAutomationRunAttempt,
  type AutomationRun,
  type DBAdapter,
} from '@cardstack/runtime-common';
import { setupDB } from './helpers/index.ts';

const REALM = ri('http://127.0.0.1:4444/payroll/');
const AUTOMATION = rri('http://127.0.0.1:4444/payroll/Automation/nightly-sync');
const SCRIPT = rri('http://127.0.0.1:4444/payroll/scripts/nightly-sync.js');
const PAYER = '@payer:localhost';
const SLOT = '2026-11-10T05:30:00.000Z';

module(basename(import.meta.filename), function () {
  module('the automation run row', function (hooks) {
    let dbAdapter: DBAdapter;

    setupDB(hooks, {
      beforeEach: async (_dbAdapter) => {
        dbAdapter = _dbAdapter;
      },
    });

    async function newRun(slot = SLOT): Promise<AutomationRun> {
      return await createAutomationRun(dbAdapter, {
        automationId: AUTOMATION,
        realm: REALM,
        trigger: 'nightly',
        slot,
        actsAs: PAYER,
      });
    }

    async function startedRun(attempt = 'attempt-1'): Promise<AutomationRun> {
      let run = await newRun();
      let start = await startAutomationRunAttempt(dbAdapter, run.id, attempt);
      if (start.kind !== 'run') {
        throw new Error(`expected the run to start, got ${start.kind}`);
      }
      return start.run;
    }

    test('a new run is pending, and stores its automation, realm and identity as given', async function (assert) {
      let run = await newRun();
      assert.strictEqual(run.state, 'pending');
      assert.strictEqual(run.automationId, AUTOMATION);
      assert.strictEqual(run.realm, REALM);
      assert.strictEqual(run.trigger, 'nightly');
      assert.strictEqual(run.slot, SLOT);
      assert.strictEqual(run.actsAs, PAYER);
      assert.strictEqual(run.attempt, null);
      assert.strictEqual(run.startedAt, null);
      assert.deepEqual(
        [
          run.callApiCalls,
          run.callApiResponseBytes,
          run.resolveCalls,
          run.writes,
        ],
        [0, 0, 0, 0],
      );
      assert.deepEqual(await getAutomationRun(dbAdapter, run.id), run);
    });

    test('enqueueing the same trigger and slot again returns the same run', async function (assert) {
      let first = await newRun();
      let again = await newRun();
      let other = await newRun('2026-11-11T05:30:00.000Z');
      assert.strictEqual(again.id, first.id);
      assert.notStrictEqual(other.id, first.id);
      let [{ count }] = await dbAdapter.execute(
        'SELECT count(*)::int AS count FROM automation_runs',
      );
      assert.strictEqual(count, 2);
    });

    test('an attempt starts a pending run and owns it', async function (assert) {
      let run = await newRun();
      let start = await startAutomationRunAttempt(
        dbAdapter,
        run.id,
        'attempt-1',
      );
      assert.strictEqual(start.kind, 'run');
      if (start.kind !== 'run') {
        return;
      }
      assert.strictEqual(start.run.state, 'running');
      assert.strictEqual(start.run.attempt, 'attempt-1');
      assert.ok(start.run.startedAt, 'the start is timestamped');
    });

    test('the owning attempt records the script it ran', async function (assert) {
      let run = await startedRun();
      let recorded = await recordAutomationRunScript(
        dbAdapter,
        run.id,
        'attempt-1',
        { scriptId: SCRIPT, scriptHash: 'sha256:abc' },
      );
      assert.strictEqual(recorded?.scriptId, SCRIPT);
      assert.strictEqual(recorded?.scriptHash, 'sha256:abc');
      assert.strictEqual(
        await recordAutomationRunScript(dbAdapter, run.id, 'attempt-0', {
          scriptId: SCRIPT,
          scriptHash: 'sha256:other',
        }),
        undefined,
        'an attempt that does not own the run is refused',
      );
    });

    test('a run commits once and finishes complete', async function (assert) {
      let run = await startedRun();
      let claimed = await claimAutomationRunCommit(
        dbAdapter,
        run.id,
        'attempt-1',
      );
      assert.ok(claimed?.commitStartedAt, 'the commit is claimed');
      assert.strictEqual(
        await claimAutomationRunCommit(dbAdapter, run.id, 'attempt-1'),
        undefined,
        'a second claim is refused',
      );
      let committed = await recordAutomationRunCommitted(dbAdapter, run.id);
      assert.ok(committed?.committedAt, 'the landed commit is recorded');
      let finished = await finishAutomationRun(dbAdapter, run.id, 'attempt-1', {
        state: 'complete',
      });
      assert.strictEqual(finished?.state, 'complete');
      assert.ok(finished?.finishedAt, 'the finish is timestamped');
    });

    test('a run that never commits, such as a Preview, finishes complete', async function (assert) {
      let run = await startedRun();
      let finished = await finishAutomationRun(dbAdapter, run.id, 'attempt-1', {
        state: 'complete',
      });
      assert.strictEqual(finished?.state, 'complete');
      assert.strictEqual(finished?.commitStartedAt, null);
    });

    test('a run finishes as an error with its reason', async function (assert) {
      let run = await startedRun();
      let finished = await finishAutomationRun(dbAdapter, run.id, 'attempt-1', {
        state: 'error',
        reason: 'script-error',
        message: 'TypeError: rows is undefined (line 12)',
      });
      assert.strictEqual(finished?.state, 'error');
      assert.strictEqual(finished?.errorReason, 'script-error');
      assert.strictEqual(
        finished?.errorMessage,
        'TypeError: rows is undefined (line 12)',
      );
    });

    test('a stale attempt is refused at commit once a retry has taken the run over', async function (assert) {
      let run = await startedRun('attempt-1');
      let retry = await startAutomationRunAttempt(
        dbAdapter,
        run.id,
        'attempt-2',
      );
      assert.strictEqual(retry.kind, 'run', 'the retry runs the script');
      assert.strictEqual(
        await claimAutomationRunCommit(dbAdapter, run.id, 'attempt-1'),
        undefined,
        'the replaced attempt cannot commit',
      );
      assert.strictEqual(
        await finishAutomationRun(dbAdapter, run.id, 'attempt-1', {
          state: 'complete',
        }),
        undefined,
        'the replaced attempt cannot finish the run',
      );
      let claimed = await claimAutomationRunCommit(
        dbAdapter,
        run.id,
        'attempt-2',
      );
      assert.strictEqual(claimed?.attempt, 'attempt-2', 'the retry commits');
    });

    test('a retry after a commit finishes without running the script again', async function (assert) {
      let run = await startedRun('attempt-1');
      await claimAutomationRunCommit(dbAdapter, run.id, 'attempt-1');
      await recordAutomationRunCommitted(dbAdapter, run.id);

      let retry = await startAutomationRunAttempt(
        dbAdapter,
        run.id,
        'attempt-2',
      );
      assert.strictEqual(retry.kind, 'committed');
      assert.strictEqual(
        await claimAutomationRunCommit(dbAdapter, run.id, 'attempt-2'),
        undefined,
        'the retry cannot commit again',
      );
      let finished = await finishAutomationRun(dbAdapter, run.id, 'attempt-2', {
        state: 'complete',
      });
      assert.strictEqual(finished?.state, 'complete');
    });

    test('a retry after a claimed commit that never landed finishes as an error', async function (assert) {
      let run = await startedRun('attempt-1');
      await claimAutomationRunCommit(dbAdapter, run.id, 'attempt-1');

      let retry = await startAutomationRunAttempt(
        dbAdapter,
        run.id,
        'attempt-2',
      );
      assert.strictEqual(retry.kind, 'commit-interrupted');
      assert.strictEqual(
        await finishAutomationRun(dbAdapter, run.id, 'attempt-2', {
          state: 'complete',
        }),
        undefined,
        'the run cannot read complete while its commit is unaccounted for',
      );
      let finished = await finishAutomationRun(dbAdapter, run.id, 'attempt-2', {
        state: 'error',
        reason: 'commit-interrupted',
      });
      assert.strictEqual(finished?.state, 'error');
      assert.strictEqual(finished?.errorReason, 'commit-interrupted');
    });

    test('the batch of a replaced attempt is still recorded as landed', async function (assert) {
      let run = await startedRun('attempt-1');
      await claimAutomationRunCommit(dbAdapter, run.id, 'attempt-1');
      await startAutomationRunAttempt(dbAdapter, run.id, 'attempt-2');
      let committed = await recordAutomationRunCommitted(dbAdapter, run.id);
      assert.ok(committed?.committedAt);
      assert.strictEqual(
        await recordAutomationRunCommitted(dbAdapter, run.id),
        undefined,
        'a commit is recorded once',
      );
    });

    test('a pending run can be canceled, and then never starts', async function (assert) {
      let run = await newRun();
      let canceled = await cancelAutomationRun(dbAdapter, run.id, PAYER);
      assert.strictEqual(canceled?.state, 'canceled');
      assert.strictEqual(canceled?.canceledBy, PAYER);
      assert.ok(canceled?.finishedAt);
      let start = await startAutomationRunAttempt(
        dbAdapter,
        run.id,
        'attempt-1',
      );
      assert.strictEqual(start.kind, 'over');
    });

    test('a running run canceled before its commit cannot commit', async function (assert) {
      let run = await startedRun();
      let canceled = await cancelAutomationRun(
        dbAdapter,
        run.id,
        '@admin:localhost',
      );
      assert.strictEqual(canceled?.state, 'canceled');
      assert.strictEqual(
        await claimAutomationRunCommit(dbAdapter, run.id, 'attempt-1'),
        undefined,
      );
      assert.strictEqual(
        await finishAutomationRun(dbAdapter, run.id, 'attempt-1', {
          state: 'complete',
        }),
        undefined,
        'a canceled run stays canceled',
      );
    });

    test('a run whose commit was claimed cannot be canceled', async function (assert) {
      let run = await startedRun();
      await claimAutomationRunCommit(dbAdapter, run.id, 'attempt-1');
      assert.strictEqual(
        await cancelAutomationRun(dbAdapter, run.id, PAYER),
        undefined,
      );
      assert.strictEqual(
        (await getAutomationRun(dbAdapter, run.id))?.state,
        'running',
      );
    });

    test('a finished run is over for every later attempt', async function (assert) {
      let run = await startedRun();
      await finishAutomationRun(dbAdapter, run.id, 'attempt-1', {
        state: 'error',
        reason: 'timed-out',
      });
      let start = await startAutomationRunAttempt(
        dbAdapter,
        run.id,
        'attempt-2',
      );
      assert.strictEqual(start.kind, 'over');
      if (start.kind === 'over') {
        assert.strictEqual(start.run.state, 'error');
        assert.strictEqual(start.run.attempt, 'attempt-1');
      }
      assert.strictEqual(
        await cancelAutomationRun(dbAdapter, run.id, PAYER),
        undefined,
        'a finished run cannot be canceled',
      );
    });

    test('an attempt at a run that does not exist finds nothing', async function (assert) {
      let start = await startAutomationRunAttempt(
        dbAdapter,
        randomUUID(),
        'attempt-1',
      );
      assert.strictEqual(start.kind, 'missing');
    });

    test('metered counts add up, in any state', async function (assert) {
      let run = await startedRun();
      await addAutomationRunCounts(dbAdapter, run.id, {
        callApiCalls: 2,
        callApiResponseBytes: 4096,
      });
      await addAutomationRunCounts(dbAdapter, run.id, {
        callApiCalls: 1,
        resolveCalls: 3,
        writes: 5,
      });
      await finishAutomationRun(dbAdapter, run.id, 'attempt-1', {
        state: 'complete',
      });
      await addAutomationRunCounts(dbAdapter, run.id, { writes: 1 });
      let counted = await getAutomationRun(dbAdapter, run.id);
      assert.deepEqual(
        [
          counted?.callApiCalls,
          counted?.callApiResponseBytes,
          counted?.resolveCalls,
          counted?.writes,
        ],
        [3, 4096, 3, 6],
      );
      await assert.rejects(
        addAutomationRunCounts(dbAdapter, run.id, { writes: -1 }),
        /whole number/,
        'a count never shrinks',
      );
    });
  });
});
