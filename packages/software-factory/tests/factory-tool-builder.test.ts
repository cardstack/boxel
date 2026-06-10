import { module, test } from 'qunit';

import type { ToolResult } from '../src/factory-agent/index.ts';
import {
  buildFactoryTools,
  DONE_SIGNAL,
  CLARIFICATION_SIGNAL,
  type FactoryTool,
  type ToolBuilderConfig,
  type DoneResult,
  type ClarificationResult,
} from '../src/factory-tool-builder.ts';
import type { ToolExecutor } from '../src/factory-tool-executor.ts';
import { ToolRegistry } from '../src/factory-tool-registry.ts';
import { createMockClient } from './helpers/mock-client.ts';
import {
  createTestWorkspace,
  type TestWorkspace,
} from './helpers/workspace-fixture.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TARGET_REALM = 'https://realms.example.test/user/target/';

// Workspaces created during test execution. Cleaned up by a global
// QUnit.testDone hook so we don't leak temp dirs across this file's
// many tests; the workspace-fixture's process-exit hook is a fallback
// for anything that slips past, but cleaning per-test is cheaper and
// keeps the OS tmpdir from growing during the run.
let pendingWorkspaces: TestWorkspace[] = [];
declare const QUnit: {
  testDone: (cb: () => void) => void;
};
let testDoneHookInstalled = false;
function installTestDoneHook() {
  if (testDoneHookInstalled) return;
  if (typeof QUnit === 'undefined') return;
  testDoneHookInstalled = true;
  QUnit.testDone(() => {
    let toClean = pendingWorkspaces;
    pendingWorkspaces = [];
    for (let ws of toClean) {
      ws.cleanup();
    }
  });
}

function makeWorkspace(): TestWorkspace {
  installTestDoneHook();
  let ws = createTestWorkspace();
  pendingWorkspaces.push(ws);
  return ws;
}

/**
 * Tests need to inspect (and sometimes pre-seed) the workspace that the
 * tools read/write against. `makeConfig` returns the config as usual; the
 * workspace is attached on the side via a parallel WeakMap so existing
 * call sites that only care about the config object continue to work.
 */
let configWorkspaces = new WeakMap<ToolBuilderConfig, TestWorkspace>();

function makeConfig(
  overrides?: Partial<ToolBuilderConfig> & { fetch?: typeof globalThis.fetch },
): ToolBuilderConfig {
  let { fetch: fetchOverride, client, workspaceDir, ...rest } = overrides ?? {};
  let workspace = workspaceDir ? undefined : makeWorkspace();
  let config: ToolBuilderConfig = {
    targetRealm: TARGET_REALM,
    realmServerUrl: 'https://realms.example.test/',
    client:
      client ??
      createMockClient(fetchOverride ? { fetch: fetchOverride } : undefined),
    workspaceDir: workspaceDir ?? workspace!.dir,
    syncWorkspace: async () => ({ ok: true }),
    ...rest,
  };
  if (workspace) {
    configWorkspaces.set(config, workspace);
  }
  return config;
}

interface CapturedToolCall {
  toolName: string;
  toolArgs: Record<string, unknown>;
}

function createMockToolExecutor(results: Map<string, ToolResult>): {
  executor: ToolExecutor;
  calls: CapturedToolCall[];
} {
  let calls: CapturedToolCall[] = [];
  let executor = {
    execute: async (
      toolName: string,
      toolArgs: Record<string, unknown>,
    ): Promise<ToolResult> => {
      calls.push({
        toolName: toolName as string,
        toolArgs: toolArgs as Record<string, unknown>,
      });
      let result = results.get(toolName as string);
      if (!result) {
        throw new Error(`MockToolExecutor: no result for tool "${toolName}"`);
      }
      return result;
    },
  } as unknown as ToolExecutor;
  return { executor, calls };
}

function findTool(tools: FactoryTool[], name: string): FactoryTool {
  let tool = tools.find((t) => t.name === name);
  if (!tool) {
    throw new Error(`Tool "${name}" not found`);
  }
  return tool;
}

// ---------------------------------------------------------------------------
// Tool building
// ---------------------------------------------------------------------------

module('factory-tool-builder > tool building', function () {
  test('builds factory-level tools plus registered tools', function (assert) {
    let registry = new ToolRegistry();
    let { executor } = createMockToolExecutor(new Map());
    let config = makeConfig();
    let tools = buildFactoryTools(config, executor, registry);

    let toolNames = tools.map((t) => t.name);

    // The 8 surviving factory tools after CS-11034: get_card_schema +
    // 5 validators + 2 control signals. Native fs / Bash / Glob /
    // Grep are owned by the agent backend (Claude Agent SDK or
    // opencode); `get_card_schema` survives because it introspects
    // the live `CardDef` via the realm-server prerenderer (no Bash
    // equivalent).
    assert.true(toolNames.includes('get_card_schema'));
    assert.true(toolNames.includes('run_tests'));
    assert.true(toolNames.includes('run_lint'));
    assert.true(toolNames.includes('run_evaluate'));
    assert.true(toolNames.includes('run_parse'));
    assert.true(toolNames.includes('run_instantiate'));
    assert.true(toolNames.includes('signal_done'));
    assert.true(toolNames.includes('request_clarification'));
    // After CS-10883 retired the kebab-case shadow tools, only
    // `realm-create` survives in the registry.
    assert.true(toolNames.includes('realm-create'));
    // Tools retired by CS-10883 (structured updates) and CS-11034
    // (OpenRouter-only fs wrappers).
    for (let retired of [
      'update_project',
      'update_issue',
      'create_knowledge',
      'create_catalog_spec',
      'add_comment',
      'read_file',
      'write_file',
      'search_realm',
      'fetch_transpiled_module',
      'run_command',
    ]) {
      assert.notOk(
        toolNames.includes(retired),
        `${retired} retired (use native fs / Bash + boxel CLI instead)`,
      );
    }
  });

  test('each tool has name, description, parameters, and execute', function (assert) {
    let registry = new ToolRegistry();
    let { executor } = createMockToolExecutor(new Map());
    let config = makeConfig();
    let tools = buildFactoryTools(config, executor, registry);

    for (let tool of tools) {
      assert.strictEqual(typeof tool.name, 'string');
      assert.true(tool.name.length > 0);
      assert.strictEqual(typeof tool.description, 'string');
      assert.true(tool.description.length > 0);
      assert.strictEqual(typeof tool.parameters, 'object');
      assert.strictEqual(typeof tool.execute, 'function');
    }
  });
});

// ---------------------------------------------------------------------------
// Signal tools
// ---------------------------------------------------------------------------

module('factory-tool-builder > signal tools', function () {
  test('signal_done returns done signal', async function (assert) {
    let registry = new ToolRegistry();
    let { executor } = createMockToolExecutor(new Map());
    let config = makeConfig();
    let tools = buildFactoryTools(config, executor, registry);
    let doneTool = findTool(tools, 'signal_done');

    let result = (await doneTool.execute({})) as DoneResult;

    assert.strictEqual(result.signal, DONE_SIGNAL);
  });

  test('request_clarification returns clarification signal with message', async function (assert) {
    let registry = new ToolRegistry();
    let { executor } = createMockToolExecutor(new Map());
    let config = makeConfig();
    let tools = buildFactoryTools(config, executor, registry);
    let clarifyTool = findTool(tools, 'request_clarification');

    let result = (await clarifyTool.execute({
      message: 'What database should I use?',
    })) as ClarificationResult;

    assert.strictEqual(result.signal, CLARIFICATION_SIGNAL);
    assert.strictEqual(result.message, 'What database should I use?');
  });
});

// ---------------------------------------------------------------------------
// Registered tool delegation
// ---------------------------------------------------------------------------

module('factory-tool-builder > registered tool delegation', function () {
  test('delegates registered tool to ToolExecutor', async function (assert) {
    let toolResult: ToolResult = {
      tool: 'realm-create',
      exitCode: 0,
      output: { data: { id: 'https://realms.example.test/user/new/' } },
      durationMs: 42,
    };
    let { executor } = createMockToolExecutor(
      new Map([['realm-create', toolResult]]),
    );
    let registry = new ToolRegistry();
    let config = makeConfig();
    let tools = buildFactoryTools(config, executor, registry);
    let realmCreateTool = findTool(tools, 'realm-create');

    let result = (await realmCreateTool.execute({
      'realm-server-url': 'https://realms.example.test/',
      name: 'New Realm',
      endpoint: 'new',
    })) as ToolResult;

    assert.strictEqual(result.tool, 'realm-create');
    assert.strictEqual(result.exitCode, 0);
    assert.deepEqual(result.output, {
      data: { id: 'https://realms.example.test/user/new/' },
    });
  });
});

// ---------------------------------------------------------------------------
// run_tests tool (in-memory validation)
// ---------------------------------------------------------------------------

module('buildFactoryTools — run_tests', function () {
  test('registers run_tests with empty parameters', function (assert) {
    let config = makeConfig();
    let { executor } = createMockToolExecutor(new Map());
    let tools = buildFactoryTools(config, executor, new ToolRegistry());
    let runTests = tools.find((t) => t.name === 'run_tests');
    assert.ok(runTests, 'run_tests tool is registered');
    assert.deepEqual(
      runTests?.parameters,
      { type: 'object', properties: {} },
      'run_tests takes no arguments',
    );
  });

  test('delegates to injected runTestsInMemory and forwards realm config', async function (assert) {
    let capturedOptions:
      | {
          targetRealm: string;
          hostAppUrl: string;
        }
      | undefined;
    let stubResult = {
      status: 'passed' as const,
      passedCount: 3,
      failedCount: 0,
      skippedCount: 0,
      durationMs: 42,
      testFiles: ['foo.test.gts'],
      failures: [],
    };

    let config = makeConfig({
      hostAppUrl: 'https://host.example.test/',
      runTestsInMemory: async (options) => {
        capturedOptions = {
          targetRealm: options.targetRealm,
          hostAppUrl: options.hostAppUrl,
        };
        return stubResult;
      },
    });
    let { executor } = createMockToolExecutor(new Map());
    let tools = buildFactoryTools(config, executor, new ToolRegistry());
    let runTests = tools.find((t) => t.name === 'run_tests');
    assert.ok(runTests, 'run_tests tool is registered');

    let result = await runTests?.execute({});

    assert.deepEqual(result, stubResult, 'tool returns the in-memory result');
    assert.strictEqual(
      capturedOptions?.targetRealm,
      TARGET_REALM,
      'forwards targetRealm from config',
    );
    assert.strictEqual(
      capturedOptions?.hostAppUrl,
      'https://host.example.test/',
      'forwards hostAppUrl from config',
    );
  });

  test('falls back to realmServerUrl when hostAppUrl is not configured', async function (assert) {
    let capturedHost: string | undefined;
    let config = makeConfig({
      runTestsInMemory: async (options) => {
        capturedHost = options.hostAppUrl;
        return {
          status: 'passed' as const,
          passedCount: 0,
          failedCount: 0,
          skippedCount: 0,
          durationMs: 0,
          testFiles: [],
          failures: [],
        };
      },
    });
    let { executor } = createMockToolExecutor(new Map());
    let tools = buildFactoryTools(config, executor, new ToolRegistry());
    let runTests = tools.find((t) => t.name === 'run_tests');
    assert.ok(runTests, 'run_tests tool is registered');

    await runTests?.execute({});

    assert.strictEqual(
      capturedHost,
      'https://realms.example.test/',
      'hostAppUrl defaults to realmServerUrl',
    );
  });
});

// ---------------------------------------------------------------------------
// run_lint tool (in-memory validation)
// ---------------------------------------------------------------------------

module('buildFactoryTools — run_lint', function () {
  test('registers run_lint with an optional path parameter', function (assert) {
    let config = makeConfig();
    let { executor } = createMockToolExecutor(new Map());
    let tools = buildFactoryTools(config, executor, new ToolRegistry());
    let runLint = tools.find((t) => t.name === 'run_lint')!;
    assert.ok(runLint, 'run_lint tool is registered');
    let params = runLint.parameters as {
      type: string;
      properties: Record<string, { type: string }>;
      required?: string[];
    };
    assert.strictEqual(params.type, 'object');
    assert.strictEqual(params.properties.path.type, 'string');
    assert.strictEqual(params.required, undefined, 'path is optional');
  });

  test('delegates to injected runLintInMemory and forwards realm config', async function (assert) {
    let capturedOptions:
      | {
          targetRealm: string;
          hasClient: boolean;
          path: string | undefined;
        }
      | undefined;
    let stubResult = {
      status: 'passed' as const,
      filesChecked: 2,
      filesWithErrors: 0,
      errorCount: 0,
      warningCount: 0,
      durationMs: 17,
      lintableFiles: ['a.gts', 'b.gts'],
      violations: [],
    };

    let config = makeConfig({
      runLintInMemory: async (options) => {
        capturedOptions = {
          targetRealm: options.targetRealm,
          hasClient: Boolean(options.client),
          path: options.path,
        };
        return stubResult;
      },
    });
    let { executor } = createMockToolExecutor(new Map());
    let tools = buildFactoryTools(config, executor, new ToolRegistry());
    let runLint = tools.find((t) => t.name === 'run_lint')!;

    let result = await runLint.execute({});

    assert.deepEqual(result, stubResult, 'tool returns the in-memory result');
    assert.strictEqual(
      capturedOptions?.targetRealm,
      TARGET_REALM,
      'forwards targetRealm from config',
    );
    assert.true(
      capturedOptions?.hasClient,
      'forwards the configured BoxelCLIClient',
    );
    assert.strictEqual(
      capturedOptions?.path,
      undefined,
      'path is omitted when not provided',
    );
  });

  test('forwards path when provided to single-file lint', async function (assert) {
    let capturedPath: string | undefined;
    let stubResult = {
      status: 'failed' as const,
      filesChecked: 1,
      filesWithErrors: 1,
      errorCount: 1,
      warningCount: 0,
      durationMs: 8,
      lintableFiles: ['my-card.gts'],
      violations: [
        {
          rule: 'no-unused-vars',
          file: 'my-card.gts',
          line: 3,
          column: 5,
          message: "'unusedVar' is assigned a value but never used.",
          severity: 'error' as const,
        },
      ],
    };

    let config = makeConfig({
      runLintInMemory: async (options) => {
        capturedPath = options.path;
        return stubResult;
      },
    });
    let { executor } = createMockToolExecutor(new Map());
    let tools = buildFactoryTools(config, executor, new ToolRegistry());
    let runLint = tools.find((t) => t.name === 'run_lint')!;

    let result = (await runLint.execute({
      path: 'my-card.gts',
    })) as typeof stubResult;

    assert.strictEqual(
      capturedPath,
      'my-card.gts',
      'path is forwarded to the engine',
    );
    assert.strictEqual(result.status, 'failed');
    assert.deepEqual(result.lintableFiles, ['my-card.gts']);
  });

  test('empty-string path is treated as "no path" (whole-realm lint)', async function (assert) {
    let capturedPath: string | undefined;
    let config = makeConfig({
      runLintInMemory: async (options) => {
        capturedPath = options.path;
        return {
          status: 'passed' as const,
          filesChecked: 0,
          filesWithErrors: 0,
          errorCount: 0,
          warningCount: 0,
          durationMs: 0,
          lintableFiles: [],
          violations: [],
        };
      },
    });
    let { executor } = createMockToolExecutor(new Map());
    let tools = buildFactoryTools(config, executor, new ToolRegistry());
    let runLint = tools.find((t) => t.name === 'run_lint')!;

    await runLint.execute({ path: '   ' });

    assert.strictEqual(
      capturedPath,
      undefined,
      'whitespace-only path falls back to whole-realm lint',
    );
  });

  test('propagates failed lint results unchanged', async function (assert) {
    let stubResult = {
      status: 'failed' as const,
      filesChecked: 1,
      filesWithErrors: 1,
      errorCount: 2,
      warningCount: 0,
      durationMs: 12,
      lintableFiles: ['bad.gts'],
      violations: [
        {
          rule: 'no-unused-vars',
          file: 'bad.gts',
          line: 4,
          column: 5,
          message: "'unusedVar' is assigned a value but never used.",
          severity: 'error' as const,
        },
        {
          rule: 'prettier/prettier',
          file: 'bad.gts',
          line: 7,
          column: 1,
          message: 'Insert `;`',
          severity: 'error' as const,
        },
      ],
    };
    let config = makeConfig({
      runLintInMemory: async () => stubResult,
    });
    let { executor } = createMockToolExecutor(new Map());
    let tools = buildFactoryTools(config, executor, new ToolRegistry());
    let runLint = tools.find((t) => t.name === 'run_lint')!;

    let result = (await runLint.execute({})) as typeof stubResult;

    assert.strictEqual(result.status, 'failed');
    assert.strictEqual(result.errorCount, 2);
    assert.strictEqual(result.violations.length, 2);
    assert.strictEqual(result.violations[0].rule, 'no-unused-vars');
  });
});

module('buildFactoryTools — run_evaluate', function () {
  test('registers run_evaluate with an optional path parameter', function (assert) {
    let config = makeConfig();
    let { executor } = createMockToolExecutor(new Map());
    let tools = buildFactoryTools(config, executor, new ToolRegistry());
    let runEvaluate = tools.find((t) => t.name === 'run_evaluate');
    assert.ok(runEvaluate, 'run_evaluate tool is registered');
    let params = runEvaluate!.parameters as {
      type: string;
      properties: Record<string, { type: string }>;
      required?: string[];
    };
    assert.strictEqual(params.type, 'object');
    assert.strictEqual(params.properties.path?.type, 'string');
    assert.strictEqual(params.required, undefined, 'path is optional');
  });

  test('delegates to injected runEvaluateInMemory and forwards realm config', async function (assert) {
    let capturedOptions:
      | {
          targetRealm: string;
          realmServerUrl: string;
          hasClient: boolean;
          path: string | undefined;
        }
      | undefined;
    let stubResult = {
      status: 'passed' as const,
      modulesChecked: 2,
      modulesWithErrors: 0,
      durationMs: 42,
      evaluableFiles: ['a.gts', 'b.gts'],
      failures: [],
    };

    let config = makeConfig({
      runEvaluateInMemory: async (options) => {
        capturedOptions = {
          targetRealm: options.targetRealm,
          realmServerUrl: options.realmServerUrl,
          hasClient: Boolean(options.client),
          path: options.path,
        };
        return stubResult;
      },
    });
    let { executor } = createMockToolExecutor(new Map());
    let tools = buildFactoryTools(config, executor, new ToolRegistry());
    let runEvaluate = tools.find((t) => t.name === 'run_evaluate');
    assert.ok(runEvaluate, 'run_evaluate tool is registered');

    let result = await runEvaluate!.execute({});

    assert.deepEqual(result, stubResult, 'tool returns the in-memory result');
    assert.strictEqual(
      capturedOptions?.targetRealm,
      TARGET_REALM,
      'forwards targetRealm from config',
    );
    assert.strictEqual(
      capturedOptions?.realmServerUrl,
      'https://realms.example.test/',
      'forwards realmServerUrl from config',
    );
    assert.true(
      capturedOptions?.hasClient,
      'forwards the configured BoxelCLIClient',
    );
    assert.strictEqual(
      capturedOptions?.path,
      undefined,
      'path is omitted when not provided',
    );
  });

  test('forwards path when provided to single-file evaluate', async function (assert) {
    let capturedPath: string | undefined;
    let stubResult = {
      status: 'failed' as const,
      modulesChecked: 1,
      modulesWithErrors: 1,
      durationMs: 120,
      evaluableFiles: ['my-card.gts'],
      failures: [
        {
          path: 'my-card.gts',
          error: 'Cannot find module ./does-not-exist',
          stackTrace: 'at Loader.load (loader.ts:42:5)',
        },
      ],
    };

    let config = makeConfig({
      runEvaluateInMemory: async (options) => {
        capturedPath = options.path;
        return stubResult;
      },
    });
    let { executor } = createMockToolExecutor(new Map());
    let tools = buildFactoryTools(config, executor, new ToolRegistry());
    let runEvaluate = tools.find((t) => t.name === 'run_evaluate');
    assert.ok(runEvaluate, 'run_evaluate tool is registered');

    let result = (await runEvaluate!.execute({
      path: 'my-card.gts',
    })) as typeof stubResult;

    assert.strictEqual(
      capturedPath,
      'my-card.gts',
      'path is forwarded to the engine',
    );
    assert.strictEqual(result.status, 'failed');
    assert.deepEqual(result.evaluableFiles, ['my-card.gts']);
    assert.strictEqual(result.failures[0].path, 'my-card.gts');
    assert.strictEqual(
      result.failures[0].stackTrace,
      'at Loader.load (loader.ts:42:5)',
    );
  });

  test('whitespace-only path is treated as "no path" (whole-realm evaluate)', async function (assert) {
    let capturedPath: string | undefined;
    let config = makeConfig({
      runEvaluateInMemory: async (options) => {
        capturedPath = options.path;
        return {
          status: 'passed' as const,
          modulesChecked: 0,
          modulesWithErrors: 0,
          durationMs: 0,
          evaluableFiles: [],
          failures: [],
        };
      },
    });
    let { executor } = createMockToolExecutor(new Map());
    let tools = buildFactoryTools(config, executor, new ToolRegistry());
    let runEvaluate = tools.find((t) => t.name === 'run_evaluate');
    assert.ok(runEvaluate, 'run_evaluate tool is registered');

    await runEvaluate!.execute({ path: '   ' });

    assert.strictEqual(
      capturedPath,
      undefined,
      'whitespace-only path falls back to whole-realm evaluate',
    );
  });

  test('propagates failed evaluate results unchanged', async function (assert) {
    let stubResult = {
      status: 'failed' as const,
      modulesChecked: 2,
      modulesWithErrors: 1,
      durationMs: 85,
      evaluableFiles: ['broken.gts', 'good.gts'],
      failures: [
        {
          path: 'broken.gts',
          error: 'ReferenceError: nonExistentHelper is not defined',
        },
      ],
    };
    let config = makeConfig({
      runEvaluateInMemory: async () => stubResult,
    });
    let { executor } = createMockToolExecutor(new Map());
    let tools = buildFactoryTools(config, executor, new ToolRegistry());
    let runEvaluate = tools.find((t) => t.name === 'run_evaluate');
    assert.ok(runEvaluate, 'run_evaluate tool is registered');

    let result = (await runEvaluate!.execute({})) as typeof stubResult;

    assert.strictEqual(result.status, 'failed');
    assert.strictEqual(result.modulesWithErrors, 1);
    assert.strictEqual(result.failures.length, 1);
    assert.strictEqual(result.failures[0].path, 'broken.gts');
  });
});

// run_parse tool (in-memory validation)
// ---------------------------------------------------------------------------

module('buildFactoryTools — run_parse', function () {
  test('registers run_parse with an optional path parameter', function (assert) {
    let config = makeConfig();
    let { executor } = createMockToolExecutor(new Map());
    let tools = buildFactoryTools(config, executor, new ToolRegistry());
    let runParse = tools.find((t) => t.name === 'run_parse')!;
    assert.ok(runParse, 'run_parse tool is registered');
    let params = runParse.parameters as {
      type: string;
      properties: Record<string, { type: string }>;
      required?: string[];
    };
    assert.strictEqual(params.type, 'object');
    assert.strictEqual(params.properties.path.type, 'string');
    assert.strictEqual(params.required, undefined, 'path is optional');
  });

  test('delegates to injected runParseInMemory and forwards realm config', async function (assert) {
    let capturedOptions:
      | {
          targetRealm: string;
          hasClient: boolean;
          path: string | undefined;
        }
      | undefined;
    let stubResult = {
      status: 'passed' as const,
      filesChecked: 2,
      filesWithErrors: 0,
      errorCount: 0,
      durationMs: 25,
      parseableFiles: ['a.gts', 'b.gts'],
      errors: [],
    };

    let config = makeConfig({
      runParseInMemory: async (options) => {
        capturedOptions = {
          targetRealm: options.targetRealm,
          hasClient: Boolean(options.client),
          path: options.path,
        };
        return stubResult;
      },
    });
    let { executor } = createMockToolExecutor(new Map());
    let tools = buildFactoryTools(config, executor, new ToolRegistry());
    let runParse = tools.find((t) => t.name === 'run_parse')!;

    let result = await runParse.execute({});

    assert.deepEqual(result, stubResult, 'tool returns the in-memory result');
    assert.strictEqual(
      capturedOptions?.targetRealm,
      TARGET_REALM,
      'forwards targetRealm from config',
    );
    assert.true(
      capturedOptions?.hasClient,
      'forwards the configured BoxelCLIClient',
    );
    assert.strictEqual(
      capturedOptions?.path,
      undefined,
      'path is omitted when not provided',
    );
  });

  test('forwards path when provided to single-file parse', async function (assert) {
    let capturedPath: string | undefined;
    let stubResult = {
      status: 'failed' as const,
      filesChecked: 1,
      filesWithErrors: 1,
      errorCount: 1,
      durationMs: 8,
      parseableFiles: ['my-card.gts'],
      errors: [
        {
          file: 'my-card.gts',
          line: 3,
          column: 5,
          message: "Type 'string' is not assignable to type 'number'.",
        },
      ],
    };

    let config = makeConfig({
      runParseInMemory: async (options) => {
        capturedPath = options.path;
        return stubResult;
      },
    });
    let { executor } = createMockToolExecutor(new Map());
    let tools = buildFactoryTools(config, executor, new ToolRegistry());
    let runParse = tools.find((t) => t.name === 'run_parse')!;

    let result = (await runParse.execute({
      path: 'my-card.gts',
    })) as typeof stubResult;

    assert.strictEqual(
      capturedPath,
      'my-card.gts',
      'path is forwarded to the engine',
    );
    assert.strictEqual(result.status, 'failed');
    assert.deepEqual(result.parseableFiles, ['my-card.gts']);
  });

  test('empty-string path is treated as "no path" (whole-realm parse)', async function (assert) {
    let capturedPath: string | undefined;
    let config = makeConfig({
      runParseInMemory: async (options) => {
        capturedPath = options.path;
        return {
          status: 'passed' as const,
          filesChecked: 0,
          filesWithErrors: 0,
          errorCount: 0,
          durationMs: 0,
          parseableFiles: [],
          errors: [],
        };
      },
    });
    let { executor } = createMockToolExecutor(new Map());
    let tools = buildFactoryTools(config, executor, new ToolRegistry());
    let runParse = tools.find((t) => t.name === 'run_parse')!;

    await runParse.execute({ path: '   ' });

    assert.strictEqual(
      capturedPath,
      undefined,
      'whitespace-only path falls back to whole-realm parse',
    );
  });

  test('propagates failed parse results unchanged', async function (assert) {
    let stubResult = {
      status: 'failed' as const,
      filesChecked: 1,
      filesWithErrors: 1,
      errorCount: 2,
      durationMs: 12,
      parseableFiles: ['bad.gts'],
      errors: [
        {
          file: 'bad.gts',
          line: 4,
          column: 5,
          message: "Type 'string' is not assignable to type 'number'.",
        },
        {
          file: 'bad.gts',
          line: 7,
          column: 1,
          message: "Cannot find name 'foo'.",
        },
      ],
    };
    let config = makeConfig({
      runParseInMemory: async () => stubResult,
    });
    let { executor } = createMockToolExecutor(new Map());
    let tools = buildFactoryTools(config, executor, new ToolRegistry());
    let runParse = tools.find((t) => t.name === 'run_parse')!;

    let result = (await runParse.execute({})) as typeof stubResult;

    assert.strictEqual(result.status, 'failed');
    assert.strictEqual(result.errorCount, 2);
    assert.strictEqual(result.errors.length, 2);
    assert.ok(result.errors[0].message.includes('not assignable'));
  });
});

// ---------------------------------------------------------------------------
// run_instantiate tool (in-memory validation)
// ---------------------------------------------------------------------------

module('buildFactoryTools — run_instantiate', function () {
  test('registers run_instantiate with an optional path parameter', function (assert) {
    let config = makeConfig();
    let { executor } = createMockToolExecutor(new Map());
    let tools = buildFactoryTools(config, executor, new ToolRegistry());
    let runInstantiate = tools.find((t) => t.name === 'run_instantiate');
    assert.ok(runInstantiate, 'run_instantiate tool is registered');
    let params = runInstantiate!.parameters as {
      type: string;
      properties: Record<string, { type: string }>;
      required?: string[];
    };
    assert.strictEqual(params.type, 'object');
    assert.strictEqual(params.properties.path?.type, 'string');
    assert.strictEqual(params.required, undefined, 'path is optional');
  });

  test('delegates to injected runInstantiateInMemory and forwards realm config', async function (assert) {
    let capturedOptions:
      | {
          targetRealm: string;
          realmServerUrl: string;
          hasClient: boolean;
          path: string | undefined;
        }
      | undefined;
    let stubResult = {
      status: 'passed' as const,
      instancesChecked: 2,
      instancesWithErrors: 0,
      durationMs: 55,
      instanceFiles: ['Card/a.json', 'Card/b.json'],
      failures: [],
    };

    let config = makeConfig({
      runInstantiateInMemory: async (options) => {
        capturedOptions = {
          targetRealm: options.targetRealm,
          realmServerUrl: options.realmServerUrl,
          hasClient: Boolean(options.client),
          path: options.path,
        };
        return stubResult;
      },
    });
    let { executor } = createMockToolExecutor(new Map());
    let tools = buildFactoryTools(config, executor, new ToolRegistry());
    let runInstantiate = tools.find((t) => t.name === 'run_instantiate');
    assert.ok(runInstantiate, 'run_instantiate tool is registered');

    let result = await runInstantiate!.execute({});

    assert.deepEqual(result, stubResult, 'tool returns the in-memory result');
    assert.strictEqual(
      capturedOptions?.targetRealm,
      TARGET_REALM,
      'forwards targetRealm from config',
    );
    assert.strictEqual(
      capturedOptions?.realmServerUrl,
      'https://realms.example.test/',
      'forwards realmServerUrl from config',
    );
    assert.true(
      capturedOptions?.hasClient,
      'forwards the configured BoxelCLIClient',
    );
    assert.strictEqual(
      capturedOptions?.path,
      undefined,
      'path is omitted when not provided',
    );
  });

  test('forwards path when provided to single-instance instantiate', async function (assert) {
    let capturedPath: string | undefined;
    let stubResult = {
      status: 'failed' as const,
      instancesChecked: 1,
      instancesWithErrors: 1,
      durationMs: 90,
      instanceFiles: ['TagsCard/bad.json'],
      failures: [
        {
          path: 'TagsCard/bad.json',
          cardName: 'TagsCard',
          error: 'Expected array for field value tags',
          stackTrace: 'at Loader.load (loader.ts:42:5)',
        },
      ],
    };

    let config = makeConfig({
      runInstantiateInMemory: async (options) => {
        capturedPath = options.path;
        return stubResult;
      },
    });
    let { executor } = createMockToolExecutor(new Map());
    let tools = buildFactoryTools(config, executor, new ToolRegistry());
    let runInstantiate = tools.find((t) => t.name === 'run_instantiate');
    assert.ok(runInstantiate, 'run_instantiate tool is registered');

    let result = (await runInstantiate!.execute({
      path: 'TagsCard/bad.json',
    })) as typeof stubResult;

    assert.strictEqual(
      capturedPath,
      'TagsCard/bad.json',
      'path is forwarded to the engine',
    );
    assert.strictEqual(result.status, 'failed');
    assert.deepEqual(result.instanceFiles, ['TagsCard/bad.json']);
    assert.strictEqual(result.failures[0].path, 'TagsCard/bad.json');
    assert.strictEqual(result.failures[0].cardName, 'TagsCard');
    assert.strictEqual(
      result.failures[0].stackTrace,
      'at Loader.load (loader.ts:42:5)',
    );
  });

  test('whitespace-only path is treated as "no path" (whole-realm instantiate)', async function (assert) {
    let capturedPath: string | undefined;
    let config = makeConfig({
      runInstantiateInMemory: async (options) => {
        capturedPath = options.path;
        return {
          status: 'passed' as const,
          instancesChecked: 0,
          instancesWithErrors: 0,
          durationMs: 0,
          instanceFiles: [],
          failures: [],
        };
      },
    });
    let { executor } = createMockToolExecutor(new Map());
    let tools = buildFactoryTools(config, executor, new ToolRegistry());
    let runInstantiate = tools.find((t) => t.name === 'run_instantiate');
    assert.ok(runInstantiate, 'run_instantiate tool is registered');

    await runInstantiate!.execute({ path: '   ' });

    assert.strictEqual(
      capturedPath,
      undefined,
      'whitespace-only path falls back to whole-realm instantiate',
    );
  });

  test('propagates failed instantiate results unchanged', async function (assert) {
    let stubResult = {
      status: 'failed' as const,
      instancesChecked: 3,
      instancesWithErrors: 1,
      durationMs: 120,
      instanceFiles: ['A/1.json', 'A/2.json', 'B/1.json'],
      failures: [
        {
          path: 'B/1.json',
          cardName: 'BadCard',
          error: 'Cannot read properties of undefined',
        },
      ],
    };
    let config = makeConfig({
      runInstantiateInMemory: async () => stubResult,
    });
    let { executor } = createMockToolExecutor(new Map());
    let tools = buildFactoryTools(config, executor, new ToolRegistry());
    let runInstantiate = tools.find((t) => t.name === 'run_instantiate');
    assert.ok(runInstantiate, 'run_instantiate tool is registered');

    let result = (await runInstantiate!.execute({})) as typeof stubResult;

    assert.strictEqual(result.status, 'failed');
    assert.strictEqual(result.instancesWithErrors, 1);
    assert.strictEqual(result.failures.length, 1);
    assert.strictEqual(result.failures[0].path, 'B/1.json');
    assert.strictEqual(result.failures[0].cardName, 'BadCard');
  });
});

// ---------------------------------------------------------------------------
// get_card_schema tool (live-schema fetch via realm prerenderer)
// ---------------------------------------------------------------------------

module('buildFactoryTools — get_card_schema', function () {
  /**
   * Build a mock client whose `runCommand` returns a stub schema for the
   * GetCardTypeSchemaCommand and records the args it was called with.
   * Other client methods fall through to a no-op default.
   */
  function buildSchemaClient(
    schema: {
      attributes: Record<string, unknown>;
      relationships?: Record<string, unknown>;
    },
    capture?: {
      calls: {
        realmServerUrl: string;
        realmUrl: string;
        command: string;
        commandInput: unknown;
      }[];
    },
  ) {
    let base = createMockClient();
    return {
      ...base,
      runCommand: async (
        realmServerUrl: string,
        realmUrl: string,
        command: string,
        commandInput?: Record<string, unknown>,
      ) => {
        capture?.calls.push({
          realmServerUrl,
          realmUrl,
          command,
          commandInput,
        });
        return {
          status: 'ready' as const,
          result: JSON.stringify({
            data: { attributes: { json: schema } },
          }),
          error: null,
        };
      },
    } as unknown as ReturnType<typeof createMockClient>;
  }

  test('registers get_card_schema with module + name as required params', function (assert) {
    let config = makeConfig();
    let { executor } = createMockToolExecutor(new Map());
    let tools = buildFactoryTools(config, executor, new ToolRegistry());
    let tool = tools.find((t) => t.name === 'get_card_schema');
    assert.ok(tool, 'get_card_schema tool is registered');
    let params = tool!.parameters as {
      type: string;
      properties: Record<string, { type: string }>;
      required?: string[];
    };
    assert.strictEqual(params.type, 'object');
    assert.strictEqual(params.properties.module?.type, 'string');
    assert.strictEqual(params.properties.name?.type, 'string');
    assert.deepEqual(params.required, ['module', 'name']);
  });

  test('forwards CodeRef to GetCardTypeSchemaCommand and returns schema', async function (assert) {
    let calls: {
      realmServerUrl: string;
      realmUrl: string;
      command: string;
      commandInput: unknown;
    }[] = [];
    let stubSchema = {
      attributes: { properties: { foo: { type: 'string' } } },
      relationships: { properties: { bar: { type: 'object' } } },
    };
    let client = buildSchemaClient(stubSchema, { calls });
    // Use a unique module URL per test to bypass the per-process cache
    // in fetchCardTypeSchema.
    let module = `https://realms.example.test/test-${Date.now()}-${Math.random()}-A/m`;

    let config = makeConfig({ client });
    let { executor } = createMockToolExecutor(new Map());
    let tools = buildFactoryTools(config, executor, new ToolRegistry());
    let tool = tools.find((t) => t.name === 'get_card_schema')!;

    let result = (await tool.execute({ module, name: 'Project' })) as {
      ok: boolean;
      schema?: unknown;
    };

    assert.true(result.ok, 'returns ok: true on success');
    assert.deepEqual(
      result.schema,
      stubSchema,
      'returns the parsed schema verbatim',
    );
    assert.strictEqual(calls.length, 1, 'runCommand invoked exactly once');
    assert.strictEqual(
      calls[0].command,
      '@cardstack/boxel-host/commands/get-card-type-schema/default',
      'forwards GetCardTypeSchemaCommand specifier',
    );
    assert.strictEqual(
      calls[0].realmServerUrl,
      'https://realms.example.test/',
      'forwards realmServerUrl from config',
    );
    assert.strictEqual(
      calls[0].realmUrl,
      TARGET_REALM,
      'forwards target realm as command-context realm',
    );
    let input = calls[0].commandInput as {
      codeRef: { module: string; name: string };
    };
    assert.strictEqual(input.codeRef.module, module);
    assert.strictEqual(input.codeRef.name, 'Project');
  });

  test('surfaces failure when runCommand returns a non-ready status', async function (assert) {
    let module = `https://realms.example.test/test-${Date.now()}-${Math.random()}-B/m`;
    let client = {
      ...createMockClient(),
      runCommand: async () => ({
        status: 'error' as const,
        result: null,
        error: 'boom',
      }),
    } as unknown as ReturnType<typeof createMockClient>;

    let config = makeConfig({ client });
    let { executor } = createMockToolExecutor(new Map());
    let tools = buildFactoryTools(config, executor, new ToolRegistry());
    let tool = tools.find((t) => t.name === 'get_card_schema')!;

    let result = (await tool.execute({ module, name: 'Issue' })) as {
      ok: boolean;
      error?: string;
    };

    assert.false(result.ok, 'returns ok: false on schema-fetch failure');
    assert.strictEqual(typeof result.error, 'string', 'error is a string');
    assert.true(
      (result.error ?? '').includes(module),
      'error message references the failing module URL',
    );
  });

  test('throws when module or name args are missing', async function (assert) {
    let config = makeConfig();
    let { executor } = createMockToolExecutor(new Map());
    let tools = buildFactoryTools(config, executor, new ToolRegistry());
    let tool = tools.find((t) => t.name === 'get_card_schema')!;

    let err1: Error | undefined;
    try {
      await tool.execute({ name: 'Project' });
    } catch (e) {
      err1 = e as Error;
    }
    assert.ok(err1, 'throws when module is missing');
    assert.true(/non-empty string "module"/.test(err1?.message ?? ''));

    let err2: Error | undefined;
    try {
      await tool.execute({ module: 'https://example.test/m' });
    } catch (e) {
      err2 = e as Error;
    }
    assert.ok(err2, 'throws when name is missing');
    assert.true(/non-empty string "name"/.test(err2?.message ?? ''));
  });
});
