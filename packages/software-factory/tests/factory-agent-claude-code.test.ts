import { module, test } from 'qunit';

import type { Options } from '@anthropic-ai/claude-agent-sdk';

import { ClaudeCodeFactoryAgent } from '../src/factory-agent/claude-code';
import type { AgentContext } from '../src/factory-agent';
import type { FactoryTool } from '../src/factory-tool-builder';
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
    workspaceDir: '/tmp/factory-workspace',
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

    test('configures the SDK with the claude_code preset and native tools', async function (assert) {
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

      await agent.run(makeContext(), [makeTool({ name: 'unused_tool' })]);

      assert.ok(capturedOptions);

      // After CS-10883 the agent runs with the SDK's `claude_code`
      // preset and operates entirely through native tools. There is
      // no in-process MCP server — combining the SDK MCP bridge with
      // the preset / a built-in whitelist breaks tool routing in
      // SDK 0.2.x. The agent uses Read/Write/Edit on the workspace
      // and the boxel CLI (via Bash) for realm-server calls.
      assert.deepEqual(capturedOptions!.tools, {
        type: 'preset',
        preset: 'claude_code',
      });

      assert.deepEqual(capturedOptions!.allowedTools, [
        'Read',
        'Write',
        'Edit',
        'Glob',
        'Grep',
        'Bash',
      ]);

      assert.deepEqual(capturedOptions!.disallowedTools, [
        'WebFetch',
        'WebSearch',
        'NotebookEdit',
        'TodoWrite',
        'Task',
        'KillShell',
      ]);

      assert.strictEqual(
        (capturedOptions as { mcpServers?: unknown }).mcpServers,
        undefined,
        'no in-process MCP server',
      );

      assert.strictEqual(
        capturedOptions!.cwd,
        '/tmp/factory-workspace',
        'cwd is set to the workspace dir so native FS resolves there',
      );

      assert.strictEqual(capturedOptions!.permissionMode, 'bypassPermissions');
      assert.true(capturedOptions!.allowDangerouslySkipPermissions);
      assert.deepEqual(capturedOptions!.settingSources, []);
    });

    test('counts native tool_use blocks from assistant messages', async function (assert) {
      let agent = new ClaudeCodeFactoryAgent(
        {},
        {
          promptLoader: stubPromptLoader,
          queryFn: () =>
            ({
              async *[Symbol.asyncIterator]() {
                yield {
                  type: 'assistant',
                  message: {
                    content: [
                      {
                        type: 'tool_use',
                        name: 'Read',
                        input: { file_path: '/tmp/factory-workspace/x.gts' },
                      },
                      {
                        type: 'tool_use',
                        name: 'Write',
                        input: {
                          file_path: '/tmp/factory-workspace/y.gts',
                          content: '...',
                        },
                      },
                      { type: 'text', text: 'all done' },
                    ],
                  },
                };
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
            }) as never,
        },
      );

      let result = await agent.run(makeContext(), []);

      assert.strictEqual(result.status, 'done');
      assert.deepEqual(
        result.toolCalls.map((c) => c.tool),
        ['Read', 'Write'],
      );
    });
  });
});
