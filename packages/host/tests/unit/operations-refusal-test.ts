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

  test('a key that could not mint a token says why', async function (assert) {
    let detail =
      `operation "load" can't fill the credential slot "github": the OAuth ` +
      `client it mints through is unavailable, so an administrator of that ` +
      `client needs to set it up again`;
    let error = (await refusal(
      refused(424, {
        status: 424,
        code: 'credential-rejected',
        title: 'Credential rejected',
        detail,
        meta: {
          entry: 0,
          slot: { name: 'github', key: 'userKey' },
          destination: 'https://api.github.com',
          reason: 'needs-admin',
        },
      }),
    )) as OperationsError;
    assert.deepEqual(
      {
        status: error.status,
        code: error.code,
        title: error.title,
        detail: error.detail,
        entry: error.entry,
      },
      {
        status: 424,
        code: 'credential-rejected',
        title: 'Credential rejected',
        detail,
        entry: 0,
      },
      "the code, status and detail are the realm's own",
    );
    assert.deepEqual(
      error.meta,
      { reason: 'needs-admin' },
      'the reason is carried; the slot and destination the detail names are not',
    );
  });

  test('a stored key the service rejected names no reason, and reading one is safe', async function (assert) {
    let error = (await refusal(
      refused(424, {
        status: 424,
        code: 'credential-rejected',
        title: 'Credential rejected',
        detail: 'that service rejected the key',
        meta: {
          slot: { name: 'forecast', key: 'apiKey' },
          destination: 'https://api.example.com',
        },
      }),
    )) as OperationsError;
    assert.strictEqual(error.meta.reason, undefined);
    assert.deepEqual(error.meta, {});
  });

  test('a reason the card cannot act on is left out', async function (assert) {
    let unknown = (await refusal(
      refused(424, {
        status: 424,
        code: 'credential-rejected',
        meta: { reason: 'revoked-upstream' },
      }),
    )) as OperationsError;
    assert.deepEqual(unknown.meta, {}, 'a reason outside the known set');

    let guard = (await refusal(
      refused(502, {
        status: 502,
        code: 'guard-refused',
        title: 'Destination refused',
        detail: 'the request is addressed to a token endpoint',
        meta: { reason: 'platform-only' },
      }),
    )) as OperationsError;
    assert.deepEqual(
      guard.meta,
      {},
      "a reason on another code is the server's diagnostic",
    );
    assert.strictEqual(
      guard.detail,
      'the request is addressed to a token endpoint',
    );
  });

  test('a response over the size cap says what the cap is', async function (assert) {
    let error = (await refusal(
      refused(502, {
        status: 502,
        code: 'response-too-large',
        title: 'Response too large',
        detail: 'api.example.com answered more than 10485760 bytes',
        meta: { cap: 10485760, measured: 'declared-length' },
      }),
    )) as OperationsError;
    assert.strictEqual(error.code, 'response-too-large');
    assert.deepEqual(
      error.meta,
      { cap: 10485760 },
      'the cap is carried; how the size was measured is not',
    );

    let malformed = (await refusal(
      refused(502, {
        status: 502,
        code: 'response-too-large',
        meta: { cap: '10MiB' },
      }),
    )) as OperationsError;
    assert.deepEqual(malformed.meta, {}, 'a cap that is not a byte count');
  });

  test('a refusal that is not a JSON:API document has empty meta', async function (assert) {
    let error = (await refusal(
      new Response('Bad Gateway', { status: 502 }),
    )) as OperationsError;
    assert.strictEqual(error.status, 502);
    assert.deepEqual(error.meta, {});
  });

  test('an OperationsError built directly keeps only what its code allows', function (assert) {
    let error = new OperationsError({
      status: 502,
      code: 'guard-refused',
      meta: { reason: 'rejected', cap: 10 },
    });
    assert.deepEqual(error.meta, {});
    let sized = new OperationsError({
      status: 502,
      code: 'response-too-large',
      meta: { reason: 'rejected', cap: 10 },
    });
    assert.deepEqual(sized.meta, { cap: 10 });
  });

  test("a refusal's meta can't be changed by the card that catches it", async function (assert) {
    let error = (await refusal(
      refused(424, {
        status: 424,
        code: 'credential-rejected',
        meta: { reason: 'unavailable' },
      }),
    )) as OperationsError;
    assert.true(Object.isFrozen(error.meta));
  });
});
