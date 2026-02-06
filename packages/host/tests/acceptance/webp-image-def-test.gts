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

// Build a minimal valid WebP (lossy VP8) with specified dimensions.
// Structure: RIFF header (12) + VP8 chunk header (8) + VP8 frame header (10)
function makeMinimalWebp(width: number, height: number): Uint8Array {
  let parts: number[] = [];

  // VP8 bitstream payload (10 bytes minimum)
  let vp8Payload = [
    // Frame tag (3 bytes): keyframe, version 0, show_frame=1
    0x9d,
    0x01,
    0x2a,
    // Note: first 3 bytes are actually part of the frame tag;
    // the start code 9D 01 2A comes next in the bitstream.
    // For a minimal VP8: bytes 0-2 are frame tag, bytes 3-5 are start code
  ];

  // Corrected VP8 bitstream:
  // Bytes 0-2: frame tag
  //   bit 0: keyframe (0 = keyframe)
  //   bits 1-3: version
  //   bit 4: show_frame
  //   bits 5-18: first_part_size (at least enough for header)
  //   We'll use: 0x00 0x00 0x00 → not quite right. Let me use a known working pattern.
  vp8Payload = [
    // Frame tag: keyframe=1, version=0, show=1, partition_size
    0x30, 0x01, 0x00,
    // Start code: 0x9D 0x01 0x2A
    0x9d, 0x01, 0x2a,
    // Width (LE uint16, lower 14 bits = width, upper 2 bits = horizontal scale)
    width & 0xff,
    (width >> 8) & 0x3f,
    // Height (LE uint16, lower 14 bits = height, upper 2 bits = vertical scale)
    height & 0xff,
    (height >> 8) & 0x3f,
  ];

  // VP8 chunk size
  let vp8ChunkSize = vp8Payload.length;

  // Total RIFF file size = 4 ("WEBP") + 8 (VP8 chunk header) + VP8 chunk data
  let riffSize = 4 + 8 + vp8ChunkSize;

  // RIFF header
  parts.push(0x52, 0x49, 0x46, 0x46); // "RIFF"
  parts.push(
    riffSize & 0xff,
    (riffSize >> 8) & 0xff,
    (riffSize >> 16) & 0xff,
    (riffSize >> 24) & 0xff,
  );
  parts.push(0x57, 0x45, 0x42, 0x50); // "WEBP"

  // VP8 chunk header
  parts.push(0x56, 0x50, 0x38, 0x20); // "VP8 "
  parts.push(
    vp8ChunkSize & 0xff,
    (vp8ChunkSize >> 8) & 0xff,
    (vp8ChunkSize >> 16) & 0xff,
    (vp8ChunkSize >> 24) & 0xff,
  );

  // VP8 payload
  parts.push(...vp8Payload);

  return new Uint8Array(parts);
}

module('Acceptance | webp image def', function (hooks) {
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

  const webpDefCodeRef = (): ResolvedCodeRef => ({
    module: `${baseRealm.url}webp-image-def`,
    name: 'WebpDef',
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
    let webpBytes = makeMinimalWebp(8, 9);
    ({ realm } = await setupAcceptanceTestRealm({
      mockMatrixUtils,
      contents: {
        ...SYSTEM_CARD_FIXTURE_CONTENTS,
        'sample.webp': webpBytes,
        'not-a-webp.webp': 'This is plain text, not a WebP file.',
      },
    }));
  });

  hooks.afterEach(function () {
    delete (globalThis as any).__renderModel;
    delete (globalThis as any).__boxelFileRenderData;
  });

  test('extracts width and height from WebP', async function (assert) {
    let url = makeFileURL('sample.webp');
    await visit(
      fileExtractPath(url, {
        fileExtract: true,
        fileDefCodeRef: webpDefCodeRef(),
      }),
    );

    let result = await captureFileExtractResult('ready');
    assert.strictEqual(result.status, 'ready');
    assert.strictEqual(result.searchDoc?.width, 8, 'extracts WebP width');
    assert.strictEqual(result.searchDoc?.height, 9, 'extracts WebP height');
    assert.strictEqual(result.searchDoc?.name, 'sample.webp');
    assert.ok(
      String(result.searchDoc?.contentType).includes('webp'),
      'sets webp content type',
    );
  });

  test('falls back when WebpDef is used for non-WebP content', async function (assert) {
    let url = makeFileURL('not-a-webp.webp');
    await visit(
      fileExtractPath(url, {
        fileExtract: true,
        fileDefCodeRef: webpDefCodeRef(),
      }),
    );

    let result = await captureFileExtractResult('ready');
    assert.strictEqual(result.status, 'ready');
    assert.true(
      result.mismatch,
      'marks mismatch when content is not valid WebP',
    );
    assert.strictEqual(result.searchDoc?.name, 'not-a-webp.webp');
  });

  test('isolated template renders img with width and height attributes', async function (assert) {
    let url = makeFileURL('sample.webp');

    // First extract the file to get the resource
    await visit(
      fileExtractPath(url, {
        fileExtract: true,
        fileDefCodeRef: webpDefCodeRef(),
      }),
    );
    let result = await captureFileExtractResult('ready');
    assert.ok(result.resource, 'extraction produced a resource');

    // Set up file render data and visit the HTML render route
    (globalThis as any).__boxelFileRenderData = {
      resource: result.resource,
      fileDefCodeRef: webpDefCodeRef(),
    };

    await visit(
      fileRenderPath(url, {
        fileRender: true,
        fileDefCodeRef: webpDefCodeRef(),
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
      '8',
      'img has correct width attribute',
    );
    assert.strictEqual(
      img?.getAttribute('height'),
      '9',
      'img has correct height attribute',
    );
    assert.ok(
      img?.getAttribute('src')?.includes('sample.webp'),
      'img src references the WebP file',
    );
  });

  test('indexing stores WebP metadata and file meta uses it', async function (assert) {
    let fileURL = new URL('sample.webp', testRealmURL);
    let fileEntry = await realm.realmIndexQueryEngine.file(fileURL);

    assert.ok(fileEntry, 'file entry exists');
    assert.strictEqual(
      fileEntry?.searchDoc?.width,
      8,
      'index stores WebP width',
    );
    assert.strictEqual(
      fileEntry?.searchDoc?.height,
      9,
      'index stores WebP height',
    );

    let network = getService('network') as NetworkService;
    let response = await network.virtualNetwork.fetch(fileURL, {
      headers: { Accept: SupportedMimeType.FileMeta },
    });

    assert.true(response.ok, 'file meta request succeeds');

    let body = await response.json();
    assert.strictEqual(body?.data?.type, 'file-meta');
    assert.ok(
      String(body?.data?.attributes?.contentType).includes('webp'),
      'file meta uses webp content type',
    );
    assert.strictEqual(
      body?.data?.attributes?.width,
      8,
      'file meta includes WebP width',
    );
    assert.strictEqual(
      body?.data?.attributes?.height,
      9,
      'file meta includes WebP height',
    );
    assert.deepEqual(
      body?.data?.meta?.adoptsFrom,
      webpDefCodeRef(),
      'file meta uses WebP def',
    );
  });

  test('authenticated images display in browser', async function (assert) {
    let url = makeFileURL('sample.webp');

    // First extract the file to get the resource
    await visit(
      fileExtractPath(url, {
        fileExtract: true,
        fileDefCodeRef: webpDefCodeRef(),
      }),
    );
    let result = await captureFileExtractResult('ready');
    assert.ok(result.resource, 'extraction produced a resource');

    // Set up file render data and visit the HTML render route
    (globalThis as any).__boxelFileRenderData = {
      resource: result.resource,
      fileDefCodeRef: webpDefCodeRef(),
    };

    await visit(
      fileRenderPath(url, {
        fileRender: true,
        fileDefCodeRef: webpDefCodeRef(),
      }),
    );

    let { status } = await capturePrerenderResult('innerHTML');
    assert.strictEqual(status, 'ready', 'render completed');

    let img = document.querySelector(
      '[data-prerender] .image-isolated__img',
    ) as HTMLImageElement | null;
    assert.ok(img, 'img element is rendered');
    assert.ok(
      img?.getAttribute('src')?.includes('sample.webp'),
      'img src references the WebP file',
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
