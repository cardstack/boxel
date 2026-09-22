import QUnit from 'qunit';
const { module, test } = QUnit;
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
  createJWT,
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
import { MAX_IN_FLIGHT_CALLS_PER_USER } from '../lib/billable-call.ts';

module(basename(import.meta.filename), function () {
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

    function sendChatForward(jwt: string) {
      return request
        .post('/_request-forward')
        .set('Accept', 'application/json')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${jwt}`)
        .send({
          url: 'https://openrouter.ai/api/v1/chat/completions',
          method: 'POST',
          requestBody: JSON.stringify({
            model: 'openai/gpt-3.5-turbo',
            messages: [{ role: 'user', content: 'Hi' }],
          }),
        });
    }

    async function inFlightReservations(): Promise<number> {
      let [{ count }] = await dbAdapter.execute(
        `SELECT COUNT(*) AS count FROM billable_call_reservations WHERE matrix_user_id = '@testuser:localhost'`,
      );
      return Number(count);
    }

    setupDB(hooks, {
      beforeEach: async (_dbAdapter, _publisher, _runner) => {
        dbAdapter = _dbAdapter;
        publisher = _publisher;
        runner = _runner;
        testRealmDir = join(dir.name, 'realm_server_2', 'test');
        ensureDirSync(testRealmDir);
        copySync(fixtureDir('simple'), testRealmDir);

        // Set up allowed proxy destinations in database BEFORE starting server
        await dbAdapter.execute(
          `INSERT INTO proxy_endpoints (id, url, api_key, credit_strategy, supports_streaming, auth_method, auth_parameter_name, created_at, updated_at) 
           VALUES 
             (gen_random_uuid(), 'https://openrouter.ai/api/v1/chat/completions', 'openrouter-api-key', 'openrouter', true, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
             (gen_random_uuid(), 'https://api.example.com', 'example-api-key', 'no-credit', false, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
             (gen_random_uuid(), 'https://www.googleapis.com/customsearch/v1', 'google-api-key', 'no-credit', false, 'url-parameter', 'key', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
             (gen_random_uuid(), 'https://gateway.ai.cloudflare.com/v1/4a94a1eb2d21bbbe160234438a49f687/boxel/', 'cloudflare-api-key', 'no-credit', true, 'header', 'cf-aig-authorization', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT (url) 
           DO UPDATE SET 
             api_key = EXCLUDED.api_key,
             credit_strategy = EXCLUDED.credit_strategy,
             supports_streaming = EXCLUDED.supports_streaming,
             updated_at = CURRENT_TIMESTAMP`,
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
        AllowedProxyDestinations.reset();
        await closeServer(testRealmHttpServer);
      },
    });

    test('should forward request to OpenRouter and deduct credits', async function (assert) {
      // Mock external fetch calls
      const originalFetch = global.fetch;
      const mockFetch = sinon.stub(global, 'fetch');

      // Mock OpenRouter response (includes usage.cost so credits can be
      // deducted directly without polling the generation cost API)
      const mockOpenRouterResponse = {
        id: 'gen-test-123',
        choices: [{ text: 'Test response from OpenRouter' }],
        usage: { total_tokens: 150, cost: 0.003 },
      };

      // Set up fetch to return OpenRouter response
      mockFetch.callsFake(
        async (input: string | URL | Request, _init?: RequestInit) => {
          const url = typeof input === 'string' ? input : input.toString();

          if (url.includes('/chat/completions')) {
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

        // Verify fetch was called correctly (allowing unrelated fetches)
        const calls = mockFetch.getCalls();
        const chatCall = calls.find((call) => {
          const url = call.args[0];
          const href = typeof url === 'string' ? url : url?.toString();
          return Boolean(href && href.includes('/chat/completions'));
        });

        assert.ok(chatCall, 'Fetch should call chat completions');

        // Verify authorization header was set correctly
        const chatCallHeaders = chatCall!.args[1]?.headers as Record<
          string,
          string
        >;
        assert.true(
          chatCallHeaders?.Authorization?.startsWith('Bearer '),
          'Should set authorization header',
        );

        // Verify credits were deducted (0.003 USD * 1000 = 3 credits)
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
            return credits === 47;
          },
          { timeoutMessage: 'Credits should be deducted (50 - 3 = 47)' },
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

    test('should reject a URL that merely embeds an allowlisted string but targets another origin', async function (assert) {
      // The classic substring-smuggling exploit: the allowlisted
      // destination string appears in the query, but the request origin is
      // the attacker's. If this were accepted the server would attach the
      // real OpenRouter key while fetching attacker.example, leaking the
      // secret. No upstream fetch must happen.
      const originalFetch = global.fetch;
      const mockFetch = sinon.stub(global, 'fetch').callsFake(async () => {
        throw new Error('fetch should never be called for a rejected URL');
      });

      try {
        const jwt = createJWT(testRealm, '@testuser:localhost');

        const response = await request
          .post('/_request-forward')
          .set('Accept', 'application/json')
          .set('Content-Type', 'application/json')
          .set('Authorization', `Bearer ${jwt}`)
          .send({
            url: 'https://attacker.example/x?=https://openrouter.ai/api/v1/chat/completions',
            method: 'POST',
            requestBody: JSON.stringify({ model: 'x', messages: [] }),
          });

        assert.strictEqual(response.status, 400, 'Should return 400 status');
        assert.true(
          response.body.errors?.[0]?.includes('not whitelisted'),
          'Should reject the smuggled URL',
        );
        const forwarded = mockFetch.getCalls().some((call) => {
          const u = call.args[0];
          const s = typeof u === 'string' ? u : u?.toString();
          return Boolean(s && s.includes('attacker.example'));
        });
        assert.false(forwarded, 'Should not forward to the attacker origin');
      } finally {
        mockFetch.restore();
        global.fetch = originalFetch;
      }
    });

    test('should reject a look-alike host that has an allowlisted host as a prefix', async function (assert) {
      const jwt = createJWT(testRealm, '@testuser:localhost');

      const response = await request
        .post('/_request-forward')
        .set('Accept', 'application/json')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${jwt}`)
        .send({
          url: 'https://openrouter.ai.attacker.com/api/v1/chat/completions',
          method: 'POST',
          requestBody: JSON.stringify({ model: 'x', messages: [] }),
        });

      assert.strictEqual(response.status, 400, 'Should return 400 status');
      assert.true(
        response.body.errors?.[0]?.includes('not whitelisted'),
        'Should reject the look-alike host',
      );
    });

    test('should reject a path on an allowlisted origin that is not under the allowlisted path', async function (assert) {
      // openrouter.ai is allowlisted only at /api/v1/chat/completions, so a
      // different path on the same origin must not inherit the API key.
      const jwt = createJWT(testRealm, '@testuser:localhost');

      const response = await request
        .post('/_request-forward')
        .set('Accept', 'application/json')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${jwt}`)
        .send({
          url: 'https://openrouter.ai/api/v1/credits',
          method: 'GET',
        });

      assert.strictEqual(response.status, 400, 'Should return 400 status');
      assert.true(
        response.body.errors?.[0]?.includes('not whitelisted'),
        'Should reject a path outside the allowlisted prefix',
      );
    });

    test('should reject a path that shares a prefix segment but crosses a segment boundary', async function (assert) {
      // `/customsearch/v1` is allowlisted; `/customsearch/v1-evil` must not
      // match by raw string prefix.
      const jwt = createJWT(testRealm, '@testuser:localhost');

      const response = await request
        .post('/_request-forward')
        .set('Accept', 'application/json')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${jwt}`)
        .send({
          url: 'https://www.googleapis.com/customsearch/v1-evil?q=test',
          method: 'GET',
        });

      assert.strictEqual(response.status, 400, 'Should return 400 status');
      assert.true(
        response.body.errors?.[0]?.includes('not whitelisted'),
        'Should reject a path crossing a segment boundary',
      );
    });

    test('should handle streaming requests and deduct credits from inline cost', async function (assert) {
      // Mock external fetch calls
      const originalFetch = global.fetch;
      const mockFetch = sinon.stub(global, 'fetch');

      // Mock streaming response with usage.cost in the final data chunk
      const mockStreamResponse = new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'data: {"id":"gen-stream-123","choices":[{"delta":{"content":"Hello"}}]}\n\n',
              ),
            );
            controller.enqueue(
              new TextEncoder().encode(
                'data: {"choices":[{"delta":{"content":" world"}}],"usage":{"prompt_tokens":10,"completion_tokens":5,"cost":0.002}}\n\n',
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

      // Set up fetch to return streaming response (no generation cost API mock needed)
      mockFetch.callsFake(
        async (input: string | URL | Request, _init?: RequestInit) => {
          const url = typeof input === 'string' ? input : input.toString();

          if (url.includes('/chat/completions')) {
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
          responseText.includes('data: [DONE]'),
          'Should include end of stream marker',
        );

        // Verify credits were deducted from inline cost (0.002 USD * 1000 = 2 credits)
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
            return credits === 48;
          },
          { timeoutMessage: 'Credits should be deducted (50 - 2 = 48)' },
        );
      } finally {
        mockFetch.restore();
        global.fetch = originalFetch;
      }
    });

    test('should fall back to generation cost API when inline cost is missing', async function (assert) {
      // Mock streaming response WITHOUT usage.cost (simulates cancelled stream or missing cost)
      const originalFetch = global.fetch;
      const mockFetch = sinon.stub(global, 'fetch');

      const mockStreamResponse = new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'data: {"id":"gen-no-cost-456","choices":[{"delta":{"content":"Hello"}}]}\n\n',
              ),
            );
            // No usage.cost in any chunk
            controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
            controller.close();
          },
        }),
        {
          status: 200,
          headers: {
            'content-type': 'text/event-stream',
          },
        },
      );

      // Mock generation cost API response (fallback)
      const mockCostResponse = {
        data: {
          id: 'gen-no-cost-456',
          total_cost: 0.003,
        },
      };

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
            });
          }
        },
      );

      try {
        const jwt = createRealmServerJWT(
          { user: '@testuser:localhost', sessionRoom: 'test-session-room' },
          realmSecretSeed,
        );

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

        assert.strictEqual(response.status, 200, 'Should return 200 status');
        assert.true(
          response.text.includes('data: [DONE]'),
          'Should include end of stream marker',
        );

        // Verify credits were deducted via fallback (0.003 USD * 1000 = 3 credits)
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
            return credits === 47;
          },
          {
            timeoutMessage:
              'Credits should be deducted via fallback (50 - 3 = 47)',
          },
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
      assert.strictEqual(
        await inFlightReservations(),
        0,
        'a denied call takes no in-flight slot',
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
          'must include url and method fields',
        ),
        'Should return validation error',
      );
    });

    test('should forward request to Google Custom Search API with URL parameter authentication', async function (assert) {
      // Mock external fetch calls
      const originalFetch = global.fetch;
      const mockFetch = sinon.stub(global, 'fetch');

      // Mock Google Custom Search API response
      const mockGoogleResponse = {
        items: [
          {
            cardTitle: 'Test Image 1',
            link: 'https://example.com/image1.jpg',
            image: {
              thumbnailLink: 'https://example.com/thumb1.jpg',
              contextLink: 'https://example.com/page1',
              width: 800,
              height: 600,
            },
          },
        ],
        searchInformation: {
          totalResults: '1',
          searchTime: 0.5,
        },
      };

      // Set up fetch to return Google response
      mockFetch.callsFake(
        async (input: string | URL | Request, _init?: RequestInit) => {
          const url = typeof input === 'string' ? input : input.toString();

          if (url.includes('googleapis.com/customsearch/v1')) {
            return new Response(JSON.stringify(mockGoogleResponse), {
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
            url: 'https://www.googleapis.com/customsearch/v1?q=test&searchType=image&num=10',
            method: 'GET',
          });

        // Verify response
        assert.strictEqual(response.status, 200, 'Should return 200 status');
        assert.deepEqual(
          response.body,
          mockGoogleResponse,
          'Should return Google Custom Search response',
        );

        // Verify fetch was called to forward to Google. We find the
        // Google call by URL rather than asserting `calledOnce` —
        // background timers in the shared test prerender server
        // (heartbeat to prerender-manager, periodic queue snapshot,
        // etc.) also use `global.fetch` and can fire inside this
        // test's stub window, racing the Google forward call. The
        // test cares that the Google forward fetched with the right
        // URL + headers, not that nothing else touched fetch.
        const googleCall = mockFetch.getCalls().find((call) => {
          let raw = call.args[0];
          let s = typeof raw === 'string' ? raw : raw.toString();
          return s.includes('googleapis.com/customsearch/v1');
        });
        assert.ok(googleCall, 'fetch was invoked against Google Custom Search');
        const callUrl = googleCall!.args[0];
        const url = typeof callUrl === 'string' ? callUrl : callUrl.toString();
        assert.true(
          url.includes('key=google-api-key'),
          'URL should include API key as parameter',
        );
        assert.true(
          url.includes('q=test'),
          'URL should include original query parameters',
        );
        assert.true(
          url.includes('searchType=image'),
          'URL should include search type parameter',
        );
        assert.true(
          url.includes('num=10'),
          'URL should include number parameter',
        );

        // Verify no authorization header was set (since we're using URL parameters)
        const callHeaders = googleCall!.args[1]?.headers as Record<
          string,
          string
        >;
        assert.notOk(
          callHeaders?.Authorization,
          'Should not set authorization header for URL parameter auth',
        );
      } finally {
        mockFetch.restore();
        global.fetch = originalFetch;
      }
    });

    test('should forward request to Cloudflare AI Gateway with custom header token authentication', async function (assert) {
      // Mock external fetch calls
      const originalFetch = global.fetch;
      const mockFetch = sinon.stub(global, 'fetch');

      // Mock Cloudflare AI Gateway response
      const mockResponse = {
        example: 'ok',
      };

      // Set up fetch to return Cloudflare response
      mockFetch.callsFake(
        async (input: string | URL | Request, _init?: RequestInit) => {
          const url = typeof input === 'string' ? input : input.toString();

          if (
            url.includes(
              'gateway.ai.cloudflare.com/v1/4a94a1eb2d21bbbe160234438a49f687/boxel/',
            )
          ) {
            return new Response(JSON.stringify(mockResponse), {
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
            url: 'https://gateway.ai.cloudflare.com/v1/4a94a1eb2d21bbbe160234438a49f687/boxel/replicate/predictions',
            method: 'POST',
            requestBody: JSON.stringify({
              input: { prompt: 'What is Cloudflare?' },
            }),
          });

        // Verify response
        assert.strictEqual(response.status, 200, 'Should return 200 status');
        assert.deepEqual(
          response.body,
          mockResponse,
          'Should return AI Gateway response',
        );

        // Verify fetch was called correctly (at least once—there can be unrelated background fetches)
        assert.true(mockFetch.callCount >= 1, 'Fetch should be called');
        const calls = mockFetch.getCalls();

        // Find the Cloudflare call we care about
        const cloudflareCall = calls.find((call) => {
          const urlArg = call.args[0];
          const url = typeof urlArg === 'string' ? urlArg : urlArg.toString();
          return url.includes(
            'gateway.ai.cloudflare.com/v1/4a94a1eb2d21bbbe160234438a49f687/boxel/',
          );
        });
        assert.ok(cloudflareCall, 'Cloudflare request should be made');

        const callHeaders = cloudflareCall!.args[1]?.headers as Record<
          string,
          string
        >;
        assert.strictEqual(
          callHeaders['cf-aig-authorization'],
          'Bearer cloudflare-api-key',
          'request should include API key as cf-aig-authorization header',
        );

        // Verify no authorization header was set (since we're storing the replicate token at cloudflare)
        assert.notOk(
          callHeaders.Authorization,
          'Should not set authorization header when using header auth with authParameterName set',
        );
      } finally {
        mockFetch.restore();
        global.fetch = originalFetch;
      }
    });

    test('should forward multipart form data when multipart flag is set', async function (assert) {
      const originalFetch = global.fetch;
      const mockFetch = sinon.stub(global, 'fetch');

      mockFetch.callsFake(
        async (_input: string | URL | Request, _init?: RequestInit) => {
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
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
          .post('/_request-forward')
          .set('Accept', 'application/json')
          .set('Content-Type', 'application/json')
          .set('Authorization', `Bearer ${jwt}`)
          .send({
            url: 'https://api.example.com/upload',
            method: 'POST',
            multipart: true,
            requestBody: JSON.stringify({
              name: 'Test',
              requireSigned: false,
              file: {
                filename: 'hello.txt',
                content: Buffer.from('hello world', 'utf-8').toString('base64'),
                contentType: 'text/plain',
              },
            }),
          });

        assert.strictEqual(response.status, 200, 'Should return 200 status');
        assert.deepEqual(
          response.body,
          { ok: true },
          'Should pass along API response',
        );

        // Find the forwarded upload call by URL rather than capturing the most
        // recent stubbed call — background timers in the shared test prerender
        // server (heartbeat to prerender-manager, periodic queue snapshots,
        // etc.) also use `global.fetch` and can fire inside this test's stub
        // window, so the last call through the stub is not necessarily ours.
        const uploadCall = mockFetch.getCalls().find((call) => {
          let raw = call.args[0];
          let s = typeof raw === 'string' ? raw : raw.toString();
          return s.includes('api.example.com/upload');
        });
        if (!uploadCall) {
          // Diagnostic for the next failure: show what traffic the stub saw so
          // the racing fetch can be identified from CI output alone.
          console.error(
            'multipart forward call not found; stubbed fetch saw:',
            mockFetch.getCalls().map((c) => String(c.args[0])),
          );
        }
        assert.ok(uploadCall, 'fetch was invoked against the upload URL');
        const capturedInit = uploadCall?.args[1];

        const headersRecord =
          capturedInit?.headers instanceof Headers
            ? Object.fromEntries(capturedInit.headers.entries())
            : ((capturedInit?.headers as Record<string, string> | undefined) ??
              {});
        const contentTypeHeader = headersRecord['Content-Type'];

        assert.ok(contentTypeHeader, 'Content-Type header should be set');

        const boundaryMatch = /multipart\/form-data; boundary=(.*)$/.exec(
          contentTypeHeader as string,
        );
        assert.ok(
          boundaryMatch,
          'Content-Type should include multipart boundary',
        );

        const boundary = boundaryMatch?.[1];
        assert.ok(boundary, 'Boundary should be present in header');

        const bodyText = Buffer.from(capturedInit?.body as Uint8Array).toString(
          'utf-8',
        );
        assert.true(
          bodyText.includes(`--${boundary}`),
          'Body should include boundary markers',
        );
        assert.true(
          bodyText.includes(`Content-Disposition: form-data; name="name"`),
          'Body should include normal field part',
        );
        assert.true(
          bodyText.includes('Test'),
          'Body should include name value',
        );
        assert.true(
          bodyText.includes(`name="file"; filename="hello.txt"`),
          'Body should include file part with filename',
        );
        assert.true(
          bodyText.includes('Content-Type: text/plain'),
          'Body should include file content type',
        );
        assert.true(
          bodyText.includes('hello world'),
          'Body should include decoded file content',
        );
      } finally {
        mockFetch.restore();
        global.fetch = originalFetch;
      }
    });

    test("runs one user's concurrent calls in parallel up to the in-flight limit, and the next waits for a slot", async function (assert) {
      // A page that asks for several generations at once must get them
      // concurrently. Past the limit a call waits rather than failing, and
      // starts as soon as one of the user's calls finishes.
      const originalFetch = global.fetch;
      const mockFetch = sinon.stub(global, 'fetch');

      // Each upstream call is held open until the test releases it, so the
      // calls genuinely overlap.
      const upstreamCalls: Array<{ release: () => void }> = [];

      mockFetch.callsFake(async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (!url.includes('/chat/completions')) {
          return new Response(JSON.stringify({ error: 'Not found' }), {
            status: 404,
          });
        }
        let releaseFn!: () => void;
        const released = new Promise<void>((res) => (releaseFn = res));
        upstreamCalls.push({ release: releaseFn });
        const callNumber = upstreamCalls.length;
        await released;
        return new Response(
          JSON.stringify({
            id: `gen-${callNumber}`,
            choices: [{ text: 'ok' }],
            usage: { total_tokens: 10, cost: 0.002 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      });

      const pending: Promise<unknown>[] = [];
      try {
        const jwt = createRealmServerJWT(
          { user: '@testuser:localhost', sessionRoom: 'test-session-room' },
          realmSecretSeed,
        );
        const send = () => sendChatForward(jwt).then((r) => r);

        // supertest's Test is a thenable that only fires on `.then`, which
        // `send` calls, so every request is on the wire from here.
        for (let i = 0; i < MAX_IN_FLIGHT_CALLS_PER_USER + 1; i++) {
          pending.push(send());
        }

        await waitUntil(
          async () => upstreamCalls.length >= MAX_IN_FLIGHT_CALLS_PER_USER,
          {
            timeout: 15000,
            timeoutMessage: `${MAX_IN_FLIGHT_CALLS_PER_USER} same-user calls should reach upstream together`,
          },
        );
        // The call past the limit must still be waiting. Give it time it
        // would need to get through if it were not.
        await new Promise((r) => setTimeout(r, 1000));
        assert.strictEqual(
          upstreamCalls.length,
          MAX_IN_FLIGHT_CALLS_PER_USER,
          'the call past the in-flight limit waits instead of reaching upstream',
        );

        upstreamCalls[0].release();
        await waitUntil(
          async () => upstreamCalls.length === MAX_IN_FLIGHT_CALLS_PER_USER + 1,
          {
            timeout: 15000,
            timeoutMessage:
              'the waiting call should reach upstream once a slot frees',
          },
        );

        for (const call of upstreamCalls) call.release();
        const responses = (await Promise.all(pending)) as Array<{
          status: number;
        }>;
        assert.deepEqual(
          responses.map((r) => r.status),
          new Array(MAX_IN_FLIGHT_CALLS_PER_USER + 1).fill(200),
          'every call is served',
        );

        // Every call's cost lands (0.002 USD × 1000 = 2 credits each).
        const expected = 50 - 2 * (MAX_IN_FLIGHT_CALLS_PER_USER + 1);
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
            return credits === expected;
          },
          {
            timeoutMessage: `every call should be debited (${expected} credits left)`,
          },
        );
        assert.strictEqual(
          await inFlightReservations(),
          0,
          'every finished call gives its slot back',
        );
      } finally {
        // A failed assertion mid-flight would otherwise leave gated upstream
        // calls hanging the test process.
        for (const call of upstreamCalls) call.release();
        await Promise.allSettled(pending);
        mockFetch.restore();
        global.fetch = originalFetch;
      }
    });

    test('a client that leaves while waiting for a slot never reaches upstream', async function (assert) {
      // A call waiting at the in-flight limit has taken no slot yet. Its
      // client giving up must end the wait, and must not leave a slot taken
      // or an upstream call started once a slot frees.
      const originalFetch = global.fetch;
      const mockFetch = sinon.stub(global, 'fetch');

      const upstreamCalls: Array<{ release: () => void }> = [];
      mockFetch.callsFake(async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (!url.includes('/chat/completions')) {
          return new Response(JSON.stringify({ error: 'Not found' }), {
            status: 404,
          });
        }
        let releaseFn!: () => void;
        const released = new Promise<void>((res) => (releaseFn = res));
        upstreamCalls.push({ release: releaseFn });
        await released;
        return new Response(
          JSON.stringify({
            id: `gen-${upstreamCalls.length}`,
            choices: [{ text: 'ok' }],
            usage: { total_tokens: 10, cost: 0.002 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      });

      const jwt = createRealmServerJWT(
        { user: '@testuser:localhost', sessionRoom: 'test-session-room' },
        realmSecretSeed,
      );
      const running: Promise<unknown>[] = [];
      const waiting = sendChatForward(jwt);
      let waitingSettled: Promise<unknown> | undefined;
      try {
        for (let i = 0; i < MAX_IN_FLIGHT_CALLS_PER_USER; i++) {
          running.push(sendChatForward(jwt).then((r) => r));
        }
        await waitUntil(
          async () => upstreamCalls.length >= MAX_IN_FLIGHT_CALLS_PER_USER,
          {
            timeout: 15000,
            timeoutMessage: 'the first calls should fill every slot',
          },
        );

        // supertest's Test fires on `.then`; both outcomes are swallowed
        // because this is the request the test walks away from.
        waitingSettled = waiting.then(
          () => undefined,
          () => undefined,
        );
        // Long enough for the request to reach admission and start waiting.
        await new Promise((r) => setTimeout(r, 1000));
        waiting.abort();
        await waitingSettled;

        for (const call of upstreamCalls) call.release();
        await Promise.all(running);
        // Give a call that wrongly kept waiting the time it would need to be
        // admitted once the slots freed.
        await new Promise((r) => setTimeout(r, 3000));

        assert.strictEqual(
          upstreamCalls.length,
          MAX_IN_FLIGHT_CALLS_PER_USER,
          'the abandoned call never reaches upstream',
        );
        assert.strictEqual(
          await inFlightReservations(),
          0,
          'the abandoned call leaves no slot taken',
        );
      } finally {
        for (const call of upstreamCalls) call.release();
        await Promise.allSettled(running);
        await waitingSettled;
        mockFetch.restore();
        global.fetch = originalFetch;
      }
    });

    test("a call still resolving its cost does not hold up the user's next call", async function (assert) {
      // A response with no inline cost is priced by polling the provider,
      // which can take minutes. The user's next call must not wait on it.
      const originalFetch = global.fetch;
      const mockFetch = sinon.stub(global, 'fetch');

      let chatCalls = 0;
      let costLookupStarted = false;
      let releaseCostLookup!: () => void;
      const costLookupReleased = new Promise<void>(
        (res) => (releaseCostLookup = res),
      );

      mockFetch.callsFake(async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/generation?id=')) {
          costLookupStarted = true;
          await costLookupReleased;
          return new Response(
            JSON.stringify({ data: { id: 'gen-no-cost', total_cost: 0.003 } }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        if (url.includes('/chat/completions')) {
          chatCalls++;
          const body =
            chatCalls === 1
              ? { id: 'gen-no-cost', choices: [{ text: 'ok' }] }
              : {
                  id: `gen-${chatCalls}`,
                  choices: [{ text: 'ok' }],
                  usage: { total_tokens: 10, cost: 0.002 },
                };
          return new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ error: 'Not found' }), {
          status: 404,
        });
      });

      let first: Promise<unknown> | undefined;
      try {
        const jwt = createRealmServerJWT(
          { user: '@testuser:localhost', sessionRoom: 'test-session-room' },
          realmSecretSeed,
        );

        first = sendChatForward(jwt).then((r) => r);
        await waitUntil(async () => costLookupStarted, {
          timeout: 15000,
          timeoutMessage: 'the first call should start looking up its cost',
        });

        const second = await sendChatForward(jwt);
        assert.strictEqual(
          second.status,
          200,
          'the next call is served while the first is still being priced',
        );

        releaseCostLookup();
        await first;

        // 0.003 USD for the first and 0.002 USD for the second: 5 credits.
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
            return credits === 45;
          },
          { timeoutMessage: 'both calls should be debited (50 - 5 = 45)' },
        );
      } finally {
        releaseCostLookup();
        await first?.catch(() => undefined);
        mockFetch.restore();
        global.fetch = originalFetch;
      }
    });

    test('an in-flight reservation left behind by a dead replica stops counting once it expires', async function (assert) {
      // A replica that dies mid-call never gives its slot back. The row it
      // left must not lock the user out for good.
      for (let i = 0; i < MAX_IN_FLIGHT_CALLS_PER_USER; i++) {
        await dbAdapter.execute(
          `INSERT INTO billable_call_reservations (matrix_user_id, expires_at) VALUES ('@testuser:localhost', ${
            Date.now() - 1000
          })`,
        );
      }

      const originalFetch = global.fetch;
      const mockFetch = sinon.stub(global, 'fetch');
      mockFetch.callsFake(async () => {
        return new Response(
          JSON.stringify({
            id: 'gen-1',
            choices: [{ text: 'ok' }],
            usage: { total_tokens: 10, cost: 0.002 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      });

      try {
        const jwt = createRealmServerJWT(
          { user: '@testuser:localhost', sessionRoom: 'test-session-room' },
          realmSecretSeed,
        );
        const response = await sendChatForward(jwt);
        assert.strictEqual(response.status, 200, 'the call is served');
        assert.strictEqual(
          await inFlightReservations(),
          0,
          'the expired reservations are cleared',
        );
      } finally {
        mockFetch.restore();
        global.fetch = originalFetch;
      }
    });

    test('should return a 400 when multipart payload is not an object', async function (assert) {
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
          url: 'https://api.example.com/upload',
          method: 'POST',
          multipart: true,
          requestBody: JSON.stringify(['not-an-object']),
        });

      assert.strictEqual(response.status, 400, 'Should return 400 status');
      assert.true(
        response.body.errors?.[0]?.includes(
          'requestBody must be a JSON object when multipart is true',
        ),
        'Should return multipart validation error message',
      );
    });

    test('a forward whose client is still waiting is never cancelled', async function (assert) {
      // The signal has to distinguish a client that left from one that is
      // still there. Node closes the *request* stream as soon as its body has
      // been read — on every request, served or abandoned — so watching that
      // would cancel every forward the moment it started, which only the
      // response stream's close-without-having-been-written tells apart.
      const originalFetch = global.fetch;
      const mockFetch = sinon.stub(global, 'fetch');

      let forwardSignal: AbortSignal | undefined;
      let abortedDuringCall = false;

      mockFetch.callsFake(
        async (input: string | URL | Request, init?: RequestInit) => {
          const url = typeof input === 'string' ? input : input.toString();
          if (!url.includes('/chat/completions')) {
            return new Response(JSON.stringify({ error: 'Not found' }), {
              status: 404,
            });
          }
          forwardSignal = init?.signal ?? undefined;
          abortedDuringCall = forwardSignal?.aborted === true;
          return new Response(
            JSON.stringify({
              id: 'gen-uninterrupted',
              choices: [{ text: 'ok' }],
              usage: { total_tokens: 10, cost: 0.002 },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        },
      );

      try {
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
              messages: [{ role: 'user', content: 'Hi' }],
            }),
          });

        assert.strictEqual(response.status, 200, 'the forward is served');
        assert.false(
          abortedDuringCall,
          'the upstream call starts with a signal that has not fired',
        );
        assert.false(
          forwardSignal?.aborted,
          'a delivered forward is never cancelled',
        );
      } finally {
        mockFetch.restore();
        global.fetch = originalFetch;
      }
    });

    test('a client that disconnects mid-forward cancels the upstream call and gives back its in-flight slot', async function (assert) {
      // A forward occupies one of the user's in-flight slots for the whole
      // life of the upstream call, so a caller that walks away from a slow
      // model call would otherwise keep that slot for an answer nobody is
      // going to read.
      const originalFetch = global.fetch;
      const mockFetch = sinon.stub(global, 'fetch');

      // Upstream calls that never answer on their own — a generation still
      // running when its reader leaves. Each settles only when the test
      // releases it or its signal aborts, which is what a real fetch does
      // with an aborted signal.
      const upstreamCalls: Array<{
        signal: AbortSignal | undefined;
        release: () => void;
      }> = [];

      mockFetch.callsFake(
        async (input: string | URL | Request, init?: RequestInit) => {
          const url = typeof input === 'string' ? input : input.toString();
          if (!url.includes('/chat/completions')) {
            return new Response(JSON.stringify({ error: 'Not found' }), {
              status: 404,
            });
          }

          const signal = init?.signal ?? undefined;
          let releaseFn!: () => void;
          const released = new Promise<void>((res) => (releaseFn = res));
          upstreamCalls.push({ signal, release: releaseFn });

          await new Promise<void>((resolve, reject) => {
            released.then(resolve);
            signal?.addEventListener('abort', () => {
              const abortError = new Error('The operation was aborted');
              abortError.name = 'AbortError';
              reject(abortError);
            });
          });

          return new Response(
            JSON.stringify({
              id: `gen-${upstreamCalls.length}`,
              choices: [{ text: 'ok' }],
              usage: { total_tokens: 10, cost: 0.002 },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        },
      );

      const jwt = createRealmServerJWT(
        { user: '@testuser:localhost', sessionRoom: 'test-session-room' },
        realmSecretSeed,
      );
      const send = () =>
        request
          .post('/_request-forward')
          .set('Accept', 'application/json')
          .set('Content-Type', 'application/json')
          .set('Authorization', `Bearer ${jwt}`)
          .send({
            url: 'https://openrouter.ai/api/v1/chat/completions',
            method: 'POST',
            requestBody: JSON.stringify({
              model: 'openai/gpt-3.5-turbo',
              messages: [{ role: 'user', content: 'Hi' }],
            }),
          });

      const abandoned = send();
      // supertest's Test is a thenable, not an eagerly-evaluating Promise —
      // `.then` is what fires the request. Both outcomes are swallowed: this
      // is the request the test walks away from.
      const abandonedSettled = abandoned.then(
        () => undefined,
        () => undefined,
      );

      try {
        await waitUntil(async () => upstreamCalls.length >= 1, {
          timeout: 15000,
          timeoutMessage: 'first forward should reach the upstream stub',
        });

        abandoned.abort();

        await waitUntil(async () => upstreamCalls[0].signal?.aborted === true, {
          timeout: 15000,
          timeoutMessage:
            'the abandoned request should cancel its upstream call',
        });
        assert.true(
          Boolean(upstreamCalls[0].signal?.aborted),
          'the upstream call is cancelled when its client goes away',
        );

        await waitUntil(async () => (await inFlightReservations()) === 0, {
          timeout: 15000,
          timeoutMessage: 'the abandoned forward should give its slot back',
        });

        const second = send().then((r) => r);
        await waitUntil(async () => upstreamCalls.length >= 2, {
          timeout: 15000,
          timeoutMessage: 'the next same-user forward should reach upstream',
        });
        upstreamCalls[1].release();
        const response = await second;
        assert.strictEqual(
          response.status,
          200,
          'the next forward is served normally',
        );

        // Only the delivered call is billed (0.002 USD × 1000 = 2 credits).
        // A cancelled call never produces a response to charge for, so 46
        // here would mean the abandoned one was billed too.
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
            return credits === 48;
          },
          {
            timeoutMessage:
              'only the delivered forward should be debited (50 - 2 = 48)',
          },
        );
      } finally {
        // A failed assertion mid-flight would otherwise leave gated upstream
        // calls hanging the test process.
        for (const call of upstreamCalls) call.release();
        await abandonedSettled;
        mockFetch.restore();
        global.fetch = originalFetch;
      }
    });

    test('a client that disconnects mid-stream cancels the upstream stream and gives back its in-flight slot', async function (assert) {
      const originalFetch = global.fetch;
      const mockFetch = sinon.stub(global, 'fetch');

      // The first upstream stream emits a delta and then keeps generating —
      // no `[DONE]`, so nothing ever gets charged for it.
      // Erroring the body when the signal aborts stands in for what fetch
      // does to a response body once its request is cancelled.
      const streamSignals: Array<AbortSignal | undefined> = [];

      mockFetch.callsFake(
        async (input: string | URL | Request, init?: RequestInit) => {
          const url = typeof input === 'string' ? input : input.toString();
          if (!url.includes('/chat/completions')) {
            return new Response(JSON.stringify({ error: 'Not found' }), {
              status: 404,
            });
          }

          const signal = init?.signal ?? undefined;
          streamSignals.push(signal);
          const isFirstStream = streamSignals.length === 1;
          const encoder = new TextEncoder();

          const body = new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  `data: {"id":"gen-stream-${streamSignals.length}","choices":[{"delta":{"content":"Hello"}}]}\n\n`,
                ),
              );
              if (isFirstStream) {
                signal?.addEventListener('abort', () => {
                  const abortError = new Error('The operation was aborted');
                  abortError.name = 'AbortError';
                  controller.error(abortError);
                });
                return;
              }
              controller.enqueue(
                encoder.encode(
                  'data: {"choices":[{"delta":{"content":" world"}}],"usage":{"cost":0.002}}\n\n',
                ),
              );
              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
              controller.close();
            },
          });

          return new Response(body, {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          });
        },
      );

      const jwt = createRealmServerJWT(
        { user: '@testuser:localhost', sessionRoom: 'test-session-room' },
        realmSecretSeed,
      );
      const send = () =>
        request
          .post('/_request-forward')
          .set('Accept', 'text/event-stream')
          .set('Content-Type', 'application/json')
          .set('Authorization', `Bearer ${jwt}`)
          .send({
            url: 'https://openrouter.ai/api/v1/chat/completions',
            method: 'POST',
            requestBody: JSON.stringify({
              model: 'openai/gpt-3.5-turbo',
              messages: [{ role: 'user', content: 'Hi' }],
              stream: true,
            }),
            stream: true,
          });

      const abandoned = send();
      const abandonedSettled = abandoned.then(
        () => undefined,
        () => undefined,
      );

      try {
        await waitUntil(async () => streamSignals.length >= 1, {
          timeout: 15000,
          timeoutMessage: 'first stream should reach the upstream stub',
        });

        abandoned.abort();

        await waitUntil(async () => streamSignals[0]?.aborted === true, {
          timeout: 15000,
          timeoutMessage:
            'the abandoned stream should cancel its upstream stream',
        });
        assert.true(
          Boolean(streamSignals[0]?.aborted),
          'the upstream stream is cancelled when its client goes away',
        );
        await waitUntil(async () => (await inFlightReservations()) === 0, {
          timeout: 15000,
          timeoutMessage: 'the abandoned stream should give its slot back',
        });

        const response = await send();
        assert.strictEqual(
          response.status,
          200,
          'the next stream is served normally',
        );
        assert.true(
          response.text.includes('data: [DONE]'),
          'the next stream runs to completion',
        );
        assert.strictEqual(
          streamSignals.length,
          2,
          'exactly one upstream stream per forward',
        );

        // The cancelled stream never reached `[DONE]`, so only the completed
        // one is debited (0.002 USD × 1000 = 2 credits).
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
            return credits === 48;
          },
          {
            timeoutMessage:
              'only the completed stream should be debited (50 - 2 = 48)',
          },
        );
      } finally {
        await abandonedSettled;
        mockFetch.restore();
        global.fetch = originalFetch;
      }
    });
  });
});
