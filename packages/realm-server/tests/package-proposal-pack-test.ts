import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, join } from 'path';
import { tmpdir } from 'os';
import { mkdtemp, rm } from 'fs/promises';
import { readStoredFile, unpack } from '@cardstack/deck/node';
import { publishToStore } from '@cardstack/deck/node';
import { packLibrary } from '../handlers/handle-package-proposals.ts';

const NAME = 'lib/palette';
const SOURCE = `export const VERSION = '9.9.9';
export function pick(name) { return name; }
`;

async function withStore(fn: (dir: string) => Promise<void>) {
  let dir = await mkdtemp(join(tmpdir(), 'proposal-pack-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

module(basename(import.meta.filename), function () {
  module('the bytes a proposal is a claim about', function () {
    test('the seal is a pure function of the source', function (assert) {
      // Everything downstream leans on this. Acceptance re-derives the seal
      // and refuses to publish if it differs from the one that was reviewed,
      // which is only a check at all if packing is deterministic.
      let a = unpack(packLibrary(NAME, '9.9.9', SOURCE)).treeHash;
      let b = unpack(packLibrary(NAME, '9.9.9', SOURCE)).treeHash;
      assert.strictEqual(a, b, 'same bytes, same seal');
      assert.notStrictEqual(
        a,
        unpack(packLibrary(NAME, '9.9.9', `${SOURCE}// touched\n`)).treeHash,
        'and a changed body is a different seal',
      );
    });

    test('a version cut here is publishable as-is', async function (assert) {
      // The store checks that the pack's own importmap.json agrees with the
      // version being published. A pack that failed that would propose fine
      // and then blow up at accept time — after the review, which is the
      // worst possible moment to discover it.
      await withStore(async (dir) => {
        let bytes = packLibrary(NAME, '9.9.9', SOURCE);
        let record = await publishToStore(dir, NAME, '9.9.9', bytes);
        assert.strictEqual(record.treeHash, unpack(bytes).treeHash);
        let served = await readStoredFile(dir, NAME, '9.9.9', 'index.js');
        assert.strictEqual(
          served?.toString('utf8'),
          SOURCE,
          'and the module served back is the source that was proposed',
        );
      });
    });
  });
});
