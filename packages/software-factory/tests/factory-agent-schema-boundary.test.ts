/**
 * Runtime integration test asserting the schema boundary between the two
 * agent backends:
 *
 *   ClaudeCodeFactoryAgent  → Zod schemas only (never JSON Schema)
 *   OpenRouterFactoryAgent  → JSON Schema only (never Zod)
 *
 * The factory defines tools with JSON-Schema `parameters`. OpenRouter
 * consumes those verbatim; the Claude Agent SDK consumes Zod — so a
 * dedicated adapter converts JSON Schema → Zod at the Claude edge. This
 * test inspects what each agent actually hands to its transport and
 * catches any regression where the two shapes cross over.
 */

import { module, test } from 'qunit';

import { SupportedMimeType } from '@cardstack/runtime-common/supported-mime-type';

import {
  ClaudeCodeFactoryAgent,
  buildSdkToolsFromFactoryTools,
} from '../src/factory-agent/claude-code';
import { OpenRouterFactoryAgent } from '../src/factory-agent/openrouter';
import { OPENROUTER_CHAT_URL } from '../src/factory-agent';
import type { AgentContext } from '../src/factory-agent';
import type { FactoryTool } from '../src/factory-tool-builder';
import { DONE_SIGNAL } from '../src/factory-tool-builder';
import type { PromptLoader } from '../src/factory-prompt-loader';
import type { BoxelCLIClient } from '@cardstack/boxel-cli/api';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const stubPromptLoader: PromptLoader = {
  load: () => '[test prompt]',
};

function makeTool(): FactoryTool {
  return {
    name: 'write_file',
    description: 'write a file',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['path', 'content'],
    },
    execute: async () => ({ ok: true }),
  };
}

function makeContext(): AgentContext {
  return {
    project: { id: 'Projects/demo' },
    issue: { id: 'Issues/demo', issueType: 'feature' },
    knowledge: [],
    skills: [],
    targetRealmUrl: 'https://realms.example.test/hassan/personal/',
  };
}

function emptyQueryIterator() {
  return {
    async *[Symbol.asyncIterator]() {},
    async next() {
      return { value: undefined, done: true as const };
    },
    async return() {
      return { value: undefined, done: true as const };
    },
    async throw(err: unknown) {
      throw err;
    },
    async interrupt() {},
    async setPermissionMode() {},
    async setModel() {},
    async setMaxThinkingTokens() {},
    async applySettings() {},
    async mcpServerStatus() {
      return [];
    },
    async supportedCommands() {
      return [];
    },
    async setModelConfig() {},
  };
}

// ---------------------------------------------------------------------------
// Runtime schema-shape tests
// ---------------------------------------------------------------------------

module('factory-agent-schema-boundary / runtime', function () {
  test('Claude path: MCP tool definitions carry Zod shapes, not JSON Schema', function (assert) {
    let sdkTools = buildSdkToolsFromFactoryTools([makeTool()], {
      onToolCall: () => {},
      onSignal: () => {},
    });

    let inputSchema = sdkTools[0].inputSchema as Record<string, unknown>;

    // JSON Schema would expose `{ type: 'object', properties: {...} }`.
    // Zod raw shape exposes `{ <propertyName>: ZodType }`.
    assert.notStrictEqual(
      (inputSchema as { type?: unknown }).type,
      'object',
      'Claude path: inputSchema is NOT a JSON Schema with top-level "type"',
    );
    assert.ok(inputSchema.path, 'Claude path: inputSchema.path is set');
    assert.strictEqual(
      typeof inputSchema.path,
      'object',
      'Claude path: inputSchema has keyed entries per property',
    );
    let pathField = inputSchema.path as { parse?: unknown };
    assert.strictEqual(
      typeof pathField.parse,
      'function',
      'Claude path: each property is a Zod type (exposes .parse)',
    );
  });

  test('OpenRouter path: the wire body carries raw JSON Schema tool definitions', async function (assert) {
    // `OpenRouterFactoryAgent` switches to a direct OpenRouter HTTP path when
    // `OPENROUTER_API_KEY` is present in the environment, which would
    // bypass our `fakeClient.authedServerFetch` capture and make this test
    // depend on the developer/CI env. Force the proxy path for the duration
    // of the test and restore the original value afterwards.
    let savedApiKey = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;

    let capturedBody: Record<string, unknown> | undefined;

    // Minimal BoxelCLIClient stub that intercepts the proxied request and
    // returns an empty OpenRouter response so the tool-use loop terminates.
    let fakeClient = {
      authedServerFetch: async (_url: string, init?: RequestInit) => {
        let outer = JSON.parse(String(init?.body ?? '{}')) as Record<
          string,
          unknown
        >;
        capturedBody = JSON.parse(String(outer.requestBody ?? '{}')) as Record<
          string,
          unknown
        >;
        return new Response(
          JSON.stringify({
            choices: [{ message: { role: 'assistant', content: 'ok' } }],
          }),
          {
            status: 200,
            headers: { 'Content-Type': SupportedMimeType.JSON },
          },
        );
      },
    } as unknown as BoxelCLIClient;

    let agent = new OpenRouterFactoryAgent(
      {
        model: 'anthropic/claude-opus-4',
        realmServerUrl: 'https://realms.example.test/',
        client: fakeClient,
      },
      stubPromptLoader,
    );

    try {
      await agent.run(makeContext(), [makeTool()]);
    } finally {
      if (savedApiKey !== undefined) {
        process.env.OPENROUTER_API_KEY = savedApiKey;
      }
    }

    assert.ok(capturedBody, 'OpenRouter POST body was captured');
    let toolsOnWire = (capturedBody as { tools?: unknown[] }).tools;
    assert.true(
      Array.isArray(toolsOnWire),
      'OpenRouter body has a tools array',
    );
    assert.strictEqual(
      toolsOnWire?.length,
      1,
      'OpenRouter body includes exactly one tool definition',
    );

    let params = (
      toolsOnWire![0] as {
        function: { parameters: Record<string, unknown> };
      }
    ).function.parameters;

    // This is the key assertion: OpenRouter sees raw JSON Schema. If the
    // adapter ever bled into this path, parameters would carry Zod
    // internal state (e.g., `_def`) and `params.type === 'object'` would
    // probably be gone.
    assert.strictEqual(
      (params as { type?: string }).type,
      'object',
      'OpenRouter path: parameters retain JSON Schema "type: object"',
    );
    assert.ok(
      (params as { properties?: unknown }).properties,
      'OpenRouter path: parameters retain JSON Schema "properties"',
    );
    assert.notOk(
      (params as { _def?: unknown })._def,
      'OpenRouter path: parameters do NOT carry Zod internal "_def"',
    );

    // CS-10814: the OpenAI-compatible `parallel_tool_calls` flag must be
    // asserted on the wire so the route batches multiple tool_use blocks
    // per assistant turn instead of serializing them 1-per-turn.
    let parallelToolCalls = (capturedBody as { parallel_tool_calls?: boolean })
      .parallel_tool_calls;
    assert.true(
      parallelToolCalls,
      'OpenRouter body sets parallel_tool_calls: true when tools are present',
    );
  });

  test('OpenRouter path: batched turn with signal_done still runs every tool in the batch', async function (assert) {
    // CS-10814 review follow-up: with parallel_tool_calls enabled the model
    // can emit `signal_done` alongside other tool_calls in a single assistant
    // turn. Returning as soon as we saw `signal_done` used to drop the
    // siblings; assert every tool in the batch executes before we report
    // `done`.
    let savedApiKey = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;

    let writeCount = 0;
    let writeTool: FactoryTool = {
      name: 'write_file',
      description: 'write a file',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: async () => {
        writeCount += 1;
        return { ok: true };
      },
    };
    let doneTool: FactoryTool = {
      name: 'signal_done',
      description: 'signal the agent is done',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: async () => ({ signal: DONE_SIGNAL }),
    };

    let fakeClient = {
      authedServerFetch: async () => {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [
                    {
                      id: 'call_write_1',
                      type: 'function',
                      function: { name: 'write_file', arguments: '{}' },
                    },
                    {
                      id: 'call_done_1',
                      type: 'function',
                      function: { name: 'signal_done', arguments: '{}' },
                    },
                    {
                      id: 'call_write_2',
                      type: 'function',
                      function: { name: 'write_file', arguments: '{}' },
                    },
                  ],
                },
              },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': SupportedMimeType.JSON },
          },
        );
      },
    } as unknown as BoxelCLIClient;

    let agent = new OpenRouterFactoryAgent(
      {
        model: 'anthropic/claude-opus-4',
        realmServerUrl: 'https://realms.example.test/',
        client: fakeClient,
      },
      stubPromptLoader,
    );

    let result;
    try {
      result = await agent.run(makeContext(), [writeTool, doneTool]);
    } finally {
      if (savedApiKey !== undefined) {
        process.env.OPENROUTER_API_KEY = savedApiKey;
      }
    }

    assert.strictEqual(
      writeCount,
      2,
      'both write_file calls in the batch execute even when signal_done appears between them',
    );
    assert.strictEqual(
      result.status,
      'done',
      'run() still reports done when the batch contained signal_done',
    );
    assert.strictEqual(
      result.toolCalls.length,
      3,
      'toolCalls log captures every call in the batch, not just the ones before signal_done',
    );
  });

  test('Claude path: run() does not touch OPENROUTER_CHAT_URL', async function (assert) {
    let fetchCalls: string[] = [];
    let originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      let url = typeof input === 'string' ? input : String(input);
      fetchCalls.push(url);
      return new Response('{}', {
        status: 200,
        headers: { 'Content-Type': SupportedMimeType.JSON },
      });
    }) as typeof globalThis.fetch;

    try {
      let agent = new ClaudeCodeFactoryAgent(
        {},
        {
          promptLoader: stubPromptLoader,
          queryFn: () => emptyQueryIterator() as never,
        },
      );

      await agent.run(makeContext(), [makeTool()]);

      let anyOpenRouterHit = fetchCalls.some((u) =>
        u.includes(OPENROUTER_CHAT_URL),
      );
      assert.notOk(
        anyOpenRouterHit,
        'ClaudeCodeFactoryAgent must not hit the OpenRouter URL',
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
