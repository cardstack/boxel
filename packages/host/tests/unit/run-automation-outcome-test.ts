import { module, test } from 'qunit';

import {
  AutomationRunStoppedError,
  AutomationTimeLimitError,
  isPlatformFailure,
} from '@cardstack/host/lib/realm-runner/automation';
import { RealmCallFailure } from '@cardstack/host/lib/realm-runner/runner';
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

  test("a realm call's error that ends the script is the call failing, unless the platform failed a request of the run's", async function (assert) {
    let failing = () =>
      scriptOutcome(async () => {
        throw new RealmCallFailure('File not found: token-123/notes.md');
      }, ['token-123']);
    let own = await failing();
    assert.strictEqual(own.state, 'error');
    if (own.state === 'error') {
      assert.strictEqual(own.reason, 'call-failed');
      assert.false(
        own.message.includes('token-123'),
        'the message is redacted',
      );
    }

    let duringOutage = await scriptOutcome(
      async () => {
        throw new RealmCallFailure('Unable to list notes/: 503');
      },
      [],
      () => true,
    );
    assert.strictEqual(
      duringOutage.state === 'error' ? duringOutage.reason : undefined,
      'run-failed',
    );
  });

  test('a request fails for the platform when it gets a server error or no answer, but not when it is refused or aborted', function (assert) {
    let answered = (status: number) =>
      isPlatformFailure({ response: new Response(null, { status }) });
    assert.deepEqual(
      [200, 401, 404, 422, 429, 500, 502, 503, 504].map(answered),
      [false, false, false, false, false, true, true, true, true],
    );
    assert.true(
      isPlatformFailure({ error: new TypeError('Failed to fetch') }),
      'a request with no answer',
    );
    assert.false(
      isPlatformFailure({
        error: new DOMException('The run stopped', 'AbortError'),
      }),
      'a request aborted because the run stopped',
    );
  });
});
