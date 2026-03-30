import { existsSync, readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { expect, test } from './fixtures';

import {
  createTestRun,
  executeTestRunFromRealm,
  type TestRunRealmOptions,
} from '../scripts/lib/factory-test-realm';
import { pullRealmFiles } from '../scripts/lib/realm-operations';

const fixtureRealmDir = resolve(
  process.cwd(),
  'test-fixtures',
  'test-realm-runner',
);

test.use({ realmDir: fixtureRealmDir });
test.use({ realmServerMode: 'isolated' });

test.describe('factory-test-realm e2e', () => {
  test('executeTestRunFromRealm runs specs against the harness and completes the TestRun', async ({
    realm,
  }) => {
    let realmUrl = realm.realmURL.href;
    let testResultsModuleUrl = `${realm.realmServerURL.href}software-factory/test-results`;
    let authHeaders = realm.authorizationHeaders();
    let authorization = authHeaders['Authorization'];

    // Use the same realm as both target (has the card) and test (has the specs).
    let handle = await executeTestRunFromRealm({
      targetRealmUrl: realmUrl,
      testRealmUrl: realmUrl,
      testResultsModuleUrl,
      slug: 'hello-e2e',
      specPaths: ['Tests/hello-passing.spec.ts'],
      testNames: ['hello card renders greeting'],
      authorization,
      fetch: globalThis.fetch,
    });

    // The function should complete (not hang) and return a final status.
    expect(handle.testRunId).toContain('Test Runs/hello-e2e');
    expect(['passed', 'failed', 'error']).toContain(handle.status);

    // Read the TestRun card to verify it was completed.
    let cardUrl = `${realmUrl}${handle.testRunId}`;
    let readResponse = await fetch(cardUrl, {
      headers: {
        Accept: 'application/vnd.card+source',
        Authorization: authorization,
      },
    });

    if (readResponse.ok) {
      let card = (await readResponse.json()) as {
        data: { attributes: Record<string, unknown> };
      };
      // Should NOT still be 'running' — it should be completed.
      expect(card.data.attributes.status).not.toBe('running');
      expect(card.data.attributes.completedAt).toBeTruthy();
    }
  });

  test('failure path: deliberately failing spec produces status: failed with details', async ({
    realm,
  }) => {
    let realmUrl = realm.realmURL.href;
    let testResultsModuleUrl = `${realm.realmServerURL.href}software-factory/test-results`;
    let authHeaders = realm.authorizationHeaders();
    let authorization = authHeaders['Authorization'];

    let handle = await executeTestRunFromRealm({
      targetRealmUrl: realmUrl,
      testRealmUrl: realmUrl,
      testResultsModuleUrl,
      slug: 'hello-fail',
      specPaths: ['Tests/hello-failing.spec.ts'],
      testNames: ['deliberately fails for testing'],
      authorization,
      fetch: globalThis.fetch,
    });

    expect(handle.testRunId).toContain('Test Runs/hello-fail');
    // The spec deliberately fails — status should be 'failed' or 'error'
    // (error if Playwright couldn't produce a report, failed if it did).
    expect(['failed', 'error']).toContain(handle.status);
    expect(handle.status).not.toBe('passed');
  });

  test('pullRealmFiles downloads and unwraps spec files from the realm', async ({
    realm,
  }) => {
    let realmUrl = realm.realmURL.href;
    let authHeaders = realm.authorizationHeaders();
    let authorization = authHeaders['Authorization'];

    let tmpDir = mkdtempSync(join(tmpdir(), 'pull-test-'));
    let result = await pullRealmFiles(realmUrl, tmpDir, {
      authorization,
    });

    expect(result.error).toBeUndefined();
    expect(result.files.length).toBeGreaterThan(0);

    // The fixture has Tests/hello-passing.spec.ts — verify it was pulled
    // and contains raw TypeScript (not a JSON wrapper).
    let specPath = join(tmpDir, 'Tests', 'hello-passing.spec.ts');
    expect(existsSync(specPath)).toBe(true);

    let content = readFileSync(specPath, 'utf8');
    // Should be raw TypeScript, not JSON
    expect(content).toContain('import');
    expect(content).toContain('test(');
    expect(content).not.toContain('"data"');
    expect(content).not.toContain('"type": "module"');

    // Also verify .gts files are unwrapped
    let gtsPath = join(tmpDir, 'hello.gts');
    expect(existsSync(gtsPath)).toBe(true);
    let gtsContent = readFileSync(gtsPath, 'utf8');
    expect(gtsContent).toContain('CardDef');
    expect(gtsContent).not.toContain('"data"');
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
