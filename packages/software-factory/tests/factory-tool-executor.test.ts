import { module, test } from 'qunit';

import { SupportedMimeType } from '@cardstack/runtime-common/supported-mime-type';

import type { ToolResult } from '../src/factory-agent';
import {
  ToolExecutor,
  ToolNotFoundError,
  ToolSafetyError,
  ToolTimeoutError,
  type ToolExecutionLogEntry,
  type ToolExecutorConfig,
} from '../src/factory-tool-executor';
import { ToolRegistry } from '../src/factory-tool-registry';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(
  overrides?: Partial<ToolExecutorConfig>,
): ToolExecutorConfig {
  return {
    packageRoot: '/fake/software-factory',
    targetRealmUrl: 'https://realms.example.test/user/target/',
    ...overrides,
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

    let result = await executor.execute('realm-read', {
      'realm-url': 'https://realms.example.test/user/target/',
      path: 'CardDef/my-card.gts',
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
      await executor.execute('realm-read', {
        'realm-url': 'https://realms.example.test/other/unrelated/',
        path: 'foo.json',
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

    let result = await executor.execute('realm-read', {
      'realm-url': 'https://realms.example.test/user/scratch-123/',
      path: 'foo.json',
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
      await executor.execute('realm-read', {
        'realm-url': 'https://evil.example.test/hacker/realm/',
        path: 'secrets.json',
      });
      assert.ok(false, 'should have thrown');
    } catch (err) {
      assert.true(err instanceof ToolSafetyError);
      assert.true((err as Error).message.includes('not in the allowed list'));
    }
  });

  test('rejects realm-server-url targeting unknown origin', async function (assert) {
    let registry = new ToolRegistry();
    let executor = new ToolExecutor(registry, makeConfig());

    try {
      await executor.execute('realm-server-session', {
        'realm-server-url': 'https://evil.example.test/',
        'openid-token': 'token',
      });
      assert.ok(false, 'should have thrown');
    } catch (err) {
      assert.true(err instanceof ToolSafetyError);
      assert.true(
        (err as Error).message.includes('not in the allowed origins'),
      );
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
  test('realm-read makes GET request', async function (assert) {
    let capturedUrl: string | undefined;
    let capturedMethod: string | undefined;

    let registry = new ToolRegistry();
    let config = makeConfig({
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input);
        capturedMethod = init?.method;
        return new Response(JSON.stringify({ card: 'data' }), {
          status: 200,
          headers: { 'Content-Type': SupportedMimeType.JSON },
        });
      }) as typeof globalThis.fetch,
    });
    let executor = new ToolExecutor(registry, config);

    let result = await executor.execute('realm-read', {
      'realm-url': 'https://realms.example.test/user/target/',
      path: 'CardDef/my-card.gts',
    });

    assert.strictEqual(capturedMethod, 'GET');
    assert.strictEqual(
      capturedUrl,
      'https://realms.example.test/user/target/CardDef/my-card.gts',
    );
    assert.strictEqual(result.exitCode, 0);
    assert.deepEqual(result.output, { card: 'data' });
    assert.strictEqual(result.tool, 'realm-read');
    assert.strictEqual(typeof result.durationMs, 'number');
  });

  test('realm-write makes POST request', async function (assert) {
    let capturedUrl: string | undefined;
    let capturedMethod: string | undefined;
    let capturedBody: string | undefined;

    let registry = new ToolRegistry();
    let config = makeConfig({
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input);
        capturedMethod = init?.method;
        capturedBody = typeof init?.body === 'string' ? init.body : undefined;
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': SupportedMimeType.JSON },
        });
      }) as typeof globalThis.fetch,
    });
    let executor = new ToolExecutor(registry, config);

    let result = await executor.execute('realm-write', {
      'realm-url': 'https://realms.example.test/user/target/',
      path: 'CardDef/new-card.gts',
      content: 'export class NewCard {}',
    });

    assert.strictEqual(capturedMethod, 'POST');
    assert.strictEqual(
      capturedUrl,
      'https://realms.example.test/user/target/CardDef/new-card.gts',
    );
    assert.strictEqual(capturedBody, 'export class NewCard {}');
    assert.strictEqual(result.exitCode, 0);
  });

  test('realm-delete makes DELETE request', async function (assert) {
    let capturedMethod: string | undefined;

    let registry = new ToolRegistry();
    let config = makeConfig({
      fetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedMethod = init?.method;
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': SupportedMimeType.JSON },
        });
      }) as typeof globalThis.fetch,
    });
    let executor = new ToolExecutor(registry, config);

    let result = await executor.execute('realm-delete', {
      'realm-url': 'https://realms.example.test/user/target/',
      path: 'CardDef/old-card.gts',
    });

    assert.strictEqual(capturedMethod, 'DELETE');
    assert.strictEqual(result.exitCode, 0);
  });

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
    assert.true(capturedUrl!.endsWith('_search'));
    assert.strictEqual(result.exitCode, 0);
  });

  test('non-ok response produces exitCode 1', async function (assert) {
    let registry = new ToolRegistry();
    let config = makeConfig({
      fetch: createMockFetch(404, { error: 'Not found' }),
    });
    let executor = new ToolExecutor(registry, config);

    let result = await executor.execute('realm-read', {
      'realm-url': 'https://realms.example.test/user/target/',
      path: 'missing.json',
    });

    assert.strictEqual(result.exitCode, 1);
    let error = (result.output as Record<string, unknown>).error as string;
    assert.true(error.startsWith('HTTP 404'));
  });

  test('includes authorization header when configured', async function (assert) {
    let capturedHeaders: Headers | undefined;

    let registry = new ToolRegistry();
    let config = makeConfig({
      authorization: 'Bearer test-token-123',
      fetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedHeaders = new Headers(init?.headers as HeadersInit);
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'Content-Type': SupportedMimeType.JSON },
        });
      }) as typeof globalThis.fetch,
    });
    let executor = new ToolExecutor(registry, config);

    await executor.execute('realm-read', {
      'realm-url': 'https://realms.example.test/user/target/',
      path: 'foo.json',
    });

    assert.strictEqual(
      capturedHeaders!.get('Authorization'),
      'Bearer test-token-123',
    );
  });

  test('realm-auth makes POST to _realm-auth', async function (assert) {
    let capturedUrl: string | undefined;
    let capturedMethod: string | undefined;

    let registry = new ToolRegistry();
    let config = makeConfig({
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input);
        capturedMethod = init?.method;
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': SupportedMimeType.JSON },
        });
      }) as typeof globalThis.fetch,
    });
    let executor = new ToolExecutor(registry, config);

    let result = await executor.execute('realm-auth', {
      'realm-server-url': 'https://realms.example.test/user/target/',
    });

    assert.strictEqual(capturedMethod, 'POST');
    assert.true(capturedUrl!.endsWith('_realm-auth'));
    assert.strictEqual(result.exitCode, 0);
  });

  test('realm-server-session sends OpenID token and captures Authorization header', async function (assert) {
    let capturedUrl: string | undefined;
    let capturedBody: string | undefined;

    let registry = new ToolRegistry();
    let config = makeConfig({
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input);
        capturedBody = typeof init?.body === 'string' ? init.body : undefined;
        return new Response(null, {
          status: 201,
          headers: {
            'Content-Type': SupportedMimeType.JSON,
            Authorization: 'Bearer realm-server-jwt-123',
          },
        });
      }) as typeof globalThis.fetch,
    });
    let executor = new ToolExecutor(registry, config);

    let result = await executor.execute('realm-server-session', {
      'realm-server-url': 'https://realms.example.test/user/target/',
      'openid-token': 'openid-access-token-xyz',
    });

    assert.true(capturedUrl!.endsWith('_server-session'));
    let body = JSON.parse(capturedBody!);
    assert.strictEqual(
      body.access_token,
      'openid-access-token-xyz',
      'sends OpenID token in request body',
    );
    assert.strictEqual(result.exitCode, 0);
    assert.deepEqual(
      result.output,
      { token: 'Bearer realm-server-jwt-123' },
      'captures Authorization header in output',
    );
  });
});

// ---------------------------------------------------------------------------
// Auth header propagation
// ---------------------------------------------------------------------------

module('factory-tool-executor > auth header propagation', function () {
  function createHeaderCapturingFetch(): {
    fetch: typeof globalThis.fetch;
    getCapturedHeaders: () => Headers | undefined;
  } {
    let capturedHeaders: Headers | undefined;
    return {
      fetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedHeaders = new Headers(init?.headers as HeadersInit);
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': SupportedMimeType.JSON },
        });
      }) as typeof globalThis.fetch,
      getCapturedHeaders: () => capturedHeaders,
    };
  }

  test('realm-read sends realm JWT in Authorization header', async function (assert) {
    let { fetch, getCapturedHeaders } = createHeaderCapturingFetch();
    let registry = new ToolRegistry();
    let executor = new ToolExecutor(
      registry,
      makeConfig({ authorization: 'Bearer realm-jwt-abc', fetch }),
    );

    await executor.execute('realm-read', {
      'realm-url': 'https://realms.example.test/user/target/',
      path: 'Card/foo.json',
    });

    assert.strictEqual(
      getCapturedHeaders()!.get('Authorization'),
      'Bearer realm-jwt-abc',
    );
  });

  test('realm-write sends realm JWT in Authorization header', async function (assert) {
    let { fetch, getCapturedHeaders } = createHeaderCapturingFetch();
    let registry = new ToolRegistry();
    let executor = new ToolExecutor(
      registry,
      makeConfig({ authorization: 'Bearer realm-jwt-abc', fetch }),
    );

    await executor.execute('realm-write', {
      'realm-url': 'https://realms.example.test/user/target/',
      path: 'Card/new.gts',
      content: 'export class NewCard {}',
    });

    assert.strictEqual(
      getCapturedHeaders()!.get('Authorization'),
      'Bearer realm-jwt-abc',
    );
  });

  test('realm-delete sends realm JWT in Authorization header', async function (assert) {
    let { fetch, getCapturedHeaders } = createHeaderCapturingFetch();
    let registry = new ToolRegistry();
    let executor = new ToolExecutor(
      registry,
      makeConfig({ authorization: 'Bearer realm-jwt-abc', fetch }),
    );

    await executor.execute('realm-delete', {
      'realm-url': 'https://realms.example.test/user/target/',
      path: 'Card/old.json',
    });

    assert.strictEqual(
      getCapturedHeaders()!.get('Authorization'),
      'Bearer realm-jwt-abc',
    );
  });

  test('realm-search sends realm JWT in Authorization header', async function (assert) {
    let { fetch, getCapturedHeaders } = createHeaderCapturingFetch();
    let registry = new ToolRegistry();
    let executor = new ToolExecutor(
      registry,
      makeConfig({ authorization: 'Bearer realm-jwt-abc', fetch }),
    );

    await executor.execute('realm-search', {
      'realm-url': 'https://realms.example.test/user/target/',
      query: '{}',
    });

    assert.strictEqual(
      getCapturedHeaders()!.get('Authorization'),
      'Bearer realm-jwt-abc',
    );
  });

  test('realm-auth sends server JWT in Authorization header', async function (assert) {
    let { fetch, getCapturedHeaders } = createHeaderCapturingFetch();
    let registry = new ToolRegistry();
    let executor = new ToolExecutor(
      registry,
      makeConfig({ authorization: 'Bearer realm-jwt-abc', fetch }),
    );

    await executor.execute('realm-auth', {
      'realm-server-url': 'https://realms.example.test/user/target/',
    });

    assert.strictEqual(
      getCapturedHeaders()!.get('Authorization'),
      'Bearer realm-jwt-abc',
    );
  });

  test('no Authorization header when authorization is not configured', async function (assert) {
    let { fetch, getCapturedHeaders } = createHeaderCapturingFetch();
    let registry = new ToolRegistry();
    let executor = new ToolExecutor(
      registry,
      makeConfig({ fetch }), // no authorization
    );

    await executor.execute('realm-read', {
      'realm-url': 'https://realms.example.test/user/target/',
      path: 'Card/foo.json',
    });

    assert.strictEqual(
      getCapturedHeaders()!.get('Authorization'),
      null,
      'no Authorization header sent',
    );
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

    await executor.execute('realm-read', {
      'realm-url': 'https://realms.example.test/user/target/',
      path: 'foo.json',
    });

    assert.strictEqual(logEntries.length, 1);
    assert.strictEqual(logEntries[0].tool, 'realm-read');
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

    let result = await executor.execute('realm-read', {
      'realm-url': 'https://realms.example.test/user/target/',
      path: 'broken.json',
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

    let result = await executor.execute('realm-read', {
      'realm-url': 'https://realms.example.test/user/target/',
      path: 'foo.json',
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

    let result = await executor.execute('realm-read', {
      'realm-url': 'https://realms.example.test/user/target/',
      path: 'foo.json',
    });

    let serialized = JSON.stringify(result);
    let deserialized = JSON.parse(serialized) as ToolResult;
    assert.strictEqual(deserialized.tool, 'realm-read');
    assert.strictEqual(deserialized.exitCode, 0);
    assert.deepEqual(deserialized.output, { data: [1, 2, 3] });
  });
});

// ---------------------------------------------------------------------------
// Timeout behavior
// ---------------------------------------------------------------------------

module('factory-tool-executor > timeout', function () {
  test('realm-api call times out with ToolTimeoutError', async function (assert) {
    let registry = new ToolRegistry();
    let config = makeConfig({
      timeoutMs: 50,
      fetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        // Respect the AbortSignal so the timeout mechanism works
        return new Promise<Response>((resolve, reject) => {
          let signal = init?.signal;
          if (signal) {
            signal.addEventListener('abort', () => {
              reject(
                new DOMException('The operation was aborted.', 'AbortError'),
              );
            });
          }
          // Never resolves on its own within timeout
          setTimeout(
            () =>
              resolve(
                new Response('{}', {
                  status: 200,
                  headers: { 'Content-Type': SupportedMimeType.JSON },
                }),
              ),
            5000,
          );
        });
      }) as typeof globalThis.fetch,
    });
    let executor = new ToolExecutor(registry, config);

    try {
      await executor.execute('realm-read', {
        'realm-url': 'https://realms.example.test/user/target/',
        path: 'slow.json',
      });
      assert.ok(false, 'should have thrown');
    } catch (err) {
      assert.true(err instanceof ToolTimeoutError);
      assert.true((err as Error).message.includes('50ms'));
    }
  });
});

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
