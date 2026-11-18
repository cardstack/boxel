import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import fsExtra from 'fs-extra';
const {
  ensureDirSync,
  readFileSync,
  removeSync,
  symlinkSync,
  writeFileSync,
  writeJSONSync,
} = fsExtra;
import { dirSync } from 'tmp';
import { TRANSPILER_PACKAGES } from '@cardstack/runtime-common/transpile';
import {
  SELF_CONTAINED_PACKAGES,
  transpilerIdentity,
  transpilerPackageEntries,
} from '../lib/transpiler-identity.ts';

const runtimeCommonDir = dirname(
  fileURLToPath(import.meta.resolve('@cardstack/runtime-common/package.json')),
);

// A package directory with a manifest and one source file.
function writePackage(
  dir: string,
  name: string,
  opts: {
    version?: string;
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    source?: string;
  } = {},
) {
  ensureDirSync(dir);
  writeJSONSync(join(dir, 'package.json'), {
    name,
    version: opts.version ?? '1.0.0',
    dependencies: opts.dependencies,
    optionalDependencies: opts.optionalDependencies,
  });
  writeFileSync(join(dir, 'index.js'), opts.source ?? `export default 1;`);
}

// Installs a package into a pnpm-style store under `root` and links it into
// `app/node_modules`, as pnpm lays out a package and its dependencies.
function installStorePackage(
  root: string,
  storeName: string,
  name: string,
  dependencies: Record<string, string> = {},
) {
  let dir = join(
    root,
    'node_modules',
    '.pnpm',
    storeName,
    'node_modules',
    name,
  );
  writePackage(dir, name, { dependencies });
  return dir;
}

function linkInto(appDir: string, name: string, target: string) {
  let link = join(appDir, 'node_modules', name);
  ensureDirSync(dirname(link));
  removeSync(link);
  symlinkSync(target, link, 'dir');
}

// Block comments and whole-line `//` comments, which hold examples of imports
// that nothing runs.
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

// The bare specifiers a file loads at run time: static imports other than
// `import type`, and dynamic imports.
function runtimeBareImports(file: string): string[] {
  let source = withoutComments(readFileSync(file, 'utf8'));
  let specifiers = new Set<string>();
  let staticImport = /^import\s+(?!type\b)[^;]*?from\s+['"]([^'"]+)['"]/gms;
  let dynamicImport = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (let pattern of [staticImport, dynamicImport]) {
    for (let match of source.matchAll(pattern)) {
      specifiers.add(match[1]);
    }
  }
  return [...specifiers]
    .filter((specifier) => !specifier.startsWith('.'))
    .map((specifier) => {
      let parts = specifier.split('/');
      return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
    });
}

module(basename(import.meta.filename), function () {
  module('transpilerIdentity', function () {
    test('is the same each time for the same installation', function (assert) {
      let first = transpilerIdentity();
      assert.strictEqual(transpilerIdentity(), first, 'two computations agree');
      assert.true(/^[0-9a-f]{12}$/.test(first), 'and it is short hex');
    });

    test('changes when a package or one it depends on changes', function (assert) {
      let root = dirSync({ unsafeCleanup: true }).name;
      let app = join(root, 'app');
      ensureDirSync(app);
      let plugin = installStorePackage(root, 'plugin@1.0.0', 'plugin', {
        helper: '^1.0.0',
      });
      let helper = installStorePackage(root, 'helper@1.0.0', 'helper');
      // pnpm links a package's dependencies beside it in its store entry.
      linkInto(dirname(dirname(plugin)), 'helper', helper);
      linkInto(app, 'plugin', plugin);

      let entries = transpilerPackageEntries(app, ['plugin']);
      assert.deepEqual(
        entries,
        ['helper helper@1.0.0', 'plugin plugin@1.0.0'],
        'each package is named by its store entry, the dependency included',
      );
      let before = transpilerIdentity({ fromDir: app, packages: ['plugin'] });

      let upgradedHelper = installStorePackage(root, 'helper@1.0.1', 'helper');
      linkInto(dirname(dirname(plugin)), 'helper', upgradedHelper);
      let afterDependency = transpilerIdentity({
        fromDir: app,
        packages: ['plugin'],
      });
      assert.notStrictEqual(
        afterDependency,
        before,
        'upgrading a dependency changes it',
      );

      let patchedPlugin = installStorePackage(
        root,
        'plugin@1.0.0_patch_hash=abc',
        'plugin',
      );
      linkInto(app, 'plugin', patchedPlugin);
      assert.notStrictEqual(
        transpilerIdentity({ fromDir: app, packages: ['plugin'] }),
        afterDependency,
        'patching the package changes it',
      );
    });

    test('names a package linked from outside the store by its files', function (assert) {
      let root = dirSync({ unsafeCleanup: true }).name;
      let app = join(root, 'app');
      let vendored = join(root, 'vendor', 'local-plugin');
      writePackage(vendored, 'local-plugin', { source: 'export default 1;' });
      linkInto(app, 'local-plugin', vendored);

      let before = transpilerIdentity({
        fromDir: app,
        packages: ['local-plugin'],
      });
      writeFileSync(join(vendored, 'index.js'), 'export default 2;');
      assert.notStrictEqual(
        transpilerIdentity({ fromDir: app, packages: ['local-plugin'] }),
        before,
        'editing its source changes it, though its version did not change',
      );
    });

    test('records a dependency that is not installed, and refuses a listed package that is not installed', function (assert) {
      let root = dirSync({ unsafeCleanup: true }).name;
      let app = join(root, 'app');
      let plugin = installStorePackage(root, 'plugin@1.0.0', 'plugin');
      writePackage(plugin, 'plugin', {
        optionalDependencies: { 'native-binding': '^1.0.0' },
      });
      linkInto(app, 'plugin', plugin);

      assert.deepEqual(
        transpilerPackageEntries(app, ['plugin']),
        ['native-binding@not-installed', 'plugin plugin@1.0.0'],
        'the optional dependency is recorded as not installed',
      );
      assert.throws(
        () => transpilerIdentity({ fromDir: app, packages: ['absent'] }),
        /transpiler package absent is not installed/,
        'a transpiler package that is not installed is an error',
      );
    });

    test('lists every package the transpiler loads', function (assert) {
      let files = [
        'transpile.ts',
        'content-tag-loader.ts',
        'loader-plugin.ts',
        'export-identity-plugin.ts',
      ];
      let listed = new Set<string>(TRANSPILER_PACKAGES);
      for (let file of files) {
        for (let name of runtimeBareImports(join(runtimeCommonDir, file))) {
          assert.true(
            listed.has(name),
            `${name}, which ${file} loads, is in TRANSPILER_PACKAGES`,
          );
        }
      }
    });

    test('leaves out only the dependencies of packages whose transpiler code imports nothing', function (assert) {
      assert.deepEqual(
        [...SELF_CONTAINED_PACKAGES],
        ['ember-source'],
        'ember-source is the only package whose dependencies are left out',
      );
      // Found the way transpile.ts finds it.
      let emberSource = dirname(
        createRequire(join(runtimeCommonDir, 'package.json')).resolve(
          'ember-source/package.json',
        ),
      );
      let compiler = withoutComments(
        readFileSync(
          join(
            emberSource,
            'dist',
            'packages',
            'ember-template-compiler',
            'index.js',
          ),
          'utf8',
        ),
      );
      let loads = [
        /^\s*(import|export)\s[^;]*?\sfrom\s+['"]/m,
        /^\s*import\s+['"]/m,
        /\bimport\(\s*['"]/,
        /\brequire\(\s*['"]/,
      ];
      for (let pattern of loads) {
        assert.false(
          pattern.test(compiler),
          `ember-source's template compiler has nothing matching ${pattern}`,
        );
      }
    });
  });
});
