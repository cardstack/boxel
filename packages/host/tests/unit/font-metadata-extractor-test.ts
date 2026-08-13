// Byte-level tests for the font metadata reader. Like the other extract
// parsers, this runs inside the index pass against whatever bytes a realm holds,
// so the contract is as much about degrading on malformed or unreadable input as
// about parsing a well-formed face: a non-font must throw `FileContentMismatch`
// so the extract falls back to a plain FileDef, and a real font whose tables are
// missing or (for WOFF2) compressed away must return a partial result rather
// than an empty error.
//
// Fixtures are assembled here rather than committed as binaries so each test
// names the exact tables and header fields it depends on.

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type { Loader } from '@cardstack/runtime-common';

import { setupRenderingTest } from '../helpers/setup';

import type * as FontModule from '@cardstack/base/font-meta-extractor';

// A UTF-16BE name string, the encoding the Windows-platform name records use.
function utf16be(text: string): Uint8Array {
  let bytes = new Uint8Array(text.length * 2);
  let view = new DataView(bytes.buffer);
  for (let i = 0; i < text.length; i++) {
    view.setUint16(i * 2, text.charCodeAt(i));
  }
  return bytes;
}

interface NameRecordSpec {
  nameID: number;
  value: string;
}

// A `name` table of Windows (platform 3) / Unicode BMP (encoding 1) / US-English
// (0x0409) records — the canonical specimen strings the reader scores highest.
function nameTable(records: NameRecordSpec[]): Uint8Array {
  let strings = records.map((r) => utf16be(r.value));
  let recordArea = 6 + records.length * 12;
  let storage = strings.reduce((sum, s) => sum + s.length, 0);
  let table = new Uint8Array(recordArea + storage);
  let view = new DataView(table.buffer);
  view.setUint16(0, 0); // format
  view.setUint16(2, records.length);
  view.setUint16(4, recordArea); // storageOffset
  let stringCursor = 0;
  records.forEach((r, i) => {
    let rec = 6 + i * 12;
    view.setUint16(rec, 3); // platformID (Windows)
    view.setUint16(rec + 2, 1); // encodingID (Unicode BMP)
    view.setUint16(rec + 4, 0x0409); // languageID (US-English)
    view.setUint16(rec + 6, r.nameID);
    view.setUint16(rec + 8, strings[i]!.length);
    view.setUint16(rec + 10, stringCursor);
    table.set(strings[i]!, recordArea + stringCursor);
    stringCursor += strings[i]!.length;
  });
  return table;
}

interface Os2Spec {
  weightClass: number;
  widthClass: number;
  vendorId: string;
  fsSelection: number;
}

function os2Table(spec: Os2Spec): Uint8Array {
  let table = new Uint8Array(78); // OS/2 version 0
  let view = new DataView(table.buffer);
  view.setUint16(0, 0); // version
  view.setUint16(4, spec.weightClass);
  view.setUint16(6, spec.widthClass);
  for (let i = 0; i < 4; i++) {
    view.setUint8(58 + i, spec.vendorId.charCodeAt(i));
  }
  view.setUint16(62, spec.fsSelection);
  return table;
}

function headTable(unitsPerEm: number, macStyle: number): Uint8Array {
  let table = new Uint8Array(54);
  let view = new DataView(table.buffer);
  view.setUint16(18, unitsPerEm);
  view.setUint16(44, macStyle);
  return table;
}

function maxpTable(numGlyphs: number): Uint8Array {
  let table = new Uint8Array(6);
  let view = new DataView(table.buffer);
  view.setUint32(0, 0x00010000); // version
  view.setUint16(4, numGlyphs);
  return table;
}

interface AxisSpec {
  tag: string;
  min: number;
  def: number;
  max: number;
}

function fvarTable(axes: AxisSpec[]): Uint8Array {
  let axesOffset = 16;
  let table = new Uint8Array(axesOffset + axes.length * 20);
  let view = new DataView(table.buffer);
  view.setUint16(0, 1); // majorVersion
  view.setUint16(4, axesOffset);
  view.setUint16(8, axes.length); // axisCount
  view.setUint16(10, 20); // axisSize
  axes.forEach((axis, i) => {
    let rec = axesOffset + i * 20;
    for (let j = 0; j < 4; j++) {
      view.setUint8(rec + j, axis.tag.charCodeAt(j));
    }
    view.setInt32(rec + 4, axis.min * 65536);
    view.setInt32(rec + 8, axis.def * 65536);
    view.setInt32(rec + 12, axis.max * 65536);
    view.setUint16(rec + 16, 0); // flags
    view.setUint16(rec + 18, 256 + i); // axisNameID
  });
  return table;
}

interface TableSpec {
  tag: string;
  data: Uint8Array;
}

// Assemble a bare sfnt (TTF/OTF) from a table map, 4-byte aligning each table's
// data the way real fonts do.
function sfnt(flavor: number, tables: TableSpec[]): Uint8Array {
  let headerSize = 12 + tables.length * 16;
  let cursor = headerSize;
  let placed = tables.map((t) => {
    let offset = cursor;
    cursor += Math.ceil(t.data.length / 4) * 4;
    return { ...t, offset };
  });
  let out = new Uint8Array(cursor);
  let view = new DataView(out.buffer);
  view.setUint32(0, flavor);
  view.setUint16(4, tables.length);
  placed.forEach((t, i) => {
    let rec = 12 + i * 16;
    for (let j = 0; j < 4; j++) {
      view.setUint8(rec + j, t.tag.charCodeAt(j));
    }
    view.setUint32(rec + 8, t.offset);
    view.setUint32(rec + 12, t.data.length);
    out.set(t.data, t.offset);
  });
  return out;
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  let stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Assemble a WOFF from a table map. Each table is stored uncompressed unless
// `compressedTags` names it, in which case its data is zlib-deflated and the
// directory records the smaller compressed length.
async function woff(
  flavor: number,
  tables: TableSpec[],
  compressedTags: Set<string> = new Set(),
): Promise<Uint8Array> {
  let headerSize = 44 + tables.length * 20;
  let blobs = await Promise.all(
    tables.map(async (t) => {
      if (compressedTags.has(t.tag)) {
        let comp = await deflate(t.data);
        return { tag: t.tag, comp, origLength: t.data.length };
      }
      return { tag: t.tag, comp: t.data, origLength: t.data.length };
    }),
  );
  let cursor = headerSize;
  let placed = blobs.map((b) => {
    let offset = cursor;
    cursor += Math.ceil(b.comp.length / 4) * 4;
    return { ...b, offset };
  });
  let out = new Uint8Array(cursor);
  let view = new DataView(out.buffer);
  view.setUint32(0, 0x774f4646); // 'wOFF'
  view.setUint32(4, flavor);
  view.setUint32(8, out.length);
  view.setUint16(12, tables.length);
  placed.forEach((b, i) => {
    let rec = 44 + i * 20;
    for (let j = 0; j < 4; j++) {
      view.setUint8(rec + j, b.tag.charCodeAt(j));
    }
    view.setUint32(rec + 4, b.offset);
    view.setUint32(rec + 8, b.comp.length); // compLength
    view.setUint32(rec + 12, b.origLength);
    out.set(b.comp, b.offset);
  });
  return out;
}

// A WOFF2 header with no legible table body — the shape the reader can extract
// nothing but the outline flavor from.
function woff2Header(flavor: number): Uint8Array {
  let out = new Uint8Array(48);
  let view = new DataView(out.buffer);
  view.setUint32(0, 0x774f4632); // 'wOF2'
  view.setUint32(4, flavor);
  view.setUint16(12, 4); // numTables
  return out;
}

const SFNT_TRUETYPE = 0x00010000;
const SFNT_OTTO = 0x4f54544f;

// fsSelection bit 5 (bold); macStyle in `head` uses a different bit order,
// tested separately via a font with no OS/2.
const FS_BOLD = 0x20;

// A complete TrueType face with every table the reader knows how to read.
function completeTruetype(): Uint8Array {
  return sfnt(SFNT_TRUETYPE, [
    {
      tag: 'OS/2',
      data: os2Table({
        weightClass: 700,
        widthClass: 3,
        vendorId: 'ACME',
        fsSelection: FS_BOLD,
      }),
    },
    { tag: 'head', data: headTable(2048, 0) },
    { tag: 'maxp', data: maxpTable(1234) },
    {
      tag: 'name',
      data: nameTable([
        { nameID: 1, value: 'Legacy Family' },
        { nameID: 2, value: 'Legacy Style' },
        { nameID: 4, value: 'Acme Sans Bold' },
        { nameID: 6, value: 'AcmeSans-Bold' },
        { nameID: 8, value: 'Acme Type Foundry' },
        { nameID: 16, value: 'Acme Sans' },
        { nameID: 17, value: 'Bold' },
      ]),
    },
    { tag: 'glyf', data: new Uint8Array(4) },
  ]);
}

module('Unit | font metadata extractor', function (hooks) {
  setupRenderingTest(hooks);

  let loader: Loader;
  let extractFontMetadata: typeof FontModule.extractFontMetadata;

  hooks.beforeEach(async function () {
    loader = getService('loader-service').loader;
    ({ extractFontMetadata } = await loader.import<typeof FontModule>(
      '@cardstack/base/font-meta-extractor',
    ));
  });

  test('reads name, OS/2, head, and maxp facts from a TrueType face', async function (assert) {
    let metadata = await extractFontMetadata(completeTruetype());
    // Typographic names (16/17) win over the legacy family/style pair (1/2).
    assert.strictEqual(metadata.familyName, 'Acme Sans');
    assert.strictEqual(metadata.subfamilyName, 'Bold');
    assert.strictEqual(metadata.fullName, 'Acme Sans Bold');
    assert.strictEqual(metadata.postscriptName, 'AcmeSans-Bold');
    assert.strictEqual(metadata.foundry, 'Acme Type Foundry');
    assert.strictEqual(metadata.vendorId, 'ACME');
    assert.strictEqual(metadata.weightClass, 700);
    assert.strictEqual(metadata.widthName, 'Condensed');
    assert.strictEqual(metadata.glyphCount, 1234);
    assert.strictEqual(metadata.unitsPerEm, 2048);
    assert.strictEqual(metadata.outlineType, 'TrueType');
    assert.true(metadata.isBold);
    assert.false(metadata.isItalic);
  });

  test('names CFF outlines as PostScript', async function (assert) {
    let metadata = await extractFontMetadata(
      sfnt(SFNT_OTTO, [
        { tag: 'CFF ', data: new Uint8Array(4) },
        { tag: 'maxp', data: maxpTable(50) },
        { tag: 'name', data: nameTable([{ nameID: 1, value: 'Acme Serif' }]) },
      ]),
    );
    assert.strictEqual(metadata.outlineType, 'PostScript/CFF');
    assert.strictEqual(metadata.familyName, 'Acme Serif');
  });

  test('reports variation axes for a variable font', async function (assert) {
    let metadata = await extractFontMetadata(
      sfnt(SFNT_TRUETYPE, [
        { tag: 'maxp', data: maxpTable(80) },
        { tag: 'glyf', data: new Uint8Array(4) },
        {
          tag: 'fvar',
          data: fvarTable([
            { tag: 'wght', min: 100, def: 400, max: 900 },
            { tag: 'wdth', min: 75, def: 100, max: 125 },
          ]),
        },
      ]),
    );
    assert.true(metadata.isVariable);
    assert.deepEqual(metadata.axes, [
      'Weight (wght) 100–900',
      'Width (wdth) 75–125',
    ]);
  });

  test('falls back to the legacy family/style names when no typographic pair exists', async function (assert) {
    let metadata = await extractFontMetadata(
      sfnt(SFNT_TRUETYPE, [
        { tag: 'glyf', data: new Uint8Array(4) },
        {
          tag: 'name',
          data: nameTable([
            { nameID: 1, value: 'Plain Family' },
            { nameID: 2, value: 'Regular' },
          ]),
        },
      ]),
    );
    assert.strictEqual(metadata.familyName, 'Plain Family');
    assert.strictEqual(metadata.subfamilyName, 'Regular');
  });

  test('derives style from head macStyle when OS/2 is absent', async function (assert) {
    // macStyle bit 0 is bold, bit 1 is italic — the opposite order from OS/2.
    let metadata = await extractFontMetadata(
      sfnt(SFNT_TRUETYPE, [
        { tag: 'glyf', data: new Uint8Array(4) },
        { tag: 'head', data: headTable(1000, 0x02) },
      ]),
    );
    assert.true(metadata.isItalic);
    assert.false(metadata.isBold);
    assert.strictEqual(metadata.weightClass, undefined, 'no OS/2, no weight');
  });

  test('reads the same facts through an uncompressed WOFF wrapper', async function (assert) {
    let bytes = await woff(SFNT_TRUETYPE, [
      { tag: 'maxp', data: maxpTable(321) },
      { tag: 'glyf', data: new Uint8Array(4) },
      { tag: 'name', data: nameTable([{ nameID: 1, value: 'Woff Family' }]) },
    ]);
    let metadata = await extractFontMetadata(bytes);
    assert.strictEqual(metadata.familyName, 'Woff Family');
    assert.strictEqual(metadata.glyphCount, 321);
    assert.strictEqual(metadata.outlineType, 'TrueType');
  });

  test('inflates a zlib-compressed WOFF table', async function (assert) {
    // A well-formed WOFF only stores a table compressed when that actually
    // shrinks it, so the fixture's name table carries a long repetitive filler
    // record (an ID the reader ignores) to make it genuinely compressible.
    let bytes = await woff(
      SFNT_TRUETYPE,
      [
        { tag: 'glyf', data: new Uint8Array(4) },
        {
          tag: 'name',
          data: nameTable([
            { nameID: 1, value: 'Compressed Family' },
            { nameID: 256, value: 'padding '.repeat(64) },
          ]),
        },
      ],
      new Set(['name']),
    );
    let metadata = await extractFontMetadata(bytes);
    assert.strictEqual(metadata.familyName, 'Compressed Family');
  });

  test('reads only the outline flavor from a WOFF2, whose tables are Brotli-compressed', async function (assert) {
    let metadata = await extractFontMetadata(woff2Header(SFNT_TRUETYPE));
    assert.strictEqual(metadata.outlineType, 'TrueType');
    assert.strictEqual(metadata.familyName, undefined, 'no legible name table');
    assert.strictEqual(metadata.glyphCount, undefined, 'no legible maxp table');
  });

  test('throws a content mismatch on non-font bytes so the extract falls back', async function (assert) {
    let notAFont = new Uint8Array([
      0x25, 0x50, 0x44, 0x46, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    await assert.rejects(
      extractFontMetadata(notAFont),
      /recognized font signature/,
    );
  });

  test('degrades to a partial result when a declared table is out of bounds', async function (assert) {
    // A directory that points a table past the end of the buffer must not throw
    // out of the extract; the reader skips what it can't reach.
    let bytes = completeTruetype();
    let view = new DataView(bytes.buffer);
    // Corrupt the first table's offset to point past the file.
    view.setUint32(12 + 8, bytes.length + 1000);
    let metadata = await extractFontMetadata(bytes);
    // Other tables still read; the extract survives.
    assert.strictEqual(metadata.outlineType, 'TrueType');
  });
});
