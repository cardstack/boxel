import { module, test } from 'qunit';

import type { ToolResult } from '../scripts/lib/factory-agent';
import {
  buildFactoryTools,
  DONE_SIGNAL,
  CLARIFICATION_SIGNAL,
  type FactoryTool,
  type ToolBuilderConfig,
  type DoneResult,
  type ClarificationResult,
} from '../scripts/lib/factory-tool-builder';
import type { ToolExecutor } from '../scripts/lib/factory-tool-executor';
import { ToolRegistry } from '../scripts/lib/factory-tool-registry';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TARGET_REALM = 'https://realms.example.test/user/target/';
const TEST_REALM = 'https://realms.example.test/user/target-tests/';
const TARGET_TOKEN = 'Bearer target-jwt-123';
const TEST_TOKEN = 'Bearer test-jwt-456';

function makeConfig(overrides?: Partial<ToolBuilderConfig>): ToolBuilderConfig {
  return {
    targetRealmUrl: TARGET_REALM,
    testRealmUrl: TEST_REALM,
    realmTokens: {
      [TARGET_REALM]: TARGET_TOKEN,
      [TEST_REALM]: TEST_TOKEN,
    },
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
    assert.true(toolNames.includes('update_ticket'));
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

  test('routes .ts file to writeModuleSource', async function (assert) {
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
    // writeModuleSource sends raw content as-is
    assert.strictEqual(requests[0].body, cardJson);
  });
});

// ---------------------------------------------------------------------------
// Realm targeting (target vs test) + JWT auth
// ---------------------------------------------------------------------------

module('factory-tool-builder > realm targeting and auth', function () {
  test('write_file defaults to target realm with target JWT', async function (assert) {
    let { fetch: mockFetch, requests } = createMockFetch(200, {});
    let registry = new ToolRegistry();
    let { executor } = createMockToolExecutor(new Map());
    let config = makeConfig({ fetch: mockFetch });
    let tools = buildFactoryTools(config, executor, registry);
    let writeTool = findTool(tools, 'write_file');

    await writeTool.execute({ path: 'card.gts', content: 'content' });

    assert.strictEqual(requests[0].url, `${TARGET_REALM}card.gts`);
    assert.strictEqual(requests[0].headers['Authorization'], TARGET_TOKEN);
  });

  test('write_file to test realm uses test JWT', async function (assert) {
    let { fetch: mockFetch, requests } = createMockFetch(200, {});
    let registry = new ToolRegistry();
    let { executor } = createMockToolExecutor(new Map());
    let config = makeConfig({ fetch: mockFetch });
    let tools = buildFactoryTools(config, executor, registry);
    let writeTool = findTool(tools, 'write_file');

    await writeTool.execute({
      path: 'Tests/spec.ts',
      content: 'test content',
      realm: 'test',
    });

    assert.strictEqual(requests[0].url, `${TEST_REALM}Tests/spec.ts`);
    assert.strictEqual(requests[0].headers['Authorization'], TEST_TOKEN);
  });

  test('read_file uses correct JWT for target realm', async function (assert) {
    let { fetch: mockFetch, requests } = createMockFetch(200, {
      data: { attributes: {} },
    });
    let registry = new ToolRegistry();
    let { executor } = createMockToolExecutor(new Map());
    let config = makeConfig({ fetch: mockFetch });
    let tools = buildFactoryTools(config, executor, registry);
    let readTool = findTool(tools, 'read_file');

    await readTool.execute({ path: 'card.gts' });

    assert.strictEqual(requests[0].headers['Authorization'], TARGET_TOKEN);
  });

  test('read_file uses correct JWT for test realm', async function (assert) {
    let { fetch: mockFetch, requests } = createMockFetch(200, {
      data: { attributes: {} },
    });
    let registry = new ToolRegistry();
    let { executor } = createMockToolExecutor(new Map());
    let config = makeConfig({ fetch: mockFetch });
    let tools = buildFactoryTools(config, executor, registry);
    let readTool = findTool(tools, 'read_file');

    await readTool.execute({ path: 'Tests/spec.ts', realm: 'test' });

    assert.strictEqual(requests[0].headers['Authorization'], TEST_TOKEN);
  });

  test('update_ticket uses target realm JWT', async function (assert) {
    let { fetch: mockFetch, requests } = createMockFetch(200, {});
    let registry = new ToolRegistry();
    let { executor } = createMockToolExecutor(new Map());
    let config = makeConfig({ fetch: mockFetch });
    let tools = buildFactoryTools(config, executor, registry);
    let updateTool = findTool(tools, 'update_ticket');

    await updateTool.execute({
      path: 'Ticket/1.json',
      content: JSON.stringify({ data: { attributes: { status: 'done' } } }),
    });

    assert.strictEqual(requests[0].headers['Authorization'], TARGET_TOKEN);
    assert.strictEqual(requests[0].url, `${TARGET_REALM}Ticket/1.json`);
  });

  test('create_knowledge uses target realm JWT', async function (assert) {
    let { fetch: mockFetch, requests } = createMockFetch(200, {});
    let registry = new ToolRegistry();
    let { executor } = createMockToolExecutor(new Map());
    let config = makeConfig({ fetch: mockFetch });
    let tools = buildFactoryTools(config, executor, registry);
    let knowledgeTool = findTool(tools, 'create_knowledge');

    await knowledgeTool.execute({
      path: 'Knowledge/deploy.json',
      content: JSON.stringify({ data: { attributes: { title: 'Guide' } } }),
    });

    assert.strictEqual(requests[0].headers['Authorization'], TARGET_TOKEN);
    assert.strictEqual(requests[0].url, `${TARGET_REALM}Knowledge/deploy.json`);
  });

  test('search_realm uses correct JWT for target realm', async function (assert) {
    let { fetch: mockFetch, requests } = createMockFetch(200, { data: [] });
    let registry = new ToolRegistry();
    let { executor } = createMockToolExecutor(new Map());
    let config = makeConfig({ fetch: mockFetch });
    let tools = buildFactoryTools(config, executor, registry);
    let searchTool = findTool(tools, 'search_realm');

    await searchTool.execute({
      query: { filter: { type: { name: 'Ticket' } } },
    });

    assert.strictEqual(requests[0].headers['Authorization'], TARGET_TOKEN);
  });

  test('search_realm uses correct JWT for test realm', async function (assert) {
    let { fetch: mockFetch, requests } = createMockFetch(200, { data: [] });
    let registry = new ToolRegistry();
    let { executor } = createMockToolExecutor(new Map());
    let config = makeConfig({ fetch: mockFetch });
    let tools = buildFactoryTools(config, executor, registry);
    let searchTool = findTool(tools, 'search_realm');

    await searchTool.execute({
      query: { filter: { type: { name: 'TestRun' } } },
      realm: 'test',
    });

    assert.strictEqual(requests[0].headers['Authorization'], TEST_TOKEN);
  });

  test('write_file .json to test realm uses test JWT', async function (assert) {
    let { fetch: mockFetch, requests } = createMockFetch(200, {});
    let registry = new ToolRegistry();
    let { executor } = createMockToolExecutor(new Map());
    let config = makeConfig({ fetch: mockFetch });
    let tools = buildFactoryTools(config, executor, registry);
    let writeTool = findTool(tools, 'write_file');

    let cardJson = JSON.stringify({
      data: { type: 'card', attributes: { name: 'fixture' } },
    });

    await writeTool.execute({
      path: 'Fixtures/card.json',
      content: cardJson,
      realm: 'test',
    });

    assert.strictEqual(requests[0].headers['Authorization'], TEST_TOKEN);
    assert.strictEqual(requests[0].url, `${TEST_REALM}Fixtures/card.json`);
  });

  test('different JWTs for actions targeting different realms', async function (assert) {
    let { fetch: mockFetch, requests } = createMockFetch(200, {});
    let registry = new ToolRegistry();
    let { executor } = createMockToolExecutor(new Map());
    let config = makeConfig({ fetch: mockFetch });
    let tools = buildFactoryTools(config, executor, registry);
    let writeTool = findTool(tools, 'write_file');

    await writeTool.execute({
      path: 'card.gts',
      content: 'content',
      realm: 'target',
    });
    await writeTool.execute({
      path: 'Tests/spec.ts',
      content: 'test',
      realm: 'test',
    });

    assert.strictEqual(requests.length, 2);
    assert.strictEqual(requests[0].headers['Authorization'], TARGET_TOKEN);
    assert.strictEqual(requests[1].headers['Authorization'], TEST_TOKEN);
  });

  test('omits Authorization when token not found for realm', async function (assert) {
    let { fetch: mockFetch, requests } = createMockFetch(200, {});
    let registry = new ToolRegistry();
    let { executor } = createMockToolExecutor(new Map());
    let config = makeConfig({ fetch: mockFetch, realmTokens: {} });
    let tools = buildFactoryTools(config, executor, registry);
    let writeTool = findTool(tools, 'write_file');

    await writeTool.execute({ path: 'card.gts', content: 'content' });

    assert.strictEqual(requests[0].headers['Authorization'], undefined);
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
// Registered tool per-realm JWT resolution
// ---------------------------------------------------------------------------

const SERVER_TOKEN = 'Bearer server-jwt-789';

module('factory-tool-builder > registered tool JWT resolution', function () {
  test('realm-api tool with realm-url gets per-realm JWT for target realm', async function (assert) {
    let toolResult: ToolResult = {
      tool: 'realm-read',
      exitCode: 0,
      output: {},
      durationMs: 5,
    };
    let { executor, calls } = createMockToolExecutor(
      new Map([['realm-read', toolResult]]),
    );
    let registry = new ToolRegistry();
    let config = makeConfig({ serverToken: SERVER_TOKEN });
    let tools = buildFactoryTools(config, executor, registry);
    let realmReadTool = findTool(tools, 'realm-read');

    await realmReadTool.execute({
      'realm-url': TARGET_REALM,
      path: 'card.gts',
    });

    assert.strictEqual(calls.length, 1);
    assert.strictEqual(
      calls[0].authorization,
      TARGET_TOKEN,
      'should use target realm JWT',
    );
  });

  test('realm-api tool with realm-url gets per-realm JWT for test realm', async function (assert) {
    let toolResult: ToolResult = {
      tool: 'realm-read',
      exitCode: 0,
      output: {},
      durationMs: 5,
    };
    let { executor, calls } = createMockToolExecutor(
      new Map([['realm-read', toolResult]]),
    );
    let registry = new ToolRegistry();
    let config = makeConfig({ serverToken: SERVER_TOKEN });
    let tools = buildFactoryTools(config, executor, registry);
    let realmReadTool = findTool(tools, 'realm-read');

    await realmReadTool.execute({
      'realm-url': TEST_REALM,
      path: 'Tests/spec.ts',
    });

    assert.strictEqual(calls.length, 1);
    assert.strictEqual(
      calls[0].authorization,
      TEST_TOKEN,
      'should use test realm JWT',
    );
  });

  test('realm-server-url tools get server JWT instead of per-realm JWT', async function (assert) {
    let toolResult: ToolResult = {
      tool: 'realm-auth',
      exitCode: 0,
      output: { tokens: {} },
      durationMs: 5,
    };
    let { executor, calls } = createMockToolExecutor(
      new Map([['realm-auth', toolResult]]),
    );
    let registry = new ToolRegistry();
    let config = makeConfig({ serverToken: SERVER_TOKEN });
    let tools = buildFactoryTools(config, executor, registry);
    let realmAuthTool = findTool(tools, 'realm-auth');

    await realmAuthTool.execute({
      'realm-server-url': 'https://realms.example.test/',
    });

    assert.strictEqual(calls.length, 1);
    assert.strictEqual(
      calls[0].authorization,
      SERVER_TOKEN,
      'should use server JWT for realm-server-url tools',
    );
  });

  test('realm-create gets server JWT', async function (assert) {
    let toolResult: ToolResult = {
      tool: 'realm-create',
      exitCode: 0,
      output: { data: { id: 'https://realms.example.test/new/' } },
      durationMs: 10,
    };
    let { executor, calls } = createMockToolExecutor(
      new Map([['realm-create', toolResult]]),
    );
    let registry = new ToolRegistry();
    let config = makeConfig({ serverToken: SERVER_TOKEN });
    let tools = buildFactoryTools(config, executor, registry);
    let realmCreateTool = findTool(tools, 'realm-create');

    await realmCreateTool.execute({
      'realm-server-url': 'https://realms.example.test/',
      name: 'New Realm',
      endpoint: 'new-realm',
    });

    assert.strictEqual(calls.length, 1);
    assert.strictEqual(
      calls[0].authorization,
      SERVER_TOKEN,
      'should use server JWT for realm-create',
    );
  });

  test('script tools do not get per-realm JWT override', async function (assert) {
    let toolResult: ToolResult = {
      tool: 'search-realm',
      exitCode: 0,
      output: {},
      durationMs: 5,
    };
    let { executor, calls } = createMockToolExecutor(
      new Map([['search-realm', toolResult]]),
    );
    let registry = new ToolRegistry();
    let config = makeConfig({ serverToken: SERVER_TOKEN });
    let tools = buildFactoryTools(config, executor, registry);
    let searchRealmTool = findTool(tools, 'search-realm');

    await searchRealmTool.execute({ realm: TARGET_REALM });

    assert.strictEqual(calls.length, 1);
    assert.strictEqual(
      calls[0].authorization,
      undefined,
      'script tools should not get auth override — they handle auth internally',
    );
  });

  test('realm-api tool with unknown realm URL gets no auth override', async function (assert) {
    let toolResult: ToolResult = {
      tool: 'realm-read',
      exitCode: 0,
      output: {},
      durationMs: 5,
    };
    let { executor, calls } = createMockToolExecutor(
      new Map([['realm-read', toolResult]]),
    );
    let registry = new ToolRegistry();
    let config = makeConfig({ serverToken: SERVER_TOKEN });
    let tools = buildFactoryTools(config, executor, registry);
    let realmReadTool = findTool(tools, 'realm-read');

    await realmReadTool.execute({
      'realm-url': 'https://unknown.example.test/realm/',
      path: 'file.gts',
    });

    assert.strictEqual(calls.length, 1);
    assert.strictEqual(
      calls[0].authorization,
      undefined,
      'unknown realm URL should not get auth override',
    );
  });
});

// ---------------------------------------------------------------------------
// Card write validation
// ---------------------------------------------------------------------------

module('factory-tool-builder > card write validation', function () {
  test('update_ticket fails with invalid JSON content', async function (assert) {
    let { fetch: mockFetch } = createMockFetch(200, {});
    let registry = new ToolRegistry();
    let { executor } = createMockToolExecutor(new Map());
    let config = makeConfig({ fetch: mockFetch });
    let tools = buildFactoryTools(config, executor, registry);
    let updateTool = findTool(tools, 'update_ticket');

    let result = (await updateTool.execute({
      path: 'Ticket/1.json',
      content: 'not json',
    })) as { ok: boolean; error: string };

    assert.false(result.ok);
    assert.true(result.error.includes('Failed to parse'));
  });

  test('create_knowledge fails with invalid JSON content', async function (assert) {
    let { fetch: mockFetch } = createMockFetch(200, {});
    let registry = new ToolRegistry();
    let { executor } = createMockToolExecutor(new Map());
    let config = makeConfig({ fetch: mockFetch });
    let tools = buildFactoryTools(config, executor, registry);
    let knowledgeTool = findTool(tools, 'create_knowledge');

    let result = (await knowledgeTool.execute({
      path: 'Knowledge/x.json',
      content: 'not json',
    })) as { ok: boolean; error: string };

    assert.false(result.ok);
    assert.true(result.error.includes('Failed to parse'));
  });
});
