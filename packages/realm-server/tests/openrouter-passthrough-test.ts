import { module, test } from 'qunit';
import sinon from 'sinon';
import type { Test, SuperTest } from 'supertest';
import supertest from 'supertest';
import { basename, join } from 'path';
import type { RealmHttpServer as Server } from '../server.ts';
import { dirSync, type DirResult } from 'tmp';
import fsExtra from 'fs-extra';
const { copySync, ensureDirSync } = fsExtra;
import {
  setupDB,
  runTestRealmServer,
  closeServer,
  fixtureDir,
  insertUser,
  insertPlan,
  realmSecretSeed,
  createVirtualNetwork,
  waitUntil,
} from './helpers/index.ts';
import { createJWT as createRealmServerJWT } from '../utils/jwt.ts';
import {
  addToCreditsLedger,
  getUserByMatrixUserId,
  sumUpCreditsLedger,
} from '@cardstack/billing/billing-queries';
import { AllowedProxyDestinations } from '../lib/allowed-proxy-destinations.ts';

module(basename(import.meta.filename), function () {
  module(
    'Realm-specific Endpoints | _openrouter/chat/completions',
    function (hooks) {
      let testRealmHttpServer: Server;
      let testRealm: any;
      let dbAdapter: any;
      let publisher: any;
      let runner: any;
      let request: SuperTest<Test>;
      let testRealmDir: string;
      let dir: DirResult;

      let virtualNetwork = createVirtualNetwork();

      hooks.beforeEach(async function () {
        dir = dirSync();
        copySync(fixtureDir('simple'), dir.name);
      });

      async function startRealmServer(
        dbAdapter: any,
        publisher: any,
        runner: any,
      ) {
        if (testRealm) {
          virtualNetwork.unmount(testRealm.handle);
        }

        ({ testRealm, testRealmHttpServer } = await runTestRealmServer({
          virtualNetwork,
          testRealmDir,
          realmsRootPath: join(dir.name, 'realm_server_2'),
          realmURL: new URL('http://127.0.0.1:4445/test/'),
          dbAdapter,
          publisher,
          runner,
          matrixURL: new URL('http://localhost:8008'),
        }));
        request = supertest(testRealmHttpServer);
      }

      setupDB(hooks, {
        beforeEach: async (_dbAdapter, _publisher, _runner) => {
          dbAdapter = _dbAdapter;
          publisher = _publisher;
          runner = _runner;
          testRealmDir = join(dir.name, 'realm_server_2', 'test');
          ensureDirSync(testRealmDir);
          copySync(fixtureDir('simple'), testRealmDir);

          // Whitelist OpenRouter chat completions so the passthrough handler
          // can resolve a destination config + credit strategy.
          await dbAdapter.execute(
            `INSERT INTO proxy_endpoints (id, url, api_key, credit_strategy, supports_streaming, auth_method, auth_parameter_name, created_at, updated_at)
             VALUES
               (gen_random_uuid(), 'https://openrouter.ai/api/v1/chat/completions', 'openrouter-api-key', 'openrouter', true, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
             ON CONFLICT (url)
             DO UPDATE SET
               api_key = EXCLUDED.api_key,
               credit_strategy = EXCLUDED.credit_strategy,
               supports_streaming = EXCLUDED.supports_streaming,
               updated_at = CURRENT_TIMESTAMP`,
          );

          await startRealmServer(dbAdapter, publisher, runner);

          await insertUser(
            dbAdapter,
            '@testuser:localhost',
            'cus_test123',
            'test@example.com',
          );

          await insertPlan(dbAdapter, 'Test Plan', 1000, 100, 'price_test123');

          const user = await getUserByMatrixUserId(
            dbAdapter,
            '@testuser:localhost',
          );
          if (user) {
            await addToCreditsLedger(dbAdapter, {
              userId: user.id,
              creditAmount: 50,
              creditType: 'extra_credit',
              subscriptionCycleId: null,
            });
          }
        },
        afterEach: async () => {
          AllowedProxyDestinations.reset();
          await closeServer(testRealmHttpServer);
        },
      });

      test('forwards a verbatim OpenAI body to OpenRouter and deducts credits', async function (assert) {
        const originalFetch = global.fetch;
        const mockFetch = sinon.stub(global, 'fetch');

        const mockOpenRouterResponse = {
          id: 'gen-test-passthrough-1',
          choices: [{ message: { role: 'assistant', content: 'hi' } }],
          usage: { total_tokens: 42, cost: 0.005 },
        };

        mockFetch.callsFake(
          async (input: string | URL | Request, _init?: RequestInit) => {
            const url = typeof input === 'string' ? input : input.toString();
            if (url === 'https://openrouter.ai/api/v1/chat/completions') {
              return new Response(JSON.stringify(mockOpenRouterResponse), {
                status: 200,
                headers: { 'content-type': 'application/json' },
              });
            }
            return new Response(JSON.stringify({ error: 'Not found' }), {
              status: 404,
              headers: { 'content-type': 'application/json' },
            });
          },
        );

        try {
          const jwt = createRealmServerJWT(
            { user: '@testuser:localhost', sessionRoom: 'test-session-room' },
            realmSecretSeed,
          );

          const openAIBody = {
            model: 'anthropic/claude-opus-4-7',
            messages: [{ role: 'user', content: 'Hello' }],
          };

          const response = await request
            .post('/_openrouter/chat/completions')
            .set('Accept', 'application/json')
            .set('Content-Type', 'application/json')
            .set('Authorization', `Bearer ${jwt}`)
            .send(openAIBody);

          assert.strictEqual(response.status, 200);
          assert.deepEqual(response.body, mockOpenRouterResponse);

          const calls = mockFetch.getCalls();
          const upstream = calls.find((call) => {
            const url = call.args[0];
            const href = typeof url === 'string' ? url : url?.toString();
            return href === 'https://openrouter.ai/api/v1/chat/completions';
          });
          assert.ok(upstream, 'fetched upstream chat completions URL');

          const upstreamInit = upstream!.args[1] as RequestInit;
          const upstreamHeaders = upstreamInit.headers as Record<
            string,
            string
          >;
          assert.strictEqual(
            upstreamHeaders.Authorization,
            'Bearer openrouter-api-key',
            'server-side OpenRouter key is stamped onto upstream Authorization',
          );
          assert.deepEqual(
            JSON.parse(upstreamInit.body as string),
            openAIBody,
            'OpenAI body forwarded verbatim',
          );

          const user = await getUserByMatrixUserId(
            dbAdapter,
            '@testuser:localhost',
          );
          await waitUntil(
            async () => {
              const credits = await sumUpCreditsLedger(dbAdapter, {
                creditType: ['extra_credit', 'extra_credit_used'],
                userId: user!.id,
              });
              return credits === 45; // 50 - (0.005 * 1000) = 45
            },
            { timeoutMessage: 'Credits should be deducted (50 - 5 = 45)' },
          );
        } finally {
          mockFetch.restore();
          global.fetch = originalFetch;
        }
      });

      test('streams the upstream SSE response when stream: true is in the body', async function (assert) {
        const originalFetch = global.fetch;
        const mockFetch = sinon.stub(global, 'fetch');

        const mockStreamResponse = new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  'data: {"id":"gen-stream-pt","choices":[{"delta":{"content":"Hi"}}]}\n\n',
                ),
              );
              controller.enqueue(
                new TextEncoder().encode(
                  'data: {"choices":[{"delta":{"content":" there"}}],"usage":{"prompt_tokens":3,"completion_tokens":2,"cost":0.001}}\n\n',
                ),
              );
              controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
              controller.close();
            },
          }),
          {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          },
        );

        mockFetch.callsFake(
          async (input: string | URL | Request, _init?: RequestInit) => {
            const url = typeof input === 'string' ? input : input.toString();
            if (url === 'https://openrouter.ai/api/v1/chat/completions') {
              return mockStreamResponse;
            }
            return new Response(JSON.stringify({ error: 'Not found' }), {
              status: 404,
              headers: { 'content-type': 'application/json' },
            });
          },
        );

        try {
          const jwt = createRealmServerJWT(
            { user: '@testuser:localhost', sessionRoom: 'test-session-room' },
            realmSecretSeed,
          );

          const response = await request
            .post('/_openrouter/chat/completions')
            .set('Accept', 'text/event-stream')
            .set('Content-Type', 'application/json')
            .set('Authorization', `Bearer ${jwt}`)
            .send({
              model: 'anthropic/claude-opus-4-7',
              messages: [{ role: 'user', content: 'Hello' }],
              stream: true,
            });

          assert.strictEqual(response.status, 200);
          assert.strictEqual(
            response.headers['cache-control'],
            'no-cache, no-store, must-revalidate',
          );
          assert.true(
            response.text.includes('data: {"id":"gen-stream-pt"'),
            'first stream chunk relayed',
          );
          assert.true(
            response.text.includes('data: [DONE]'),
            'stream terminator relayed',
          );

          const user = await getUserByMatrixUserId(
            dbAdapter,
            '@testuser:localhost',
          );
          await waitUntil(
            async () => {
              const credits = await sumUpCreditsLedger(dbAdapter, {
                creditType: ['extra_credit', 'extra_credit_used'],
                userId: user!.id,
              });
              return credits === 49; // 50 - (0.001 * 1000) = 49
            },
            { timeoutMessage: 'Credits should be deducted (50 - 1 = 49)' },
          );
        } finally {
          mockFetch.restore();
          global.fetch = originalFetch;
        }
      });

      test('rejects requests without a JWT', async function (assert) {
        const response = await request
          .post('/_openrouter/chat/completions')
          .set('Accept', 'application/json')
          .set('Content-Type', 'application/json')
          .send({
            model: 'anthropic/claude-opus-4-7',
            messages: [{ role: 'user', content: 'Hello' }],
          });
        assert.strictEqual(response.status, 401);
      });

      test('rejects when the user has no credits', async function (assert) {
        // Drain credits below the threshold.
        const user = await getUserByMatrixUserId(
          dbAdapter,
          '@testuser:localhost',
        );
        if (user) {
          await addToCreditsLedger(dbAdapter, {
            userId: user.id,
            creditAmount: -50,
            creditType: 'extra_credit_used',
            subscriptionCycleId: null,
          });
        }

        const jwt = createRealmServerJWT(
          { user: '@testuser:localhost', sessionRoom: 'test-session-room' },
          realmSecretSeed,
        );

        const response = await request
          .post('/_openrouter/chat/completions')
          .set('Accept', 'application/json')
          .set('Content-Type', 'application/json')
          .set('Authorization', `Bearer ${jwt}`)
          .send({
            model: 'anthropic/claude-opus-4-7',
            messages: [{ role: 'user', content: 'Hello' }],
          });

        assert.strictEqual(response.status, 403);
      });

      test('rejects a non-JSON body with 400', async function (assert) {
        const jwt = createRealmServerJWT(
          { user: '@testuser:localhost', sessionRoom: 'test-session-room' },
          realmSecretSeed,
        );

        const response = await request
          .post('/_openrouter/chat/completions')
          .set('Accept', 'application/json')
          .set('Content-Type', 'application/json')
          .set('Authorization', `Bearer ${jwt}`)
          .send('not json');

        assert.strictEqual(response.status, 400);
      });
    },
  );
});
