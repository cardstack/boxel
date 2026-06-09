import { resolve } from 'node:path';

import { expect, test } from './fixtures.ts';

import { EvalValidationStep } from '../src/validators/eval-step.ts';
import type { EvalValidationDetails } from '../src/validators/eval-step.ts';
import { buildTestClient } from './helpers/test-client.ts';
import { createTestWorkspace } from './helpers/workspace-fixture.ts';

const fixtureRealmDir = resolve(
  process.cwd(),
  'test-fixtures',
  'test-realm-runner',
);

// A valid .gts card module that should evaluate successfully.
const VALID_MODULE_GTS = `import {
  CardDef,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

export class ValidCard extends CardDef {
  static displayName = 'Valid Card';
  @field name = contains(StringField);
}
`;

// A .gts module with a broken import that should fail evaluation.
// Foo is consumed as a field type so the compiler can't tree-shake it.
const BROKEN_MODULE_GTS = `import {
  CardDef,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import { Foo } from './does-not-exist';

export class BrokenCard extends CardDef {
  static displayName = 'Broken Card';
  @field brokenField = contains(Foo);
}
`;

test.use({ realmDir: fixtureRealmDir });
test.use({ realmServerMode: 'isolated' });

test.describe('eval-validation e2e', () => {
  test('EvalValidationStep e2e: clean module evaluates successfully', async ({
    realm,
  }) => {
    let realmUrl = realm.realmURL.href;
    let realmServerUrl = realm.realmServerURL.href;
    let authorization = realm.authorizationHeaders()['Authorization'];
    let serverToken = `Bearer ${realm.serverToken}`;
    let evalResultsModuleUrl = `${realmServerUrl}software-factory/eval-result`;

    let { client, cleanup } = buildTestClient({
      realmUrl,
      realmToken: authorization,
      realmServerUrl,
      realmServerToken: serverToken,
    });

    try {
      // Write a valid module
      let writeResult = await client.write(
        realmUrl,
        'valid-card.gts',
        VALID_MODULE_GTS,
      );
      expect(writeResult.ok).toBe(true);

      let indexed = await client.waitForFile(realmUrl, 'valid-card.gts', {
        pollMs: 300,
        timeoutMs: 30_000,
      });
      expect(indexed).toBe(true);

      let workspace = createTestWorkspace();
      await client.pull(realmUrl, workspace.dir);

      let step = new EvalValidationStep({
        client,
        realmServerUrl,
        evalResultsModuleUrl,
        workspaceDir: workspace.dir,
        issueId: 'Issues/eval-e2e',
      });

      let result = await step.run(realmUrl);

      // Push the EvalResult artifact card to the realm so the
      // client.read assertion below finds it.
      await client.sync(realmUrl, workspace.dir, { preferLocal: true });
      workspace.cleanup();

      // Must pass — valid modules with correct imports
      expect(result.step).toBe('evaluate');
      expect(result.passed).toBe(true);
      expect(result.files).toBeTruthy();
      expect(result.files!.length).toBeGreaterThan(0);
      expect(result.files).not.toContain('hello.test.gts');

      let details = result.details as unknown as EvalValidationDetails;
      expect(details).toBeTruthy();
      expect(details.evalResultId).toContain('Validations/eval_eval-e2e');
      expect(details.modulesChecked).toBeGreaterThan(0);
      expect(details.modulesWithErrors).toBe(0);

      // Read back the EvalResult card to verify persistence
      let cardRead = await client.read(realmUrl, details.evalResultId);
      expect(cardRead.ok).toBe(true);

      let attrs = (
        JSON.parse(cardRead.content!) as {
          data?: { attributes?: Record<string, unknown> };
        }
      )?.data?.attributes;
      expect(attrs).toBeTruthy();
      expect(attrs?.status).toBe('passed');
      expect(attrs?.sequenceNumber).toBe(1);
      expect(attrs?.completedAt).toBeTruthy();
    } finally {
      cleanup();
    }
  });

  test('EvalValidationStep e2e: module with broken import fails evaluation', async ({
    realm,
  }) => {
    let realmUrl = realm.realmURL.href;
    let realmServerUrl = realm.realmServerURL.href;
    let authorization = realm.authorizationHeaders()['Authorization'];
    let serverToken = `Bearer ${realm.serverToken}`;
    let evalResultsModuleUrl = `${realmServerUrl}software-factory/eval-result`;

    let { client, cleanup } = buildTestClient({
      realmUrl,
      realmToken: authorization,
      realmServerUrl,
      realmServerToken: serverToken,
    });

    try {
      // Write a module with a broken relative import that is consumed as a field
      // type. The import must be consumed — unused imports get tree-shaken by the
      // compiler and the Loader never sees them (lint catches unused imports).
      let writeResult = await client.write(
        realmUrl,
        'broken-module.gts',
        BROKEN_MODULE_GTS,
      );
      expect(writeResult.ok).toBe(true);

      let indexed = await client.waitForFile(realmUrl, 'broken-module.gts', {
        pollMs: 300,
        timeoutMs: 30_000,
      });
      expect(indexed).toBe(true);

      let workspace = createTestWorkspace();
      await client.pull(realmUrl, workspace.dir);

      let step = new EvalValidationStep({
        client,
        realmServerUrl,
        evalResultsModuleUrl,
        workspaceDir: workspace.dir,
        issueId: 'Issues/eval-fail-e2e',
      });

      let result = await step.run(realmUrl);

      await client.sync(realmUrl, workspace.dir, { preferLocal: true });
      workspace.cleanup();

      // Must fail — broken-module.gts imports from a non-existent module
      expect(result.step).toBe('evaluate');
      expect(result.passed).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);

      let details = result.details as unknown as EvalValidationDetails;
      expect(details).toBeTruthy();
      expect(details.modulesWithErrors).toBeGreaterThan(0);

      let brokenModule = details.modules.find((m) =>
        m.path.includes('broken-module'),
      );
      expect(brokenModule).toBeTruthy();
      expect(brokenModule!.error).toBeTruthy();
      // The error should be a real eval failure from the sandbox, not infrastructure
      expect(brokenModule!.error).not.toContain('unable to fetch');
      expect(brokenModule!.error).not.toContain('Command runner failed');
      expect(brokenModule!.error).not.toContain('Missing Authorization');

      // Read back the EvalResult card to verify it was persisted as failed
      let cardRead = await client.read(realmUrl, details.evalResultId);
      expect(cardRead.ok).toBe(true);

      let attrs = (
        JSON.parse(cardRead.content!) as {
          data?: { attributes?: Record<string, unknown> };
        }
      )?.data?.attributes;
      expect(attrs).toBeTruthy();
      expect(attrs?.status).toBe('failed');
    } finally {
      cleanup();
    }
  });

  test('EvalValidationStep e2e: test files are excluded', async ({ realm }) => {
    let realmUrl = realm.realmURL.href;
    let realmServerUrl = realm.realmServerURL.href;
    let authorization = realm.authorizationHeaders()['Authorization'];
    let serverToken = `Bearer ${realm.serverToken}`;
    let evalResultsModuleUrl = `${realmServerUrl}software-factory/eval-result`;

    let { client, cleanup } = buildTestClient({
      realmUrl,
      realmToken: authorization,
      realmServerUrl,
      realmServerToken: serverToken,
    });

    try {
      let workspace = createTestWorkspace();
      await client.pull(realmUrl, workspace.dir);

      let step = new EvalValidationStep({
        client,
        realmServerUrl,
        evalResultsModuleUrl,
        workspaceDir: workspace.dir,
        issueId: 'Issues/eval-exclude-e2e',
      });

      let result = await step.run(realmUrl);

      await client.sync(realmUrl, workspace.dir, { preferLocal: true });
      workspace.cleanup();

      // The fixture realm has hello.gts and hello.test.gts
      // Only hello.gts (and home.gts) should be evaluated, not hello.test.gts
      expect(result.step).toBe('evaluate');
      expect(result.passed).toBe(true);
      expect(result.files).toBeTruthy();
      expect(result.files).toContain('hello.gts');
      expect(result.files).not.toContain('hello.test.gts');
    } finally {
      cleanup();
    }
  });
});
