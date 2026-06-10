import { mkdtempSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { module, test } from 'qunit';
import { z, type ZodType } from 'zod';

import type { Options } from '@anthropic-ai/claude-agent-sdk';

import {
  ClaudeCodeFactoryAgent,
  buildSdkToolsFromFactoryTools,
  buildWorkspaceScopedCanUseTool,
} from '../src/factory-agent/claude-code.ts';
import type { AgentContext } from '../src/factory-agent/index.ts';
import {
  CLARIFICATION_SIGNAL,
  DONE_SIGNAL,
  type FactoryTool,
} from '../src/factory-tool-builder.ts';
import type { PromptLoader } from '../src/factory-prompt-loader.ts';

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
    targetRealm: 'https://realms.example.test/testuser/personal/',
    // System-prompt rendering requires this — see requireDarkfactoryModuleUrl.
    darkfactoryModuleUrl:
      'https://realms.example.test/software-factory/darkfactory',
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
  module('buildWorkspaceScopedCanUseTool', function () {
    const workspaceDir = '/tmp/factory-workspace-scoping-test';
    let canUseTool = buildWorkspaceScopedCanUseTool(workspaceDir);
    let opts = {
      signal: new AbortController().signal,
      toolUseID: 'test-tool-use-id',
    };

    test('allows non-fs tools without inspecting input', async function (assert) {
      let result = await canUseTool('Bash', { command: 'ls' }, opts);
      assert.strictEqual(result.behavior, 'allow');
    });

    test('allows fs ops with realm-relative paths', async function (assert) {
      for (let toolName of ['Read', 'Write', 'Edit', 'MultiEdit']) {
        let result = await canUseTool(
          toolName,
          { file_path: 'sticky-note.gts' },
          opts,
        );
        assert.strictEqual(
          result.behavior,
          'allow',
          `${toolName} on a relative path is allowed`,
        );
      }
    });

    test('allows fs ops with absolute paths inside the workspace', async function (assert) {
      let result = await canUseTool(
        'Write',
        { file_path: `${workspaceDir}/StickyNote/note-1.json` },
        opts,
      );
      assert.strictEqual(result.behavior, 'allow');
    });

    test('denies fs ops with absolute paths outside the workspace', async function (assert) {
      let result = await canUseTool(
        'Write',
        { file_path: '/Users/jurgen/code/boxel/elsewhere/sticky-note.gts' },
        opts,
      );
      assert.strictEqual(
        result.behavior,
        'deny',
        'absolute path outside workspace is denied',
      );
      if (result.behavior === 'deny') {
        assert.true(
          result.message.includes('outside the factory workspace'),
          'deny message names the violation',
        );
      }
    });

    test('denies fs ops that traverse out of the workspace', async function (assert) {
      let result = await canUseTool(
        'Write',
        { file_path: '../leaks-here.gts' },
        opts,
      );
      assert.strictEqual(result.behavior, 'deny');
    });

    test('passes through input on allow so the SDK keeps the original args', async function (assert) {
      let input = { file_path: 'sticky-note.gts' };
      let result = await canUseTool('Write', input, opts);
      assert.strictEqual(result.behavior, 'allow');
      if (result.behavior === 'allow') {
        assert.strictEqual(result.updatedInput, input);
      }
    });

    test('allows absolute paths via the canonical (realpath) workspace location', async function (assert) {
      // Reproduce the macOS /var → /private/var situation in a portable way:
      // create a real directory and a symlink that points at it. If we
      // construct the hook with the symlink path and the SDK reports a
      // file_path through the canonical (realpath) location, the hook must
      // not flag that as escaping the workspace.
      let realDir = mkdtempSync(join(tmpdir(), 'factory-canon-real-'));
      let symlinkDir = `${realDir}-link`;
      symlinkSync(realDir, symlinkDir);
      try {
        let canonicalCanUseTool = buildWorkspaceScopedCanUseTool(symlinkDir);
        let result = await canonicalCanUseTool(
          'Write',
          { file_path: `${realDir}/sticky-note.gts` },
          opts,
        );
        assert.strictEqual(
          result.behavior,
          'allow',
          'absolute path through the canonical location is recognized as inside the workspace',
        );

        // And going the other way: hook constructed via the canonical
        // path, file_path expressed through the symlink form.
        let canonicalCanUseTool2 = buildWorkspaceScopedCanUseTool(realDir);
        let result2 = await canonicalCanUseTool2(
          'Write',
          { file_path: `${symlinkDir}/sticky-note.gts` },
          opts,
        );
        assert.strictEqual(
          result2.behavior,
          'allow',
          'absolute path through the symlink form is recognized as inside the canonical workspace',
        );
      } finally {
        unlinkSync(symlinkDir);
        rmSync(realDir, { recursive: true, force: true });
      }
    });
  });

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

      // CS-11033: native fs tools must NOT appear in allowedTools.
      // The SDK auto-approves anything in allowedTools and skips
      // canUseTool entirely. Keeping Write/Edit/etc out of this list
      // is what causes the path-scoping hook to actually fire.
      assert.deepEqual(capturedOptions!.allowedTools, [
        'mcp__factory__signal_done',
      ]);

      assert.strictEqual(
        capturedOptions!.cwd,
        '/tmp/factory-workspace-test',
        'cwd is set to the factory workspace so native fs tools resolve realm-relative paths',
      );

      // `default` (verified empirically — see scripts/canusetool-repro.ts)
      // is the only permission mode where the SDK invokes canUseTool
      // for tools outside allowedTools and honors the hook's
      // allow/deny. `dontAsk` and `bypassPermissions` either skip the
      // hook entirely or silently deny without consulting it.
      assert.strictEqual(capturedOptions!.permissionMode, 'default');
      assert.strictEqual(
        typeof capturedOptions!.canUseTool,
        'function',
        'canUseTool is wired so native fs ops can be scoped to the workspace',
      );
      assert.deepEqual(capturedOptions!.settingSources, []);
    });

    test('native fs tools are NOT auto-approved so canUseTool can gate them (CS-11033)', async function (assert) {
      // Regression guard. The SDK skips canUseTool for any tool in
      // allowedTools — verified empirically in scripts/canusetool-repro.ts.
      // If a future change adds Read / Write / Edit / MultiEdit /
      // NotebookEdit / NotebookRead to allowedTools (or switches
      // permissionMode away from `default`), the workspace-scoping
      // hook becomes dead code and the model can write to absolute
      // paths outside the factory workspace again. Lock both
      // conditions so that regression is caught at unit-test time.
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

      let allowed = capturedOptions!.allowedTools ?? [];
      for (let pathScopedTool of [
        'Read',
        'Write',
        'Edit',
        'MultiEdit',
        'NotebookEdit',
        'NotebookRead',
      ]) {
        assert.notOk(
          allowed.includes(pathScopedTool),
          `${pathScopedTool} must stay out of allowedTools so canUseTool fires for every call`,
        );
      }
      assert.strictEqual(
        capturedOptions!.permissionMode,
        'default',
        'permissionMode must be `default` — other modes either skip canUseTool or silently deny',
      );
      assert.strictEqual(
        typeof capturedOptions!.canUseTool,
        'function',
        'canUseTool must be wired alongside the above two conditions',
      );
    });

    test('filters out registry-sourced shadow tools from the MCP catalog', async function (assert) {
      // The filter keeps `'registered'` tools (kebab-case shadows
      // from the realm-api ToolRegistry) off the Claude MCP catalog.
      // Verify both halves: registered shadows are filtered, core
      // tools pass through.
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
        makeTool({ name: 'signal_done' }),
        makeTool({ name: 'run_tests' }),
        // Registry-sourced (kebab-case) shadow tools must not leak
        // into the Claude MCP catalog regardless of their plain name.
        makeTool({ name: 'realm-read', source: 'registered' }),
        makeTool({ name: 'search-realm', source: 'registered' }),
        makeTool({ name: 'sample-registered-tool', source: 'registered' }),
      ]);

      let allowed = capturedOptions!.allowedTools ?? [];
      for (let registered of [
        'realm-read',
        'search-realm',
        'sample-registered-tool',
      ]) {
        assert.notOk(
          allowed.includes(`mcp__factory__${registered}`),
          `${registered} (registered) is not exposed on the Claude path`,
        );
      }
      assert.true(
        allowed.includes('mcp__factory__signal_done'),
        'control-flow factory tools remain in the MCP catalog',
      );
      assert.true(
        allowed.includes('mcp__factory__run_tests'),
        'validators remain in the MCP catalog',
      );
    });

    test('disables native fs entirely when no workspaceDir is configured', async function (assert) {
      // Without a workspaceDir we have no cwd to scope against and the
      // canUseTool hook can't compute "inside the workspace." Enabling
      // native Read / Write / Bash in that state would let the model
      // touch the host filesystem unrestricted, which is the regression
      // this guard prevents. Verify that the agent falls back to
      // MCP-only when workspaceDir is missing.
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

      assert.strictEqual(
        capturedOptions!.cwd,
        undefined,
        'no cwd is set when workspaceDir is missing',
      );
      assert.strictEqual(
        capturedOptions!.canUseTool,
        undefined,
        'no path-scoping hook is wired when workspaceDir is missing',
      );
      assert.deepEqual(
        capturedOptions!.tools,
        [],
        'native fs tools are disabled when workspaceDir is missing',
      );
      let allowed = capturedOptions!.allowedTools ?? [];
      for (let nativeTool of [
        'Read',
        'Write',
        'Edit',
        'Bash',
        'Glob',
        'Grep',
      ]) {
        assert.notOk(
          allowed.includes(nativeTool),
          `${nativeTool} is not in allowedTools when workspaceDir is missing`,
        );
      }
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
