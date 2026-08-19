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

// A minimal but structurally legible PDF: a two-page tree and an Info
// dictionary, with no cross-reference table (the reader scans objects rather
// than resolving offsets). Not a renderable document — the page viewer's
// `<object>` has nothing real to draw — which is what lets the render test
// assert the viewer chrome without shipping a binary.
function makeMinimalPdf(): Uint8Array {
  return encoder.encode(
    '%PDF-1.7\n' +
      '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
      '2 0 obj<</Type/Pages/Kids[3 0 R 4 0 R]/Count 2>>endobj\n' +
      '3 0 obj<</Type/Page/Parent 2 0 R>>endobj\n' +
      '4 0 obj<</Type/Page/Parent 2 0 R>>endobj\n' +
      '5 0 obj<</Title(Boxel Test Document)/Author(Test Author)' +
      '/Producer(Boxel Test Suite)/CreationDate(D:20240320120000Z)>>endobj\n' +
      'trailer<</Root 1 0 R/Info 5 0 R>>\n' +
      '%%EOF\n',
  );
}

module('Acceptance | pdf file def', function (hooks) {
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

  const pdfDefCodeRef = (): ResolvedCodeRef => ({
    module: `${baseRealmRRI}pdf-file-def` as RealmResourceIdentifier,
    name: 'PdfDef',
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
          'sample.pdf': makeMinimalPdf(),
          'not-a-pdf.pdf': 'This is plain text, not a PDF document.',
        },
      }),
    ));
  });

  hooks.afterEach(function () {
    delete (globalThis as any).__renderModel;
    delete (globalThis as any).__boxelFileRenderData;
  });

  test('extracts page count and Info-dictionary metadata from a PDF', async function (assert) {
    let url = makeFileURL('sample.pdf');
    await visit(
      fileExtractPath(url, {
        fileExtract: true,
        fileDefCodeRef: pdfDefCodeRef(),
      }),
    );

    let result = await captureFileExtractResult('ready');
    assert.strictEqual(result.status, 'ready');
    assert.strictEqual(
      result.searchDoc?.documentInfo?.pageCount,
      2,
      'extracts the page count',
    );
    assert.strictEqual(
      result.searchDoc?.documentInfo?.title,
      'Boxel Test Document',
      'extracts the title',
    );
    assert.strictEqual(
      result.searchDoc?.documentInfo?.author,
      'Test Author',
      'extracts the author',
    );
    assert.strictEqual(
      result.searchDoc?.documentInfo?.pdfVersion,
      '1.7',
      'extracts the PDF version',
    );
  });

  test('falls back when PdfDef is used for non-PDF content', async function (assert) {
    let url = makeFileURL('not-a-pdf.pdf');
    await visit(
      fileExtractPath(url, {
        fileExtract: true,
        fileDefCodeRef: pdfDefCodeRef(),
      }),
    );

    let result = await captureFileExtractResult('ready');
    assert.strictEqual(result.status, 'ready');
    assert.true(result.mismatch, 'marks mismatch when content is not a PDF');
    assert.strictEqual(result.searchDoc?.name, 'not-a-pdf.pdf');
  });

  test('isolated template mounts the native page viewer', async function (assert) {
    let url = makeFileURL('sample.pdf');

    await visit(
      fileExtractPath(url, {
        fileExtract: true,
        fileDefCodeRef: pdfDefCodeRef(),
      }),
    );
    let result = await captureFileExtractResult('ready');
    assert.ok(result.resource, 'extraction produced a resource');

    (globalThis as any).__boxelFileRenderData = {
      resource: result.resource,
      fileDefCodeRef: pdfDefCodeRef(),
    };

    await visit(
      fileRenderPath(url, {
        fileRender: true,
        fileDefCodeRef: pdfDefCodeRef(),
      }),
    );

    let { status } = await capturePrerenderResult('innerHTML');
    assert.strictEqual(status, 'ready', 'render completed');

    let viewer = document.querySelector(
      '[data-prerender] [data-test-pdf-viewer]',
    ) as HTMLObjectElement | null;
    assert.ok(viewer, 'the native PDF viewer is mounted');
    assert.strictEqual(
      viewer?.getAttribute('type'),
      'application/pdf',
      'the viewer requests the PDF content type',
    );
  });

  test('indexing stores document metadata and file meta uses it', async function (assert) {
    let fileURL = new URL('sample.pdf', testRealmURL);
    let fileEntry = await realm.realmIndexQueryEngine.file(fileURL);

    assert.ok(fileEntry, 'file entry exists');
    assert.strictEqual(
      fileEntry?.searchDoc?.documentInfo?.pageCount,
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
      body?.data?.attributes?.documentInfo?.title,
      'Boxel Test Document',
      'file meta includes the document title',
    );
    assert.deepEqual(
      body?.data?.meta?.adoptsFrom,
      pdfDefCodeRef(),
      'file meta uses the PDF def',
    );
  });
});
