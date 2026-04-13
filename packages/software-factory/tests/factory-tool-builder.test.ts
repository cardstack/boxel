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
import type {
  ExecuteTestRunOptions,
  TestRunHandle,
} from '../src/test-run-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TARGET_REALM = 'https://realms.example.test/user/target/';
const TEST_REALM = 'https://realms.example.test/user/target-tests/';
void TEST_REALM;

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
]);

function makeConfig(overrides?: Partial<ToolBuilderConfig>): ToolBuilderConfig {
  return {
    targetRealmUrl: TARGET_REALM,
    realmServerUrl: 'https://realms.example.test/',
    cardTypeSchemas: DEFAULT_CARD_TYPE_SCHEMAS,
    ...overrides,
  };
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
    requests.push({
      url,
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : '',
    });
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
  authorization?: string;
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
      options?: { authorization?: string },
    ): Promise<ToolResult> => {
      calls.push({
        toolName: toolName as string,
        toolArgs: toolArgs as Record<string, unknown>,
        authorization: options?.authorization,
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
    assert.true(toolNames.includes('create_knowledge'));
    assert.true(toolNames.includes('signal_done'));
    assert.true(toolNames.includes('request_clarification'));
    // Script tools from registry
    assert.true(toolNames.includes('search-realm'));
    // Realm-api tools from registry
    assert.true(toolNames.includes('realm-read'));
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
  test('writes .gts file with raw text body', async function (assert) {
    let { fetch: mockFetch, requests } = createMockFetch(200, {});
    let registry = new ToolRegistry();
    let { executor } = createMockToolExecutor(new Map());
    let config = makeConfig({ fetch: mockFetch });
    let tools = buildFactoryTools(config, executor, registry);
    let writeTool = findTool(tools, 'write_file');

    let result = (await writeTool.execute({
      path: 'my-card.gts',
      content: 'export default class MyCard {}',
    })) as { ok: boolean };

    assert.true(result.ok);
    assert.strictEqual(requests.length, 1);
    assert.strictEqual(requests[0].url, `${TARGET_REALM}my-card.gts`);
    assert.strictEqual(requests[0].method, 'POST');
    assert.strictEqual(requests[0].body, 'export default class MyCard {}');
  });

  test('routes .ts file to writeFile', async function (assert) {
    let { fetch: mockFetch, requests } = createMockFetch(200, {});
    let registry = new ToolRegistry();
    let { executor } = createMockToolExecutor(new Map());
    let config = makeConfig({ fetch: mockFetch });
    let tools = buildFactoryTools(config, executor, registry);
    let writeTool = findTool(tools, 'write_file');

    let result = (await writeTool.execute({
      path: 'utils/helpers.ts',
      content: 'export function helper() {}',
    })) as { ok: boolean };

    assert.true(result.ok);
    assert.strictEqual(requests[0].url, `${TARGET_REALM}utils/helpers.ts`);
    assert.strictEqual(requests[0].body, 'export function helper() {}');
  });

  test('writes .json file as raw content (no JSON parsing)', async function (assert) {
    let { fetch: mockFetch, requests } = createMockFetch(200, {});
    let registry = new ToolRegistry();
    let { executor } = createMockToolExecutor(new Map());
    let config = makeConfig({ fetch: mockFetch });
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
    assert.strictEqual(requests[0].url, `${TARGET_REALM}Card/1.json`);
    assert.strictEqual(requests[0].method, 'POST');
    // writeFile sends raw content as-is
    assert.strictEqual(requests[0].body, cardJson);
  });
});

// ---------------------------------------------------------------------------
// Realm targeting (target vs test) + JWT auth
// ---------------------------------------------------------------------------

// 'realm targeting and auth' tests removed in CS-10642. They asserted that
// the tool builder looks up per-realm JWTs from a `realmTokens` map and
// inserts them into outbound headers — both of which are now boxel-cli's
// concern (createRealmFetch wraps fetch with auth before reaching this
// layer). Tools see only an already-auth'd fetch.

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
      tool: 'search-realm',
      exitCode: 0,
      output: { data: [{ id: '1' }] },
      durationMs: 42,
    };
    let { executor } = createMockToolExecutor(
      new Map([['search-realm', toolResult]]),
    );
    let registry = new ToolRegistry();
    let config = makeConfig();
    let tools = buildFactoryTools(config, executor, registry);
    let searchRealmTool = findTool(tools, 'search-realm');

    let result = (await searchRealmTool.execute({
      realm: TARGET_REALM,
    })) as ToolResult;

    assert.strictEqual(result.tool, 'search-realm');
    assert.strictEqual(result.exitCode, 0);
    assert.deepEqual(result.output, { data: [{ id: '1' }] });
  });
});

// 'registered tool JWT resolution' tests removed in CS-10642 — the tool
// builder no longer resolves per-realm or server JWTs (boxel-cli's
// createRealmFetch / createServerFetch own that). The realm-create,
// realm-server-session, and realm-auth tools were also removed from the
// executor's realm-api dispatcher.

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

    test('update_issue assembles JSON:API document from attributes', async function (assert) {
      let { fetch: mockFetch, requests } = createMockFetch(200, {});
      let registry = new ToolRegistry();
      let { executor } = createMockToolExecutor(new Map());
      let config = makeConfig({ fetch: mockFetch });
      let tools = buildFactoryTools(config, executor, registry);
      let tool = findTool(tools, 'update_issue');

      await tool.execute({
        path: 'Issues/1.json',
        attributes: { status: 'done', summary: 'Build sticky note' },
      });

      assert.strictEqual(requests.length, 1);
      let body = JSON.parse(requests[0].body);
      assert.strictEqual(body.data.type, 'card');
      assert.strictEqual(body.data.attributes.status, 'done');
      assert.strictEqual(body.data.meta.adoptsFrom.name, 'Issue');
      assert.strictEqual(
        body.data.meta.adoptsFrom.module,
        `${TARGET_REALM}darkfactory`,
      );
    });

    test('card tools omit empty relationships from document', async function (assert) {
      let { fetch: mockFetch, requests } = createMockFetch(200, {});
      let registry = new ToolRegistry();
      let { executor } = createMockToolExecutor(new Map());
      let config = makeConfig({ fetch: mockFetch });
      let tools = buildFactoryTools(config, executor, registry);
      let tool = findTool(tools, 'update_project');

      await tool.execute({
        path: 'Project/mvp.json',
        attributes: { projectStatus: 'completed' },
      });

      let body = JSON.parse(requests[0].body);
      assert.strictEqual(
        body.data.relationships,
        undefined,
        'no relationships key when none provided',
      );
    });
  },
);

// ---------------------------------------------------------------------------
// run_tests tool
// ---------------------------------------------------------------------------

module('factory-tool-builder > run_tests', function () {
  test('run_tests tool is built and has correct parameters', function (assert) {
    let registry = new ToolRegistry();
    let { executor } = createMockToolExecutor(new Map());
    let config = makeConfig();
    let tools = buildFactoryTools(config, executor, registry);
    let runTestsTool = findTool(tools, 'run_tests');

    assert.strictEqual(runTestsTool.name, 'run_tests');
    let params = runTestsTool.parameters as {
      required?: string[];
      properties?: Record<string, unknown>;
    };
    assert.true(params.required!.includes('slug'));
    assert.true('testNames' in params.properties!);
    assert.true('projectCardUrl' in params.properties!);
  });

  test('run_tests passes correct options to executeTestRun', async function (assert) {
    let capturedOptions: ExecuteTestRunOptions | undefined;
    let mockHandle: TestRunHandle = {
      testRunId: 'TestRun/run-1',
      status: 'passed',
    };

    let registry = new ToolRegistry();
    let { executor } = createMockToolExecutor(new Map());
    let config = makeConfig({
      testResultsModuleUrl:
        'https://realms.example.test/user/target/test-results',
      executeTestRun: async (options: ExecuteTestRunOptions) => {
        capturedOptions = options;
        return mockHandle;
      },
    });
    let tools = buildFactoryTools(config, executor, registry);
    let runTestsTool = findTool(tools, 'run_tests');

    let result = await runTestsTool.execute({
      slug: 'define-sticky-note',
      testNames: ['renders fitted view'],
      projectCardUrl: 'https://realms.example.test/user/target/Project/mvp',
    });

    assert.ok(capturedOptions, 'executeTestRun was called');
    assert.strictEqual(capturedOptions!.targetRealmUrl, TARGET_REALM);
    assert.strictEqual(
      capturedOptions!.testResultsModuleUrl,
      'https://realms.example.test/user/target/test-results',
    );
    assert.strictEqual(capturedOptions!.slug, 'define-sticky-note');
    assert.deepEqual(capturedOptions!.testNames, ['renders fitted view']);
    assert.strictEqual(
      capturedOptions!.projectCardUrl,
      'https://realms.example.test/user/target/Project/mvp',
    );

    // Verify the result is passed through
    let handle = result as TestRunHandle;
    assert.strictEqual(handle.testRunId, 'TestRun/run-1');
    assert.strictEqual(handle.status, 'passed');
  });

  test('run_tests uses default testResultsModuleUrl when not configured', async function (assert) {
    let capturedOptions: ExecuteTestRunOptions | undefined;

    let registry = new ToolRegistry();
    let { executor } = createMockToolExecutor(new Map());
    let config = makeConfig({
      executeTestRun: async (options: ExecuteTestRunOptions) => {
        capturedOptions = options;
        return { testRunId: 'TestRun/run-1', status: 'passed' as const };
      },
    });
    let tools = buildFactoryTools(config, executor, registry);
    let runTestsTool = findTool(tools, 'run_tests');

    await runTestsTool.execute({
      slug: 'test-slug',
    });

    assert.strictEqual(
      capturedOptions!.testResultsModuleUrl,
      `${TARGET_REALM}test-results`,
    );
  });

  // 'run_tests uses target realm JWT for authorization' removed in
  // CS-10642 — the tool builder no longer threads JWTs (the run_tests
  // call passes config.fetch through; auth is the fetch wrapper's job).
});
