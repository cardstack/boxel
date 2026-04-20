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
]);

function makeConfig(
  overrides?: Partial<ToolBuilderConfig> & { fetch?: typeof globalThis.fetch },
): ToolBuilderConfig {
  let { fetch: fetchOverride, client, ...rest } = overrides ?? {};
  return {
    targetRealmUrl: TARGET_REALM,
    darkfactoryModuleUrl:
      'https://realms.example.test/software-factory/darkfactory',
    realmServerUrl: 'https://realms.example.test/',
    client:
      client ??
      createMockClient(fetchOverride ? { fetch: fetchOverride } : undefined),
    cardTypeSchemas: DEFAULT_CARD_TYPE_SCHEMAS,
    ...rest,
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

module('factory-tool-builder > realm targeting', function () {
  test('write_file defaults to target realm', async function (assert) {
    let { fetch: mockFetch, requests } = createMockFetch(200, {});
    let registry = new ToolRegistry();
    let { executor } = createMockToolExecutor(new Map());
    let config = makeConfig({ fetch: mockFetch });
    let tools = buildFactoryTools(config, executor, registry);
    let writeTool = findTool(tools, 'write_file');

    await writeTool.execute({ path: 'card.gts', content: 'content' });

    assert.strictEqual(requests[0].url, `${TARGET_REALM}card.gts`);
  });

  test('read_file targets target realm', async function (assert) {
    let { fetch: mockFetch, requests } = createMockFetch(200, {
      data: { attributes: {} },
    });
    let registry = new ToolRegistry();
    let { executor } = createMockToolExecutor(new Map());
    let config = makeConfig({ fetch: mockFetch });
    let tools = buildFactoryTools(config, executor, registry);
    let readTool = findTool(tools, 'read_file');

    await readTool.execute({ path: 'card.gts' });

    assert.strictEqual(requests[0].url, `${TARGET_REALM}card.gts`);
  });

  test('update_issue targets target realm', async function (assert) {
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
    let { fetch: mockFetch, requests } = createMockFetch(200, {}, existingDoc);
    let registry = new ToolRegistry();
    let { executor } = createMockToolExecutor(new Map());
    let config = makeConfig({ fetch: mockFetch });
    let tools = buildFactoryTools(config, executor, registry);
    let updateTool = findTool(tools, 'update_issue');

    await updateTool.execute({
      path: 'Issues/1.json',
      attributes: { status: 'blocked' },
    });

    // First request is GET (read), second is POST (write)
    let writeRequest = requests.find((r) => r.method === 'POST')!;
    assert.strictEqual(writeRequest.url, `${TARGET_REALM}Issues/1.json`);
  });

  test('create_knowledge targets target realm', async function (assert) {
    let { fetch: mockFetch, requests } = createMockFetch(200, {});
    let registry = new ToolRegistry();
    let { executor } = createMockToolExecutor(new Map());
    let config = makeConfig({ fetch: mockFetch });
    let tools = buildFactoryTools(config, executor, registry);
    let knowledgeTool = findTool(tools, 'create_knowledge');

    await knowledgeTool.execute({
      path: 'Knowledge/deploy.json',
      attributes: { articleTitle: 'Guide' },
    });

    assert.strictEqual(requests[0].url, `${TARGET_REALM}Knowledge/deploy.json`);
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
      let { fetch: mockFetch, requests } = createMockFetch(
        200,
        {},
        existingIssue,
      );
      let registry = new ToolRegistry();
      let { executor } = createMockToolExecutor(new Map());
      let config = makeConfig({ fetch: mockFetch });
      let tools = buildFactoryTools(config, executor, registry);
      let tool = findTool(tools, 'update_issue');

      await tool.execute({
        path: 'Issues/1.json',
        attributes: { status: 'blocked', summary: 'Updated summary' },
      });

      let writeRequest = requests.find((r) => r.method === 'POST')!;
      let body = JSON.parse(writeRequest.body);
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
      let { fetch: mockFetch, requests } = createMockFetch(
        200,
        {},
        existingIssue,
      );
      let registry = new ToolRegistry();
      let { executor } = createMockToolExecutor(new Map());
      let config = makeConfig({ fetch: mockFetch });
      let tools = buildFactoryTools(config, executor, registry);
      let tool = findTool(tools, 'update_issue');

      await tool.execute({
        path: 'Issues/1.json',
        attributes: { status: 'done', summary: 'Build sticky note' },
      });

      let writeRequest = requests.find((r) => r.method === 'POST')!;
      let body = JSON.parse(writeRequest.body);
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
      let { fetch: mockFetch, requests } = createMockFetch(
        200,
        {},
        existingIssue,
      );
      let registry = new ToolRegistry();
      let { executor } = createMockToolExecutor(new Map());
      let config = makeConfig({ fetch: mockFetch });
      let tools = buildFactoryTools(config, executor, registry);
      let tool = findTool(tools, 'update_issue');

      await tool.execute({
        path: 'Issues/1.json',
        attributes: { status: 'blocked', summary: 'Stuck' },
      });
      let writeRequests = requests.filter((r) => r.method === 'POST');
      let body1 = JSON.parse(writeRequests[0].body);
      assert.strictEqual(
        body1.data.attributes.status,
        'blocked',
        'blocked is allowed',
      );

      await tool.execute({
        path: 'Issues/1.json',
        attributes: { status: 'backlog', summary: 'Unblocked' },
      });
      writeRequests = requests.filter((r) => r.method === 'POST');
      let body2 = JSON.parse(writeRequests[1].body);
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
      let { fetch: mockFetch, requests } = createMockFetch(
        200,
        {},
        existingIssue,
      );
      let registry = new ToolRegistry();
      let { executor } = createMockToolExecutor(new Map());
      let config = makeConfig({ fetch: mockFetch });
      let tools = buildFactoryTools(config, executor, registry);
      let tool = findTool(tools, 'update_issue');

      await tool.execute({
        path: 'Issues/1.json',
        attributes: { description: 'Overwritten!', status: 'blocked' },
      });
      let writeRequest = requests.find((r) => r.method === 'POST')!;
      let body = JSON.parse(writeRequest.body);
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
      let { fetch: mockFetch, requests } = createMockFetch(
        200,
        {},
        existingProject,
      );
      let registry = new ToolRegistry();
      let { executor } = createMockToolExecutor(new Map());
      let config = makeConfig({ fetch: mockFetch });
      let tools = buildFactoryTools(config, executor, registry);
      let tool = findTool(tools, 'update_project');

      await tool.execute({
        path: 'Project/mvp.json',
        attributes: { projectStatus: 'completed' },
      });

      let writeRequest = requests.find((r) => r.method === 'POST')!;
      let body = JSON.parse(writeRequest.body);
      assert.strictEqual(
        body.data.relationships,
        undefined,
        'no relationships key when none provided and none existed',
      );
    });
  },
);

// Note: run_tests is no longer exposed as an agent tool — the validation
// pipeline runs tests automatically via executeTestRunFromRealm after
// each agent turn. The former buildRunTestsTool implementation has been
// removed and is no longer part of buildFactoryTools.

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

    let { fetch: mockFetch, requests } = createReadWriteMockFetch(
      200,
      existingIssue,
      200,
      {},
    );
    let registry = new ToolRegistry();
    let { executor } = createMockToolExecutor(new Map());
    let config = makeConfig({ fetch: mockFetch });
    let tools = buildFactoryTools(config, executor, registry);
    let tool = findTool(tools, 'add_comment');

    let result = (await tool.execute({
      path: 'Issues/test-issue.json',
      body: 'Starting implementation',
      author: 'factory-agent',
    })) as { ok: boolean };

    assert.true(result.ok);
    assert.strictEqual(requests.length, 2, 'one read + one write');
    assert.strictEqual(requests[0].method, 'GET');
    assert.strictEqual(requests[1].method, 'POST');

    let writtenBody = JSON.parse(requests[1].body);
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

    let { fetch: mockFetch, requests } = createReadWriteMockFetch(
      200,
      existingIssue,
      200,
      {},
    );
    let registry = new ToolRegistry();
    let { executor } = createMockToolExecutor(new Map());
    let config = makeConfig({ fetch: mockFetch });
    let tools = buildFactoryTools(config, executor, registry);
    let tool = findTool(tools, 'add_comment');

    let result = (await tool.execute({
      path: 'Issues/test-issue.json',
      body: 'Second comment',
      author: 'factory-agent',
    })) as { ok: boolean };

    assert.true(result.ok);

    let writtenBody = JSON.parse(requests[1].body);
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

    let { fetch: mockFetch, requests } = createReadWriteMockFetch(
      200,
      existingIssue,
      200,
      {},
    );
    let registry = new ToolRegistry();
    let { executor } = createMockToolExecutor(new Map());
    let config = makeConfig({ fetch: mockFetch });
    let tools = buildFactoryTools(config, executor, registry);
    let tool = findTool(tools, 'add_comment');

    let result = (await tool.execute({
      path: 'Issues/linked.json',
      body: 'Comment on linked issue',
      author: 'factory-agent',
    })) as { ok: boolean };

    assert.true(result.ok);

    let writtenBody = JSON.parse(requests[1].body);
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
