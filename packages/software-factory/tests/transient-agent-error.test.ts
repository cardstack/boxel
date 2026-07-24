import QUnit from 'qunit';
const { module, test } = QUnit;

import {
  isTransientAgentError,
  retryTransientAgentError,
} from '../src/transient-agent-error.ts';

module('transient-agent-error > isTransientAgentError', function () {
  test('matches the observed SDK stream idle timeout', function (assert) {
    assert.ok(
      isTransientAgentError(
        new Error('API Error: Stream idle timeout - partial response received'),
      ),
    );
  });

  test('matches common network fault messages', function (assert) {
    assert.ok(isTransientAgentError(new Error('connect ECONNRESET')));
    assert.ok(isTransientAgentError(new Error('fetch failed')));
    assert.ok(isTransientAgentError(new Error('socket hang up')));
  });

  test('does not match real agent/tool errors', function (assert) {
    assert.notOk(
      isTransientAgentError(new Error('Issue "x" has no linked project')),
    );
    assert.notOk(isTransientAgentError(new Error('Unexpected token')));
  });

  test('handles non-Error throws without crashing', function (assert) {
    assert.notOk(isTransientAgentError('a plain string'));
    assert.notOk(isTransientAgentError(undefined));
  });
});

module('transient-agent-error > retryTransientAgentError', function () {
  test('returns the result on first success without retrying', async function (assert) {
    let calls = 0;
    let result = await retryTransientAgentError(
      async () => {
        calls++;
        return 'ok';
      },
      undefined,
      { sleep: async () => {} },
    );

    assert.strictEqual(result, 'ok');
    assert.strictEqual(calls, 1);
  });

  test('retries a transient error and succeeds on a later attempt', async function (assert) {
    let calls = 0;
    let retryLog: number[] = [];
    let result = await retryTransientAgentError(
      async () => {
        calls++;
        if (calls < 3) throw new Error('Stream idle timeout');
        return 'recovered';
      },
      (attempt) => retryLog.push(attempt),
      { sleep: async () => {} },
    );

    assert.strictEqual(result, 'recovered');
    assert.strictEqual(calls, 3);
    assert.deepEqual(
      retryLog,
      [1, 2],
      'onRetry fired once per retry, in order',
    );
  });

  test('rethrows immediately on a non-transient error without retrying', async function (assert) {
    let calls = 0;
    await assert.rejects(
      retryTransientAgentError(
        async () => {
          calls++;
          throw new Error('Issue has no linked project');
        },
        undefined,
        { sleep: async () => {} },
      ),
      /no linked project/,
    );
    assert.strictEqual(
      calls,
      1,
      'no retry attempted for a non-transient error',
    );
  });

  test('gives up and rethrows after exhausting maxRetries', async function (assert) {
    let calls = 0;
    await assert.rejects(
      retryTransientAgentError(
        async () => {
          calls++;
          throw new Error('fetch failed');
        },
        undefined,
        { sleep: async () => {}, maxRetries: 2 },
      ),
      /fetch failed/,
    );
    assert.strictEqual(calls, 3, 'initial attempt + 2 retries, then give up');
  });

  test('backs off exponentially between retries', async function (assert) {
    let delays: number[] = [];
    let calls = 0;
    await retryTransientAgentError(
      async () => {
        calls++;
        if (calls < 3) throw new Error('ECONNRESET');
        return 'ok';
      },
      undefined,
      {
        baseDelayMs: 100,
        sleep: async (ms) => {
          delays.push(ms);
        },
      },
    );

    assert.deepEqual(
      delays,
      [100, 200],
      'delay doubles each retry from the base',
    );
  });
});
