import { module, test } from 'qunit';

import {
  AutomationRunStoppedError,
  AutomationTimeLimitError,
} from '@cardstack/host/lib/realm-runner/automation';
import { scriptOutcome } from '@cardstack/host/tools/run-automation';

// What the automation command answers for a run's script: its outcome, and
// when the script started and ended in the tab, which the run's telemetry
// reads.
module('Unit | run-automation outcome', function () {
  test('a script that finishes is complete, with when it started and ended', async function (assert) {
    let before = Date.now();
    let outcome = await scriptOutcome(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }, []);
    let after = Date.now();
    assert.strictEqual(outcome.state, 'complete');
    let { startedAt, endedAt } = outcome.timing!;
    assert.true(before <= startedAt, 'the script started within the call');
    assert.true(startedAt <= endedAt, 'and ended after it started');
    assert.true(endedAt <= after, 'before the call returned');
    assert.true(endedAt - startedAt >= 5, 'the timing covers the script');
  });

  test('a script that fails answers its error, redacted, and still says when it ran', async function (assert) {
    let outcome = await scriptOutcome(async () => {
      throw new Error('the vendor refused token-123');
    }, ['token-123']);
    assert.strictEqual(outcome.state, 'error');
    if (outcome.state === 'error') {
      assert.strictEqual(outcome.reason, 'run-failed');
      assert.false(
        outcome.message.includes('token-123'),
        'the message is redacted',
      );
    }
    assert.true(outcome.timing!.startedAt <= outcome.timing!.endedAt);
  });

  test('a run out of time or stopped answers why', async function (assert) {
    let timedOut = await scriptOutcome(async () => {
      throw new AutomationTimeLimitError('out of time');
    }, []);
    let stopped = await scriptOutcome(async () => {
      throw new AutomationRunStoppedError();
    }, []);
    assert.deepEqual(
      [
        timedOut.state === 'error' ? timedOut.reason : timedOut.state,
        stopped.state === 'error' ? stopped.reason : stopped.state,
      ],
      ['timed-out', 'stopped'],
    );
    assert.ok(timedOut.timing, 'a run out of time still says when it ran');
  });
});
