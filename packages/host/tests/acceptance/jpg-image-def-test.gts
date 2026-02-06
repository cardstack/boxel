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

// Build a minimal valid JPEG with specified dimensions.
// Structure: SOI + APP0 (JFIF) + SOF0 (with dimensions) + EOI
function makeMinimalJpg(width: number, height: number): Uint8Array {
  let parts: number[] = [];

  // SOI marker
  parts.push(0xff, 0xd8);

  // APP0 (JFIF) marker — needed for a well-formed JPEG
  let jfif = [
    0xff,
    0xe0, // APP0 marker
    0x00,
    0x10, // Length: 16
    0x4a,
    0x46,
    0x49,
    0x46,
    0x00, // "JFIF\0"
    0x01,
    0x01, // Version 1.1
    0x00, // Pixel aspect ratio
    0x00,
    0x01, // X density: 1
    0x00,
    0x01, // Y density: 1
    0x00, // No thumbnail X
    0x00, // No thumbnail Y
  ];
  parts.push(...jfif);

  // SOF0 (Baseline DCT) marker with dimensions
  // Length = 2 (length field) + 1 (precision) + 2 (height) + 2 (width) + 1 (components count)
  //        + 3 * 1 (component specification) = 11
  let sof0 = [
    0xff,
    0xc0, // SOF0 marker
    0x00,
    0x0b, // Length: 11
    0x08, // Precision: 8 bits
    (height >> 8) & 0xff,
    height & 0xff, // Height (big-endian)
    (width >> 8) & 0xff,
    width & 0xff, // Width (big-endian)
    0x01, // 1 component
    0x01,
    0x11,
    0x00, // Component 1: ID=1, sampling=1x1, quant table=0
  ];
  parts.push(...sof0);

  // EOI marker
  parts.push(0xff, 0xd9);

  return new Uint8Array(parts);
}

module('Acceptance | jpg image def', function (hooks) {
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

  const jpgDefCodeRef = (): ResolvedCodeRef => ({
    module: `${baseRealm.url}jpg-image-def`,
    name: 'JpgDef',
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
    let jpgBytes = makeMinimalJpg(4, 5);
    ({ realm } = await setupAcceptanceTestRealm({
      mockMatrixUtils,
      contents: {
        ...SYSTEM_CARD_FIXTURE_CONTENTS,
        'sample.jpg': jpgBytes,
        'not-a-jpg.jpg': 'This is plain text, not a JPEG file.',
      },
    }));
  });

  hooks.afterEach(function () {
    delete (globalThis as any).__renderModel;
    delete (globalThis as any).__boxelFileRenderData;
  });

  test('extracts width and height from JPEG', async function (assert) {
    let url = makeFileURL('sample.jpg');
    await visit(
      fileExtractPath(url, {
        fileExtract: true,
        fileDefCodeRef: jpgDefCodeRef(),
      }),
    );

    let result = await captureFileExtractResult('ready');
    assert.strictEqual(result.status, 'ready');
    assert.strictEqual(result.searchDoc?.width, 4, 'extracts JPEG width');
    assert.strictEqual(result.searchDoc?.height, 5, 'extracts JPEG height');
    assert.strictEqual(result.searchDoc?.name, 'sample.jpg');
    assert.ok(
      String(result.searchDoc?.contentType).includes('jpeg'),
      'sets jpeg content type',
    );
  });

  test('falls back when JpgDef is used for non-JPEG content', async function (assert) {
    let url = makeFileURL('not-a-jpg.jpg');
    await visit(
      fileExtractPath(url, {
        fileExtract: true,
        fileDefCodeRef: jpgDefCodeRef(),
      }),
    );

    let result = await captureFileExtractResult('ready');
    assert.strictEqual(result.status, 'ready');
    assert.true(
      result.mismatch,
      'marks mismatch when content is not valid JPEG',
    );
    assert.strictEqual(result.searchDoc?.name, 'not-a-jpg.jpg');
  });

  test('isolated template renders img with width and height attributes', async function (assert) {
    let url = makeFileURL('sample.jpg');

    // First extract the file to get the resource
    await visit(
      fileExtractPath(url, {
        fileExtract: true,
        fileDefCodeRef: jpgDefCodeRef(),
      }),
    );
    let result = await captureFileExtractResult('ready');
    assert.ok(result.resource, 'extraction produced a resource');

    // Set up file render data and visit the HTML render route
    (globalThis as any).__boxelFileRenderData = {
      resource: result.resource,
      fileDefCodeRef: jpgDefCodeRef(),
    };

    await visit(
      fileRenderPath(url, {
        fileRender: true,
        fileDefCodeRef: jpgDefCodeRef(),
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
      '4',
      'img has correct width attribute',
    );
    assert.strictEqual(
      img?.getAttribute('height'),
      '5',
      'img has correct height attribute',
    );
    assert.ok(
      img?.getAttribute('src')?.includes('sample.jpg'),
      'img src references the JPEG file',
    );
  });

  test('indexing stores JPEG metadata and file meta uses it', async function (assert) {
    let fileURL = new URL('sample.jpg', testRealmURL);
    let fileEntry = await realm.realmIndexQueryEngine.file(fileURL);

    assert.ok(fileEntry, 'file entry exists');
    assert.strictEqual(
      fileEntry?.searchDoc?.width,
      4,
      'index stores JPEG width',
    );
    assert.strictEqual(
      fileEntry?.searchDoc?.height,
      5,
      'index stores JPEG height',
    );

    let network = getService('network') as NetworkService;
    let response = await network.virtualNetwork.fetch(fileURL, {
      headers: { Accept: SupportedMimeType.FileMeta },
    });

    assert.true(response.ok, 'file meta request succeeds');

    let body = await response.json();
    assert.strictEqual(body?.data?.type, 'file-meta');
    assert.ok(
      String(body?.data?.attributes?.contentType).includes('jpeg'),
      'file meta uses jpeg content type',
    );
    assert.strictEqual(
      body?.data?.attributes?.width,
      4,
      'file meta includes JPEG width',
    );
    assert.strictEqual(
      body?.data?.attributes?.height,
      5,
      'file meta includes JPEG height',
    );
    assert.deepEqual(
      body?.data?.meta?.adoptsFrom,
      jpgDefCodeRef(),
      'file meta uses JPEG def',
    );
  });

  test('authenticated images display in browser', async function (assert) {
    let url = makeFileURL('sample.jpg');

    // First extract the file to get the resource
    await visit(
      fileExtractPath(url, {
        fileExtract: true,
        fileDefCodeRef: jpgDefCodeRef(),
      }),
    );
    let result = await captureFileExtractResult('ready');
    assert.ok(result.resource, 'extraction produced a resource');

    // Set up file render data and visit the HTML render route
    (globalThis as any).__boxelFileRenderData = {
      resource: result.resource,
      fileDefCodeRef: jpgDefCodeRef(),
    };

    await visit(
      fileRenderPath(url, {
        fileRender: true,
        fileDefCodeRef: jpgDefCodeRef(),
      }),
    );

    let { status } = await capturePrerenderResult('innerHTML');
    assert.strictEqual(status, 'ready', 'render completed');

    let img = document.querySelector(
      '[data-prerender] .image-isolated__img',
    ) as HTMLImageElement | null;
    assert.ok(img, 'img element is rendered');
    assert.ok(
      img?.getAttribute('src')?.includes('sample.jpg'),
      'img src references the JPEG file',
    );

    // Wait for the image to actually load and verify it has non-zero dimensions.
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
