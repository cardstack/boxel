import { module, test } from 'qunit';

import {
  BOXEL_CLI_TOOLS,
  getDefaultToolRegistry,
  REALM_API_TOOLS,
  SCRIPT_TOOLS,
  ToolRegistry,
  type ToolManifest,
} from '../scripts/lib/factory-tool-registry';

// ---------------------------------------------------------------------------
// ToolRegistry construction
// ---------------------------------------------------------------------------

module('factory-tool-registry > ToolRegistry construction', function () {
  test('default registry includes all built-in tools', function (assert) {
    let registry = new ToolRegistry();
    let expectedCount =
      SCRIPT_TOOLS.length + BOXEL_CLI_TOOLS.length + REALM_API_TOOLS.length;
    assert.strictEqual(
      registry.size,
      expectedCount,
      `registry has ${expectedCount} tools`,
    );
  });

  test('accepts custom manifest list', function (assert) {
    let custom: ToolManifest[] = [
      {
        name: 'custom-tool',
        description: 'A test tool',
        category: 'script',
        args: [],
        outputFormat: 'json',
      },
    ];
    let registry = new ToolRegistry(custom);
    assert.strictEqual(registry.size, 1);
    assert.true(registry.has('custom-tool'));
  });

  test('empty manifest list creates empty registry', function (assert) {
    let registry = new ToolRegistry([]);
    assert.strictEqual(registry.size, 0);
  });
});

// ---------------------------------------------------------------------------
// getManifests
// ---------------------------------------------------------------------------

module('factory-tool-registry > getManifests', function () {
  test('returns all manifests', function (assert) {
    let registry = new ToolRegistry();
    let manifests = registry.getManifests();
    assert.true(manifests.length > 0, 'returns non-empty array');
    assert.true(Array.isArray(manifests), 'returns an array');
  });

  test('returned array is a copy (not internal state)', function (assert) {
    let registry = new ToolRegistry();
    let a = registry.getManifests();
    let b = registry.getManifests();
    assert.notStrictEqual(a, b, 'different array instances');
    assert.deepEqual(a, b, 'same contents');
  });
});

// ---------------------------------------------------------------------------
// getManifest
// ---------------------------------------------------------------------------

module('factory-tool-registry > getManifest', function () {
  test('returns manifest for known tool', function (assert) {
    let registry = new ToolRegistry();
    let manifest = registry.getManifest('search-realm');
    assert.ok(manifest, 'manifest is defined');
    assert.strictEqual(manifest!.name, 'search-realm');
    assert.strictEqual(manifest!.category, 'script');
  });

  test('returns undefined for unknown tool', function (assert) {
    let registry = new ToolRegistry();
    assert.strictEqual(registry.getManifest('nonexistent'), undefined);
  });
});

// ---------------------------------------------------------------------------
// has
// ---------------------------------------------------------------------------

module('factory-tool-registry > has', function () {
  test('returns true for registered tool', function (assert) {
    let registry = new ToolRegistry();
    assert.true(registry.has('search-realm'));
    assert.true(registry.has('boxel-sync'));
    assert.true(registry.has('realm-read'));
  });

  test('returns false for unregistered tool', function (assert) {
    let registry = new ToolRegistry();
    assert.false(registry.has('rm-rf'));
    assert.false(registry.has(''));
  });
});

// ---------------------------------------------------------------------------
// validateArgs
// ---------------------------------------------------------------------------

module('factory-tool-registry > validateArgs', function () {
  test('returns empty array for valid args', function (assert) {
    let registry = new ToolRegistry();
    let errors = registry.validateArgs('search-realm', {
      realm: 'http://example.test/',
    });
    assert.deepEqual(errors, []);
  });

  test('returns error for missing required arg', function (assert) {
    let registry = new ToolRegistry();
    let errors = registry.validateArgs('search-realm', {});
    assert.strictEqual(errors.length, 1);
    assert.true(errors[0].includes('realm'));
  });

  test('returns error for unknown tool', function (assert) {
    let registry = new ToolRegistry();
    let errors = registry.validateArgs('nonexistent', {});
    assert.strictEqual(errors.length, 1);
    assert.true(errors[0].includes('Unknown tool'));
  });

  test('multiple missing required args produce multiple errors', function (assert) {
    let registry = new ToolRegistry();
    let errors = registry.validateArgs('realm-write', {});
    assert.true(
      errors.length >= 3,
      `expected at least 3 errors, got ${errors.length}`,
    );
  });

  test('optional args do not produce errors when missing', function (assert) {
    let registry = new ToolRegistry();
    let errors = registry.validateArgs('search-realm', {
      realm: 'http://example.test/',
    });
    assert.deepEqual(errors, [], 'no errors for missing optional args');
  });

  test('empty string for required arg produces error', function (assert) {
    let registry = new ToolRegistry();
    let errors = registry.validateArgs('search-realm', { realm: '' });
    assert.strictEqual(errors.length, 1);
  });
});

// ---------------------------------------------------------------------------
// Built-in manifest completeness
// ---------------------------------------------------------------------------

module('factory-tool-registry > built-in manifests', function () {
  test('all script tools have correct category', function (assert) {
    for (let tool of SCRIPT_TOOLS) {
      assert.strictEqual(
        tool.category,
        'script',
        `${tool.name} has category "script"`,
      );
    }
  });

  test('all boxel-cli tools have correct category', function (assert) {
    for (let tool of BOXEL_CLI_TOOLS) {
      assert.strictEqual(
        tool.category,
        'boxel-cli',
        `${tool.name} has category "boxel-cli"`,
      );
    }
  });

  test('all realm-api tools have correct category', function (assert) {
    for (let tool of REALM_API_TOOLS) {
      assert.strictEqual(
        tool.category,
        'realm-api',
        `${tool.name} has category "realm-api"`,
      );
    }
  });

  test('all tools have unique names', function (assert) {
    let registry = new ToolRegistry();
    let manifests = registry.getManifests();
    let names = manifests.map((m) => m.name);
    let unique = new Set(names);
    assert.strictEqual(unique.size, names.length, 'all tool names are unique');
  });

  test('all tools have non-empty description', function (assert) {
    let registry = new ToolRegistry();
    for (let manifest of registry.getManifests()) {
      assert.true(
        manifest.description.length > 0,
        `${manifest.name} has a description`,
      );
    }
  });

  test('all tool args have required fields', function (assert) {
    let registry = new ToolRegistry();
    for (let manifest of registry.getManifests()) {
      for (let arg of manifest.args) {
        assert.true(arg.name.length > 0, `${manifest.name} arg has a name`);
        assert.true(
          arg.type.length > 0,
          `${manifest.name}:${arg.name} has a type`,
        );
        assert.true(
          arg.description.length > 0,
          `${manifest.name}:${arg.name} has a description`,
        );
        assert.strictEqual(
          typeof arg.required,
          'boolean',
          `${manifest.name}:${arg.name} has required flag`,
        );
      }
    }
  });

  test('expected script tools are registered', function (assert) {
    let registry = new ToolRegistry();
    assert.true(registry.has('search-realm'));
    assert.true(registry.has('pick-ticket'));
    assert.true(registry.has('get-session'));
    assert.true(registry.has('run-realm-tests'));
  });

  test('expected boxel-cli tools are registered', function (assert) {
    let registry = new ToolRegistry();
    assert.true(registry.has('boxel-sync'));
    assert.true(registry.has('boxel-push'));
    assert.true(registry.has('boxel-pull'));
    assert.true(registry.has('boxel-status'));
    assert.true(registry.has('boxel-create'));
    assert.true(registry.has('boxel-history'));
  });

  test('expected realm-api tools are registered', function (assert) {
    let registry = new ToolRegistry();
    assert.true(registry.has('realm-read'));
    assert.true(registry.has('realm-write'));
    assert.true(registry.has('realm-delete'));
    assert.true(registry.has('realm-atomic'));
    assert.true(registry.has('realm-search'));
    assert.true(registry.has('realm-mtimes'));
    assert.true(registry.has('realm-create'));
    assert.true(registry.has('realm-server-session'));
    assert.true(registry.has('realm-reindex'));
  });
});

// ---------------------------------------------------------------------------
// getDefaultToolRegistry
// ---------------------------------------------------------------------------

module('factory-tool-registry > getDefaultToolRegistry', function () {
  test('returns a ToolRegistry instance', function (assert) {
    let registry = getDefaultToolRegistry();
    assert.true(registry instanceof ToolRegistry);
  });

  test('returns the same instance on repeated calls', function (assert) {
    let a = getDefaultToolRegistry();
    let b = getDefaultToolRegistry();
    assert.strictEqual(a, b, 'same singleton instance');
  });
});
