import QUnit from 'qunit';
const { module, test } = QUnit;
import { readdirSync, readFileSync, statSync } from 'fs';
import { basename, join, relative } from 'path';
import { fileURLToPath } from 'url';

// The catalog test subset manifest names the boxel tests that consume it, and
// boxel-catalog's CI runs exactly those against any catalog change to a subset
// file. A consumer missing from the list would never run there, so a catalog
// merge could break it unseen. These tests hold the list to the tests that
// call `setupCatalogTestSubset`, in both directions.
const REPO_ROOT = join(fileURLToPath(import.meta.url), '..', '..', '..', '..');
const HOST_TESTS = join(REPO_ROOT, 'packages/host/tests');
const REALM_SERVER_TESTS = join(REPO_ROOT, 'packages/realm-server/tests');
const CALLER_RE = /\bsetupCatalogTestSubset\(\s*hooks\b/;
const MODULE_RE = /\bmodule\(\s*(['"`])((?:(?!\1).)+)\1/;

interface Manifest {
  tests?: { host?: string[]; realmServer?: string[] };
}

function manifest(): Manifest {
  return JSON.parse(
    readFileSync(join(REPO_ROOT, 'packages/catalog/test-subset.json'), 'utf8'),
  );
}

function testFiles(dir: string): string[] {
  let files: string[] = [];
  for (let entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'helpers') {
      continue;
    }
    let path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      files.push(...testFiles(path));
    } else if (/\.(ts|gts)$/.test(entry)) {
      files.push(path);
    }
  }
  return files;
}

function callers(dir: string) {
  return testFiles(dir).filter((file) =>
    CALLER_RE.test(readFileSync(file, 'utf8')),
  );
}

module(basename(import.meta.filename), function () {
  test('every realm-server consumer is listed, and every listed file consumes the subset', function (assert) {
    let listed = manifest().tests?.realmServer ?? [];
    let found = callers(REALM_SERVER_TESTS).map((file) =>
      relative(REALM_SERVER_TESTS, file).replace(/\.ts$/, ''),
    );
    assert.deepEqual(
      [...found].sort(),
      [...listed].sort(),
      'tests.realmServer in packages/catalog/test-subset.json names exactly the realm-server test files that call setupCatalogTestSubset',
    );
  });

  test('every host consumer module matches a listed filter, and every filter matches a consumer', function (assert) {
    let filters = manifest().tests?.host ?? [];
    let moduleNames = callers(HOST_TESTS).map((file) => {
      let name = readFileSync(file, 'utf8').match(MODULE_RE)?.[2];
      return { file: relative(REPO_ROOT, file), name };
    });
    assert.true(
      moduleNames.length > 0,
      'at least one host test calls setupCatalogTestSubset',
    );
    for (let { file, name } of moduleNames) {
      assert.strictEqual(
        typeof name,
        'string',
        `${file} declares its module with a string literal name`,
      );
      // ember test --filter matches a case-insensitive substring of the
      // module and test name.
      let lower = (name ?? '').toLowerCase();
      assert.true(
        filters.some((f) => lower.includes(f.toLowerCase())),
        `${file} (module "${name}") is matched by a tests.host filter in packages/catalog/test-subset.json`,
      );
    }
    for (let filter of filters) {
      assert.true(
        moduleNames.some(({ name }) =>
          name?.toLowerCase().includes(filter.toLowerCase()),
        ),
        `tests.host filter "${filter}" matches a host module that calls setupCatalogTestSubset`,
      );
    }
  });
});
