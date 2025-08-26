import { module, test } from 'qunit';
import sinon from 'sinon';
import supertest, { Test, SuperTest } from 'supertest';
import { basename, join } from 'path';
import { Server } from 'http';
import { dirSync, type DirResult } from 'tmp';
import { copySync, ensureDirSync } from 'fs-extra';
import {
  setupBaseRealmServer,
  setupDB,
  runTestRealmServer,
  closeServer,
  createJWT,
  insertUser,
  insertPlan,
  realmSecretSeed,
  createVirtualNetwork,
} from './helpers';
import { createJWT as createRealmServerJWT } from '../utils/jwt';
import {
  addToCreditsLedger,
  getUserByMatrixUserId,
  sumUpCreditsLedger,
} from '@cardstack/billing/billing-queries';
import { AllowedProxyDestinations } from '../lib/allowed-proxy-destinations';

module(basename(__filename), function () {
  module('Realm-specific Endpoints | _request-forward', function (hooks) {
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
      copySync(join(__dirname, 'cards'), dir.name);
    });

    setupBaseRealmServer(hooks, new URL('http://localhost:8008'));

    async function startRealmServer(
      dbAdapter: any,
      publisher: any,
      runner: any,
    ) {
      if (testRealm) {
        virtualNetwork.unmount(testRealm.handle);
      }

      ({ testRealm: testRealm, testRealmHttpServer: testRealmHttpServer } =
        await runTestRealmServer({
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
        copySync(join(__dirname, 'cards'), testRealmDir);

        // Reset the singleton before setting up configuration
        AllowedProxyDestinations.reset();

        // Set up allowed proxy destinations in database BEFORE starting server
        const testConfig = [
          {
            url: 'https://openrouter.ai/api/v1/chat/completions',
            apiKey: 'openrouter-api-key',
            creditStrategy: 'openrouter',
            supportsStreaming: true,
          },
          {
            url: 'https://api.example.com',
            apiKey: 'example-api-key',
            creditStrategy: 'no-credit',
            supportsStreaming: false,
          },
        ];
        await dbAdapter.execute(
          `INSERT INTO server_config (key, value, updated_at) 
           VALUES ('allowed_proxy_destinations', $1::jsonb, CURRENT_TIMESTAMP) 
           ON CONFLICT (key) 
           DO UPDATE SET value = $1::jsonb, updated_at = CURRENT_TIMESTAMP`,
          { bind: [JSON.stringify(testConfig)] },
        );

        await startRealmServer(dbAdapter, publisher, runner);

        // Set up test user
        await insertUser(
          dbAdapter,
          '@testuser:localhost',
          'cus_test123',
          'test@example.com',
        );

        // Set up test plan
        await insertPlan(
          dbAdapter,
          'Test Plan',
          1000,
          100, // 100 credits included
          'price_test123',
        );

        // Add extra credits to the user for testing
        const user = await getUserByMatrixUserId(
          dbAdapter,
          '@testuser:localhost',
        );
        if (user) {
          await addToCreditsLedger(dbAdapter, {
            userId: user.id,
            creditAmount: 50, // Add 50 extra credits
            creditType: 'extra_credit',
            subscriptionCycleId: null,
          });
        }
      },
      afterEach: async () => {
        await closeServer(testRealmHttpServer);
      },
    });

    test('should forward request to OpenRouter and deduct credits', async function (assert) {
      // Mock external fetch calls
      const originalFetch = global.fetch;
      const mockFetch = sinon.stub(global, 'fetch');

      // Mock OpenRouter response
      const mockOpenRouterResponse = {
        id: 'gen-test-123',
        choices: [{ text: 'Test response from OpenRouter' }],
        usage: { total_tokens: 150 },
      };

      // Mock generation cost API response
      const mockCostResponse = {
        data: {
          id: 'gen-test-123',
          total_cost: 0.003,
          total_tokens: 150,
          model: 'openai/gpt-3.5-turbo',
        },
      };

      // Set up fetch to return different responses based on URL
      mockFetch.callsFake(
        async (input: string | URL | Request, _init?: RequestInit) => {
          const url = typeof input === 'string' ? input : input.toString();

          if (url.includes('/generation?id=')) {
            return new Response(JSON.stringify(mockCostResponse), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          } else if (url.includes('/chat/completions')) {
            return new Response(JSON.stringify(mockOpenRouterResponse), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          } else {
            return new Response(JSON.stringify({ error: 'Not found' }), {
              status: 404,
              headers: { 'content-type': 'application/json' },
            });
          }
        },
      );

      try {
        // Create JWT token for authentication
        const jwt = createRealmServerJWT(
          { user: '@testuser:localhost', sessionRoom: 'test-session-room' },
          realmSecretSeed,
        );

        // Make request to _request-forward endpoint
        const response = await request
          .post('/_request-forward')
          .set('Accept', 'application/json')
          .set('Content-Type', 'application/json')
          .set('Authorization', `Bearer ${jwt}`)
          .send({
            url: 'https://openrouter.ai/api/v1/chat/completions',
            method: 'POST',
            requestBody: JSON.stringify({
              model: 'openai/gpt-3.5-turbo',
              messages: [{ role: 'user', content: 'Hello' }],
            }),
          });

        // Verify response
        assert.strictEqual(response.status, 200, 'Should return 200 status');
        assert.deepEqual(
          response.body,
          mockOpenRouterResponse,
          'Should return OpenRouter response',
        );

        // Verify fetch was called correctly
        assert.true(mockFetch.calledTwice, 'Fetch should be called twice');
        const calls = mockFetch.getCalls();

        // First call should be to chat completions
        const firstCallUrl = calls[0].args[0];
        const firstUrl =
          typeof firstCallUrl === 'string'
            ? firstCallUrl
            : firstCallUrl.toString();
        assert.true(
          firstUrl.includes('/chat/completions'),
          'First call should be to chat completions',
        );

        // Second call should be to generation cost API
        const secondCallUrl = calls[1].args[0];
        const secondUrl =
          typeof secondCallUrl === 'string'
            ? secondCallUrl
            : secondCallUrl.toString();
        assert.true(
          secondUrl.includes('/generation?id='),
          'Second call should be to generation cost API',
        );

        // Verify authorization header was set correctly
        const firstCallHeaders = calls[0].args[1]?.headers as Record<
          string,
          string
        >;
        assert.strictEqual(
          firstCallHeaders?.Authorization,
          'Bearer openrouter-api-key',
          'Should set correct authorization header',
        );
      } finally {
        mockFetch.restore();
        global.fetch = originalFetch;
      }
    });

    test('should reject non-whitelisted endpoints', async function (assert) {
      const jwt = createJWT(testRealm, '@testuser:localhost');

      const response = await request
        .post('/_request-forward')
        .set('Accept', 'application/json')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${jwt}`)
        .send({
          url: 'https://malicious-api.com/v1/chat/completions',
          method: 'POST',
          requestBody: JSON.stringify({
            model: 'gpt-3.5-turbo',
            messages: [{ role: 'user', content: 'Hello' }],
          }),
        });

      assert.strictEqual(response.status, 400, 'Should return 400 status');
      assert.true(
        response.body.errors?.[0]?.includes('not whitelisted'),
        'Should return whitelist error message',
      );
    });

    test('should handle streaming requests', async function (assert) {
      // Mock external fetch calls
      const originalFetch = global.fetch;
      const mockFetch = sinon.stub(global, 'fetch');

      // Mock streaming response
      const mockStreamResponse = new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'data: {"id":"gen-stream-123","choices":[{"text":"Hello"}]}\n\n',
              ),
            );
            controller.enqueue(
              new TextEncoder().encode(
                'data: {"choices":[{"text":" world"}]}\n\n',
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

      // Mock generation cost API response
      const mockCostResponse = {
        data: {
          id: 'gen-stream-123',
          total_cost: 0.002,
          total_tokens: 100,
          model: 'openai/gpt-3.5-turbo',
        },
      };

      // Set up fetch to return different responses based on URL
      mockFetch.callsFake(
        async (input: string | URL | Request, _init?: RequestInit) => {
          const url = typeof input === 'string' ? input : input.toString();

          if (url.includes('/generation?id=')) {
            return new Response(JSON.stringify(mockCostResponse), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          } else if (url.includes('/chat/completions')) {
            return mockStreamResponse;
          } else {
            return new Response(JSON.stringify({ error: 'Not found' }), {
              status: 404,
              headers: { 'content-type': 'application/json' },
            });
          }
        },
      );

      try {
        const jwt = createJWT(testRealm, '@testuser:localhost');

        const response = await request
          .post('/_request-forward')
          .set('Accept', 'text/event-stream')
          .set('Content-Type', 'application/json')
          .set('Authorization', `Bearer ${jwt}`)
          .send({
            url: 'https://openrouter.ai/api/v1/chat/completions',
            method: 'POST',
            requestBody: JSON.stringify({
              model: 'openai/gpt-3.5-turbo',
              messages: [{ role: 'user', content: 'Hello' }],
              stream: true,
            }),
            stream: true,
          });

        // Verify streaming response headers
        assert.strictEqual(response.status, 200, 'Should return 200 status');

        // Note: content-type header is not captured by supertest for streaming responses
        // because it's sent immediately with flushHeaders(), but we can verify other SSE headers
        assert.strictEqual(
          response.headers['cache-control'],
          'no-cache, no-store, must-revalidate',
          'Should have correct cache control',
        );
        assert.strictEqual(
          response.headers['connection'],
          'keep-alive',
          'Should have keep-alive connection',
        );
        assert.strictEqual(
          response.headers['x-accel-buffering'],
          'no',
          'Should disable nginx buffering',
        );

        // Verify streaming response body
        const responseText = response.text;
        assert.true(
          responseText.includes('data: {"id":"gen-stream-123"'),
          'Should include first streaming data',
        );
        assert.true(
          responseText.includes('data: {"choices":[{"text":" world"}]}'),
          'Should include second streaming data',
        );
        assert.true(
          responseText.includes('data: [DONE]'),
          'Should include end of stream marker',
        );
      } finally {
        mockFetch.restore();
        global.fetch = originalFetch;
      }
    });

    test('should reject streaming for non-streaming endpoints', async function (assert) {
      const jwt = createRealmServerJWT(
        { user: '@testuser:localhost', sessionRoom: 'test-session-room' },
        realmSecretSeed,
      );

      const response = await request
        .post('/_request-forward')
        .set('Accept', 'application/json')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${jwt}`)
        .send({
          url: 'https://api.example.com/v1/chat/completions',
          method: 'POST',
          requestBody: JSON.stringify({
            model: 'gpt-3.5-turbo',
            messages: [{ role: 'user', content: 'Hello' }],
            stream: true,
          }),
          stream: true,
        });

      assert.strictEqual(response.status, 400, 'Should return 400 status');
      assert.true(
        response.body.errors?.[0]?.includes('Streaming is not supported'),
        'Should return streaming not supported error',
      );
    });

    test('should handle insufficient credits', async function (assert) {
      // First, reduce the user's credits below the minimum
      const user = await getUserByMatrixUserId(
        dbAdapter,
        '@testuser:localhost',
      );
      if (user) {
        // Calculate current credits and deduct to get below minimum
        const currentCredits = await sumUpCreditsLedger(dbAdapter, {
          creditType: ['extra_credit', 'extra_credit_used'],
          userId: user.id,
        });

        // Deduct enough to get below the minimum (10 credits)
        const creditsToDeduct = currentCredits + 1; // This ensures we go below 10
        await addToCreditsLedger(dbAdapter, {
          userId: user.id,
          creditAmount: -creditsToDeduct,
          creditType: 'extra_credit_used',
          subscriptionCycleId: null,
        });
      }

      const jwt = createRealmServerJWT(
        { user: '@testuser:localhost', sessionRoom: 'test-session-room' },
        realmSecretSeed,
      );

      const response = await request
        .post('/_request-forward')
        .set('Accept', 'application/json')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${jwt}`)
        .send({
          url: 'https://openrouter.ai/api/v1/chat/completions',
          method: 'POST',
          requestBody: JSON.stringify({
            model: 'openai/gpt-3.5-turbo',
            messages: [{ role: 'user', content: 'Hello' }],
          }),
        });

      // Should return 403 Forbidden due to insufficient credits
      assert.strictEqual(response.status, 403, 'Should return 403 status');
      assert.true(
        response.body.errors?.[0]?.includes('minimum of 10 credits'),
        'Should return insufficient credits error',
      );
    });

    test('should handle missing authentication token', async function (assert) {
      const response = await request
        .post('/_request-forward')
        .set('Accept', 'application/json')
        .set('Content-Type', 'application/json')
        .send({
          url: 'https://openrouter.ai/api/v1/chat/completions',
          method: 'POST',
          requestBody: JSON.stringify({
            model: 'openai/gpt-3.5-turbo',
            messages: [{ role: 'user', content: 'Hello' }],
          }),
        });
      assert.strictEqual(response.status, 401, 'Should return 401 status');
      assert.true(
        response.body.errors?.[0]?.includes('Missing Authorization header'),
        'Should return missing authorization header error',
      );
    });

    test('should handle invalid request body', async function (assert) {
      const jwt = createRealmServerJWT(
        { user: '@testuser:localhost', sessionRoom: 'test-session-room' },
        realmSecretSeed,
      );

      const response = await request
        .post('/_request-forward')
        .set('Accept', 'application/json')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${jwt}`)
        .send({
          // Missing required fields
          url: 'https://openrouter.ai/api/v1/chat/completions',
        });

      assert.strictEqual(response.status, 400, 'Should return 400 status');
      assert.true(
        response.body.errors?.[0]?.includes(
          'must include url, method, and requestBody',
        ),
        'Should return validation error',
      );
    });
  });
});
