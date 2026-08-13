// Byte-level tests for the PDF metadata reader. Like the other extract parsers,
// this runs inside the index pass against whatever bytes a realm holds, so the
// contract is as much about degrading on unreadable input as about parsing a
// well-formed document: a non-PDF must throw `FileContentMismatch` so the
// extract falls back to a plain FileDef, and a PDF with no (or an encrypted)
// Info dictionary must return a partial result rather than an empty error.
//
// Fixtures are assembled here rather than committed as binaries. A modern PDF
// packs its Info dictionary into a FlateDecode object stream, so one fixture is
// genuinely compressed to exercise that path.

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type { Loader } from '@cardstack/runtime-common';

import { setupRenderingTest } from '../helpers/setup';

import type * as PdfModule from '@cardstack/base/pdf-meta-extractor';

let encoder = new TextEncoder();

// Concatenate string and byte chunks into one PDF blob. Xref tables are omitted:
// the reader scans objects and inflated streams, so a valid cross-reference
// section isn't needed to exercise it.
function pdfBytes(chunks: (string | Uint8Array)[]): Uint8Array {
  let parts = chunks.map((c) =>
    typeof c === 'string' ? encoder.encode(c) : c,
  );
  let total = parts.reduce((sum, p) => sum + p.length, 0);
  let out = new Uint8Array(total);
  let offset = 0;
  for (let part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  let stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// A FlateDecode object stream carrying the given object text. The reader only
// greps the inflated bytes, so the ObjStm's internal offset table is irrelevant
// here — the text just has to inflate.
async function objStm(objectText: string): Promise<Uint8Array> {
  let compressed = await deflate(encoder.encode(objectText));
  return pdfBytes([
    `<</Type/ObjStm/N 1/First 0/Filter/FlateDecode/Length ${compressed.length}>>stream\n`,
    compressed,
    '\nendstream endobj\n',
  ]);
}

module('Unit | pdf metadata extractor', function (hooks) {
  setupRenderingTest(hooks);

  let loader: Loader;
  let extractPdfMetadata: typeof PdfModule.extractPdfMetadata;

  hooks.beforeEach(async function () {
    loader = getService('loader-service').loader;
    ({ extractPdfMetadata } = await loader.import<typeof PdfModule>(
      '@cardstack/base/pdf-meta-extractor',
    ));
  });

  test('reads the Info dictionary and page count from an uncompressed PDF', async function (assert) {
    let bytes = pdfBytes([
      '%PDF-1.7\n',
      '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n',
      '2 0 obj<</Type/Pages/Kids[3 0 R 4 0 R]/Count 2>>endobj\n',
      '3 0 obj<</Type/Page/Parent 2 0 R>>endobj\n',
      '4 0 obj<</Type/Page/Parent 2 0 R>>endobj\n',
      '6 0 obj<</Title(Quarterly Report)/Author(Jane Doe)/Subject(Finance)' +
        '/Creator(Word)/Producer(libpdf)/CreationDate(D:20230115093000Z)>>endobj\n',
      'trailer<</Root 1 0 R/Info 6 0 R>>\n',
    ]);
    let info = await extractPdfMetadata(bytes);
    assert.strictEqual(info.title, 'Quarterly Report');
    assert.strictEqual(info.author, 'Jane Doe');
    assert.strictEqual(info.subject, 'Finance');
    assert.strictEqual(info.creator, 'Word');
    assert.strictEqual(info.producer, 'libpdf');
    assert.strictEqual(info.pdfVersion, '1.7');
    // Two leaf `/Type /Page` objects — the leaf count, not the `/Pages` node.
    assert.strictEqual(info.pageCount, 2);
    assert.strictEqual(info.created, '2023-01-15T09:30:00Z');
  });

  test('falls back to the page-tree /Count when no leaf pages are legible', async function (assert) {
    let bytes = pdfBytes([
      '%PDF-1.4\n',
      '2 0 obj<</Type/Pages/Count 42>>endobj\n',
      'trailer<</Root 1 0 R>>\n',
    ]);
    let info = await extractPdfMetadata(bytes);
    assert.strictEqual(info.pageCount, 42, 'reads /Count as the total');
  });

  test('decodes a UTF-16BE hex-string title', async function (assert) {
    // <FEFF...> — a byte-order mark followed by UTF-16BE code units for "Café".
    let bytes = pdfBytes([
      '%PDF-1.6\n',
      '6 0 obj<</Title<FEFF00430061006600E9>>>endobj\n',
      'trailer<</Info 6 0 R>>\n',
    ]);
    let info = await extractPdfMetadata(bytes);
    assert.strictEqual(info.title, 'Café');
  });

  test('reads the Info dictionary out of a compressed object stream', async function (assert) {
    let bytes = pdfBytes([
      '%PDF-1.5\n',
      '3 0 obj<</Type/Page>>endobj\n',
      await objStm('6 0 <</Title(Compressed Title)/Author(Zed Q)>>'),
      'trailer<</Info 6 0 R>>\n',
    ]);
    let info = await extractPdfMetadata(bytes);
    assert.strictEqual(info.title, 'Compressed Title');
    assert.strictEqual(info.author, 'Zed Q');
    assert.strictEqual(info.pageCount, 1);
  });

  test('leaves the Info strings unread for an encrypted document', async function (assert) {
    let bytes = pdfBytes([
      '%PDF-1.7\n',
      '2 0 obj<</Type/Pages/Count 3>>endobj\n',
      '6 0 obj<</Title(Ciphertext here)>>endobj\n',
      'trailer<</Root 1 0 R/Info 6 0 R/Encrypt 9 0 R>>\n',
    ]);
    let info = await extractPdfMetadata(bytes);
    assert.true(info.encrypted, 'flags the document as encrypted');
    assert.strictEqual(info.title, undefined, 'does not surface ciphertext');
    // Page count still reads: it comes from the (unencrypted) structure.
    assert.strictEqual(info.pageCount, 3);
  });

  test('handles escaped and balanced parentheses in a literal string', async function (assert) {
    let bytes = pdfBytes([
      '%PDF-1.7\n',
      '6 0 obj<</Title(A \\(draft\\) of (part 2))>>endobj\n',
      'trailer<</Info 6 0 R>>\n',
    ]);
    let info = await extractPdfMetadata(bytes);
    assert.strictEqual(info.title, 'A (draft) of (part 2)');
  });

  test('throws a content mismatch on non-PDF bytes so the extract falls back', async function (assert) {
    let notAPdf = encoder.encode('This is a plain text file, not a PDF.');
    await assert.rejects(
      extractPdfMetadata(notAPdf),
      /does not have a PDF header/,
    );
  });
});
