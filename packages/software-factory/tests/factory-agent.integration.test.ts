import { createServer, type IncomingMessage, type Server } from 'node:http';
import { module, test } from 'qunit';

import { SupportedMimeType } from '@cardstack/runtime-common/supported-mime-type';

import {
  OpenRouterFactoryAgent,
  type AgentAction,
  type AgentContext,
} from '../scripts/lib/factory-agent';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMinimalContext(overrides?: Partial<AgentContext>): AgentContext {
  return {
    project: { id: 'Projects/test-project' },
    ticket: { id: 'Tickets/test-ticket' },
    knowledge: [],
    skills: [],
    tools: [],
    targetRealmUrl: 'https://realms.example.test/user/target/',
    testRealmUrl: 'https://realms.example.test/user/target-tests/',
    ...overrides,
  };
}

function openRouterResponse(actions: AgentAction[]): string {
  return JSON.stringify({
    id: 'gen-test-123',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: JSON.stringify(actions),
        },
        finish_reason: 'stop',
      },
    ],
    model: 'anthropic/claude-sonnet-4',
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
  });
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

async function startServer(
  handler: (
    req: IncomingMessage,
    body: string,
  ) => { status: number; body: string },
): Promise<{ server: Server; origin: string }> {
  let server = createServer(async (req, res) => {
    let body = await readBody(req);
    let result = handler(req, body);
    res.writeHead(result.status, { 'Content-Type': SupportedMimeType.JSON });
    res.end(result.body);
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  let address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected test server to bind to a TCP port');
  }

  return { server, origin: `http://127.0.0.1:${address.port}` };
}

function stopServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
}

// ---------------------------------------------------------------------------
// Proxy path integration test
// ---------------------------------------------------------------------------

module(
  'factory-agent integration > proxy path (_request-forward)',
  function () {
    test('full round-trip through _request-forward proxy', async function (assert) {
      let expectedActions: AgentAction[] = [
        {
          type: 'create_file',
          path: 'HelloWorld/hello.gts',
          content: 'export class HelloWorld {}',
          realm: 'target',
        },
        { type: 'done' },
      ];

      let capturedProxyBody: Record<string, unknown> | undefined;
      let capturedInnerBody: Record<string, unknown> | undefined;
      let capturedAuthHeader: string | undefined;

      let { server, origin } = await startServer((req, body) => {
        capturedAuthHeader = req.headers.authorization;

        if (req.url === '/_request-forward' && req.method === 'POST') {
          let proxyBody = JSON.parse(body);
          capturedProxyBody = proxyBody;

          // The proxy body wraps the real request
          assert.strictEqual(
            proxyBody.url,
            'https://openrouter.ai/api/v1/chat/completions',
            'proxy body contains OpenRouter URL',
          );
          assert.strictEqual(proxyBody.method, 'POST');

          // Parse the inner requestBody (it's a JSON string)
          let innerBody = JSON.parse(proxyBody.requestBody);
          capturedInnerBody = innerBody;

          return {
            status: 200,
            body: openRouterResponse(expectedActions),
          };
        }

        return { status: 404, body: JSON.stringify({ error: 'not found' }) };
      });

      try {
        let agent = new OpenRouterFactoryAgent({
          model: 'anthropic/claude-sonnet-4',
          realmServerUrl: `${origin}/`,
          authorization: 'Bearer test-jwt-token',
        });

        assert.false(
          agent.useDirectApi,
          'should use proxy path when no API key set',
        );

        let ctx = makeMinimalContext();
        let actions = await agent.plan(ctx);

        // Verify the response was correctly parsed
        assert.strictEqual(actions.length, 2, 'got 2 actions back');
        assert.strictEqual(actions[0].type, 'create_file');
        assert.strictEqual(actions[0].path, 'HelloWorld/hello.gts');
        assert.strictEqual(actions[1].type, 'done');

        // Verify auth header was sent
        assert.strictEqual(
          capturedAuthHeader,
          'Bearer test-jwt-token',
          'Authorization header sent to proxy',
        );

        // Verify proxy body structure
        assert.ok(capturedProxyBody, 'proxy body was captured');
        assert.strictEqual(
          typeof capturedProxyBody!.requestBody,
          'string',
          'requestBody is a JSON string (double-encoded for proxy)',
        );

        // Verify inner request body
        assert.ok(capturedInnerBody, 'inner body was captured');
        assert.strictEqual(
          capturedInnerBody!.model,
          'anthropic/claude-sonnet-4',
          'model is set in inner request',
        );
        assert.false(capturedInnerBody!.stream as boolean, 'stream is false');
        assert.true(
          Array.isArray(capturedInnerBody!.messages),
          'messages array present',
        );
        let messages = capturedInnerBody!.messages as Array<{
          role: string;
          content: string;
        }>;
        assert.strictEqual(messages.length, 2, 'system + user messages');
        assert.strictEqual(messages[0].role, 'system');
        assert.strictEqual(messages[1].role, 'user');
        assert.ok(
          messages[1].content.includes('Tickets/test-ticket'),
          'user message includes ticket ID',
        );
      } finally {
        await stopServer(server);
      }
    });

    test('proxy path handles HTTP error from realm server', async function (assert) {
      let { server, origin } = await startServer((_req, _body) => {
        return {
          status: 403,
          body: JSON.stringify({ error: 'Insufficient credits' }),
        };
      });

      try {
        let agent = new OpenRouterFactoryAgent({
          model: 'anthropic/claude-sonnet-4',
          realmServerUrl: `${origin}/`,
          authorization: 'Bearer test-jwt-token',
        });

        let ctx = makeMinimalContext();

        try {
          await agent.plan(ctx);
          assert.ok(false, 'should have thrown');
        } catch (err) {
          assert.true(err instanceof Error, 'throws an Error');
          assert.true(
            (err as Error).message.includes('403'),
            'error includes HTTP status',
          );
        }
      } finally {
        await stopServer(server);
      }
    });

    test('proxy path retries on malformed LLM response then succeeds', async function (assert) {
      let callCount = 0;

      let { server, origin } = await startServer((req, _body) => {
        if (req.url === '/_request-forward' && req.method === 'POST') {
          callCount++;
          if (callCount === 1) {
            // First call: return garbage that can't be parsed as AgentAction[]
            return {
              status: 200,
              body: JSON.stringify({
                choices: [
                  {
                    message: {
                      content: 'Sorry, I cannot do that right now.',
                    },
                  },
                ],
              }),
            };
          }
          // Retry call: return valid actions
          return {
            status: 200,
            body: openRouterResponse([{ type: 'done' }]),
          };
        }
        return { status: 404, body: '{}' };
      });

      try {
        let agent = new OpenRouterFactoryAgent({
          model: 'anthropic/claude-sonnet-4',
          realmServerUrl: `${origin}/`,
          authorization: 'Bearer test-jwt-token',
        });

        let ctx = makeMinimalContext();
        let actions = await agent.plan(ctx);

        assert.strictEqual(callCount, 2, 'made 2 requests (original + retry)');
        assert.strictEqual(actions.length, 1);
        assert.strictEqual(actions[0].type, 'done');
      } finally {
        await stopServer(server);
      }
    });
  },
);

// ---------------------------------------------------------------------------
// Direct path integration test
// ---------------------------------------------------------------------------

module(
  'factory-agent integration > direct path (OPENROUTER_API_KEY)',
  function () {
    test('full round-trip calling OpenRouter directly', async function (assert) {
      let expectedActions: AgentAction[] = [
        {
          type: 'create_test',
          path: 'TestSpec/hello.spec.ts',
          content: 'test("hello", () => {});',
          realm: 'test',
        },
        { type: 'done' },
      ];

      let capturedAuthHeader: string | undefined;
      let capturedBody: Record<string, unknown> | undefined;

      // This server acts as OpenRouter itself
      let { server, origin } = await startServer((req, body) => {
        capturedAuthHeader = req.headers.authorization;

        if (req.url === '/api/v1/chat/completions' && req.method === 'POST') {
          capturedBody = JSON.parse(body);
          return {
            status: 200,
            body: openRouterResponse(expectedActions),
          };
        }

        return { status: 404, body: '{}' };
      });

      // Temporarily override the OpenRouter URL constant by intercepting fetch
      let originalFetch = globalThis.fetch;
      globalThis.fetch = (async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        // Redirect OpenRouter calls to our local mock
        let url = String(input);
        if (url.startsWith('https://openrouter.ai/')) {
          let redirectUrl = url.replace('https://openrouter.ai', origin);
          return originalFetch(redirectUrl, init);
        }
        return originalFetch(input, init);
      }) as typeof globalThis.fetch;

      try {
        let agent = new OpenRouterFactoryAgent({
          model: 'google/gemini-2.5-pro',
          realmServerUrl: 'https://realms.example.test/',
          openRouterApiKey: 'sk-or-direct-test-key',
        });

        assert.true(
          agent.useDirectApi,
          'should use direct API path with API key',
        );

        let ctx = makeMinimalContext();
        let actions = await agent.plan(ctx);

        // Verify response parsing
        assert.strictEqual(actions.length, 2);
        assert.strictEqual(actions[0].type, 'create_test');
        assert.strictEqual(actions[0].path, 'TestSpec/hello.spec.ts');
        assert.strictEqual(actions[0].realm, 'test');
        assert.strictEqual(actions[1].type, 'done');

        // Verify auth header
        assert.strictEqual(
          capturedAuthHeader,
          'Bearer sk-or-direct-test-key',
          'API key sent in Authorization header',
        );

        // Verify body is NOT wrapped in proxy format
        assert.ok(capturedBody, 'body was captured');
        assert.strictEqual(
          capturedBody!.model,
          'google/gemini-2.5-pro',
          'model sent directly in body',
        );
        assert.false(capturedBody!.stream as boolean, 'stream is false');
        assert.true(Array.isArray(capturedBody!.messages), 'messages present');
        assert.strictEqual(
          capturedBody!.url,
          undefined,
          'no proxy wrapper url field',
        );
        assert.strictEqual(
          capturedBody!.requestBody,
          undefined,
          'no proxy wrapper requestBody field',
        );
      } finally {
        globalThis.fetch = originalFetch;
        await stopServer(server);
      }
    });

    test('direct path handles HTTP error from OpenRouter', async function (assert) {
      let { server, origin } = await startServer((_req, _body) => {
        return {
          status: 429,
          body: JSON.stringify({
            error: { message: 'Rate limited', type: 'rate_limit_error' },
          }),
        };
      });

      let originalFetch = globalThis.fetch;
      globalThis.fetch = (async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        let url = String(input);
        if (url.startsWith('https://openrouter.ai/')) {
          let redirectUrl = url.replace('https://openrouter.ai', origin);
          return originalFetch(redirectUrl, init);
        }
        return originalFetch(input, init);
      }) as typeof globalThis.fetch;

      try {
        let agent = new OpenRouterFactoryAgent({
          model: 'anthropic/claude-sonnet-4',
          realmServerUrl: 'https://realms.example.test/',
          openRouterApiKey: 'sk-or-test-key',
        });

        let ctx = makeMinimalContext();

        try {
          await agent.plan(ctx);
          assert.ok(false, 'should have thrown');
        } catch (err) {
          assert.true(err instanceof Error, 'throws an Error');
          assert.true(
            (err as Error).message.includes('429'),
            'error includes HTTP status',
          );
        }
      } finally {
        globalThis.fetch = originalFetch;
        await stopServer(server);
      }
    });
  },
);
