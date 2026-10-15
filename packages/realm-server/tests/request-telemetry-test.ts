import QUnit from 'qunit';
const { module, test } = QUnit;
import * as Sentry from '@sentry/node';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { basename } from 'path';
import {
  registerSecureOriginHost,
  scrubRequestTelemetry,
} from '../lib/request-telemetry.ts';
import {
  startSentryCapture,
  type SentryCapture,
} from './helpers/sentry-capture.ts';

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

  module('a transaction for an ordinary request', function (hooks) {
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

    test('masks a token query parameter in its span data and keeps its route, method, status and timing', async function (assert) {
      sentry = startSentryCapture({ tracing: true, incomingRequests: true });
      server = http.createServer((_req, res) => {
        res.statusCode = 200;
        res.end('ok');
      });
      await new Promise<void>((resolve) => server!.listen(0, resolve));
      let origin = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
      let token = 'session-jwt-marker-61b0d2';
      let response = await fetch(
        `${origin}/_download-realm?realm=kept&token=${token}`,
      );
      await response.text();
      let sent = await sentry.flushed();
      let transactions = await sentry.flushedTransactions();

      assert.strictEqual(response.status, 200);
      let transaction = transactions.find(
        (t) => t.transaction === 'GET /_download-realm',
      );
      assert.ok(transaction, 'the request was recorded as a transaction');
      let contexts = transaction!.contexts as {
        trace: { data: Record<string, unknown>; status?: string };
        response?: { status_code?: number };
      };
      let data = contexts.trace.data;
      assert.strictEqual(data['http.method'], 'GET', 'the method is kept');
      assert.strictEqual(
        data['http.target'],
        '/_download-realm?realm=kept&token=REDACTED',
        'the target keeps its query with the token masked',
      );
      assert.strictEqual(
        data['http.url'],
        `${origin}/_download-realm?realm=kept&token=REDACTED`,
        'the URL keeps its query with the token masked',
      );
      assert.strictEqual(
        data['http.query'],
        'realm=kept&token=REDACTED',
        'the query keeps its other parameters',
      );
      assert.strictEqual(
        contexts.response?.status_code,
        200,
        'the status is kept',
      );
      assert.strictEqual(typeof transaction!.start_timestamp, 'number');
      assert.strictEqual(typeof transaction!.timestamp, 'number');
      assert.false(sent.includes(token), 'no envelope carries the token');
    });
  });

  module('scrubRequestTelemetry', function () {
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

    test('a key route keeps only its method and path, whatever its case and however deep', function (assert) {
      for (let url of [
        'https://app.telemetry.test/_user-keys',
        'https://app.telemetry.test/_user-keys/',
        'https://app.telemetry.test/_user-keys/3f0e8f4a-8d6b-4c55-9b6f-0d7e0c3f9a11',
        'https://app.telemetry.test/_USER-KEYS/3f0e8f4a-8d6b-4c55-9b6f-0d7e0c3f9a11',
        'https://app.telemetry.test/_key-write-tickets',
      ]) {
        let event = scrubRequestTelemetry({
          request: {
            method: 'POST',
            url: `${url}?a=b`,
            headers: {
              host: 'app.telemetry.test',
              'x-other': 'kept elsewhere',
            },
            data: '{"data":{"attributes":{"value":"sk-value-marker"}},"meta":{"ticket":"ticket-marker"}}',
            query_string: 'a=b',
          },
        });
        assert.deepEqual(
          event.request as unknown,
          { method: 'POST', url },
          `${url} keeps only its method and path`,
        );
      }
    });

    test('a path that only starts with a key route keeps its context', function (assert) {
      let event = scrubRequestTelemetry({
        request: {
          method: 'GET',
          url: 'https://app.telemetry.test/_user-keys-status',
          query_string: 'a=b',
        },
      });
      assert.deepEqual(event.request as unknown, {
        method: 'GET',
        url: 'https://app.telemetry.test/_user-keys-status',
        query_string: 'a=b',
      });
    });

    test("a breadcrumb loses a key route's query string", function (assert) {
      let event = scrubRequestTelemetry({
        breadcrumbs: [
          {
            message:
              '<-- GET */* https://app.telemetry.test/_user-keys/3f0e8f4a-8d6b-4c55-9b6f-0d7e0c3f9a11?ticket=ticket-marker',
          },
          {
            message:
              '<-- POST */* https://app.telemetry.test/_KEY-WRITE-TICKETS?value=value-marker [job: 1]',
          },
        ],
      });
      assert.deepEqual(
        event.breadcrumbs?.map((breadcrumb) => breadcrumb.message),
        [
          '<-- GET */* https://app.telemetry.test/_user-keys/3f0e8f4a-8d6b-4c55-9b6f-0d7e0c3f9a11',
          '<-- POST */* https://app.telemetry.test/_KEY-WRITE-TICKETS [job: 1]',
        ],
      );
    });

    test("a transaction for a key route keeps only the origin and path of its spans' URLs", function (assert) {
      let event = scrubRequestTelemetry({
        contexts: {
          trace: {
            data: {
              'http.host': 'app.telemetry.test',
              'http.url':
                'https://app.telemetry.test/_user-keys/3f0e8f4a-8d6b-4c55-9b6f-0d7e0c3f9a11?ticket=ticket-marker',
              'http.target':
                '/_user-keys/3f0e8f4a-8d6b-4c55-9b6f-0d7e0c3f9a11?ticket=ticket-marker',
              'http.query': 'ticket=ticket-marker',
            },
          },
        },
        spans: [
          {
            data: {
              'http.url':
                'https://app.telemetry.test/_KEY-WRITE-TICKETS?value=value-marker',
            },
          },
        ],
      });
      assert.deepEqual(event.contexts.trace.data as unknown, {
        'http.host': 'app.telemetry.test',
        'http.url':
          'https://app.telemetry.test/_user-keys/3f0e8f4a-8d6b-4c55-9b6f-0d7e0c3f9a11',
        'http.target': '/_user-keys/3f0e8f4a-8d6b-4c55-9b6f-0d7e0c3f9a11',
      });
      assert.deepEqual(event.spans[0].data as unknown, {
        'http.url': 'https://app.telemetry.test/_KEY-WRITE-TICKETS',
      });
    });

    test("a transaction for a proxy route keeps only the origin and path of its spans' URLs", function (assert) {
      let event = scrubRequestTelemetry({
        type: 'transaction',
        transaction: 'POST /_request-forward',
        contexts: {
          trace: {
            data: {
              'sentry.op': 'http.server',
              'http.method': 'POST',
              'http.host': 'app.telemetry.test',
              'http.url':
                'https://app.telemetry.test/_request-forward?caller=marker#part',
              'http.target': '/_request-forward?caller=marker#part',
              'http.query': 'caller=marker',
              'http.fragment': 'part',
              url: 'https://app.telemetry.test/_request-forward',
              'http.status_code': 200,
            },
          },
        },
        spans: [
          {
            data: {
              'sentry.op': 'http.client',
              'url.full': 'https://vendor.telemetry.test/v1?key=marker',
              'url.query': '?key=marker',
            },
          },
        ],
      });
      assert.deepEqual(event.contexts.trace.data as unknown, {
        'sentry.op': 'http.server',
        'http.method': 'POST',
        'http.host': 'app.telemetry.test',
        'http.url': 'https://app.telemetry.test/_request-forward',
        'http.target': '/_request-forward',
        url: 'https://app.telemetry.test/_request-forward',
        'http.status_code': 200,
      });
      assert.deepEqual(event.spans[0].data as unknown, {
        'sentry.op': 'http.client',
        'url.full': 'https://vendor.telemetry.test/v1',
      });
      assert.strictEqual(event.transaction, 'POST /_request-forward');
    });

    test("a transaction for the secure origin keeps only the origin and path of its spans' URLs", function (assert) {
      registerSecureOriginHost('secure.telemetry.test');
      let event = scrubRequestTelemetry({
        contexts: {
          trace: {
            data: {
              'http.host': 'secure.telemetry.test:443',
              'http.url': 'https://secure.telemetry.test/login?next=marker',
              'http.target': '/login?next=marker',
              'http.query': 'next=marker',
            },
          },
        },
      });
      assert.deepEqual(event.contexts.trace.data as unknown, {
        'http.host': 'secure.telemetry.test:443',
        'http.url': 'https://secure.telemetry.test/login',
        'http.target': '/login',
      });
    });

    test('a transaction for an ordinary route masks a token query parameter in its spans', function (assert) {
      let event = scrubRequestTelemetry({
        contexts: {
          trace: {
            data: {
              'http.url':
                'https://app.telemetry.test/_download-realm?realm=r&token=session-jwt',
              'http.target': '/_download-realm?realm=r&token=session-jwt#top',
              'http.query': 'realm=r&token=session-jwt',
              'http.fragment': 'top',
            },
          },
        },
        spans: [
          {
            data: {
              'url.full':
                'https://other.telemetry.test/capture?token=capture-token',
              'url.query': '?token=capture-token&size=1',
            },
          },
          { description: 'a span with no data' },
        ],
      });
      assert.deepEqual(event.contexts.trace.data as unknown, {
        'http.url':
          'https://app.telemetry.test/_download-realm?realm=r&token=REDACTED',
        'http.target': '/_download-realm?realm=r&token=REDACTED#top',
        'http.query': 'realm=r&token=REDACTED',
        'http.fragment': 'top',
      });
      assert.deepEqual(event.spans as unknown, [
        {
          data: {
            'url.full': 'https://other.telemetry.test/capture?token=REDACTED',
            'url.query': '?token=REDACTED&size=1',
          },
        },
        { description: 'a span with no data' },
      ]);
    });

    test("a child span whose own URL is a proxy route keeps only that URL's origin and path", function (assert) {
      let event = scrubRequestTelemetry({
        contexts: {
          trace: {
            data: { 'http.url': 'https://app.telemetry.test/test/card?a=b' },
          },
        },
        spans: [
          {
            data: {
              'http.url':
                'https://app.telemetry.test/_openrouter/chat/completions?caller=marker',
              'http.query': 'caller=marker',
            },
          },
        ],
      });
      assert.deepEqual(event.contexts.trace.data as unknown, {
        'http.url': 'https://app.telemetry.test/test/card?a=b',
      });
      assert.deepEqual(event.spans[0].data as unknown, {
        'http.url': 'https://app.telemetry.test/_openrouter/chat/completions',
      });
    });

    test("a span attribute outside the URL attributes loses a proxy route's query string", function (assert) {
      let event = scrubRequestTelemetry({
        contexts: {
          trace: {
            data: {
              'http.url': 'https://app.telemetry.test/test/card',
              'custom.line':
                'POST https://app.telemetry.test/_request-forward?caller=marker',
            },
          },
        },
      });
      assert.deepEqual(event.contexts.trace.data as unknown, {
        'http.url': 'https://app.telemetry.test/test/card',
        'custom.line': 'POST https://app.telemetry.test/_request-forward',
      });
    });

    test("an outgoing request's breadcrumb masks a token in its URL attributes", function (assert) {
      let event = scrubRequestTelemetry({
        breadcrumbs: [
          {
            data: {
              url: 'https://other.telemetry.test/capture',
              'http.method': 'GET',
              'http.query': '?token=capture-token&size=1',
              status_code: 200,
            },
          },
        ],
      });
      assert.deepEqual(event.breadcrumbs[0].data as unknown, {
        url: 'https://other.telemetry.test/capture',
        'http.method': 'GET',
        'http.query': '?token=REDACTED&size=1',
        status_code: 200,
      });
    });

    test("an outgoing request's breadcrumb during a proxy route request keeps no query string", function (assert) {
      let event = scrubRequestTelemetry({
        request: {
          method: 'POST',
          url: 'https://app.telemetry.test/_request-forward',
        },
        breadcrumbs: [
          {
            data: {
              url: 'https://other.telemetry.test/lookup',
              'http.query': '?id=caller-marker',
              'http.fragment': 'part',
            },
          },
        ],
      });
      assert.deepEqual(event.breadcrumbs[0].data as unknown, {
        url: 'https://other.telemetry.test/lookup',
      });
    });

    test('an event with no request is left alone', function (assert) {
      let event: { message: string; request?: undefined } = {
        message: 'no request',
      };
      assert.deepEqual(scrubRequestTelemetry(event), { message: 'no request' });
    });
  });
});
