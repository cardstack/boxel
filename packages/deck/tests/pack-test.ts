import QUnit from 'qunit';
const { module, test } = QUnit;
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  listZipPaths,
  readZip,
  readZipEntry,
  writeCanonicalZip,
} from '../src/canonical-zip.ts';
import { pack, packFromDir, peekPacklist, unpack } from '../src/pack.ts';
import { PACKLIST_PATH } from '../src/packlist.ts';
import { hashBytes, treeHashFromEntries } from '../src/tree-hash.ts';

const execFileAsync = promisify(execFile);

function sampleFiles() {
  return [
    { path: 'importmap.json', bytes: Buffer.from('{"boxel":{}}') },
    {
      path: 'accounting/account.js',
      bytes: Buffer.from('export const ACCOUNT = 1;\n'),
    },
    { path: 'people/contact.js', bytes: Buffer.from('export const C = 2;\n') },
    // binary content exercises crc + inflate fidelity
    { path: 'logo.bin', bytes: Buffer.from([0, 1, 2, 255, 254, 0, 7]) },
  ];
}

module('canonical-zip-v1', function () {
  test('zip round-trips entries byte-exactly, in order', function (assert) {
    let entries = sampleFiles();
    let zip = writeCanonicalZip(entries);
    let out = readZip(zip);
    assert.deepEqual(
      out.map((e) => e.path),
      entries.map((e) => e.path),
      'order preserved',
    );
    for (let [i, entry] of out.entries()) {
      assert.true(
        entry.bytes.equals(entries[i].bytes),
        `${entry.path} bytes identical`,
      );
    }
  });

  test('writer is deterministic', function (assert) {
    let a = writeCanonicalZip(sampleFiles());
    let b = writeCanonicalZip(sampleFiles());
    assert.true(a.equals(b), 'same input, identical bytes');
  });

  test('random access without full read', function (assert) {
    let zip = writeCanonicalZip(sampleFiles());
    let bytes = readZipEntry(zip, 'people/contact.js');
    assert.strictEqual(bytes?.toString(), 'export const C = 2;\n');
    assert.strictEqual(readZipEntry(zip, 'nope.js'), undefined);
    assert.deepEqual(
      listZipPaths(zip),
      sampleFiles().map((e) => e.path),
    );
  });

  test('corruption is detected', function (assert) {
    let zip = writeCanonicalZip(sampleFiles());
    // flip a byte inside the first entry's compressed DATA (local header is
    // 30 bytes + the 14-byte name 'importmap.json' → data starts at 44)
    let corrupted = Buffer.from(zip);
    corrupted[44] = corrupted[44] ^ 0xff;
    assert.throws(
      () => readZip(corrupted),
      /crc mismatch|size mismatch|invalid|incorrect|unexpected/i,
    );
    assert.throws(
      () => readZip(Buffer.from('this is not a zip file at all')),
      /not a zip/,
    );
  });
});

module('pack/unpack round-trip laws', function () {
  test('law 1: treeHash survives pack → unpack', function (assert) {
    let files = sampleFiles();
    let direct = treeHashFromEntries(
      files.map(({ path, bytes }) => ({ path, sha256: hashBytes(bytes) })),
    );
    let opened = unpack(pack(files));
    assert.strictEqual(opened.treeHash, direct.treeHash);
    assert.strictEqual(opened.packlist.treeHash.hash, direct.treeHash);
    assert.strictEqual(opened.files.size, files.length);
    for (let { path, bytes } of files) {
      assert.true(opened.files.get(path)!.equals(bytes), `${path} intact`);
    }
  });

  test('law 2: pack ∘ unpack is byte-identical (canonical form)', function (assert) {
    let original = pack(sampleFiles());
    let opened = unpack(original);
    let repacked = pack(
      [...opened.files.entries()].map(([path, bytes]) => ({ path, bytes })),
      opened.packlist.provenance,
    );
    assert.true(repacked.equals(original), 'byte-identical repack');
  });

  test('packing is reproducible and input-order independent', function (assert) {
    let files = sampleFiles();
    let a = pack(files);
    let b = pack([...files].reverse());
    assert.true(a.equals(b), 'entry order canonicalized');
  });

  test('provenance is caller-supplied, never a clock', function (assert) {
    let withProvenance = unpack(
      pack(sampleFiles(), { createdBy: 'chris', sourceDepot: 'test-depot' }),
    );
    assert.strictEqual(withProvenance.packlist.provenance?.createdBy, 'chris');
    let plain = unpack(pack(sampleFiles()));
    assert.strictEqual(
      plain.packlist.provenance,
      undefined,
      'no provenance unless supplied — reproducibility default',
    );
  });

  test('packlist is first and reserved', function (assert) {
    let zip = pack(sampleFiles());
    assert.strictEqual(listZipPaths(zip)[0], PACKLIST_PATH);
    assert.throws(
      () => pack([{ path: PACKLIST_PATH, bytes: Buffer.from('{}') }]),
      /reserved/,
    );
    let peeked = peekPacklist(zip);
    assert.strictEqual(peeked.entries.length, sampleFiles().length);
  });

  test('tampering fails verification on unpack', function (assert) {
    let files = sampleFiles();
    let opened = unpack(pack(files));
    // rebuild a zip with one file's bytes changed but the ORIGINAL packlist
    let tamperedEntries = [
      {
        path: PACKLIST_PATH,
        bytes: readZipEntry(pack(files), PACKLIST_PATH)!,
      },
      ...[...opened.files.entries()].map(([path, bytes]) => ({
        path,
        bytes:
          path === 'people/contact.js'
            ? Buffer.from('export const C = 666;\n')
            : bytes,
      })),
    ];
    let tampered = writeCanonicalZip(tamperedEntries);
    assert.throws(() => unpack(tampered), /hash mismatch|size mismatch/);
  });

  test('packFromDir equals pack of the same files', async function (assert) {
    let dir = await mkdtemp(join(tmpdir(), 'deck-pack-test-'));
    try {
      await writeFile(join(dir, 'a.js'), 'export {};\n');
      let fromDir = await packFromDir(dir);
      let fromFiles = pack([
        { path: 'a.js', bytes: Buffer.from('export {};\n') },
      ]);
      assert.true(fromDir.equals(fromFiles));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('a canonical pack is a standard zip (system unzip agrees)', async function (assert) {
    let dir = await mkdtemp(join(tmpdir(), 'deck-unzip-test-'));
    try {
      let packPath = join(dir, 'sample.pack.zip');
      await writeFile(packPath, pack(sampleFiles()));
      try {
        let { stdout } = await execFileAsync('unzip', ['-l', packPath]);
        assert.true(
          stdout.includes(PACKLIST_PATH) &&
            stdout.includes('accounting/account.js'),
          'stock unzip lists the entries',
        );
        await execFileAsync('unzip', ['-t', packPath]);
        assert.true(true, 'stock unzip integrity test passes');
      } catch (e: unknown) {
        if ((e as { code?: string }).code === 'ENOENT') {
          assert.true(true, 'unzip binary not present; interop check skipped');
        } else {
          throw e;
        }
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
