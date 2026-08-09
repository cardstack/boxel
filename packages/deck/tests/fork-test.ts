import QUnit from 'qunit';
const { module, test } = QUnit;
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { forkDeck } from '../src/fork.ts';
import { pack, packFromDir } from '../src/pack.ts';
import { publishToStore, readStoreMeta } from '../src/store.ts';
import { treeHashFromDir } from '../src/tree-hash.ts';

let depotDir: string;
let storeDir: string;

module('fork: change someone else\'s deck without touching theirs', function (
  hooks,
) {
  hooks.beforeEach(async function () {
    depotDir = join(await mkdtemp(join(tmpdir(), 'deck-fork-')), 'demo');
    storeDir = join(depotDir, '.deck', 'store');
    await mkdir(join(depotDir, 'acme', 'palette', 'util'), { recursive: true });
    await writeFile(
      join(depotDir, 'acme', 'palette', 'importmap.json'),
      JSON.stringify(
        {
          imports: {},
          deck: {
            packages: {
              palette: { version: '1.0.0', entry: '$DECK/palette.js' },
            },
          },
        },
        null,
        2,
      ) + '\n',
    );
    await writeFile(
      join(depotDir, 'acme', 'palette', 'palette.js'),
      'export const colors = 3;\n',
    );
    await writeFile(
      join(depotDir, 'acme', 'palette', 'util', 'mix.js'),
      'export const mix = 1;\n',
    );
  });

  hooks.afterEach(async function () {
    await rm(join(depotDir, '..'), { recursive: true, force: true });
  });

  test('forking live copies the tree into YOUR scope, whole', async function (assert) {
    let result = await forkDeck({
      depotDir,
      storeDir,
      from: { publisher: 'acme', package: 'palette' },
      to: { publisher: 'you', package: 'palette' },
    });
    assert.deepEqual(result.files, [
      'importmap.json',
      'palette.js',
      'util/mix.js',
    ]);
    assert.strictEqual(
      (await readFile(join(depotDir, 'you', 'palette', 'palette.js'))).toString(),
      'export const colors = 3;\n',
    );
    let map = JSON.parse(
      await readFile(join(depotDir, 'you', 'palette', 'importmap.json'), 'utf8'),
    );
    assert.strictEqual(
      map.deck.packages.palette.forkedFrom.package,
      'acme/palette',
      'lineage is recorded in the fork itself, not in a side table',
    );
    assert.strictEqual(
      map.deck.packages.palette.forkedFrom.treeHash,
      result.baseTreeHash,
      'and it records the BASE TREE — the third input a later merge needs',
    );
    assert.strictEqual(
      map.deck.packages.palette.forkedFrom.version,
      undefined,
      'forked from the live tree, so no version to name',
    );
    assert.strictEqual(
      map.deck.packages.palette.version,
      '1.0.0',
      'the version line is the same NUMBER but a different NAME — you/palette',
    );
  });

  test('an undiverged fork has the same treeHash — the store holds one copy', async function (assert) {
    // Fork a SEALED version, so both trees are byte-identical by construction.
    await publishToStore(
      storeDir,
      'acme/palette',
      '1.0.0',
      await packFromDir(join(depotDir, 'acme', 'palette')),
      { tag: 'latest' },
    );
    await forkDeck({
      depotDir,
      storeDir,
      from: { publisher: 'acme', package: 'palette', spec: 'latest' },
      to: { publisher: 'you', package: 'palette' },
    });
    // The rewritten map records the fork, so the trees differ by that line…
    let source = await treeHashFromDir(join(depotDir, 'acme', 'palette'));
    let fork = await treeHashFromDir(join(depotDir, 'you', 'palette'));
    assert.notStrictEqual(
      fork.treeHash,
      source.treeHash,
      'a fork says it is one — that is content, so it changes the hash',
    );

    // …but publishing an IDENTICAL tree under the new name still writes no
    // new bytes, which is the property that makes forking cheap.
    let bytes = await packFromDir(join(depotDir, 'acme', 'palette'));
    await publishToStore(storeDir, 'you/palette', '1.0.0', bytes);
    let acme = await readStoreMeta(storeDir, 'acme/palette');
    let mine = await readStoreMeta(storeDir, 'you/palette');
    assert.strictEqual(
      acme!.versions['1.0.0'].treeHash,
      mine!.versions['1.0.0'].treeHash,
      'same content, same identity',
    );
  });

  test('the two version lines are independent', async function (assert) {
    await publishToStore(
      storeDir,
      'acme/palette',
      '1.0.0',
      await packFromDir(join(depotDir, 'acme', 'palette')),
      { tag: 'latest' },
    );
    await forkDeck({
      depotDir,
      storeDir,
      from: { publisher: 'acme', package: 'palette', spec: '1.0.0' },
      to: { publisher: 'you', package: 'palette' },
    });
    await writeFile(
      join(depotDir, 'you', 'palette', 'palette.js'),
      'export const colors = 99;\n',
    );
    await publishToStore(
      storeDir,
      'you/palette',
      '1.0.0-dev.1',
      await packFromDir(join(depotDir, 'you', 'palette')),
      { tag: 'dev' },
    );

    let acme = await readStoreMeta(storeDir, 'acme/palette');
    assert.deepEqual(
      Object.keys(acme!.versions),
      ['1.0.0'],
      "the experiment left acme's version list alone",
    );
    assert.deepEqual(acme!.tags, { latest: '1.0.0' });
    let mine = await readStoreMeta(storeDir, 'you/palette');
    assert.deepEqual(mine!.tags, { dev: '1.0.0-dev.1' });
  });

  test('renaming on fork moves the package key with it', async function (assert) {
    await forkDeck({
      depotDir,
      storeDir,
      from: { publisher: 'acme', package: 'palette' },
      to: { publisher: 'you', package: 'palette-hdr' },
    });
    let map = JSON.parse(
      await readFile(
        join(depotDir, 'you', 'palette-hdr', 'importmap.json'),
        'utf8',
      ),
    );
    assert.deepEqual(Object.keys(map.deck.packages), ['palette-hdr']);
    assert.strictEqual(map.deck.packages['palette-hdr'].version, '1.0.0');
  });

  test('forking onto an existing deck refuses unless told twice', async function (assert) {
    await forkDeck({
      depotDir,
      storeDir,
      from: { publisher: 'acme', package: 'palette' },
      to: { publisher: 'you', package: 'palette' },
    });
    await assert.rejects(
      forkDeck({
        depotDir,
        storeDir,
        from: { publisher: 'acme', package: 'palette' },
        to: { publisher: 'you', package: 'palette' },
      }),
      /already exists/,
    );
    await writeFile(
      join(depotDir, 'you', 'palette', 'palette.js'),
      'mine\n',
    );
    let forced = await forkDeck({
      depotDir,
      storeDir,
      from: { publisher: 'acme', package: 'palette' },
      to: { publisher: 'you', package: 'palette' },
      force: true,
    });
    assert.strictEqual(forced.files.length, 3);
    assert.strictEqual(
      (await readFile(join(depotDir, 'you', 'palette', 'palette.js'))).toString(),
      'export const colors = 3;\n',
    );
  });

  test('a fork of a version that does not exist is refused', async function (assert) {
    await assert.rejects(
      forkDeck({
        depotDir,
        storeDir,
        from: { publisher: 'acme', package: 'palette', spec: '9.9.9' },
        to: { publisher: 'you', package: 'palette' },
      }),
      /no published versions/,
    );
    await publishToStore(
      storeDir,
      'acme/palette',
      '1.0.0',
      pack([
        { path: 'importmap.json', bytes: Buffer.from('{}') },
        { path: 'a.js', bytes: Buffer.from('1\n') },
      ]),
    );
    await assert.rejects(
      forkDeck({
        depotDir,
        storeDir,
        from: { publisher: 'acme', package: 'palette', spec: '9.9.9' },
        to: { publisher: 'you', package: 'palette' },
      }),
      /is not a published version/,
    );
  });
});
