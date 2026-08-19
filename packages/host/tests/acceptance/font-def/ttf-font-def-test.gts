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

// A minimal but parser-valid TrueType face: the four tables the metadata reader
// reads (name/OS-2/head/maxp) plus an empty `glyf` to mark it TrueType. It is
// not a renderable outline font — the specimen's FontFace load fails and falls
// back to the theme font — which is exactly what lets the render test assert the
// specimen chrome without shipping a real binary.
function utf16be(text: string): Uint8Array {
  let bytes = new Uint8Array(text.length * 2);
  let view = new DataView(bytes.buffer);
  for (let i = 0; i < text.length; i++) {
    view.setUint16(i * 2, text.charCodeAt(i));
  }
  return bytes;
}

function nameTable(records: { nameID: number; value: string }[]): Uint8Array {
  let strings = records.map((r) => utf16be(r.value));
  let recordArea = 6 + records.length * 12;
  let storage = strings.reduce((sum, s) => sum + s.length, 0);
  let table = new Uint8Array(recordArea + storage);
  let view = new DataView(table.buffer);
  view.setUint16(2, records.length);
  view.setUint16(4, recordArea);
  let cursor = 0;
  records.forEach((r, i) => {
    let rec = 6 + i * 12;
    view.setUint16(rec, 3); // Windows
    view.setUint16(rec + 2, 1); // Unicode BMP
    view.setUint16(rec + 4, 0x0409); // US-English
    view.setUint16(rec + 6, r.nameID);
    view.setUint16(rec + 8, strings[i]!.length);
    view.setUint16(rec + 10, cursor);
    table.set(strings[i]!, recordArea + cursor);
    cursor += strings[i]!.length;
  });
  return table;
}

function os2Table(): Uint8Array {
  let table = new Uint8Array(78);
  let view = new DataView(table.buffer);
  view.setUint16(4, 600); // usWeightClass
  view.setUint16(6, 5); // usWidthClass (normal)
  'BOXL'.split('').forEach((c, i) => view.setUint8(58 + i, c.charCodeAt(0)));
  return table;
}

function headTable(): Uint8Array {
  let table = new Uint8Array(54);
  new DataView(table.buffer).setUint16(18, 1000); // unitsPerEm
  return table;
}

function maxpTable(numGlyphs: number): Uint8Array {
  let table = new Uint8Array(6);
  let view = new DataView(table.buffer);
  view.setUint32(0, 0x00010000);
  view.setUint16(4, numGlyphs);
  return table;
}

function makeMinimalTtf(): Uint8Array {
  let tables = [
    { tag: 'OS/2', data: os2Table() },
    { tag: 'head', data: headTable() },
    { tag: 'maxp', data: maxpTable(96) },
    {
      tag: 'name',
      data: nameTable([
        { nameID: 1, value: 'Boxel Test Sans' },
        { nameID: 4, value: 'Boxel Test Sans Regular' },
      ]),
    },
    { tag: 'glyf', data: new Uint8Array(4) },
  ];
  let headerSize = 12 + tables.length * 16;
  let cursor = headerSize;
  let placed = tables.map((t) => {
    let offset = cursor;
    cursor += Math.ceil(t.data.length / 4) * 4;
    return { ...t, offset };
  });
  let out = new Uint8Array(cursor);
  let view = new DataView(out.buffer);
  view.setUint32(0, 0x00010000); // sfnt version (TrueType)
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

module('Acceptance | ttf font def', function (hooks) {
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

  const ttfDefCodeRef = (): ResolvedCodeRef => ({
    module: `${baseRealmRRI}ttf-font-def` as RealmResourceIdentifier,
    name: 'TtfDef',
  });

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

  hooks.beforeEach(async function () {
    ({ realm } = await withCachedRealmSetup(async () =>
      setupAcceptanceTestRealm({
        mockMatrixUtils,
        contents: {
          ...SYSTEM_CARD_FIXTURE_CONTENTS,
          'sample.ttf': makeMinimalTtf(),
          'not-a-font.ttf': 'This is plain text, not a font file.',
        },
      }),
    ));
  });

  hooks.afterEach(function () {
    delete (globalThis as any).__renderModel;
    delete (globalThis as any).__boxelFileRenderData;
  });

  test('extracts name, glyph count, and outline type from a TTF', async function (assert) {
    let url = makeFileURL('sample.ttf');
    await visit(
      fileExtractPath(url, {
        fileExtract: true,
        fileDefCodeRef: ttfDefCodeRef(),
      }),
    );

    let result = await captureFileExtractResult('ready');
    assert.strictEqual(result.status, 'ready');
    assert.strictEqual(
      result.searchDoc?.fontMetadata?.familyName,
      'Boxel Test Sans',
      'extracts the family name',
    );
    assert.strictEqual(
      result.searchDoc?.fontMetadata?.glyphCount,
      96,
      'extracts the glyph count',
    );
    assert.strictEqual(
      result.searchDoc?.fontMetadata?.outlineType,
      'TrueType',
      'names the outline technology',
    );
    assert.strictEqual(
      result.searchDoc?.fontMetadata?.weightClass,
      600,
      'extracts the weight class',
    );
  });

  test('falls back when TtfDef is used for non-font content', async function (assert) {
    let url = makeFileURL('not-a-font.ttf');
    await visit(
      fileExtractPath(url, {
        fileExtract: true,
        fileDefCodeRef: ttfDefCodeRef(),
      }),
    );

    let result = await captureFileExtractResult('ready');
    assert.strictEqual(result.status, 'ready');
    assert.true(result.mismatch, 'marks mismatch when content is not a font');
    assert.strictEqual(result.searchDoc?.name, 'not-a-font.ttf');
  });

  test('isolated template renders the live specimen with the family name', async function (assert) {
    let url = makeFileURL('sample.ttf');

    await visit(
      fileExtractPath(url, {
        fileExtract: true,
        fileDefCodeRef: ttfDefCodeRef(),
      }),
    );
    let result = await captureFileExtractResult('ready');
    assert.ok(result.resource, 'extraction produced a resource');

    (globalThis as any).__boxelFileRenderData = {
      resource: result.resource,
      fileDefCodeRef: ttfDefCodeRef(),
    };

    await visit(
      fileRenderPath(url, {
        fileRender: true,
        fileDefCodeRef: ttfDefCodeRef(),
      }),
    );

    let { status } = await capturePrerenderResult('innerHTML');
    assert.strictEqual(status, 'ready', 'render completed');

    let specimen = document.querySelector(
      '[data-prerender] [data-test-font-specimen="isolated"]',
    );
    assert.ok(specimen, 'the isolated specimen is rendered');
    assert.ok(
      specimen?.textContent?.includes('Boxel Test Sans'),
      'the specimen shows the extracted family name',
    );
  });

  test('indexing stores font metadata and file meta uses it', async function (assert) {
    let fileURL = new URL('sample.ttf', testRealmURL);
    let fileEntry = await realm.realmIndexQueryEngine.file(fileURL);

    assert.ok(fileEntry, 'file entry exists');
    assert.strictEqual(
      fileEntry?.searchDoc?.fontMetadata?.familyName,
      'Boxel Test Sans',
      'index stores the font family name',
    );

    let network = getService('network') as NetworkService;
    let response = await network.virtualNetwork.fetch(fileURL, {
      headers: { Accept: SupportedMimeType.FileMeta },
    });

    assert.true(response.ok, 'file meta request succeeds');

    let body = await response.json();
    assert.strictEqual(body?.data?.type, 'file-meta');
    assert.strictEqual(
      body?.data?.attributes?.fontMetadata?.familyName,
      'Boxel Test Sans',
      'file meta includes the font family name',
    );
    assert.deepEqual(
      body?.data?.meta?.adoptsFrom,
      ttfDefCodeRef(),
      'file meta uses the TTF def',
    );
  });
});
