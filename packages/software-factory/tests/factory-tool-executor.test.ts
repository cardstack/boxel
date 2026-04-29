import { module, test } from 'qunit';

import { SupportedMimeType } from '@cardstack/runtime-common/supported-mime-type';

import type { ToolResult } from '../src/factory-agent';
import {
  ToolExecutor,
  ToolNotFoundError,
  ToolSafetyError,
  type ToolExecutionLogEntry,
  type ToolExecutorConfig,
} from '../src/factory-tool-executor';
import { ToolRegistry } from '../src/factory-tool-registry';
import { createMockClient } from './helpers/mock-client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(
  overrides?: Partial<ToolExecutorConfig> & { fetch?: typeof globalThis.fetch },
): ToolExecutorConfig {
  let { fetch: fetchOverride, client, ...rest } = overrides ?? {};
  return {
    packageRoot: '/fake/software-factory',
    targetRealmUrl: 'https://realms.example.test/user/target/',
    client:
      client ??
      createMockClient(fetchOverride ? { fetch: fetchOverride } : undefined),
    ...rest,
  };
}

// ---------------------------------------------------------------------------
// Unregistered tool rejection
// ---------------------------------------------------------------------------

module('factory-tool-executor > unregistered tool rejection', function () {
  test('rejects invoke_tool with empty tool name', async function (assert) {
    let registry = new ToolRegistry();
    let executor = new ToolExecutor(registry, makeConfig());

    try {
      await executor.execute('');
      assert.ok(false, 'should have thrown');
    } catch (err) {
      assert.true(err instanceof ToolNotFoundError);
    }
  });

  test('rejects unregistered tool', async function (assert) {
    let registry = new ToolRegistry();
    let executor = new ToolExecutor(registry, makeConfig());

    try {
      await executor.execute('rm-rf-everything');
      assert.ok(false, 'should have thrown');
    } catch (err) {
      assert.true(err instanceof ToolNotFoundError);
      assert.true((err as Error).message.includes('rm-rf-everything'));
    }
  });
});

// ---------------------------------------------------------------------------
// Argument validation
// ---------------------------------------------------------------------------

module('factory-tool-executor > argument validation', function () {
  test('rejects missing required arguments', async function (assert) {
    let registry = new ToolRegistry();
    let executor = new ToolExecutor(registry, makeConfig());

    try {
      await executor.execute('search-realm', {});
      assert.ok(false, 'should have thrown');
    } catch (err) {
      assert.true(err instanceof Error);
      assert.true((err as Error).message.includes('realm'));
    }
  });
});

// ---------------------------------------------------------------------------
// Safety: source realm protection
// ---------------------------------------------------------------------------

module('factory-tool-executor > source realm protection', function () {
  test('rejects tool targeting source realm', async function (assert) {
    let registry = new ToolRegistry();
    let executor = new ToolExecutor(
      registry,
      makeConfig({
        sourceRealmUrl: 'https://realms.example.test/user/source/',
      }),
    );

    try {
      await executor.execute('search-realm', {
        realm: 'https://realms.example.test/user/source/',
      });
      assert.ok(false, 'should have thrown');
    } catch (err) {
      assert.true(err instanceof ToolSafetyError);
      assert.true((err as Error).message.includes('source realm'));
    }
  });

  test('rejects source realm without trailing slash', async function (assert) {
    let registry = new ToolRegistry();
    let executor = new ToolExecutor(
      registry,
      makeConfig({
        sourceRealmUrl: 'https://realms.example.test/user/source/',
      }),
    );

    try {
      await executor.execute('search-realm', {
        realm: 'https://realms.example.test/user/source',
      });
      assert.ok(false, 'should have thrown');
    } catch (err) {
      assert.true(err instanceof ToolSafetyError);
    }
  });

  test('allows tool targeting target realm', async function (assert) {
    let registry = new ToolRegistry();
    let config = makeConfig({
      sourceRealmUrl: 'https://realms.example.test/user/source/',
      fetch: createMockFetch(200, { data: [] }),
    });
    let executor = new ToolExecutor(registry, config);

    let result = await executor.execute('realm-search', {
      'realm-url': 'https://realms.example.test/user/target/',
      query: JSON.stringify({ filter: { type: { name: 'Issue' } } }),
    });

    assert.strictEqual(result.exitCode, 0);
  });

  test('rejects realm-api tool targeting unknown realm', async function (assert) {
    let registry = new ToolRegistry();
    let executor = new ToolExecutor(
      registry,
      makeConfig({
        sourceRealmUrl: 'https://realms.example.test/user/source/',
      }),
    );

    try {
      await executor.execute('realm-search', {
        'realm-url': 'https://realms.example.test/other/unrelated/',
        query: '{}',
      });
      assert.ok(false, 'should have thrown');
    } catch (err) {
      assert.true(err instanceof ToolSafetyError);
      assert.true((err as Error).message.includes('not in the allowed list'));
    }
  });

  test('allows realm-api tool targeting scratch realm via prefix', async function (assert) {
    let registry = new ToolRegistry();
    let config = makeConfig({
      sourceRealmUrl: 'https://realms.example.test/user/source/',
      allowedRealmPrefixes: ['https://realms.example.test/user/scratch-'],
      fetch: createMockFetch(200, { ok: true }),
    });
    let executor = new ToolExecutor(registry, config);

    let result = await executor.execute('realm-search', {
      'realm-url': 'https://realms.example.test/user/scratch-123/',
      query: '{}',
    });

    assert.strictEqual(result.exitCode, 0);
  });

  test('rejects unknown realm even without sourceRealmUrl configured', async function (assert) {
    let registry = new ToolRegistry();
    let executor = new ToolExecutor(
      registry,
      makeConfig({
        // No sourceRealmUrl — safety should still enforce allowed-realm targeting
      }),
    );

    try {
      await executor.execute('realm-search', {
        'realm-url': 'https://evil.example.test/hacker/realm/',
        query: '{}',
      });
      assert.ok(false, 'should have thrown');
    } catch (err) {
      assert.true(err instanceof ToolSafetyError);
      assert.true((err as Error).message.includes('not in the allowed list'));
    }
  });

  test('rejects script tool targeting unknown realm URL', async function (assert) {
    let registry = new ToolRegistry();
    let executor = new ToolExecutor(registry, makeConfig());

    try {
      await executor.execute('search-realm', {
        realm: 'https://evil.example.test/hacker/realm/',
      });
      assert.ok(false, 'should have thrown');
    } catch (err) {
      assert.true(err instanceof ToolSafetyError);
      assert.true((err as Error).message.includes('not in the allowed list'));
    }
  });
});

// ---------------------------------------------------------------------------
// Realm API execution
// ---------------------------------------------------------------------------

module('factory-tool-executor > realm-api execution', function () {
  test('realm-search makes QUERY request', async function (assert) {
    let capturedMethod: string | undefined;
    let capturedUrl: string | undefined;

    let registry = new ToolRegistry();
    let config = makeConfig({
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input);
        capturedMethod = init?.method;
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { 'Content-Type': SupportedMimeType.JSON },
        });
      }) as typeof globalThis.fetch,
    });
    let executor = new ToolExecutor(registry, config);

    let result = await executor.execute('realm-search', {
      'realm-url': 'https://realms.example.test/user/target/',
      query: JSON.stringify({ filter: { type: { name: 'Issue' } } }),
    });

    assert.strictEqual(capturedMethod, 'QUERY');
    assert.true(capturedUrl!.endsWith('_federated-search'));
    assert.strictEqual(result.exitCode, 0);
  });

  test('non-ok response produces exitCode 1', async function (assert) {
    let registry = new ToolRegistry();
    let config = makeConfig({
      fetch: createMockFetch(404, { error: 'Not found' }),
    });
    let executor = new ToolExecutor(registry, config);

    let result = await executor.execute('realm-search', {
      'realm-url': 'https://realms.example.test/user/target/',
      query: JSON.stringify({ filter: { type: { name: 'Issue' } } }),
    });

    assert.strictEqual(result.exitCode, 1);
    let error = (result.output as Record<string, unknown>).error as string;
    assert.true(error.startsWith('HTTP 404'));
  });
});

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

module('factory-tool-executor > logging', function () {
  test('logs successful tool execution', async function (assert) {
    let logEntries: ToolExecutionLogEntry[] = [];

    let registry = new ToolRegistry();
    let config = makeConfig({
      fetch: createMockFetch(200, { data: [] }),
      log: (entry) => logEntries.push(entry),
    });
    let executor = new ToolExecutor(registry, config);

    await executor.execute('realm-search', {
      'realm-url': 'https://realms.example.test/user/target/',
      query: '{}',
    });

    assert.strictEqual(logEntries.length, 1);
    assert.strictEqual(logEntries[0].tool, 'realm-search');
    assert.strictEqual(logEntries[0].category, 'realm-api');
    assert.strictEqual(logEntries[0].exitCode, 0);
    assert.strictEqual(typeof logEntries[0].durationMs, 'number');
    assert.strictEqual(logEntries[0].error, undefined);
  });

  test('logs failed tool execution', async function (assert) {
    let logEntries: ToolExecutionLogEntry[] = [];

    let registry = new ToolRegistry();
    let config = makeConfig({
      fetch: createMockFetch(500, { error: 'Internal error' }),
      log: (entry) => logEntries.push(entry),
    });
    let executor = new ToolExecutor(registry, config);

    let result = await executor.execute('realm-search', {
      'realm-url': 'https://realms.example.test/user/target/',
      query: '{}',
    });

    assert.strictEqual(result.exitCode, 1);
    assert.strictEqual(logEntries.length, 1);
    assert.strictEqual(logEntries[0].exitCode, 1);
  });
});

// ---------------------------------------------------------------------------
// ToolResult serialization
// ---------------------------------------------------------------------------

module('factory-tool-executor > ToolResult shape', function () {
  test('successful result has expected shape', async function (assert) {
    let registry = new ToolRegistry();
    let config = makeConfig({
      fetch: createMockFetch(200, { cards: ['a', 'b'] }),
    });
    let executor = new ToolExecutor(registry, config);

    let result = await executor.execute('realm-search', {
      'realm-url': 'https://realms.example.test/user/target/',
      query: '{}',
    });

    assert.strictEqual(typeof result.tool, 'string');
    assert.strictEqual(typeof result.exitCode, 'number');
    assert.strictEqual(typeof result.durationMs, 'number');
    assert.notStrictEqual(result.output, undefined, 'output is defined');
  });

  test('ToolResult can be serialized to JSON', async function (assert) {
    let registry = new ToolRegistry();
    let config = makeConfig({
      fetch: createMockFetch(200, { data: [1, 2, 3] }),
    });
    let executor = new ToolExecutor(registry, config);

    let result = await executor.execute('realm-search', {
      'realm-url': 'https://realms.example.test/user/target/',
      query: '{}',
    });

    let serialized = JSON.stringify(result);
    let deserialized = JSON.parse(serialized) as ToolResult;
    assert.strictEqual(deserialized.tool, 'realm-search');
    assert.strictEqual(deserialized.exitCode, 0);
    assert.deepEqual(deserialized.output, { data: [1, 2, 3] });
  });
});

// Timeout enforcement for realm-api calls is now the client's responsibility
// (BoxelCLIClient/ProfileManager own the fetch pipeline), so the executor no
// longer wraps calls in an AbortController. The spawn-based timeout for
// script and boxel-cli tools is covered elsewhere.

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockFetch(
  status: number,
  body: unknown,
): typeof globalThis.fetch {
  return (async () => {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': SupportedMimeType.JSON },
    });
  }) as typeof globalThis.fetch;
}
