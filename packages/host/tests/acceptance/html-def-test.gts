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
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';
import { setupTestRealmServiceWorker } from '../helpers/test-realm-service-worker';

const INTERACTIVE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Release &amp; Dispatch Report</title>
    <style>body { font-family: sans-serif; }</style>
  </head>
  <body>
    <h1>Dispatch board</h1>
    <p>Seven trucks left the depot before dawn.</p>
    <a href="https://example.com/fleet">Fleet roster</a>
    <img src="./depot.png" alt="Depot">
    <form><input type="text"><button type="submit">Send</button></form>
    <script type="module">document.title = 'Loaded';</script>
  </body>
</html>`;

const STATIC_HTML = `<p>Just a paragraph, no head, no scripts.</p>`;

module('Acceptance | html def', function (hooks) {
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

  const htmlDefCodeRef = (): ResolvedCodeRef => ({
    module: `${baseRealmRRI}html-file-def` as RealmResourceIdentifier,
    name: 'HtmlDef',
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

  async function renderHtmlFile(url: string, format = 'isolated') {
    await visit(
      fileExtractPath(url, {
        fileExtract: true,
        fileDefCodeRef: htmlDefCodeRef(),
      }),
    );
    let result = await captureFileExtractResult('ready');

    (globalThis as any).__boxelFileRenderData = {
      resource: result.resource,
      fileDefCodeRef: htmlDefCodeRef(),
    };

    await visit(
      fileRenderPath(
        url,
        { fileRender: true, fileDefCodeRef: htmlDefCodeRef() },
        format,
      ),
    );

    return capturePrerenderResult('innerHTML');
  }

  hooks.beforeEach(async function () {
    ({ realm } = await withCachedRealmSetup(async () =>
      setupAcceptanceTestRealm({
        mockMatrixUtils,
        contents: {
          ...SYSTEM_CARD_FIXTURE_CONTENTS,
          'dispatch.html': INTERACTIVE_HTML,
          'plain.html': STATIC_HTML,
        },
      }),
    ));
  });

  hooks.afterEach(function () {
    delete (globalThis as any).__renderModel;
    delete (globalThis as any).__boxelFileRenderData;
  });

  test('extracts document structure into the search doc', async function (assert) {
    let url = makeFileURL('dispatch.html');
    await visit(
      fileExtractPath(url, {
        fileExtract: true,
        fileDefCodeRef: htmlDefCodeRef(),
      }),
    );

    let result = await captureFileExtractResult('ready');
    assert.strictEqual(result.status, 'ready');
    assert.strictEqual(
      result.searchDoc?.title,
      'Release & Dispatch Report',
      'the decoded document title becomes the file title',
    );
    let html = result.searchDoc?.htmlMetadata;
    assert.strictEqual(html?.documentTitle, 'Release & Dispatch Report');
    assert.strictEqual(html?.documentLanguage, 'en');
    assert.strictEqual(html?.scriptCount, 1);
    assert.strictEqual(html?.headingCount, 1);
    assert.strictEqual(html?.linkCount, 1);
    assert.strictEqual(html?.imageCount, 1);
    assert.strictEqual(html?.formControlCount, 2);
    assert.strictEqual(html?.styleSheetCount, 1);
    assert.strictEqual(html?.externalResourceCount, 1);
    assert.true(html?.hasDoctype);
    assert.true(html?.hasViewportMeta);
    assert.true(html?.hasInlineScript);
    assert.true(html?.hasModuleScript);
    assert.true(html?.isInteractive);
    assert.ok(
      String(result.searchDoc?.excerpt).includes('Seven trucks left the depot'),
      'the excerpt is visible prose, not markup',
    );
    assert.strictEqual(
      result.searchDoc?.content,
      undefined,
      'the extract persists structural facts, never a second copy of the source',
    );
  });

  test('a titleless fragment stays static and titles from its file name', async function (assert) {
    let url = makeFileURL('plain.html');
    await visit(
      fileExtractPath(url, {
        fileExtract: true,
        fileDefCodeRef: htmlDefCodeRef(),
      }),
    );

    let result = await captureFileExtractResult('ready');
    assert.strictEqual(result.status, 'ready');
    assert.strictEqual(
      result.searchDoc?.title,
      'plain',
      'file name fills in when the document declares no title',
    );
    let html = result.searchDoc?.htmlMetadata;
    assert.strictEqual(html?.scriptCount, 0);
    assert.false(html?.isInteractive);
    assert.false(html?.hasDoctype);
  });

  test('indexing stores the HTML metadata and file meta serves it', async function (assert) {
    let fileURL = new URL('dispatch.html', testRealmURL);
    let fileEntry = await realm.realmIndexQueryEngine.file(fileURL);

    assert.strictEqual(
      fileEntry?.searchDoc?.htmlMetadata?.documentTitle,
      'Release & Dispatch Report',
      'the index row holds the extracted document title',
    );

    let network = getService('network') as NetworkService;
    let response = await network.virtualNetwork.fetch(fileURL, {
      headers: { Accept: SupportedMimeType.FileMeta },
    });
    assert.true(response.ok, 'file meta request succeeds');

    let body = await response.json();
    assert.true(
      body?.data?.attributes?.htmlMetadata?.isInteractive,
      'file meta serves the derived interactivity fact',
    );
    assert.deepEqual(
      body?.data?.meta?.adoptsFrom,
      htmlDefCodeRef(),
      'file meta uses the HTML def',
    );
  });

  test('isolated renders the document in a sandboxed frame inside the shared shell', async function (assert) {
    let { status } = await renderHtmlFile(makeFileURL('dispatch.html'));
    assert.strictEqual(status, 'ready', 'render completed');

    assert.ok(
      document.querySelector('[data-prerender] [data-test-file-isolated]'),
      'the shared isolated shell hosts the preview',
    );

    let frame = document.querySelector(
      '[data-prerender] [data-test-html-frame]',
    ) as HTMLIFrameElement | null;
    assert.ok(frame, 'the rendered view is an iframe');
    assert.strictEqual(
      frame?.getAttribute('sandbox'),
      'allow-scripts',
      'authored scripts run only inside the opaque-origin sandbox',
    );
    assert.strictEqual(
      frame?.getAttribute('referrerpolicy'),
      'no-referrer',
      'the document cannot leak the realm URL as a referrer',
    );

    await waitUntil(() => frame?.getAttribute('srcdoc'), { timeout: 5000 });
    let srcdoc = frame?.getAttribute('srcdoc') ?? '';
    assert.ok(
      srcdoc.includes('Dispatch board'),
      'the fetched source reaches the frame as srcdoc',
    );
    assert.ok(
      srcdoc.includes(`<base href="${makeFileURL('dispatch.html')}">`),
      'a base element makes relative assets resolve beside the file',
    );

    assert.ok(
      document.querySelector('[data-prerender] [data-test-html-view-source]'),
      'a source view sits beside the rendered view',
    );
  });

  test('fitted renders a static summary, never a frame', async function (assert) {
    let { status } = await renderHtmlFile(
      makeFileURL('dispatch.html'),
      'fitted',
    );
    assert.strictEqual(status, 'ready', 'render completed');

    let summary = document.querySelector(
      '[data-prerender] [data-test-html-summary]',
    );
    assert.ok(summary, 'the fitted cell shows the extracted summary');
    assert.ok(
      summary?.textContent?.includes('Release & Dispatch Report'),
      'the summary leads with the document title',
    );
    assert.notOk(
      document.querySelector('[data-prerender] iframe'),
      'a collection cell never mounts a frame',
    );
  });
});
