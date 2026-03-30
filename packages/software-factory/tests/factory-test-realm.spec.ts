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
import {
  pullRealmFiles,
  writeModuleSource,
} from '../scripts/lib/realm-operations';

const fixtureRealmDir = resolve(
  process.cwd(),
  'test-fixtures',
  'test-realm-runner',
);

// Spec content written to the realm via the API — same path as the live system.
const PASSING_SPEC = `import { expect, test } from '@playwright/test';

test('hello card renders greeting', async ({ page }) => {
  let realmUrl = process.env.BOXEL_SOURCE_REALM_URL;
  await page.goto(\`\${realmUrl}HelloCard/sample\`);
  await expect(page.locator('[data-test-greeting]')).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator('[data-test-greeting]')).toContainText('Hello');
});
`;

const FAILING_SPEC = `import { expect, test } from '@playwright/test';

test('deliberately fails for testing', async ({ page }) => {
  let realmUrl = process.env.BOXEL_SOURCE_REALM_URL;
  await page.goto(\`\${realmUrl}HelloCard/sample\`);
  // This assertion is deliberately wrong — it checks for text that doesn't exist.
  await expect(page.locator('[data-test-greeting]')).toContainText(
    'THIS TEXT DOES NOT EXIST',
    { timeout: 5_000 },
  );
});
`;

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

    // Write the spec to the realm via API — same path as the live system.
    let writeResult = await writeModuleSource(
      realmUrl,
      'Tests/hello-passing.spec.ts',
      PASSING_SPEC,
      { authorization },
    );
    expect(writeResult.ok).toBe(true);

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
    // The realm may still be indexing the update, so poll briefly.
    let cardUrl = `${realmUrl}${handle.testRunId}`;
    let card: { data: { attributes: Record<string, unknown> } } | undefined;
    for (let i = 0; i < 30; i++) {
      let readResponse = await fetch(cardUrl, {
        headers: {
          Accept: 'application/vnd.card+source',
          Authorization: authorization,
        },
      });
      if (readResponse.ok) {
        card = await readResponse.json();
        if (card?.data?.attributes?.status !== 'running') break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }

    expect(card).toBeTruthy();
    expect(card!.data.attributes.status).not.toBe('running');
    expect(card!.data.attributes.completedAt).toBeTruthy();
  });

  test('failure path: deliberately failing spec produces status: failed with details', async ({
    realm,
  }) => {
    let realmUrl = realm.realmURL.href;
    let testResultsModuleUrl = `${realm.realmServerURL.href}software-factory/test-results`;
    let authHeaders = realm.authorizationHeaders();
    let authorization = authHeaders['Authorization'];

    // Write the deliberately failing spec via API.
    let writeResult = await writeModuleSource(
      realmUrl,
      'Tests/hello-failing.spec.ts',
      FAILING_SPEC,
      { authorization },
    );
    expect(writeResult.ok).toBe(true);

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

  test('pullRealmFiles downloads spec files written via the API', async ({
    realm,
  }) => {
    let realmUrl = realm.realmURL.href;
    let authHeaders = realm.authorizationHeaders();
    let authorization = authHeaders['Authorization'];

    // Write a spec file to the realm via the API.
    let writeResult = await writeModuleSource(
      realmUrl,
      'Tests/hello-passing.spec.ts',
      PASSING_SPEC,
      { authorization },
    );
    expect(writeResult.ok).toBe(true);

    let tmpDir = mkdtempSync(join(tmpdir(), 'pull-test-'));
    let result = await pullRealmFiles(realmUrl, tmpDir, {
      authorization,
    });

    expect(result.error).toBeUndefined();
    expect(result.files.length).toBeGreaterThan(0);

    // Verify the spec was pulled and contains raw TypeScript.
    let specPath = join(tmpDir, 'Tests', 'hello-passing.spec.ts');
    expect(existsSync(specPath)).toBe(true);

    let content = readFileSync(specPath, 'utf8');
    expect(content).toContain('import');
    expect(content).toContain('test(');
    // Must NOT be JSON-wrapped — raw source only.
    expect(content).not.toContain('"data"');
    expect(content).not.toContain('"type": "module"');

    // Also verify .gts files loaded from the fixture are raw source.
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
