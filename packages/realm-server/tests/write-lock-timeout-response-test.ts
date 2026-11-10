import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import http from 'http';
import net from 'net';
import Koa from 'koa';
import {
  CardError,
  SupportedMimeType,
  type RequestContext,
  type Realm,
} from '@cardstack/runtime-common';
import {
  responseWithError,
  systemError,
} from '@cardstack/runtime-common/error';
import {
  OperationFailure,
  WRITE_LOCK_RETRY_AFTER_SECONDS,
  WriteLockTimeoutError,
} from '@cardstack/runtime-common/card-operations';
import { Router } from '@cardstack/runtime-common/router';
import { sendResponseForSystemError } from '../middleware/index.ts';

// How a write that gave up waiting for its write locks is answered over HTTP.
// The adapter raises `WriteLockTimeoutError`; every surface a write reaches the
// client through has to turn it into a 503 that says when to retry, rather
// than a 500 that reads as the realm being broken. The adapter's own behavior
// is covered in realm-advisory-locks-test.ts; these pin the answers.

const REALM = 'http://localhost:4201/test/';

// `responseWithError` and `createResponse` read only the realm's url and
// permissions off the context.
function requestContext(): RequestContext {
  return {
    realm: { url: REALM } as Realm,
    permissions: { '*': ['read'] },
  };
}

function koaContext(): Koa.Context {
  let req = new http.IncomingMessage(new net.Socket());
  req.method = 'POST';
  req.url = '/_create-realm';
  req.headers = { host: 'localhost:4201' };
  let res = new http.ServerResponse(req);
  return new Koa().createContext(req, res) as Koa.Context;
}

module(basename(import.meta.filename), function () {
  module('responseWithError', function () {
    test('a 503 carrying retryAfterSeconds names it in Retry-After', function (assert) {
      let error = new CardError('busy', { status: 503 });
      error.meta = { retryAfterSeconds: 7 };
      let response = responseWithError(error, requestContext());
      assert.strictEqual(response.status, 503);
      assert.strictEqual(response.headers.get('Retry-After'), '7');
    });

    test('an error with no retryAfterSeconds sends no Retry-After', function (assert) {
      let response = responseWithError(
        new CardError('busy', { status: 503 }),
        requestContext(),
      );
      assert.strictEqual(response.headers.get('Retry-After'), null);
    });

    test('a status that is not retryable sends no Retry-After', function (assert) {
      let error = new CardError('broken', { status: 500 });
      error.meta = { retryAfterSeconds: 7 };
      let response = responseWithError(error, requestContext());
      assert.strictEqual(response.headers.get('Retry-After'), null);
    });
  });

  test('systemError carries meta through to Retry-After', function (assert) {
    let response = systemError({
      requestContext: requestContext(),
      message: 'busy',
      status: 503,
      meta: { retryAfterSeconds: 3 },
    });
    assert.strictEqual(response.status, 503);
    assert.strictEqual(response.headers.get('Retry-After'), '3');
  });

  module('the realm router', function () {
    async function answer(thrown: unknown): Promise<Response> {
      let router = new Router(new URL(REALM));
      let request = new Request(`${REALM}thing`, { method: 'POST' });
      return await router.handle(request, requestContext(), {
        handler: async () => {
          throw thrown;
        },
      } as unknown as Parameters<Router['handle']>[2]);
    }

    test('answers a write-lock timeout as 503 with Retry-After', async function (assert) {
      let response = await answer(new WriteLockTimeoutError(REALM, 60_000));
      assert.strictEqual(response.status, 503);
      assert.strictEqual(
        response.headers.get('Retry-After'),
        String(WRITE_LOCK_RETRY_AFTER_SECONDS),
      );
    });

    test('still answers any other refusal as an unexpected exception', async function (assert) {
      let response = await answer(
        new OperationFailure({
          status: 500,
          code: 'internal-error',
          title: 'Internal error',
          detail: 'executor failed',
        }),
      );
      assert.strictEqual(response.status, 500);
      assert.strictEqual(response.headers.get('Retry-After'), null);
    });
  });

  module('sendResponseForSystemError', function () {
    test('answers a write-lock timeout as 503 with Retry-After', async function (assert) {
      let ctxt = koaContext();
      await sendResponseForSystemError(
        ctxt,
        'could not publish',
        new WriteLockTimeoutError(REALM, 60_000),
      );
      assert.strictEqual(ctxt.status, 503);
      assert.strictEqual(
        ctxt.response.get('Retry-After'),
        String(WRITE_LOCK_RETRY_AFTER_SECONDS),
      );
      assert.strictEqual(
        ctxt.response.get('content-type'),
        SupportedMimeType.JSONAPI,
      );
    });

    test('answers any other cause as a 500', async function (assert) {
      let ctxt = koaContext();
      await sendResponseForSystemError(
        ctxt,
        'could not publish',
        new Error('disk full'),
      );
      assert.strictEqual(ctxt.status, 500);
      assert.strictEqual(ctxt.response.get('Retry-After'), '');
    });
  });
});
