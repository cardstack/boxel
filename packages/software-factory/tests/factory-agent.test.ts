import { module, test } from 'qunit';

import { SupportedMimeType } from '@cardstack/runtime-common/supported-mime-type';

import {
  AgentActionValidationError,
  AgentResponseParseError,
  FACTORY_DEFAULT_MODEL,
  MockFactoryAgent,
  MockLoopAgent,
  OpenRouterFactoryAgent,
  ToolUseFactoryAgent,
  parseActionsFromResponse,
  resolveFactoryModel,
  validateAgentActions,
  type AgentAction,
  type AgentContext,
} from '../scripts/lib/factory-agent';

import {
  DONE_SIGNAL,
  CLARIFICATION_SIGNAL,
  type FactoryTool,
} from '../scripts/lib/factory-tool-builder';

// ---------------------------------------------------------------------------
// Fixtures
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
    let ctx = makeMinimalContext({ project: { id: 'Projects/recorded' } });

    await agent.plan(ctx);

    assert.strictEqual(agent.receivedContexts.length, 1);
    assert.strictEqual(
      agent.receivedContexts[0].project.id,
      'Projects/recorded',
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

  test('system message includes tool-use rules', function (assert) {
    let agent = new OpenRouterFactoryAgent({
      model: 'anthropic/claude-sonnet-4',
      realmServerUrl: 'https://realms.example.test/',
    });

    let ctx = makeMinimalContext();
    let messages = agent.buildMessages(ctx);

    assert.ok(
      messages[0].content.includes('signal_done'),
      'system message mentions signal_done',
    );
    assert.ok(
      messages[0].content.includes('write_file'),
      'system message mentions write_file',
    );
  });

  test('user message includes project and ticket context', function (assert) {
    let agent = new OpenRouterFactoryAgent({
      model: 'anthropic/claude-sonnet-4',
      realmServerUrl: 'https://realms.example.test/',
    });

    let ctx = makeMinimalContext({
      project: { id: 'Projects/sticky-note', objective: 'Build sticky notes' },
      ticket: {
        id: 'Tickets/define-core',
        summary: 'Define core card',
        description: 'Create the StickyNote card.',
      },
    });
    let messages = agent.buildMessages(ctx);

    assert.ok(
      messages[1].content.includes('Tickets/define-core'),
      'user message includes ticket ID',
    );
    assert.ok(
      messages[1].content.includes('Define core card'),
      'user message includes ticket summary',
    );
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

  test('system message includes realm URLs', function (assert) {
    let agent = new OpenRouterFactoryAgent({
      model: 'anthropic/claude-sonnet-4',
      realmServerUrl: 'https://realms.example.test/',
    });

    let ctx = makeMinimalContext();
    let messages = agent.buildMessages(ctx);

    assert.ok(
      messages[0].content.includes('https://realms.example.test/user/target/'),
      'system message includes target realm URL',
    );
  });

  test('includes test results in iterate mode', function (assert) {
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
    let previousActions = [
      {
        type: 'create_file' as const,
        path: 'card.gts',
        content: 'code',
        realm: 'target' as const,
      },
    ];
    let messages = agent.buildMessages(ctx, previousActions, 2);

    assert.ok(messages[1].content.includes('failed'));
    assert.ok(messages[1].content.includes('renders card'));
    assert.ok(messages[1].content.includes('Element not found'));
  });

  test('uses iterate template when testResults present even without explicit previousActions/iteration', function (assert) {
    let agent = new OpenRouterFactoryAgent({
      model: 'anthropic/claude-sonnet-4',
      realmServerUrl: 'https://realms.example.test/',
    });

    let ctx = makeMinimalContext({
      testResults: {
        status: 'failed',
        passedCount: 0,
        failedCount: 1,
        failures: [{ testName: 'basic', error: 'boom' }],
        durationMs: 1000,
      },
    });
    // Call buildMessages with no previousActions/iteration args
    let messages = agent.buildMessages(ctx);

    assert.ok(
      messages[1].content.includes('Fix the failing tests'),
      'uses iterate template when testResults present',
    );
    assert.ok(messages[1].content.includes('boom'), 'includes failure error');
  });

  test('includes tool results in implement prompt after invoke_tool', function (assert) {
    let agent = new OpenRouterFactoryAgent({
      model: 'anthropic/claude-sonnet-4',
      realmServerUrl: 'https://realms.example.test/',
    });

    let ctx = makeMinimalContext({
      tools: [
        {
          name: 'search-realm',
          description: 'Search cards',
          category: 'script' as const,
          args: [],
          outputFormat: 'json' as const,
        },
      ],
      toolResults: [
        {
          tool: 'search-realm',
          exitCode: 0,
          output: { cards: ['StickyNote/sample'] },
          durationMs: 200,
        },
      ],
    });
    // No testResults — should use implement template, but include tool results
    let messages = agent.buildMessages(ctx);

    assert.ok(
      messages[1].content.includes('Implement this ticket'),
      'uses implement template',
    );
    assert.ok(
      messages[1].content.includes('search-realm'),
      'includes tool name in results',
    );
    assert.ok(
      messages[1].content.includes('StickyNote/sample'),
      'includes tool output data',
    );
  });
});

// ---------------------------------------------------------------------------
// OpenRouterFactoryAgent.plan() threads iteration context
// ---------------------------------------------------------------------------

module(
  'factory-agent > OpenRouterFactoryAgent.plan() iteration context',
  function () {
    test('plan() uses iterate template when context has previousActions and testResults', async function (assert) {
      let capturedBody: string | undefined;

      let originalFetch = globalThis.fetch;
      globalThis.fetch = (async (
        _input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        capturedBody = typeof init?.body === 'string' ? init.body : undefined;
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify([{ type: 'done' }]),
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': SupportedMimeType.JSON } },
        );
      }) as typeof globalThis.fetch;

      try {
        let agent = new OpenRouterFactoryAgent({
          model: 'anthropic/claude-sonnet-4',
          realmServerUrl: 'https://realms.example.test/',
          openRouterApiKey: 'sk-or-test-key',
        });

        let ctx = makeMinimalContext({
          testResults: {
            status: 'failed',
            passedCount: 0,
            failedCount: 1,
            failures: [
              { testName: 'renders card', error: 'Element not found' },
            ],
            durationMs: 3000,
          },
          previousActions: [
            {
              type: 'create_file',
              path: 'card.gts',
              content: 'export class MyCard {}',
              realm: 'target',
            },
          ],
          iteration: 2,
        });

        await agent.plan(ctx);

        // Verify the user message sent to the LLM uses the iterate template
        let body = JSON.parse(capturedBody!);
        let userMessage = body.messages[1].content;
        assert.ok(
          userMessage.includes('Fix the failing tests'),
          'plan() sends iterate prompt when context has testResults + previousActions',
        );
        assert.ok(
          userMessage.includes('card.gts'),
          'iterate prompt includes previous actions from context',
        );
        assert.ok(
          userMessage.includes('iteration 2'),
          'iterate prompt includes iteration number from context',
        );
        assert.ok(
          userMessage.includes('Element not found'),
          'iterate prompt includes test failure details',
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  },
);

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
          { status: 200, headers: { 'Content-Type': SupportedMimeType.JSON } },
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
          { status: 200, headers: { 'Content-Type': SupportedMimeType.JSON } },
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

// ---------------------------------------------------------------------------
// ToolUseFactoryAgent
// ---------------------------------------------------------------------------

function makeDoneToolCallResponse() {
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'signal_done',
                arguments: '{}',
              },
            },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
  };
}

function makeClarificationToolCallResponse(message: string) {
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'request_clarification',
                arguments: JSON.stringify({ message }),
              },
            },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
  };
}

function makeTextOnlyResponse(text: string) {
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content: text,
        },
        finish_reason: 'stop',
      },
    ],
  };
}

function makeMultiToolCallResponse(
  toolCalls: { id: string; name: string; args: string }[],
) {
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: tc.args },
          })),
        },
        finish_reason: 'tool_calls',
      },
    ],
  };
}

function makeSignalDoneTool(): FactoryTool {
  return {
    name: 'signal_done',
    description: 'Signal done',
    parameters: { type: 'object', properties: {} },
    execute: async () => ({ signal: DONE_SIGNAL }),
  };
}

function makeClarificationTool(): FactoryTool {
  return {
    name: 'request_clarification',
    description: 'Request clarification',
    parameters: {
      type: 'object',
      properties: { message: { type: 'string' } },
      required: ['message'],
    },
    execute: async (args) => ({
      signal: CLARIFICATION_SIGNAL,
      message: args.message as string,
    }),
  };
}

module('factory-agent > ToolUseFactoryAgent', function (hooks) {
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

  test('constructor sets useDirectApi from config key', function (assert) {
    let agent = new ToolUseFactoryAgent({
      model: 'anthropic/claude-sonnet-4',
      realmServerUrl: 'https://realms.example.test/',
      openRouterApiKey: 'sk-or-test-key',
    });
    assert.true(agent.useDirectApi);
  });

  test('constructor uses proxy path when no API key', function (assert) {
    let agent = new ToolUseFactoryAgent({
      model: 'anthropic/claude-sonnet-4',
      realmServerUrl: 'https://realms.example.test/',
    });
    assert.false(agent.useDirectApi);
  });

  test('returns done when agent calls signal_done', async function (assert) {
    let originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify(makeDoneToolCallResponse()), {
        status: 200,
        headers: { 'Content-Type': SupportedMimeType.JSON },
      });
    }) as typeof globalThis.fetch;

    try {
      let agent = new ToolUseFactoryAgent({
        model: 'anthropic/claude-sonnet-4',
        realmServerUrl: 'https://realms.example.test/',
        openRouterApiKey: 'sk-or-test-key',
      });

      let ctx = makeMinimalContext();
      let tools = [makeSignalDoneTool(), makeClarificationTool()];
      let result = await agent.run(ctx, tools);

      assert.strictEqual(result.status, 'done');
      assert.strictEqual(result.toolCalls.length, 1);
      assert.strictEqual(result.toolCalls[0].tool, 'signal_done');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('returns blocked when agent calls request_clarification', async function (assert) {
    let originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify(
          makeClarificationToolCallResponse('What color should the notes be?'),
        ),
        { status: 200, headers: { 'Content-Type': SupportedMimeType.JSON } },
      );
    }) as typeof globalThis.fetch;

    try {
      let agent = new ToolUseFactoryAgent({
        model: 'anthropic/claude-sonnet-4',
        realmServerUrl: 'https://realms.example.test/',
        openRouterApiKey: 'sk-or-test-key',
      });

      let ctx = makeMinimalContext();
      let tools = [makeSignalDoneTool(), makeClarificationTool()];
      let result = await agent.run(ctx, tools);

      assert.strictEqual(result.status, 'blocked');
      assert.strictEqual(result.message, 'What color should the notes be?');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('returns needs_iteration when LLM stops without tool calls and no prior tool work', async function (assert) {
    let originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify(makeTextOnlyResponse('I need to think about this.')),
        { status: 200, headers: { 'Content-Type': SupportedMimeType.JSON } },
      );
    }) as typeof globalThis.fetch;

    try {
      let agent = new ToolUseFactoryAgent({
        model: 'anthropic/claude-sonnet-4',
        realmServerUrl: 'https://realms.example.test/',
        openRouterApiKey: 'sk-or-test-key',
      });

      let ctx = makeMinimalContext();
      let tools = [makeSignalDoneTool()];
      let result = await agent.run(ctx, tools);

      assert.strictEqual(result.status, 'needs_iteration');
      assert.strictEqual(result.toolCalls.length, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('sends tool definitions in the request body', async function (assert) {
    let capturedBody: string | undefined;
    let originalFetch = globalThis.fetch;
    globalThis.fetch = (async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      capturedBody = typeof init?.body === 'string' ? init.body : undefined;
      return new Response(JSON.stringify(makeDoneToolCallResponse()), {
        status: 200,
        headers: { 'Content-Type': SupportedMimeType.JSON },
      });
    }) as typeof globalThis.fetch;

    try {
      let agent = new ToolUseFactoryAgent({
        model: 'anthropic/claude-sonnet-4',
        realmServerUrl: 'https://realms.example.test/',
        openRouterApiKey: 'sk-or-test-key',
      });

      let ctx = makeMinimalContext();
      let tools = [makeSignalDoneTool()];
      await agent.run(ctx, tools);

      let body = JSON.parse(capturedBody!);
      assert.ok(Array.isArray(body.tools), 'request body has tools array');
      assert.strictEqual(body.tools.length, 1);
      assert.strictEqual(body.tools[0].type, 'function');
      assert.strictEqual(body.tools[0].function.name, 'signal_done');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('multi-turn: executes write_file then signal_done', async function (assert) {
    let callCount = 0;
    let originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      callCount++;
      if (callCount === 1) {
        // First call: LLM wants to write a file
        return new Response(
          JSON.stringify(
            makeMultiToolCallResponse([
              {
                id: 'call_1',
                name: 'write_file',
                args: JSON.stringify({
                  path: 'card.gts',
                  content: 'export class Card {}',
                }),
              },
            ]),
          ),
          { status: 200, headers: { 'Content-Type': SupportedMimeType.JSON } },
        );
      }
      // Second call: LLM signals done
      return new Response(JSON.stringify(makeDoneToolCallResponse()), {
        status: 200,
        headers: { 'Content-Type': SupportedMimeType.JSON },
      });
    }) as typeof globalThis.fetch;

    try {
      let agent = new ToolUseFactoryAgent({
        model: 'anthropic/claude-sonnet-4',
        realmServerUrl: 'https://realms.example.test/',
        openRouterApiKey: 'sk-or-test-key',
      });

      let writeTool: FactoryTool = {
        name: 'write_file',
        description: 'Write a file',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            content: { type: 'string' },
          },
        },
        execute: async () => ({ ok: true }),
      };

      let ctx = makeMinimalContext();
      let tools = [writeTool, makeSignalDoneTool(), makeClarificationTool()];
      let result = await agent.run(ctx, tools);

      assert.strictEqual(result.status, 'done');
      assert.strictEqual(result.toolCalls.length, 2);
      assert.strictEqual(result.toolCalls[0].tool, 'write_file');
      assert.strictEqual(result.toolCalls[1].tool, 'signal_done');
      assert.strictEqual(callCount, 2, 'made two API calls');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('handles unknown tool gracefully', async function (assert) {
    let callCount = 0;
    let originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      callCount++;
      if (callCount === 1) {
        // LLM calls a tool that doesn't exist
        return new Response(
          JSON.stringify(
            makeMultiToolCallResponse([
              {
                id: 'call_1',
                name: 'nonexistent_tool',
                args: '{}',
              },
            ]),
          ),
          { status: 200, headers: { 'Content-Type': SupportedMimeType.JSON } },
        );
      }
      return new Response(JSON.stringify(makeDoneToolCallResponse()), {
        status: 200,
        headers: { 'Content-Type': SupportedMimeType.JSON },
      });
    }) as typeof globalThis.fetch;

    try {
      let agent = new ToolUseFactoryAgent({
        model: 'anthropic/claude-sonnet-4',
        realmServerUrl: 'https://realms.example.test/',
        openRouterApiKey: 'sk-or-test-key',
      });

      let ctx = makeMinimalContext();
      let tools = [makeSignalDoneTool()];
      let result = await agent.run(ctx, tools);

      // Should still complete (unknown tool is logged, agent retries with signal_done)
      assert.strictEqual(result.status, 'done');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('throws on HTTP error from OpenRouter', async function (assert) {
    let originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response('Internal Server Error', { status: 500 });
    }) as typeof globalThis.fetch;

    try {
      let agent = new ToolUseFactoryAgent({
        model: 'anthropic/claude-sonnet-4',
        realmServerUrl: 'https://realms.example.test/',
        openRouterApiKey: 'sk-or-test-key',
      });

      let ctx = makeMinimalContext();
      let tools = [makeSignalDoneTool()];

      try {
        await agent.run(ctx, tools);
        assert.ok(false, 'should have thrown');
      } catch (error) {
        assert.ok(
          (error as Error).message.includes('HTTP 500'),
          `Error includes HTTP status: ${(error as Error).message}`,
        );
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ---------------------------------------------------------------------------
// MockLoopAgent
// ---------------------------------------------------------------------------

module('factory-agent > MockLoopAgent', function () {
  test('returns responses in sequence', async function (assert) {
    let agent = new MockLoopAgent([
      { status: 'done', toolCalls: [] },
      { status: 'blocked', toolCalls: [], message: 'Blocked' },
    ]);

    let ctx = makeMinimalContext();
    let tools: FactoryTool[] = [];

    let result1 = await agent.run(ctx, tools);
    assert.strictEqual(result1.status, 'done');

    let result2 = await agent.run(ctx, tools);
    assert.strictEqual(result2.status, 'blocked');

    assert.strictEqual(agent.callCount, 2);
  });

  test('records received contexts and tools', async function (assert) {
    let agent = new MockLoopAgent([{ status: 'done', toolCalls: [] }]);
    let ctx = makeMinimalContext({ project: { id: 'Projects/test' } });
    let tools: FactoryTool[] = [makeSignalDoneTool()];

    await agent.run(ctx, tools);

    assert.strictEqual(agent.receivedContexts.length, 1);
    assert.strictEqual(agent.receivedContexts[0].project.id, 'Projects/test');
    assert.strictEqual(agent.receivedTools.length, 1);
    assert.strictEqual(agent.receivedTools[0].length, 1);
  });

  test('throws on overrun', async function (assert) {
    let agent = new MockLoopAgent([{ status: 'done', toolCalls: [] }]);
    let ctx = makeMinimalContext();

    await agent.run(ctx, []);

    try {
      await agent.run(ctx, []);
      assert.ok(false, 'should have thrown');
    } catch (err) {
      assert.ok((err as Error).message.includes('exhausted'));
    }
  });
});
