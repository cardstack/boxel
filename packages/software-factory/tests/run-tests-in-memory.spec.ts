import { resolve } from 'node:path';

import type { BoxelCLIClient } from '@cardstack/boxel-cli/api';

import { expect, test } from './fixtures';

import { runTestsInMemory } from '../src/factory-test-realm';
import { buildTestClient } from './helpers/test-client';
import {
  FAILING_TEST_GTS,
  PASSING_TEST_GTS,
  writeAndAwaitIndex,
} from './helpers/qunit-test-fixtures';

const fixtureRealmDir = resolve(
  process.cwd(),
  'test-fixtures',
  'test-realm-runner',
);

test.use({ realmDir: fixtureRealmDir });
test.use({ realmServerMode: 'isolated' });

test.describe('runTestsInMemory e2e', () => {
  test('passing tests produce status: passed with no realm artifacts', async ({
    realm,
  }) => {
    let realmUrl = realm.realmURL.href;
    let authHeaders = realm.authorizationHeaders();
    let authorization = authHeaders['Authorization'];

    let { client, cleanup } = buildTestClient({
      realmUrl,
      realmToken: authorization,
      realmServerUrl: realm.realmServerURL.href,
      realmServerToken: `Bearer ${realm.serverToken}`,
    });

    try {
      await writeAndAwaitIndex(
        client,
        realmUrl,
        'hello.test.gts',
        PASSING_TEST_GTS,
      );

      let result = await runTestsInMemory({
        targetRealmUrl: realmUrl,
        client,
        realmServerUrl: realm.realmServerURL.href,
        hostAppUrl: realm.hostAppUrl,
      });

      expect(result.status).toBe('passed');
      expect(result.passedCount).toBeGreaterThan(0);
      expect(result.failedCount).toBe(0);
      expect(result.durationMs).toBeGreaterThan(0);
      expect(result.failures).toEqual([]);
      expect(result.testFiles).toContain('hello.test.gts');
      expect(result.errorMessage).toBeUndefined();

      // In-memory tool must not write any TestRun card artifact.
      let listing = await client.listFiles(realmUrl);
      let validationArtifacts = (listing.filenames ?? []).filter((f) =>
        f.startsWith('Validations/test_'),
      );
      expect(validationArtifacts).toEqual([]);
    } finally {
      cleanup();
    }
  });

  test('failing tests produce status: failed with failure details and no realm artifacts', async ({
    realm,
  }) => {
    let realmUrl = realm.realmURL.href;
    let authHeaders = realm.authorizationHeaders();
    let authorization = authHeaders['Authorization'];

    let { client, cleanup } = buildTestClient({
      realmUrl,
      realmToken: authorization,
      realmServerUrl: realm.realmServerURL.href,
      realmServerToken: `Bearer ${realm.serverToken}`,
    });

    try {
      await writeAndAwaitIndex(
        client,
        realmUrl,
        'hello-fail.test.gts',
        FAILING_TEST_GTS,
      );

      let result = await runTestsInMemory({
        targetRealmUrl: realmUrl,
        client,
        realmServerUrl: realm.realmServerURL.href,
        hostAppUrl: realm.hostAppUrl,
      });

      expect(result.status).toBe('failed');
      expect(result.failedCount).toBeGreaterThan(0);
      expect(result.failures.length).toBeGreaterThan(0);
      expect(result.failures[0].testName).toBeTruthy();
      expect(result.failures[0].message).toBeTruthy();
      expect(result.testFiles).toContain('hello-fail.test.gts');

      let listing = await client.listFiles(realmUrl);
      let validationArtifacts = (listing.filenames ?? []).filter((f) =>
        f.startsWith('Validations/test_'),
      );
      expect(validationArtifacts).toEqual([]);
    } finally {
      cleanup();
    }
  });

  test('no test files produces a vacuous pass', async ({ realm }) => {
    let realmUrl = realm.realmURL.href;
    let authHeaders = realm.authorizationHeaders();
    let authorization = authHeaders['Authorization'];

    let { client, cleanup } = buildTestClient({
      realmUrl,
      realmToken: authorization,
      realmServerUrl: realm.realmServerURL.href,
      realmServerToken: `Bearer ${realm.serverToken}`,
    });

    try {
      // The fixture realm ships with hello.test.gts. Delete it so the
      // realm has no *.test.gts files for this scenario.
      let listingBefore = await client.listFiles(realmUrl);
      for (let filename of listingBefore.filenames ?? []) {
        if (filename.endsWith('.test.gts')) {
          let deleteResult = await client.delete(realmUrl, filename);
          expect(
            deleteResult.ok,
            `delete ${filename} failed: ${deleteResult.error}`,
          ).toBe(true);
        }
      }

      let result = await runTestsInMemory({
        targetRealmUrl: realmUrl,
        client,
        realmServerUrl: realm.realmServerURL.href,
        hostAppUrl: realm.hostAppUrl,
      });

      expect(result.status).toBe('passed');
      expect(result.passedCount).toBe(0);
      expect(result.failedCount).toBe(0);
      expect(result.skippedCount).toBe(0);
      expect(result.testFiles).toEqual([]);
      expect(result.failures).toEqual([]);
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

    let result = await runTestsInMemory({
      targetRealmUrl: 'http://localhost:1/',
      client: thrower,
      realmServerUrl: 'http://localhost:1/',
      hostAppUrl: 'http://localhost:1/',
    });

    expect(result.status).toBe('error');
    expect(result.errorMessage).toContain('ECONNREFUSED');
    expect(result.testFiles).toEqual([]);
    expect(result.failures).toEqual([]);
  });
});
