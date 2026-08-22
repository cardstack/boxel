import QUnit from 'qunit';
const { module, test } = QUnit;
import {
  entryFromPackageJson,
  isLiveSpec,
  parseNpmAlias,
  parsePackageJson,
  subpathExports,
  suggestedDependencies,
} from '../src/package-json.ts';

module('package.json: npm suggestion, not the lock', function () {
  test('parses the npm subset and ignores extra keys', function (assert) {
    let pkg = parsePackageJson(`{
      "name": "prosemirror-view",
      "version": "1.42.2",
      "type": "module",
      "license": "MIT",
      "dependencies": {
        "prosemirror-model": "^1.25.8",
        "prosemirror-state": "^1.0.0"
      },
      "devDependencies": { "eslint": "^9.0.0" }
    }`);
    assert.strictEqual(pkg?.name, 'prosemirror-view');
    assert.strictEqual(pkg?.version, '1.42.2');
    assert.deepEqual(suggestedDependencies(pkg!), {
      'prosemirror-model': '^1.25.8',
      'prosemirror-state': '^1.0.0',
    });
    assert.strictEqual(
      (pkg as { license?: string }).license,
      'MIT',
      'extra keys survive on the object; Deck just does not consult them',
    );
  });

  test('peer and optional fill in, and do not override direct deps', function (assert) {
    let pkg = parsePackageJson(`{
      "dependencies": { "zod": "^3.0.0" },
      "peerDependencies": { "react": "^18.0.0", "zod": "^4.0.0" },
      "optionalDependencies": { "fsevents": "^2.0.0" }
    }`);
    assert.deepEqual(suggestedDependencies(pkg!), {
      zod: '^3.0.0',
      react: '^18.0.0',
      fsevents: '^2.0.0',
    });
  });

  test('entry follows exports, then module, then main', function (assert) {
    assert.strictEqual(
      entryFromPackageJson({
        exports: {
          '.': { import: './build/three.module.js', require: './build/three.cjs' },
        },
      }),
      'build/three.module.js',
    );
    assert.strictEqual(
      entryFromPackageJson({
        exports: { import: './dist/index.js', require: './dist/index.cjs' },
      }),
      'dist/index.js',
      'top-level condition map (prosemirror) is not a subpath table',
    );
    assert.strictEqual(
      entryFromPackageJson({ module: './esm/index.js', main: './index.js' }),
      'esm/index.js',
    );
    assert.strictEqual(entryFromPackageJson({ main: 'index.js' }), 'index.js');
  });

  test('subpath exports skip patterns', function (assert) {
    let pkg = parsePackageJson(`{
      "exports": {
        ".": "./index.js",
        "./package.json": "./package.json",
        "./addons/*": "./examples/jsm/*"
      }
    }`);
    assert.deepEqual(subpathExports(pkg!), { 'package.json': 'package.json' });
  });

  test('npm: aliases and workspace/live specs', function (assert) {
    assert.deepEqual(parseNpmAlias('npm:bar@^1.2.0'), {
      name: 'bar',
      range: '^1.2.0',
    });
    assert.deepEqual(parseNpmAlias('npm:@scope/bar@1.0.0'), {
      name: '@scope/bar',
      range: '1.0.0',
    });
    assert.strictEqual(parseNpmAlias('^1.2.0'), undefined);
    assert.true(isLiveSpec('workspace:*'));
    assert.true(isLiveSpec('live'), 'read synonym of workspace:*');
    assert.false(isLiveSpec('workspace:^'), 'pnpm compatible-range is not live');
    assert.false(isLiveSpec('@live'), 'bare @live looks like a scoped name');
    assert.false(isLiveSpec('^1.0.0'));
  });

  test('garbage is undefined, not a throw', function (assert) {
    assert.strictEqual(parsePackageJson('{'), undefined);
    assert.strictEqual(parsePackageJson('[]'), undefined);
    assert.strictEqual(parsePackageJson('null'), undefined);
  });
});
