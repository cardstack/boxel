import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import * as fs from 'fs';
import * as path from 'path';

// CS-10784 SECURITY GUARANTEE
// ---------------------------
// The default `static markdown` fallback on CardDef/FieldDef/FileDef converts
// HTML to markdown via turndown + @joplin/turndown-plugin-gfm. Card code must
// not run on the server, so the converter is bundled only into the host
// (browser) graph and reached from base-realm templates via a `globalThis`
// hook (see `packages/host/app/lib/html-to-markdown.ts`).
//
// This test enforces that boundary: the realm-server source tree, plus the
// runtime packages it loads, must not import `turndown` or its GFM plugin.
// If a future change accidentally pulls turndown into the server graph, this
// test fails — even before any networked behavior is exercised.

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

// Packages whose source code runs in the realm-server Node.js process. If a
// new server-side workspace is added that runs in Node, list it here too.
const SERVER_SIDE_PACKAGES = [
  'realm-server',
  'runtime-common',
  'billing',
  'postgres',
  'local-types',
];

// Files we explicitly skip — these are tests, build outputs, or generated
// artifacts whose content is not part of the runtime graph.
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'tmp',
  '.cache',
  'tests', // test files can mention turndown for documentation/assertions
]);

// We grep for any import or require that names turndown or the GFM plugin.
// `import 'turndown'`, `from 'turndown'`, `from "turndown/foo"`,
// `require('turndown')`, plus the same patterns for the GFM plugin.
const FORBIDDEN_PATTERNS = [
  /from\s+['"]turndown(?:\/[^'"]*)?['"]/,
  /from\s+['"]@joplin\/turndown-plugin-gfm(?:\/[^'"]*)?['"]/,
  /import\s+['"]turndown(?:\/[^'"]*)?['"]/,
  /import\s+['"]@joplin\/turndown-plugin-gfm(?:\/[^'"]*)?['"]/,
  /require\(\s*['"]turndown(?:\/[^'"]*)?['"]\s*\)/,
  /require\(\s*['"]@joplin\/turndown-plugin-gfm(?:\/[^'"]*)?['"]\s*\)/,
];

function* walkSourceFiles(root: string): Iterable<string> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (let entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walkSourceFiles(path.join(root, entry.name));
      continue;
    }
    if (!entry.isFile()) continue;
    // Only inspect TS/JS source — ignore JSON, CSS, etc.
    if (!/\.(ts|tsx|js|mjs|cjs|gts|gjs)$/i.test(entry.name)) continue;
    yield path.join(root, entry.name);
  }
}

function findForbiddenImports(file: string): string | null {
  let contents: string;
  try {
    contents = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  for (let pattern of FORBIDDEN_PATTERNS) {
    let match = contents.match(pattern);
    if (match) {
      return match[0];
    }
  }
  return null;
}

module(basename(import.meta.filename), function () {
  test('realm-server package.json does not declare turndown deps', function (assert) {
    let pkg = JSON.parse(
      fs.readFileSync(
        path.join(REPO_ROOT, 'packages', 'realm-server', 'package.json'),
        'utf8',
      ),
    );
    let allDeps = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
      ...(pkg.peerDependencies ?? {}),
      ...(pkg.optionalDependencies ?? {}),
    };
    assert.notOk(
      'turndown' in allDeps,
      'realm-server must not list turndown as a dependency',
    );
    assert.notOk(
      '@joplin/turndown-plugin-gfm' in allDeps,
      'realm-server must not list @joplin/turndown-plugin-gfm as a dependency',
    );
  });

  for (let pkgName of SERVER_SIDE_PACKAGES) {
    test(`${pkgName} source files do not import turndown`, function (assert) {
      let pkgDir = path.join(REPO_ROOT, 'packages', pkgName);
      let pkgExists = fs.existsSync(pkgDir);
      // Fail loudly if a workspace was renamed/moved rather than silently
      // passing — but keep going so we still surface the import audit when
      // possible.
      assert.ok(pkgExists, `expected package directory at ${pkgDir}`);
      let offenders: string[] = [];
      if (pkgExists) {
        for (let file of walkSourceFiles(pkgDir)) {
          let match = findForbiddenImports(file);
          if (match) {
            offenders.push(`${path.relative(REPO_ROOT, file)}: ${match}`);
          }
        }
      }
      assert.deepEqual(
        offenders,
        [],
        `no source file in ${pkgName} should import turndown — offenders: ${offenders.join(', ')}`,
      );
    });
  }
});
