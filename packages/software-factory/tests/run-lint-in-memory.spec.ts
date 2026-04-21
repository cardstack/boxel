import { resolve } from 'node:path';

import type { BoxelCLIClient } from '@cardstack/boxel-cli/api';

import { expect, test } from './fixtures';

import { runLintInMemory } from '../src/lint-execution';
import { BAD_LINT_GTS } from './helpers/lint-test-fixtures';
import { buildTestClient } from './helpers/test-client';

const fixtureRealmDir = resolve(
  process.cwd(),
  'test-fixtures',
  'test-realm-runner',
);

test.use({ realmDir: fixtureRealmDir });
test.use({ realmServerMode: 'isolated' });

test.describe('runLintInMemory e2e', () => {
  test('clean realm returns status: passed with no realm artifacts', async ({
    realm,
  }) => {
    let realmUrl = realm.realmURL.href;
    let authorization = realm.authorizationHeaders()['Authorization'];
    let serverToken = `Bearer ${realm.serverToken}`;

    let { client, cleanup } = buildTestClient({
      realmUrl,
      realmToken: authorization,
      realmServerUrl: realm.realmServerURL.href,
      realmServerToken: serverToken,
    });

    try {
      // The fixture realm ships with a clean hello.gts and hello.test.gts.
      let result = await runLintInMemory({
        targetRealmUrl: realmUrl,
        client,
      });

      expect(result.status).toBe('passed');
      expect(result.errorCount).toBe(0);
      expect(result.filesChecked).toBeGreaterThan(0);
      expect(result.filesWithErrors).toBe(0);
      expect(result.lintableFiles).toContain('hello.gts');
      expect(result.violations.filter((v) => v.severity === 'error')).toEqual(
        [],
      );
      expect(result.errorMessage).toBeUndefined();

      // In-memory tool must not write any LintResult card artifact.
      let listing = await client.listFiles(realmUrl);
      let validationArtifacts = (listing.filenames ?? []).filter((f) =>
        f.startsWith('Validations/lint_'),
      );
      expect(validationArtifacts).toEqual([]);
    } finally {
      cleanup();
    }
  });

  test('dirty file produces status: failed with violation details and no realm artifacts', async ({
    realm,
  }) => {
    let realmUrl = realm.realmURL.href;
    let authorization = realm.authorizationHeaders()['Authorization'];
    let serverToken = `Bearer ${realm.serverToken}`;

    let { client, cleanup } = buildTestClient({
      realmUrl,
      realmToken: authorization,
      realmServerUrl: realm.realmServerURL.href,
      realmServerToken: serverToken,
    });

    try {
      let writeResult = await client.write(
        realmUrl,
        'bad-lint.gts',
        BAD_LINT_GTS,
      );
      expect(writeResult.ok).toBe(true);
      let indexed = await client.waitForFile(realmUrl, 'bad-lint.gts', {
        pollMs: 300,
        timeoutMs: 30_000,
      });
      expect(indexed).toBe(true);

      let result = await runLintInMemory({
        targetRealmUrl: realmUrl,
        client,
      });

      expect(result.status).toBe('failed');
      expect(result.errorCount).toBeGreaterThan(0);
      expect(result.lintableFiles).toContain('bad-lint.gts');
      expect(result.violations.length).toBeGreaterThan(0);

      let errorsOnBadFile = result.violations.filter(
        (v) => v.file === 'bad-lint.gts' && v.severity === 'error',
      );
      expect(errorsOnBadFile.length).toBeGreaterThan(0);
      let firstError = errorsOnBadFile[0];
      expect(firstError.message).toBeTruthy();
      expect(firstError.line).toBeGreaterThan(0);
      expect(firstError.rule).toBeTruthy();
      expect(result.filesWithErrors).toBeGreaterThan(0);

      // In-memory tool must not write any LintResult card artifact even
      // when there are lint failures.
      let listing = await client.listFiles(realmUrl);
      let validationArtifacts = (listing.filenames ?? []).filter((f) =>
        f.startsWith('Validations/lint_'),
      );
      expect(validationArtifacts).toEqual([]);
    } finally {
      cleanup();
    }
  });

  test('no lintable files produces a vacuous pass', async ({ realm }) => {
    let realmUrl = realm.realmURL.href;
    let authorization = realm.authorizationHeaders()['Authorization'];
    let serverToken = `Bearer ${realm.serverToken}`;

    let { client, cleanup } = buildTestClient({
      realmUrl,
      realmToken: authorization,
      realmServerUrl: realm.realmServerURL.href,
      realmServerToken: serverToken,
    });

    try {
      // Delete all lintable files shipped with the fixture.
      let listingBefore = await client.listFiles(realmUrl);
      let lintablePattern = /\.(gts|gjs|ts|js)$/;
      for (let filename of listingBefore.filenames ?? []) {
        if (lintablePattern.test(filename)) {
          let deleteResult = await client.delete(realmUrl, filename);
          expect(
            deleteResult.ok,
            `delete ${filename} failed: ${deleteResult.error}`,
          ).toBe(true);
        }
      }

      let result = await runLintInMemory({
        targetRealmUrl: realmUrl,
        client,
      });

      expect(result.status).toBe('passed');
      expect(result.errorCount).toBe(0);
      expect(result.warningCount).toBe(0);
      expect(result.filesChecked).toBe(0);
      expect(result.lintableFiles).toEqual([]);
      expect(result.violations).toEqual([]);
      expect(result.errorMessage).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  test('error path: listFiles failure surfaces as status: error', async () => {
    let thrower: BoxelCLIClient = {
      listFiles: async () => {
        throw new Error('ECONNREFUSED');
      },
    } as unknown as BoxelCLIClient;

    let result = await runLintInMemory({
      targetRealmUrl: 'http://localhost:1/',
      client: thrower,
    });

    expect(result.status).toBe('error');
    expect(result.errorMessage).toContain('ECONNREFUSED');
    expect(result.lintableFiles).toEqual([]);
    expect(result.violations).toEqual([]);
  });
});
