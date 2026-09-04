import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { createServer, type ServerResponse } from 'http';
import { createRemotePrerenderer } from '../prerender/remote-prerenderer.ts';
import {
  PRERENDER_DISPATCH_HEADER,
  PRERENDER_DISPATCH_NONE,
  PRERENDER_SERVER_DRAINING_STATUS_CODE,
  PRERENDER_SERVER_STATUS_DRAINING,
  PRERENDER_SERVER_STATUS_HEADER,
} from '../prerender/prerender-constants.ts';

module(basename(import.meta.filename), function (hooks) {
  hooks.afterEach(function () {
    delete process.env.PRERENDER_MANAGER_RETRY_ATTEMPTS;
    delete process.env.PRERENDER_MANAGER_RETRY_DELAY_MS;
    delete process.env.PRERENDER_MANAGER_REQUEST_TIMEOUT_MS;
    delete process.env.PRERENDER_MANAGER_MAX_DELAY_MS;
  });

  module('remote prerenderer payload', function () {
    async function expectValidationFailure(
      assert: Assert,
      attrs: any,
      message: RegExp,
    ) {
      let originalFetch = globalThis.fetch;
      let fetchCalled = false;
      (globalThis as any).fetch = () => {
        fetchCalled = true;
        throw new Error('fetch should not be called when validation fails');
      };

      try {
        let prerenderer = createRemotePrerenderer('http://127.0.0.1:0');
        await assert.rejects(
          prerenderer.prerenderModule(attrs as any),
          message,
        );
        assert.false(fetchCalled, 'does not hit network on validation failure');
      } finally {
        (globalThis as any).fetch = originalFetch;
      }
    }

    async function expectRunCommandValidationFailure(
      assert: Assert,
      attrs: any,
      message: RegExp,
    ) {
      let originalFetch = globalThis.fetch;
      let fetchCalled = false;
      (globalThis as any).fetch = () => {
        fetchCalled = true;
        throw new Error('fetch should not be called when validation fails');
      };

      try {
        let prerenderer = createRemotePrerenderer('http://127.0.0.1:0');
        await assert.rejects(prerenderer.runCommand(attrs as any), message);
        assert.false(fetchCalled, 'does not hit network on validation failure');
      } finally {
        (globalThis as any).fetch = originalFetch;
      }
    }

    test('sends JSON:API headers and attributes', async function (assert) {
      let receivedHeaders: any;
      let receivedBody: any;
      let server = createServer((req, res) => {
        receivedHeaders = req.headers;
        let body: Buffer[] = [];
        req.on('data', (chunk) => body.push(chunk));
        req.on('end', () => {
          receivedBody = JSON.parse(Buffer.concat(body).toString('utf-8'));
          res.statusCode = 201;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              data: { attributes: { ok: true } },
            }),
          );
        });
      }).listen(0);

      try {
        let url = `http://127.0.0.1:${(server.address() as any).port}`;
        let prerenderer = createRemotePrerenderer(url);

        await prerenderer.prerenderModule({
          affinityType: 'realm',
          affinityValue: 'realm-1',
          realm: 'realm-1',
          url: 'https://example.com/module',
          auth: '{"token":"x"}',
        });

        assert.strictEqual(
          receivedHeaders?.['content-type'],
          'application/vnd.api+json',
          'content-type header set',
        );
        assert.strictEqual(
          receivedHeaders?.accept,
          'application/vnd.api+json',
          'accept header set',
        );
        assert.deepEqual(
          receivedBody?.data?.attributes,
          {
            affinityType: 'realm',
            affinityValue: 'realm-1',
            realm: 'realm-1',
            url: 'https://example.com/module',
            auth: '{"token":"x"}',
            renderOptions: {},
          },
          'sends expected attributes',
        );
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    test('rejects empty realm before sending', async function (assert) {
      await expectValidationFailure(
        assert,
        { realm: '', url: 'https://example.com/module', auth: '{}' },
        /Missing prerender prerender-module-request attributes: affinityValue, realm/,
      );
    });

    test('rejects empty url before sending', async function (assert) {
      await expectValidationFailure(
        assert,
        { realm: 'realm', url: '', auth: '{}' },
        /Missing prerender prerender-module-request attributes: url/,
      );
    });

    test('rejects empty auth before sending', async function (assert) {
      await expectValidationFailure(
        assert,
        { realm: 'realm', url: 'https://example.com/module', auth: '' },
        /Missing prerender prerender-module-request attributes: auth/,
      );
    });

    test('rejects missing auth before sending', async function (assert) {
      await expectValidationFailure(
        assert,
        { realm: 'realm', url: 'https://example.com/module' },
        /Missing prerender prerender-module-request attributes: auth/,
      );
    });

    test('sends run-command payload with user affinity derived from userId', async function (assert) {
      let receivedBody: any;
      let server = createServer((req, res) => {
        let body: Buffer[] = [];
        req.on('data', (chunk) => body.push(chunk));
        req.on('end', () => {
          receivedBody = JSON.parse(Buffer.concat(body).toString('utf-8'));
          res.statusCode = 201;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              data: {
                attributes: {
                  status: 'ready',
                  cardResultString: '{"ok":true}',
                },
              },
            }),
          );
        });
      }).listen(0);

      try {
        let url = `http://127.0.0.1:${(server.address() as any).port}`;
        let prerenderer = createRemotePrerenderer(url);

        await prerenderer.runCommand({
          userId: '@alice:localhost',
          auth: '{}',
          command: 'https://example.com/commands/test/default',
          commandInput: { value: 1 },
        });

        assert.deepEqual(
          receivedBody?.data?.attributes,
          {
            affinityType: 'user',
            affinityValue: '@alice:localhost',
            auth: '{}',
            command: 'https://example.com/commands/test/default',
            commandInput: { value: 1 },
          },
          'run-command payload uses user affinity fields',
        );
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    test('rejects empty userId before sending run-command', async function (assert) {
      await expectRunCommandValidationFailure(
        assert,
        {
          userId: '',
          auth: '{}',
          command: 'https://example.com/commands/test/default',
        },
        /Missing prerender run-command-request attributes: affinityValue/,
      );
    });

    test('threads jobId through as x-boxel-job-id header and strips from body', async function (assert) {
      let receivedHeaders: any;
      let receivedBody: any;
      let server = createServer((req, res) => {
        receivedHeaders = req.headers;
        let body: Buffer[] = [];
        req.on('data', (chunk) => body.push(chunk));
        req.on('end', () => {
          receivedBody = JSON.parse(Buffer.concat(body).toString('utf-8'));
          res.statusCode = 201;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              data: { attributes: { ok: true } },
            }),
          );
        });
      }).listen(0);

      try {
        let url = `http://127.0.0.1:${(server.address() as any).port}`;
        let prerenderer = createRemotePrerenderer(url);

        await prerenderer.prerenderVisit({
          affinityType: 'realm',
          affinityValue: 'realm-1',
          realm: 'realm-1',
          url: 'https://example.com/card.json',
          auth: '{}',
          jobId: '20678.26619',
        });

        assert.strictEqual(
          receivedHeaders?.['x-boxel-job-id'],
          '20678.26619',
          'jobId is sent as x-boxel-job-id header',
        );
        assert.notOk(
          'jobId' in (receivedBody?.data?.attributes ?? {}),
          'jobId is not present in data.attributes (request metadata, not payload)',
        );
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    // `renderScope` decides which resident instances the tab may reuse, and
    // it reaches the page only by surviving every hop: computed in
    // `visit-file.ts`, carried here in the request body, read back out in
    // `prerender-app.ts`, forwarded by the prerenderer, stamped on the page by
    // the render runner. Each hop destructures it by name, so dropping it
    // anywhere is silent — the render still succeeds, it just reuses instances
    // from another job. This asserts the hop this file owns.
    test('carries renderScope in the request body', async function (assert) {
      let receivedBody: any;
      let server = createServer((req, res) => {
        let body: Buffer[] = [];
        req.on('data', (chunk) => body.push(chunk));
        req.on('end', () => {
          receivedBody = JSON.parse(Buffer.concat(body).toString('utf-8'));
          res.statusCode = 201;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ data: { attributes: { ok: true } } }));
        });
      }).listen(0);

      try {
        let url = `http://127.0.0.1:${(server.address() as any).port}`;
        let prerenderer = createRemotePrerenderer(url);

        await prerenderer.prerenderVisit({
          affinityType: 'realm',
          affinityValue: 'realm-1',
          realm: 'realm-1',
          url: 'https://example.com/card.json',
          auth: '{}',
          renderScope: 'https://example.com/@42',
        });

        assert.strictEqual(
          receivedBody?.data?.attributes?.renderScope,
          'https://example.com/@42',
          'renderScope is sent in data.attributes',
        );
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    test('omits renderScope from the body when the visit has no scope', async function (assert) {
      // Absent rather than null or empty: `prerender-app.ts` treats a
      // non-string as no scope, and an interactive visit legitimately has
      // none.
      let receivedBody: any;
      let server = createServer((req, res) => {
        let body: Buffer[] = [];
        req.on('data', (chunk) => body.push(chunk));
        req.on('end', () => {
          receivedBody = JSON.parse(Buffer.concat(body).toString('utf-8'));
          res.statusCode = 201;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ data: { attributes: { ok: true } } }));
        });
      }).listen(0);

      try {
        let url = `http://127.0.0.1:${(server.address() as any).port}`;
        let prerenderer = createRemotePrerenderer(url);

        await prerenderer.prerenderVisit({
          affinityType: 'realm',
          affinityValue: 'realm-1',
          realm: 'realm-1',
          url: 'https://example.com/card.json',
          auth: '{}',
        });

        assert.notOk(
          'renderScope' in (receivedBody?.data?.attributes ?? {}),
          'no renderScope key when the visit carries no scope',
        );
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    test('omits x-boxel-job-id header when jobId is not provided', async function (assert) {
      let receivedHeaders: any;
      let server = createServer((req, res) => {
        receivedHeaders = req.headers;
        req.on('data', () => {});
        req.on('end', () => {
          res.statusCode = 201;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ data: { attributes: { ok: true } } }));
        });
      }).listen(0);

      try {
        let url = `http://127.0.0.1:${(server.address() as any).port}`;
        let prerenderer = createRemotePrerenderer(url);

        await prerenderer.prerenderVisit({
          affinityType: 'realm',
          affinityValue: 'realm-1',
          realm: 'realm-1',
          url: 'https://example.com/card.json',
          auth: '{}',
        });

        assert.notOk(
          'x-boxel-job-id' in (receivedHeaders ?? {}),
          'x-boxel-job-id header absent when jobId is omitted',
        );
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    test('omits x-boxel-job-id header when jobId fails sanitization', async function (assert) {
      let receivedHeaders: any;
      let receivedBody: any;
      let server = createServer((req, res) => {
        receivedHeaders = req.headers;
        let body: Buffer[] = [];
        req.on('data', (chunk) => body.push(chunk));
        req.on('end', () => {
          receivedBody = JSON.parse(Buffer.concat(body).toString('utf-8'));
          res.statusCode = 201;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ data: { attributes: { ok: true } } }));
        });
      }).listen(0);

      try {
        let url = `http://127.0.0.1:${(server.address() as any).port}`;
        let prerenderer = createRemotePrerenderer(url);

        // Newline in the job-id string is the canonical log-injection
        // shape that sanitizePrerenderJobId is designed to reject.
        await prerenderer.prerenderVisit({
          affinityType: 'realm',
          affinityValue: 'realm-1',
          realm: 'realm-1',
          url: 'https://example.com/card.json',
          auth: '{}',
          jobId: '20678.26619\nX-Injected: bad',
        });

        assert.notOk(
          'x-boxel-job-id' in (receivedHeaders ?? {}),
          'x-boxel-job-id header absent when jobId fails sanitization',
        );
        assert.notOk(
          'jobId' in (receivedBody?.data?.attributes ?? {}),
          'jobId stripped from body even when sanitization rejects it',
        );
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  });

  module('remote prerenderer retries', function () {
    test('retries draining responses and succeeds', async function (assert) {
      let attempts = 0;
      let server = createServer((req, res) => {
        attempts++;
        if (req.url?.endsWith('/prerender-visit') && attempts < 3) {
          res.statusCode = PRERENDER_SERVER_DRAINING_STATUS_CODE;
          res.setHeader(
            PRERENDER_SERVER_STATUS_HEADER,
            PRERENDER_SERVER_STATUS_DRAINING,
          );
          res.end('draining');
          return;
        }
        res.statusCode = 201;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            data: { attributes: { ok: true } },
          }),
        );
      }).listen(0);
      let url = `http://127.0.0.1:${(server.address() as any).port}`;
      let prerenderer = createRemotePrerenderer(url);

      let result = await prerenderer.prerenderVisit({
        affinityType: 'realm',
        affinityValue: 'realm',
        realm: 'realm',
        url: 'https://example.com/card',
        auth: '{}',
      });

      assert.true((result as any).ok, 'eventually succeeds after retries');
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    test('fails after exhausting retries on 503', async function (assert) {
      process.env.PRERENDER_MANAGER_RETRY_ATTEMPTS = '2';
      let attempts = 0;
      let server = createServer((_req, res) => {
        attempts++;
        res.statusCode = 503;
        res.end('unavailable');
      }).listen(0);
      let url = `http://127.0.0.1:${(server.address() as any).port}`;
      let prerenderer = createRemotePrerenderer(url);

      try {
        await prerenderer.prerenderVisit({
          affinityType: 'realm',
          affinityValue: 'realm',
          realm: 'realm',
          url: 'https://example.com/card',
          auth: '{}',
        });
        assert.ok(false, 'should have thrown');
      } catch (e: any) {
        assert.ok(/status 503/.test(e.message), 'fails after retries with 503');
        assert.ok(attempts >= 2, 'retried at least configured attempts');
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        delete process.env.PRERENDER_MANAGER_RETRY_ATTEMPTS;
        delete process.env.PRERENDER_MANAGER_RETRY_MAX_ELAPSED_MS;
      }
    });

    test('retries on manager 500 and succeeds', async function (assert) {
      process.env.PRERENDER_MANAGER_RETRY_ATTEMPTS = '3';
      process.env.PRERENDER_MANAGER_RETRY_DELAY_MS = '1';
      let attempts = 0;
      let server = createServer((_req, res) => {
        attempts++;
        if (attempts === 1) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              errors: [{ status: 500, message: 'Protocol error' }],
            }),
          );
          return;
        }
        res.statusCode = 201;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            data: { attributes: { ok: true } },
          }),
        );
      }).listen(0);

      try {
        let url = `http://127.0.0.1:${(server.address() as any).port}`;
        let prerenderer = createRemotePrerenderer(url);

        let result = await prerenderer.prerenderVisit({
          affinityType: 'realm',
          affinityValue: 'realm',
          realm: 'realm',
          url: 'https://example.com/card',
          auth: '{}',
        });

        assert.true((result as any).ok, 'eventually succeeds after 500');
        assert.ok(attempts >= 2, 'retried after 500');
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  });

  // A command is not idempotent: it creates cards, matrix rooms and outbound
  // calls, and nothing downstream collapses two identical invocations. So a
  // retry is only ever safe on a failure that proves no prerender server
  // received the request — a manager that says it never dispatched, or a
  // connection that was never established. Every other failure leaves open
  // that the command ran and only its response was lost.
  module('run-command retries', function (hooks) {
    hooks.beforeEach(function () {
      process.env.PRERENDER_MANAGER_RETRY_ATTEMPTS = '3';
      process.env.PRERENDER_MANAGER_RETRY_DELAY_MS = '1';
    });

    let commandArgs = {
      userId: '@user:localhost',
      auth: '{}',
      command: 'create-card',
      commandInput: null,
    } as const;

    // Stands in for the manager: `runs` counts the invocations that reached a
    // prerender server, which is the number the command's side effects would
    // be repeated by.
    function makeCommandServer(
      respond: (res: ServerResponse, runs: number) => void | 'ran',
    ) {
      let runs = 0;
      let server = createServer((_req, res) => {
        runs++;
        respond(res, runs);
      }).listen(0);
      return {
        url: () => `http://127.0.0.1:${(server.address() as any).port}`,
        runs: () => runs,
        stop: () =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      };
    }

    function succeed(res: ServerResponse) {
      res.statusCode = 201;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          data: { attributes: { status: 'ready', cardResultString: null } },
        }),
      );
    }

    test('does not retry a 5xx that may be a lost response', async function (assert) {
      // The manager answers 502 for a request whose command already ran to
      // completion — the response is what was lost, not the work.
      let manager = makeCommandServer((res) => {
        res.statusCode = 502;
        res.end('Upstream error');
      });

      try {
        let prerenderer = createRemotePrerenderer(manager.url());
        await assert.rejects(
          prerenderer.runCommand(commandArgs),
          /status 502/,
          'surfaces the failure to the caller',
        );
        assert.strictEqual(manager.runs(), 1, 'the command ran once');
      } finally {
        await manager.stop();
      }
    });

    test('does not retry a 503 from a manager that may have dispatched', async function (assert) {
      // 503 with no dispatch header: the manager gives no assurance that the
      // request stopped short of a prerender server.
      let manager = makeCommandServer((res) => {
        res.statusCode = 503;
        res.end('No servers');
      });

      try {
        let prerenderer = createRemotePrerenderer(manager.url());
        await assert.rejects(
          prerenderer.runCommand(commandArgs),
          /status 503/,
          'surfaces the failure to the caller',
        );
        assert.strictEqual(manager.runs(), 1, 'the command ran at most once');
      } finally {
        await manager.stop();
      }
    });

    test('retries a failure the manager reports as never dispatched', async function (assert) {
      let manager = makeCommandServer((res, runs) => {
        if (runs === 1) {
          res.statusCode = 503;
          res.setHeader(PRERENDER_DISPATCH_HEADER, PRERENDER_DISPATCH_NONE);
          res.end('No servers');
          return;
        }
        succeed(res);
      });

      try {
        let prerenderer = createRemotePrerenderer(manager.url());
        let result = await prerenderer.runCommand(commandArgs);
        assert.strictEqual(result.status, 'ready', 'the caller gets a result');
        assert.strictEqual(
          manager.runs(),
          2,
          'retried the request the manager never handed to a server',
        );
      } finally {
        await manager.stop();
      }
    });

    test('retries when the connection was never established', async function (assert) {
      let manager = makeCommandServer((res) => succeed(res));
      let originalFetch = globalThis.fetch;
      let refusedOnce = false;

      try {
        (globalThis as any).fetch = (...args: Parameters<typeof fetch>) => {
          if (!refusedOnce) {
            refusedOnce = true;
            let err: any = new TypeError('fetch failed');
            err.cause = Object.assign(new Error('connect ECONNREFUSED'), {
              code: 'ECONNREFUSED',
            });
            return Promise.reject(err);
          }
          return originalFetch(...args);
        };

        let prerenderer = createRemotePrerenderer(manager.url());
        let result = await prerenderer.runCommand(commandArgs);

        assert.strictEqual(result.status, 'ready', 'the caller gets a result');
        assert.true(refusedOnce, 'the first attempt was refused');
        assert.strictEqual(manager.runs(), 1, 'the command ran once');
      } finally {
        (globalThis as any).fetch = originalFetch;
        await manager.stop();
      }
    });

    test('does not retry a connection reset', async function (assert) {
      // A reset can land after the server read the request and started the
      // command, so it proves nothing about whether the command ran.
      let originalFetch = globalThis.fetch;
      let attempts = 0;

      try {
        (globalThis as any).fetch = () => {
          attempts++;
          let err: any = new TypeError('fetch failed');
          err.cause = Object.assign(new Error('socket hang up'), {
            code: 'ECONNRESET',
          });
          return Promise.reject(err);
        };

        let prerenderer = createRemotePrerenderer('http://127.0.0.1:1');
        await assert.rejects(
          prerenderer.runCommand(commandArgs),
          /fetch failed/,
          'surfaces the failure to the caller',
        );
        assert.strictEqual(attempts, 1, 'made a single attempt');
      } finally {
        (globalThis as any).fetch = originalFetch;
      }
    });

    test('renders still retry a 5xx', async function (assert) {
      // The narrow policy is scoped to commands: a render is a pure read, so
      // repeating it costs time and nothing else.
      let manager = makeCommandServer((res, runs) => {
        if (runs === 1) {
          res.statusCode = 502;
          res.end('Upstream error');
          return;
        }
        res.statusCode = 201;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ data: { attributes: { ok: true } } }));
      });

      try {
        let prerenderer = createRemotePrerenderer(manager.url());
        let result = await prerenderer.prerenderVisit({
          affinityType: 'realm',
          affinityValue: 'realm',
          realm: 'realm',
          url: 'https://example.com/card',
          auth: '{}',
        });
        assert.true((result as any).ok, 'succeeds on the retry');
        assert.strictEqual(manager.runs(), 2, 'retried the render');
      } finally {
        await manager.stop();
      }
    });
  });

  module('remote prerenderer timeouts', function () {
    test('does not retry when the client aborts from request timeout', async function (assert) {
      process.env.PRERENDER_MANAGER_RETRY_ATTEMPTS = '3';
      process.env.PRERENDER_MANAGER_RETRY_DELAY_MS = '1';
      process.env.PRERENDER_MANAGER_REQUEST_TIMEOUT_MS = '20';
      let attempts = 0;

      let server = createServer((_req, res) => {
        attempts++;
        // Never respond; let client-side timeout abort the request.
        res.on('error', () => {});
      }).listen(0);

      try {
        let url = `http://127.0.0.1:${(server.address() as any).port}`;
        let prerenderer = createRemotePrerenderer(url);

        await assert.rejects(
          prerenderer.prerenderVisit({
            affinityType: 'realm',
            affinityValue: 'realm',
            realm: 'realm',
            url: 'https://example.com/card',
            auth: '{}',
          }),
          /aborted/,
          'throws after client-side abort',
        );
        assert.strictEqual(attempts, 1, 'does not retry after timeout abort');
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  });
});
