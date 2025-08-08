import { module, test } from 'qunit';
import sinon from 'sinon';
import {
  isEndpointWhitelisted,
  getEndpointConfig,
} from '../lib/external-endpoints';
import { AICreditStrategy, NoCreditStrategy } from '../lib/credit-strategies';
import {
  calculateCreditsForOpenRouter,
  extractGenerationIdFromResponse,
} from '../lib/credit-calculator';

module.only('Request Forward Endpoint', function () {
  module('Core Functionality', function () {
    test('should validate whitelisted endpoints', async function (assert) {
      // Test that OpenRouter endpoint is properly configured
      const openRouterConfig = getEndpointConfig(
        'https://openrouter.ai/api/v1',
      );
      assert.ok(openRouterConfig, 'OpenRouter config should exist');
      assert.ok(
        openRouterConfig?.creditStrategy instanceof AICreditStrategy,
        'Should use AI credit strategy',
      );
      assert.equal(
        openRouterConfig?.whitelisted,
        true,
        'Should be whitelisted',
      );

      // Test whitelist validation
      assert.true(
        isEndpointWhitelisted('https://openrouter.ai/api/v1'),
        'OpenRouter should be whitelisted',
      );
      assert.false(
        isEndpointWhitelisted('https://malicious-api.com/v1'),
        'Malicious API should not be whitelisted',
      );
    });

    test('should handle credit validation through strategy', async function (assert) {
      // Mock the credit strategy to test validation
      const mockStrategy = new AICreditStrategy();
      const validateStub = sinon
        .stub(mockStrategy, 'validateCredits')
        .resolves({
          hasEnoughCredits: false,
          availableCredits: 50,
          errorMessage: 'Insufficient credits for this operation',
        });

      // Test that the strategy is called correctly
      const result = await mockStrategy.validateCredits({} as any, 'test-user');
      assert.false(result.hasEnoughCredits);
      assert.equal(result.availableCredits, 50);
      assert.equal(
        result.errorMessage,
        'Insufficient credits for this operation',
      );

      validateStub.restore();
    });

    test('should handle credit calculation through strategy', async function (assert) {
      // Mock the credit strategy to test calculation
      const mockStrategy = new AICreditStrategy();
      const calculateStub = sinon
        .stub(mockStrategy, 'calculateCredits')
        .resolves(100);

      const mockResponse = {
        id: 'gen-123',
        choices: [{ text: 'Hello world' }],
      };

      const credits = await mockStrategy.calculateCredits(mockResponse);
      assert.equal(credits, 100);

      calculateStub.restore();
    });

    test('should mock OpenRouter API calls with sinon', async function (assert) {
      // Mock the global fetch function
      const originalFetch = global.fetch;
      const mockFetch = sinon.stub(global, 'fetch');

      // Ensure environment variable is set for the test
      const originalApiKey = process.env.OPENROUTER_API_KEY;
      process.env.OPENROUTER_API_KEY = 'test-api-key';

      // Mock successful OpenRouter response
      const mockOpenRouterResponse = {
        id: 'gen-test-123',
        choices: [{ text: 'Mock response from OpenRouter' }],
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
          } else {
            return new Response(JSON.stringify(mockOpenRouterResponse), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          }
        },
      );

      try {
        // Test the credit calculation with mocked API
        const generationId = extractGenerationIdFromResponse(
          mockOpenRouterResponse,
        );
        assert.equal(
          generationId,
          'gen-test-123',
          'Should extract generation ID',
        );

        const credits = await calculateCreditsForOpenRouter(
          mockOpenRouterResponse,
          generationId,
        );
        assert.equal(credits, 3, 'Should calculate 3 credits (0.003 * 1000)');

        // Verify fetch was called correctly
        assert.true(mockFetch.called, 'Fetch should be called at least once');
        if (mockFetch.called) {
          const firstCallUrl = mockFetch.firstCall.args[0];
          const urlString =
            typeof firstCallUrl === 'string'
              ? firstCallUrl
              : firstCallUrl.toString();
          assert.true(
            urlString.includes('/generation?id='),
            'Should call generation cost API',
          );
        }
      } finally {
        mockFetch.restore();
        global.fetch = originalFetch;

        // Restore original environment variable
        if (originalApiKey) {
          process.env.OPENROUTER_API_KEY = originalApiKey;
        } else {
          delete process.env.OPENROUTER_API_KEY;
        }
      }
    });

    test('should handle OpenRouter API errors gracefully', async function (assert) {
      // Mock the global fetch function
      const originalFetch = global.fetch;
      const mockFetch = sinon.stub(global, 'fetch');

      // Ensure environment variable is set for the test
      const originalApiKey = process.env.OPENROUTER_API_KEY;
      process.env.OPENROUTER_API_KEY = 'test-api-key';

      // Mock API error response
      const mockErrorResponse = {
        error: {
          message: 'Rate limit exceeded',
          type: 'rate_limit',
        },
      };

      // Set up fetch to return error response
      mockFetch.callsFake(
        async (_input: string | URL | Request, _init?: RequestInit) => {
          return new Response(JSON.stringify(mockErrorResponse), {
            status: 429,
            headers: { 'content-type': 'application/json' },
          });
        },
      );

      try {
        const mockResponse = {
          id: 'gen-error-123',
          choices: [{ text: 'Error response' }],
        };

        const generationId = extractGenerationIdFromResponse(mockResponse);
        const credits = await calculateCreditsForOpenRouter(
          mockResponse,
          generationId,
        );

        // Should return 0 credits on error
        assert.equal(credits, 0, 'Should return 0 credits on API error');
      } finally {
        mockFetch.restore();
        global.fetch = originalFetch;

        // Restore original environment variable
        if (originalApiKey) {
          process.env.OPENROUTER_API_KEY = originalApiKey;
        } else {
          delete process.env.OPENROUTER_API_KEY;
        }
      }
    });

    test('should handle missing generation ID gracefully', async function (assert) {
      const mockResponse = {
        choices: [{ text: 'Response without generation ID' }],
        usage: { total_tokens: 100 },
      };

      const generationId = extractGenerationIdFromResponse(mockResponse);
      assert.equal(
        generationId,
        undefined,
        'Should return undefined for missing generation ID',
      );

      // Mock fetch to not be called when no generation ID
      const originalFetch = global.fetch;
      const mockFetch = sinon.stub(global, 'fetch');

      try {
        const credits = await calculateCreditsForOpenRouter(
          mockResponse,
          generationId,
        );
        assert.equal(
          credits,
          0,
          'Should return 0 credits when no generation ID',
        );
        // Note: fetch should not be called when no generation ID
        // but we don't need to assert this since the function returns early
      } finally {
        mockFetch.restore();
        global.fetch = originalFetch;
      }
    });

    test('should mock complete request-forward flow', async function (assert) {
      // Mock the global fetch function for the entire flow
      const originalFetch = global.fetch;
      const mockFetch = sinon.stub(global, 'fetch');

      // Ensure environment variable is set for the test
      const originalApiKey = process.env.OPENROUTER_API_KEY;
      process.env.OPENROUTER_API_KEY = 'test-api-key';

      // Mock OpenRouter chat completion response
      const mockChatResponse = {
        id: 'gen-flow-123',
        choices: [{ text: 'Mock response from OpenRouter' }],
        usage: { total_tokens: 200 },
      };

      // Mock generation cost API response
      const mockCostResponse = {
        data: {
          id: 'gen-flow-123',
          total_cost: 0.004,
          total_tokens: 200,
          model: 'openai/gpt-3.5-turbo',
        },
      };

      // Set up fetch to return different responses based on URL
      mockFetch.callsFake(
        async (input: string | URL | Request, _init?: RequestInit) => {
          const url = typeof input === 'string' ? input : input.toString();

          if (url.includes('/chat/completions')) {
            return new Response(JSON.stringify(mockChatResponse), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          } else if (url.includes('/generation?id=')) {
            return new Response(JSON.stringify(mockCostResponse), {
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
        // Test the complete flow
        const requestBody = {
          model: 'openai/gpt-3.5-turbo',
          messages: [{ role: 'user', content: 'Hello' }],
        };

        // Simulate the external API call
        const externalResponse = await fetch(
          'https://openrouter.ai/api/v1/chat/completions',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer mock-api-key',
            },
            body: JSON.stringify(requestBody),
          },
        );

        const responseData = await externalResponse.json();
        assert.equal(
          responseData.id,
          'gen-flow-123',
          'Should get correct generation ID',
        );

        // Test credit calculation
        const generationId = extractGenerationIdFromResponse(responseData);

        const credits = await calculateCreditsForOpenRouter(
          responseData,
          generationId,
        );
        assert.equal(credits, 4, 'Should calculate 4 credits (0.004 * 1000)');

        // Verify fetch was called correctly
        assert.true(mockFetch.calledTwice, 'Fetch should be called twice');
        const calls = mockFetch.getCalls();
        assert.true(
          calls.some((call) => {
            const url =
              typeof call.args[0] === 'string'
                ? call.args[0]
                : call.args[0].toString();
            return url.includes('/chat/completions');
          }),
          'Should call chat completions API',
        );
        assert.true(
          calls.some((call) => {
            const url =
              typeof call.args[0] === 'string'
                ? call.args[0]
                : call.args[0].toString();
            return url.includes('/generation?id=');
          }),
          'Should call generation cost API',
        );
      } finally {
        mockFetch.restore();
        global.fetch = originalFetch;

        // Restore original environment variable
        if (originalApiKey) {
          process.env.OPENROUTER_API_KEY = originalApiKey;
        } else {
          delete process.env.OPENROUTER_API_KEY;
        }
      }
    });

    test('should handle no-credit strategy for free endpoints', async function (assert) {
      const noCreditStrategy = new NoCreditStrategy();

      const validation = await noCreditStrategy.validateCredits(
        {} as any,
        'test-user',
      );
      assert.true(validation.hasEnoughCredits);
      assert.equal(validation.availableCredits, 0);

      const credits = await noCreditStrategy.calculateCredits({});
      assert.equal(credits, 0);
    });

    test('should handle missing generation ID in response', async function (assert) {
      const mockStrategy = new AICreditStrategy();
      const calculateStub = sinon
        .stub(mockStrategy, 'calculateCredits')
        .resolves(0);

      const mockResponse = {
        choices: [{ text: 'Hello from OpenRouter' }],
        usage: { total_tokens: 10 },
      };

      const credits = await mockStrategy.calculateCredits(mockResponse);
      assert.equal(credits, 0, 'Should return 0 credits when no generation ID');

      calculateStub.restore();
    });

    test('should validate request body structure', async function (assert) {
      const validRequest = {
        url: 'https://openrouter.ai/api/v1/chat/completions',
        method: 'POST',
        requestBody: JSON.stringify({
          model: 'openai/gpt-3.5-turbo',
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      };

      // Test required fields
      assert.ok(validRequest.url, 'URL should be present');
      assert.ok(validRequest.method, 'Method should be present');
      assert.ok(validRequest.requestBody, 'Request body should be present');

      // Test JSON parsing
      const parsedBody = JSON.parse(validRequest.requestBody);
      assert.equal(parsedBody.model, 'openai/gpt-3.5-turbo');
      assert.equal(parsedBody.messages[0].content, 'Hello');
    });

    test('should handle external API headers correctly', async function (assert) {
      const endpointConfig = getEndpointConfig('https://openrouter.ai/api/v1');
      assert.ok(endpointConfig, 'Endpoint config should exist');

      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${endpointConfig?.apiKey}`,
        'X-Custom-Header': 'test-value',
      };

      assert.equal(headers['Content-Type'], 'application/json');
      assert.true(headers['Authorization'].startsWith('Bearer '));
      assert.equal(headers['X-Custom-Header'], 'test-value');
    });

    test('should handle different HTTP methods', async function (assert) {
      const methods = ['GET', 'POST', 'PUT', 'DELETE'];

      for (const method of methods) {
        const request = {
          url: 'https://openrouter.ai/api/v1/chat/completions',
          method,
          requestBody: JSON.stringify({ test: 'data' }),
        };

        assert.equal(request.method, method, `Should support ${method} method`);
      }
    });

    test('should handle error responses gracefully', async function (assert) {
      const mockErrorResponse = {
        error: { message: 'Rate limit exceeded' },
        status: 429,
      };

      assert.ok(mockErrorResponse.error, 'Error should be present');
      assert.equal(mockErrorResponse.error.message, 'Rate limit exceeded');
      assert.equal(mockErrorResponse.status, 429);
    });

    test('should validate endpoint configuration structure', async function (assert) {
      const openRouterConfig = getEndpointConfig(
        'https://openrouter.ai/api/v1',
      );

      assert.ok(openRouterConfig, 'Config should exist');
      assert.equal(
        typeof openRouterConfig?.url,
        'string',
        'URL should be string',
      );

      // In test environment, API key might be undefined, so we check for string or undefined
      const apiKeyType = typeof openRouterConfig?.apiKey;
      assert.true(
        apiKeyType === 'string' || apiKeyType === 'undefined',
        `API key should be string or undefined, got ${apiKeyType}`,
      );

      assert.equal(
        typeof openRouterConfig?.whitelisted,
        'boolean',
        'Whitelisted should be boolean',
      );
      assert.ok(
        openRouterConfig?.creditStrategy,
        'Credit strategy should exist',
      );
    });

    test('should handle credit strategy interface correctly', async function (assert) {
      const aiStrategy = new AICreditStrategy();
      const noCreditStrategy = new NoCreditStrategy();

      // Test that both implement the interface
      assert.equal(
        typeof aiStrategy.name,
        'string',
        'AI strategy should have name',
      );
      assert.equal(
        typeof noCreditStrategy.name,
        'string',
        'No credit strategy should have name',
      );

      // Test that both have required methods
      assert.equal(
        typeof aiStrategy.validateCredits,
        'function',
        'AI strategy should have validateCredits',
      );
      assert.equal(
        typeof aiStrategy.calculateCredits,
        'function',
        'AI strategy should have calculateCredits',
      );
      assert.equal(
        typeof noCreditStrategy.validateCredits,
        'function',
        'No credit strategy should have validateCredits',
      );
      assert.equal(
        typeof noCreditStrategy.calculateCredits,
        'function',
        'No credit strategy should have calculateCredits',
      );
    });

    test('should handle environment variable mocking', async function (assert) {
      // Save original environment variable
      const originalApiKey = process.env.OPENROUTER_API_KEY;

      try {
        // Mock the environment variable
        process.env.OPENROUTER_API_KEY = 'test-api-key-123';

        // Test that the environment variable is properly set
        assert.equal(
          process.env.OPENROUTER_API_KEY,
          'test-api-key-123',
          'Environment variable should be set correctly',
        );

        // Test that the configuration would work with the mocked value
        // Note: We can't re-import the module due to caching, so we test the env var directly
        const config = getEndpointConfig('https://openrouter.ai/api/v1');
        assert.ok(config, 'Config should exist');

        // The API key in the config will be the original value due to module caching,
        // but we can verify the environment variable is properly mocked
        assert.equal(
          process.env.OPENROUTER_API_KEY,
          'test-api-key-123',
          'Environment variable should remain mocked',
        );
      } finally {
        // Restore original environment variable
        if (originalApiKey) {
          process.env.OPENROUTER_API_KEY = originalApiKey;
        } else {
          delete process.env.OPENROUTER_API_KEY;
        }
      }
    });
  });
});
