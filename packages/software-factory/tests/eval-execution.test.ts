import { module, test } from 'qunit';

import type { BoxelCLIClient } from '@cardstack/boxel-cli/api';

import {
  discoverEvaluableFiles,
  runEvaluateInMemory,
} from '../src/eval-execution';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function stubClient(filenames: string[]): BoxelCLIClient {
  return {
    listFiles: async () => ({ filenames }),
  } as unknown as BoxelCLIClient;
}

function stubClientAlwaysThrows(): BoxelCLIClient {
  return {
    listFiles: async () => {
      throw new Error('should not reach listFiles');
    },
    runCommand: async () => {
      throw new Error('should not reach runCommand');
    },
  } as unknown as BoxelCLIClient;
}

// ---------------------------------------------------------------------------
// discoverEvaluableFiles — filter and dedupe behavior
// ---------------------------------------------------------------------------

module('discoverEvaluableFiles', function () {
  test('excludes .test.* and .spec.* test-runner files', async function (assert) {
    let files = await discoverEvaluableFiles({
      targetRealm: 'https://example.test/realm/',
      client: stubClient([
        'hello.gts',
        'hello.test.gts',
        'hello.spec.ts',
        'login.spec.gts',
        'utils.ts',
      ]),
    });

    assert.deepEqual(
      files.sort(),
      ['hello.gts', 'utils.ts'],
      'test and spec files are filtered out; production sources remain',
    );
  });

  test('excludes .d.ts ambient declaration files', async function (assert) {
    let files = await discoverEvaluableFiles({
      targetRealm: 'https://example.test/realm/',
      client: stubClient([
        'app.ts',
        'globals.d.ts',
        'ui/components.d.ts',
        'ui/button.gts',
      ]),
    });

    assert.deepEqual(files.sort(), ['app.ts', 'ui/button.gts']);
  });

  test('dedupes same-basename files by extension precedence (.gts > .gjs > .ts > .js)', async function (assert) {
    let files = await discoverEvaluableFiles({
      targetRealm: 'https://example.test/realm/',
      client: stubClient([
        'foo.js',
        'foo.ts',
        'foo.gjs',
        'foo.gts',
        'bar.js',
        'bar.gjs',
      ]),
    });

    assert.deepEqual(
      files.sort(),
      ['bar.gjs', 'foo.gts'],
      '.gts wins over .gjs/.ts/.js; .gjs wins over .js',
    );
  });

  test('ignores non-ESM filenames entirely', async function (assert) {
    let files = await discoverEvaluableFiles({
      targetRealm: 'https://example.test/realm/',
      client: stubClient([
        'Cards/my-card.json',
        'index.json',
        'realm.json',
        'README.md',
        'hello.gts',
      ]),
    });

    assert.deepEqual(files, ['hello.gts']);
  });
});

// ---------------------------------------------------------------------------
// runEvaluateInMemory — path validation short-circuits (no realm call)
// ---------------------------------------------------------------------------

module('runEvaluateInMemory path validation', function () {
  test('rejects absolute "/..." paths without calling the realm', async function (assert) {
    let result = await runEvaluateInMemory({
      targetRealm: 'https://example.test/realm/',
      realmServerUrl: 'https://example.test/',
      client: stubClientAlwaysThrows(),
      path: '/escape.gts',
    });
    assert.strictEqual(result.status, 'error');
    assert.ok(
      result.errorMessage?.includes('must be realm-relative'),
      'rejects leading "/"',
    );
  });

  test('rejects ".." traversal segments without calling the realm', async function (assert) {
    let result = await runEvaluateInMemory({
      targetRealm: 'https://example.test/realm/',
      realmServerUrl: 'https://example.test/',
      client: stubClientAlwaysThrows(),
      path: '../other-realm/foo.gts',
    });
    assert.strictEqual(result.status, 'error');
    assert.ok(result.errorMessage?.includes('".."'), 'rejects ".." segments');
  });

  test('rejects ".." segments nested inside the path', async function (assert) {
    let result = await runEvaluateInMemory({
      targetRealm: 'https://example.test/realm/',
      realmServerUrl: 'https://example.test/',
      client: stubClientAlwaysThrows(),
      path: 'Cards/../../escape.gts',
    });
    assert.strictEqual(result.status, 'error');
    assert.ok(result.errorMessage?.includes('".."'));
  });

  test('rejects absolute URLs with a scheme', async function (assert) {
    let result = await runEvaluateInMemory({
      targetRealm: 'https://example.test/realm/',
      realmServerUrl: 'https://example.test/',
      client: stubClientAlwaysThrows(),
      path: 'https://malicious.test/foo.gts',
    });
    assert.strictEqual(result.status, 'error');
    assert.ok(
      result.errorMessage?.includes('absolute URLs'),
      'rejects URL-scheme paths',
    );
  });

  test('rejects .d.ts ambient declaration paths', async function (assert) {
    let result = await runEvaluateInMemory({
      targetRealm: 'https://example.test/realm/',
      realmServerUrl: 'https://example.test/',
      client: stubClientAlwaysThrows(),
      path: 'types/globals.d.ts',
    });
    assert.strictEqual(result.status, 'error');
    assert.ok(result.errorMessage?.includes('ambient declaration'));
  });

  test('rejects .spec.ts paths (test-runner source files)', async function (assert) {
    let result = await runEvaluateInMemory({
      targetRealm: 'https://example.test/realm/',
      realmServerUrl: 'https://example.test/',
      client: stubClientAlwaysThrows(),
      path: 'login.spec.ts',
    });
    assert.strictEqual(result.status, 'error');
    assert.ok(result.errorMessage?.includes('test file'));
  });
});
