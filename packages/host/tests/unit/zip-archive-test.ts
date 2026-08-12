// The ZIP reader lists an archive's contents from its central directory without
// inflating a single entry, and does it against a bounded tail so a large
// archive can't force an unbounded read. These tests pin both: that a well-
// formed directory parses to the right entries and totals, and that the tail
// window and the non-archive cases degrade honestly.

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type { Loader } from '@cardstack/runtime-common';

import { setupRenderingTest } from '../helpers/setup';

import type * as ZipArchiveModule from '@cardstack/base/zip-archive';

interface ZipFileSpec {
  name: string;
  data: Uint8Array;
  dosDate?: number;
  dosTime?: number;
}

// Assemble a minimal but standards-shaped ZIP (stored, no compression) so the
// reader is exercised against a real local-header + central-directory + EOCD
// layout rather than a hand-faked directory.
function buildZip(files: ZipFileSpec[]): Uint8Array {
  let encoder = new TextEncoder();
  let locals: Uint8Array[] = [];
  let centrals: Uint8Array[] = [];
  let offset = 0;

  for (let file of files) {
    let name = encoder.encode(file.name);
    let dosTime = file.dosTime ?? 0;
    let dosDate = file.dosDate ?? 0;

    let local = new Uint8Array(30 + name.length + file.data.length);
    let lv = new DataView(local.buffer);
    lv.setUint32(0, 0x0403_4b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0, true);
    lv.setUint16(8, 0, true); // stored
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, 0, true); // crc (unused by the reader)
    lv.setUint32(18, file.data.length, true);
    lv.setUint32(22, file.data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);
    local.set(file.data, 30 + name.length);
    locals.push(local);

    let central = new Uint8Array(46 + name.length);
    let cv = new DataView(central.buffer);
    cv.setUint32(0, 0x0201_4b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true); // stored
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, 0, true);
    cv.setUint32(20, file.data.length, true);
    cv.setUint32(24, file.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);

    offset += local.length;
  }

  let centralSize = centrals.reduce((sum, c) => sum + c.length, 0);
  let centralOffset = offset;

  let eocd = new Uint8Array(22);
  let ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x0605_4b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, centralOffset, true);
  ev.setUint16(20, 0, true);

  let total = offset + centralSize + eocd.length;
  let out = new Uint8Array(total);
  let cursor = 0;
  for (let chunk of [...locals, ...centrals, eocd]) {
    out.set(chunk, cursor);
    cursor += chunk.length;
  }
  return out;
}

function bytes(length: number): Uint8Array {
  return new Uint8Array(length);
}

module('Unit | zip-archive', function (hooks) {
  setupRenderingTest(hooks);

  let loader: Loader;
  let parseZipListing: typeof ZipArchiveModule.parseZipListing;
  let extractZipListing: typeof ZipArchiveModule.extractZipListing;
  let readTailBytes: typeof ZipArchiveModule.readTailBytes;

  hooks.beforeEach(async function () {
    loader = getService('loader-service').loader;
    let mod = await loader.import<typeof ZipArchiveModule>(
      `${'https://cardstack.com/base/'}zip-archive`,
    );
    parseZipListing = mod.parseZipListing;
    extractZipListing = mod.extractZipListing;
    readTailBytes = mod.readTailBytes;
  });

  test('lists files with their uncompressed sizes and totals', async function (assert) {
    let zip = buildZip([
      { name: 'README.md', data: bytes(120) },
      { name: 'src/index.ts', data: bytes(340) },
      { name: 'src/util/helpers.ts', data: bytes(88) },
    ]);

    let listing = await extractZipListing(zip);
    assert.ok(listing, 'a listing is produced');
    assert.strictEqual(listing!.entries.length, 3, 'three file entries');
    assert.deepEqual(
      listing!.entries.map((e) => e.path),
      ['README.md', 'src/index.ts', 'src/util/helpers.ts'],
      'paths read in central-directory order',
    );
    assert.strictEqual(
      listing!.entries[1]!.uncompressedSize,
      340,
      'per-entry uncompressed size',
    );
    assert.strictEqual(
      listing!.uncompressedSize,
      548,
      'total uncompressed size',
    );
    assert.false(listing!.truncated, 'a complete directory is not truncated');
  });

  test('drops explicit directory markers, keeping only files', async function (assert) {
    let zip = buildZip([
      { name: 'src/', data: bytes(0) },
      { name: 'src/index.ts', data: bytes(10) },
    ]);
    let listing = await parseZipListing(zip);
    assert.deepEqual(
      listing!.entries.map((e) => e.path),
      ['src/index.ts'],
      'the `src/` directory marker is not listed as a file',
    );
  });

  test('decodes the DOS modification timestamp to UTC ISO-8601', async function (assert) {
    // 2023-06-15 12:30:20 in DOS packing.
    let dosDate = (43 << 9) | (6 << 5) | 15;
    let dosTime = (12 << 11) | (30 << 5) | 10;
    let zip = buildZip([{ name: 'a.txt', data: bytes(1), dosDate, dosTime }]);
    let listing = await parseZipListing(zip);
    assert.strictEqual(
      listing!.entries[0]!.modifiedAt,
      '2023-06-15T12:30:20.000Z',
    );
  });

  test('a zero DOS timestamp yields no modification time', async function (assert) {
    let zip = buildZip([{ name: 'a.txt', data: bytes(1) }]);
    let listing = await parseZipListing(zip);
    assert.strictEqual(listing!.entries[0]!.modifiedAt, undefined);
  });

  test('returns undefined for bytes with no end-of-central-directory record', async function (assert) {
    let listing = await extractZipListing(
      new TextEncoder().encode('not a zip'),
    );
    assert.strictEqual(listing, undefined);
  });

  test('reads the directory from a stream while retaining only the tail', async function (assert) {
    let zip = buildZip([
      { name: 'one.txt', data: bytes(4096) },
      { name: 'two.txt', data: bytes(4096) },
    ]);
    // Feed the archive as a chunked stream so the tail-retention path runs.
    let position = 0;
    let stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (position >= zip.length) {
          controller.close();
          return;
        }
        let end = Math.min(position + 500, zip.length);
        controller.enqueue(zip.subarray(position, end));
        position = end;
      },
    });
    let listing = await extractZipListing(stream);
    assert.deepEqual(
      listing!.entries.map((e) => e.path),
      ['one.txt', 'two.txt'],
      'a chunked stream lists the same entries',
    );
  });

  test('readTailBytes keeps the last n bytes and reports the full length', async function (assert) {
    let source = new Uint8Array(3000).map((_, i) => i % 256);
    let position = 0;
    let stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (position >= source.length) {
          controller.close();
          return;
        }
        let end = Math.min(position + 256, source.length);
        controller.enqueue(source.subarray(position, end));
        position = end;
      },
    });
    let { bytes: tail, totalLength } = await readTailBytes(stream, 1000);
    assert.strictEqual(totalLength, 3000, 'full length is reported');
    assert.true(tail.length >= 1000, 'at least the requested window is kept');
    assert.true(tail.length < 3000, 'the whole stream is not retained');
    assert.strictEqual(
      tail[tail.length - 1],
      source[source.length - 1],
      'the retained bytes are the file tail',
    );
  });
});
