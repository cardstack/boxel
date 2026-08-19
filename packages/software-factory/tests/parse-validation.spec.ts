import { resolve } from 'node:path';

import { expect, test } from './fixtures.ts';

import { ParseValidationStep } from '../src/validators/parse-step.ts';
import type { ParseValidationDetails } from '../src/validators/parse-step.ts';
import {
  BROKEN_TEMPLATE_GTS,
  VALID_MODULE_GTS,
} from './helpers/parse-test-fixtures.ts';
import { buildTestClient } from './helpers/test-client.ts';
import { createTestWorkspace } from './helpers/workspace-fixture.ts';

const fixtureRealmDir = resolve(
  process.cwd(),
  'test-fixtures',
  'test-realm-runner',
);

test.use({ realmDir: fixtureRealmDir });
test.use({ realmServerMode: 'isolated' });

test.describe('parse-validation e2e', () => {
  test('ParseValidationStep e2e: valid GTS and valid JSON example pass', async ({
    realm,
  }) => {
    let realmUrl = realm.realmURL.href;
    let realmServerUrl = realm.realmServerURL.href;
    let realmToken = realm.authorizationHeaders()['Authorization'];
    let parseResultsModuleUrl = `${realmServerUrl}software-factory/parse-result`;

    let { client, cleanup } = buildTestClient({
      realmUrl,
      realmToken,
      realmServerUrl,
      realmServerToken: realm.serverToken,
    });

    try {
      // Write a valid card module
      let writeResult = await client.write(
        realmUrl,
        'parse-test-card.gts',
        VALID_MODULE_GTS,
      );
      expect(writeResult.ok).toBe(true);

      await client.waitForFile(realmUrl, 'parse-test-card.gts', {
        pollMs: 300,
        timeoutMs: 30_000,
      });

      // Write a valid example instance
      let exampleDoc = {
        data: {
          type: 'card',
          attributes: { name: 'Valid Example' },
          meta: {
            adoptsFrom: {
              module: '../parse-test-card',
              name: 'ParseTestCard',
            },
          },
        },
      };
      let exampleWrite = await client.write(
        realmUrl,
        'ParseTestCard/example-1.json',
        JSON.stringify(exampleDoc, null, 2),
      );
      expect(exampleWrite.ok).toBe(true);

      await client.waitForFile(realmUrl, 'ParseTestCard/example-1.json', {
        pollMs: 300,
        timeoutMs: 30_000,
      });

      // Write a Spec card linking to the example
      let specDoc = {
        data: {
          type: 'card',
          attributes: {
            specType: 'card',
            ref: {
              module: '../parse-test-card',
              name: 'ParseTestCard',
            },
          },
          relationships: {
            'linkedExamples.0': {
              links: { self: '../ParseTestCard/example-1' },
            },
          },
          meta: {
            adoptsFrom: {
              module: '@cardstack/base/spec',
              name: 'Spec',
            },
          },
        },
      };
      let specWrite = await client.write(
        realmUrl,
        'Spec/parse-test-spec.json',
        JSON.stringify(specDoc, null, 2),
      );
      expect(specWrite.ok).toBe(true);

      await client.waitForFile(realmUrl, 'Spec/parse-test-spec.json', {
        pollMs: 300,
        timeoutMs: 30_000,
      });

      let workspace = createTestWorkspace();
      await client.pull(realmUrl, workspace.dir);

      // Scope to only the file we wrote — the fixture realm has pre-existing
      // .gts files that may produce glint errors in CI due to type resolution
      // differences. We only want to validate our test file.
      let step = new ParseValidationStep({
        client,
        realmServerUrl,
        parseResultsModuleUrl,
        workspaceDir: workspace.dir,
        issueId: 'Issues/parse-e2e',
        fetchFilenames: async () => ({
          filenames: ['parse-test-card.gts', 'ParseTestCard/example-1.json'],
        }),
      });

      let result = await step.run(realmUrl);

      await client.sync(realmUrl, workspace.dir, { preferLocal: true });
      workspace.cleanup();

      // Must pass — valid GTS + valid JSON example
      expect(result.step).toBe('parse');
      expect(result.passed).toBe(true);
      expect(result.files).toBeTruthy();
      expect(result.files!.length).toBeGreaterThan(0);

      let details = result.details as unknown as ParseValidationDetails;
      expect(details).toBeTruthy();
      expect(details.parseResultId).toContain('Validations/parse_parse-e2e');
      expect(details.filesChecked).toBeGreaterThan(0);
      expect(details.filesWithErrors).toBe(0);

      // Read back the ParseResult card to verify persistence
      let cardRead = await client.read(realmUrl, details.parseResultId);
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

  test('ParseValidationStep e2e: broken GTS template syntax fails parse', async ({
    realm,
  }) => {
    let realmUrl = realm.realmURL.href;
    let realmServerUrl = realm.realmServerURL.href;
    let realmToken = realm.authorizationHeaders()['Authorization'];
    let parseResultsModuleUrl = `${realmServerUrl}software-factory/parse-result`;

    let { client, cleanup } = buildTestClient({
      realmUrl,
      realmToken,
      realmServerUrl,
      realmServerToken: realm.serverToken,
    });

    try {
      // Write a GTS file with an unclosed template tag
      let writeResult = await client.write(
        realmUrl,
        'broken-card.gts',
        BROKEN_TEMPLATE_GTS,
      );
      expect(writeResult.ok).toBe(true);

      await client.waitForFile(realmUrl, 'broken-card.gts', {
        pollMs: 300,
        timeoutMs: 30_000,
      });

      let workspace = createTestWorkspace();
      await client.pull(realmUrl, workspace.dir);

      // Scope to only the broken file we wrote
      let step = new ParseValidationStep({
        client,
        realmServerUrl,
        parseResultsModuleUrl,
        workspaceDir: workspace.dir,
        issueId: 'Issues/parse-fail-e2e',
        fetchFilenames: async () => ({ filenames: ['broken-card.gts'] }),
      });

      let result = await step.run(realmUrl);

      await client.sync(realmUrl, workspace.dir, { preferLocal: true });
      workspace.cleanup();

      // Must fail — unclosed template tag
      expect(result.step).toBe('parse');
      expect(result.passed).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);

      // Check that the error references the broken file
      let brokenError = result.errors.find((e) =>
        e.message?.includes('broken-card.gts'),
      );
      expect(brokenError).toBeTruthy();

      let details = result.details as unknown as ParseValidationDetails;
      expect(details).toBeTruthy();
      expect(details.filesWithErrors).toBeGreaterThan(0);

      // Read back the ParseResult card to verify it was persisted as failed
      let cardRead = await client.read(realmUrl, details.parseResultId);
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

  test('ParseValidationStep e2e: no files to validate passes vacuously (bootstrap)', async ({
    realm,
  }) => {
    let realmUrl = realm.realmURL.href;
    let realmServerUrl = realm.realmServerURL.href;
    let realmToken = realm.authorizationHeaders()['Authorization'];
    let parseResultsModuleUrl = `${realmServerUrl}software-factory/parse-result`;

    let { client, cleanup } = buildTestClient({
      realmUrl,
      realmToken,
      realmServerUrl,
      realmServerToken: realm.serverToken,
    });

    try {
      let workspace = createTestWorkspace();

      // Simulate a bootstrap scenario: no .gts files and no specs.
      // Inject empty file list so pre-existing fixture files don't interfere.
      let step = new ParseValidationStep({
        client,
        realmServerUrl,
        parseResultsModuleUrl,
        workspaceDir: workspace.dir,
        issueId: 'Issues/parse-bootstrap-e2e',
        fetchFilenames: async () => ({ filenames: [] }),
        searchSpecsFn: async () => ({ specs: [] }),
      });

      let result = await step.run(realmUrl);

      // Nothing to validate → pass with no files checked, no artifact created
      expect(result.step).toBe('parse');
      expect(result.passed).toBe(true);
      expect(result.files).toEqual([]);
      expect(result.errors).toEqual([]);
    } finally {
      cleanup();
    }
  });
});
