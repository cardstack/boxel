// Byte-level tests for the Office (OOXML) metadata readers. Each runs inside the
// index pass against whatever bytes a realm holds, so the contract is as much
// about degrading on unreadable input as about parsing a well-formed package: a
// non-OOXML file must throw `FileContentMismatchError` so the extract falls back to a
// plain FileDef, and a package missing its properties or body must still return
// whatever structure it does carry.
//
// Fixtures are assembled here as real ZIP containers rather than committed as
// binaries. The parts are stored uncompressed (a valid ZIP method the reader
// supports), which keeps the builder small while exercising the same
// central-directory path a compressed Office file takes.

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm, type Loader } from '@cardstack/runtime-common';

import { setupRenderingTest } from '../helpers/setup';

import type * as DocxModule from '@cardstack/base/docx-meta-extractor';
import type * as PptxModule from '@cardstack/base/pptx-meta-extractor';
import type * as XlsxModule from '@cardstack/base/xlsx-meta-extractor';

let encoder = new TextEncoder();

interface ZipPart {
  name: string;
  content: string;
}

// A minimal ZIP archive with every part stored uncompressed. CRC and timestamps
// are left zero — the reader addresses parts by the central directory and never
// validates them — so this stays a few dozen lines rather than pulling in a zlib
// writer.
function zip(parts: ZipPart[]): Uint8Array {
  let chunks: Uint8Array[] = [];
  let central: Uint8Array[] = [];
  let offset = 0;

  let u16 = (n: number) => new Uint8Array([n & 0xff, (n >> 8) & 0xff]);
  let u32 = (n: number) =>
    new Uint8Array([
      n & 0xff,
      (n >> 8) & 0xff,
      (n >> 16) & 0xff,
      (n >>> 24) & 0xff,
    ]);
  let concat = (list: Uint8Array[]) => {
    let total = list.reduce((sum, c) => sum + c.length, 0);
    let out = new Uint8Array(total);
    let at = 0;
    for (let c of list) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  };

  for (let part of parts) {
    let nameBytes = encoder.encode(part.name);
    let data = encoder.encode(part.content);
    let local = concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0), // method 0 (stored)
      u16(0),
      u16(0),
      u32(0), // crc
      u32(data.length),
      u32(data.length),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
      data,
    ]);
    central.push(
      concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(data.length),
        u32(data.length),
        u16(nameBytes.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        nameBytes,
      ]),
    );
    chunks.push(local);
    offset += local.length;
  }

  let cd = concat(central);
  let eocd = concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(parts.length),
    u16(parts.length),
    u32(cd.length),
    u32(offset),
    u16(0),
  ]);
  return concat([...chunks, cd, eocd]);
}

const CONTENT_TYPES: ZipPart = {
  name: '[Content_Types].xml',
  content: '<?xml version="1.0"?><Types/>',
};

module('Unit | office metadata extractor', function (hooks) {
  setupRenderingTest(hooks);

  let loader: Loader;
  let extractDocxMetadata: typeof DocxModule.extractDocxMetadata;
  let extractPptxMetadata: typeof PptxModule.extractPptxMetadata;
  let extractXlsxMetadata: typeof XlsxModule.extractXlsxMetadata;

  hooks.beforeEach(async function () {
    loader = getService('loader-service').loader;
    ({ extractDocxMetadata } = await loader.import<typeof DocxModule>(
      `${baseRealm.url}docx-meta-extractor`,
    ));
    ({ extractPptxMetadata } = await loader.import<typeof PptxModule>(
      `${baseRealm.url}pptx-meta-extractor`,
    ));
    ({ extractXlsxMetadata } = await loader.import<typeof XlsxModule>(
      `${baseRealm.url}xlsx-meta-extractor`,
    ));
  });

  test('reads a Word document’s properties and text flow', async function (assert) {
    let bytes = zip([
      CONTENT_TYPES,
      {
        name: 'docProps/core.xml',
        content:
          '<cp:coreProperties><dc:title>Quarterly Report</dc:title>' +
          '<dc:creator>Jane Doe</dc:creator>' +
          '<dcterms:created>2023-01-15T09:30:00Z</dcterms:created>' +
          '<dcterms:modified>2023-06-01T10:00:00-05:00</dcterms:modified>' +
          '</cp:coreProperties>',
      },
      {
        name: 'docProps/app.xml',
        content:
          '<Properties><Application>Microsoft Office Word</Application>' +
          '<Pages>3</Pages><Words>512</Words></Properties>',
      },
      {
        name: 'word/document.xml',
        content:
          '<w:document><w:body>' +
          '<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Annual Review</w:t></w:r></w:p>' +
          '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Overview</w:t></w:r></w:p>' +
          '<w:p><w:r><w:t xml:space="preserve">The year </w:t></w:r><w:r><w:t>was strong.</w:t></w:r></w:p>' +
          '<w:p></w:p>' +
          '</w:body></w:document>',
      },
    ]);
    let info = await extractDocxMetadata(bytes);
    assert.strictEqual(info.kind, 'word');
    assert.strictEqual(info.title, 'Quarterly Report');
    assert.strictEqual(info.creator, 'Jane Doe');
    assert.strictEqual(info.application, 'Microsoft Office Word');
    assert.strictEqual(info.pageCount, 3);
    assert.strictEqual(info.wordCount, 512);
    assert.strictEqual(info.created, '2023-01-15T09:30:00Z');
    assert.strictEqual(
      info.modified,
      '2023-06-01T15:00:00Z',
      'an offset-carrying date is converted to the UTC instant it names',
    );

    let preview = JSON.parse(info.previewJson!);
    assert.deepEqual(
      preview.blocks,
      [
        { style: 'title', text: 'Annual Review' },
        { style: 'heading', level: 1, text: 'Overview' },
        { style: 'body', text: 'The year was strong.' },
      ],
      'title, heading level, and joined runs are read; the empty paragraph is dropped',
    );
  });

  test('reads a PowerPoint deck’s slide count and outline', async function (assert) {
    let slide = (title: string, ...bullets: string[]) =>
      '<p:sld><p:cSld><p:spTree>' +
      `<p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>` +
      `<p:txBody><a:p><a:r><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp>` +
      `<p:sp><p:txBody>${bullets
        .map((b) => `<a:p><a:r><a:t>${b}</a:t></a:r></a:p>`)
        .join('')}</p:txBody></p:sp>` +
      '</p:spTree></p:cSld></p:sld>';
    let bytes = zip([
      CONTENT_TYPES,
      {
        name: 'docProps/app.xml',
        content:
          '<Properties><Application>Microsoft Office PowerPoint</Application>' +
          '<Slides>2</Slides></Properties>',
      },
      {
        name: 'ppt/slides/slide1.xml',
        content: slide('Welcome', 'First point'),
      },
      {
        name: 'ppt/slides/slide2.xml',
        content: slide('Agenda', 'Topic A', 'Topic B'),
      },
    ]);
    let info = await extractPptxMetadata(bytes);
    assert.strictEqual(info.kind, 'presentation');
    assert.strictEqual(info.slideCount, 2, 'slide count comes from the parts');
    let preview = JSON.parse(info.previewJson!);
    assert.deepEqual(preview.slides, [
      { index: 1, title: 'Welcome', bullets: ['First point'] },
      { index: 2, title: 'Agenda', bullets: ['Topic A', 'Topic B'] },
    ]);
  });

  test('reads an Excel workbook’s sheet names and grid with shared strings', async function (assert) {
    let bytes = zip([
      CONTENT_TYPES,
      {
        name: 'xl/workbook.xml',
        content:
          '<workbook><sheets>' +
          '<sheet name="Budget" sheetId="1" r:id="rId1"/>' +
          '<sheet name="Notes" sheetId="2" r:id="rId2"/>' +
          '</sheets></workbook>',
      },
      {
        name: 'xl/sharedStrings.xml',
        content: '<sst><si><t>Region</t></si><si><t>Total</t></si></sst>',
      },
      {
        name: 'xl/worksheets/sheet1.xml',
        content:
          '<worksheet><sheetData>' +
          '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
          // A sparse row: only column B is present, so column A must fill in empty.
          '<row r="2"><c r="B2"><v>42</v></c></row>' +
          '</sheetData></worksheet>',
      },
    ]);
    let info = await extractXlsxMetadata(bytes);
    assert.strictEqual(info.kind, 'spreadsheet');
    assert.strictEqual(info.sheetCount, 2);
    assert.deepEqual(info.sheetNames, ['Budget', 'Notes']);
    let preview = JSON.parse(info.previewJson!);
    assert.strictEqual(preview.sheets[0].name, 'Budget');
    assert.deepEqual(
      preview.sheets[0].rows,
      [
        ['Region', 'Total'],
        ['', '42'],
      ],
      'shared-string cells resolve and a gap in a sparse row becomes empty',
    );
  });

  test('a package with no properties still returns its structural count', async function (assert) {
    let bytes = zip([
      CONTENT_TYPES,
      { name: 'ppt/slides/slide1.xml', content: '<p:sld></p:sld>' },
    ]);
    let info = await extractPptxMetadata(bytes);
    assert.strictEqual(info.slideCount, 1, 'slide count from the part alone');
    assert.strictEqual(info.title, undefined, 'no title invented');
  });

  test('throws a content mismatch on non-OOXML bytes so the extract falls back', async function (assert) {
    await assert.rejects(
      extractDocxMetadata(encoder.encode('This is a plain text file.')),
      /not a ZIP\/OOXML container/,
    );
    // A ZIP without the OOXML content-type map is rejected too.
    let bareZip = zip([{ name: 'hello.txt', content: 'hi' }]);
    await assert.rejects(extractXlsxMetadata(bareZip), /not an OOXML package/);
  });
});
