import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { RealmEventContent } from 'https://cardstack.com/base/matrix-event';
import {
  dispatchWorkerRequest,
  forwardWorkerRealmEvent,
  resolveWorkerRealmEventTarget,
} from '../lib/worker-request-forwarder.ts';
import {
  BROADCAST_REALM_EVENT,
  verifyWorkerRequest,
  WORKER_REQUEST_SIGNATURE_HEADER,
  WORKER_REQUEST_TIMESTAMP_HEADER,
  type WorkerRequestBody,
} from '@cardstack/runtime-common/worker-request';

const secret = "shhh! it's a secret";

// A mix of mapping shapes:
//   base        — URL-form, from != to (Realm.url is the `from`)
//   skills      — realm-prefix form, from is a bare string (Realm.url is the `to`)
//   experiments — URL-form, from == to
const urlMappings: [URL | string, URL][] = [
  [
    new URL('https://cardstack.com/base/'),
    new URL('https://app.example/base/'),
  ],
  ['@cardstack/skills/', new URL('https://app.example/skills/')],
  [
    new URL('https://app.example/experiments/'),
    new URL('https://app.example/experiments/'),
  ],
];

function incrementalEvent(realmURL: string): RealmEventContent {
  return {
    eventName: 'index',
    indexType: 'incremental',
    invalidations: [`${realmURL}Author/1.json`],
    realmURL,
  };
}

interface CapturedRequest {
  url: string;
  init: RequestInit;
}

function recordingFetch(
  responder: (attempt: number) => {
    status?: number;
    body?: string;
    throw?: unknown;
  },
): { fetch: typeof globalThis.fetch; calls: CapturedRequest[] } {
  let calls: CapturedRequest[] = [];
  let fetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), init: init ?? {} });
    let r = responder(calls.length);
    if (r.throw !== undefined) {
      throw r.throw;
    }
    return new Response(r.body ?? '', { status: r.status ?? 200 });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

const noSleep = async () => {};
const fixedNow = () => 1_700_000_000_000;

function bodyOf(call: CapturedRequest): WorkerRequestBody<RealmEventContent> {
  return JSON.parse(call.init.body as string);
}

module(basename(import.meta.filename), function () {
  module('resolveWorkerRealmEventTarget', function () {
    test('URL-form mapping (from != to): canonical realmURL is the `from`', function (assert) {
      let t = resolveWorkerRealmEventTarget(
        urlMappings,
        'https://cardstack.com/base/',
      );
      assert.strictEqual(t?.origin, 'https://app.example', 'reachable origin');
      assert.strictEqual(
        t?.realmURL,
        'https://cardstack.com/base/',
        'canonical (registry) realmURL is the from-url',
      );
    });

    test('URL-form mapping matched via the `to` still resolves to the canonical `from`', function (assert) {
      let t = resolveWorkerRealmEventTarget(
        urlMappings,
        'https://app.example/base/',
      );
      assert.strictEqual(t?.origin, 'https://app.example');
      assert.strictEqual(
        t?.realmURL,
        'https://cardstack.com/base/',
        'to-url is corrected to the canonical from-url',
      );
    });

    test('realm-prefix mapping: canonical realmURL is the `to`', function (assert) {
      let t = resolveWorkerRealmEventTarget(
        urlMappings,
        'https://app.example/skills/',
      );
      assert.strictEqual(t?.origin, 'https://app.example');
      assert.strictEqual(t?.realmURL, 'https://app.example/skills/');
    });

    test('canonicalizes a trailing-slash-less realmURL before matching', function (assert) {
      let t = resolveWorkerRealmEventTarget(
        urlMappings,
        'https://cardstack.com/base',
      );
      assert.strictEqual(
        t?.realmURL,
        'https://cardstack.com/base/',
        'missing trailing slash still resolves',
      );
    });

    test('returns undefined for an unmanaged realm', function (assert) {
      assert.strictEqual(
        resolveWorkerRealmEventTarget(
          urlMappings,
          'https://unmanaged.example/foo/',
        ),
        undefined,
      );
    });
  });

  module('forwardWorkerRealmEvent', function () {
    test('URL-form (from != to): POSTs to the to-origin and preserves the canonical from-realmURL', async function (assert) {
      let { fetch, calls } = recordingFetch(() => ({
        status: 200,
        body: JSON.stringify({ ok: true }),
      }));

      let delivered = await forwardWorkerRealmEvent({
        event: incrementalEvent('https://cardstack.com/base/'),
        urlMappings,
        secret,
        fetch,
        now: fixedNow,
        sleep: noSleep,
      });

      assert.true(delivered, 'reports delivery');
      assert.strictEqual(calls.length, 1, 'one HTTP call');
      let call = calls[0];
      assert.strictEqual(
        call.url,
        'https://app.example/_worker-request',
        'posts to the to-origin root, not under the realm path',
      );
      assert.strictEqual((call.init.method || '').toUpperCase(), 'POST');

      let headers = call.init.headers as Record<string, string>;
      let rawBody = call.init.body as string;
      let auth = verifyWorkerRequest({
        secret,
        timestamp: headers[WORKER_REQUEST_TIMESTAMP_HEADER],
        signature: headers[WORKER_REQUEST_SIGNATURE_HEADER],
        rawBody,
        now: fixedNow(),
      });
      assert.true(auth.ok, 'the forwarded request carries a valid signature');

      let body = bodyOf(call);
      assert.strictEqual(body.type, BROADCAST_REALM_EVENT, 'envelope type');
      assert.strictEqual(
        body.payload.realmURL,
        'https://cardstack.com/base/',
        'canonical from-realmURL preserved (not rewritten to the to-url)',
      );
    });

    test('a to-form realmURL is normalized to the canonical from-url before sending', async function (assert) {
      let { fetch, calls } = recordingFetch(() => ({ status: 200 }));

      let delivered = await forwardWorkerRealmEvent({
        event: incrementalEvent('https://app.example/base/'),
        urlMappings,
        secret,
        fetch,
        now: fixedNow,
        sleep: noSleep,
      });

      assert.true(delivered);
      assert.strictEqual(
        bodyOf(calls[0]).payload.realmURL,
        'https://cardstack.com/base/',
        'realmURL rewritten to the canonical url the endpoint resolves by',
      );
    });

    test('drops an event for an unmanaged realm without any HTTP call', async function (assert) {
      let { fetch, calls } = recordingFetch(() => ({ status: 200 }));

      let delivered = await forwardWorkerRealmEvent({
        event: incrementalEvent('https://unmanaged.example/foo/'),
        urlMappings,
        secret,
        fetch,
        now: fixedNow,
        sleep: noSleep,
      });

      assert.false(delivered, 'reports non-delivery');
      assert.strictEqual(calls.length, 0, 'no HTTP call made');
    });

    test('retries on a 5xx and succeeds', async function (assert) {
      let { fetch, calls } = recordingFetch((attempt) =>
        attempt < 3 ? { status: 503 } : { status: 200 },
      );

      let delivered = await forwardWorkerRealmEvent({
        event: incrementalEvent('https://app.example/experiments/'),
        urlMappings,
        secret,
        fetch,
        now: fixedNow,
        sleep: noSleep,
      });

      assert.true(delivered, 'eventually delivered');
      assert.strictEqual(calls.length, 3, 'retried until success');
    });

    test('retries on a network error (thrown fetch) and succeeds', async function (assert) {
      let { fetch, calls } = recordingFetch((attempt) =>
        attempt < 2 ? { throw: new Error('ECONNRESET') } : { status: 200 },
      );

      let delivered = await forwardWorkerRealmEvent({
        event: incrementalEvent('https://app.example/experiments/'),
        urlMappings,
        secret,
        fetch,
        now: fixedNow,
        sleep: noSleep,
      });

      assert.true(delivered, 'delivered after a transport error');
      assert.strictEqual(calls.length, 2, 'retried past the thrown fetch');
    });

    test('does not retry a 4xx (auth/bad-request) and reports non-delivery', async function (assert) {
      let { fetch, calls } = recordingFetch(() => ({ status: 401 }));

      let delivered = await forwardWorkerRealmEvent({
        event: incrementalEvent('https://app.example/experiments/'),
        urlMappings,
        secret,
        fetch,
        now: fixedNow,
        sleep: noSleep,
      });

      assert.false(delivered, 'not delivered');
      assert.strictEqual(calls.length, 1, '4xx is terminal — no retry');
    });

    test('gives up after the max attempts on persistent 5xx', async function (assert) {
      let { fetch, calls } = recordingFetch(() => ({ status: 500 }));

      let delivered = await forwardWorkerRealmEvent({
        event: incrementalEvent('https://app.example/experiments/'),
        urlMappings,
        secret,
        fetch,
        now: fixedNow,
        sleep: noSleep,
      });

      assert.false(delivered, 'not delivered');
      assert.strictEqual(calls.length, 3, 'stops after the attempt cap');
    });
  });

  module('dispatchWorkerRequest', function () {
    test('routes a broadcast-realm-event request to the forwarder', async function (assert) {
      let { fetch, calls } = recordingFetch(() => ({ status: 200 }));

      let delivered = await dispatchWorkerRequest(
        {
          type: BROADCAST_REALM_EVENT,
          payload: incrementalEvent('https://cardstack.com/base/'),
        },
        { urlMappings, secret, fetch },
      );

      assert.true(delivered, 'dispatched and forwarded');
      assert.strictEqual(calls.length, 1, 'one HTTP call via the forwarder');
      assert.strictEqual(calls[0].url, 'https://app.example/_worker-request');
    });

    test('ignores an unknown request type without any HTTP call', async function (assert) {
      let { fetch, calls } = recordingFetch(() => ({ status: 200 }));

      let delivered = await dispatchWorkerRequest(
        { type: 'not-a-real-type', payload: {} },
        { urlMappings, secret, fetch },
      );

      assert.false(delivered, 'unknown type reports non-delivery');
      assert.strictEqual(calls.length, 0, 'no HTTP call for an unknown type');
    });
  });
});
