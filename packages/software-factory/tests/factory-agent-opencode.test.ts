import QUnit from 'qunit';
const { module, test } = QUnit;

import { waitForSessionIdle } from '../src/factory-agent/opencode.ts';

module('factory-agent-opencode > session lifecycle', function () {
  test('a dead opencode transport is a terminal agent result, not an idle session', async function (assert) {
    let calls = 0;
    let result = await waitForSessionIdle(
      {
        session: {
          async list() {
            calls++;
            throw new Error('connect ECONNREFUSED 127.0.0.1:4096');
          },
        },
      },
      'session-1',
      '/tmp/workspace',
      {
        pollIntervalMs: 0,
        maxConsecutiveListFailures: 3,
      },
    );

    assert.strictEqual(calls, 3, 'the bounded liveness probe was exhausted');
    assert.strictEqual(
      result.status,
      'transport-error',
      'transport loss cannot be mistaken for a successfully idle agent',
    );
  });

  test('a stable live session still reports ordinary idle completion', async function (assert) {
    let result = await waitForSessionIdle(
      {
        session: {
          async list() {
            return {
              data: [{ id: 'session-1', time: { updated: 1 } }],
            };
          },
        },
      },
      'session-1',
      '/tmp/workspace',
      { pollIntervalMs: 0, stabilityWindowMs: 0 },
    );

    assert.strictEqual(result.status, 'idle');
  });
});
