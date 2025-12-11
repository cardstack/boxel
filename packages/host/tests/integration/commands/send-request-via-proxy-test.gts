import { getOwner } from '@ember/owner';
import { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import SendRequestViaProxyCommand from '@cardstack/host/commands/send-request-via-proxy';
import RealmService from '@cardstack/host/services/realm';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
  testRealmInfo,
  setupRealmServerEndpoints,
  setupSnapshotRealm,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

class StubRealmService extends RealmService {
  get defaultReadableRealm() {
    return {
      path: testRealmURL,
      info: testRealmInfo,
    };
  }
}

module('Integration | commands | send-request-via-proxy', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });
  let snapshot = setupSnapshotRealm(hooks, {
    mockMatrixUtils,
    async build({ loader }) {
      let loaderService = getService('loader-service');
      loaderService.loader = loader;
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {},
        loader,
      });
      return {};
    },
  });

  // Setup realm server endpoints for all tests
  setupRealmServerEndpoints(hooks, [
    {
      route: '_request-forward',
      getResponse: async (req: Request) => {
        const body = await req.json();

        // Handle different test scenarios based on URL or other parameters
        if (body.url.includes('/image')) {
          const mockImageData = new Uint8Array([
            137, 80, 78, 71, 13, 10, 26, 10,
          ]); // PNG header
          return new Response(mockImageData, {
            status: 200,
            headers: { 'Content-Type': 'image/png' },
          });
        }

        if (body.url.includes('/stream')) {
          const mockStreamData = [
            'data: {"event": "start", "id": "123"}\n\n',
            'data: {"event": "progress", "percent": 50}\n\n',
            'data: {"event": "complete", "result": "success"}\n\n',
            'data: [DONE]\n\n',
          ].join('');
          return new Response(mockStreamData, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          });
        }

        if (body.url.includes('/error-400')) {
          return new Response(
            JSON.stringify({
              error: 'Bad Request',
              message: 'Invalid parameters',
            }),
            {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }

        if (body.url.includes('/error-500')) {
          return new Response(
            JSON.stringify({
              error: 'Internal Server Error',
              message: 'Something went wrong',
            }),
            {
              status: 500,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }

        if (body.url.includes('/text')) {
          return new Response('Hello, this is a text response!', {
            status: 200,
            headers: { 'Content-Type': 'text/plain' },
          });
        }

        if (body.url.includes('/html')) {
          return new Response('<html><body>HTML response</body></html>', {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          });
        }

        if (body.url.includes('/xml')) {
          return new Response('<xml><data>XML response</data></xml>', {
            status: 200,
            headers: { 'Content-Type': 'application/xml' },
          });
        }

        if (body.url.includes('/large')) {
          const largeData = {
            items: Array.from({ length: 1000 }, (_, i) => ({
              id: i,
              data: 'large item',
            })),
          };
          return new Response(JSON.stringify(largeData), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (body.url.includes('/realm-error')) {
          return new Response('Internal Server Error', {
            status: 500,
            statusText: 'Internal Server Error',
          });
        }

        if (body.url.includes('/network-error')) {
          throw new Error('Network error: Failed to fetch');
        }

        // Default JSON response
        return new Response(
          JSON.stringify({
            success: true,
            data: { id: 123, name: 'test' },
            method: body.method,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      },
    },
  ]);

  hooks.beforeEach(function (this: RenderingTestContext) {
    getOwner(this)!.register('service:realm', StubRealmService);
  });

  hooks.beforeEach(function () {
    snapshot.get();
  });

  // Helper function to create mock send request via proxy input
  function createMockSendRequestViaProxyInput(overrides = {}) {
    return {
      url: 'http://localhost:4200/i-do-not-exist/test',
      method: 'POST',
      requestBody: JSON.stringify({ test: 'data' }),
      headers: { 'Content-Type': 'application/json' },
      ...overrides,
    };
  }

  // Test successful JSON response
  test('successfully sends request and returns JSON response', async function (assert) {
    const commandService = getService('command-service');
    const requestForwardCommand = new SendRequestViaProxyCommand(
      commandService.commandContext,
    );

    const input = createMockSendRequestViaProxyInput();
    const result = await requestForwardCommand.execute(input);

    assert.ok(result, 'Command should return a result');
    assert.strictEqual(result.response.status, 200);

    const responseData = await result.response.json();
    assert.deepEqual(responseData, {
      success: true,
      data: { id: 123, name: 'test' },
      method: 'POST',
    });
  });

  // Test text response
  test('successfully sends request and returns text response', async function (assert) {
    const commandService = getService('command-service');
    const requestForwardCommand = new SendRequestViaProxyCommand(
      commandService.commandContext,
    );

    const input = createMockSendRequestViaProxyInput({
      url: 'https://api.example.com/text',
    });
    const result = await requestForwardCommand.execute(input);

    assert.ok(result, 'Command should return a result');
    assert.strictEqual(result.response.status, 200);

    const responseText = await result.response.text();
    assert.strictEqual(responseText, 'Hello, this is a text response!');
  });

  // Test image response
  test('successfully sends request and returns image response', async function (assert) {
    const mockImageData = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]); // PNG header

    const commandService = getService('command-service');
    const requestForwardCommand = new SendRequestViaProxyCommand(
      commandService.commandContext,
    );

    const input = createMockSendRequestViaProxyInput({
      url: 'https://api.example.com/image',
      method: 'GET',
      requestBody: '',
    });
    const result = await requestForwardCommand.execute(input);

    assert.ok(result, 'Command should return a result');
    assert.strictEqual(result.response.status, 200);
    assert.strictEqual(
      result.response.headers.get('Content-Type'),
      'image/png',
    );

    const responseArrayBuffer = await result.response.arrayBuffer();
    const responseData = new Uint8Array(responseArrayBuffer);
    assert.deepEqual(responseData, mockImageData);
  });

  // Test event stream response
  test('successfully sends request and returns event stream response', async function (assert) {
    const mockStreamData = [
      'data: {"event": "start", "id": "123"}\n\n',
      'data: {"event": "progress", "percent": 50}\n\n',
      'data: {"event": "complete", "result": "success"}\n\n',
      'data: [DONE]\n\n',
    ].join('');

    const commandService = getService('command-service');
    const requestForwardCommand = new SendRequestViaProxyCommand(
      commandService.commandContext,
    );

    const input = createMockSendRequestViaProxyInput({
      url: 'https://api.example.com/stream',
      stream: true,
    });
    const result = await requestForwardCommand.execute(input);

    assert.ok(result, 'Command should return a result');
    assert.strictEqual(result.response.status, 200);
    assert.strictEqual(
      result.response.headers.get('Content-Type'),
      'text/event-stream',
    );

    const responseText = await result.response.text();
    assert.strictEqual(responseText, mockStreamData);
  });

  // Test error response (4xx)
  test('handles 4xx error responses from external API', async function (assert) {
    const commandService = getService('command-service');
    const requestForwardCommand = new SendRequestViaProxyCommand(
      commandService.commandContext,
    );

    const input = createMockSendRequestViaProxyInput({
      url: 'https://api.example.com/error-400',
    });
    const result = await requestForwardCommand.execute(input);

    assert.ok(result, 'Command should return a result');
    assert.strictEqual(result.response.status, 500);

    const responseData = await result.response.json();
    assert.ok(responseData.error, 'Should have error field');
    assert.ok(responseData.details, 'Should have details field');
    assert.ok(
      responseData.error.includes('Request forward failed: 400'),
      'Error should mention the original 400 status',
    );
  });

  // Test error response (5xx)
  test('handles 5xx error responses from external API', async function (assert) {
    const commandService = getService('command-service');
    const requestForwardCommand = new SendRequestViaProxyCommand(
      commandService.commandContext,
    );

    const input = createMockSendRequestViaProxyInput({
      url: 'https://api.example.com/error-500',
    });
    const result = await requestForwardCommand.execute(input);

    assert.ok(result, 'Command should return a result');
    assert.strictEqual(result.response.status, 500);

    const responseData = await result.response.json();
    assert.ok(responseData.error, 'Should have error field');
    assert.ok(responseData.details, 'Should have details field');
    assert.ok(
      responseData.error.includes('Request forward failed: 500'),
      'Error should mention the original 500 status',
    );
  });

  // Test realm server error
  test('handles realm server errors gracefully', async function (assert) {
    const commandService = getService('command-service');
    const requestForwardCommand = new SendRequestViaProxyCommand(
      commandService.commandContext,
    );

    const input = createMockSendRequestViaProxyInput({
      url: 'https://api.example.com/realm-error',
    });
    const result = await requestForwardCommand.execute(input);

    assert.ok(result, 'Command should return a result');
    assert.strictEqual(result.response.status, 500);

    const responseData = await result.response.json();
    assert.ok(responseData.error, 'Should have error field');
    assert.ok(responseData.details, 'Should have details field');
  });

  // Test network error
  test('handles network errors gracefully', async function (assert) {
    const commandService = getService('command-service');
    const requestForwardCommand = new SendRequestViaProxyCommand(
      commandService.commandContext,
    );

    const input = createMockSendRequestViaProxyInput({
      url: 'https://api.example.com/network-error',
    });
    const result = await requestForwardCommand.execute(input);

    assert.ok(result, 'Command should return a result');
    assert.strictEqual(result.response.status, 500);

    const responseData = await result.response.json();
    assert.ok(responseData.error, 'Should have error field');
    assert.ok(responseData.details, 'Should have details field');
  });

  // Test different HTTP methods
  test('supports different HTTP methods', async function (assert) {
    const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

    for (const method of methods) {
      const commandService = getService('command-service');
      const requestForwardCommand = new SendRequestViaProxyCommand(
        commandService.commandContext,
      );

      const input = createMockSendRequestViaProxyInput({ method });
      const result = await requestForwardCommand.execute(input);

      assert.ok(result, `Command should return a result for ${method}`);
      assert.strictEqual(result.response.status, 200);

      const responseData = await result.response.json();
      assert.strictEqual(responseData.method, method);
    }
  });

  // Test with different content types
  test('handles different content types in response', async function (assert) {
    const testCases = [
      { url: 'https://api.example.com/test', contentType: 'application/json' },
      { url: 'https://api.example.com/text', contentType: 'text/plain' },
      { url: 'https://api.example.com/html', contentType: 'text/html' },
      { url: 'https://api.example.com/xml', contentType: 'application/xml' },
    ];

    for (const testCase of testCases) {
      const commandService = getService('command-service');
      const requestForwardCommand = new SendRequestViaProxyCommand(
        commandService.commandContext,
      );

      const input = createMockSendRequestViaProxyInput({
        url: testCase.url,
      });
      const result = await requestForwardCommand.execute(input);

      assert.ok(
        result,
        `Command should return a result for ${testCase.contentType}`,
      );
      assert.strictEqual(result.response.status, 200);
      assert.strictEqual(
        result.response.headers.get('Content-Type'),
        testCase.contentType,
      );
    }
  });

  // Test with large response
  test('handles large response data', async function (assert) {
    const commandService = getService('command-service');
    const requestForwardCommand = new SendRequestViaProxyCommand(
      commandService.commandContext,
    );

    const input = createMockSendRequestViaProxyInput({
      url: 'https://api.example.com/large',
    });
    const result = await requestForwardCommand.execute(input);

    assert.ok(result, 'Command should return a result');
    assert.strictEqual(result.response.status, 200);

    const responseData = await result.response.json();
    assert.strictEqual(responseData.items.length, 1000);
    assert.strictEqual(responseData.items[0].id, 0);
    assert.strictEqual(responseData.items[999].id, 999);
  });

  // Test with special characters in URL and headers
  test('handles special characters in URL and headers', async function (assert) {
    const specialUrl =
      'https://api.example.com/test?param=value&special=test%20with%20spaces';
    const specialHeaders = {
      'X-Custom-Header': 'header with spaces and special chars: !@#$%^&*()',
      Authorization: 'Bearer token-with-special-chars: !@#$%^&*()',
    };

    const commandService = getService('command-service');
    const requestForwardCommand = new SendRequestViaProxyCommand(
      commandService.commandContext,
    );

    const input = createMockSendRequestViaProxyInput({
      url: specialUrl,
      headers: specialHeaders,
    });
    const result = await requestForwardCommand.execute(input);

    assert.ok(result, 'Command should return a result');
    assert.strictEqual(result.response.status, 200);
  });

  // Test with empty request body
  test('handles empty request body', async function (assert) {
    const commandService = getService('command-service');
    const requestForwardCommand = new SendRequestViaProxyCommand(
      commandService.commandContext,
    );

    const input = createMockSendRequestViaProxyInput({
      method: 'GET',
      requestBody: '',
    });
    const result = await requestForwardCommand.execute(input);

    assert.ok(result, 'Command should return a result');
    assert.strictEqual(result.response.status, 200);
  });

  // Test with null/undefined headers
  test('handles null/undefined headers', async function (assert) {
    const commandService = getService('command-service');
    const requestForwardCommand = new SendRequestViaProxyCommand(
      commandService.commandContext,
    );

    const input = createMockSendRequestViaProxyInput({
      headers: undefined,
    });
    const result = await requestForwardCommand.execute(input);

    assert.ok(result, 'Command should return a result');
    assert.strictEqual(result.response.status, 200);
  });
});
