import { resolve } from 'node:path';

import type { BoxelCLIClient } from '@cardstack/boxel-cli/api';

import { expect, test } from './fixtures.ts';

import { runEvaluateInMemory } from '../src/eval-execution.ts';
import { buildTestClient } from './helpers/test-client.ts';

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

// A .gts module with a broken import that should fail evaluation. The
// import must be consumed as a field type — unused imports are tree-shaken
// by the compiler and the Loader never sees them.
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

test.describe('runEvaluateInMemory e2e', () => {
  test('clean realm returns status: passed with no realm artifacts', async ({
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
      // The fixture realm ships with a clean hello.gts, home.gts, and a
      // hello.test.gts (which must be excluded from evaluation).
      let result = await runEvaluateInMemory({
        targetRealm: realmUrl,
        realmServerUrl,
        client,
      });

      expect(result.status).toBe('passed');
      expect(result.modulesWithErrors).toBe(0);
      expect(result.modulesChecked).toBeGreaterThan(0);
      expect(result.evaluableFiles).toContain('hello.gts');
      expect(result.evaluableFiles).not.toContain('hello.test.gts');
      expect(result.failures).toEqual([]);
      expect(result.errorMessage).toBeUndefined();

      // In-memory tool must not write any EvalResult card artifact.
      let listing = await client.listFiles(realmUrl);
      let validationArtifacts = (listing.filenames ?? []).filter((f) =>
        f.startsWith('Validations/eval_'),
      );
      expect(validationArtifacts).toEqual([]);
    } finally {
      cleanup();
    }
  });

  test('module with broken import produces status: failed with no realm artifacts', async ({
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

      let result = await runEvaluateInMemory({
        targetRealm: realmUrl,
        realmServerUrl,
        client,
      });

      expect(result.status).toBe('failed');
      expect(result.modulesWithErrors).toBeGreaterThan(0);
      expect(result.evaluableFiles).toContain('broken-module.gts');

      let brokenFailure = result.failures.find((f) =>
        f.path.includes('broken-module'),
      );
      expect(brokenFailure).toBeTruthy();
      expect(brokenFailure!.error).toBeTruthy();
      // The error should be a real eval failure from the sandbox, not
      // infrastructure noise.
      expect(brokenFailure!.error).not.toContain('unable to fetch');
      expect(brokenFailure!.error).not.toContain('Command runner failed');
      expect(brokenFailure!.error).not.toContain('Missing Authorization');

      // In-memory tool must not write any EvalResult card artifact even
      // when there are evaluation failures.
      let listing = await client.listFiles(realmUrl);
      let validationArtifacts = (listing.filenames ?? []).filter((f) =>
        f.startsWith('Validations/eval_'),
      );
      expect(validationArtifacts).toEqual([]);
    } finally {
      cleanup();
    }
  });

  test('no evaluable modules produces a vacuous pass', async ({ realm }) => {
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
      // Delete every ESM module shipped with the fixture realm.
      let listingBefore = await client.listFiles(realmUrl);
      let esmPattern = /\.(gts|gjs|ts|js)$/;
      for (let filename of listingBefore.filenames ?? []) {
        if (esmPattern.test(filename)) {
          let deleteResult = await client.delete(realmUrl, filename);
          expect(
            deleteResult.ok,
            `delete ${filename} failed: ${deleteResult.error}`,
          ).toBe(true);
        }
      }

      let result = await runEvaluateInMemory({
        targetRealm: realmUrl,
        realmServerUrl,
        client,
      });

      expect(result.status).toBe('passed');
      expect(result.modulesChecked).toBe(0);
      expect(result.modulesWithErrors).toBe(0);
      expect(result.evaluableFiles).toEqual([]);
      expect(result.failures).toEqual([]);
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
    } as unknown as BoxelCLIClient;

    let result = await runEvaluateInMemory({
      targetRealm: 'http://localhost:1/',
      realmServerUrl: 'http://localhost:1/',
      client: thrower,
    });

    expect(result.status).toBe('error');
    expect(result.errorMessage).toContain('ECONNREFUSED');
    expect(result.evaluableFiles).toEqual([]);
    expect(result.failures).toEqual([]);
  });

  test('path option: evaluates only the named file and skips the rest of the realm', async ({
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
      // Seed both a clean and a broken module alongside the fixture's clean
      // hello.gts. Targeting just the broken file should fail; targeting
      // the clean file should pass even though the broken module is still
      // present in the realm.
      let writeClean = await client.write(
        realmUrl,
        'valid-card.gts',
        VALID_MODULE_GTS,
      );
      expect(writeClean.ok).toBe(true);
      expect(
        await client.waitForFile(realmUrl, 'valid-card.gts', {
          pollMs: 300,
          timeoutMs: 30_000,
        }),
      ).toBe(true);

      let writeBroken = await client.write(
        realmUrl,
        'broken-module.gts',
        BROKEN_MODULE_GTS,
      );
      expect(writeBroken.ok).toBe(true);
      expect(
        await client.waitForFile(realmUrl, 'broken-module.gts', {
          pollMs: 300,
          timeoutMs: 30_000,
        }),
      ).toBe(true);

      // Evaluate only the clean file — should pass.
      let cleanOnly = await runEvaluateInMemory({
        targetRealm: realmUrl,
        realmServerUrl,
        client,
        path: 'valid-card.gts',
      });
      expect(cleanOnly.status).toBe('passed');
      expect(cleanOnly.evaluableFiles).toEqual(['valid-card.gts']);
      expect(cleanOnly.modulesChecked).toBe(1);
      expect(cleanOnly.modulesWithErrors).toBe(0);
      expect(cleanOnly.failures).toEqual([]);

      // Evaluate only the broken file — should fail and mention only that file.
      let brokenOnly = await runEvaluateInMemory({
        targetRealm: realmUrl,
        realmServerUrl,
        client,
        path: 'broken-module.gts',
      });
      expect(brokenOnly.status).toBe('failed');
      expect(brokenOnly.evaluableFiles).toEqual(['broken-module.gts']);
      expect(brokenOnly.modulesChecked).toBe(1);
      expect(brokenOnly.modulesWithErrors).toBe(1);
      let fileSet = new Set(brokenOnly.failures.map((f) => f.path));
      expect(Array.from(fileSet)).toEqual(['broken-module.gts']);

      // Still no realm artifact written.
      let listing = await client.listFiles(realmUrl);
      let validationArtifacts = (listing.filenames ?? []).filter((f) =>
        f.startsWith('Validations/eval_'),
      );
      expect(validationArtifacts).toEqual([]);
    } finally {
      cleanup();
    }
  });

  test('path option: non-evaluable extension returns status: error without a realm call', async () => {
    let listFilesCalls = 0;
    let runCommandCalls = 0;
    let stubClient: BoxelCLIClient = {
      listFiles: async () => {
        listFilesCalls += 1;
        return { filenames: [] };
      },
      runCommand: async () => {
        runCommandCalls += 1;
        throw new Error('should not be called for non-evaluable path');
      },
    } as unknown as BoxelCLIClient;

    let result = await runEvaluateInMemory({
      targetRealm: 'http://localhost:1/',
      realmServerUrl: 'http://localhost:1/',
      client: stubClient,
      path: 'Spec/sticky-note.json',
    });

    expect(result.status).toBe('error');
    expect(result.errorMessage).toContain('not evaluable');
    expect(result.evaluableFiles).toEqual([]);
    expect(result.failures).toEqual([]);
    expect(listFilesCalls).toBe(0);
    expect(runCommandCalls).toBe(0);
  });

  test('path option: test file (*.test.gts) returns status: error without a realm call', async () => {
    let runCommandCalls = 0;
    let stubClient: BoxelCLIClient = {
      listFiles: async () => ({ filenames: [] }),
      runCommand: async () => {
        runCommandCalls += 1;
        throw new Error('should not be called for test path');
      },
    } as unknown as BoxelCLIClient;

    let result = await runEvaluateInMemory({
      targetRealm: 'http://localhost:1/',
      realmServerUrl: 'http://localhost:1/',
      client: stubClient,
      path: 'hello.test.gts',
    });

    expect(result.status).toBe('error');
    expect(result.errorMessage).toContain('test file');
    expect(result.evaluableFiles).toEqual([]);
    expect(result.failures).toEqual([]);
    expect(runCommandCalls).toBe(0);
  });
});
