import QUnit from 'qunit';
const { module, test } = QUnit;
import * as Sentry from '@sentry/node';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { basename } from 'path';
import { scrubRequestTelemetry } from '../lib/request-telemetry.ts';
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

    test('an event with no request is left alone', function (assert) {
      let event: { message: string; request?: undefined } = {
        message: 'no request',
      };
      assert.deepEqual(scrubRequestTelemetry(event), { message: 'no request' });
    });
  });
});
