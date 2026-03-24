import { module, test } from 'qunit';

import {
  AgentActionValidationError,
  AgentResponseParseError,
  FACTORY_DEFAULT_MODEL,
  MockFactoryAgent,
  OpenRouterFactoryAgent,
  parseActionsFromResponse,
  resolveFactoryModel,
  validateAgentActions,
  type AgentAction,
  type AgentContext,
} from '../scripts/lib/factory-agent';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeMinimalContext(overrides?: Partial<AgentContext>): AgentContext {
  return {
    project: { id: 'Project/test-project' },
    ticket: { id: 'Ticket/test-ticket' },
    knowledge: [],
    skills: [],
    tools: [],
    targetRealmUrl: 'https://realms.example.test/user/target/',
    testRealmUrl: 'https://realms.example.test/user/target-tests/',
    ...overrides,
  };
}

const validCreateFile: AgentAction = {
  type: 'create_file',
  path: 'CardDef/my-card.gts',
  content: 'export class MyCard {}',
  realm: 'target',
};

const validDone: AgentAction = { type: 'done' };

// ---------------------------------------------------------------------------
// validateAgentActions
// ---------------------------------------------------------------------------

module('factory-agent > validateAgentActions', function () {
  test('accepts valid file action', function (assert) {
    let result = validateAgentActions([validCreateFile]);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].type, 'create_file');
    assert.strictEqual(result[0].path, 'CardDef/my-card.gts');
  });

  test('accepts all valid action types', function (assert) {
    let actions: Record<string, unknown>[] = [
      {
        type: 'create_file',
        path: 'a.gts',
        content: 'c',
        realm: 'target',
      },
      {
        type: 'update_file',
        path: 'b.gts',
        content: 'c',
        realm: 'target',
      },
      {
        type: 'create_test',
        path: 'a.spec.ts',
        content: 'c',
        realm: 'test',
      },
      {
        type: 'update_test',
        path: 'b.spec.ts',
        content: 'c',
        realm: 'test',
      },
      { type: 'update_ticket', content: 'notes' },
      { type: 'create_knowledge', path: 'k.md', content: 'c' },
      { type: 'invoke_tool', tool: 'search-realm' },
      { type: 'request_clarification', content: 'unclear' },
      { type: 'done' },
    ];

    let result = validateAgentActions(actions);
    assert.strictEqual(result.length, 9);
  });

  test('rejects invalid action type', function (assert) {
    assert.throws(
      () => validateAgentActions([{ type: 'delete_everything' }]),
      (err: Error) => err instanceof AgentActionValidationError,
      'throws AgentActionValidationError',
    );
  });

  test('rejects action that is not an object', function (assert) {
    assert.throws(
      () => validateAgentActions(['not an object']),
      (err: Error) => err instanceof AgentActionValidationError,
    );
  });

  test('rejects null action', function (assert) {
    assert.throws(
      () => validateAgentActions([null]),
      (err: Error) => err instanceof AgentActionValidationError,
    );
  });

  test('rejects create_file without path', function (assert) {
    assert.throws(
      () => validateAgentActions([{ type: 'create_file', content: 'hello' }]),
      (err: Error) =>
        err instanceof AgentActionValidationError &&
        err.message.includes('path'),
    );
  });

  test('rejects create_file without content', function (assert) {
    assert.throws(
      () => validateAgentActions([{ type: 'create_file', path: 'a.gts' }]),
      (err: Error) =>
        err instanceof AgentActionValidationError &&
        err.message.includes('content'),
    );
  });

  test('rejects invoke_tool without tool name', function (assert) {
    assert.throws(
      () => validateAgentActions([{ type: 'invoke_tool' }]),
      (err: Error) =>
        err instanceof AgentActionValidationError &&
        err.message.includes('tool'),
    );
  });

  test('rejects invoke_tool with non-object toolArgs', function (assert) {
    assert.throws(
      () =>
        validateAgentActions([
          { type: 'invoke_tool', tool: 'search-realm', toolArgs: 'bad' },
        ]),
      (err: Error) =>
        err instanceof AgentActionValidationError &&
        err.message.includes('toolArgs'),
    );
  });

  test('rejects invoke_tool with array toolArgs', function (assert) {
    assert.throws(
      () =>
        validateAgentActions([
          { type: 'invoke_tool', tool: 'search-realm', toolArgs: ['bad'] },
        ]),
      (err: Error) =>
        err instanceof AgentActionValidationError &&
        err.message.includes('toolArgs'),
    );
  });

  test('rejects invalid realm value', function (assert) {
    assert.throws(
      () =>
        validateAgentActions([
          {
            type: 'create_file',
            path: 'a.gts',
            content: 'c',
            realm: 'source',
          },
        ]),
      (err: Error) =>
        err instanceof AgentActionValidationError &&
        err.message.includes('realm'),
    );
  });

  test('accepts action without realm (realm is optional)', function (assert) {
    let result = validateAgentActions([
      { type: 'create_file', path: 'a.gts', content: 'c' },
    ]);
    assert.strictEqual(result[0].realm, undefined);
  });
});

// ---------------------------------------------------------------------------
// parseActionsFromResponse
// ---------------------------------------------------------------------------

module('factory-agent > parseActionsFromResponse', function () {
  test('parses clean JSON array', function (assert) {
    let json = JSON.stringify([validDone]);
    let result = parseActionsFromResponse(json);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].type, 'done');
  });

  test('parses markdown-fenced JSON', function (assert) {
    let fenced = '```json\n' + JSON.stringify([validDone]) + '\n```';
    let result = parseActionsFromResponse(fenced);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].type, 'done');
  });

  test('parses markdown-fenced JSON without language tag', function (assert) {
    let fenced = '```\n' + JSON.stringify([validDone]) + '\n```';
    let result = parseActionsFromResponse(fenced);
    assert.strictEqual(result.length, 1);
  });

  test('rejects non-JSON response', function (assert) {
    assert.throws(
      () => parseActionsFromResponse('I cannot do that, Dave.'),
      (err: Error) => err instanceof AgentResponseParseError,
    );
  });

  test('rejects JSON object (not array)', function (assert) {
    assert.throws(
      () => parseActionsFromResponse('{"type": "done"}'),
      (err: Error) =>
        err instanceof AgentResponseParseError && err.message.includes('array'),
    );
  });

  test('rejects JSON string', function (assert) {
    assert.throws(
      () => parseActionsFromResponse('"just a string"'),
      (err: Error) => err instanceof AgentResponseParseError,
    );
  });
});

// ---------------------------------------------------------------------------
// resolveFactoryModel
// ---------------------------------------------------------------------------

module('factory-agent > resolveFactoryModel', function (hooks) {
  let originalEnv: string | undefined;

  hooks.beforeEach(function () {
    originalEnv = process.env.FACTORY_LLM_MODEL;
    delete process.env.FACTORY_LLM_MODEL;
  });

  hooks.afterEach(function () {
    if (originalEnv !== undefined) {
      process.env.FACTORY_LLM_MODEL = originalEnv;
    } else {
      delete process.env.FACTORY_LLM_MODEL;
    }
  });

  test('prefers explicit CLI model', function (assert) {
    process.env.FACTORY_LLM_MODEL = 'openai/gpt-4o';
    let result = resolveFactoryModel('google/gemini-2.5-pro');
    assert.strictEqual(result, 'google/gemini-2.5-pro');
  });

  test('falls back to env var when no CLI model', function (assert) {
    process.env.FACTORY_LLM_MODEL = 'openai/gpt-4o';
    let result = resolveFactoryModel();
    assert.strictEqual(result, 'openai/gpt-4o');
  });

  test('falls back to FACTORY_DEFAULT_MODEL when no CLI or env', function (assert) {
    let result = resolveFactoryModel();
    assert.strictEqual(result, FACTORY_DEFAULT_MODEL);
  });

  test('trims whitespace from CLI model', function (assert) {
    let result = resolveFactoryModel('  anthropic/claude-opus-4  ');
    assert.strictEqual(result, 'anthropic/claude-opus-4');
  });

  test('ignores empty string CLI model', function (assert) {
    process.env.FACTORY_LLM_MODEL = 'openai/gpt-4o';
    let result = resolveFactoryModel('  ');
    assert.strictEqual(result, 'openai/gpt-4o');
  });

  test('ignores empty string env var', function (assert) {
    process.env.FACTORY_LLM_MODEL = '   ';
    let result = resolveFactoryModel();
    assert.strictEqual(result, FACTORY_DEFAULT_MODEL);
  });
});

// ---------------------------------------------------------------------------
// MockFactoryAgent
// ---------------------------------------------------------------------------

module('factory-agent > MockFactoryAgent', function () {
  test('returns responses in sequence', async function (assert) {
    let response1: AgentAction[] = [
      { type: 'create_file', path: 'a.gts', content: 'first' },
    ];
    let response2: AgentAction[] = [{ type: 'done' }];

    let agent = new MockFactoryAgent([response1, response2]);
    let ctx = makeMinimalContext();

    let result1 = await agent.plan(ctx);
    assert.deepEqual(result1, response1);

    let result2 = await agent.plan(ctx);
    assert.deepEqual(result2, response2);

    assert.strictEqual(agent.callCount, 2);
  });

  test('records received contexts', async function (assert) {
    let agent = new MockFactoryAgent([[{ type: 'done' }]]);
    let ctx = makeMinimalContext({ project: { id: 'Project/recorded' } });

    await agent.plan(ctx);

    assert.strictEqual(agent.receivedContexts.length, 1);
    assert.strictEqual(
      agent.receivedContexts[0].project.id,
      'Project/recorded',
    );
  });

  test('throws on overrun', async function (assert) {
    let agent = new MockFactoryAgent([[{ type: 'done' }]]);
    let ctx = makeMinimalContext();

    await agent.plan(ctx); // first call OK

    try {
      await agent.plan(ctx); // second call should throw
      assert.ok(false, 'should have thrown');
    } catch (err) {
      assert.true(err instanceof Error, 'throws an Error');
      assert.true(
        (err as Error).message.includes('exhausted'),
        'throws exhaustion error',
      );
    }
  });
});

// ---------------------------------------------------------------------------
// OpenRouterFactoryAgent.buildMessages
// ---------------------------------------------------------------------------

module('factory-agent > OpenRouterFactoryAgent.buildMessages', function () {
  test('returns [system, user] message pair', function (assert) {
    let agent = new OpenRouterFactoryAgent({
      model: 'anthropic/claude-sonnet-4',
      realmServerUrl: 'https://realms.example.test/',
    });

    let ctx = makeMinimalContext();
    let messages = agent.buildMessages(ctx);

    assert.strictEqual(messages.length, 2);
    assert.strictEqual(messages[0].role, 'system');
    assert.strictEqual(messages[1].role, 'user');
  });

  test('system message includes action types', function (assert) {
    let agent = new OpenRouterFactoryAgent({
      model: 'anthropic/claude-sonnet-4',
      realmServerUrl: 'https://realms.example.test/',
    });

    let ctx = makeMinimalContext();
    let messages = agent.buildMessages(ctx);

    assert.ok(
      messages[0].content.includes('create_file'),
      'system message mentions create_file',
    );
    assert.ok(
      messages[0].content.includes('done'),
      'system message mentions done',
    );
  });

  test('user message includes project and ticket IDs', function (assert) {
    let agent = new OpenRouterFactoryAgent({
      model: 'anthropic/claude-sonnet-4',
      realmServerUrl: 'https://realms.example.test/',
    });

    let ctx = makeMinimalContext({
      project: { id: 'Project/sticky-note' },
      ticket: { id: 'Ticket/define-core' },
    });
    let messages = agent.buildMessages(ctx);

    assert.ok(messages[1].content.includes('Project/sticky-note'));
    assert.ok(messages[1].content.includes('Ticket/define-core'));
  });

  test('includes skills when present', function (assert) {
    let agent = new OpenRouterFactoryAgent({
      model: 'anthropic/claude-sonnet-4',
      realmServerUrl: 'https://realms.example.test/',
    });

    let ctx = makeMinimalContext({
      skills: [{ name: 'boxel-development', content: 'skill content' }],
    });
    let messages = agent.buildMessages(ctx);

    assert.ok(messages[0].content.includes('boxel-development'));
  });

  test('includes tools when present', function (assert) {
    let agent = new OpenRouterFactoryAgent({
      model: 'anthropic/claude-sonnet-4',
      realmServerUrl: 'https://realms.example.test/',
    });

    let ctx = makeMinimalContext({
      tools: [
        {
          name: 'search-realm',
          description: 'Search cards',
          category: 'script',
          args: [],
          outputFormat: 'json',
        },
      ],
    });
    let messages = agent.buildMessages(ctx);

    assert.ok(messages[0].content.includes('search-realm'));
    assert.ok(messages[0].content.includes('Search cards'));
  });

  test('includes test results when present', function (assert) {
    let agent = new OpenRouterFactoryAgent({
      model: 'anthropic/claude-sonnet-4',
      realmServerUrl: 'https://realms.example.test/',
    });

    let ctx = makeMinimalContext({
      testResults: {
        status: 'failed',
        passedCount: 2,
        failedCount: 1,
        failures: [
          {
            testName: 'renders card',
            error: 'Element not found',
          },
        ],
        durationMs: 3000,
      },
    });
    let messages = agent.buildMessages(ctx);

    assert.ok(messages[1].content.includes('failed'));
    assert.ok(messages[1].content.includes('renders card'));
    assert.ok(messages[1].content.includes('Element not found'));
  });
});

// ---------------------------------------------------------------------------
// OpenRouterFactoryAgent API path selection
// ---------------------------------------------------------------------------

module(
  'factory-agent > OpenRouterFactoryAgent API path selection',
  function (hooks) {
    let originalEnv: string | undefined;

    hooks.beforeEach(function () {
      originalEnv = process.env.OPENROUTER_API_KEY;
      delete process.env.OPENROUTER_API_KEY;
    });

    hooks.afterEach(function () {
      if (originalEnv !== undefined) {
        process.env.OPENROUTER_API_KEY = originalEnv;
      } else {
        delete process.env.OPENROUTER_API_KEY;
      }
    });

    test('uses proxy path when no API key is provided', function (assert) {
      let agent = new OpenRouterFactoryAgent({
        model: 'anthropic/claude-sonnet-4',
        realmServerUrl: 'https://realms.example.test/',
      });

      assert.false(agent.useDirectApi, 'should use proxy path');
    });

    test('treats empty OPENROUTER_API_KEY as missing (falls back to proxy)', function (assert) {
      process.env.OPENROUTER_API_KEY = '';

      let agent = new OpenRouterFactoryAgent({
        model: 'anthropic/claude-sonnet-4',
        realmServerUrl: 'https://realms.example.test/',
      });

      assert.false(
        agent.useDirectApi,
        'empty env var should not trigger direct path',
      );
    });

    test('treats whitespace-only OPENROUTER_API_KEY as missing', function (assert) {
      process.env.OPENROUTER_API_KEY = '   ';

      let agent = new OpenRouterFactoryAgent({
        model: 'anthropic/claude-sonnet-4',
        realmServerUrl: 'https://realms.example.test/',
      });

      assert.false(
        agent.useDirectApi,
        'whitespace env var should not trigger direct path',
      );
    });

    test('uses direct path when openRouterApiKey is in config', function (assert) {
      let agent = new OpenRouterFactoryAgent({
        model: 'anthropic/claude-sonnet-4',
        realmServerUrl: 'https://realms.example.test/',
        openRouterApiKey: 'sk-or-test-key',
      });

      assert.true(agent.useDirectApi, 'should use direct API path');
    });

    test('uses direct path when OPENROUTER_API_KEY env var is set', function (assert) {
      process.env.OPENROUTER_API_KEY = 'sk-or-env-key';

      let agent = new OpenRouterFactoryAgent({
        model: 'anthropic/claude-sonnet-4',
        realmServerUrl: 'https://realms.example.test/',
      });

      assert.true(agent.useDirectApi, 'should use direct API path from env');
    });

    test('OPENROUTER_API_KEY env var takes precedence over config', function (assert) {
      process.env.OPENROUTER_API_KEY = 'sk-or-env-key';

      let agent = new OpenRouterFactoryAgent({
        model: 'anthropic/claude-sonnet-4',
        realmServerUrl: 'https://realms.example.test/',
        openRouterApiKey: 'sk-or-config-key',
      });

      assert.true(
        agent.useDirectApi,
        'should use direct API path from env var',
      );
    });

    test('proxy path calls _request-forward with wrapped body', async function (assert) {
      let capturedUrl: string | undefined;
      let capturedBody: string | undefined;

      let originalFetch = globalThis.fetch;
      globalThis.fetch = (async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        capturedUrl = String(input);
        capturedBody = typeof init?.body === 'string' ? init.body : undefined;
        return new Response(
          JSON.stringify({
            choices: [
              { message: { content: JSON.stringify([{ type: 'done' }]) } },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }) as typeof globalThis.fetch;

      try {
        let agent = new OpenRouterFactoryAgent({
          model: 'anthropic/claude-sonnet-4',
          realmServerUrl: 'https://realms.example.test/',
        });

        let ctx = makeMinimalContext();
        let actions = await agent.plan(ctx);

        assert.strictEqual(actions.length, 1);
        assert.strictEqual(actions[0].type, 'done');
        assert.strictEqual(
          capturedUrl,
          'https://realms.example.test/_request-forward',
          'calls the proxy endpoint',
        );

        let body = JSON.parse(capturedBody!);
        assert.strictEqual(
          body.url,
          'https://openrouter.ai/api/v1/chat/completions',
          'proxy body wraps the OpenRouter URL',
        );
        assert.strictEqual(body.method, 'POST');
        assert.strictEqual(
          typeof body.requestBody,
          'string',
          'requestBody is a JSON string',
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    test('direct path calls OpenRouter URL directly with Authorization header', async function (assert) {
      let capturedUrl: string | undefined;
      let capturedHeaders: Headers | undefined;
      let capturedBody: string | undefined;

      let originalFetch = globalThis.fetch;
      globalThis.fetch = (async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        capturedUrl = String(input);
        capturedHeaders = new Headers(init?.headers);
        capturedBody = typeof init?.body === 'string' ? init.body : undefined;
        return new Response(
          JSON.stringify({
            choices: [
              { message: { content: JSON.stringify([{ type: 'done' }]) } },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }) as typeof globalThis.fetch;

      try {
        let agent = new OpenRouterFactoryAgent({
          model: 'anthropic/claude-sonnet-4',
          realmServerUrl: 'https://realms.example.test/',
          openRouterApiKey: 'sk-or-test-key',
        });

        let ctx = makeMinimalContext();
        let actions = await agent.plan(ctx);

        assert.strictEqual(actions.length, 1);
        assert.strictEqual(actions[0].type, 'done');
        assert.strictEqual(
          capturedUrl,
          'https://openrouter.ai/api/v1/chat/completions',
          'calls OpenRouter directly',
        );
        assert.strictEqual(
          capturedHeaders!.get('Authorization'),
          'Bearer sk-or-test-key',
          'sends API key in Authorization header',
        );

        let body = JSON.parse(capturedBody!);
        assert.strictEqual(
          body.model,
          'anthropic/claude-sonnet-4',
          'model is in the request body directly (not wrapped)',
        );
        assert.ok(
          Array.isArray(body.messages),
          'messages array is in the body directly',
        );
        assert.strictEqual(body.url, undefined, 'no proxy wrapper url field');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  },
);
