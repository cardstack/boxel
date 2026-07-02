import QUnit from 'qunit';
const { module, test } = QUnit;

import {
  getDefaultToolRegistry,
  REALM_API_TOOLS,
  ToolRegistry,
  type ToolManifest,
} from '../src/factory-tool-registry.ts';

// ---------------------------------------------------------------------------
// ToolRegistry construction
// ---------------------------------------------------------------------------

module('factory-tool-registry > ToolRegistry construction', function () {
  test('default registry includes all built-in tools', function (assert) {
    let registry = new ToolRegistry();
    assert.strictEqual(
      registry.size,
      REALM_API_TOOLS.length,
      `registry has ${REALM_API_TOOLS.length} tools`,
    );
  });

  test('accepts custom manifest list', function (assert) {
    let custom: ToolManifest[] = [
      {
        name: 'custom-tool',
        description: 'A test tool',
        category: 'realm-api',
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

  test('throws on duplicate tool names', function (assert) {
    let dupes: ToolManifest[] = [
      {
        name: 'same-name',
        description: 'first',
        category: 'realm-api',
        args: [],
        outputFormat: 'json',
      },
      {
        name: 'same-name',
        description: 'second',
        category: 'realm-api',
        args: [],
        outputFormat: 'json',
      },
    ];
    assert.throws(
      () => new ToolRegistry(dupes),
      (err: Error) =>
        err.message.includes('Duplicate') && err.message.includes('same-name'),
    );
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
    let manifest = registry.getManifest('realm-create');
    assert.ok(manifest, 'manifest is defined');
    assert.strictEqual(manifest!.name, 'realm-create');
    assert.strictEqual(manifest!.category, 'realm-api');
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
    assert.true(registry.has('realm-create'));
  });

  test('returns false for unregistered tool', function (assert) {
    let registry = new ToolRegistry();
    assert.false(registry.has('rm-rf'));
    assert.false(registry.has(''));
  });

  test('previously-registered retired tools are no longer present', function (assert) {
    // Sanity check that the CS-10883 retirements stuck.
    let registry = new ToolRegistry();
    for (let retired of [
      'realm-read',
      'realm-write',
      'realm-delete',
      'realm-search',
      'search-realm',
      'run-realm-tests',
      'boxel-sync',
      'boxel-push',
      'boxel-pull',
      'boxel-status',
      'boxel-create',
      'boxel-history',
    ]) {
      assert.false(registry.has(retired), `${retired} is retired`);
    }
  });
});

// ---------------------------------------------------------------------------
// validateArgs
// ---------------------------------------------------------------------------

module('factory-tool-registry > validateArgs', function () {
  test('returns empty array for valid args', function (assert) {
    let registry = new ToolRegistry();
    let errors = registry.validateArgs('realm-create', {
      'realm-server-url': 'http://example.test/',
      name: 'My Realm',
      endpoint: 'my-realm',
    });
    assert.deepEqual(errors, []);
  });

  test('returns error for missing required arg', function (assert) {
    let registry = new ToolRegistry();
    let errors = registry.validateArgs('realm-create', {
      'realm-server-url': 'http://example.test/',
    });
    // realm-create requires realm-server-url + name + endpoint
    assert.true(
      errors.length >= 2,
      `expected at least 2 errors, got ${errors.length}`,
    );
  });

  test('returns error for unknown tool', function (assert) {
    let registry = new ToolRegistry();
    let errors = registry.validateArgs('nonexistent', {});
    assert.strictEqual(errors.length, 1);
    assert.true(errors[0].includes('Unknown tool'));
  });

  test('multiple missing required args produce multiple errors', function (assert) {
    let registry = new ToolRegistry();
    let errors = registry.validateArgs('realm-create', {});
    assert.true(
      errors.length >= 3,
      `expected at least 3 errors, got ${errors.length}`,
    );
  });

  test('optional args do not produce errors when missing', function (assert) {
    let registry = new ToolRegistry();
    let errors = registry.validateArgs('realm-create', {
      'realm-server-url': 'http://example.test/',
      name: 'My Realm',
      endpoint: 'my-realm',
      // iconURL and backgroundURL are optional
    });
    assert.deepEqual(errors, [], 'no errors for missing optional args');
  });

  test('empty string for required arg produces error', function (assert) {
    let registry = new ToolRegistry();
    let errors = registry.validateArgs('realm-create', {
      'realm-server-url': '',
      name: 'My Realm',
      endpoint: 'my-realm',
    });
    assert.true(errors.some((e) => e.includes('realm-server-url')));
  });

  test('whitespace-only string for required arg produces error', function (assert) {
    let registry = new ToolRegistry();
    let errors = registry.validateArgs('realm-create', {
      'realm-server-url': '   ',
      name: 'My Realm',
      endpoint: 'my-realm',
    });
    assert.true(
      errors.some((e) => e.includes('realm-server-url')),
      'whitespace-only value is rejected',
    );
  });
});

// ---------------------------------------------------------------------------
// Built-in manifest completeness
// ---------------------------------------------------------------------------

module('factory-tool-registry > built-in manifests', function () {
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

  test('realm-create is registered (the only surviving registry tool)', function (assert) {
    let registry = new ToolRegistry();
    assert.true(registry.has('realm-create'));
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
