import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  OperationFailure,
  type CallApiRequest,
} from '@cardstack/runtime-common/card-operations';
import { configureOutbound, resetOutbound } from '../lib/outbound/client.ts';
import { sendCallApiRequest } from '../lib/outbound/call-api-sender.ts';
import { REDACTED } from '../lib/outbound/scrubber.ts';
import { startStubVendor, type StubVendor } from './helpers/stub-vendor.ts';
import { logLinesDuring } from './helpers/log-capture.ts';

// The realm server's side of a `callApi`: the request arrives as declared,
// every credential slot a token, and the sender fills each token only after
// the outbound guard has checked the request as given.
const TOKEN = 'boxel_slot_0_0123456789abcdef';
const SECRET = 'sk-test-0123456789abcdefghij';

function request(overrides: Partial<CallApiRequest>): CallApiRequest {
  return {
    method: 'GET',
    url: 'https://example.invalid/',
    headers: {},
    slots: [],
    ...overrides,
  };
}

async function refusalOf(promise: Promise<unknown>): Promise<OperationFailure> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof OperationFailure) {
      return error;
    }
    throw error;
  }
  throw new Error('expected the send to be refused');
}

module(basename(import.meta.filename), function (hooks) {
  let vendor: StubVendor;

  hooks.before(async function () {
    vendor = await startStubVendor();
  });
  hooks.after(async function () {
    await vendor.close();
  });
  hooks.beforeEach(function () {
    vendor.requests.length = 0;
    configureOutbound({ devAllowlist: ['127.0.0.1', 'localhost'] });
  });
  hooks.afterEach(function () {
    resetOutbound();
  });

  test('a credential is filled into a header and the body at send time, and an echo of it comes back removed', async function (assert) {
    let response = await sendCallApiRequest(
      request({
        method: 'POST',
        url: `${vendor.url}/echo`,
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ key: TOKEN }),
      }),
      [{ token: TOKEN, value: SECRET }],
    );

    assert.strictEqual(response.status, 200);
    let received = vendor.requests[0];
    assert.strictEqual(received.headers.authorization, `Bearer ${SECRET}`);
    assert.strictEqual(received.body, JSON.stringify({ key: SECRET }));
    let answered = JSON.stringify(response.body);
    assert.false(
      answered.includes(SECRET),
      'the vendor echoed the credential and none of it reaches the caller',
    );
    assert.true(answered.includes(REDACTED));
  });

  test('a credential in the path fills one segment, and what is recorded is the request as declared', async function (assert) {
    let lines = await logLinesDuring(['outbound'], async () => {
      let response = await sendCallApiRequest(
        request({ url: `${vendor.url}/hooks/${TOKEN}` }),
        [{ token: TOKEN, value: 'a b?#' }],
      );
      assert.strictEqual(response.status, 404, "the vendor's 404 is an answer");
    });

    assert.strictEqual(
      vendor.requests[0].path,
      '/hooks/a%20b%3F%23',
      'the value is encoded as a single segment',
    );
    let sizeLine = lines.find((line) =>
      line.message.startsWith('outbound response size'),
    );
    assert.ok(sizeLine, 'the response size is recorded');
    assert.true(
      sizeLine!.message.includes(`/hooks/${TOKEN}`),
      'the recorded destination is the path as declared',
    );
    assert.false(sizeLine!.message.includes('a%20b'));
  });

  for (let value of ['a/b', '..\\admin', '..', '.']) {
    test(`a credential that would leave its path segment (${JSON.stringify(value)}) is refused, and nothing is sent`, async function (assert) {
      let refusal = await refusalOf(
        sendCallApiRequest(request({ url: `${vendor.url}/hooks/${TOKEN}` }), [
          { token: TOKEN, value },
        ]),
      );
      assert.strictEqual(refusal.error.code, 'guard-refused');
      assert.strictEqual(refusal.error.meta?.reason, 'invalid-url');
      assert.strictEqual(vendor.requests.length, 0);
    });
  }

  test('a credential in a query value may hold a path separator', async function (assert) {
    let response = await sendCallApiRequest(
      request({ url: `${vendor.url}/hooks?key=${TOKEN}` }),
      [{ token: TOKEN, value: 'a/b' }],
    );
    assert.strictEqual(response.status, 404, "the vendor's 404 is an answer");
    assert.strictEqual(vendor.requests[0].path, '/hooks?key=a%2Fb');
  });

  test('a filled request is not followed across a redirect to another origin', async function (assert) {
    let response = await sendCallApiRequest(
      request({
        url: `${vendor.url}/redirect?to=${encodeURIComponent(
          `${vendor.alternateUrl}/echo`,
        )}&status=307`,
        headers: { authorization: `Bearer ${TOKEN}` },
      }),
      [{ token: TOKEN, value: SECRET }],
    );

    assert.strictEqual(response.status, 307, 'the redirect is the answer');
    assert.strictEqual(
      response.headers.location,
      `${vendor.alternateUrl}/echo`,
    );
    assert.strictEqual(
      vendor.requests.length,
      1,
      'nothing reached the other origin',
    );
  });

  test('a filled request follows a redirect within its own origin', async function (assert) {
    let response = await sendCallApiRequest(
      request({
        url: `${vendor.url}/redirect?to=${encodeURIComponent(
          `${vendor.url}/echo`,
        )}&status=307`,
        headers: { authorization: `Bearer ${TOKEN}` },
      }),
      [{ token: TOKEN, value: SECRET }],
    );

    assert.strictEqual(response.status, 200);
    assert.strictEqual(vendor.requests.length, 2);
    assert.strictEqual(
      vendor.requests[1].headers.authorization,
      `Bearer ${SECRET}`,
    );
  });

  test("a keyless request follows any redirect, and a vendor's error status is an answer", async function (assert) {
    let redirected = await sendCallApiRequest(
      request({
        url: `${vendor.url}/redirect?to=${encodeURIComponent(
          `${vendor.alternateUrl}/status/500`,
        )}`,
      }),
      [],
    );
    assert.strictEqual(redirected.status, 500);
    assert.strictEqual(vendor.requests.length, 2);
  });

  test('only the headers that describe the body come back', async function (assert) {
    let response = await sendCallApiRequest(
      request({
        method: 'POST',
        url: `${vendor.url}/respond`,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          status: 200,
          headers: {
            'content-type': 'text/plain',
            'set-cookie': 'session=abc',
            server: 'vendor/1.2',
            'x-ratelimit-remaining': '41',
            etag: '"v1"',
          },
          chunks: ['plain text'],
        }),
      }),
      [],
    );

    assert.deepEqual(response.headers, {
      'content-type': 'text/plain',
      etag: '"v1"',
      'x-ratelimit-remaining': '41',
    });
    assert.strictEqual(response.body, 'plain text');
  });

  test('a destination the guard refuses is refused as guard-refused', async function (assert) {
    let refusal = await refusalOf(
      sendCallApiRequest(request({ url: 'https://10.0.0.1/items' }), []),
    );
    assert.strictEqual(refusal.error.code, 'guard-refused');
    assert.strictEqual(refusal.error.status, 502);
    assert.strictEqual(vendor.requests.length, 0);
  });

  test('a vendor that does not answer in time is refused as upstream-timeout', async function (assert) {
    configureOutbound({
      devAllowlist: ['127.0.0.1', 'localhost'],
      totalTimeoutMs: 200,
    });
    let refusal = await refusalOf(
      sendCallApiRequest(request({ url: `${vendor.url}/slow?ms=2000` }), []),
    );
    assert.strictEqual(refusal.error.code, 'upstream-timeout');
    assert.strictEqual(refusal.error.status, 504);
  });
});
