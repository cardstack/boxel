import { module, test } from 'qunit';

import {
  fetchWithTransientRetry,
  isRetryableStatus,
} from '@cardstack/runtime-common/loader';

// Synchronous-completing "sleep" stub so tests don't wait on real timers.
// fetchWithTransientRetry takes any (ms) => Promise<void>, so resolving
// immediately is fine for behavior verification.
let noSleep = (_ms: number) => Promise.resolve();

interface FakeResponse {
  status: number;
}

function queued(statuses: number[]): {
  fetch: () => Promise<FakeResponse>;
  calls: () => number;
} {
  let i = 0;
  return {
    fetch: async () => {
      if (i >= statuses.length) {
        throw new Error(
          `queued fetch exhausted: call ${i + 1} but only ${statuses.length} queued`,
        );
      }
      let status = statuses[i];
      i++;
      return { status };
    },
    calls: () => i,
  };
}

module('Unit | Loader transient 5xx retry (CS-10820)', function () {
  test('returns the first response when status is 2xx', async function (assert) {
    let { fetch, calls } = queued([200]);
    let response = await fetchWithTransientRetry(fetch, { sleep: noSleep });
    assert.strictEqual(response.status, 200, 'returned the 200 response');
    assert.strictEqual(calls(), 1, 'fetch invoked exactly once');
  });

  test('retries once after a 502 then succeeds on 200', async function (assert) {
    let { fetch, calls } = queued([502, 200]);
    let onRetryCalls: Array<{ attempt: number; status: number }> = [];
    let response = await fetchWithTransientRetry(fetch, {
      sleep: noSleep,
      onRetry: ({ attempt, status }) => onRetryCalls.push({ attempt, status }),
    });
    assert.strictEqual(response.status, 200, 'returned the successful retry');
    assert.strictEqual(calls(), 2, 'fetch invoked twice (502 then 200)');
    assert.deepEqual(
      onRetryCalls,
      [{ attempt: 1, status: 502 }],
      'onRetry called once for the 502',
    );
  });

  test('retries on 503 and 504 (both transient)', async function (assert) {
    let { fetch, calls } = queued([503, 504, 200]);
    let response = await fetchWithTransientRetry(fetch, { sleep: noSleep });
    assert.strictEqual(response.status, 200, 'succeeded on third attempt');
    assert.strictEqual(calls(), 3, 'fetch invoked three times');
  });

  test('surfaces last 5xx response after exhausting retry attempts', async function (assert) {
    let { fetch, calls } = queued([502, 502, 502, 502]);
    let response = await fetchWithTransientRetry(fetch, {
      sleep: noSleep,
      delaysMs: [10, 20, 30],
    });
    assert.strictEqual(
      response.status,
      502,
      'returned the final 502 (caller surfaces it as an error)',
    );
    assert.strictEqual(
      calls(),
      4,
      'fetch invoked exactly 4 times (initial + 3 retries)',
    );
  });

  test('does not retry on 500 (not transient)', async function (assert) {
    let { fetch, calls } = queued([500]);
    let response = await fetchWithTransientRetry(fetch, { sleep: noSleep });
    assert.strictEqual(response.status, 500, '500 surfaced immediately');
    assert.strictEqual(
      calls(),
      1,
      'fetch invoked exactly once — 500 is not in the retryable set',
    );
    assert.false(
      isRetryableStatus(500),
      '500 is not a retryable status (guards against accidental widening)',
    );
  });

  test('does not retry on 4xx (404, 401, 403)', async function (assert) {
    for (let status of [404, 401, 403, 400]) {
      let { fetch, calls } = queued([status]);
      let response = await fetchWithTransientRetry(fetch, { sleep: noSleep });
      assert.strictEqual(response.status, status, `${status} surfaced`);
      assert.strictEqual(calls(), 1, `${status} did not trigger a retry`);
    }
  });

  test('does not retry when the fetch call throws', async function (assert) {
    let callCount = 0;
    let thrower = async () => {
      callCount++;
      throw new Error('simulated network failure');
    };
    try {
      await fetchWithTransientRetry(thrower, { sleep: noSleep });
      assert.ok(false, 'should have thrown');
    } catch (err: any) {
      assert.strictEqual(
        err.message,
        'simulated network failure',
        'original error surfaces',
      );
    }
    assert.strictEqual(callCount, 1, 'fetch invoked exactly once, no retry');
  });

  test('honors custom backoff delays and passes them to onRetry', async function (assert) {
    let { fetch } = queued([502, 502, 200]);
    let observedDelays: number[] = [];
    await fetchWithTransientRetry(fetch, {
      sleep: noSleep,
      delaysMs: [11, 22, 33],
      onRetry: ({ delayMs }) => observedDelays.push(delayMs),
    });
    assert.deepEqual(
      observedDelays,
      [11, 22],
      'onRetry sees the first two configured delays',
    );
  });

  test('disposes each discarded response before retrying', async function (assert) {
    // Fake response carrying an id + a cancel() stub so we can assert that
    // each retried response got its body released before the next attempt.
    let nextId = 0;
    let canceled: number[] = [];
    let makeFakeResponse = (status: number) => {
      let id = ++nextId;
      return {
        status,
        id,
        body: {
          cancel: async () => {
            canceled.push(id);
          },
        },
      };
    };
    let statuses = [502, 503, 200];
    let i = 0;
    let fetch = async () => makeFakeResponse(statuses[i++]);
    let final = await fetchWithTransientRetry(fetch, {
      sleep: noSleep,
      dispose: async (r) => r.body?.cancel(),
    });
    assert.strictEqual(final.status, 200, 'final response surfaced');
    assert.deepEqual(
      canceled,
      [1, 2],
      'dispose called for each discarded retry response, in order, but not for the final one',
    );
  });

  test('does not call dispose when no retry happens', async function (assert) {
    let disposeCalls = 0;
    let { fetch } = queued([200]);
    await fetchWithTransientRetry(fetch, {
      sleep: noSleep,
      dispose: () => {
        disposeCalls++;
      },
    });
    assert.strictEqual(disposeCalls, 0, 'first-try success skips dispose');
  });

  test('dispose errors do not mask the retry path', async function (assert) {
    let { fetch, calls } = queued([502, 200]);
    let response = await fetchWithTransientRetry(fetch, {
      sleep: noSleep,
      dispose: () => {
        throw new Error('boom');
      },
    });
    assert.strictEqual(
      response.status,
      200,
      'retry still succeeded despite dispose throwing',
    );
    assert.strictEqual(calls(), 2, 'fetch still invoked twice');
  });
});
