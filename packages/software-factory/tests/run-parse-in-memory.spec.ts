import { resolve } from 'node:path';

import type { BoxelCLIClient } from '@cardstack/boxel-cli/api';

import { expect, test } from './fixtures';

import { runParseInMemory } from '../src/parse-execution';
import {
  BROKEN_EXAMPLE_JSON,
  BROKEN_TEMPLATE_GTS,
  VALID_EXAMPLE_JSON,
  VALID_MODULE_GTS,
} from './helpers/parse-test-fixtures';
import { buildTestClient } from './helpers/test-client';
import { createTestWorkspace } from './helpers/workspace-fixture';

const fixtureRealmDir = resolve(
  process.cwd(),
  'test-fixtures',
  'test-realm-runner',
);

test.use({ realmDir: fixtureRealmDir });
test.use({ realmServerMode: 'isolated' });

/**
 * Wipe every `.gts` / `.gjs` / `.ts` / `.json` file the fixture realm ships
 * with, so whole-realm parse runs only inspect what each individual test
 * writes. The existing `hello.gts`/`home.gts` modules use `Component<typeof
 * this>` and other patterns that can produce glint errors depending on the
 * type-resolution state of the host package, so relying on them as a
 * "clean baseline" is flaky.
 */
async function clearParseableFixtures(
  client: BoxelCLIClient,
  realmUrl: string,
): Promise<void> {
  let listingBefore = await client.listFiles(realmUrl);
  let parseablePattern = /\.(gts|gjs|ts|json)$/;
  for (let filename of listingBefore.filenames ?? []) {
    if (!parseablePattern.test(filename)) continue;
    // Keep realm metadata files.
    if (filename === 'realm.json' || filename === 'index.json') continue;
    let deleteResult = await client.delete(realmUrl, filename);
    expect(
      deleteResult.ok,
      `delete ${filename} failed: ${deleteResult.error}`,
    ).toBe(true);
  }
}

function validSpecJson(): string {
  return JSON.stringify(
    {
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
            module: 'https://cardstack.com/base/spec',
            name: 'Spec',
          },
        },
      },
    },
    null,
    2,
  );
}

test.describe('runParseInMemory e2e', () => {
  test('clean realm returns status: passed with no realm artifacts', async ({
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

    let workspace: ReturnType<typeof createTestWorkspace> | undefined;
    try {
      await clearParseableFixtures(client, realmUrl);

      // Seed: one clean GTS module, a Spec pointing at a valid JSON example.
      let writeModule = await client.write(
        realmUrl,
        'parse-test-card.gts',
        VALID_MODULE_GTS,
      );
      expect(writeModule.ok).toBe(true);
      expect(
        await client.waitForFile(realmUrl, 'parse-test-card.gts', {
          pollMs: 300,
          timeoutMs: 30_000,
        }),
      ).toBe(true);

      let writeExample = await client.write(
        realmUrl,
        'ParseTestCard/example-1.json',
        VALID_EXAMPLE_JSON,
      );
      expect(writeExample.ok).toBe(true);
      expect(
        await client.waitForFile(realmUrl, 'ParseTestCard/example-1.json', {
          pollMs: 300,
          timeoutMs: 30_000,
        }),
      ).toBe(true);

      let writeSpec = await client.write(
        realmUrl,
        'Spec/parse-test-spec.json',
        validSpecJson(),
      );
      expect(writeSpec.ok).toBe(true);
      expect(
        await client.waitForFile(realmUrl, 'Spec/parse-test-spec.json', {
          pollMs: 300,
          timeoutMs: 30_000,
        }),
      ).toBe(true);

      workspace = createTestWorkspace();
      await client.pull(realmUrl, workspace.dir);

      let result = await runParseInMemory({
        targetRealm: realmUrl,
        client,
        workspaceDir: workspace.dir,
      });

      expect(result.status).toBe('passed');
      expect(result.errorCount).toBe(0);
      expect(result.filesWithErrors).toBe(0);
      expect(result.filesChecked).toBeGreaterThan(0);
      expect(result.parseableFiles).toContain('parse-test-card.gts');
      // Discovered JSON examples are normalized to include `.json` so the
      // agent can round-trip any `parseableFiles` entry back through
      // single-file `path` mode.
      expect(result.parseableFiles).toContain('ParseTestCard/example-1.json');
      expect(result.errors).toEqual([]);
      expect(result.errorMessage).toBeUndefined();

      // In-memory tool must not write any ParseResult card artifact.
      let listing = await client.listFiles(realmUrl);
      let validationArtifacts = (listing.filenames ?? []).filter((f) =>
        f.startsWith('Validations/parse_'),
      );
      expect(validationArtifacts).toEqual([]);
    } finally {
      workspace?.cleanup();
      cleanup();
    }
  });

  test('broken GTS template produces status: failed with no realm artifacts', async ({
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
      await clearParseableFixtures(client, realmUrl);

      let writeResult = await client.write(
        realmUrl,
        'broken-card.gts',
        BROKEN_TEMPLATE_GTS,
      );
      expect(writeResult.ok).toBe(true);
      expect(
        await client.waitForFile(realmUrl, 'broken-card.gts', {
          pollMs: 300,
          timeoutMs: 30_000,
        }),
      ).toBe(true);

      let workspace = createTestWorkspace();
      await client.pull(realmUrl, workspace.dir);

      let result = await runParseInMemory({
        targetRealm: realmUrl,
        client,
        workspaceDir: workspace.dir,
      });

      expect(result.status).toBe('failed');
      expect(result.errorCount).toBeGreaterThan(0);
      expect(result.filesWithErrors).toBeGreaterThan(0);
      expect(result.parseableFiles).toContain('broken-card.gts');

      let errorsOnBadFile = result.errors.filter(
        (e) => e.file === 'broken-card.gts',
      );
      expect(errorsOnBadFile.length).toBeGreaterThan(0);
      expect(errorsOnBadFile[0].message).toBeTruthy();

      // No ParseResult card even on failure.
      let listing = await client.listFiles(realmUrl);
      let validationArtifacts = (listing.filenames ?? []).filter((f) =>
        f.startsWith('Validations/parse_'),
      );
      expect(validationArtifacts).toEqual([]);
    } finally {
      cleanup();
    }
  });

  test('no parseable files produces a vacuous pass', async ({ realm }) => {
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
      await clearParseableFixtures(client, realmUrl);

      let workspace = createTestWorkspace();
      await client.pull(realmUrl, workspace.dir);

      let result = await runParseInMemory({
        targetRealm: realmUrl,
        client,
        workspaceDir: workspace.dir,
      });

      expect(result.status).toBe('passed');
      expect(result.errorCount).toBe(0);
      expect(result.filesChecked).toBe(0);
      expect(result.parseableFiles).toEqual([]);
      expect(result.errors).toEqual([]);
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
      // `search` is called in parallel with `listFiles` by discovery; have it
      // resolve with no specs so the thrown listFiles error is the one that
      // surfaces.
      search: async () => ({ ok: true, data: [] }),
    } as unknown as BoxelCLIClient;

    let result = await runParseInMemory({
      targetRealm: 'http://localhost:1/',
      client: thrower,
      workspaceDir: createTestWorkspace().dir,
    });

    expect(result.status).toBe('error');
    expect(result.errorMessage).toContain('ECONNREFUSED');
    expect(result.parseableFiles).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  test('path option: GTS clean and broken single files', async ({ realm }) => {
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
      await clearParseableFixtures(client, realmUrl);

      // Seed both a clean and a broken GTS file.
      let writeClean = await client.write(
        realmUrl,
        'parse-test-card.gts',
        VALID_MODULE_GTS,
      );
      expect(writeClean.ok).toBe(true);
      expect(
        await client.waitForFile(realmUrl, 'parse-test-card.gts', {
          pollMs: 300,
          timeoutMs: 30_000,
        }),
      ).toBe(true);

      let writeBroken = await client.write(
        realmUrl,
        'broken-card.gts',
        BROKEN_TEMPLATE_GTS,
      );
      expect(writeBroken.ok).toBe(true);
      expect(
        await client.waitForFile(realmUrl, 'broken-card.gts', {
          pollMs: 300,
          timeoutMs: 30_000,
        }),
      ).toBe(true);

      let workspace = createTestWorkspace();
      await client.pull(realmUrl, workspace.dir);

      // Parse just the clean file — even though broken-card.gts is dirty,
      // scoping should mean a pass.
      let cleanOnly = await runParseInMemory({
        targetRealm: realmUrl,
        client,
        workspaceDir: workspace.dir,
        path: 'parse-test-card.gts',
      });
      expect(cleanOnly.status).toBe('passed');
      expect(cleanOnly.parseableFiles).toEqual(['parse-test-card.gts']);
      expect(cleanOnly.filesChecked).toBe(1);
      expect(cleanOnly.errorCount).toBe(0);

      // Parse just the broken file — should fail and mention only that file.
      let brokenOnly = await runParseInMemory({
        targetRealm: realmUrl,
        client,
        workspaceDir: workspace.dir,
        path: 'broken-card.gts',
      });
      expect(brokenOnly.status).toBe('failed');
      expect(brokenOnly.parseableFiles).toEqual(['broken-card.gts']);
      expect(brokenOnly.filesChecked).toBe(1);
      expect(brokenOnly.errorCount).toBeGreaterThan(0);
      let fileSet = new Set(brokenOnly.errors.map((e) => e.file));
      expect(Array.from(fileSet)).toEqual(['broken-card.gts']);

      // No ParseResult card written by either invocation.
      let listing = await client.listFiles(realmUrl);
      let validationArtifacts = (listing.filenames ?? []).filter((f) =>
        f.startsWith('Validations/parse_'),
      );
      expect(validationArtifacts).toEqual([]);
    } finally {
      cleanup();
    }
  });

  test('path option: JSON valid and structurally-broken single files', async ({
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
      await clearParseableFixtures(client, realmUrl);

      // Need a module so the valid example card can adopt from it.
      let writeModule = await client.write(
        realmUrl,
        'parse-test-card.gts',
        VALID_MODULE_GTS,
      );
      expect(writeModule.ok).toBe(true);
      expect(
        await client.waitForFile(realmUrl, 'parse-test-card.gts', {
          pollMs: 300,
          timeoutMs: 30_000,
        }),
      ).toBe(true);

      let writeValid = await client.write(
        realmUrl,
        'ParseTestCard/example-1.json',
        VALID_EXAMPLE_JSON,
      );
      expect(writeValid.ok).toBe(true);
      expect(
        await client.waitForFile(realmUrl, 'ParseTestCard/example-1.json', {
          pollMs: 300,
          timeoutMs: 30_000,
        }),
      ).toBe(true);

      let writeBroken = await client.write(
        realmUrl,
        'ParseTestCard/broken-example.json',
        BROKEN_EXAMPLE_JSON,
      );
      expect(writeBroken.ok).toBe(true);
      expect(
        await client.waitForFile(
          realmUrl,
          'ParseTestCard/broken-example.json',
          { pollMs: 300, timeoutMs: 30_000 },
        ),
      ).toBe(true);

      let workspace = createTestWorkspace();
      await client.pull(realmUrl, workspace.dir);

      // Valid JSON → passed.
      let validOnly = await runParseInMemory({
        targetRealm: realmUrl,
        client,
        workspaceDir: workspace.dir,
        path: 'ParseTestCard/example-1.json',
      });
      expect(validOnly.status).toBe('passed');
      expect(validOnly.parseableFiles).toEqual([
        'ParseTestCard/example-1.json',
      ]);
      expect(validOnly.filesChecked).toBe(1);
      expect(validOnly.errorCount).toBe(0);

      // Structurally-broken JSON (missing adoptsFrom) → failed.
      let brokenOnly = await runParseInMemory({
        targetRealm: realmUrl,
        client,
        workspaceDir: workspace.dir,
        path: 'ParseTestCard/broken-example.json',
      });
      expect(brokenOnly.status).toBe('failed');
      expect(brokenOnly.parseableFiles).toEqual([
        'ParseTestCard/broken-example.json',
      ]);
      expect(brokenOnly.filesChecked).toBe(1);
      expect(brokenOnly.errorCount).toBeGreaterThan(0);
      expect(
        brokenOnly.errors.some((e) => e.message.includes('adoptsFrom')),
      ).toBe(true);
    } finally {
      cleanup();
    }
  });

  test('path option: non-parseable extension returns status: error without a realm call', async () => {
    let listFilesCalls = 0;
    let searchCalls = 0;
    let stubClient: BoxelCLIClient = {
      listFiles: async () => {
        listFilesCalls += 1;
        return { filenames: [] };
      },
      search: async () => {
        searchCalls += 1;
        return { ok: true, data: [] };
      },
      read: async () => {
        throw new Error('should not be called for non-parseable path');
      },
    } as unknown as BoxelCLIClient;

    let result = await runParseInMemory({
      targetRealm: 'http://localhost:1/',
      client: stubClient,
      workspaceDir: createTestWorkspace().dir,
      path: 'notes.md',
    });

    expect(result.status).toBe('error');
    expect(result.errorMessage).toContain('not parseable');
    expect(result.parseableFiles).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(listFilesCalls).toBe(0);
    expect(searchCalls).toBe(0);
  });

  test('path option: extensionless path is rejected (extension is required)', async () => {
    let reads = 0;
    let stubClient: BoxelCLIClient = {
      listFiles: async () => {
        throw new Error('should not be called');
      },
      search: async () => {
        throw new Error('should not be called');
      },
      read: async () => {
        reads += 1;
        throw new Error('should not be called for extensionless path');
      },
    } as unknown as BoxelCLIClient;

    let result = await runParseInMemory({
      targetRealm: 'http://localhost:1/',
      client: stubClient,
      workspaceDir: createTestWorkspace().dir,
      path: 'ParseTestCard/example-1',
    });

    expect(result.status).toBe('error');
    expect(result.errorMessage).toContain('not parseable');
    expect(result.parseableFiles).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(reads).toBe(0);
  });
});
