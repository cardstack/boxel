/**
 * Integration test asserting the schema boundary between the two agent
 * backends never crosses over:
 *
 *   ClaudeCodeFactoryAgent  → Zod schemas only (never JSON Schema)
 *   ToolUseFactoryAgent     → JSON Schema only (never Zod)
 *
 * The factory defines tools with JSON-Schema `parameters`. OpenRouter
 * consumes those verbatim. The Claude Agent SDK consumes Zod — so a dedicated
 * adapter converts JSON Schema → Zod at the Claude edge. These tests ensure:
 *
 *   1. The static boundary: ToolUseFactoryAgent's source never imports Zod or
 *      the schema adapter; ClaudeCodeFactoryAgent's source does.
 *   2. The runtime boundary: what each agent actually hands to its transport
 *      is the expected schema shape.
 *
 * If any of these tests starts failing, the factory is probably losing the
 * single-seam property — which means both backends now carry conversion
 * logic, which is precisely what the separation is meant to prevent.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { module, test } from 'qunit';

import { SupportedMimeType } from '@cardstack/runtime-common/supported-mime-type';

import {
  ClaudeCodeFactoryAgent,
  buildSdkToolsFromFactoryTools,
} from '../src/factory-agent-claude-code';
import { ToolUseFactoryAgent } from '../src/factory-agent-tool-use';
import { OPENROUTER_CHAT_URL } from '../src/factory-agent-types';
import type { AgentContext } from '../src/factory-agent-types';
import type { FactoryTool } from '../src/factory-tool-builder';
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
// Static import-boundary test
// ---------------------------------------------------------------------------

module('factory-agent-schema-boundary / static', function () {
  test('ToolUseFactoryAgent source never imports Zod or the schema adapter', function (assert) {
    let src = readFileSync(
      resolve(__dirname, '../src/factory-agent-tool-use.ts'),
      'utf8',
    );
    assert.notOk(
      /from\s+['"]zod['"]/m.test(src),
      'ToolUseFactoryAgent must not import from "zod"',
    );
    assert.notOk(
      /from\s+['"]zod-from-json-schema['"]/m.test(src),
      'ToolUseFactoryAgent must not import from "zod-from-json-schema"',
    );
    assert.notOk(
      /from\s+['"]\.\/factory-tool-schema-adapter['"]/m.test(src),
      'ToolUseFactoryAgent must not import the schema adapter',
    );
    assert.notOk(
      /from\s+['"]@anthropic-ai\/claude-agent-sdk['"]/m.test(src),
      'ToolUseFactoryAgent must not import the Claude Agent SDK',
    );
  });

  test('ClaudeCodeFactoryAgent source never imports OpenRouter constants', function (assert) {
    let src = readFileSync(
      resolve(__dirname, '../src/factory-agent-claude-code.ts'),
      'utf8',
    );
    assert.notOk(
      /OPENROUTER_CHAT_URL/.test(src),
      'ClaudeCodeFactoryAgent must not reference OPENROUTER_CHAT_URL',
    );
    assert.notOk(
      /_request-forward/.test(src),
      'ClaudeCodeFactoryAgent must not reference the OpenRouter proxy endpoint',
    );
  });

  test('ClaudeCodeFactoryAgent imports the adapter exactly once', function (assert) {
    let src = readFileSync(
      resolve(__dirname, '../src/factory-agent-claude-code.ts'),
      'utf8',
    );
    let matches = src.match(/from\s+['"]\.\/factory-tool-schema-adapter['"]/g);
    let count = matches?.length ?? 0;
    assert.strictEqual(count, 1, 'exactly one import from the schema adapter');
  });
});

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
    // `ToolUseFactoryAgent` switches to a direct OpenRouter HTTP path when
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

    let agent = new ToolUseFactoryAgent(
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
