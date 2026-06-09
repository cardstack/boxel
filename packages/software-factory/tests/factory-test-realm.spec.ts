import { resolve } from 'node:path';

import { expect, test } from './fixtures.ts';

import {
  createTestRun,
  executeTestRunFromRealm,
  type TestRunRealmOptions,
} from '../src/factory-test-realm.ts';
import { buildTestClient } from './helpers/test-client.ts';
import { createMockClient } from './helpers/mock-client.ts';
import {
  FAILING_TEST_GTS,
  PASSING_TEST_GTS,
  writeAndAwaitIndex,
} from './helpers/qunit-test-fixtures.ts';
import { createTestWorkspace } from './helpers/workspace-fixture.ts';

const fixtureRealmDir = resolve(
  process.cwd(),
  'test-fixtures',
  'test-realm-runner',
);

test.use({ realmDir: fixtureRealmDir });
test.use({ realmServerMode: 'isolated' });

test.describe('factory-test-realm e2e', () => {
  test('executeTestRunFromRealm runs QUnit tests against the harness and completes the TestRun', async ({
    realm,
  }) => {
    let realmUrl = realm.realmURL.href;
    let testResultsModuleUrl = `${realm.realmServerURL.href}software-factory/test-results`;
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

      // Verify the realm resolves the dotted filename: a request for
      // "hello.test" (without .gts) must find "hello.test.gts" on disk.
      let moduleUrl = `${realmUrl}hello.test`;
      let moduleResponse = await client.authedFetch(moduleUrl, {
        headers: { Accept: '*/*' },
      });
      expect(moduleResponse.status).toBe(200);

      let workspace = createTestWorkspace();
      await client.pull(realmUrl, workspace.dir);

      let handle = await executeTestRunFromRealm({
        targetRealm: realmUrl,
        testResultsModuleUrl,
        realmServerUrl: realm.realmServerURL.href,
        slug: 'hello-e2e',
        testNames: [],
        client,
        workspaceDir: workspace.dir,
        hostAppUrl: realm.hostAppUrl,
      });

      // Push the TestRun card to the realm so the client.read assertion
      // below finds it via HTTP.
      await client.sync(realmUrl, workspace.dir, { preferLocal: true });
      workspace.cleanup();

      // Handle assertions
      expect(handle.testRunId).toContain('Validations/test_hello-e2e');
      expect(handle.status).toBe('passed');
      expect(handle.errorMessage).toBeUndefined();

      // Read the TestRun card back and verify its persisted state
      let testRunCard = await client.read(realmUrl, handle.testRunId);
      expect(testRunCard.ok).toBe(true);
      let attrs = (
        JSON.parse(testRunCard.content!) as {
          data?: { attributes?: Record<string, unknown> };
        }
      )?.data?.attributes;
      expect(attrs?.status).toBe('passed');
      expect(attrs?.sequenceNumber).toBe(1);
      expect(attrs?.completedAt).toBeTruthy();
      expect(attrs?.durationMs).toBeGreaterThan(0);

      // Verify moduleResults contain the passing test
      let moduleResults = attrs?.moduleResults as
        | {
            moduleRef?: { module?: string };
            results?: { testName?: string; status?: string }[];
          }[]
        | undefined;
      expect(moduleResults).toBeTruthy();
      expect(moduleResults!.length).toBeGreaterThan(0);

      let allResults = moduleResults!.flatMap((mr) => mr.results ?? []);
      expect(allResults.length).toBeGreaterThan(0);
      expect(allResults.every((r) => r.status === 'passed')).toBe(true);
    } finally {
      cleanup();
    }
  });

  test('failure path: deliberately failing QUnit test produces status: failed with details', async ({
    realm,
  }) => {
    let realmUrl = realm.realmURL.href;
    let testResultsModuleUrl = `${realm.realmServerURL.href}software-factory/test-results`;
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

      let workspace = createTestWorkspace();
      await client.pull(realmUrl, workspace.dir);

      let handle = await executeTestRunFromRealm({
        targetRealm: realmUrl,
        testResultsModuleUrl,
        realmServerUrl: realm.realmServerURL.href,
        slug: 'hello-fail',
        testNames: [],
        client,
        workspaceDir: workspace.dir,
        hostAppUrl: realm.hostAppUrl,
      });

      await client.sync(realmUrl, workspace.dir, { preferLocal: true });
      workspace.cleanup();

      // Handle assertions
      expect(handle.testRunId).toContain('Validations/test_hello-fail');
      expect(handle.status).toBe('failed');

      // Read the TestRun card back and verify its persisted state
      let testRunCard = await client.read(realmUrl, handle.testRunId);
      expect(testRunCard.ok).toBe(true);
      let attrs = (
        JSON.parse(testRunCard.content!) as {
          data?: { attributes?: Record<string, unknown> };
        }
      )?.data?.attributes;
      expect(attrs?.status).toBe('failed');
      expect(attrs?.sequenceNumber).toBe(1);
      expect(attrs?.completedAt).toBeTruthy();
      expect(attrs?.durationMs).toBeGreaterThan(0);

      // Verify moduleResults contain the failing test with error details
      let moduleResults = attrs?.moduleResults as
        | {
            moduleRef?: { module?: string };
            results?: {
              testName?: string;
              status?: string;
              message?: string;
            }[];
          }[]
        | undefined;
      expect(moduleResults).toBeTruthy();
      expect(moduleResults!.length).toBeGreaterThan(0);

      let failedResults = moduleResults!
        .flatMap((mr) => mr.results ?? [])
        .filter((r) => r.status === 'failed');
      expect(failedResults.length).toBeGreaterThan(0);
      expect(failedResults[0].message).toBeTruthy();
    } finally {
      cleanup();
    }
  });

  test('error path: unwritable workspace returns error immediately', async () => {
    // Point workspaceDir at a path that exists as a regular file — that
    // blocks directory creation inside writeCard and surfaces an fs
    // error without needing any HTTP round trip.
    let workspace = createTestWorkspace();
    workspace.write('blocker', 'file');
    let options: TestRunRealmOptions = {
      targetRealm: 'http://localhost:1/',
      testResultsModuleUrl: 'http://localhost:1/software-factory/test-results',
      client: createMockClient(),
      workspaceDir: `${workspace.dir}/blocker`,
    };

    let result = await createTestRun('error-test', ['test A'], options);
    expect(result.created).toBe(false);
    expect(result.error).toBeTruthy();

    workspace.cleanup();
  });
});
