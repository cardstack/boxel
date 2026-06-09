import { resolve } from 'node:path';

import type { BoxelCLIClient } from '@cardstack/boxel-cli/api';

import { expect, test } from './fixtures.ts';

import { runTestsInMemory } from '../src/factory-test-realm.ts';
import { buildTestClient } from './helpers/test-client.ts';
import {
  FAILING_TEST_GTS,
  PASSING_TEST_GTS,
  writeAndAwaitIndex,
} from './helpers/qunit-test-fixtures.ts';

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
        targetRealm: realmUrl,
        client,
        hostAppUrl: realm.hostAppUrl,
      });

      // PASSING_TEST_GTS overwrites the single fixture test file with a
      // module containing exactly one passing test.
      expect(result.status).toBe('passed');
      expect(result.passedCount).toBe(1);
      expect(result.failedCount).toBe(0);
      expect(result.skippedCount).toBe(0);
      expect(result.durationMs).toBeGreaterThan(0);
      expect(result.failures).toEqual([]);
      expect(result.testFiles).toEqual(['hello.test.gts']);
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
        targetRealm: realmUrl,
        client,
        hostAppUrl: realm.hostAppUrl,
      });

      // Fixture hello.test.gts (1 passing test) is untouched; the new
      // hello-fail.test.gts contributes 1 deliberately failing test.
      expect(result.status).toBe('failed');
      expect(result.passedCount).toBe(1);
      expect(result.failedCount).toBe(1);
      expect(result.skippedCount).toBe(0);
      expect(result.failures).toHaveLength(1);
      let failure = result.failures[0];
      expect(failure.testName).toBe('deliberately fails - wrong greeting text');
      // QUnit's testEnd event can report module as 'default' in this
      // harness; what matters for the agent is that module is a
      // non-empty string identifier, not the human-readable label.
      expect(typeof failure.module).toBe('string');
      expect(failure.module.length).toBeGreaterThan(0);
      // The failing assertion's expected text must appear in the message
      // so the agent can see what the test expected.
      expect(failure.message).toContain('THIS TEXT DOES NOT EXIST');
      expect(typeof failure.stackTrace).toBe('string');
      expect(failure.stackTrace!.length).toBeGreaterThan(0);
      expect(result.testFiles.slice().sort()).toEqual([
        'hello-fail.test.gts',
        'hello.test.gts',
      ]);

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
        targetRealm: realmUrl,
        client,
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
      targetRealm: 'http://localhost:1/',
      client: thrower,
      hostAppUrl: 'http://localhost:1/',
    });

    expect(result.status).toBe('error');
    expect(result.errorMessage).toContain('ECONNREFUSED');
    expect(result.testFiles).toEqual([]);
    expect(result.failures).toEqual([]);
  });
});
