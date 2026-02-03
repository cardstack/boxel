import { visit, waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import {
  baseRealm,
  type FileExtractResponse,
  type RenderRouteOptions,
  type ResolvedCodeRef,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import type { Realm } from '@cardstack/runtime-common/realm';

import type NetworkService from '@cardstack/host/services/network';

import {
  setupLocalIndexing,
  setupOnSave,
  testRealmURL,
  setupAcceptanceTestRealm,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  capturePrerenderResult,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

// Minimal valid PNG: 1x1 pixel, RGBA, with IHDR, IDAT, and IEND chunks.
// Dimensions encoded in IHDR at bytes 16-19 (width=2) and 20-23 (height=3).
function makeMinimalPng(width: number, height: number): Uint8Array {
  // PNG signature (8 bytes)
  let signature = [137, 80, 78, 71, 13, 10, 26, 10];

  // IHDR chunk: width, height, bit depth=8, color type=2 (RGB), compression=0, filter=0, interlace=0
  let ihdrData = new Uint8Array(13);
  let ihdrView = new DataView(ihdrData.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type (RGB)
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace

  let ihdrChunk = buildChunk('IHDR', ihdrData);

  // Minimal IDAT chunk (empty compressed data — deflate stored block)
  let idatData = new Uint8Array([
    0x08, 0xd7, 0x01, 0x00, 0x00, 0xff, 0xff, 0x00, 0x01, 0x00, 0x01,
  ]);
  let idatChunk = buildChunk('IDAT', idatData);

  // IEND chunk (empty)
  let iendChunk = buildChunk('IEND', new Uint8Array(0));

  // Combine all parts
  let totalLength =
    signature.length + ihdrChunk.length + idatChunk.length + iendChunk.length;
  let png = new Uint8Array(totalLength);
  let offset = 0;

  png.set(signature, offset);
  offset += signature.length;
  png.set(ihdrChunk, offset);
  offset += ihdrChunk.length;
  png.set(idatChunk, offset);
  offset += idatChunk.length;
  png.set(iendChunk, offset);

  return png;
}

function buildChunk(type: string, data: Uint8Array): Uint8Array {
  // chunk = length (4 bytes) + type (4 bytes) + data + CRC (4 bytes)
  let chunk = new Uint8Array(4 + 4 + data.length + 4);
  let view = new DataView(chunk.buffer);

  // Length
  view.setUint32(0, data.length);

  // Type
  for (let i = 0; i < 4; i++) {
    chunk[4 + i] = type.charCodeAt(i);
  }

  // Data
  chunk.set(data, 8);

  // CRC (simplified — not validated by our extractor, but needed for structure)
  let crc = crc32(chunk.slice(4, 8 + data.length));
  view.setUint32(8 + data.length, crc);

  return chunk;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i]!;
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

module('Acceptance | png image def', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);

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

  const pngDefCodeRef = (): ResolvedCodeRef => ({
    module: `${baseRealm.url}png-image-def`,
    name: 'PngDef',
  });

  async function captureFileExtractResult(
    expectedStatus?: 'ready' | 'error',
  ): Promise<FileExtractResponse> {
    await waitUntil(
      () => {
        let container = document.querySelector(
          '[data-prerender-file-extract]',
        ) as HTMLElement | null;
        if (!container) {
          return false;
        }
        let status = container.getAttribute(
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
    if (!container) {
      throw new Error(
        'captureFileExtractResult: missing [data-prerender-file-extract] container after wait',
      );
    }
    let pre = container.querySelector('pre');
    let text = pre?.textContent?.trim() ?? '';
    return JSON.parse(text) as FileExtractResponse;
  }

  hooks.beforeEach(async function () {
    let pngBytes = makeMinimalPng(2, 3);
    ({ realm } = await setupAcceptanceTestRealm({
      mockMatrixUtils,
      contents: {
        ...SYSTEM_CARD_FIXTURE_CONTENTS,
        'sample.png': pngBytes,
        'not-a-png.png': 'This is plain text, not a PNG file.',
      },
    }));
  });

  hooks.afterEach(function () {
    delete (globalThis as any).__renderModel;
    delete (globalThis as any).__boxelFileRenderData;
  });

  test('extracts width and height from PNG', async function (assert) {
    let url = makeFileURL('sample.png');
    await visit(
      fileExtractPath(url, {
        fileExtract: true,
        fileDefCodeRef: pngDefCodeRef(),
      }),
    );

    let result = await captureFileExtractResult('ready');
    assert.strictEqual(result.status, 'ready');
    assert.strictEqual(result.searchDoc?.width, 2, 'extracts PNG width');
    assert.strictEqual(result.searchDoc?.height, 3, 'extracts PNG height');
    assert.strictEqual(result.searchDoc?.name, 'sample.png');
    assert.ok(
      String(result.searchDoc?.contentType).includes('png'),
      'sets png content type',
    );
  });

  test('falls back when PngDef is used for non-PNG content', async function (assert) {
    let url = makeFileURL('not-a-png.png');
    await visit(
      fileExtractPath(url, {
        fileExtract: true,
        fileDefCodeRef: pngDefCodeRef(),
      }),
    );

    let result = await captureFileExtractResult('ready');
    assert.strictEqual(result.status, 'ready');
    assert.true(
      result.mismatch,
      'marks mismatch when content is not valid PNG',
    );
    assert.strictEqual(result.searchDoc?.name, 'not-a-png.png');
  });

  test('isolated template renders img with width and height attributes', async function (assert) {
    let url = makeFileURL('sample.png');

    // First extract the file to get the resource
    await visit(
      fileExtractPath(url, {
        fileExtract: true,
        fileDefCodeRef: pngDefCodeRef(),
      }),
    );
    let result = await captureFileExtractResult('ready');
    assert.ok(result.resource, 'extraction produced a resource');

    // Set up file render data and visit the HTML render route
    (globalThis as any).__boxelFileRenderData = {
      resource: result.resource,
      fileDefCodeRef: pngDefCodeRef(),
    };

    await visit(
      fileRenderPath(url, {
        fileRender: true,
        fileDefCodeRef: pngDefCodeRef(),
      }),
    );

    let { status } = await capturePrerenderResult('innerHTML');
    assert.strictEqual(status, 'ready', 'render completed');

    let img = document.querySelector(
      '[data-prerender] img',
    ) as HTMLImageElement | null;
    assert.ok(img, 'img element is rendered');
    assert.strictEqual(
      img?.getAttribute('width'),
      '2',
      'img has correct width attribute',
    );
    assert.strictEqual(
      img?.getAttribute('height'),
      '3',
      'img has correct height attribute',
    );
    assert.ok(
      img?.getAttribute('src')?.includes('sample.png'),
      'img src references the PNG file',
    );
  });

  test('indexing stores PNG metadata and file meta uses it', async function (assert) {
    let fileURL = new URL('sample.png', testRealmURL);
    let fileEntry = await realm.realmIndexQueryEngine.file(fileURL);

    assert.ok(fileEntry, 'file entry exists');
    assert.strictEqual(
      fileEntry?.searchDoc?.width,
      2,
      'index stores PNG width',
    );
    assert.strictEqual(
      fileEntry?.searchDoc?.height,
      3,
      'index stores PNG height',
    );

    let network = getService('network') as NetworkService;
    let response = await network.virtualNetwork.fetch(fileURL, {
      headers: { Accept: SupportedMimeType.FileMeta },
    });

    assert.true(response.ok, 'file meta request succeeds');

    let body = await response.json();
    assert.strictEqual(body?.data?.type, 'file-meta');
    assert.ok(
      String(body?.data?.attributes?.contentType).includes('png'),
      'file meta uses png content type',
    );
    assert.strictEqual(
      body?.data?.attributes?.width,
      2,
      'file meta includes PNG width',
    );
    assert.strictEqual(
      body?.data?.attributes?.height,
      3,
      'file meta includes PNG height',
    );
    assert.deepEqual(
      body?.data?.meta?.adoptsFrom,
      pngDefCodeRef(),
      'file meta uses PNG def',
    );
  });
});
