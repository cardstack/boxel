import { module, test } from 'qunit';

import { getToolDefinitions } from '@cardstack/boxel-cli/api';
import { SupportedMimeType } from '@cardstack/runtime-common/supported-mime-type';

import { adaptBoxelTool } from '../src/factory-tool-builder';
import {
  ToolExecutor,
  ToolNotFoundError,
  ToolSafetyError,
  enforceRealmSafety,
  type RealmSafetyConfig,
  type ToolExecutorConfig,
} from '../src/factory-tool-executor';
import type { FactoryTool } from '../src/factory-tool-builder';
import { ToolRegistry } from '../src/factory-tool-registry';
import { createMockClient } from './helpers/mock-client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_TARGET_REALM = 'https://realms.example.test/user/target/';
const TEST_REALM_SERVER = 'https://realms.example.test/';

function makeConfig(
  overrides?: Partial<ToolExecutorConfig> & { fetch?: typeof globalThis.fetch },
): ToolExecutorConfig {
  let { fetch: fetchOverride, client, ...rest } = overrides ?? {};
  return {
    packageRoot: '/fake/software-factory',
    targetRealmUrl: TEST_TARGET_REALM,
    realmServerUrl: TEST_REALM_SERVER,
    client:
      client ??
      createMockClient(fetchOverride ? { fetch: fetchOverride } : undefined),
    ...rest,
  };
}

/**
 * Build a single boxel-cli FactoryTool wrapped with `enforceRealmSafety`,
 * mirroring what `buildFactoryTools` does at runtime. Used by tests that
 * exercise realm-* tools — those tools live in boxel-cli's
 * getToolDefinitions and are never dispatched through the executor.
 */
function buildBoxelFactoryTool(
  toolName: string,
  config: ToolExecutorConfig,
): FactoryTool {
  let safety: RealmSafetyConfig = {
    targetRealmUrl: config.targetRealmUrl,
    sourceRealmUrl: config.sourceRealmUrl,
    allowedRealmPrefixes: config.allowedRealmPrefixes,
  };
  let boxelTools = getToolDefinitions(config.client, {
    targetRealmUrl: config.targetRealmUrl,
    realmServerUrl: config.realmServerUrl ?? TEST_REALM_SERVER,
  });
  let boxelTool = boxelTools.find((t) => t.name === toolName);
  if (!boxelTool) {
    throw new Error(
      `boxel-cli tool "${toolName}" not found in getToolDefinitions`,
    );
  }
  return adaptBoxelTool(boxelTool, safety);
}

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

// ---------------------------------------------------------------------------
// Unregistered tool rejection (executor scope: script + boxel-cli subprocess)
// ---------------------------------------------------------------------------

module('factory-tool-executor > unregistered tool rejection', function () {
  test('rejects invoke_tool with empty tool name', async function (assert) {
    let executor = new ToolExecutor(new ToolRegistry(), makeConfig());

    try {
      await executor.execute('');
      assert.ok(false, 'should have thrown');
    } catch (err) {
      assert.true(err instanceof ToolNotFoundError);
    }
  });

  test('rejects unregistered tool', async function (assert) {
    let executor = new ToolExecutor(new ToolRegistry(), makeConfig());

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
// Argument validation (executor scope: script + boxel-cli subprocess)
// ---------------------------------------------------------------------------

module('factory-tool-executor > argument validation', function () {
  test('rejects missing required arguments', async function (assert) {
    let executor = new ToolExecutor(new ToolRegistry(), makeConfig());

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
// Source / allowed realm protection — script tools (go through the executor)
// ---------------------------------------------------------------------------

module(
  'factory-tool-executor > source realm protection (script tools)',
  function () {
    test('rejects script tool targeting source realm', async function (assert) {
      let executor = new ToolExecutor(
        new ToolRegistry(),
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
      let executor = new ToolExecutor(
        new ToolRegistry(),
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

    test('rejects script tool targeting unknown realm URL', async function (assert) {
      let executor = new ToolExecutor(new ToolRegistry(), makeConfig());

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
  },
);

// ---------------------------------------------------------------------------
// Realm-targeting safety on boxel-cli FactoryTools — applies inside
// `adaptBoxelTool` via the standalone `enforceRealmSafety` function.
// ---------------------------------------------------------------------------

module(
  'factory-tool-executor > realm safety guard on boxel-cli tools',
  function () {
    test('rejects realm_read_file targeting the target realm (workspace-only)', async function (assert) {
      let config = makeConfig();
      let realmRead = buildBoxelFactoryTool('realm_read_file', config);

      try {
        await realmRead.execute({
          'realm-url': TEST_TARGET_REALM,
          path: 'foo.json',
        });
        assert.ok(false, 'should have thrown');
      } catch (err) {
        assert.true(err instanceof ToolSafetyError);
        assert.true(
          (err as Error).message.includes('cannot target the target realm'),
          `error should mention target-realm rejection, got: ${(err as Error).message}`,
        );
      }
    });

    test('rejects realm_write_file targeting the target realm', async function (assert) {
      let config = makeConfig();
      let realmWrite = buildBoxelFactoryTool('realm_write_file', config);

      try {
        await realmWrite.execute({
          'realm-url': TEST_TARGET_REALM,
          path: 'foo.json',
          content: '{}',
        });
        assert.ok(false, 'should have thrown');
      } catch (err) {
        assert.true(err instanceof ToolSafetyError);
      }
    });

    test('rejects realm_delete_file targeting the target realm', async function (assert) {
      let config = makeConfig();
      let realmDelete = buildBoxelFactoryTool('realm_delete_file', config);

      try {
        await realmDelete.execute({
          'realm-url': TEST_TARGET_REALM,
          path: 'foo.json',
        });
        assert.ok(false, 'should have thrown');
      } catch (err) {
        assert.true(err instanceof ToolSafetyError);
      }
    });

    test('allows realm_read_file targeting a scratch realm prefix', async function (assert) {
      let config = makeConfig({
        allowedRealmPrefixes: ['https://realms.example.test/user/scratch-'],
        fetch: createMockFetch(200, { data: { id: 'foo', type: 'card' } }),
      });
      let realmRead = buildBoxelFactoryTool('realm_read_file', config);

      let output = await realmRead.execute({
        'realm-url': 'https://realms.example.test/user/scratch-123/',
        path: 'foo.json',
      });
      // boxel-cli's realm_read_file returns the parsed JSON document on success.
      assert.deepEqual(output, { data: { id: 'foo', type: 'card' } });
    });

    test('rejects realm_search targeting unknown realm', async function (assert) {
      let config = makeConfig({
        sourceRealmUrl: 'https://realms.example.test/user/source/',
      });
      let realmSearch = buildBoxelFactoryTool('realm_search', config);

      try {
        await realmSearch.execute({
          'realm-url': 'https://realms.example.test/other/unrelated/',
          query: '{}',
        });
        assert.ok(false, 'should have thrown');
      } catch (err) {
        assert.true(err instanceof ToolSafetyError);
        assert.true((err as Error).message.includes('not in the allowed list'));
      }
    });

    test('allows realm_search targeting scratch realm via prefix', async function (assert) {
      let config = makeConfig({
        allowedRealmPrefixes: ['https://realms.example.test/user/scratch-'],
        fetch: createMockFetch(200, { data: [] }),
      });
      let realmSearch = buildBoxelFactoryTool('realm_search', config);

      let output = await realmSearch.execute({
        'realm-url': 'https://realms.example.test/user/scratch-123/',
        query: '{}',
      });
      assert.deepEqual(output, { data: [] });
    });

    test('rejects unknown realm even without sourceRealmUrl configured', async function (assert) {
      let config = makeConfig();
      let realmSearch = buildBoxelFactoryTool('realm_search', config);

      try {
        await realmSearch.execute({
          'realm-url': 'https://evil.example.test/hacker/realm/',
          query: '{}',
        });
        assert.ok(false, 'should have thrown');
      } catch (err) {
        assert.true(err instanceof ToolSafetyError);
        assert.true((err as Error).message.includes('not in the allowed list'));
      }
    });
  },
);

// ---------------------------------------------------------------------------
// Standalone enforceRealmSafety — the same function adaptBoxelTool wraps with.
// ---------------------------------------------------------------------------

module('factory-tool-executor > enforceRealmSafety', function () {
  test('passes when realm-url matches target and tool is not bypass-restricted', function (assert) {
    let safety: RealmSafetyConfig = { targetRealmUrl: TEST_TARGET_REALM };
    enforceRealmSafety(
      'realm_search',
      { 'realm-url': TEST_TARGET_REALM, query: '{}' },
      safety,
    );
    assert.ok(true, 'no throw');
  });

  test('throws when bypass-restricted tool targets the target realm', function (assert) {
    let safety: RealmSafetyConfig = { targetRealmUrl: TEST_TARGET_REALM };
    assert.throws(
      () =>
        enforceRealmSafety(
          'realm_read_file',
          { 'realm-url': TEST_TARGET_REALM, path: 'foo.json' },
          safety,
        ),
      ToolSafetyError,
    );
  });

  test('rejects sibling-host URL that string-prefix-matches an allowed prefix', function (assert) {
    let safety: RealmSafetyConfig = {
      targetRealmUrl: TEST_TARGET_REALM,
      allowedRealmPrefixes: ['https://realms.example.test/'],
    };
    assert.throws(
      () =>
        enforceRealmSafety(
          'realm_search',
          {
            'realm-url': 'https://realms.example.test.evil.com/hacker/realm/',
            query: '{}',
          },
          safety,
        ),
      ToolSafetyError,
      'sibling host masquerading as a path prefix should not be allowed',
    );
  });

  test('rejects allowed-prefix exploit where origin differs even if path string starts the same', function (assert) {
    let safety: RealmSafetyConfig = {
      targetRealmUrl: TEST_TARGET_REALM,
      allowedRealmPrefixes: ['https://realms.example.test/user/scratch-'],
    };
    assert.throws(
      () =>
        enforceRealmSafety(
          'realm_search',
          {
            'realm-url': 'https://evil.example.com/user/scratch-123/',
            query: '{}',
          },
          safety,
        ),
      ToolSafetyError,
    );
  });

  test('allows within-origin path prefix matching', function (assert) {
    let safety: RealmSafetyConfig = {
      targetRealmUrl: TEST_TARGET_REALM,
      allowedRealmPrefixes: ['https://realms.example.test/user/scratch-'],
    };
    enforceRealmSafety(
      'realm_search',
      {
        'realm-url': 'https://realms.example.test/user/scratch-123/',
        query: '{}',
      },
      safety,
    );
    assert.ok(true, 'no throw');
  });

  test('throws when realm-url matches the configured source realm', function (assert) {
    let safety: RealmSafetyConfig = {
      targetRealmUrl: TEST_TARGET_REALM,
      sourceRealmUrl: 'https://realms.example.test/user/source/',
    };
    assert.throws(
      () =>
        enforceRealmSafety(
          'realm_search',
          {
            'realm-url': 'https://realms.example.test/user/source/',
            query: '{}',
          },
          safety,
        ),
      ToolSafetyError,
    );
  });
});
