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

// Build a minimal valid AVIF file (ISOBMFF) with the given dimensions.
// Structure: ftyp box + meta box containing iprp > ipco > ispe (width/height).
function makeMinimalAvif(width: number, height: number): Uint8Array {
  let buf = new ArrayBuffer(68);
  let view = new DataView(buf);
  let bytes = new Uint8Array(buf);
  let offset = 0;

  // ftyp box (20 bytes)
  view.setUint32(offset, 20);
  offset += 4; // size
  setChars(bytes, offset, 'ftyp');
  offset += 4; // type
  setChars(bytes, offset, 'avif');
  offset += 4; // major_brand
  view.setUint32(offset, 0);
  offset += 4; // minor_version
  setChars(bytes, offset, 'avif');
  offset += 4; // compatible_brand

  // meta box — fullbox (48 bytes)
  view.setUint32(offset, 48);
  offset += 4; // size
  setChars(bytes, offset, 'meta');
  offset += 4; // type
  view.setUint32(offset, 0);
  offset += 4; // version + flags

  // iprp box (36 bytes)
  view.setUint32(offset, 36);
  offset += 4; // size
  setChars(bytes, offset, 'iprp');
  offset += 4; // type

  // ipco box (28 bytes)
  view.setUint32(offset, 28);
  offset += 4; // size
  setChars(bytes, offset, 'ipco');
  offset += 4; // type

  // ispe box (20 bytes)
  view.setUint32(offset, 20);
  offset += 4; // size
  setChars(bytes, offset, 'ispe');
  offset += 4; // type
  view.setUint32(offset, 0);
  offset += 4; // version + flags
  view.setUint32(offset, width);
  offset += 4; // width
  view.setUint32(offset, height);
  // height

  return bytes;
}

function setChars(bytes: Uint8Array, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    bytes[offset + i] = str.charCodeAt(i);
  }
}

module('Acceptance | avif image def', function (hooks) {
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

  const avifDefCodeRef = (): ResolvedCodeRef => ({
    module: `${baseRealm.url}avif-image-def`,
    name: 'AvifDef',
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
    let avifBytes = makeMinimalAvif(2, 3);
    ({ realm } = await setupAcceptanceTestRealm({
      mockMatrixUtils,
      contents: {
        ...SYSTEM_CARD_FIXTURE_CONTENTS,
        'sample.avif': avifBytes,
        'not-an-avif.avif': 'This is plain text, not an AVIF file.',
      },
    }));
  });

  hooks.afterEach(function () {
    delete (globalThis as any).__renderModel;
    delete (globalThis as any).__boxelFileRenderData;
  });

  test('extracts width and height from AVIF', async function (assert) {
    let url = makeFileURL('sample.avif');
    await visit(
      fileExtractPath(url, {
        fileExtract: true,
        fileDefCodeRef: avifDefCodeRef(),
      }),
    );

    let result = await captureFileExtractResult('ready');
    assert.strictEqual(result.status, 'ready');
    assert.strictEqual(result.searchDoc?.width, 2, 'extracts AVIF width');
    assert.strictEqual(result.searchDoc?.height, 3, 'extracts AVIF height');
    assert.strictEqual(result.searchDoc?.name, 'sample.avif');
    assert.ok(
      String(result.searchDoc?.contentType).includes('avif'),
      'sets avif content type',
    );
  });

  test('falls back when AvifDef is used for non-AVIF content', async function (assert) {
    let url = makeFileURL('not-an-avif.avif');
    await visit(
      fileExtractPath(url, {
        fileExtract: true,
        fileDefCodeRef: avifDefCodeRef(),
      }),
    );

    let result = await captureFileExtractResult('ready');
    assert.strictEqual(result.status, 'ready');
    assert.true(
      result.mismatch,
      'marks mismatch when content is not valid AVIF',
    );
    assert.strictEqual(result.searchDoc?.name, 'not-an-avif.avif');
  });

  test('isolated template renders img with width and height attributes', async function (assert) {
    let url = makeFileURL('sample.avif');

    // First extract the file to get the resource
    await visit(
      fileExtractPath(url, {
        fileExtract: true,
        fileDefCodeRef: avifDefCodeRef(),
      }),
    );
    let result = await captureFileExtractResult('ready');
    assert.ok(result.resource, 'extraction produced a resource');

    // Set up file render data and visit the HTML render route
    (globalThis as any).__boxelFileRenderData = {
      resource: result.resource,
      fileDefCodeRef: avifDefCodeRef(),
    };

    await visit(
      fileRenderPath(url, {
        fileRender: true,
        fileDefCodeRef: avifDefCodeRef(),
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
      img?.getAttribute('src')?.includes('sample.avif'),
      'img src references the AVIF file',
    );
  });

  test('indexing stores AVIF metadata and file meta uses it', async function (assert) {
    let fileURL = new URL('sample.avif', testRealmURL);
    let fileEntry = await realm.realmIndexQueryEngine.file(fileURL);

    assert.ok(fileEntry, 'file entry exists');
    assert.strictEqual(
      fileEntry?.searchDoc?.width,
      2,
      'index stores AVIF width',
    );
    assert.strictEqual(
      fileEntry?.searchDoc?.height,
      3,
      'index stores AVIF height',
    );

    let network = getService('network') as NetworkService;
    let response = await network.virtualNetwork.fetch(fileURL, {
      headers: { Accept: SupportedMimeType.FileMeta },
    });

    assert.true(response.ok, 'file meta request succeeds');

    let body = await response.json();
    assert.strictEqual(body?.data?.type, 'file-meta');
    assert.ok(
      String(body?.data?.attributes?.contentType).includes('avif'),
      'file meta uses avif content type',
    );
    assert.strictEqual(
      body?.data?.attributes?.width,
      2,
      'file meta includes AVIF width',
    );
    assert.strictEqual(
      body?.data?.attributes?.height,
      3,
      'file meta includes AVIF height',
    );
    assert.deepEqual(
      body?.data?.meta?.adoptsFrom,
      avifDefCodeRef(),
      'file meta uses AVIF def',
    );
  });

  test('authenticated images display in browser', async function (assert) {
    let url = makeFileURL('sample.avif');

    // First extract the file to get the resource
    await visit(
      fileExtractPath(url, {
        fileExtract: true,
        fileDefCodeRef: avifDefCodeRef(),
      }),
    );
    let result = await captureFileExtractResult('ready');
    assert.ok(result.resource, 'extraction produced a resource');

    // Set up file render data and visit the HTML render route
    (globalThis as any).__boxelFileRenderData = {
      resource: result.resource,
      fileDefCodeRef: avifDefCodeRef(),
    };

    await visit(
      fileRenderPath(url, {
        fileRender: true,
        fileDefCodeRef: avifDefCodeRef(),
      }),
    );

    let { status } = await capturePrerenderResult('innerHTML');
    assert.strictEqual(status, 'ready', 'render completed');

    let img = document.querySelector(
      '[data-prerender] .image-isolated__img',
    ) as HTMLImageElement | null;
    assert.ok(img, 'img element is rendered');
    assert.ok(
      img?.getAttribute('src')?.includes('sample.avif'),
      'img src references the AVIF file',
    );

    await waitUntil(() => img!.naturalWidth > 0, {
      timeout: 5000,
      timeoutMessage:
        'Image failed to load - naturalWidth remained 0. This likely indicates an authentication issue preventing the browser from fetching the image.',
    });

    assert.ok(
      img!.naturalWidth > 0,
      'Image loaded successfully with non-zero width',
    );
    assert.ok(
      img!.naturalHeight > 0,
      'Image loaded successfully with non-zero height',
    );
  });
});
