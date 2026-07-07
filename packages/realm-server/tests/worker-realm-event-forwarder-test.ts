import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { RealmEventContent } from 'https://cardstack.com/base/matrix-event';
import {
  forwardWorkerRealmEvent,
  resolveWorkerRealmEventTarget,
} from '../lib/worker-realm-event-forwarder.ts';
import {
  verifyWorkerRealmEventRequest,
  WORKER_REALM_EVENT_SIGNATURE_HEADER,
  WORKER_REALM_EVENT_TIMESTAMP_HEADER,
} from '@cardstack/runtime-common/worker-realm-event';

const secret = "shhh! it's a secret";

// from is the URL-form alias, to is the realm-server-reachable canonical url.
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
  responder: (attempt: number) => { status: number; body?: string },
): { fetch: typeof globalThis.fetch; calls: CapturedRequest[] } {
  let calls: CapturedRequest[] = [];
  let fetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), init: init ?? {} });
    let { status, body } = responder(calls.length);
    return new Response(body ?? '', { status });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

const noSleep = async () => {};
const fixedNow = () => 1_700_000_000_000;

module(basename(import.meta.filename), function () {
  module('resolveWorkerRealmEventTarget', function () {
    test('matches the canonical (to) realm url', function (assert) {
      let target = resolveWorkerRealmEventTarget(
        urlMappings,
        'https://app.example/base/',
      );
      assert.strictEqual(target?.href, 'https://app.example/base/');
    });

    test('matches a URL-form (from) alias and returns the canonical to url', function (assert) {
      let target = resolveWorkerRealmEventTarget(
        urlMappings,
        'https://cardstack.com/base/',
      );
      assert.strictEqual(
        target?.href,
        'https://app.example/base/',
        'returns the to-url, not the from-url',
      );
    });

    test('returns undefined for an unmanaged realm', function (assert) {
      let target = resolveWorkerRealmEventTarget(
        urlMappings,
        'https://unmanaged.example/foo/',
      );
      assert.strictEqual(target, undefined);
    });
  });

  module('forwardWorkerRealmEvent', function () {
    test('POSTs a signed request to <to.origin>/_worker-event and returns true on 200', async function (assert) {
      let { fetch, calls } = recordingFetch(() => ({
        status: 200,
        body: JSON.stringify({ ok: true }),
      }));

      let delivered = await forwardWorkerRealmEvent({
        event: incrementalEvent('https://app.example/base/'),
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
        'https://app.example/_worker-event',
        'posts to the server origin root, not under the realm path',
      );
      assert.strictEqual((call.init.method || '').toUpperCase(), 'POST');

      let headers = call.init.headers as Record<string, string>;
      let rawBody = call.init.body as string;
      let auth = verifyWorkerRealmEventRequest({
        secret,
        timestamp: headers[WORKER_REALM_EVENT_TIMESTAMP_HEADER],
        signature: headers[WORKER_REALM_EVENT_SIGNATURE_HEADER],
        rawBody,
        now: fixedNow(),
      });
      assert.true(auth.ok, 'the forwarded request carries a valid signature');

      let sent = JSON.parse(rawBody) as { event: RealmEventContent };
      assert.strictEqual(
        sent.event.realmURL,
        'https://app.example/base/',
        'event realmURL is the canonical realm url',
      );
    });

    test('normalizes a from-aliased realmURL to the canonical url before sending', async function (assert) {
      let { fetch, calls } = recordingFetch(() => ({ status: 200 }));

      let delivered = await forwardWorkerRealmEvent({
        event: incrementalEvent('https://cardstack.com/base/'),
        urlMappings,
        secret,
        fetch,
        now: fixedNow,
        sleep: noSleep,
      });

      assert.true(delivered);
      let sent = JSON.parse(calls[0].init.body as string) as {
        event: RealmEventContent;
      };
      assert.strictEqual(
        sent.event.realmURL,
        'https://app.example/base/',
        'realmURL rewritten to the canonical to-url the endpoint can resolve',
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
        event: incrementalEvent('https://app.example/base/'),
        urlMappings,
        secret,
        fetch,
        now: fixedNow,
        sleep: noSleep,
      });

      assert.true(delivered, 'eventually delivered');
      assert.strictEqual(calls.length, 3, 'retried until success');
    });

    test('does not retry a 4xx (auth/bad-request) and reports non-delivery', async function (assert) {
      let { fetch, calls } = recordingFetch(() => ({ status: 401 }));

      let delivered = await forwardWorkerRealmEvent({
        event: incrementalEvent('https://app.example/base/'),
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
        event: incrementalEvent('https://app.example/base/'),
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
});
