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
        // Note: The actual authorization header will include the JWT token, not the API key
        // The API key is added by the proxy handler, not the test
        assert.true(
          firstCallHeaders?.Authorization?.startsWith('Bearer '),
          'Should set authorization header',
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
            title: 'Test Image 1',
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

        // Verify fetch was called correctly
        assert.true(mockFetch.calledOnce, 'Fetch should be called once');
        const calls = mockFetch.getCalls();

        // Check that the URL includes the API key as a parameter
        const callUrl = calls[0].args[0];
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
        const callHeaders = calls[0].args[1]?.headers as Record<string, string>;
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

        // Verify fetch was called correctly
        assert.true(mockFetch.calledOnce, 'Fetch should be called once');
        const calls = mockFetch.getCalls();

        // Check that the URL includes the API key as a parameter
        const callHeaders = calls[0].args[1]?.headers as Record<string, string>;
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

      let capturedInit: RequestInit | undefined;
      mockFetch.callsFake(
        async (_input: string | URL | Request, init?: RequestInit) => {
          capturedInit = init;
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

        assert.ok(capturedInit, 'fetch init should be captured');

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
  });
});
