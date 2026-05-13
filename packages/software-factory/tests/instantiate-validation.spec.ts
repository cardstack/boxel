import { resolve } from 'node:path';

import { expect, test } from './fixtures';

import { InstantiateValidationStep } from '../src/validators/instantiate-step';
import type { InstantiateValidationDetails } from '../src/validators/instantiate-step';
import {
  seedTagsCardWithBrokenExampleAndSpec,
  seedValidCardWithSpec,
  overwriteTagsExampleWithBadShape,
} from './helpers/instantiate-test-fixtures';
import { buildTestClient } from './helpers/test-client';
import { createTestWorkspace } from './helpers/workspace-fixture';

const fixtureRealmDir = resolve(
  process.cwd(),
  'test-fixtures',
  'test-realm-runner',
);

test.use({ realmDir: fixtureRealmDir });
test.use({ realmServerMode: 'isolated' });

test.describe('instantiate-validation e2e', () => {
  test('InstantiateValidationStep e2e: card with spec and example instantiates successfully', async ({
    realm,
  }) => {
    let realmUrl = realm.realmURL.href;
    let realmServerUrl = realm.realmServerURL.href;
    let authorization = realm.authorizationHeaders()['Authorization'];
    let serverToken = `Bearer ${realm.serverToken}`;
    let instantiateResultsModuleUrl = `${realmServerUrl}software-factory/instantiate-result`;

    let { client, cleanup } = buildTestClient({
      realmUrl,
      realmToken: authorization,
      realmServerUrl,
      realmServerToken: serverToken,
    });

    try {
      await seedValidCardWithSpec(client, realmUrl);

      let workspace = createTestWorkspace();
      await client.pull(realmUrl, workspace.dir);

      let step = new InstantiateValidationStep({
        client,
        realmServerUrl,
        instantiateResultsModuleUrl,
        workspaceDir: workspace.dir,
        issueId: 'Issues/instantiate-e2e',
      });

      let result = await step.run(realmUrl);

      await client.sync(realmUrl, workspace.dir, { preferLocal: true });
      workspace.cleanup();

      // Must pass — valid card with valid example instance
      expect(result.step).toBe('instantiate');
      expect(result.passed).toBe(true);
      expect(result.files).toBeTruthy();
      expect(result.files!.length).toBeGreaterThan(0);

      let details = result.details as unknown as InstantiateValidationDetails;
      expect(details).toBeTruthy();
      expect(details.instantiateResultId).toContain(
        'Validations/instantiate_instantiate-e2e',
      );
      expect(details.cardsChecked).toBeGreaterThan(0);
      expect(details.cardsWithErrors).toBe(0);

      // Read back the InstantiateResult card to verify persistence
      let cardRead = await client.read(realmUrl, details.instantiateResultId);
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

  test('InstantiateValidationStep e2e: containsMany with non-array value fails instantiation', async ({
    realm,
  }) => {
    let realmUrl = realm.realmURL.href;
    let realmServerUrl = realm.realmServerURL.href;
    let authorization = realm.authorizationHeaders()['Authorization'];
    let serverToken = `Bearer ${realm.serverToken}`;
    let instantiateResultsModuleUrl = `${realmServerUrl}software-factory/instantiate-result`;

    let { client, cleanup } = buildTestClient({
      realmUrl,
      realmToken: authorization,
      realmServerUrl,
      realmServerToken: serverToken,
    });

    try {
      await seedTagsCardWithBrokenExampleAndSpec(client, realmUrl);

      let workspace = createTestWorkspace();
      await client.pull(realmUrl, workspace.dir);
      overwriteTagsExampleWithBadShape(workspace.dir);

      let step = new InstantiateValidationStep({
        client,
        realmServerUrl,
        instantiateResultsModuleUrl,
        workspaceDir: workspace.dir,
        issueId: 'Issues/instantiate-fail-e2e',
      });

      let result = await step.run(realmUrl);

      await client.sync(realmUrl, workspace.dir, { preferLocal: true });
      workspace.cleanup();

      // Must fail — containsMany field received a string instead of an array
      expect(result.step).toBe('instantiate');
      expect(result.passed).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);

      let details = result.details as unknown as InstantiateValidationDetails;
      expect(details).toBeTruthy();
      expect(details.cardsWithErrors).toBeGreaterThan(0);

      // Read back the InstantiateResult card to verify it was persisted as failed
      let cardRead = await client.read(realmUrl, details.instantiateResultId);
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
});
