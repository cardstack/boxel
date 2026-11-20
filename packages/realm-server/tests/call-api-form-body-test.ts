import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  OperationFailure,
  type OperationCallApi,
} from '@cardstack/runtime-common/card-operations';
import {
  buildCallApiRequest,
  callApiReadsActor,
  encodeFormBody,
  type CallApiValues,
} from '@cardstack/runtime-common/card-operations/call-api';
import { lowerCallApiRequest } from '@cardstack/runtime-common/card-operations/lowering';

// A `callApi` whose body is a form: lowered from the declaration as indexing
// lowers it, then built at invocation into the request the realm server sends.
// Nothing here is sent; the request as built is the subject.

function lower(
  form: unknown,
  rest: Record<string, unknown> = {},
  params: string[] = [],
): OperationCallApi {
  let issues: string[] = [];
  let lowered = lowerCallApiRequest(
    { url: 'https://api.example.com/v1/messages', form, ...rest },
    new Set(params),
    {
      add: (code, path, message) => issues.push(`${code} ${path}: ${message}`),
    },
  );
  if (!lowered) {
    throw new Error(`expected the request to lower: ${issues.join('; ')}`);
  }
  return lowered;
}

function values(overrides: Partial<CallApiValues> = {}): CallApiValues {
  return {
    params: {},
    actor: '@tester:localhost',
    realmConfig: async () => ({}),
    ...overrides,
  };
}

function pairs(body: string | undefined): [string, string][] {
  return [...new URLSearchParams(body ?? '')];
}

module(basename(import.meta.filename), function () {
  test('a form body is sent form-encoded, with the content type that says so', async function (assert) {
    let request = lower(
      { To: { $ref: 'params', key: 'to' }, Body: 'Your code is 4 & 2' },
      {},
      ['to'],
    );
    assert.strictEqual(request.method, 'POST', 'a body makes it a POST');
    let built = await buildCallApiRequest(
      'sms',
      request,
      values({ params: { to: '+15551234567' } }),
    );
    assert.strictEqual(
      built.body,
      'Body=Your+code+is+4+%26+2&To=%2B15551234567',
    );
    assert.strictEqual(built.bodyEncoding, 'form');
    assert.strictEqual(
      built.headers['content-type'],
      'application/x-www-form-urlencoded',
    );
  });

  test('a content type the declaration sets is kept', async function (assert) {
    let built = await buildCallApiRequest(
      'sms',
      lower(
        { To: 'x' },
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
          },
        },
      ),
      values(),
    );
    assert.deepEqual(built.headers, {
      'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
    });
  });

  test('a JSON body still goes out as JSON', async function (assert) {
    let issues: string[] = [];
    let request = lowerCallApiRequest(
      { url: 'https://api.example.com/v1/messages', json: { To: 'x' } },
      new Set(),
      { add: (code) => issues.push(code) },
    );
    let built = await buildCallApiRequest('sms', request!, values());
    assert.deepEqual(issues, []);
    assert.strictEqual(built.body, '{"To":"x"}');
    assert.strictEqual(built.bodyEncoding, 'json');
    assert.strictEqual(built.headers['content-type'], 'application/json');
  });

  test('objects and lists are named with brackets; a field that is a list of text repeats its name, and every nested list is numbered', async function (assert) {
    let request = lower(
      {
        mode: 'payment',
        quantity: 2,
        livemode: false,
        MediaUrl: { $ref: 'params', key: 'images' },
        'expand[]': ['line_items', 'customer'],
        metadata: { order: { $ref: 'params', key: 'order' }, note: null },
        line_items: { $ref: 'params', key: 'lines' },
        subscription_data: { 'default_tax_rates[]': ['txr_1'] },
        nested: [['a', 'b'], ['c']],
        empty: [],
        none: {},
      },
      {},
      ['images', 'order', 'lines'],
    );
    let built = await buildCallApiRequest(
      'checkout',
      request,
      values({
        params: {
          images: ['https://img.example/1.png', 'https://img.example/2.png'],
          order: 'ord_7',
          lines: [
            { price: 'price_A', quantity: 1, tax_rates: ['txr_1', 'txr_2'] },
            { price: 'price_B', quantity: 3 },
          ],
        },
      }),
    );
    assert.deepEqual(pairs(built.body), [
      ['MediaUrl', 'https://img.example/1.png'],
      ['MediaUrl', 'https://img.example/2.png'],
      ['expand[]', 'line_items'],
      ['expand[]', 'customer'],
      ['line_items[0][price]', 'price_A'],
      ['line_items[0][quantity]', '1'],
      ['line_items[0][tax_rates][0]', 'txr_1'],
      ['line_items[0][tax_rates][1]', 'txr_2'],
      ['line_items[1][price]', 'price_B'],
      ['line_items[1][quantity]', '3'],
      ['livemode', 'false'],
      ['metadata[order]', 'ord_7'],
      ['mode', 'payment'],
      ['nested[0][0]', 'a'],
      ['nested[0][1]', 'b'],
      ['nested[1][0]', 'c'],
      ['quantity', '2'],
      ['subscription_data[default_tax_rates][]', 'txr_1'],
    ]);
  });

  test('members go out in the order of their names, whatever order they are declared or stored in', async function (assert) {
    let declared = lower({
      To: 'x',
      Body: 'y',
      metadata: { order: 'o', buyer: 'b' },
    });
    let stored = lower({
      metadata: { buyer: 'b', order: 'o' },
      Body: 'y',
      To: 'x',
    });
    let [one, other] = await Promise.all(
      [declared, stored].map((request) =>
        buildCallApiRequest('sms', request, values()),
      ),
    );
    assert.strictEqual(
      one.body,
      'Body=y&To=x&metadata%5Bbuyer%5D=b&metadata%5Border%5D=o',
    );
    assert.strictEqual(other.body, one.body);
  });

  test('a value that is null or missing is left out', async function (assert) {
    let built = await buildCallApiRequest(
      'sms',
      lower(
        { To: 'x', StatusCallback: { $ref: 'params', key: 'callback' } },
        {},
        ['callback'],
      ),
      values({ params: { callback: null } }),
    );
    assert.strictEqual(built.body, 'To=x');
  });

  test('a slot in a form value is a token in the request as built, and the slot says where it stands', async function (assert) {
    let request = lower({ To: 'x', ApiKey: '{{apiKey}}' });
    assert.deepEqual(request.slots, [
      { name: 'apiKey', key: 'apiKey', placement: 'body', at: 'form.ApiKey' },
    ]);
    let built = await buildCallApiRequest('sms', request, values());
    let [slot] = built.slots;
    assert.strictEqual(built.body, `ApiKey=${slot.token}&To=x`);
    assert.false(
      built.body!.includes('apiKey'),
      'the slot text itself is not sent',
    );
  });

  test('a form value that reads the caller is filled from the caller, and needs one', async function (assert) {
    let request = lower({ From: { $ref: 'actor' } });
    assert.true(
      callApiReadsActor(request),
      'the operation is recorded as reading the caller',
    );
    let built = await buildCallApiRequest('sms', request, values());
    assert.strictEqual(built.body, 'From=%40tester%3Alocalhost');

    try {
      await buildCallApiRequest('sms', request, values({ actor: undefined }));
      assert.ok(false, 'expected an anonymous caller to be refused');
    } catch (error) {
      assert.true(error instanceof OperationFailure);
      assert.strictEqual(
        (error as OperationFailure).error.code,
        'actor-required',
      );
    }

    assert.false(
      callApiReadsActor(lower({ From: 'shop' })),
      'a form that reads nobody does not',
    );
    assert.true(
      callApiReadsActor(lower({ meta: [{ by: { $ref: 'actor' } }] })),
      'a nested read counts',
    );
  });

  test('encodeFormBody leaves a slot token as it is', async function (assert) {
    let token = 'boxel_slot_0_0123456789abcdef';
    assert.strictEqual(
      encodeFormBody({ key: token, list: [token] }),
      `key=${token}&list=${token}`,
    );
  });
});
