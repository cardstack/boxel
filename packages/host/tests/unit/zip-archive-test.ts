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

// Little-endian 64-bit write, matching the reader's `readUint64`
// (`high * 2^32 + low`).
function setUint64(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value % 0x1_0000_0000, true);
  view.setUint32(offset + 4, Math.floor(value / 0x1_0000_0000), true);
}

// A minimal ZIP64 archive with a single entry whose 32-bit size fields are the
// all-ones sentinel and whose real 64-bit size lives in the entry's `0x0001`
// extra block, behind an EOCD64 record + locator and a sentinel-bearing EOCD.
// The reader never touches local-header data, so the "large" file needs no real
// bytes — the fixture stays tiny while exercising the full ZIP64 offset walk.
function buildZip64(name: string, size: number): Uint8Array {
  let enc = new TextEncoder().encode(name);
  const U32 = 0xffffffff;
  const U16 = 0xffff;

  let local = new Uint8Array(30 + enc.length);
  let lv = new DataView(local.buffer);
  lv.setUint32(0, 0x0403_4b50, true);
  lv.setUint16(26, enc.length, true);
  local.set(enc, 30);
  let centralOffset = local.length;

  // Central header + a 20-byte ZIP64 extra block: id 0x0001, 16-byte payload of
  // (uncompressed, compressed) 64-bit sizes.
  let central = new Uint8Array(46 + enc.length + 20);
  let cv = new DataView(central.buffer);
  cv.setUint32(0, 0x0201_4b50, true);
  cv.setUint32(20, U32, true); // compressed size → sentinel
  cv.setUint32(24, U32, true); // uncompressed size → sentinel
  cv.setUint16(28, enc.length, true);
  cv.setUint16(30, 20, true); // extra field length
  cv.setUint32(42, 0, true); // local header offset
  central.set(enc, 46);
  let ex = 46 + enc.length;
  cv.setUint16(ex, 0x0001, true);
  cv.setUint16(ex + 2, 16, true);
  setUint64(cv, ex + 4, size); // uncompressed
  setUint64(cv, ex + 12, size); // compressed
  let centralSize = central.length;
  let recordOffset = centralOffset + centralSize;

  let rec = new Uint8Array(56); // EOCD64 record
  let rv = new DataView(rec.buffer);
  rv.setUint32(0, 0x0606_4b50, true);
  setUint64(rv, 24, 1); // entries on this disk
  setUint64(rv, 32, 1); // total entries
  setUint64(rv, 40, centralSize);
  setUint64(rv, 48, centralOffset);

  let loc = new Uint8Array(20); // EOCD64 locator
  let lov = new DataView(loc.buffer);
  lov.setUint32(0, 0x0706_4b50, true);
  setUint64(lov, 8, recordOffset);
  lov.setUint32(16, 1, true);

  let eocd = new Uint8Array(22);
  let ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x0605_4b50, true);
  ev.setUint16(8, U16, true); // entries this disk → sentinel
  ev.setUint16(10, U16, true); // total entries → sentinel
  ev.setUint32(12, U32, true); // central size → sentinel
  ev.setUint32(16, U32, true); // central offset → sentinel

  let chunks = [local, central, rec, loc, eocd];
  let out = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0));
  let cursor = 0;
  for (let c of chunks) {
    out.set(c, cursor);
    cursor += c.length;
  }
  return out;
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

  test('reads a 64-bit size from a ZIP64 archive', async function (assert) {
    // The entry's 32-bit size fields are the sentinel; the true size is in the
    // 0x0001 extra block, reached only after the EOCD64 locator → record walk.
    let fiveGb = 5_000_000_000;
    let listing = await parseZipListing(buildZip64('huge.bin', fiveGb));
    assert.ok(listing, 'ZIP64 archive parses');
    assert.strictEqual(listing!.entries.length, 1);
    assert.strictEqual(listing!.entries[0]!.path, 'huge.bin');
    assert.strictEqual(
      listing!.entries[0]!.uncompressedSize,
      fiveGb,
      'reads the 64-bit uncompressed size past the 4 GB limit',
    );
    assert.strictEqual(listing!.uncompressedSize, fiveGb, 'total reflects it');
    assert.false(
      listing!.truncated,
      'a complete ZIP64 directory is not truncated',
    );
  });

  test('recovers a partial listing when the tail cuts into the central directory', async function (assert) {
    let files = Array.from({ length: 5 }, (_, i) => ({
      name: `file-${i}.txt`,
      data: bytes(120),
    }));
    let full = buildZip(files);
    // The central directory begins right after the last local header.
    let encoder = new TextEncoder();
    let centralOffset = files.reduce(
      (sum, f) => sum + 30 + encoder.encode(f.name).length + f.data.length,
      0,
    );
    // A window that starts a few bytes into the first central header: the
    // directory begins before the retained tail, so only its later entries are
    // recoverable and the listing must say so.
    let tail = full.subarray(centralOffset + 10);
    let listing = await parseZipListing(tail, full.length);
    assert.ok(listing, 'a windowed tail still parses');
    assert.true(listing!.truncated, 'reports the directory as truncated');
    assert.true(
      listing!.entries.length > 0,
      'recovers the entries that fell inside the window',
    );
    assert.true(
      listing!.entries.length < files.length,
      'but not the whole directory',
    );
  });
});
