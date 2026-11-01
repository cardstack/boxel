import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stageRealmSources } from '../realm-source-staging.ts';
import type { SharedTests } from '../helpers/index.ts';

const PREFIXES = ['@cardstack/catalog/'];

async function inTempDir(run: (tempDir: string) => Promise<void>) {
  let tempDir = mkdtempSync(join(tmpdir(), 'realm-source-staging-'));
  try {
    await run(tempDir);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

const tests = Object.freeze({
  'never reads the prefix map for files that import no prefix realm': async (
    assert,
  ) => {
    await inTempDir(async (tempDir) => {
      let reads = 0;
      let warnings: string[] = [];
      let result = await stageRealmSources({
        tempDir,
        files: [
          {
            path: 'thing.gts',
            content: `import { CardDef } from '@cardstack/base/card-api';\nexport class Thing extends CardDef {}\n`,
          },
        ],
        prefixes: PREFIXES,
        readPrefixRealmURLs: async () => {
          reads++;
          throw new Error('the realm server was asked');
        },
        onWarn: (message) => warnings.push(message),
      });
      assert.strictEqual(reads, 0, 'the map was not read');
      assert.deepEqual(result.shimmedPrefixes, []);
      assert.deepEqual(warnings, [], 'nothing to warn about');
    });
  },

  'shims every referenced prefix, naming the cause, when the map cannot be read':
    async (assert) => {
      await inTempDir(async (tempDir) => {
        let reads = 0;
        let warnings: string[] = [];
        let result = await stageRealmSources({
          tempDir,
          files: [
            {
              path: 'post.gts',
              content: `import { Author } from '@cardstack/catalog/blog/author';\n`,
            },
          ],
          prefixes: PREFIXES,
          readPrefixRealmURLs: async () => {
            reads++;
            throw new Error(
              'Could not read the prefix realm map from https://realms.example.test/_prefix-realms: HTTP 503',
            );
          },
          onWarn: (message) => warnings.push(message),
        });
        assert.strictEqual(reads, 1, 'the map was read once');
        assert.deepEqual(result.shimmedPrefixes, ['@cardstack/catalog/']);
        assert.ok(
          existsSync(join(tempDir, 'realm-shims.d.ts')),
          'the shim is written',
        );
        assert.deepEqual(warnings, [
          'Could not read the prefix realm map from https://realms.example.test/_prefix-realms: HTTP 503 — realm-prefixed imports (@cardstack/catalog/) fall back to the ambient shim.',
        ]);
      });
    },
} as SharedTests<{}>);

export default tests;
