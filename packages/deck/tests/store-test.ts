import QUnit from 'qunit';
const { module, test } = QUnit;
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pack, unpack } from '../src/pack.ts';
import {
  inspectStore,
  migrateStore,
  pruneDevVersions,
  publishToStore,
  readStoredFile,
  readStoredPack,
  readStoreMeta,
  releaseVersion,
} from '../src/store.ts';
import { listObjects, listTrees } from '../src/object-store.ts';

function libFiles(base: string, body: string) {
  return [
    {
      path: 'importmap.json',
      bytes: Buffer.from(
        JSON.stringify({
          deck: {
            packages: { lib: { version: base, entry: '$DECK/lib.js' } },
          },
        }),
      ),
    },
    { path: 'lib.js', bytes: Buffer.from(body) },
  ];
}

async function treeCount(storeDir: string): Promise<number> {
  return (await listTrees(storeDir)).length;
}

async function objectCount(storeDir: string): Promise<number> {
  return (await listObjects(storeDir)).length;
}

module('store: content addressing and pruning', function (hooks) {
  let storeDir: string;

  hooks.beforeEach(async function () {
    storeDir = await mkdtemp(join(tmpdir(), 'deck-store-test-'));
  });

  hooks.afterEach(async function () {
    await rm(storeDir, { recursive: true, force: true });
  });

  test('identical content published twice stores ONE tree', async function (assert) {
    let bytes = pack(libFiles('1.0.0', 'export const v = 1;\n'));
    await publishToStore(storeDir, 'lib', '1.0.0-dev.1', bytes);
    await publishToStore(storeDir, 'lib', '1.0.0-dev.2', bytes);
    assert.strictEqual(await treeCount(storeDir), 1);
    assert.strictEqual(await objectCount(storeDir), 2, 'importmap + lib.js');
    let meta = await readStoreMeta(storeDir, 'lib');
    assert.strictEqual(
      meta!.versions['1.0.0-dev.1'].treeHash,
      meta!.versions['1.0.0-dev.2'].treeHash,
      'two pointers at one tree',
    );
    assert.strictEqual(
      meta!.versions['1.0.0-dev.1'].file,
      undefined,
      'a new record names no archive',
    );
  });

  test('pruning keeps the newest dev versions and never touches stables or tags', async function (assert) {
    for (let n of [1, 2, 3, 4]) {
      await publishToStore(
        storeDir,
        'lib',
        `1.0.0-dev.${n}`,
        pack(libFiles('1.0.0', `export const v = ${n};\n`)),
        { tag: 'dev' },
      );
    }
    // dev.4 is the release source; dev tag still points at it
    await releaseVersion(
      storeDir,
      'lib',
      '1.0.0',
      { tag: 'dev' },
      { tag: 'latest' },
    );
    assert.strictEqual(await treeCount(storeDir), 4);

    let { removedVersions, deletedFiles, gc } = await pruneDevVersions(
      storeDir,
      'lib',
      { keep: 1 },
    );
    // dev.4 is tag-protected, so the prunable set is dev.1..dev.3; keep 1 →
    // dev.1 and dev.2 go.
    assert.deepEqual(removedVersions, ['1.0.0-dev.1', '1.0.0-dev.2']);
    assert.deepEqual(deletedFiles, [], 'no legacy archives in this store');
    assert.strictEqual(gc.treesDeleted, 2);

    let meta = await readStoreMeta(storeDir, 'lib');
    assert.deepEqual(
      Object.keys(meta!.versions).sort(),
      ['1.0.0', '1.0.0-dev.3', '1.0.0-dev.4'],
      'stable + tagged dev + the kept dev survive',
    );
    assert.deepEqual(meta!.tags, { dev: '1.0.0-dev.4', latest: '1.0.0' });
    assert.strictEqual(await treeCount(storeDir), 2);
    assert.strictEqual(
      await objectCount(storeDir),
      3,
      'one shared importmap plus the two surviving lib.js bodies',
    );
  });

  test('a released stable survives pruning of the dev version it was cut from', async function (assert) {
    // The content-addressing hazard: 1.0.0 and 1.0.0-dev.1 SHARE one file.
    await publishToStore(
      storeDir,
      'lib',
      '1.0.0-dev.1',
      pack(libFiles('1.0.0', 'export const v = 1;\n')),
    );
    await releaseVersion(
      storeDir,
      'lib',
      '1.0.0',
      { version: '1.0.0-dev.1' },
      { tag: 'latest' },
    );
    // a newer dev so the older one is prunable
    await publishToStore(
      storeDir,
      'lib',
      '1.0.0-dev.2',
      pack(libFiles('1.0.0', 'export const v = 2;\n')),
      { tag: 'dev' },
    );

    let { removedVersions, gc } = await pruneDevVersions(storeDir, 'lib', {
      keep: 0,
    });
    assert.deepEqual(removedVersions, ['1.0.0-dev.1']);
    assert.strictEqual(
      gc.treesDeleted,
      0,
      'its tree is still referenced by the stable — nothing deleted',
    );
    assert.strictEqual(gc.objectsDeleted, 0);
    let served = await readStoredPack(storeDir, 'lib', '1.0.0');
    assert.true(
      served !== undefined && served.length > 0,
      'the released stable still serves after its dev source was pruned',
    );
  });

  test('pruning is a no-op below the keep threshold', async function (assert) {
    await publishToStore(
      storeDir,
      'lib',
      '1.0.0-dev.1',
      pack(libFiles('1.0.0', 'export const v = 1;\n')),
    );
    let result = await pruneDevVersions(storeDir, 'lib', { keep: 10 });
    assert.deepEqual(result.removedVersions, []);
    assert.strictEqual(await treeCount(storeDir), 1);
    assert.deepEqual(result.gc, {
      treesDeleted: 0,
      objectsDeleted: 0,
      bytesFreed: 0,
    });
  });

  // The measured failure that motivated per-file addressing: editing one
  // module in a 374-module vendored package used to cost a whole second
  // copy of the package.
  test('editing ONE file in a large tree costs ONE object', async function (assert) {
    let many = (marker: string) => [
      {
        path: 'importmap.json',
        bytes: Buffer.from(
          JSON.stringify({
            imports: {},
            deck: { packages: { big: { version: '1.0.0' } } },
          }) + '\n',
        ),
      },
      ...Array.from({ length: 40 }, (_ignored, index) => ({
        path: `src/mod${index}.js`,
        bytes: Buffer.from(
          index === 7
            ? `export const v = ${marker};\n`
            : `export const v = ${index};\n`,
        ),
      })),
    ];
    await publishToStore(storeDir, 'big', '1.0.0-dev.1', pack(many('7')));
    let before = await objectCount(storeDir);
    await publishToStore(storeDir, 'big', '1.0.0-dev.2', pack(many('999')));
    assert.strictEqual(
      (await objectCount(storeDir)) - before,
      1,
      'one changed module, one new object — the other 40 files are shared',
    );
    assert.strictEqual(await treeCount(storeDir), 2);
  });

  test('an undiverged fork stores nothing new, across publishers', async function (assert) {
    let bytes = pack(libFiles('1.0.0', 'export const v = 1;\n'));
    await publishToStore(storeDir, 'acme/lib', '1.0.0', bytes);
    let before = await objectCount(storeDir);
    await publishToStore(storeDir, 'you/lib', '1.0.0', bytes);
    assert.strictEqual(await objectCount(storeDir), before);
    assert.strictEqual(await treeCount(storeDir), 1, 'one tree, two owners');
  });

  test('the rebuilt pack is byte-identical to the published one', async function (assert) {
    let bytes = pack(libFiles('1.0.0', 'export const v = 1;\n'), {
      createdBy: 'store-test',
    });
    await publishToStore(storeDir, 'lib', '1.0.0', bytes);
    let rebuilt = await readStoredPack(storeDir, 'lib', '1.0.0');
    assert.true(
      rebuilt !== undefined && rebuilt.equals(bytes),
      'canonical-zip-v1 plus the packlist reproduce the seal exactly',
    );
  });

  // Stores written before per-file addressing keep working, so nobody has
  // to migrate to keep serving.
  test('a legacy packs/ store is still readable', async function (assert) {
    let bytes = pack(libFiles('1.0.0', 'export const v = 9;\n'));
    let treeHash = unpack(bytes).treeHash;
    await mkdir(join(storeDir, 'lib', 'packs'), { recursive: true });
    await writeFile(
      join(storeDir, 'lib', 'packs', `${treeHash}.pack.zip`),
      bytes,
    );
    await writeFile(
      join(storeDir, 'lib', 'meta.json'),
      JSON.stringify({
        name: 'lib',
        versions: {
          '1.0.0': { treeHash, file: `packs/${treeHash}.pack.zip` },
        },
        tags: { latest: '1.0.0' },
      }),
    );
    assert.strictEqual(await objectCount(storeDir), 0, 'no objects at all');
    let served = await readStoredPack(storeDir, 'lib', '1.0.0');
    assert.true(served !== undefined && served.equals(bytes));
    assert.strictEqual(
      (await readStoredFile(storeDir, 'lib', '1.0.0', 'lib.js'))!.toString(
        'utf8',
      ),
      'export const v = 9;\n',
    );
  });

  test('migrate converts a legacy store and proves each rebuild', async function (assert) {
    let bytes = pack(libFiles('1.0.0', 'export const v = 9;\n'));
    let treeHash = unpack(bytes).treeHash;
    await mkdir(join(storeDir, 'lib', 'packs'), { recursive: true });
    await writeFile(join(storeDir, 'lib', 'packs', `${treeHash}.pack.zip`), bytes);
    await writeFile(
      join(storeDir, 'lib', 'meta.json'),
      JSON.stringify({
        name: 'lib',
        versions: {
          '1.0.0': { treeHash, file: `packs/${treeHash}.pack.zip` },
          // Two versions, ONE archive: the shared-file case that a naive
          // migration would delete out from under the survivor.
          '1.0.1': { treeHash, file: `packs/${treeHash}.pack.zip` },
        },
        tags: { latest: '1.0.1' },
      }),
    );

    let dry = await migrateStore(storeDir, { dryRun: true });
    assert.strictEqual(dry.migrated.length, 2, 'dry run reports both');
    assert.strictEqual(await objectCount(storeDir), 0, 'dry run writes nothing');

    let result = await migrateStore(storeDir);
    assert.deepEqual(result.failures, []);
    assert.strictEqual(result.migrated.length, 2);
    assert.strictEqual(result.archivesRemoved.length, 1, 'one shared archive');
    assert.true(result.bytesReclaimed > 0);

    let meta = await readStoreMeta(storeDir, 'lib');
    assert.strictEqual(meta!.versions['1.0.0'].storage, 'blobs-v1');
    assert.strictEqual(meta!.versions['1.0.0'].file, undefined);
    let rebuilt = await readStoredPack(storeDir, 'lib', '1.0.1');
    assert.true(
      rebuilt !== undefined && rebuilt.equals(bytes),
      'the migrated version rebuilds byte-identically',
    );
  });

  test('migrate leaves an archive alone when it cannot prove the rebuild', async function (assert) {
    let bytes = pack(libFiles('1.0.0', 'export const v = 1;\n'));
    await mkdir(join(storeDir, 'lib', 'packs'), { recursive: true });
    let archive = join(storeDir, 'lib', 'packs', 'claimed.pack.zip');
    await writeFile(archive, bytes);
    await writeFile(
      join(storeDir, 'lib', 'meta.json'),
      JSON.stringify({
        name: 'lib',
        // The meta lies about the hash: migration must notice rather than
        // rewrite the record to match whatever the archive happens to be.
        versions: { '1.0.0': { treeHash: 'f'.repeat(64), file: 'packs/claimed.pack.zip' } },
        tags: {},
      }),
    );
    let result = await migrateStore(storeDir);
    assert.strictEqual(result.migrated.length, 0);
    assert.strictEqual(result.failures.length, 1);
    assert.true(result.failures[0].detail.includes('meta claims'));
    assert.strictEqual(result.archivesRemoved.length, 0, 'nothing deleted');
    let meta = await readStoreMeta(storeDir, 'lib');
    assert.strictEqual(meta!.versions['1.0.0'].storage, 'pack-v1');
  });

  test('status reports what is live and what is reclaimable', async function (assert) {
    await publishToStore(
      storeDir,
      'lib',
      '1.0.0',
      pack(libFiles('1.0.0', 'export const v = 1;\n')),
    );
    let report = await inspectStore(storeDir);
    assert.strictEqual(report.packages, 1);
    assert.strictEqual(report.versions, 1);
    assert.strictEqual(report.liveTrees, 1);
    assert.strictEqual(report.reclaimableTrees, 0);
    assert.strictEqual(report.legacyArchives, 0);
    assert.true(report.objects > 0 && report.bytes > 0);
  });

  test('one file can be read without rebuilding the archive', async function (assert) {
    await publishToStore(
      storeDir,
      'lib',
      '1.0.0',
      pack(libFiles('1.0.0', 'export const v = 42;\n')),
    );
    assert.strictEqual(
      (await readStoredFile(storeDir, 'lib', '1.0.0', 'lib.js'))!.toString(
        'utf8',
      ),
      'export const v = 42;\n',
    );
    assert.strictEqual(
      await readStoredFile(storeDir, 'lib', '1.0.0', 'nope.js'),
      undefined,
    );
  });

  // `deckNameForNpm` folds npm's namespace into one segment and is therefore
  // not injective: `@babel/runtime` and `babel-runtime` are both real
  // packages and both arrive here as `babel-runtime`. Per-version provenance
  // stays truthful, so L8 survives; what breaks is L7, because a range would
  // be choosing between versions of two different libraries.
  test('one deck name is one upstream library', async function (assert) {
    let vendored = (npmName: string, version: string) => [
      {
        path: 'importmap.json',
        bytes: Buffer.from(
          JSON.stringify({
            deck: {
              packages: {
                'babel-runtime': {
                  version,
                  entry: '$DECK/lib.js',
                  vendoredFrom: { registry: 'npm', name: npmName, version },
                },
              },
            },
          }),
        ),
      },
      {
        path: 'lib.js',
        bytes: Buffer.from(`export const from = '${npmName}';\n`),
      },
    ];

    await publishToStore(
      storeDir,
      'babel-runtime',
      '7.0.0',
      pack(vendored('@babel/runtime', '7.0.0')),
    );
    assert.strictEqual(
      (await readStoreMeta(storeDir, 'babel-runtime'))!.upstream,
      'npm:@babel/runtime',
      'the first vendored version records the coordinate',
    );

    await assert.rejects(
      publishToStore(
        storeDir,
        'babel-runtime',
        '6.26.0',
        pack(vendored('babel-runtime', '6.26.0')),
      ),
      /already holds versions vendored from npm:@babel\/runtime/,
      'the other babel-runtime cannot share the name',
    );

    // Same library, later version: unaffected.
    await publishToStore(
      storeDir,
      'babel-runtime',
      '7.1.0',
      pack(vendored('@babel/runtime', '7.1.0')),
    );
    assert.deepEqual(
      Object.keys((await readStoreMeta(storeDir, 'babel-runtime'))!.versions),
      ['7.0.0', '7.1.0'],
    );
  });

  // A list of versions is only a timeline if the versions carry times, and
  // the two available times mean different things. The upstream instant is a
  // fact about the library; the local one is a fact about this machine. They
  // are years apart for anything vendored, so a reader that treats either as
  // "the" publish time will sort a 2018 release above a 2024 one — or the
  // reverse — depending on which one it happened to pick.
  test('a version records when it landed here and when upstream published it', async function (assert) {
    let upstreamPublishedAt = '2018-08-27T00:00:00.000Z';
    let vendoredPack = pack([
      {
        path: 'importmap.json',
        bytes: Buffer.from(
          JSON.stringify({
            deck: {
              packages: {
                lib: {
                  version: '1.0.0',
                  entry: '$DECK/lib.js',
                  vendoredFrom: {
                    registry: 'npm',
                    name: 'lib',
                    version: '1.0.0',
                    publishedAt: upstreamPublishedAt,
                  },
                },
              },
            },
          }),
        ),
      },
      { path: 'lib.js', bytes: Buffer.from('export const v = 1;\n') },
    ]);

    let vendoredOn = new Date('2024-03-01T12:00:00.000Z');
    await publishToStore(storeDir, 'lib', '1.0.0-dev.1', vendoredPack, {
      now: vendoredOn,
      tag: 'dev',
    });
    let record = (await readStoreMeta(storeDir, 'lib'))!.versions['1.0.0-dev.1'];
    assert.strictEqual(
      record.publishedAt,
      vendoredOn.toISOString(),
      'the local clock says when this store took it',
    );
    assert.strictEqual(
      record.upstreamPublishedAt,
      upstreamPublishedAt,
      'the upstream clock survives the trip, unrounded and unrewritten',
    );

    // A release names existing bytes as a new version. Nothing was published
    // upstream, so claiming it was would be an invention — but the release
    // itself IS an event, and dating it to the source version's publish would
    // lose the only thing that happened.
    let releasedOn = new Date('2024-06-01T09:30:00.000Z');
    let released = await releaseVersion(
      storeDir,
      'lib',
      '1.0.0',
      { tag: 'dev' },
      { now: releasedOn, tag: 'latest' },
    );
    assert.strictEqual(released.publishedAt, releasedOn.toISOString());
    assert.strictEqual(
      released.upstreamPublishedAt,
      upstreamPublishedAt,
      'same bytes, same upstream — carried, not restamped',
    );
    assert.strictEqual(
      released.treeHash,
      record.treeHash,
      'and still no copy',
    );

    // Migration rewrites records to drop the legacy archive path. The times
    // are facts about the release, not about how its bytes are stored, so
    // they have to survive a change of storage.
    let migrated = await migrateStore(storeDir);
    assert.deepEqual(migrated.failures, []);
    let after = (await readStoreMeta(storeDir, 'lib'))!.versions['1.0.0-dev.1'];
    assert.strictEqual(after.publishedAt, vendoredOn.toISOString());
    assert.strictEqual(after.upstreamPublishedAt, upstreamPublishedAt);
  });

  // Nothing backfills. A store written before these fields existed has no
  // honest time to report, and the alternatives — the file's mtime, the
  // moment it was first read — would make an at-rest store answer differently
  // depending on when it was asked.
  test('a record written without times reads back without times', async function (assert) {
    await mkdir(join(storeDir, 'lib'), { recursive: true });
    await writeFile(
      join(storeDir, 'lib', 'meta.json'),
      JSON.stringify({
        name: 'lib',
        versions: { '1.0.0': { treeHash: 'a'.repeat(64) } },
        tags: {},
      }),
    );
    let record = (await readStoreMeta(storeDir, 'lib'))!.versions['1.0.0'];
    assert.strictEqual(record.publishedAt, undefined);
    assert.strictEqual(record.upstreamPublishedAt, undefined);
    assert.strictEqual(record.storage, 'blobs-v1', 'still normalised on read');
  });
});
