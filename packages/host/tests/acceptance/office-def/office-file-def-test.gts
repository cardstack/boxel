import { visit, waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import {
  baseRealmRRI,
  type FileExtractResponse,
  type RenderRouteOptions,
  type ResolvedCodeRef,
  SupportedMimeType,
  type RealmResourceIdentifier,
} from '@cardstack/runtime-common';
import type { Realm } from '@cardstack/runtime-common/realm';

import type NetworkService from '@cardstack/host/services/network';

import {
  setupLocalIndexing,
  setupOnSave,
  setupRealmCacheTeardown,
  testRealmURL,
  setupAcceptanceTestRealm,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  capturePrerenderResult,
  withCachedRealmSetup,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupApplicationTest } from '../../helpers/setup';
import { setupTestRealmServiceWorker } from '../../helpers/test-realm-service-worker';

let encoder = new TextEncoder();

interface ZipPart {
  name: string;
  content: string;
}

// A minimal ZIP with every part stored uncompressed — a valid OOXML container
// the reader parses through its central directory, without shipping a binary
// fixture or a zlib writer. (See the unit test for the byte-level contract; here
// the packages exist only to drive extraction and rendering end to end.)
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
      u16(0),
      u16(0),
      u16(0),
      u32(0),
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

function makeDocx(): Uint8Array {
  return zip([
    CONTENT_TYPES,
    {
      name: 'docProps/core.xml',
      content:
        '<cp:coreProperties><dc:title>Boxel Handbook</dc:title>' +
        '<dc:creator>Test Author</dc:creator></cp:coreProperties>',
    },
    {
      name: 'docProps/app.xml',
      content:
        '<Properties><Application>Test Suite</Application>' +
        '<Pages>2</Pages><Words>40</Words></Properties>',
    },
    {
      name: 'word/document.xml',
      content:
        '<w:document><w:body>' +
        '<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Hello Boxel</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>A short paragraph of body text.</w:t></w:r></w:p>' +
        '</w:body></w:document>',
    },
  ]);
}

function makePptx(): Uint8Array {
  let slide = (title: string) =>
    '<p:sld><p:cSld><p:spTree>' +
    '<p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>' +
    `<p:txBody><a:p><a:r><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp>` +
    '</p:spTree></p:cSld></p:sld>';
  return zip([
    CONTENT_TYPES,
    {
      name: 'docProps/app.xml',
      content: '<Properties><Slides>2</Slides></Properties>',
    },
    { name: 'ppt/slides/slide1.xml', content: slide('Deck One') },
    { name: 'ppt/slides/slide2.xml', content: slide('Deck Two') },
  ]);
}

function makeXlsx(): Uint8Array {
  return zip([
    CONTENT_TYPES,
    {
      name: 'xl/workbook.xml',
      content:
        '<workbook><sheets>' +
        '<sheet name="Alpha" sheetId="1" r:id="rId1"/>' +
        '<sheet name="Beta" sheetId="2" r:id="rId2"/>' +
        '</sheets></workbook>',
    },
    {
      name: 'xl/sharedStrings.xml',
      content: '<sst><si><t>Name</t></si><si><t>Score</t></si></sst>',
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      content:
        '<worksheet><sheetData>' +
        '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
        '</sheetData></worksheet>',
    },
  ]);
}

module('Acceptance | office file def', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);
  setupRealmCacheTeardown(hooks);
  setupTestRealmServiceWorker(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
  });
  let realm: Realm;

  const fileExtractPath = (
    url: string,
    renderOptions: RenderRouteOptions,
    nonce = 0,
  ) =>
    `/render/${encodeURIComponent(url)}/${nonce}/${encodeURIComponent(
      JSON.stringify(renderOptions),
    )}/file-extract`;

  const fileRenderPath = (
    url: string,
    renderOptions: RenderRouteOptions,
    format = 'isolated',
    ancestorLevel = 0,
    nonce = 0,
  ) =>
    `/render/${encodeURIComponent(url)}/${nonce}/${encodeURIComponent(
      JSON.stringify(renderOptions),
    )}/html/${format}/${ancestorLevel}`;

  const makeFileURL = (path: string) => new URL(path, testRealmURL).href;

  const codeRef = (module: string, name: string): ResolvedCodeRef => ({
    module: `${baseRealmRRI}${module}` as RealmResourceIdentifier,
    name,
  });
  const docxRef = () => codeRef('docx-file-def', 'DocxDef');
  const pptxRef = () => codeRef('pptx-file-def', 'PptxDef');
  const xlsxRef = () => codeRef('xlsx-file-def', 'XlsxDef');

  async function captureFileExtractResult(
    expectedStatus?: 'ready' | 'error',
  ): Promise<FileExtractResponse> {
    await waitUntil(
      () => {
        let container = document.querySelector(
          '[data-prerender-file-extract]',
        ) as HTMLElement | null;
        let status = container?.getAttribute(
          'data-prerender-file-extract-status',
        );
        if (!status) {
          return false;
        }
        if (expectedStatus && status !== expectedStatus) {
          return false;
        }
        return status === 'ready' || status === 'error';
      },
      { timeout: 5000 },
    );
    let container = document.querySelector(
      '[data-prerender-file-extract]',
    ) as HTMLElement | null;
    let pre = container?.querySelector('pre');
    return JSON.parse(pre?.textContent?.trim() ?? '') as FileExtractResponse;
  }

  async function extractOffice(
    url: string,
    ref: ResolvedCodeRef,
  ): Promise<FileExtractResponse> {
    await visit(
      fileExtractPath(url, { fileExtract: true, fileDefCodeRef: ref }),
    );
    return captureFileExtractResult('ready');
  }

  async function renderOffice(url: string, ref: ResolvedCodeRef) {
    let result = await extractOffice(url, ref);
    (globalThis as any).__boxelFileRenderData = {
      resource: result.resource,
      fileDefCodeRef: ref,
    };
    await visit(fileRenderPath(url, { fileRender: true, fileDefCodeRef: ref }));
    return capturePrerenderResult('innerHTML');
  }

  hooks.beforeEach(async function () {
    ({ realm } = await withCachedRealmSetup(async () =>
      setupAcceptanceTestRealm({
        mockMatrixUtils,
        contents: {
          ...SYSTEM_CARD_FIXTURE_CONTENTS,
          'sample.docx': makeDocx(),
          'sample.pptx': makePptx(),
          'sample.xlsx': makeXlsx(),
          'not-office.docx': 'This is plain text, not an Office document.',
        },
      }),
    ));
  });

  hooks.afterEach(function () {
    delete (globalThis as any).__renderModel;
    delete (globalThis as any).__boxelFileRenderData;
  });

  test('extracts a Word document’s properties and text flow', async function (assert) {
    let result = await extractOffice(makeFileURL('sample.docx'), docxRef());
    let office = result.searchDoc?.officeMetadata;
    assert.strictEqual(office?.kind, 'word');
    assert.strictEqual(office?.title, 'Boxel Handbook');
    assert.strictEqual(office?.creator, 'Test Author');
    assert.strictEqual(office?.pageCount, 2, 'reads the page count');
    let preview = JSON.parse(office?.previewJson ?? '{}');
    assert.strictEqual(preview.blocks?.[0]?.style, 'title');
    assert.strictEqual(preview.blocks?.[0]?.text, 'Hello Boxel');
  });

  test('extracts a deck’s slide count and outline', async function (assert) {
    let result = await extractOffice(makeFileURL('sample.pptx'), pptxRef());
    let office = result.searchDoc?.officeMetadata;
    assert.strictEqual(office?.kind, 'presentation');
    assert.strictEqual(office?.slideCount, 2, 'reads the slide count');
    let preview = JSON.parse(office?.previewJson ?? '{}');
    assert.strictEqual(preview.slides?.[1]?.title, 'Deck Two');
  });

  test('extracts a workbook’s sheet names and grid', async function (assert) {
    let result = await extractOffice(makeFileURL('sample.xlsx'), xlsxRef());
    let office = result.searchDoc?.officeMetadata;
    assert.strictEqual(office?.kind, 'spreadsheet');
    assert.deepEqual(office?.sheetNames, ['Alpha', 'Beta']);
    let preview = JSON.parse(office?.previewJson ?? '{}');
    assert.deepEqual(
      preview.sheets?.[0]?.rows?.[0],
      ['Name', 'Score'],
      'shared-string header row resolves',
    );
  });

  test('falls back when an Office def is used for non-Office content', async function (assert) {
    let result = await extractOffice(makeFileURL('not-office.docx'), docxRef());
    assert.true(result.mismatch, 'marks mismatch when content is not OOXML');
    assert.strictEqual(result.searchDoc?.name, 'not-office.docx');
  });

  test('isolated template mounts each family’s domain preview', async function (assert) {
    let doc = await renderOffice(makeFileURL('sample.docx'), docxRef());
    assert.strictEqual(doc.status, 'ready', 'docx render completed');
    assert.ok(
      document.querySelector(
        '[data-prerender] [data-test-office-preview="word"]',
      ),
      'the Word document preview is mounted',
    );

    let deck = await renderOffice(makeFileURL('sample.pptx'), pptxRef());
    assert.strictEqual(deck.status, 'ready', 'pptx render completed');
    assert.ok(
      document.querySelector(
        '[data-prerender] [data-test-office-preview="presentation"]',
      ),
      'the deck preview is mounted',
    );

    let grid = await renderOffice(makeFileURL('sample.xlsx'), xlsxRef());
    assert.strictEqual(grid.status, 'ready', 'xlsx render completed');
    assert.ok(
      document.querySelector(
        '[data-prerender] [data-test-office-preview="spreadsheet"]',
      ),
      'the workbook preview is mounted',
    );
  });

  test('indexing stores office metadata and file meta uses it', async function (assert) {
    let fileURL = new URL('sample.docx', testRealmURL);
    let fileEntry = await realm.realmIndexQueryEngine.file(fileURL);

    assert.ok(fileEntry, 'file entry exists');
    assert.strictEqual(
      fileEntry?.searchDoc?.officeMetadata?.pageCount,
      2,
      'index stores the page count',
    );

    let network = getService('network') as NetworkService;
    let response = await network.virtualNetwork.fetch(fileURL, {
      headers: { Accept: SupportedMimeType.FileMeta },
    });
    assert.true(response.ok, 'file meta request succeeds');
    let body = await response.json();
    assert.strictEqual(body?.data?.type, 'file-meta');
    assert.strictEqual(
      body?.data?.attributes?.officeMetadata?.title,
      'Boxel Handbook',
      'file meta includes the document title',
    );
    assert.deepEqual(
      body?.data?.meta?.adoptsFrom,
      docxRef(),
      'file meta uses the Word def',
    );
  });
});
