import { module, test } from 'qunit';

import type { ToolResult } from '../src/factory-agent';
import {
  buildFactoryTools,
  DONE_SIGNAL,
  CLARIFICATION_SIGNAL,
  type FactoryTool,
  type ToolBuilderConfig,
  type DoneResult,
  type ClarificationResult,
} from '../src/factory-tool-builder';
import type { ToolExecutor } from '../src/factory-tool-executor';
import { ToolRegistry } from '../src/factory-tool-registry';
import { createMockClient } from './helpers/mock-client';
import {
  createTestWorkspace,
  type TestWorkspace,
} from './helpers/workspace-fixture';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TARGET_REALM = 'https://realms.example.test/user/target/';

const DEFAULT_CARD_TYPE_SCHEMAS = new Map<
  string,
  {
    attributes: Record<string, unknown>;
    relationships?: Record<string, unknown>;
  }
>([
  [
    'Project',
    {
      attributes: {
        type: 'object',
        properties: { projectName: { type: 'string' } },
      },
    },
  ],
  [
    'Issue',
    {
      attributes: {
        type: 'object',
        properties: { summary: { type: 'string' } },
      },
    },
  ],
  [
    'KnowledgeArticle',
    {
      attributes: {
        type: 'object',
        properties: { articleTitle: { type: 'string' } },
      },
    },
  ],
  [
    'Spec',
    {
      attributes: {
        type: 'object',
        properties: { cardTitle: { type: 'string' } },
      },
    },
  ],
]);

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

function workspaceFor(config: ToolBuilderConfig): TestWorkspace {
  let ws = configWorkspaces.get(config);
  if (!ws) {
    throw new Error('No workspace attached to ToolBuilderConfig');
  }
  return ws;
}

function makeConfig(
  overrides?: Partial<ToolBuilderConfig> & { fetch?: typeof globalThis.fetch },
): ToolBuilderConfig {
  let { fetch: fetchOverride, client, workspaceDir, ...rest } = overrides ?? {};
  let workspace = workspaceDir ? undefined : makeWorkspace();
  let config: ToolBuilderConfig = {
    targetRealm: TARGET_REALM,
    darkfactoryModuleUrl:
      'https://realms.example.test/software-factory/darkfactory',
    realmServerUrl: 'https://realms.example.test/',
    client:
      client ??
      createMockClient(fetchOverride ? { fetch: fetchOverride } : undefined),
    workspaceDir: workspaceDir ?? workspace!.dir,
    cardTypeSchemas: DEFAULT_CARD_TYPE_SCHEMAS,
    ...rest,
  };
  if (workspace) {
    configWorkspaces.set(config, workspace);
  }
  return config;
}

interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

function createMockFetch(
  status: number,
  responseBody: unknown,
  /** Optional: return this document for GET requests (read-patch-write support). */
  getResponseBody?: unknown,
): {
  fetch: typeof globalThis.fetch;
  requests: CapturedRequest[];
} {
  let requests: CapturedRequest[] = [];

  let mockFetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    let url = typeof input === 'string' ? input : input.toString();
    let headers: Record<string, string> = {};
    if (init?.headers) {
      let h = init.headers as Record<string, string>;
      for (let [k, v] of Object.entries(h)) {
        headers[k] = v;
      }
    }
    let method = init?.method ?? 'GET';
    requests.push({
      url,
      method,
      headers,
      body: typeof init?.body === 'string' ? init.body : '',
    });
    // For GET requests (reads), return the getResponseBody if provided,
    // otherwise return 404 (card doesn't exist yet → fresh create).
    if (method === 'GET' && getResponseBody !== undefined) {
      return new Response(JSON.stringify(getResponseBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (method === 'GET' && getResponseBody === undefined) {
      return new Response('Not Found', {
        status: 404,
        headers: { 'Content-Type': 'text/plain' },
      });
    }
    return new Response(JSON.stringify(responseBody), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof globalThis.fetch;

  return { fetch: mockFetch, requests };
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

    assert.true(toolNames.includes('write_file'));
    assert.true(toolNames.includes('read_file'));
    assert.true(toolNames.includes('search_realm'));
    assert.true(toolNames.includes('update_issue'));
    assert.true(toolNames.includes('add_comment'));
    assert.true(toolNames.includes('create_knowledge'));
    assert.true(toolNames.includes('signal_done'));
    assert.true(toolNames.includes('request_clarification'));
    // After CS-10883 retired the kebab-case shadow tools, only
    // `realm-create` survives in the registry.
    assert.true(toolNames.includes('realm-create'));
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
// write_file: file routing (.gts vs .json)
// ---------------------------------------------------------------------------

module('factory-tool-builder > write_file', function () {
  test('writes .gts file to the workspace with raw text body', async function (assert) {
    let registry = new ToolRegistry();
    let { executor } = createMockToolExecutor(new Map());
    let config = makeConfig();
    let ws = workspaceFor(config);
    let tools = buildFactoryTools(config, executor, registry);
    let writeTool = findTool(tools, 'write_file');

    let result = (await writeTool.execute({
      path: 'my-card.gts',
      content: 'export default class MyCard {}',
    })) as { ok: boolean };

    assert.true(result.ok);
    assert.true(ws.exists('my-card.gts'), 'workspace has my-card.gts');
    assert.strictEqual(
      ws.read('my-card.gts'),
      'export default class MyCard {}',
    );
  });

  test('writes nested .ts path to the workspace', async function (assert) {
    let registry = new ToolRegistry();
    let { executor } = createMockToolExecutor(new Map());
    let config = makeConfig();
    let ws = workspaceFor(config);
    let tools = buildFactoryTools(config, executor, registry);
    let writeTool = findTool(tools, 'write_file');

    let result = (await writeTool.execute({
      path: 'utils/helpers.ts',
      content: 'export function helper() {}',
    })) as { ok: boolean };

    assert.true(result.ok);
    assert.strictEqual(
      ws.read('utils/helpers.ts'),
      'export function helper() {}',
    );
  });

  test('writes .json file as raw content (no JSON parsing)', async function (assert) {
    let registry = new ToolRegistry();
    let { executor } = createMockToolExecutor(new Map());
    let config = makeConfig();
    let ws = workspaceFor(config);
    let tools = buildFactoryTools(config, executor, registry);
    let writeTool = findTool(tools, 'write_file');

    let cardJson = JSON.stringify({
      data: { type: 'card', attributes: { title: 'Test Card' } },
    });

    let result = (await writeTool.execute({
      path: 'Card/1.json',
      content: cardJson,
    })) as { ok: boolean };

    assert.true(result.ok);
    // Content is written verbatim — no re-serialization by write_file.
    assert.strictEqual(ws.read('Card/1.json'), cardJson);
  });
});

// ---------------------------------------------------------------------------
// Argument validation (guards against malformed LLM tool calls)
// ---------------------------------------------------------------------------

/**
 * The OpenRouter tool-use protocol treats `required` on parameter schemas
 * as advisory: models can still emit `tool_call` with an empty args blob
 * (`write_file({})`). Without runtime validation, the factory would
 * silently write to `<realm>/undefined` because `path` stringifies to the
 * literal "undefined" further down the call chain.
 *
 * These tests assert that every path-taking tool rejects
 * missing/empty/non-string path with a clear error — one the agent can
 * self-correct on during the next inner-loop iteration — and that the
 * realm never sees an HTTP request for the malformed call.
 */
module('factory-tool-builder > path-arg validation', function () {
  async function expectPathError(
    invoke: () => Promise<unknown>,
    toolName: string,
    assert: Assert,
  ) {
    let err: Error | undefined;
    try {
      await invoke();
    } catch (e) {
      err = e as Error;
    }
    assert.ok(err, 'tool must throw for missing/empty path');
    assert.true(
      /non-empty string "path"/.test(err?.message ?? ''),
      `error mentions the missing path arg (got: ${err?.message})`,
    );
    assert.true(
      err!.message.includes(toolName),
      `error mentions the tool name "${toolName}"`,
    );
  }

  test('write_file({}) throws and does NOT hit the realm', async function (assert) {
    let { fetch: mockFetch, requests } = createMockFetch(200, {});
    let registry = new ToolRegistry();
    let { executor } = createMockToolExecutor(new Map());
    let config = makeConfig({ fetch: mockFetch });
    let tools = buildFactoryTools(config, executor, registry);
    let writeTool = findTool(tools, 'write_file');

    await expectPathError(() => writeTool.execute({}), 'write_file', assert);
    assert.strictEqual(
      requests.length,
      0,
      'no realm HTTP request was made for an empty write_file call',
    );
  });

  test('write_file with empty-string path throws', async function (assert) {
    let { fetch: mockFetch } = createMockFetch(200, {});
    let registry = new ToolRegistry();
    let { executor } = createMockToolExecutor(new Map());
    let config = makeConfig({ fetch: mockFetch });
    let tools = buildFactoryTools(config, executor, registry);
    let writeTool = findTool(tools, 'write_file');

    await expectPathError(
      () => writeTool.execute({ path: '   ', content: 'x' }),
      'write_file',
      assert,
    );
  });

  test('write_file with missing content throws (required arg)', async function (assert) {
    let { fetch: mockFetch, requests } = createMockFetch(200, {});
    let registry = new ToolRegistry();
    let { executor } = createMockToolExecutor(new Map());
    let config = makeConfig({ fetch: mockFetch });
    let tools = buildFactoryTools(config, executor, registry);
    let writeTool = findTool(tools, 'write_file');

    let err: Error | undefined;
    try {
      await writeTool.execute({ path: 'card.gts' });
    } catch (e) {
      err = e as Error;
    }
    assert.ok(err);
    assert.true(/non-empty string "content"/.test(err?.message ?? ''));
    assert.strictEqual(requests.length, 0, 'no write request was made');
  });

  test('read_file({}) throws and does NOT hit the realm', async function (assert) {
    let { fetch: mockFetch, requests } = createMockFetch(200, {});
    let registry = new ToolRegistry();
    let { executor } = createMockToolExecutor(new Map());
    let config = makeConfig({ fetch: mockFetch });
    let tools = buildFactoryTools(config, executor, registry);
    let readTool = findTool(tools, 'read_file');

    await expectPathError(() => readTool.execute({}), 'read_file', assert);
    assert.strictEqual(requests.length, 0);
  });

  test('fetch_transpiled_module({}) throws', async function (assert) {
    let { fetch: mockFetch } = createMockFetch(200, {});
    let registry = new ToolRegistry();
    let { executor } = createMockToolExecutor(new Map());
    let config = makeConfig({ fetch: mockFetch });
    let tools = buildFactoryTools(config, executor, registry);
    let fetchTool = findTool(tools, 'fetch_transpiled_module');

    await expectPathError(
      () => fetchTool.execute({}),
      'fetch_transpiled_module',
      assert,
    );
  });

  test('update_project({}) throws', async function (assert) {
    let { fetch: mockFetch, requests } = createMockFetch(200, {});
    let registry = new ToolRegistry();
    let { executor } = createMockToolExecutor(new Map());
    let config = makeConfig({ fetch: mockFetch });
    let tools = buildFactoryTools(config, executor, registry);
    let tool = findTool(tools, 'update_project');

    await expectPathError(() => tool.execute({}), 'update_project', assert);
    assert.strictEqual(requests.length, 0);
  });

  test('update_issue({}) throws', async function (assert) {
    let { fetch: mockFetch } = createMockFetch(200, {});
    let registry = new ToolRegistry();
    let { executor } = createMockToolExecutor(new Map());
    let config = makeConfig({ fetch: mockFetch });
    let tools = buildFactoryTools(config, executor, registry);
    let tool = findTool(tools, 'update_issue');

    await expectPathError(() => tool.execute({}), 'update_issue', assert);
  });

  test('add_comment({}) throws', async function (assert) {
    let { fetch: mockFetch } = createMockFetch(200, {});
    let registry = new ToolRegistry();
    let { executor } = createMockToolExecutor(new Map());
    let config = makeConfig({ fetch: mockFetch });
    let tools = buildFactoryTools(config, executor, registry);
    let tool = findTool(tools, 'add_comment');

    await expectPathError(() => tool.execute({}), 'add_comment', assert);
  });

  test('add_comment rejects empty body / author too', async function (assert) {
    let { fetch: mockFetch } = createMockFetch(200, {});
    let registry = new ToolRegistry();
    let { executor } = createMockToolExecutor(new Map());
    let config = makeConfig({ fetch: mockFetch });
    let tools = buildFactoryTools(config, executor, registry);
    let tool = findTool(tools, 'add_comment');

    let err: Error | undefined;
    try {
      await tool.execute({ path: 'Issues/1.json', body: '', author: '' });
    } catch (e) {
      err = e as Error;
    }
    assert.ok(err);
    assert.true(/non-empty string "body"/.test(err?.message ?? ''));
  });

  test('create_knowledge({}) throws', async function (assert) {
    let { fetch: mockFetch } = createMockFetch(200, {});
    let registry = new ToolRegistry();
    let { executor } = createMockToolExecutor(new Map());
    let config = makeConfig({ fetch: mockFetch });
    let tools = buildFactoryTools(config, executor, registry);
    let tool = findTool(tools, 'create_knowledge');

    await expectPathError(() => tool.execute({}), 'create_knowledge', assert);
  });

  test('create_catalog_spec({}) throws', async function (assert) {
    let { fetch: mockFetch } = createMockFetch(200, {});
    let registry = new ToolRegistry();
    let { executor } = createMockToolExecutor(new Map());
    let config = makeConfig({ fetch: mockFetch });
    let tools = buildFactoryTools(config, executor, registry);
    let tool = findTool(tools, 'create_catalog_spec');

    await expectPathError(
      () => tool.execute({}),
      'create_catalog_spec',
      assert,
    );
  });
});

// ---------------------------------------------------------------------------
// Realm targeting (target vs test) + JWT auth
// ---------------------------------------------------------------------------

module('factory-tool-builder > realm targeting', function () {
  test('write_file writes to the workspace (target realm)', async function (assert) {
    let registry = new ToolRegistry();
    let { executor } = createMockToolExecutor(new Map());
    let config = makeConfig();
    let ws = workspaceFor(config);
    let tools = buildFactoryTools(config, executor, registry);
    let writeTool = findTool(tools, 'write_file');

    await writeTool.execute({ path: 'card.gts', content: 'content' });

    assert.true(ws.exists('card.gts'));
    assert.strictEqual(ws.read('card.gts'), 'content');
  });

  test('read_file reads from the workspace (target realm)', async function (assert) {
    let registry = new ToolRegistry();
    let { executor } = createMockToolExecutor(new Map());
    let config = makeConfig();
    let ws = workspaceFor(config);
    // Pre-seed the workspace with the file the agent will read.
    ws.write('card.gts', 'export class Card {}');
    let tools = buildFactoryTools(config, executor, registry);
    let readTool = findTool(tools, 'read_file');

    let result = (await readTool.execute({ path: 'card.gts' })) as {
      ok: boolean;
      content?: string;
    };

    assert.true(result.ok);
    assert.strictEqual(result.content, 'export class Card {}');
  });

  test('update_issue reads from and writes to the workspace', async function (assert) {
    let registry = new ToolRegistry();
    let { executor } = createMockToolExecutor(new Map());
    let config = makeConfig();
    let ws = workspaceFor(config);

    // Pre-seed an existing issue so update_issue exercises the read-
    // patch-write path rather than the fresh-document fallback.
    let existingDoc = {
      data: {
        type: 'card',
        attributes: { issueId: 'SN-1', summary: 'Existing issue' },
        meta: {
          adoptsFrom: {
            module: 'https://realms.example.test/software-factory/darkfactory',
            name: 'Issue',
          },
        },
      },
    };
    ws.write('Issues/1.json', JSON.stringify(existingDoc, null, 2));

    let tools = buildFactoryTools(config, executor, registry);
    let updateTool = findTool(tools, 'update_issue');

    await updateTool.execute({
      path: 'Issues/1.json',
      attributes: { status: 'blocked' },
    });

    let updated = JSON.parse(ws.read('Issues/1.json'));
    assert.strictEqual(updated.data.attributes.status, 'blocked');
    // The pre-existing summary is preserved via read-patch-write.
    assert.strictEqual(updated.data.attributes.summary, 'Existing issue');
  });

  test('create_knowledge writes to the workspace', async function (assert) {
    let registry = new ToolRegistry();
    let { executor } = createMockToolExecutor(new Map());
    let config = makeConfig();
    let ws = workspaceFor(config);
    let tools = buildFactoryTools(config, executor, registry);
    let knowledgeTool = findTool(tools, 'create_knowledge');

    await knowledgeTool.execute({
      path: 'Knowledge/deploy.json',
      attributes: { articleTitle: 'Guide' },
    });

    assert.true(ws.exists('Knowledge/deploy.json'));
    let written = JSON.parse(ws.read('Knowledge/deploy.json'));
    assert.strictEqual(written.data.attributes.articleTitle, 'Guide');
  });

  test('search_realm targets target realm', async function (assert) {
    let { fetch: mockFetch, requests } = createMockFetch(200, { data: [] });
    let registry = new ToolRegistry();
    let { executor } = createMockToolExecutor(new Map());
    let config = makeConfig({ fetch: mockFetch });
    let tools = buildFactoryTools(config, executor, registry);
    let searchTool = findTool(tools, 'search_realm');

    await searchTool.execute({
      query: { filter: { type: { name: 'Issue' } } },
    });

    assert.true(requests[0].url.startsWith(TARGET_REALM));
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
// Card tool schemas and document assembly
// ---------------------------------------------------------------------------

module(
  'factory-tool-builder > card tool schemas and document assembly',
  function () {
    test('card tools use runtime schemas from cardTypeSchemas config', function (assert) {
      let registry = new ToolRegistry();
      let { executor } = createMockToolExecutor(new Map());
      let config = makeConfig({
        cardTypeSchemas: new Map([
          [
            'Project',
            {
              attributes: {
                type: 'object',
                properties: {
                  projectName: { type: 'string' },
                  projectStatus: {
                    type: 'string',
                    enum: ['planning', 'active'],
                  },
                },
              },
            },
          ],
          [
            'Issue',
            {
              attributes: {
                type: 'object',
                properties: {
                  summary: { type: 'string' },
                  status: { type: 'string', enum: ['backlog', 'done'] },
                },
              },
              relationships: {
                type: 'object',
                properties: {
                  project: { type: 'object' },
                },
              },
            },
          ],
          [
            'KnowledgeArticle',
            {
              attributes: {
                type: 'object',
                properties: {
                  articleTitle: { type: 'string' },
                  content: { type: 'string' },
                },
              },
            },
          ],
        ]),
      });
      let tools = buildFactoryTools(config, executor, registry);

      // update_project uses runtime schema
      let projectTool = findTool(tools, 'update_project');
      let projectParams = projectTool.parameters as {
        properties: Record<string, Record<string, unknown>>;
        required: string[];
      };
      assert.true('attributes' in projectParams.properties);
      assert.true(projectParams.required.includes('attributes'));
      let projectAttrs = projectParams.properties.attributes as {
        properties: Record<string, Record<string, unknown>>;
      };
      assert.true('projectName' in projectAttrs.properties);
      assert.deepEqual(
        (projectAttrs.properties.projectStatus as { enum: string[] }).enum,
        ['planning', 'active'],
      );

      // update_issue uses runtime schema with relationships
      let issueTool = findTool(tools, 'update_issue');
      let issueParams = issueTool.parameters as {
        properties: Record<string, Record<string, unknown>>;
      };
      assert.true('attributes' in issueParams.properties);
      assert.true('relationships' in issueParams.properties);

      // create_knowledge uses runtime schema
      let knowledgeTool = findTool(tools, 'create_knowledge');
      let knowledgeParams = knowledgeTool.parameters as {
        properties: Record<string, Record<string, unknown>>;
      };
      let knowledgeAttrs = knowledgeParams.properties.attributes as {
        properties: Record<string, Record<string, unknown>>;
      };
      assert.true('articleTitle' in knowledgeAttrs.properties);
      assert.true('content' in knowledgeAttrs.properties);
    });

    test('card tools are omitted when cardTypeSchemas is not provided', function (assert) {
      let registry = new ToolRegistry();
      let { executor } = createMockToolExecutor(new Map());
      let config = makeConfig({ cardTypeSchemas: undefined });
      let tools = buildFactoryTools(config, executor, registry);
      let toolNames = tools.map((t) => t.name);
      assert.false(toolNames.includes('update_project'));
      assert.false(toolNames.includes('update_issue'));
      assert.false(toolNames.includes('create_knowledge'));
      assert.true(toolNames.includes('write_file'));
      assert.true(toolNames.includes('run_command'));
    });

    test('update_issue merges attributes with existing card (read-patch-write)', async function (assert) {
      let existingIssue = {
        data: {
          type: 'card',
          attributes: {
            issueId: 'SN-1',
            summary: 'Original summary',
            description: 'Original description',
            status: 'backlog',
            priority: 'high',
          },
          meta: {
            adoptsFrom: {
              module:
                'https://realms.example.test/software-factory/darkfactory',
              name: 'Issue',
            },
          },
        },
      };
      let registry = new ToolRegistry();
      let { executor } = createMockToolExecutor(new Map());
      let config = makeConfig();
      let ws = workspaceFor(config);
      ws.write('Issues/1.json', JSON.stringify(existingIssue, null, 2));
      let tools = buildFactoryTools(config, executor, registry);
      let tool = findTool(tools, 'update_issue');

      await tool.execute({
        path: 'Issues/1.json',
        attributes: { status: 'blocked', summary: 'Updated summary' },
      });

      let body = JSON.parse(ws.read('Issues/1.json'));
      assert.strictEqual(body.data.type, 'card');
      assert.strictEqual(
        body.data.attributes.status,
        'blocked',
        'agent can set status to blocked',
      );
      assert.strictEqual(
        body.data.attributes.summary,
        'Updated summary',
        'provided attributes are updated',
      );
      assert.strictEqual(
        body.data.attributes.description,
        'Original description',
        'existing attributes are preserved',
      );
      assert.strictEqual(
        body.data.attributes.issueId,
        'SN-1',
        'existing issueId preserved',
      );
      assert.strictEqual(
        body.data.attributes.priority,
        'high',
        'existing priority preserved',
      );
    });

    test('update_issue strips disallowed status values', async function (assert) {
      let existingIssue = {
        data: {
          type: 'card',
          attributes: {
            issueId: 'SN-1',
            summary: 'Existing',
            status: 'in_progress',
          },
          meta: {
            adoptsFrom: {
              module:
                'https://realms.example.test/software-factory/darkfactory',
              name: 'Issue',
            },
          },
        },
      };
      let registry = new ToolRegistry();
      let { executor } = createMockToolExecutor(new Map());
      let config = makeConfig();
      let ws = workspaceFor(config);
      ws.write('Issues/1.json', JSON.stringify(existingIssue, null, 2));
      let tools = buildFactoryTools(config, executor, registry);
      let tool = findTool(tools, 'update_issue');

      await tool.execute({
        path: 'Issues/1.json',
        attributes: { status: 'done', summary: 'Build sticky note' },
      });

      let body = JSON.parse(ws.read('Issues/1.json'));
      assert.strictEqual(
        body.data.attributes.status,
        'in_progress',
        'done status is stripped — existing status preserved',
      );
      assert.strictEqual(
        body.data.attributes.summary,
        'Build sticky note',
        'other attributes are updated',
      );
    });

    test('update_issue allows blocked and backlog status', async function (assert) {
      let existingIssue = {
        data: {
          type: 'card',
          attributes: { issueId: 'SN-1', status: 'in_progress' },
          meta: {
            adoptsFrom: {
              module:
                'https://realms.example.test/software-factory/darkfactory',
              name: 'Issue',
            },
          },
        },
      };
      let registry = new ToolRegistry();
      let { executor } = createMockToolExecutor(new Map());
      let config = makeConfig();
      let ws = workspaceFor(config);
      ws.write('Issues/1.json', JSON.stringify(existingIssue, null, 2));
      let tools = buildFactoryTools(config, executor, registry);
      let tool = findTool(tools, 'update_issue');

      await tool.execute({
        path: 'Issues/1.json',
        attributes: { status: 'blocked', summary: 'Stuck' },
      });
      let body1 = JSON.parse(ws.read('Issues/1.json'));
      assert.strictEqual(
        body1.data.attributes.status,
        'blocked',
        'blocked is allowed',
      );

      await tool.execute({
        path: 'Issues/1.json',
        attributes: { status: 'backlog', summary: 'Unblocked' },
      });
      let body2 = JSON.parse(ws.read('Issues/1.json'));
      assert.strictEqual(
        body2.data.attributes.status,
        'backlog',
        'backlog is allowed',
      );
    });

    test('update_issue strips description (descriptions are immutable)', async function (assert) {
      let existingIssue = {
        data: {
          type: 'card',
          attributes: {
            issueId: 'SN-1',
            description: 'Original description',
            status: 'in_progress',
          },
          meta: {
            adoptsFrom: {
              module:
                'https://realms.example.test/software-factory/darkfactory',
              name: 'Issue',
            },
          },
        },
      };
      let registry = new ToolRegistry();
      let { executor } = createMockToolExecutor(new Map());
      let config = makeConfig();
      let ws = workspaceFor(config);
      ws.write('Issues/1.json', JSON.stringify(existingIssue, null, 2));
      let tools = buildFactoryTools(config, executor, registry);
      let tool = findTool(tools, 'update_issue');

      await tool.execute({
        path: 'Issues/1.json',
        attributes: { description: 'Overwritten!', status: 'blocked' },
      });
      let body = JSON.parse(ws.read('Issues/1.json'));
      assert.strictEqual(
        body.data.attributes.description,
        'Original description',
        'description is preserved from original, not overwritten',
      );
      assert.strictEqual(
        body.data.attributes.status,
        'blocked',
        'status update still works',
      );
    });

    test('card tools omit empty relationships from document', async function (assert) {
      let existingProject = {
        data: {
          type: 'card',
          attributes: { projectCode: 'SN', projectName: 'Sticky Note' },
          meta: {
            adoptsFrom: {
              module:
                'https://realms.example.test/software-factory/darkfactory',
              name: 'Project',
            },
          },
        },
      };
      let registry = new ToolRegistry();
      let { executor } = createMockToolExecutor(new Map());
      let config = makeConfig();
      let ws = workspaceFor(config);
      ws.write('Project/mvp.json', JSON.stringify(existingProject, null, 2));
      let tools = buildFactoryTools(config, executor, registry);
      let tool = findTool(tools, 'update_project');

      await tool.execute({
        path: 'Project/mvp.json',
        attributes: { projectStatus: 'completed' },
      });

      let body = JSON.parse(ws.read('Project/mvp.json'));
      assert.strictEqual(
        body.data.relationships,
        undefined,
        'no relationships key when none provided and none existed',
      );
    });
  },
);

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

// ---------------------------------------------------------------------------
// add_comment tool
// ---------------------------------------------------------------------------

/**
 * Creates a mock fetch that returns different responses depending on
 * the HTTP method (GET for read, POST for write).
 */
function createReadWriteMockFetch(
  readStatus: number,
  readBody: unknown,
  writeStatus: number,
  writeBody: unknown,
): {
  fetch: typeof globalThis.fetch;
  requests: CapturedRequest[];
} {
  let requests: CapturedRequest[] = [];

  let mockFetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    let url = typeof input === 'string' ? input : input.toString();
    let method = init?.method ?? 'GET';
    let headers: Record<string, string> = {};
    if (init?.headers) {
      let h = init.headers as Record<string, string>;
      for (let [k, v] of Object.entries(h)) {
        headers[k] = v;
      }
    }
    requests.push({
      url,
      method,
      headers,
      body: typeof init?.body === 'string' ? init.body : '',
    });

    let isRead = method === 'GET';
    let status = isRead ? readStatus : writeStatus;
    let body = isRead ? readBody : writeBody;

    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof globalThis.fetch;

  return { fetch: mockFetch, requests };
}

module('factory-tool-builder > add_comment', function () {
  test('add_comment tool is always built (no schema required)', function (assert) {
    let registry = new ToolRegistry();
    let { executor } = createMockToolExecutor(new Map());
    let config = makeConfig({ cardTypeSchemas: undefined });
    let tools = buildFactoryTools(config, executor, registry);
    let toolNames = tools.map((t) => t.name);

    assert.true(
      toolNames.includes('add_comment'),
      'add_comment should be present even without cardTypeSchemas',
    );
  });

  test('add_comment appends a comment to an issue with no existing comments', async function (assert) {
    let existingIssue = {
      data: {
        type: 'card',
        attributes: {
          summary: 'Test issue',
          status: 'in_progress',
        },
        meta: {
          adoptsFrom: {
            module: `${TARGET_REALM}darkfactory`,
            name: 'Issue',
          },
        },
      },
    };

    let registry = new ToolRegistry();
    let { executor } = createMockToolExecutor(new Map());
    let config = makeConfig();
    let ws = workspaceFor(config);
    ws.write('Issues/test-issue.json', JSON.stringify(existingIssue, null, 2));
    let tools = buildFactoryTools(config, executor, registry);
    let tool = findTool(tools, 'add_comment');

    let result = (await tool.execute({
      path: 'Issues/test-issue.json',
      body: 'Starting implementation',
      author: 'factory-agent',
    })) as { ok: boolean };

    assert.true(result.ok);

    let writtenBody = JSON.parse(ws.read('Issues/test-issue.json'));
    assert.strictEqual(writtenBody.data.attributes.summary, 'Test issue');
    assert.strictEqual(writtenBody.data.attributes.status, 'in_progress');
    assert.strictEqual(writtenBody.data.attributes.comments.length, 1);
    assert.strictEqual(
      writtenBody.data.attributes.comments[0].body,
      'Starting implementation',
    );
    assert.strictEqual(
      writtenBody.data.attributes.comments[0].author,
      'factory-agent',
    );
    assert.ok(
      writtenBody.data.attributes.comments[0].datetime,
      'datetime should be set',
    );
    // adoptsFrom is preserved from the original document (read-patch-write)
    assert.strictEqual(writtenBody.data.meta.adoptsFrom.name, 'Issue');
    assert.strictEqual(
      writtenBody.data.meta.adoptsFrom.module,
      `${TARGET_REALM}darkfactory`,
    );
  });

  test('add_comment appends to existing comments without losing them', async function (assert) {
    let existingIssue = {
      data: {
        type: 'card',
        attributes: {
          summary: 'Test issue',
          comments: [
            {
              body: 'First comment',
              author: 'human',
              datetime: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
        meta: {
          adoptsFrom: {
            module: `${TARGET_REALM}darkfactory`,
            name: 'Issue',
          },
        },
      },
    };

    let registry = new ToolRegistry();
    let { executor } = createMockToolExecutor(new Map());
    let config = makeConfig();
    let ws = workspaceFor(config);
    ws.write('Issues/test-issue.json', JSON.stringify(existingIssue, null, 2));
    let tools = buildFactoryTools(config, executor, registry);
    let tool = findTool(tools, 'add_comment');

    let result = (await tool.execute({
      path: 'Issues/test-issue.json',
      body: 'Second comment',
      author: 'factory-agent',
    })) as { ok: boolean };

    assert.true(result.ok);

    let writtenBody = JSON.parse(ws.read('Issues/test-issue.json'));
    assert.strictEqual(
      writtenBody.data.attributes.comments.length,
      2,
      'should have both old and new comments',
    );
    assert.strictEqual(
      writtenBody.data.attributes.comments[0].body,
      'First comment',
    );
    assert.strictEqual(writtenBody.data.attributes.comments[0].author, 'human');
    assert.strictEqual(
      writtenBody.data.attributes.comments[1].body,
      'Second comment',
    );
    assert.strictEqual(
      writtenBody.data.attributes.comments[1].author,
      'factory-agent',
    );
  });

  test('add_comment returns error when issue does not exist', async function (assert) {
    let { fetch: mockFetch } = createReadWriteMockFetch(
      404,
      { errors: [{ detail: 'Not Found' }] },
      200,
      {},
    );
    let registry = new ToolRegistry();
    let { executor } = createMockToolExecutor(new Map());
    let config = makeConfig({ fetch: mockFetch });
    let tools = buildFactoryTools(config, executor, registry);
    let tool = findTool(tools, 'add_comment');

    let result = (await tool.execute({
      path: 'Issues/nonexistent.json',
      body: 'This should fail',
      author: 'factory-agent',
    })) as { ok: boolean; error?: string };

    assert.false(result.ok);
    assert.ok(result.error, 'should contain error message');
    assert.true(
      result.error!.includes('Failed to read issue'),
      `error message should describe the failure: ${result.error}`,
    );
  });

  test('add_comment preserves existing relationships', async function (assert) {
    let existingIssue = {
      data: {
        type: 'card',
        attributes: {
          summary: 'Linked issue',
        },
        relationships: {
          project: {
            links: {
              self: `${TARGET_REALM}Project/mvp`,
            },
          },
        },
        meta: {
          adoptsFrom: {
            module: `${TARGET_REALM}darkfactory`,
            name: 'Issue',
          },
        },
      },
    };

    let registry = new ToolRegistry();
    let { executor } = createMockToolExecutor(new Map());
    let config = makeConfig();
    let ws = workspaceFor(config);
    ws.write('Issues/linked.json', JSON.stringify(existingIssue, null, 2));
    let tools = buildFactoryTools(config, executor, registry);
    let tool = findTool(tools, 'add_comment');

    let result = (await tool.execute({
      path: 'Issues/linked.json',
      body: 'Comment on linked issue',
      author: 'factory-agent',
    })) as { ok: boolean };

    assert.true(result.ok);

    let writtenBody = JSON.parse(ws.read('Issues/linked.json'));
    assert.ok(
      writtenBody.data.relationships,
      'relationships should be preserved',
    );
    assert.ok(
      writtenBody.data.relationships.project,
      'project relationship should be preserved',
    );
  });
});

// run_evaluate tool (in-memory validation)
// ---------------------------------------------------------------------------

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
