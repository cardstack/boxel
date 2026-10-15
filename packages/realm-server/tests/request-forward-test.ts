import QUnit from 'qunit';
const { module, test } = QUnit;
import sinon from 'sinon';
import type { Test, SuperTest } from 'supertest';
import supertest from 'supertest';
import { basename, join } from 'path';
import type { RealmHttpServer as Server } from '../server.ts';
import { dirSync } from 'tmp';
import fsExtra from 'fs-extra';
const { copySync, ensureDirSync } = fsExtra;
import {
  setupDB,
  setupTestDatabaseTemplate,
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
import { logger } from '@cardstack/runtime-common';
import {
  addToCreditsLedger,
  getUserByMatrixUserId,
  sumUpCreditsLedger,
} from '@cardstack/billing/billing-queries';
import { AllowedProxyDestinations } from '../lib/allowed-proxy-destinations.ts';
import { MAX_IN_FLIGHT_CALLS_PER_USER } from '../lib/billable-call.ts';
import {
  configureOutbound,
  OutboundRefusedError,
  resetOutbound,
} from '../lib/outbound/client.ts';
import {
  configureClientStall,
  resetClientStall,
} from '../lib/proxy-forward.ts';
import { startStubVendor, type StubVendor } from './helpers/stub-vendor.ts';
import * as Sentry from '@sentry/node';
import {
  startSentryCapture,
  type SentryCapture,
} from './helpers/sentry-capture.ts';
import { logLinesDuring, withLogDefinition } from './helpers/log-capture.ts';
import { leaksCredential } from './helpers/credential-leaks.ts';
import {
  installSecretsKeyring,
  LocalKeyProvider,
  resetSecretsAtRest,
} from '../lib/secrets-at-rest/index.ts';
import { sealProxyEndpointKeys } from '../lib/proxy-endpoint-keys.ts';

module(basename(import.meta.filename), function () {
  module('Realm-specific Endpoints | _request-forward', function (hooks) {
    let testRealmHttpServer: Server;
    let testRealm: any;
    let dbAdapter: any;
    let publisher: any;
    let runner: any;
    let request: SuperTest<Test>;

    let virtualNetwork = createVirtualNetwork();

    async function startRealmServer(
      dbAdapter: any,
      publisher: any,
      runner: any,
    ) {
      if (testRealm) {
        virtualNetwork.unmount(testRealm.handle);
      }

      let dir = dirSync();
      let testRealmDir = join(dir.name, 'realm_server_2', 'test');
      ensureDirSync(testRealmDir);
      copySync(fixtureDir('simple'), testRealmDir);

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

    async function stopRealmServer() {
      AllowedProxyDestinations.reset();
      await closeServer(testRealmHttpServer);
    }

    // The realm `startRealmServer` brings up is indexed once, into a template
    // database each test starts from, rather than from scratch before each
    // test.
    let templateDatabase = setupTestDatabaseTemplate(hooks, {
      key: import.meta.filename,
      build: async ({ dbAdapter, publisher, runner }) => {
        await startRealmServer(dbAdapter, publisher, runner);
        return stopRealmServer;
      },
    });

    setupDB(hooks, {
      templateDatabase,
      beforeEach: async (_dbAdapter, _publisher, _runner) => {
        dbAdapter = _dbAdapter;
        publisher = _publisher;
        runner = _runner;

        // Set up allowed proxy destinations in database BEFORE starting server
        await dbAdapter.execute(
          `INSERT INTO proxy_endpoints (id, url, api_key, credit_strategy, supports_streaming, auth_method, auth_parameter_name, created_at, updated_at) 
           VALUES 
             (gen_random_uuid(), 'https://openrouter.ai/api/v1/chat/completions', 'sk-or-v1-test-5c1d8e2f9a73b046', 'openrouter', true, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
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
      afterEach: stopRealmServer,
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

    // These forwards reach a real socket: the stub vendor on loopback, which
    // the development allowlist names, so they pass through the outbound
    // guard exactly as a deployed forward does.
    module('through the outbound guard', function (hooks) {
      let vendor: StubVendor;

      hooks.before(async function () {
        vendor = await startStubVendor();
      });
      hooks.after(async function () {
        await vendor.close();
      });
      hooks.beforeEach(async function () {
        vendor.requests.length = 0;
        configureOutbound({ devAllowlist: ['127.0.0.1', 'localhost'] });
        await dbAdapter.execute(
          `INSERT INTO proxy_endpoints (id, url, api_key, credit_strategy, supports_streaming, auth_method, auth_parameter_name, created_at, updated_at)
           VALUES
             (gen_random_uuid(), '${vendor.url}/', 'stub-vendor-key', 'openrouter', true, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
             (gen_random_uuid(), 'https://10.0.0.1/', 'private-key', 'no-credit', false, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        );
        AllowedProxyDestinations.reset();
      });
      hooks.afterEach(function () {
        resetOutbound();
      });

      function jwt() {
        return createRealmServerJWT(
          { user: '@testuser:localhost', sessionRoom: 'test-session-room' },
          realmSecretSeed,
        );
      }

      // Answers OpenRouter generation-cost lookups with `costInUsd` and lets
      // every other request through, returning the ids looked up.
      function stubGenerationCost(costInUsd: number): string[] {
        let lookups: string[] = [];
        let realFetch = global.fetch.bind(globalThis);
        sinon
          .stub(global, 'fetch')
          .callsFake(
            async (input: string | URL | Request, init?: RequestInit) => {
              let url =
                typeof input === 'string'
                  ? input
                  : input instanceof URL
                    ? input.href
                    : input.url;
              let match = /\/api\/v1\/generation\?id=([^&]+)/.exec(url);
              if (match) {
                lookups.push(decodeURIComponent(match[1]));
                return new Response(
                  JSON.stringify({
                    data: { id: match[1], total_cost: costInUsd },
                  }),
                  {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                  },
                );
              }
              return realFetch(input, init);
            },
          );
        return lookups;
      }

      async function extraCredits(): Promise<number> {
        let user = await getUserByMatrixUserId(
          dbAdapter,
          '@testuser:localhost',
        );
        return await sumUpCreditsLedger(dbAdapter, {
          creditType: ['extra_credit', 'extra_credit_used'],
          userId: user!.id,
        });
      }

      // Forwards a POST to `url` and walks away once the first of the body
      // has arrived.
      async function abandonMidBody(url: string): Promise<void> {
        await new Promise<void>((resolve, reject) => {
          let forward = request
            .post('/_request-forward')
            .set('Accept', 'application/json')
            .set('Content-Type', 'application/json')
            .set('Authorization', `Bearer ${jwt()}`)
            .send({ url, method: 'POST', requestBody: JSON.stringify({}) })
            .buffer(true)
            .parse((res, callback) => {
              res.once('data', () => {
                forward.abort();
                resolve();
              });
              // Answered once, whichever way the abandoned response ends.
              let answered = false;
              let answer = () => {
                if (!answered) {
                  answered = true;
                  callback(null, null);
                }
              };
              res.on('end', answer);
              res.on('error', answer);
            });
          forward.then(
            () => reject(new Error('the forward completed before it was left')),
            () => resolve(),
          );
        });
      }

      test("the incoming request's own headers never reach the vendor", async function (assert) {
        let token = jwt();
        let response = await request
          .post('/_request-forward')
          .set('Accept', 'application/json')
          .set('Content-Type', 'application/json')
          .set('Authorization', `Bearer ${token}`)
          .set('Cookie', 'session=browser-session')
          .set('X-Boxel-Consuming-Realm', 'http://127.0.0.1:4445/test/')
          .set('X-Custom-Incoming', 'from-the-browser')
          .send({
            url: `${vendor.url}/echo`,
            method: 'POST',
            requestBody: JSON.stringify({ hello: 'vendor' }),
            headers: { 'X-Vendor-Option': 'kept' },
          });

        assert.strictEqual(response.status, 200);
        assert.strictEqual(
          vendor.requests.length,
          1,
          'one call reached the vendor',
        );
        let received = vendor.requests[0].headers;
        assert.strictEqual(
          received.authorization,
          'Bearer stub-vendor-key',
          'the vendor sees the stored credential, not the caller session token',
        );
        assert.false(
          JSON.stringify(received).includes(token),
          'the session token appears nowhere in what the vendor received',
        );
        assert.notOk(received.cookie, 'no cookie is forwarded');
        assert.notOk(
          received['x-custom-incoming'],
          'no incoming header is forwarded',
        );
        assert.false(
          Object.keys(received).some((name) => name.startsWith('x-boxel-')),
          'no X-Boxel header is forwarded',
        );
        assert.strictEqual(
          received['x-vendor-option'],
          'kept',
          "the body's own headers are sent",
        );
        assert.strictEqual(vendor.requests[0].body, '{"hello":"vendor"}');
      });

      test('a credential slot in a forward is sent as the text it is, never filled', async function (assert) {
        let response = await request
          .post('/_request-forward')
          .set('Accept', 'application/json')
          .set('Content-Type', 'application/json')
          .set('Authorization', `Bearer ${jwt()}`)
          .send({
            url: `${vendor.url}/echo`,
            method: 'POST',
            requestBody: JSON.stringify({ token: '{{apiKey}}' }),
            headers: { 'X-Vendor-Key': '{{userKey}}' },
          });

        assert.strictEqual(response.status, 200);
        assert.strictEqual(
          vendor.requests[0].headers['x-vendor-key'],
          '{{userKey}}',
          'the header carries the slot as written',
        );
        assert.strictEqual(
          vendor.requests[0].body,
          '{"token":"{{apiKey}}"}',
          'the body carries the slot as written',
        );
      });

      // The same forward with the endpoint's key sealed into its sealed
      // columns, as the startup backfill leaves it.
      module('with the key sealed', function (hooks) {
        hooks.beforeEach(async function () {
          installSecretsKeyring(await new LocalKeyProvider().loadDataKeys());
          await sealProxyEndpointKeys(dbAdapter);
          AllowedProxyDestinations.reset();
        });
        hooks.afterEach(function () {
          resetSecretsAtRest();
        });

        function forwardToEcho() {
          return request
            .post('/_request-forward')
            .set('Accept', 'application/json')
            .set('Content-Type', 'application/json')
            .set('Authorization', `Bearer ${jwt()}`)
            .send({
              url: `${vendor.url}/echo`,
              method: 'POST',
              requestBody: JSON.stringify({ hello: 'vendor' }),
            });
        }

        test('the vendor receives the sealed key', async function (assert) {
          let [row] = await dbAdapter.execute(
            `SELECT api_key_ciphertext IS NOT NULL AS sealed FROM proxy_endpoints WHERE url = $1`,
            { bind: [`${vendor.url}/`] },
          );
          assert.true(row.sealed, 'the endpoint key is sealed');

          let response = await forwardToEcho();

          assert.strictEqual(response.status, 200);
          assert.strictEqual(
            vendor.requests[0].headers.authorization,
            'Bearer stub-vendor-key',
          );
        });

        test('a key edited by hand reaches the vendor before the backfill seals it again', async function (assert) {
          await dbAdapter.execute(
            `UPDATE proxy_endpoints SET api_key = 'stub-vendor-key-edited' WHERE url = $1`,
            { bind: [`${vendor.url}/`] },
          );
          AllowedProxyDestinations.reset();

          let response = await forwardToEcho();

          assert.strictEqual(response.status, 200);
          assert.strictEqual(
            vendor.requests[0].headers.authorization,
            'Bearer stub-vendor-key-edited',
          );
        });
      });

      test('an X-Boxel header in the forwarded headers is refused', async function (assert) {
        let response = await request
          .post('/_request-forward')
          .set('Accept', 'application/json')
          .set('Content-Type', 'application/json')
          .set('Authorization', `Bearer ${jwt()}`)
          .send({
            url: `${vendor.url}/echo`,
            method: 'POST',
            requestBody: JSON.stringify({ hello: 'vendor' }),
            headers: { 'x-boxel-realm-url': 'http://127.0.0.1:4445/test/' },
          });

        assert.strictEqual(response.status, 400);
        assert.true(
          JSON.stringify(response.body).includes('x-boxel-realm-url'),
          'the refusal names the header',
        );
        assert.strictEqual(
          vendor.requests.length,
          0,
          'nothing reached the vendor',
        );
      });

      test('an allowlisted destination on a private address is refused', async function (assert) {
        let response = await request
          .post('/_request-forward')
          .set('Accept', 'application/json')
          .set('Content-Type', 'application/json')
          .set('Authorization', `Bearer ${jwt()}`)
          .send({
            url: 'https://10.0.0.1/v1/things',
            method: 'POST',
            requestBody: JSON.stringify({}),
          });

        assert.strictEqual(response.status, 502);
        assert.false(
          JSON.stringify(response.body).includes('private-key'),
          'the refusal does not carry the credential',
        );
        assert.strictEqual(
          await inFlightReservations(),
          0,
          'the slot is given back',
        );
      });

      test("a vendor's error status passes through", async function (assert) {
        let response = await request
          .post('/_request-forward')
          .set('Accept', 'application/json')
          .set('Content-Type', 'application/json')
          .set('Authorization', `Bearer ${jwt()}`)
          .send({
            url: `${vendor.url}/status/429`,
            method: 'POST',
            requestBody: JSON.stringify({}),
          });

        assert.strictEqual(response.status, 429);
        assert.deepEqual(response.body, { status: 429 });
      });

      test('a vendor echoing the header system key returns nothing of it to the caller', async function (assert) {
        let response = await request
          .post('/_request-forward')
          .set('Accept', 'application/json')
          .set('Content-Type', 'application/json')
          .set('Authorization', `Bearer ${jwt()}`)
          .send({
            url: `${vendor.url}/echo`,
            method: 'POST',
            requestBody: JSON.stringify({ hello: 'vendor' }),
          });

        assert.strictEqual(response.status, 200);
        assert.strictEqual(
          vendor.requests[0]?.headers.authorization,
          'Bearer stub-vendor-key',
          'the vendor received the key',
        );
        assert.false(
          response.text.includes('stub-vendor-key'),
          `the key is not in the response: ${response.text}`,
        );
        assert.strictEqual(
          response.body.headers.authorization,
          'Bearer [REDACTED]',
        );
        assert.strictEqual(
          response.body.body,
          '{"hello":"vendor"}',
          'the rest of the echo is unchanged',
        );
      });

      test('a vendor echoing the url-parameter system key returns nothing of it to the caller', async function (assert) {
        await dbAdapter.execute(
          `INSERT INTO proxy_endpoints (id, url, api_key, credit_strategy, supports_streaming, auth_method, auth_parameter_name, created_at, updated_at)
           VALUES (gen_random_uuid(), '${vendor.alternateUrl}/echo', 'stub-param-key-7f3e9a', 'no-credit', false, 'url-parameter', 'key', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        );
        AllowedProxyDestinations.reset();
        let response = await request
          .post('/_request-forward')
          .set('Accept', 'application/json')
          .set('Content-Type', 'application/json')
          .set('Authorization', `Bearer ${jwt()}`)
          .send({
            url: `${vendor.alternateUrl}/echo?q=boxel`,
            method: 'POST',
            requestBody: JSON.stringify({}),
          });

        assert.strictEqual(response.status, 200);
        assert.strictEqual(
          vendor.requests[0]?.path,
          '/echo?q=boxel&key=stub-param-key-7f3e9a',
          'the vendor received the key in its query string',
        );
        assert.false(
          response.text.includes('stub-param-key-7f3e9a'),
          `the key is not in the response: ${response.text}`,
        );
        assert.strictEqual(response.body.path, '/echo?q=boxel&key=[REDACTED]');
      });

      test('a streamed error echoing the system key reaches neither the caller nor the log', async function (assert) {
        let log = logger('proxy-forward');
        let logged: string[] = [];
        let originalFactory = log.methodFactory;
        let originalLevel = log.getLevel();
        log.methodFactory = (methodName, level, loggerName) => {
          let raw = originalFactory(methodName, level, loggerName);
          return (...args: unknown[]) => {
            logged.push(args.map(String).join(' '));
            raw(...args);
          };
        };
        log.setLevel('trace');
        let response;
        try {
          response = await request
            .post('/_request-forward')
            .set('Accept', 'text/event-stream')
            .set('Content-Type', 'application/json')
            .set('Authorization', `Bearer ${jwt()}`)
            .send({
              url: `${vendor.url}/respond`,
              method: 'POST',
              requestBody: JSON.stringify({
                status: 401,
                headers: { 'content-type': 'application/json' },
                chunks: [
                  '{"error":"Invalid key ',
                  Buffer.from('Bearer stub-vendor-key').toString('base64'),
                  ' (stub-vendor-key)"}',
                ],
              }),
              stream: true,
            });
        } finally {
          log.methodFactory = originalFactory;
          log.setLevel(originalLevel);
        }

        assert.strictEqual(response.status, 401);
        assert.true(response.text.includes('Invalid key'));
        assert.false(
          response.text.includes('stub-vendor-key'),
          `the key is not in the response: ${response.text}`,
        );
        assert.false(
          response.text.includes(
            // The part of the encoding made only of the key's own bytes.
            Buffer.from('Bearer stub-vendor-key').toString('base64').slice(12),
          ),
          'nor is its base64 form',
        );
        assert.true(
          logged.some((line) => line.includes('Invalid key')),
          'the vendor error is logged',
        );
        assert.false(
          logged.some((line) => line.includes('stub-vendor-key')),
          'without the key',
        );
      });

      test('a multi-megabyte JSON response reaches the caller as it arrives, and is charged from its usage', async function (assert) {
        // The vendor sends everything but the usage at the end and then
        // waits. The caller is sent megabytes before that wait ends only if
        // the forward passes the body on as it arrives instead of holding
        // it until it is whole.
        const bodyBytes = 4 * 1024 * 1024;
        const releaseAfterBytes = 2 * 1024 * 1024;
        let receivedBytes = 0;
        let receivedBeforeRelease: number | undefined;
        let release = () => {
          if (receivedBeforeRelease === undefined) {
            receivedBeforeRelease = receivedBytes;
            vendor.releaseHeld();
          }
        };
        // If the forward buffers, nothing arrives until the vendor finishes;
        // let it finish so the test fails on its assertion rather than
        // timing out.
        let fallback = setTimeout(release, 10_000);

        let response;
        try {
          response = await request
            .post('/_request-forward')
            .set('Accept', 'application/json')
            .set('Content-Type', 'application/json')
            .set('Authorization', `Bearer ${jwt()}`)
            .send({
              url: `${vendor.url}/completion?bytes=${bodyBytes}&cost=0.004&hold=1`,
              method: 'POST',
              requestBody: JSON.stringify({ model: 'image-model' }),
            })
            .buffer(true)
            .parse((res, callback) => {
              let chunks: Buffer[] = [];
              res.on('data', (chunk: Buffer) => {
                chunks.push(chunk);
                receivedBytes += chunk.length;
                if (receivedBytes >= releaseAfterBytes) {
                  release();
                }
              });
              res.on('end', () =>
                callback(null, Buffer.concat(chunks).toString('utf8')),
              );
              res.on('error', (error: Error) => callback(error, null));
            });
        } finally {
          clearTimeout(fallback);
        }

        assert.strictEqual(response.status, 200);
        assert.strictEqual(
          response.headers['content-type'],
          'application/json',
        );
        assert.true(
          (receivedBeforeRelease ?? 0) >= releaseAfterBytes,
          `the caller received ${receivedBeforeRelease} bytes before the vendor finished the body`,
        );
        let body = JSON.parse(response.body as string);
        assert.strictEqual(body.id, 'gen-completion');
        assert.strictEqual(
          body.choices[0].message.content,
          'A'.repeat(bodyBytes),
          'the body arrives intact',
        );
        assert.deepEqual(body.usage, { cost: 0.004 });

        // The response completes only once the call is settled, so the
        // charge and the slot are read straight away, without waiting.
        // 0.004 USD × 1000 = 4 credits.
        assert.strictEqual(
          await extraCredits(),
          46,
          'the call is charged (50 - 4 = 46) by the time its response completes',
        );
        assert.strictEqual(
          await inFlightReservations(),
          0,
          'the slot is given back by the time the response completes',
        );
      });

      test('a JSON response cut off after its generation id resets the caller and is charged for the generation', async function (assert) {
        let lookups = stubGenerationCost(0.003);
        try {
          // The vendor drops the connection only once the caller has the
          // start of the body, so the cut lands after the response began.
          let outcome = await new Promise<string>((resolve) => {
            request
              .post('/_request-forward')
              .set('Accept', 'application/json')
              .set('Content-Type', 'application/json')
              .set('Authorization', `Bearer ${jwt()}`)
              .send({
                url: `${vendor.url}/completion?bytes=${256 * 1024}&hold=1&truncate=1`,
                method: 'POST',
                requestBody: JSON.stringify({}),
              })
              .buffer(true)
              .parse((res, callback) => {
                res.once('data', () => vendor.releaseHeld());
                res.on('data', () => undefined);
                res.on('end', () => {
                  resolve('complete');
                  callback(null, null);
                });
                res.on('aborted', () => resolve('reset'));
                res.on('error', () => resolve('reset'));
                res.on('close', () => resolve('reset'));
              })
              .then(
                () => undefined,
                () => resolve('reset'),
              );
          });

          assert.strictEqual(
            outcome,
            'reset',
            'the caller cannot take the partial body for a whole one',
          );
          // The usage never arrived; the generation is priced by its id.
          // 0.003 USD × 1000 = 3 credits.
          await waitUntil(async () => (await extraCredits()) === 47, {
            timeoutMessage:
              'the generation should be charged from its id (50 - 3 = 47)',
          });
          assert.deepEqual(lookups, ['gen-completion']);
        } finally {
          sinon.restore();
        }
      });

      test('a charged call whose caller stops reading without leaving is given up on, read to its end and charged', async function (assert) {
        configureClientStall(500);
        // Any generation lookup would mean the usage at the end was never
        // read.
        let lookups = stubGenerationCost(0.003);
        let forward: ReturnType<typeof request.post> | undefined;
        try {
          // Far more than the socket buffers between the vendor and the
          // caller hold, so a caller that never reads holds the forward up.
          forward = request
            .post('/_request-forward')
            .set('Accept', 'application/json')
            .set('Content-Type', 'application/json')
            .set('Authorization', `Bearer ${jwt()}`)
            .send({
              url: `${vendor.url}/completion?bytes=${24 * 1024 * 1024}&cost=0.004`,
              method: 'POST',
              requestBody: JSON.stringify({}),
            })
            .buffer(true)
            .parse((res, _callback) => {
              // The node parser is handed the raw incoming message.
              (res as unknown as NodeJS.ReadableStream).pause();
            });
          forward.then(
            () => undefined,
            () => undefined,
          );

          // 0.004 USD × 1000 = 4 credits, from the usage at the end of the
          // body, read once the stalled caller was given up on.
          await waitUntil(async () => (await extraCredits()) === 46, {
            timeout: 20000,
            timeoutMessage:
              'the stalled call should be charged from its usage (50 - 4 = 46)',
          });
          assert.deepEqual(lookups, [], 'no generation was looked up');
          await waitUntil(async () => (await inFlightReservations()) === 0, {
            timeoutMessage: 'the slot should be given back',
          });
        } finally {
          forward?.abort();
          sinon.restore();
          resetClientStall();
        }
      });

      test('a charged call whose caller leaves mid-body is still read to its end and charged', async function (assert) {
        let abandonedBefore = vendor.abandonedResponses();
        await abandonMidBody(
          `${vendor.url}/completion?bytes=${512 * 1024}&cost=0.004&hold=1`,
        );
        // The caller is gone; the vendor now sends the usage that prices the
        // call.
        vendor.releaseHeld();

        await waitUntil(async () => (await extraCredits()) === 46, {
          timeoutMessage:
            'the call should be charged from the usage at the end (50 - 4 = 46)',
        });
        assert.strictEqual(
          vendor.abandonedResponses(),
          abandonedBefore,
          "the vendor's response was read to its end",
        );
        await waitUntil(async () => (await inFlightReservations()) === 0, {
          timeoutMessage: 'the slot should be given back',
        });
      });

      test('an uncharged call whose caller leaves mid-body cancels the upstream body', async function (assert) {
        // The same vendor under its other name, as a destination that is not
        // charged for.
        configureOutbound({ devAllowlist: ['127.0.0.1', 'localhost'] });
        await dbAdapter.execute(
          `INSERT INTO proxy_endpoints (id, url, api_key, credit_strategy, supports_streaming, auth_method, auth_parameter_name, created_at, updated_at)
           VALUES (gen_random_uuid(), '${vendor.alternateUrl}/', 'stub-vendor-free-key', 'no-credit', false, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        );
        AllowedProxyDestinations.reset();

        // The vendor holds the rest of the body back and never sends it, so
        // only the caller leaving can end the read.
        let abandonedBefore = vendor.abandonedResponses();
        await abandonMidBody(
          `${vendor.alternateUrl}/completion?bytes=${512 * 1024}&hold=1`,
        );

        await waitUntil(
          async () => vendor.abandonedResponses() === abandonedBefore + 1,
          {
            timeoutMessage:
              "the caller leaving should cancel the vendor's held response",
          },
        );
        await waitUntil(async () => (await inFlightReservations()) === 0, {
          timeoutMessage: 'the slot should be given back',
        });
        assert.strictEqual(await extraCredits(), 50, 'nothing is charged');
      });

      test('a vendor answer that is not JSON is answered with a 500 and charges nothing', async function (assert) {
        let response = await request
          .post('/_request-forward')
          .set('Accept', 'application/json')
          .set('Content-Type', 'application/json')
          .set('Authorization', `Bearer ${jwt()}`)
          .send({
            url: `${vendor.url}/not-json`,
            method: 'POST',
            requestBody: JSON.stringify({}),
          });

        assert.strictEqual(response.status, 500);
        assert.false(
          response.text.includes('Bad gateway'),
          "the vendor's page is not passed on",
        );
        let user = await getUserByMatrixUserId(
          dbAdapter,
          '@testuser:localhost',
        );
        assert.strictEqual(
          await sumUpCreditsLedger(dbAdapter, {
            creditType: ['extra_credit', 'extra_credit_used'],
            userId: user!.id,
          }),
          50,
          'nothing is charged',
        );
        assert.strictEqual(
          await inFlightReservations(),
          0,
          'the slot is given back',
        );
      });

      test('an OpenRouter-shaped stream is forwarded and charged', async function (assert) {
        let response = await request
          .post('/_request-forward')
          .set('Accept', 'text/event-stream')
          .set('Content-Type', 'application/json')
          .set('Authorization', `Bearer ${jwt()}`)
          .send({
            url: `${vendor.url}/sse?cost=0.003`,
            method: 'POST',
            requestBody: JSON.stringify({ stream: true }),
            stream: true,
          });

        assert.strictEqual(response.status, 200);
        assert.true(response.text.includes('"content":"Hello"'));
        assert.true(response.text.includes('data: [DONE]'));
        assert.strictEqual(
          vendor.requests[0]?.headers.authorization,
          'Bearer stub-vendor-key',
        );

        // 0.003 USD × 1000 = 3 credits.
        let user = await getUserByMatrixUserId(
          dbAdapter,
          '@testuser:localhost',
        );
        await waitUntil(
          async () =>
            (await sumUpCreditsLedger(dbAdapter, {
              creditType: ['extra_credit', 'extra_credit_used'],
              userId: user!.id,
            })) === 47,
          { timeoutMessage: 'the stream should be charged (50 - 3 = 47)' },
        );
      });

      test('a cost lookup whose host resolves to a private address is refused and the charge is skipped', async function (assert) {
        configureOutbound({
          devAllowlist: ['127.0.0.1'],
          resolveHost: async (hostname) =>
            hostname === 'openrouter.ai' ? ['10.0.0.1'] : ['127.0.0.1'],
        });
        // The warnings the cost lookup and the credit strategy log, with the
        // values they were logged with.
        let warnings: unknown[][] = [];
        let channels = [logger('ai-billing'), logger('credit-strategies')];
        let restore = channels.map((log) => {
          let originalFactory = log.methodFactory;
          let originalLevel = log.getLevel();
          log.methodFactory = (methodName, level, loggerName) => {
            let raw = originalFactory(methodName, level, loggerName);
            return (...args: unknown[]) => {
              if (methodName === 'warn') {
                warnings.push(args);
              }
              raw(...args);
            };
          };
          log.setLevel('warn');
          return () => {
            log.methodFactory = originalFactory;
            log.setLevel(originalLevel);
          };
        });
        let skipped = () =>
          warnings.some(([message]) =>
            String(message).includes(
              'Failed to fetch generation cost for user @testuser:localhost (generationId: gen-stub), credit deduction skipped',
            ),
          );
        try {
          let response = await request
            .post('/_request-forward')
            .set('Accept', 'text/event-stream')
            .set('Content-Type', 'application/json')
            .set('Authorization', `Bearer ${jwt()}`)
            .send({
              url: `${vendor.url}/sse?cost=none`,
              method: 'POST',
              requestBody: JSON.stringify({ stream: true }),
              stream: true,
            });

          assert.strictEqual(response.status, 200);
          assert.true(response.text.includes('data: [DONE]'));

          await waitUntil(async () => skipped(), {
            timeoutMessage:
              'the refused cost lookup should skip the charge with a warning',
          });
          let attempts = warnings.filter(([message]) =>
            String(message).includes('to fetch generation cost failed'),
          );
          assert.strictEqual(
            attempts.length,
            1,
            'a refused lookup is not retried',
          );
          let error = attempts[0]?.[1];
          assert.true(
            error instanceof OutboundRefusedError,
            'the outbound guard refused the lookup',
          );
          assert.strictEqual(
            (error as OutboundRefusedError | undefined)?.reason,
            'address',
          );
          let user = await getUserByMatrixUserId(
            dbAdapter,
            '@testuser:localhost',
          );
          assert.strictEqual(
            await sumUpCreditsLedger(dbAdapter, {
              creditType: ['extra_credit', 'extra_credit_used'],
              userId: user!.id,
            }),
            50,
            'nothing is charged',
          );
        } finally {
          restore.forEach((undo) => undo());
        }
      });

      // What an operator or a caller can see of a send-path failure: the
      // proxy's log lines, the event Sentry would receive, and the response.
      module('credentials stay out of what is recorded', function (hooks) {
        let sentry: SentryCapture | undefined;
        const channels = ['request-forward', 'proxy-forward', 'outbound'];

        hooks.beforeEach(function () {
          configureOutbound({ devAllowlist: ['127.0.0.1', 'localhost'] });
        });
        hooks.afterEach(async function () {
          await sentry?.stop();
          sentry = undefined;
        });

        async function forward(url: string) {
          return await request
            .post('/_request-forward')
            .set('Accept', 'application/json')
            .set('Content-Type', 'application/json')
            .set('Authorization', `Bearer ${jwt()}`)
            .send({ url, method: 'GET' });
        }

        test('a stored key Node refuses as a header value is in no log line, Sentry event or response', async function (assert) {
          // The part of the key before the line break, which Node quotes in
          // its error along with the rest.
          let quoted = 'sk-planted-0123456789/abc+def=';
          let destination = `${vendor.alternateUrl}/echo`;
          await dbAdapter.execute(
            `INSERT INTO proxy_endpoints (id, url, api_key, credit_strategy, supports_streaming, auth_method, auth_parameter_name, created_at, updated_at)
             VALUES (gen_random_uuid(), '${destination}', '${quoted}' || chr(13) || chr(10) || 'Injected: 1', 'no-credit', false, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          );
          AllowedProxyDestinations.reset();
          sentry = startSentryCapture({ tracing: true });

          // The caller's own query string may carry a token or user content;
          // a send failure records only the origin and path.
          let callerToken = 'planted-caller-token-0123456789';
          let response: Awaited<ReturnType<typeof forward>> | undefined;
          let lines = await logLinesDuring(channels, async () => {
            response = await forward(
              `${destination}?caller_token=${callerToken}`,
            );
          });
          let sent = await sentry.flushed();

          assert.strictEqual(response!.status, 500);
          assert.deepEqual(
            JSON.parse(response!.text),
            { errors: ['An error occurred while processing the request'] },
            'the caller sees the same message as before',
          );
          assert.strictEqual(vendor.requests.length, 0, 'nothing was sent');
          let failure = lines.find((line) =>
            line.message.includes('Error in request forward handler'),
          );
          assert.ok(failure, 'the failure is logged');
          assert.true(
            failure!.message.includes(
              `(key=system:${destination} url=${destination})`,
            ),
            'the log line names the key: ' + failure!.message,
          );
          assert.true(
            failure!.message.includes('invalid header value'),
            "the log line keeps Node's reason",
          );
          assert.true(
            sent.includes('OutboundSendError'),
            'the error reached Sentry',
          );
          assert.false(
            lines.some((line) => leaksCredential(line.message, quoted)),
            'no log line carries the key',
          );
          assert.false(leaksCredential(sent, quoted), 'Sentry does not');
          assert.false(
            lines.some((line) => line.message.includes(callerToken)),
            "no log line carries the caller's query string",
          );
          assert.false(
            sent.includes(callerToken),
            "Sentry does not carry the caller's query string",
          );
          assert.false(
            leaksCredential(response!.text, quoted),
            'the response does not',
          );
        });

        test('a url-parameter key a vendor echoes as malformed JSON is in no log line, breadcrumb, Sentry event or response', async function (assert) {
          // Short enough that JSON.parse would quote it whole, and starting
          // with a byte a bare JSON scalar can start with, so the forward
          // would hand the body to JSON.parse. The response is scrubbed before
          // the forward reads it, so what it reads is the marker instead.
          let key = 'tsk-0123456789';
          let precondition = '';
          try {
            JSON.parse(key);
          } catch (error) {
            precondition = (error as Error).message;
          }
          assert.true(
            precondition.includes(key),
            'precondition: JSON.parse quotes the key it fails on',
          );
          let destination = `${vendor.alternateUrl}/reflect-credential`;
          await dbAdapter.execute(
            `INSERT INTO proxy_endpoints (id, url, api_key, credit_strategy, supports_streaming, auth_method, auth_parameter_name, created_at, updated_at)
             VALUES (gen_random_uuid(), '${destination}', '${key}', 'no-credit', false, 'url-parameter', 'key', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          );
          AllowedProxyDestinations.reset();
          sentry = startSentryCapture({ tracing: true });

          let response: { status: number; text: string } | undefined;
          let lines = await logLinesDuring(channels, async () => {
            let answer = await request
              .post('/_request-forward')
              .set('Accept', 'application/json')
              .set('Content-Type', 'application/json')
              .set('Authorization', `Bearer ${jwt()}`)
              .send({ url: `${destination}?q=1`, method: 'GET' })
              // The marker is passed on as the vendor's body, which is not a
              // JSON document, so it is read as text.
              .buffer(true)
              .parse((res, callback) => {
                let text = '';
                res.setEncoding('utf8');
                res.on('data', (chunk: string) => (text += chunk));
                res.on('end', () => callback(null, text));
              });
            response = { status: answer.status, text: answer.body as string };
          });
          Sentry.captureException(new Error('probe for breadcrumbs'));
          let sent = await sentry.flushed();

          assert.strictEqual(
            new URL(vendor.requests[0].path, vendor.url).searchParams.get(
              'key',
            ),
            key,
            'the vendor received the key in the query string',
          );
          assert.strictEqual(
            response!.text,
            '[REDACTED]',
            'the key was replaced before the forward read the body',
          );
          assert.false(
            lines.some((line) =>
              line.message.includes('Error in request forward handler'),
            ),
            'nothing is left for JSON.parse to fail on and quote',
          );
          let size = lines.find((line) =>
            line.message.startsWith('outbound response size:'),
          );
          assert.true(
            size?.message.includes(`destination=${destination} `),
            'the size line records the URL as the caller sent it',
          );
          assert.false(
            lines.some((line) => leaksCredential(line.message, key)),
            'no log line carries the key',
          );
          assert.false(
            leaksCredential(sent, key),
            'no Sentry event or breadcrumb carries it',
          );
          assert.false(
            leaksCredential(response!.text, key),
            'the response does not',
          );
        });

        test('no run of a full-length key a vendor quotes back reaches a log line, Sentry event or response', async function (assert) {
          let key = 'sk-or-v1-8d2f61c04b9e3a75f0c1d6e28b4a9f3c7e05d1b6';
          let destination = `${vendor.alternateUrl}/respond`;
          await dbAdapter.execute(
            `INSERT INTO proxy_endpoints (id, url, api_key, credit_strategy, supports_streaming, auth_method, auth_parameter_name, created_at, updated_at)
             VALUES (gen_random_uuid(), '${destination}', '${key}', 'no-credit', false, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          );
          AllowedProxyDestinations.reset();
          sentry = startSentryCapture({ tracing: true });

          // A body that isn't JSON and starts with a truncated copy of the
          // key, the way a vendor's plain-text error might. JSON.parse quotes
          // the start of what it fails on.
          let response: Awaited<ReturnType<typeof forward>> | undefined;
          let lines = await logLinesDuring(channels, async () => {
            response = await request
              .post('/_request-forward')
              .set('Accept', 'application/json')
              .set('Content-Type', 'application/json')
              .set('Authorization', `Bearer ${jwt()}`)
              .send({
                url: destination,
                method: 'POST',
                requestBody: JSON.stringify({
                  status: 401,
                  headers: { 'content-type': 'text/plain' },
                  chunks: [`${key.slice(0, 31)}… is not a valid key`],
                }),
              });
          });
          Sentry.captureException(new Error('probe for breadcrumbs'));
          let sent = await sentry.flushed();

          assert.strictEqual(
            vendor.requests[0]?.headers.authorization,
            `Bearer ${key}`,
            'the vendor received the key',
          );
          assert.strictEqual(response!.status, 500);
          assert.true(
            lines.some((line) => line.message.includes('SyntaxError')),
            'the parse failure is logged',
          );
          // Every run of the key long enough to identify it.
          let runs: string[] = [];
          for (let start = 0; start + 10 <= key.length; start++) {
            runs.push(key.slice(start, start + 10).toLowerCase());
          }
          let carries = (text: string) =>
            runs.some((run) => text.toLowerCase().includes(run));
          assert.false(
            lines.some((line) => carries(line.message)),
            'no log line carries any of it',
          );
          assert.false(carries(sent), 'no Sentry event or breadcrumb does');
          assert.false(carries(response!.text), 'the response does not');
        });
      });

      // What a Sentry event raised during a forward carries of the incoming
      // request: the caller's URL, headers and body are theirs, and the
      // Authorization header is their session token.
      module('the incoming request in a Sentry event', function (hooks) {
        let sentry: SentryCapture | undefined;
        const destinationPath = '/respond';

        hooks.beforeEach(async function () {
          configureOutbound({ devAllowlist: ['127.0.0.1', 'localhost'] });
          await dbAdapter.execute(
            `INSERT INTO proxy_endpoints (id, url, api_key, credit_strategy, supports_streaming, auth_method, auth_parameter_name, created_at, updated_at)
             VALUES (gen_random_uuid(), '${vendor.alternateUrl}${destinationPath}', 'telemetry-vendor-key', 'no-credit', false, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          );
          AllowedProxyDestinations.reset();
        });
        hooks.afterEach(async function () {
          await sentry?.stop();
          sentry = undefined;
        });

        // A forward whose vendor answers with a body that is not JSON, so
        // the handler fails and reports the error to Sentry.
        async function failingForward(markers: {
          token: string;
          urlToken: string;
          bodyMarker: string;
          cookie: string;
          query: string;
        }) {
          return await request
            .post(`/_request-forward?caller=${markers.query}`)
            .set('Accept', 'application/json')
            .set('Content-Type', 'application/json')
            .set('Authorization', `Bearer ${markers.token}`)
            .set('Cookie', `session=${markers.cookie}`)
            .send({
              url: `${vendor.alternateUrl}${destinationPath}?token=${markers.urlToken}`,
              method: 'POST',
              requestBody: JSON.stringify({
                status: 401,
                headers: { 'content-type': 'text/plain' },
                chunks: ['not a JSON document'],
                marker: markers.bodyMarker,
              }),
            });
        }

        function markers() {
          return {
            token: jwt(),
            urlToken: 'url-query-token-5c1e09',
            bodyMarker: 'request-body-marker-7f3a2d',
            cookie: 'cookie-marker-b84e61',
            query: 'incoming-query-marker-2d9c40',
          };
        }

        test('keeps only the method and path of a failed forward', async function (assert) {
          sentry = startSentryCapture({
            tracing: false,
            incomingRequests: true,
          });
          let planted = markers();
          // With the request log on, Sentry keeps its line, which names the
          // incoming URL, as a breadcrumb.
          let response: Awaited<ReturnType<typeof failingForward>> | undefined;
          let lines = await withLogDefinition('realm:requests', 'info', () =>
            logLinesDuring(['realm:requests'], async () => {
              response = await failingForward(planted);
            }),
          );
          let sent = await sentry.flushed();
          let events = await sentry.flushedEvents();

          assert.true(
            lines.some((line) => line.message.includes(planted.query)),
            'precondition: the request log line names the incoming query',
          );
          assert.strictEqual(response!.status, 500, 'the forward failed');
          assert.strictEqual(events.length, 1, 'the failure reached Sentry');
          let recorded = events[0].request as
            | { method?: string; url?: string }
            | undefined;
          assert.deepEqual(
            Object.keys(recorded ?? {}).sort(),
            ['method', 'url'],
            'the event has the request, and only its method and URL',
          );
          assert.strictEqual(recorded?.method, 'POST');
          assert.strictEqual(
            new URL(recorded!.url!).pathname,
            '/_request-forward',
          );
          assert.strictEqual(
            new URL(recorded!.url!).search,
            '',
            'the URL has no query string',
          );
          for (let [name, value] of Object.entries(planted)) {
            assert.false(
              sent.includes(value),
              `no envelope carries the ${name}`,
            );
          }
        });

        // Sentry copies a body only from `data` listeners. The forward reads
        // its body through the stream's async iterator, so a multi-megabyte
        // body is never buffered for Sentry at all.
        test("the forward's body is not buffered for Sentry", async function (assert) {
          // Without the hook, to see what the instrumentation itself recorded.
          sentry = startSentryCapture({
            tracing: false,
            incomingRequests: true,
            scrub: false,
          });
          let planted = markers();
          let response = await failingForward(planted);
          let events = await sentry.flushedEvents();

          assert.strictEqual(response.status, 500, 'the forward failed');
          assert.strictEqual(events.length, 1, 'the failure reached Sentry');
          let recorded = events[0].request as
            | { headers?: Record<string, string>; data?: unknown }
            | undefined;
          assert.strictEqual(
            recorded?.headers?.authorization,
            `Bearer ${planted.token}`,
            'precondition: the instrumentation recorded the incoming request',
          );
          assert.false('data' in (recorded ?? {}), 'it recorded no body');
        });
      });
    });
  });
});
