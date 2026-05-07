import { module, test } from 'qunit';

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
    targetRealm: 'https://realms.example.test/user/target/',
    client:
      client ??
      createMockClient(fetchOverride ? { fetch: fetchOverride } : undefined),
    ...rest,
  };
}

// Valid args for realm-create against the default target realm in makeConfig
// — used as a baseline for safety-rule tests where we mutate one arg at a
// time and expect the executor to reject the result.
function realmCreateArgs(overrides?: Record<string, unknown>) {
  return {
    'realm-server-url': 'https://realms.example.test/',
    name: 'My Realm',
    endpoint: 'my-realm',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Unregistered tool rejection
// ---------------------------------------------------------------------------

module('factory-tool-executor > unregistered tool rejection', function () {
  test('rejects empty tool name', async function (assert) {
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
  test('rejects missing required arguments for realm-create', async function (assert) {
    let registry = new ToolRegistry();
    let executor = new ToolExecutor(registry, makeConfig());

    try {
      await executor.execute('realm-create', {});
      assert.ok(false, 'should have thrown');
    } catch (err) {
      assert.true(err instanceof Error);
      // realm-create requires realm-server-url + name + endpoint;
      // any/all of them missing produces an error message that names
      // them. Pick one to spot-check (the executor reports all
      // missing args but for assertion-rule reasons we test a single
      // membership rather than an OR).
      let message = (err as Error).message;
      assert.true(
        message.includes('realm-server-url'),
        `error message names "realm-server-url": ${message}`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Safety: source realm protection
// ---------------------------------------------------------------------------

module('factory-tool-executor > source realm protection', function () {
  test('rejects tool targeting source realm via realm-server-url', async function (assert) {
    let registry = new ToolRegistry();
    let sourceUrl = 'https://realms.example.test/source/';
    let executor = new ToolExecutor(
      registry,
      makeConfig({ sourceRealm: sourceUrl }),
    );

    try {
      await executor.execute(
        'realm-create',
        realmCreateArgs({ 'realm-server-url': sourceUrl }),
      );
      assert.ok(false, 'should have thrown');
    } catch (err) {
      assert.true(err instanceof ToolSafetyError);
      assert.true((err as Error).message.includes('source realm'));
    }
  });
});

// ---------------------------------------------------------------------------
// Safety: realm-server-url origin allowlist
// ---------------------------------------------------------------------------

module(
  'factory-tool-executor > realm-server-url origin allowlist',
  function () {
    test('rejects realm-server-url whose origin is outside the allowed set', async function (assert) {
      let registry = new ToolRegistry();
      let executor = new ToolExecutor(registry, makeConfig());

      try {
        await executor.execute(
          'realm-create',
          realmCreateArgs({ 'realm-server-url': 'https://evil.example/' }),
        );
        assert.ok(false, 'should have thrown');
      } catch (err) {
        assert.true(err instanceof ToolSafetyError);
        assert.true(
          (err as Error).message.includes('not in the allowed origins'),
        );
      }
    });

    test('accepts realm-server-url that matches the target-realm origin', async function (assert) {
      let registry = new ToolRegistry();
      // The mock client's createRealm returns a fake URL; the executor
      // doesn't fail on that (logs an OK result). What we want here is
      // for the safety check to NOT throw — the call reaches the client.
      let executor = new ToolExecutor(registry, makeConfig());

      let result = await executor.execute('realm-create', realmCreateArgs());
      // realm-create may return an error from the mock client (it doesn't
      // actually create a realm), but the safety check should have passed
      // — i.e., we should reach a ToolResult, not a thrown ToolSafetyError.
      assert.strictEqual(typeof result, 'object', 'returned a ToolResult');
      assert.strictEqual(result.tool, 'realm-create');
    });

    test('accepts realm-server-url that matches an allowed prefix origin', async function (assert) {
      let registry = new ToolRegistry();
      let executor = new ToolExecutor(
        registry,
        makeConfig({
          allowedRealmPrefixes: ['https://scratch.example.test/'],
        }),
      );

      let result = await executor.execute(
        'realm-create',
        realmCreateArgs({
          'realm-server-url': 'https://scratch.example.test/',
        }),
      );
      assert.strictEqual(typeof result, 'object');
    });
  },
);

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

module('factory-tool-executor > logging', function () {
  test('logs each in-flight execution', async function (assert) {
    let registry = new ToolRegistry();
    let entries: ToolExecutionLogEntry[] = [];
    let executor = new ToolExecutor(
      registry,
      makeConfig({
        log: (entry) => entries.push(entry),
      }),
    );

    await executor.execute('realm-create', realmCreateArgs());
    assert.strictEqual(entries.length, 1, 'logged the invocation');
    assert.strictEqual(entries[0].tool, 'realm-create');
    assert.strictEqual(entries[0].category, 'realm-api');
  });

  test('does not log executions rejected by pre-flight checks', async function (assert) {
    // Argument validation, unregistered-tool rejection, source-realm
    // protection, and foreign-origin rejection all throw BEFORE the
    // executor enters its try/catch around executeRealmApi — those are
    // input rejections, not in-flight executions, and the log is
    // reserved for the latter.
    let registry = new ToolRegistry();
    let entries: ToolExecutionLogEntry[] = [];
    let executor = new ToolExecutor(
      registry,
      makeConfig({
        log: (entry) => entries.push(entry),
      }),
    );

    try {
      await executor.execute(
        'realm-create',
        realmCreateArgs({ 'realm-server-url': 'https://evil.example/' }),
      );
    } catch {
      // expected
    }
    assert.deepEqual(entries, [], 'no log entry for safety rejection');
  });
});
