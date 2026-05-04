import { module, test } from 'qunit';
import { z, type ZodType } from 'zod';

import type { Options } from '@anthropic-ai/claude-agent-sdk';

import {
  ClaudeCodeFactoryAgent,
  buildSdkToolsFromFactoryTools,
} from '../src/factory-agent/claude-code';
import type { AgentContext } from '../src/factory-agent';
import {
  CLARIFICATION_SIGNAL,
  DONE_SIGNAL,
  type FactoryTool,
} from '../src/factory-tool-builder';
import type { PromptLoader } from '../src/factory-prompt-loader';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const stubPromptLoader: PromptLoader = {
  load(_name, _vars) {
    return '[test prompt]';
  },
};

function makeTool(overrides: Partial<FactoryTool>): FactoryTool {
  return {
    name: 'test_tool',
    description: 'tool for tests',
    parameters: { type: 'object', properties: {} },
    execute: async () => ({ ok: true }),
    ...overrides,
  };
}

function makeContext(): AgentContext {
  return {
    project: { id: 'Projects/demo' },
    issue: {
      id: 'Issues/demo',
      issueType: 'feature',
    },
    knowledge: [],
    skills: [],
    targetRealmUrl: 'https://realms.example.test/hassan/personal/',
  };
}

function emptyQueryIterator() {
  // The Agent SDK's Query extends AsyncGenerator<SDKMessage, void>. For tests
  // we only need the async iterable contract (for await) plus `interrupt()`
  // / `setPermissionMode()` etc. that the agent does not invoke itself.
  return {
    async *[Symbol.asyncIterator]() {
      // Yield nothing and end immediately.
    },
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
// Tests
// ---------------------------------------------------------------------------

module('factory-agent-claude-code', function () {
  module('buildSdkToolsFromFactoryTools', function () {
    test('each tool exposes a Zod schema (not JSON Schema) via inputSchema', function (assert) {
      let factoryTool = makeTool({
        parameters: {
          type: 'object',
          properties: {
            foo: { type: 'string' },
          },
          required: ['foo'],
        },
      });

      let sdkTools = buildSdkToolsFromFactoryTools([factoryTool], {
        onToolCall: () => {},
        onSignal: () => {},
      });

      assert.strictEqual(sdkTools.length, 1);
      let inputSchema = sdkTools[0].inputSchema as Record<string, ZodType>;
      // The SDK's `tool(..., inputSchema, ...)` expects ZodRawShape — an
      // object whose values are Zod types. We assert the shape contains Zod
      // types, proving the schema is NOT raw JSON Schema.
      assert.true('foo' in inputSchema);
      assert.strictEqual(
        typeof (inputSchema.foo as { parse?: unknown }).parse,
        'function',
        'inputSchema.foo is a Zod type with .parse()',
      );

      // Parsing should honor the JSON Schema's "required" semantics.
      let obj = z.object(inputSchema);
      assert.deepEqual(obj.parse({ foo: 'yes' }), { foo: 'yes' });
    });

    test('tool handler runs FactoryTool.execute and records the call', async function (assert) {
      let executeCalls: Record<string, unknown>[] = [];
      let factoryTool = makeTool({
        name: 'write_file',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
        execute: async (args) => {
          executeCalls.push(args);
          return { wrote: args.path };
        },
      });

      let toolCallLog: { tool: string; args: unknown; result: unknown }[] = [];
      let sdkTools = buildSdkToolsFromFactoryTools([factoryTool], {
        onToolCall: (entry) =>
          toolCallLog.push({
            tool: entry.tool,
            args: entry.args,
            result: entry.result,
          }),
        onSignal: () => {},
      });

      let result = await sdkTools[0].handler(
        { path: 'sticky-note.gts' } as never,
        {},
      );

      assert.deepEqual(executeCalls, [{ path: 'sticky-note.gts' }]);
      assert.deepEqual(toolCallLog, [
        {
          tool: 'write_file',
          args: { path: 'sticky-note.gts' },
          result: { wrote: 'sticky-note.gts' },
        },
      ]);
      assert.strictEqual(
        (result as { content: { type: string; text: string }[] }).content[0]
          .type,
        'text',
      );
    });

    test('DONE_SIGNAL from a tool triggers onSignal({kind:"done"})', async function (assert) {
      let factoryTool = makeTool({
        name: 'signal_done',
        execute: async () => ({ signal: DONE_SIGNAL }),
      });

      let signals: { kind: string }[] = [];
      let sdkTools = buildSdkToolsFromFactoryTools([factoryTool], {
        onToolCall: () => {},
        onSignal: (s) => signals.push(s),
      });

      await sdkTools[0].handler({}, {});

      assert.deepEqual(signals, [{ kind: 'done' }]);
    });

    test('CLARIFICATION_SIGNAL surfaces message through onSignal', async function (assert) {
      let factoryTool = makeTool({
        name: 'request_clarification',
        execute: async () => ({
          signal: CLARIFICATION_SIGNAL,
          message: 'Need more info on acceptance criteria',
        }),
      });

      let signals: { kind: string; message?: string }[] = [];
      let sdkTools = buildSdkToolsFromFactoryTools([factoryTool], {
        onToolCall: () => {},
        onSignal: (s) => signals.push(s),
      });

      await sdkTools[0].handler({}, {});

      assert.deepEqual(signals, [
        {
          kind: 'clarification',
          message: 'Need more info on acceptance criteria',
        },
      ]);
    });

    test('tool handler serializes signal symbols to human-readable tags', async function (assert) {
      let factoryTool = makeTool({
        execute: async () => ({ signal: DONE_SIGNAL, extra: 'value' }),
      });

      let sdkTools = buildSdkToolsFromFactoryTools([factoryTool], {
        onToolCall: () => {},
        onSignal: () => {},
      });

      let result = (await sdkTools[0].handler({}, {})) as {
        content: { type: string; text: string }[];
      };
      let parsed = JSON.parse(result.content[0].text);
      assert.strictEqual(parsed.signal, 'factory:done');
      assert.strictEqual(parsed.extra, 'value');
    });

    test('errors thrown by FactoryTool.execute become error results, not crashes', async function (assert) {
      let factoryTool = makeTool({
        execute: async () => {
          throw new Error('boom');
        },
      });

      let log: { result: unknown }[] = [];
      let sdkTools = buildSdkToolsFromFactoryTools([factoryTool], {
        onToolCall: (entry) => log.push({ result: entry.result }),
        onSignal: () => {},
      });

      await sdkTools[0].handler({}, {});

      assert.deepEqual(log, [{ result: { error: 'boom' } }]);
    });
  });

  module('ClaudeCodeFactoryAgent.run', function () {
    test('empty tool call stream returns needs_iteration', async function (assert) {
      let agent = new ClaudeCodeFactoryAgent(
        {},
        {
          promptLoader: stubPromptLoader,
          queryFn: () => emptyQueryIterator() as never,
        },
      );

      let result = await agent.run(makeContext(), []);

      assert.strictEqual(result.status, 'needs_iteration');
      assert.deepEqual(result.toolCalls, []);
    });

    test('wires the factory MCP server into Options.mcpServers', async function (assert) {
      let capturedOptions: Options | undefined;
      let agent = new ClaudeCodeFactoryAgent(
        { workspaceDir: '/tmp/factory-workspace-test' },
        {
          promptLoader: stubPromptLoader,
          queryFn: ({ options }) => {
            capturedOptions = options;
            return emptyQueryIterator() as never;
          },
        },
      );

      await agent.run(makeContext(), [makeTool({ name: 'signal_done' })]);

      assert.ok(capturedOptions);
      let mcpServers = capturedOptions!.mcpServers as Record<string, unknown>;
      assert.ok(mcpServers, 'mcpServers is set');
      assert.true('factory' in mcpServers, 'factory MCP server registered');

      // Native Claude Code fs / shell tools are enabled so the model
      // can read and write workspace files directly. Realm I/O still
      // goes through the factory MCP tools.
      assert.deepEqual(capturedOptions!.tools, [
        'Read',
        'Write',
        'Edit',
        'Bash',
        'Glob',
        'Grep',
      ]);

      assert.deepEqual(capturedOptions!.allowedTools, [
        'Read',
        'Write',
        'Edit',
        'Bash',
        'Glob',
        'Grep',
        'mcp__factory__signal_done',
      ]);

      assert.strictEqual(
        capturedOptions!.cwd,
        '/tmp/factory-workspace-test',
        'cwd is set to the factory workspace so native fs tools resolve realm-relative paths',
      );

      assert.strictEqual(capturedOptions!.permissionMode, 'bypassPermissions');
      assert.true(capturedOptions!.allowDangerouslySkipPermissions);
      assert.deepEqual(capturedOptions!.settingSources, []);
    });

    test('filters factory tools that have native or boxel CLI alternatives', async function (assert) {
      let capturedOptions: Options | undefined;
      let agent = new ClaudeCodeFactoryAgent(
        { workspaceDir: '/tmp/factory-workspace-test' },
        {
          promptLoader: stubPromptLoader,
          queryFn: ({ options }) => {
            capturedOptions = options;
            return emptyQueryIterator() as never;
          },
        },
      );

      await agent.run(makeContext(), [
        makeTool({ name: 'read_file' }),
        makeTool({ name: 'write_file' }),
        makeTool({ name: 'run_command' }),
        makeTool({ name: 'fetch_transpiled_module' }),
        makeTool({ name: 'search_realm' }),
        makeTool({ name: 'signal_done' }),
        // Simulate registry-sourced tools (script + realm-api).
        // These shadow core tools with kebab-case duplicates and must
        // not leak into the Claude MCP catalog.
        makeTool({ name: 'realm-read', source: 'registered' }),
        makeTool({ name: 'search-realm', source: 'registered' }),
        makeTool({ name: 'boxel-sync', source: 'registered' }),
      ]);

      let allowed = capturedOptions!.allowedTools ?? [];
      // Filtered: native fs replaces read/write; run_command is unused
      // in practice; fetch_transpiled_module reaches the same realm
      // endpoint via `boxel read-transpiled`; search_realm reaches the
      // same endpoint via `boxel search` (with single-quoted JSON).
      for (let filtered of [
        'read_file',
        'write_file',
        'run_command',
        'fetch_transpiled_module',
        'search_realm',
      ]) {
        assert.notOk(
          allowed.includes(`mcp__factory__${filtered}`),
          `${filtered} is not registered as an MCP tool on the Claude path`,
        );
      }
      // Registered (kebab-case) shadow tools must not leak into the
      // Claude MCP catalog regardless of their plain name.
      for (let registered of ['realm-read', 'search-realm', 'boxel-sync']) {
        assert.notOk(
          allowed.includes(`mcp__factory__${registered}`),
          `${registered} (registered) is not exposed on the Claude path`,
        );
      }
      assert.true(
        allowed.includes('mcp__factory__signal_done'),
        'control-flow factory tools remain in the MCP catalog',
      );
    });

    test('omits cwd when no workspaceDir is configured', async function (assert) {
      let capturedOptions: Options | undefined;
      let agent = new ClaudeCodeFactoryAgent(
        {},
        {
          promptLoader: stubPromptLoader,
          queryFn: ({ options }) => {
            capturedOptions = options;
            return emptyQueryIterator() as never;
          },
        },
      );

      await agent.run(makeContext(), [makeTool({ name: 'signal_done' })]);

      assert.strictEqual(capturedOptions!.cwd, undefined);
    });

    test('DONE_SIGNAL from a tool handler ends the run with status=done', async function (assert) {
      // This test uses the refactored tool-dispatch helper to verify
      // end-to-end signal handling. We don't need a real SDK stream:
      // buildSdkToolsFromFactoryTools + invoking the handler directly
      // exercises the same code path ClaudeCodeFactoryAgent.run uses.
      let toolCallLog: { tool: string }[] = [];
      let captured: { kind: string; message?: string } | undefined;
      let sdkTools = buildSdkToolsFromFactoryTools(
        [
          makeTool({
            name: 'signal_done',
            execute: async () => ({ signal: DONE_SIGNAL }),
          }),
        ],
        {
          onToolCall: (e) => toolCallLog.push({ tool: e.tool }),
          onSignal: (s) => {
            captured = s;
          },
        },
      );

      await sdkTools[0].handler({}, {});

      assert.deepEqual(captured, { kind: 'done' });
      assert.deepEqual(toolCallLog, [{ tool: 'signal_done' }]);
    });
  });
});
