import QUnit from 'qunit';
const { module, test } = QUnit;
import * as Sentry from '@sentry/node';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { basename } from 'path';
import Koa from 'koa';
import { WORKER_REQUEST_SIGNATURE_HEADER } from '@cardstack/runtime-common/worker-request';
import { DELEGATED_USER_REALM_SESSION_SIGNATURE_HEADER } from '@cardstack/runtime-common/user-delegated-realm-server-session';
import {
  isCredentialHeader,
  scrubRequestTelemetry,
} from '../lib/request-telemetry.ts';
import { httpLogging } from '../middleware/index.ts';
import {
  startSentryCapture,
  type SentryCapture,
} from './helpers/sentry-capture.ts';
import { logLinesDuring, withLogDefinition } from './helpers/log-capture.ts';

module(basename(import.meta.filename), function () {
  module('an event raised during an ordinary request', function (hooks) {
    let sentry: SentryCapture | undefined;
    let server: http.Server | undefined;

    hooks.afterEach(async function () {
      await sentry?.stop();
      sentry = undefined;
      await new Promise<void>((resolve) => {
        if (server) {
          server.close(() => resolve());
        } else {
          resolve();
        }
      });
      server = undefined;
    });

    // A server whose one handler reads the body and then reports an error,
    // as a realm-server handler that fails does.
    async function startFailingServer(): Promise<string> {
      // Awaits the body the way a Koa handler does, so the error is raised in
      // the request's async context rather than in an emitter callback.
      server = http.createServer(async (req, res) => {
        let body = '';
        await new Promise<void>((resolve) => {
          req.on('data', (chunk) => (body += chunk));
          req.on('end', () => resolve());
        });
        Sentry.captureException(new Error('handler failed'));
        res.statusCode = 500;
        res.end();
      });
      await new Promise<void>((resolve) => server!.listen(0, resolve));
      return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
    }

    test('keeps its request context apart from the Authorization header and cookies', async function (assert) {
      sentry = startSentryCapture({ tracing: false, incomingRequests: true });
      let origin = await startFailingServer();
      let response = await fetch(`${origin}/test/card?filter=kept`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer session-token-3e8f51',
          cookie: 'session=cookie-marker-c27d04',
          'content-type': 'application/json',
          'x-boxel-client-request-id': 'request-id-kept',
        },
        body: JSON.stringify({ attributes: { title: 'body-kept' } }),
      });
      let sent = await sentry.flushed();
      let events = await sentry.flushedEvents();

      assert.strictEqual(response.status, 500);
      assert.strictEqual(events.length, 1, 'the error reached Sentry');
      let recorded = events[0].request as {
        method?: string;
        url?: string;
        query_string?: unknown;
        data?: unknown;
        headers?: Record<string, string>;
        cookies?: unknown;
      };
      assert.strictEqual(recorded.method, 'POST');
      assert.strictEqual(new URL(recorded.url!).pathname, '/test/card');
      assert.true(
        JSON.stringify(recorded.query_string).includes('filter=kept'),
        'the query string is kept',
      );
      assert.true(
        JSON.stringify(recorded.data).includes('body-kept'),
        'the body is kept',
      );
      assert.strictEqual(
        recorded.headers?.['x-boxel-client-request-id'],
        'request-id-kept',
        'other headers are kept',
      );
      assert.false(
        'authorization' in (recorded.headers ?? {}),
        'the Authorization header is dropped',
      );
      assert.false(
        'cookie' in (recorded.headers ?? {}),
        'the Cookie header is dropped',
      );
      assert.false('cookies' in recorded, 'the parsed cookies are dropped');
      assert.false(
        sent.includes('session-token-3e8f51'),
        'no envelope carries the session token',
      );
      assert.false(
        sent.includes('cookie-marker-c27d04'),
        'no envelope carries the cookie',
      );
    });
  });

  module('the request log at debug', function (hooks) {
    let sentry: SentryCapture | undefined;
    let server: http.Server | undefined;

    hooks.afterEach(async function () {
      await sentry?.stop();
      sentry = undefined;
      await new Promise<void>((resolve) => {
        if (server) {
          server.close(() => resolve());
        } else {
          resolve();
        }
      });
      server = undefined;
    });

    // A server running the request log, whose handler reports an error once
    // the response has finished. The request log writes its header line when
    // the response finishes, so an event raised after that, still within the
    // request, carries the line as a breadcrumb.
    async function startLoggedServer(): Promise<string> {
      let app = new Koa();
      app.use(httpLogging);
      app.use(async (ctxt) => {
        ctxt.res.on('finish', () => {
          Sentry.captureException(new Error('failed after the response'));
        });
        ctxt.status = 200;
        ctxt.body = 'ok';
      });
      server = http.createServer(app.callback());
      await new Promise<void>((resolve) => server!.listen(0, resolve));
      return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
    }

    const credentials = {
      authorization: 'Bearer session-jwt-91d4c7',
      'proxy-authorization': 'Basic proxy-credential-0b6e2f',
      cookie: 'session=cookie-marker-5a7f13',
      'set-cookie': 'session=set-cookie-marker-e40c88',
      [WORKER_REQUEST_SIGNATURE_HEADER]: 'worker-signature-6c2d90',
      [DELEGATED_USER_REALM_SESSION_SIGNATURE_HEADER]:
        'delegation-signature-3f81ab',
    };

    test('keeps credential header values out of the log and Sentry', async function (assert) {
      sentry = startSentryCapture({ tracing: false, incomingRequests: true });
      let origin = await startLoggedServer();
      let response: Response | undefined;
      let lines = await withLogDefinition('realm:requests', 'debug', () =>
        logLinesDuring(['realm:requests'], async () => {
          response = await fetch(`${origin}/test/card`, {
            headers: {
              ...credentials,
              'x-boxel-client-request-id': 'request-id-kept-72e9d5',
            },
          });
          await response.text();
        }),
      );
      let sent = await sentry.flushed();
      let events = await sentry.flushedEvents();

      assert.strictEqual(response!.status, 200);
      let headerLine = lines.find(
        (line) =>
          line.level === 'debug' &&
          line.message.includes('request-id-kept-72e9d5'),
      );
      assert.ok(headerLine, 'the debug line lists the request headers');
      let logged = JSON.parse(headerLine!.message) as Record<string, string>;
      for (let name of Object.keys(credentials)) {
        assert.strictEqual(
          logged[name],
          'REDACTED',
          `the debug line names ${name} with its value masked`,
        );
      }
      assert.strictEqual(
        logged['x-boxel-client-request-id'],
        'request-id-kept-72e9d5',
        'the debug line keeps the other headers',
      );

      assert.strictEqual(events.length, 1, 'the error reached Sentry');
      let breadcrumbs = (events[0].breadcrumbs ?? []) as { message?: string }[];
      assert.true(
        breadcrumbs.some((crumb) =>
          crumb.message?.includes('"x-boxel-client-request-id"'),
        ),
        'precondition: the event carries the debug line as a breadcrumb',
      );
      for (let [name, value] of Object.entries(credentials)) {
        let secret = value.split(/[ =]/).pop()!;
        assert.false(
          lines.some((line) => line.message.includes(secret)),
          `no log line carries the ${name} value`,
        );
        assert.false(
          sent.includes(secret),
          `no envelope carries the ${name} value`,
        );
      }
    });
  });

  module('scrubRequestTelemetry', function () {
    test('the request-signature headers are credential headers', function (assert) {
      assert.true(isCredentialHeader(WORKER_REQUEST_SIGNATURE_HEADER));
      assert.true(
        isCredentialHeader(DELEGATED_USER_REALM_SESSION_SIGNATURE_HEADER),
      );
      assert.true(isCredentialHeader('Set-Cookie'));
      assert.false(isCredentialHeader('x-boxel-client-request-id'));
    });

    test('a proxy route is recognised with a trailing slash', function (assert) {
      let event = scrubRequestTelemetry({
        request: {
          method: 'POST',
          url: 'https://app.telemetry.test/_openrouter/chat/completions/?a=b',
          headers: { host: 'app.telemetry.test' },
          data: '{"messages":[]}',
        },
      });
      assert.deepEqual(event.request as unknown, {
        method: 'POST',
        url: 'https://app.telemetry.test/_openrouter/chat/completions/',
      });
    });

    test('a path that only starts with a proxy route keeps its context', function (assert) {
      let event = scrubRequestTelemetry({
        request: {
          method: 'GET',
          url: 'https://app.telemetry.test/_request-forward-status',
          query_string: 'a=b',
        },
      });
      assert.deepEqual(event.request as unknown, {
        method: 'GET',
        url: 'https://app.telemetry.test/_request-forward-status',
        query_string: 'a=b',
      });
    });

    test('credential headers are dropped whatever their case', function (assert) {
      let event = scrubRequestTelemetry({
        request: {
          method: 'GET',
          url: 'https://app.telemetry.test/test/card',
          headers: {
            Authorization: 'Bearer a',
            'Proxy-Authorization': 'Basic b',
            Cookie: 'c=d',
            Accept: 'application/json',
          },
          cookies: { c: 'd' },
        },
      });
      assert.deepEqual(event.request as unknown, {
        method: 'GET',
        url: 'https://app.telemetry.test/test/card',
        headers: { Accept: 'application/json' },
      });
    });

    test('a proxy route is recognised whatever its case', function (assert) {
      let event = scrubRequestTelemetry({
        request: {
          method: 'POST',
          url: 'https://app.telemetry.test/_Request-Forward?a=b',
          headers: { authorization: 'Bearer a', accept: '*/*' },
        },
      });
      assert.deepEqual(event.request as unknown, {
        method: 'POST',
        url: 'https://app.telemetry.test/_Request-Forward',
      });
    });

    test('a token query parameter is masked on an ordinary route', function (assert) {
      let event = scrubRequestTelemetry({
        request: {
          method: 'GET',
          url: 'https://app.telemetry.test/_download-realm?realm=r&token=session-jwt',
          query_string: 'realm=r&token=session-jwt',
        },
      });
      assert.deepEqual(event.request as unknown, {
        method: 'GET',
        url: 'https://app.telemetry.test/_download-realm?realm=r&token=REDACTED',
        query_string: 'realm=r&token=REDACTED',
      });
    });

    test("a breadcrumb loses a proxy route's query string", function (assert) {
      let line =
        '<-- POST */* https://app.telemetry.test/_request-forward/?caller=marker [job: 1]';
      let event = scrubRequestTelemetry({
        breadcrumbs: [
          {
            message: line,
            data: { arguments: [line], logger: 'console' },
          },
          { message: 'GET https://app.telemetry.test/test/card?filter=kept' },
        ],
      });
      let scrubbed =
        '<-- POST */* https://app.telemetry.test/_request-forward/ [job: 1]';
      assert.deepEqual(event.breadcrumbs, [
        {
          message: scrubbed,
          data: { arguments: [scrubbed], logger: 'console' },
        },
        { message: 'GET https://app.telemetry.test/test/card?filter=kept' },
      ]);
    });

    test('an event with no request is left alone', function (assert) {
      let event: { message: string; request?: undefined } = {
        message: 'no request',
      };
      assert.deepEqual(scrubRequestTelemetry(event), { message: 'no request' });
    });
  });
});
