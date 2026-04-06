import { resolve } from 'node:path';

import { expect, test } from './fixtures';

import {
  createTestRun,
  executeTestRunFromRealm,
  type TestRunRealmOptions,
} from '../scripts/lib/factory-test-realm';
import {
  readFile,
  waitForRealmFile,
  writeFile,
} from '../scripts/lib/realm-operations';

const fixtureRealmDir = resolve(
  process.cwd(),
  'test-fixtures',
  'test-realm-runner',
);

// QUnit test content written to the realm via the API — same path as the live system.
// Uses import.meta.url to resolve the co-located hello.gts card definition,
// making the tests portable across realms.
const PASSING_TEST_GTS = `import { module, test } from 'qunit';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { renderCard } from '@cardstack/host/tests/helpers/render-component';
import { getService } from '@universal-ember/test-support';

let cardModuleUrl = new URL('./hello', import.meta.url).href;

export function runTests() {
  module('HelloCard', function (hooks) {
    setupCardTest(hooks);

    test('greeting renders in isolated view', async function (assert) {
      let loader = getService('loader-service').loader;
      let { HelloCard } = await loader.import(cardModuleUrl);
      let card = new HelloCard({ greeting: 'Hello from smoke test' });
      await renderCard(loader, card, 'isolated');
      assert.dom('[data-test-greeting]').hasText('Hello from smoke test');
    });
  });
}
`;

const FAILING_TEST_GTS = `import { module, test } from 'qunit';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { renderCard } from '@cardstack/host/tests/helpers/render-component';
import { getService } from '@universal-ember/test-support';

let cardModuleUrl = new URL('./hello', import.meta.url).href;

export function runTests() {
  module('HelloCard Fail', function (hooks) {
    setupCardTest(hooks);

    test('deliberately fails - wrong greeting text', async function (assert) {
      let loader = getService('loader-service').loader;
      let { HelloCard } = await loader.import(cardModuleUrl);
      let card = new HelloCard({ greeting: 'Hello from smoke test' });
      await renderCard(loader, card, 'isolated');
      assert.dom('[data-test-greeting]').hasText('THIS TEXT DOES NOT EXIST');
    });
  });
}
`;

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

    // Write the QUnit test to the realm via API — same path as the live system.
    let writeResult = await writeFile(
      realmUrl,
      'hello.test.gts',
      PASSING_TEST_GTS,
      { authorization },
    );
    expect(writeResult.ok).toBe(true);

    // Wait for the realm to index the file before running tests
    let indexed = await waitForRealmFile(realmUrl, 'hello.test.gts', {
      authorization,
      pollMs: 300,
      timeoutMs: 30_000,
    });
    expect(indexed).toBe(true);

    // Verify the realm resolves the dotted filename: a request for
    // "hello.test" (without .gts) must find "hello.test.gts" on disk.
    let moduleUrl = `${realmUrl}hello.test`;
    let moduleResponse = await fetch(moduleUrl, {
      headers: { Accept: '*/*', Authorization: authorization },
    });
    expect(moduleResponse.status).toBe(200);

    let handle = await executeTestRunFromRealm({
      targetRealmUrl: realmUrl,
      testResultsModuleUrl,
      realmServerUrl: realm.realmServerURL.href,
      slug: 'hello-e2e',
      testNames: [],
      authorization,
      fetch: globalThis.fetch,
      hostAppUrl: realm.hostAppUrl,
    });

    // Handle assertions
    expect(handle.testRunId).toContain('Test Runs/hello-e2e');
    expect(handle.status).toBe('passed');
    expect(handle.errorMessage).toBeUndefined();

    // Read the TestRun card back and verify its persisted state
    let testRunCard = await readFile(realmUrl, handle.testRunId, {
      authorization,
    });
    expect(testRunCard.ok).toBe(true);
    let attrs = testRunCard.document?.data.attributes;
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
  });

  test('failure path: deliberately failing QUnit test produces status: failed with details', async ({
    realm,
  }) => {
    let realmUrl = realm.realmURL.href;
    let testResultsModuleUrl = `${realm.realmServerURL.href}software-factory/test-results`;
    let authHeaders = realm.authorizationHeaders();
    let authorization = authHeaders['Authorization'];

    // Write the deliberately failing QUnit test via API.
    let writeResult = await writeFile(
      realmUrl,
      'hello-fail.test.gts',
      FAILING_TEST_GTS,
      { authorization },
    );
    expect(writeResult.ok).toBe(true);

    // Wait for the realm to index the file before running tests
    let indexed = await waitForRealmFile(realmUrl, 'hello-fail.test.gts', {
      authorization,
      pollMs: 300,
      timeoutMs: 30_000,
    });
    expect(indexed).toBe(true);

    let handle = await executeTestRunFromRealm({
      targetRealmUrl: realmUrl,
      testResultsModuleUrl,
      realmServerUrl: realm.realmServerURL.href,
      slug: 'hello-fail',
      testNames: [],
      authorization,
      fetch: globalThis.fetch,
      hostAppUrl: realm.hostAppUrl,
    });

    // Handle assertions
    expect(handle.testRunId).toContain('Test Runs/hello-fail');
    expect(handle.status).toBe('failed');

    // Read the TestRun card back and verify its persisted state
    let testRunCard = await readFile(realmUrl, handle.testRunId, {
      authorization,
    });
    expect(testRunCard.ok).toBe(true);
    let attrs = testRunCard.document?.data.attributes;
    expect(attrs?.status).toBe('failed');
    expect(attrs?.sequenceNumber).toBe(1);
    expect(attrs?.completedAt).toBeTruthy();
    expect(attrs?.durationMs).toBeGreaterThan(0);

    // Verify moduleResults contain the failing test with error details
    let moduleResults = attrs?.moduleResults as
      | {
          moduleRef?: { module?: string };
          results?: { testName?: string; status?: string; message?: string }[];
        }[]
      | undefined;
    expect(moduleResults).toBeTruthy();
    expect(moduleResults!.length).toBeGreaterThan(0);

    let failedResults = moduleResults!
      .flatMap((mr) => mr.results ?? [])
      .filter((r) => r.status === 'failed');
    expect(failedResults.length).toBeGreaterThan(0);
    expect(failedResults[0].message).toBeTruthy();
  });

  test('error path: unreachable realm returns error immediately', async () => {
    let options: TestRunRealmOptions = {
      testRealmUrl: 'http://localhost:1/',
      testResultsModuleUrl: 'http://localhost:1/software-factory/test-results',
      fetch: globalThis.fetch,
    };

    let result = await createTestRun('error-test', ['test A'], options);
    expect(result.created).toBe(false);
    expect(result.error).toBeTruthy();
  });

});
