import { resolve } from 'node:path';

import type { BoxelCLIClient } from '@cardstack/boxel-cli/api';

import { expect, test } from './fixtures.ts';

import { runInstantiateInMemory } from '../src/instantiate-execution.ts';
import {
  seedTagsCardWithBrokenExampleAndSpec,
  seedValidCardWithMixedSpecs,
  seedValidCardWithSpec,
  overwriteTagsExampleWithBadShape,
} from './helpers/instantiate-test-fixtures.ts';
import { buildTestClient } from './helpers/test-client.ts';
import { createTestWorkspace } from './helpers/workspace-fixture.ts';

const fixtureRealmDir = resolve(
  process.cwd(),
  'test-fixtures',
  'test-realm-runner',
);

test.use({ realmDir: fixtureRealmDir });
test.use({ realmServerMode: 'isolated' });

test.describe('runInstantiateInMemory e2e', () => {
  test('valid spec + example instantiates and writes no realm artifacts', async ({
    realm,
  }) => {
    let realmUrl = realm.realmURL.href;
    let realmServerUrl = realm.realmServerURL.href;
    let authorization = realm.authorizationHeaders()['Authorization'];
    let serverToken = `Bearer ${realm.serverToken}`;

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

      let result = await runInstantiateInMemory({
        targetRealm: realmUrl,
        realmServerUrl,
        client,
        workspaceDir: workspace.dir,
      });

      expect(result.status).toBe('passed');
      expect(result.instancesChecked).toBeGreaterThan(0);
      expect(result.instancesWithErrors).toBe(0);
      expect(result.failures).toEqual([]);
      expect(result.errorMessage).toBeUndefined();
      expect(result.instanceFiles).toContain('ValidCard/example-1.json');

      // In-memory tool must not write any InstantiateResult artifact.
      let listing = await client.listFiles(realmUrl);
      let validationArtifacts = (listing.filenames ?? []).filter((f) =>
        f.startsWith('Validations/instantiate_'),
      );
      expect(validationArtifacts).toEqual([]);
    } finally {
      cleanup();
    }
  });

  test('component and command Specs are skipped, not failed', async ({
    realm,
  }) => {
    let realmUrl = realm.realmURL.href;
    let realmServerUrl = realm.realmServerURL.href;
    let authorization = realm.authorizationHeaders()['Authorization'];
    let serverToken = `Bearer ${realm.serverToken}`;

    let { client, cleanup } = buildTestClient({
      realmUrl,
      realmToken: authorization,
      realmServerUrl,
      realmServerToken: serverToken,
    });

    try {
      await seedValidCardWithMixedSpecs(client, realmUrl);

      let workspace = createTestWorkspace();
      await client.pull(realmUrl, workspace.dir);

      let result = await runInstantiateInMemory({
        targetRealm: realmUrl,
        realmServerUrl,
        client,
        workspaceDir: workspace.dir,
      });

      // The card Spec's example instantiates; the component and command
      // Specs are not instantiable and must be skipped rather than
      // failing the run (the catalog mortgage-calculator shape).
      expect(result.failures).toEqual([]);
      expect(result.status).toBe('passed');
      expect(result.instancesChecked).toBe(1);
      expect(result.instanceFiles).toEqual(['ValidCard/example-1.json']);
    } finally {
      cleanup();
    }
  });

  test('example with bad field-shape produces status: failed with no realm artifacts', async ({
    realm,
  }) => {
    let realmUrl = realm.realmURL.href;
    let realmServerUrl = realm.realmServerURL.href;
    let authorization = realm.authorizationHeaders()['Authorization'];
    let serverToken = `Bearer ${realm.serverToken}`;

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

      let result = await runInstantiateInMemory({
        targetRealm: realmUrl,
        realmServerUrl,
        client,
        workspaceDir: workspace.dir,
      });

      expect(result.status).toBe('failed');
      expect(result.instancesWithErrors).toBeGreaterThan(0);

      let badFailure = result.failures.find((f) =>
        f.path.includes('bad-example'),
      );
      expect(badFailure).toBeTruthy();
      expect(badFailure!.cardName).toBe('TagsCard');
      expect(badFailure!.error).toBeTruthy();
      // The error should be a real instantiation failure from the sandbox,
      // not infrastructure noise.
      expect(badFailure!.error).not.toContain('unable to fetch');
      expect(badFailure!.error).not.toContain('Command runner failed');
      expect(badFailure!.error).not.toContain('Missing Authorization');

      // In-memory tool must not write any InstantiateResult card artifact
      // even when instantiation fails.
      let listing = await client.listFiles(realmUrl);
      let validationArtifacts = (listing.filenames ?? []).filter((f) =>
        f.startsWith('Validations/instantiate_'),
      );
      expect(validationArtifacts).toEqual([]);
    } finally {
      cleanup();
    }
  });

  test('realm with no Spec cards produces a vacuous pass', async ({
    realm,
  }) => {
    let realmUrl = realm.realmURL.href;
    let realmServerUrl = realm.realmServerURL.href;
    let authorization = realm.authorizationHeaders()['Authorization'];
    let serverToken = `Bearer ${realm.serverToken}`;

    let { client, cleanup } = buildTestClient({
      realmUrl,
      realmToken: authorization,
      realmServerUrl,
      realmServerToken: serverToken,
    });

    let workspace: ReturnType<typeof createTestWorkspace> | undefined;
    try {
      // The fixture realm ships with hello.gts / hello.test.gts but no Spec
      // cards. The in-memory tool — unlike the validation step — must not
      // fail on missing specs; it's a self-check that the agent can run
      // before it has produced any catalog cards.
      workspace = createTestWorkspace();
      await client.pull(realmUrl, workspace.dir);

      let result = await runInstantiateInMemory({
        targetRealm: realmUrl,
        realmServerUrl,
        client,
        workspaceDir: workspace.dir,
      });

      expect(result.status).toBe('passed');
      expect(result.instancesChecked).toBe(0);
      expect(result.instancesWithErrors).toBe(0);
      expect(result.instanceFiles).toEqual([]);
      expect(result.failures).toEqual([]);
      expect(result.errorMessage).toBeUndefined();

      let listing = await client.listFiles(realmUrl);
      let validationArtifacts = (listing.filenames ?? []).filter((f) =>
        f.startsWith('Validations/instantiate_'),
      );
      expect(validationArtifacts).toEqual([]);
    } finally {
      workspace?.cleanup();
      cleanup();
    }
  });

  test('error path: search failure surfaces as status: error', async () => {
    let thrower: BoxelCLIClient = {
      search: async () => {
        throw new Error('ECONNREFUSED');
      },
    } as unknown as BoxelCLIClient;

    let result = await runInstantiateInMemory({
      targetRealm: 'http://localhost:1/',
      realmServerUrl: 'http://localhost:1/',
      client: thrower,
      workspaceDir: createTestWorkspace().dir,
    });

    expect(result.status).toBe('error');
    expect(result.errorMessage).toContain('ECONNREFUSED');
    expect(result.instanceFiles).toEqual([]);
    expect(result.failures).toEqual([]);
  });

  test('path option: instantiates only the named example and skips the rest of the realm', async ({
    realm,
  }) => {
    let realmUrl = realm.realmURL.href;
    let realmServerUrl = realm.realmServerURL.href;
    let authorization = realm.authorizationHeaders()['Authorization'];
    let serverToken = `Bearer ${realm.serverToken}`;

    let { client, cleanup } = buildTestClient({
      realmUrl,
      realmToken: authorization,
      realmServerUrl,
      realmServerToken: serverToken,
    });

    try {
      // Seed BOTH a clean example and a broken example in the same realm.
      // Targeting just one file should succeed or fail on the basis of that
      // file alone — never a mix of the two.
      await seedValidCardWithSpec(client, realmUrl);
      await seedTagsCardWithBrokenExampleAndSpec(client, realmUrl);

      let workspace = createTestWorkspace();
      await client.pull(realmUrl, workspace.dir);
      overwriteTagsExampleWithBadShape(workspace.dir);

      let cleanOnly = await runInstantiateInMemory({
        targetRealm: realmUrl,
        realmServerUrl,
        client,
        workspaceDir: workspace.dir,
        path: 'ValidCard/example-1.json',
      });
      expect(cleanOnly.status).toBe('passed');
      expect(cleanOnly.instanceFiles).toEqual(['ValidCard/example-1.json']);
      expect(cleanOnly.instancesChecked).toBe(1);
      expect(cleanOnly.instancesWithErrors).toBe(0);
      expect(cleanOnly.failures).toEqual([]);

      let brokenOnly = await runInstantiateInMemory({
        targetRealm: realmUrl,
        realmServerUrl,
        client,
        workspaceDir: workspace.dir,
        path: 'TagsCard/bad-example.json',
      });
      expect(brokenOnly.status).toBe('failed');
      expect(brokenOnly.instanceFiles).toEqual(['TagsCard/bad-example.json']);
      expect(brokenOnly.instancesChecked).toBe(1);
      expect(brokenOnly.instancesWithErrors).toBe(1);
      let fileSet = new Set(brokenOnly.failures.map((f) => f.path));
      expect(Array.from(fileSet)).toEqual(['TagsCard/bad-example.json']);
      expect(brokenOnly.failures[0].cardName).toBe('TagsCard');

      // Still no realm artifact written.
      let listing = await client.listFiles(realmUrl);
      let validationArtifacts = (listing.filenames ?? []).filter((f) =>
        f.startsWith('Validations/instantiate_'),
      );
      expect(validationArtifacts).toEqual([]);
    } finally {
      cleanup();
    }
  });

  test('path option: non-.json path returns status: error without a realm call', async () => {
    let searchCalls = 0;
    let runCommandCalls = 0;
    let stubClient: BoxelCLIClient = {
      search: async () => {
        searchCalls += 1;
        return { ok: true, data: [] };
      },
      read: async () => {
        throw new Error('should not be called for non-.json path');
      },
      runCommand: async () => {
        runCommandCalls += 1;
        throw new Error('should not be called for non-.json path');
      },
    } as unknown as BoxelCLIClient;

    let result = await runInstantiateInMemory({
      targetRealm: 'http://localhost:1/',
      realmServerUrl: 'http://localhost:1/',
      client: stubClient,
      workspaceDir: createTestWorkspace().dir,
      path: 'my-card.gts',
    });

    expect(result.status).toBe('error');
    expect(result.errorMessage).toContain('.json');
    expect(result.instanceFiles).toEqual([]);
    expect(result.failures).toEqual([]);
    expect(searchCalls).toBe(0);
    expect(runCommandCalls).toBe(0);
  });

  test('path option: non-existent example returns status: error without leaking infra noise', async ({
    realm,
  }) => {
    let realmUrl = realm.realmURL.href;
    let realmServerUrl = realm.realmServerURL.href;
    let authorization = realm.authorizationHeaders()['Authorization'];
    let serverToken = `Bearer ${realm.serverToken}`;

    let { client, cleanup } = buildTestClient({
      realmUrl,
      realmToken: authorization,
      realmServerUrl,
      realmServerToken: serverToken,
    });

    try {
      let workspace = createTestWorkspace();
      await client.pull(realmUrl, workspace.dir);

      let result = await runInstantiateInMemory({
        targetRealm: realmUrl,
        realmServerUrl,
        client,
        workspaceDir: workspace.dir,
        path: 'Orphan/does-not-exist.json',
      });

      expect(result.status).toBe('error');
      expect(result.errorMessage).toBeTruthy();
      expect(result.errorMessage).toContain('Orphan/does-not-exist.json');
      expect(result.instanceFiles).toEqual([]);
      expect(result.failures).toEqual([]);
    } finally {
      cleanup();
    }
  });
});
