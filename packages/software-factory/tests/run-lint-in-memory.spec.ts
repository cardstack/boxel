import { resolve } from 'node:path';

import type { BoxelCLIClient } from '@cardstack/boxel-cli/api';

import { expect, test } from './fixtures.ts';

import { runLintInMemory } from '../src/lint-execution.ts';
import { BAD_LINT_GTS } from './helpers/lint-test-fixtures.ts';
import { buildTestClient } from './helpers/test-client.ts';
import { createTestWorkspace } from './helpers/workspace-fixture.ts';

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

    let workspace: ReturnType<typeof createTestWorkspace> | undefined;
    try {
      workspace = createTestWorkspace();
      await client.pull(realmUrl, workspace.dir);

      // The fixture realm ships with a clean hello.gts and hello.test.gts.
      let result = await runLintInMemory({
        targetRealm: realmUrl,
        client,
        workspaceDir: workspace.dir,
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
      workspace?.cleanup();
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

      let workspace = createTestWorkspace();
      await client.pull(realmUrl, workspace.dir);

      let result = await runLintInMemory({
        targetRealm: realmUrl,
        client,
        workspaceDir: workspace.dir,
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

      let workspace = createTestWorkspace();
      await client.pull(realmUrl, workspace.dir);

      let result = await runLintInMemory({
        targetRealm: realmUrl,
        client,
        workspaceDir: workspace.dir,
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
      targetRealm: 'http://localhost:1/',
      client: thrower,
      workspaceDir: createTestWorkspace().dir,
    });

    expect(result.status).toBe('error');
    expect(result.errorMessage).toContain('ECONNREFUSED');
    expect(result.lintableFiles).toEqual([]);
    expect(result.violations).toEqual([]);
  });

  test('path option: lints only the named file and skips the rest of the realm', async ({
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
      // Seed a dirty file alongside the fixture's clean hello.gts.
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

      let workspace = createTestWorkspace();
      await client.pull(realmUrl, workspace.dir);

      // Lint only the clean file — should pass even though bad-lint.gts is dirty.
      let cleanOnly = await runLintInMemory({
        targetRealm: realmUrl,
        client,
        workspaceDir: workspace.dir,
        path: 'hello.gts',
      });
      expect(cleanOnly.status).toBe('passed');
      expect(cleanOnly.lintableFiles).toEqual(['hello.gts']);
      expect(cleanOnly.filesChecked).toBe(1);
      expect(cleanOnly.errorCount).toBe(0);

      // Lint only the dirty file — should fail and mention only that file.
      let dirtyOnly = await runLintInMemory({
        targetRealm: realmUrl,
        client,
        workspaceDir: workspace.dir,
        path: 'bad-lint.gts',
      });
      expect(dirtyOnly.status).toBe('failed');
      expect(dirtyOnly.lintableFiles).toEqual(['bad-lint.gts']);
      expect(dirtyOnly.filesChecked).toBe(1);
      expect(dirtyOnly.errorCount).toBeGreaterThan(0);
      let fileSet = new Set(dirtyOnly.violations.map((v) => v.file));
      expect(Array.from(fileSet)).toEqual(['bad-lint.gts']);

      // Still no realm artifact written.
      let listing = await client.listFiles(realmUrl);
      let validationArtifacts = (listing.filenames ?? []).filter((f) =>
        f.startsWith('Validations/lint_'),
      );
      expect(validationArtifacts).toEqual([]);
    } finally {
      cleanup();
    }
  });

  test('path option: non-lintable extension returns status: error without a realm call', async () => {
    let listFilesCalls = 0;
    let stubClient: BoxelCLIClient = {
      listFiles: async () => {
        listFilesCalls += 1;
        return { filenames: [] };
      },
      lint: async () => {
        throw new Error('should not be called for non-lintable path');
      },
    } as unknown as BoxelCLIClient;

    let result = await runLintInMemory({
      targetRealm: 'http://localhost:1/',
      client: stubClient,
      workspaceDir: createTestWorkspace().dir,
      path: 'Spec/sticky-note.json',
    });

    expect(result.status).toBe('error');
    expect(result.errorMessage).toContain('not lintable');
    expect(result.lintableFiles).toEqual([]);
    expect(result.violations).toEqual([]);
    expect(listFilesCalls).toBe(0);
  });
});
