import QUnit from 'qunit';
const { module, test } = QUnit;

import { mkdtemp, mkdir, writeFile, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { discoverRecentInstanceCardPaths } from '../src/instance-discovery.ts';

function instanceDoc(module: string) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: {},
      meta: { adoptsFrom: { module, name: 'X' } },
    },
  });
}

module(
  'instance-discovery > discoverRecentInstanceCardPaths',
  function (hooks) {
    let workspaceDir: string;

    hooks.beforeEach(async function () {
      workspaceDir = await mkdtemp(join(tmpdir(), 'instance-discovery-test-'));
    });

    hooks.afterEach(async function () {
      await rm(workspaceDir, { recursive: true, force: true });
    });

    async function write(
      relPath: string,
      content: string,
      mtime?: Date,
    ): Promise<void> {
      let abs = join(workspaceDir, relPath);
      await mkdir(join(workspaceDir, relPath.split('/')[0]), {
        recursive: true,
      });
      await writeFile(abs, content);
      if (mtime) await utimes(abs, mtime, mtime);
    }

    test('finds local-module product instances, newest first, capped', async function (assert) {
      await write(
        'PromptTemplate/vision.json',
        instanceDoc('../prompt-template'),
        new Date('2026-07-17T10:00:00Z'),
      );
      await write(
        'Garment/red-jacket.json',
        instanceDoc('../garment'),
        new Date('2026-07-17T12:00:00Z'),
      );

      let paths = await discoverRecentInstanceCardPaths(workspaceDir);

      assert.deepEqual(
        paths,
        ['Garment/red-jacket', 'PromptTemplate/vision'],
        'newest-modified instance first',
      );
    });

    test('excludes control-plane dirs and non-local modules', async function (assert) {
      await write('Issues/some-issue.json', instanceDoc('../darkfactory'));
      await write('Runs/wardrobe.json', instanceDoc('../run-log'));
      await write(
        'Spec/garment.json',
        instanceDoc('https://cardstack.com/base/spec'),
      );
      // Non-local module in a product dir: a card adopted from the base
      // realm is not a product card built by this run.
      await write(
        'Imported/base-thing.json',
        instanceDoc('https://cardstack.com/base/card-def'),
      );
      await write('Garment/tee.json', instanceDoc('../garment'));

      let paths = await discoverRecentInstanceCardPaths(workspaceDir);

      assert.deepEqual(paths, ['Garment/tee']);
    });

    test('caps at the limit', async function (assert) {
      for (let i = 0; i < 6; i++) {
        await write(
          `Garment/g${i}.json`,
          instanceDoc('../garment'),
          new Date(Date.UTC(2026, 6, 17, 10, i)),
        );
      }

      let paths = await discoverRecentInstanceCardPaths(workspaceDir, 4);

      assert.strictEqual(paths.length, 4);
      assert.strictEqual(paths[0], 'Garment/g5', 'newest kept');
    });

    test('returns empty for an empty or missing workspace without throwing', async function (assert) {
      assert.deepEqual(await discoverRecentInstanceCardPaths(workspaceDir), []);
      assert.deepEqual(
        await discoverRecentInstanceCardPaths(join(workspaceDir, 'nope')),
        [],
      );
    });

    test('skips malformed JSON files without failing the scan', async function (assert) {
      await write('Garment/broken.json', '{not json');
      await write('Garment/good.json', instanceDoc('../garment'));

      let paths = await discoverRecentInstanceCardPaths(workspaceDir);

      assert.deepEqual(paths, ['Garment/good']);
    });
  },
);
