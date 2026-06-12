import { resolve } from 'node:path';

import { expect, test } from './fixtures.ts';

import { LintValidationStep } from '../src/validators/lint-step.ts';
import type { LintValidationDetails } from '../src/validators/lint-step.ts';
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

test.describe('lint-validation e2e', () => {
  test('client.lint: clean file returns no errors', async ({ realm }) => {
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
      // Read the existing hello.gts from the fixture realm
      let readResult = await client.read(realmUrl, 'hello.gts');
      expect(readResult.ok).toBe(true);
      expect(readResult.content).toBeTruthy();

      let lintResult = await client.lint(
        realmUrl,
        readResult.content!,
        'hello.gts',
      );

      // The fixture's hello.gts should be clean
      let errors = (lintResult.messages ?? []).filter((m) => m.severity === 2);
      expect(errors).toEqual([]);
    } finally {
      cleanup();
    }
  });

  test('client.lint: file with violations returns lint messages', async ({
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
      // Write a file with lint issues
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

      let lintResult = await client.lint(
        realmUrl,
        BAD_LINT_GTS,
        'bad-lint.gts',
      );

      // Should have at least one error (unused variable)
      let errors = (lintResult.messages ?? []).filter((m) => m.severity === 2);
      expect(errors.length).toBeGreaterThan(0);

      // Verify the message shape
      let firstError = errors[0];
      expect(firstError.message).toBeTruthy();
      expect(firstError.line).toBeGreaterThan(0);
      expect(typeof firstError.severity).toBe('number');
    } finally {
      cleanup();
    }
  });

  test('LintValidationStep e2e: runs lint against realm and returns structured result', async ({
    realm,
  }) => {
    let realmUrl = realm.realmURL.href;
    let realmServerUrl = realm.realmServerURL.href;
    let authorization = realm.authorizationHeaders()['Authorization'];
    let serverToken = `Bearer ${realm.serverToken}`;
    let lintResultsModuleUrl = `${realmServerUrl}software-factory/lint-result`;

    let { client, cleanup } = buildTestClient({
      realmUrl,
      realmToken: authorization,
      realmServerUrl,
      realmServerToken: serverToken,
    });

    try {
      let workspace = createTestWorkspace();
      await client.pull(realmUrl, workspace.dir);

      let step = new LintValidationStep({
        client,
        realmServerUrl,
        lintResultsModuleUrl,
        workspaceDir: workspace.dir,
        issueId: 'Issues/lint-e2e',
      });

      let result = await step.run(realmUrl);

      // Sync the LintResult artifact card to the realm so the read-back
      // assertion below sees it via HTTP.
      await client.sync(realmUrl, workspace.dir, { preferLocal: true });
      workspace.cleanup();

      // The fixture realm has hello.gts and hello.test.gts — both lintable.
      // hello.gts should be clean; result should reflect that.
      expect(result.step).toBe('lint');
      expect(result.files).toBeTruthy();
      expect(result.files!.length).toBeGreaterThan(0);

      // Verify we get the details shape
      let details = result.details as unknown as LintValidationDetails;
      expect(details).toBeTruthy();
      expect(details.lintResultId).toContain('Validations/lint_lint-e2e');
      expect(details.filesChecked).toBeGreaterThan(0);

      // Read back the LintResult card from the realm to verify it was persisted
      let cardRead = await client.read(realmUrl, details.lintResultId);
      expect(cardRead.ok).toBe(true);

      let attrs = (
        JSON.parse(cardRead.content!) as {
          data?: { attributes?: Record<string, unknown> };
        }
      )?.data?.attributes;
      expect(attrs).toBeTruthy();
      expect(['passed', 'failed']).toContain(attrs?.status);
      expect(attrs?.sequenceNumber).toBe(1);
      expect(attrs?.completedAt).toBeTruthy();
    } finally {
      cleanup();
    }
  });
});
