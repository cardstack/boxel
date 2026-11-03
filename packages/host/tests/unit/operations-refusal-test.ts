import { module, test } from 'qunit';

import { OperationsError } from '@cardstack/runtime-common';

import { refusal } from '@cardstack/host/services/operations';

function refused(status: number, error: Record<string, unknown>) {
  return new Response(JSON.stringify({ errors: [error] }), {
    status,
    headers: { 'content-type': 'application/vnd.api+json' },
  });
}

module('Unit | operations refusal', function () {
  test('a refusal for a limit carries how long to wait', async function (assert) {
    let error = await refusal(
      refused(429, {
        status: 429,
        code: 'over-budget',
        title: 'Over budget',
        detail: 'the limit is reached',
        meta: { retryAfterSeconds: 3600, entry: 0 },
      }),
    );
    assert.true(error instanceof OperationsError);
    let { status, code, entry, retryAfterSeconds } = error as OperationsError;
    assert.deepEqual(
      { status, code, entry, retryAfterSeconds },
      { status: 429, code: 'over-budget', entry: 0, retryAfterSeconds: 3600 },
    );
  });

  test('a refusal that names no wait has none', async function (assert) {
    let error = (await refusal(
      refused(409, {
        status: 409,
        code: 'binding-not-approved',
        meta: { retryAfterSeconds: 'soon' },
      }),
    )) as OperationsError;
    assert.strictEqual(error.code, 'binding-not-approved');
    assert.strictEqual(
      error.retryAfterSeconds,
      undefined,
      'a value that is not a number of seconds is left out',
    );
  });
});
