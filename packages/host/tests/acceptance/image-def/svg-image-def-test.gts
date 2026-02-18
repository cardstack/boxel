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
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupApplicationTest } from '../../helpers/setup';
import { setupTestRealmServiceWorker } from '../../helpers/test-realm-service-worker';

function makeMinimalSvg(width: number, height: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="red"/></svg>`;
}

module('Acceptance | svg image def', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);
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

  const svgDefCodeRef = (): ResolvedCodeRef => ({
    module: `${baseRealm.url}svg-image-def`,
    name: 'SvgDef',
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
    ({ realm } = await setupAcceptanceTestRealm({
      mockMatrixUtils,
      contents: {
        ...SYSTEM_CARD_FIXTURE_CONTENTS,
        'sample.svg': makeMinimalSvg(120, 80),
        'viewbox-only.svg':
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 150"><circle cx="100" cy="75" r="50"/></svg>',
        'not-an-svg.svg': 'This is plain text, not an SVG file.',
      },
    }));
  });

  hooks.afterEach(function () {
    delete (globalThis as any).__renderModel;
    delete (globalThis as any).__boxelFileRenderData;
  });

  test('extracts width and height from SVG with explicit attributes', async function (assert) {
    let url = makeFileURL('sample.svg');
    await visit(
      fileExtractPath(url, {
        fileExtract: true,
        fileDefCodeRef: svgDefCodeRef(),
      }),
    );

    let result = await captureFileExtractResult('ready');
    assert.strictEqual(result.status, 'ready');
    assert.strictEqual(result.searchDoc?.width, 120, 'extracts SVG width');
    assert.strictEqual(result.searchDoc?.height, 80, 'extracts SVG height');
    assert.strictEqual(result.searchDoc?.name, 'sample.svg');
    assert.ok(
      String(result.searchDoc?.contentType).includes('svg'),
      'sets svg content type',
    );
  });

  test('extracts dimensions from viewBox when width/height attributes are absent', async function (assert) {
    let url = makeFileURL('viewbox-only.svg');
    await visit(
      fileExtractPath(url, {
        fileExtract: true,
        fileDefCodeRef: svgDefCodeRef(),
      }),
    );

    let result = await captureFileExtractResult('ready');
    assert.strictEqual(result.status, 'ready');
    assert.strictEqual(
      result.searchDoc?.width,
      200,
      'extracts width from viewBox',
    );
    assert.strictEqual(
      result.searchDoc?.height,
      150,
      'extracts height from viewBox',
    );
  });

  test('falls back when SvgDef is used for non-SVG content', async function (assert) {
    let url = makeFileURL('not-an-svg.svg');
    await visit(
      fileExtractPath(url, {
        fileExtract: true,
        fileDefCodeRef: svgDefCodeRef(),
      }),
    );

    let result = await captureFileExtractResult('ready');
    assert.strictEqual(result.status, 'ready');
    assert.true(
      result.mismatch,
      'marks mismatch when content is not valid SVG',
    );
    assert.strictEqual(result.searchDoc?.name, 'not-an-svg.svg');
  });

  test('isolated template renders img with width and height attributes', async function (assert) {
    let url = makeFileURL('sample.svg');

    // First extract the file to get the resource
    await visit(
      fileExtractPath(url, {
        fileExtract: true,
        fileDefCodeRef: svgDefCodeRef(),
      }),
    );
    let result = await captureFileExtractResult('ready');
    assert.ok(result.resource, 'extraction produced a resource');

    // Set up file render data and visit the HTML render route
    (globalThis as any).__boxelFileRenderData = {
      resource: result.resource,
      fileDefCodeRef: svgDefCodeRef(),
    };

    await visit(
      fileRenderPath(url, {
        fileRender: true,
        fileDefCodeRef: svgDefCodeRef(),
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
      '120',
      'img has correct width attribute',
    );
    assert.strictEqual(
      img?.getAttribute('height'),
      '80',
      'img has correct height attribute',
    );
    assert.ok(
      img?.getAttribute('src')?.includes('sample.svg'),
      'img src references the SVG file',
    );
  });

  test('indexing stores SVG metadata and file meta uses it', async function (assert) {
    let fileURL = new URL('sample.svg', testRealmURL);
    let fileEntry = await realm.realmIndexQueryEngine.file(fileURL);

    assert.ok(fileEntry, 'file entry exists');
    assert.strictEqual(
      fileEntry?.searchDoc?.width,
      120,
      'index stores SVG width',
    );
    assert.strictEqual(
      fileEntry?.searchDoc?.height,
      80,
      'index stores SVG height',
    );

    let network = getService('network') as NetworkService;
    let response = await network.virtualNetwork.fetch(fileURL, {
      headers: { Accept: SupportedMimeType.FileMeta },
    });

    assert.true(response.ok, 'file meta request succeeds');

    let body = await response.json();
    assert.strictEqual(body?.data?.type, 'file-meta');
    assert.ok(
      String(body?.data?.attributes?.contentType).includes('svg'),
      'file meta uses svg content type',
    );
    assert.strictEqual(
      body?.data?.attributes?.width,
      120,
      'file meta includes SVG width',
    );
    assert.strictEqual(
      body?.data?.attributes?.height,
      80,
      'file meta includes SVG height',
    );
    assert.deepEqual(
      body?.data?.meta?.adoptsFrom,
      svgDefCodeRef(),
      'file meta uses SVG def',
    );
  });

  test('authenticated images display in browser', async function (assert) {
    let url = makeFileURL('sample.svg');

    // First extract the file to get the resource
    await visit(
      fileExtractPath(url, {
        fileExtract: true,
        fileDefCodeRef: svgDefCodeRef(),
      }),
    );
    let result = await captureFileExtractResult('ready');
    assert.ok(result.resource, 'extraction produced a resource');

    // Set up file render data and visit the HTML render route
    (globalThis as any).__boxelFileRenderData = {
      resource: result.resource,
      fileDefCodeRef: svgDefCodeRef(),
    };

    await visit(
      fileRenderPath(url, {
        fileRender: true,
        fileDefCodeRef: svgDefCodeRef(),
      }),
    );

    let { status } = await capturePrerenderResult('innerHTML');
    assert.strictEqual(status, 'ready', 'render completed');

    let img = document.querySelector(
      '[data-prerender] .image-isolated__img',
    ) as HTMLImageElement | null;
    assert.ok(img, 'img element is rendered');
    assert.ok(
      img?.getAttribute('src')?.includes('sample.svg'),
      'img src references the SVG file',
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
