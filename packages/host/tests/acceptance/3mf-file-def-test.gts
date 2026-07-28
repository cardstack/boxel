import { visit, waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import { zipSync, strToU8 } from 'fflate';

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

// A minimal but realistic 3MF: an OPC package (ZIP) whose `3D/3dmodel.model`
// XML carries the searchable metadata and a tiny mesh, plus a thumbnail part.
function makeMinimal3mf(): Uint8Array {
  let model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <metadata name="Title">Benchy Boat</metadata>
  <metadata name="Designer">Creative Tools &amp; Co</metadata>
  <metadata name="Description">A calibration boat for testing 3D printers.</metadata>
  <metadata name="LicenseTerms">CC BY 4.0</metadata>
  <metadata name="Application">PrusaSlicer 2.7</metadata>
  <resources>
    <object id="1" type="model">
      <mesh>
        <vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices>
        <triangles><triangle v1="0" v2="1" v3="2"/></triangles>
      </mesh>
    </object>
  </resources>
  <build><item objectid="1"/></build>
</model>`;
  let contentTypes = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="png" ContentType="image/png"/></Types>`;
  let rels = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/><Relationship Target="/Metadata/thumbnail.png" Id="rel1" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail"/></Relationships>`;
  return zipSync({
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rels),
    '3D/3dmodel.model': strToU8(model),
    'Metadata/thumbnail.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  });
}

// A ZIP that is a valid archive but has no `*.model` part.
function makeZipWithoutModel(): Uint8Array {
  return zipSync({ 'readme.txt': strToU8('not a 3mf model') });
}

module('Acceptance | 3mf file def', function (hooks) {
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

  const threeMfDefCodeRef = (): ResolvedCodeRef => ({
    module: `${baseRealmRRI}3mf-file-def` as RealmResourceIdentifier,
    name: 'ThreeMfDef',
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
    ({ realm } = await withCachedRealmSetup(async () =>
      setupAcceptanceTestRealm({
        mockMatrixUtils,
        contents: {
          ...SYSTEM_CARD_FIXTURE_CONTENTS,
          'model.3mf': makeMinimal3mf(),
          'not-a-3mf.3mf': 'This is plain text, not a ZIP archive.',
          'no-model.3mf': makeZipWithoutModel(),
        },
      }),
    ));
  });

  hooks.afterEach(function () {
    delete (globalThis as any).__renderModel;
    delete (globalThis as any).__boxelFileRenderData;
  });

  test('extracts metadata from 3mf', async function (assert) {
    let url = makeFileURL('model.3mf');
    await visit(
      fileExtractPath(url, {
        fileExtract: true,
        fileDefCodeRef: threeMfDefCodeRef(),
      }),
    );

    let result = await captureFileExtractResult('ready');
    assert.strictEqual(result.status, 'ready');
    assert.strictEqual(
      result.searchDoc?.title,
      'Benchy Boat',
      'extracts title',
    );
    assert.strictEqual(
      result.searchDoc?.designer,
      'Creative Tools & Co',
      'extracts designer and decodes entities',
    );
    assert.strictEqual(
      result.searchDoc?.description,
      'A calibration boat for testing 3D printers.',
      'extracts description',
    );
    assert.strictEqual(
      result.searchDoc?.license,
      'CC BY 4.0',
      'extracts license',
    );
    assert.strictEqual(result.searchDoc?.unit, 'millimeter', 'extracts unit');
    assert.true(result.searchDoc?.hasThumbnail, 'detects thumbnail');
    assert.strictEqual(result.searchDoc?.name, 'model.3mf');
    assert.strictEqual(
      result.searchDoc?.contentType,
      'model/3mf',
      'sets 3mf content type',
    );
  });

  test('falls back when ThreeMfDef is used for non-ZIP content', async function (assert) {
    let url = makeFileURL('not-a-3mf.3mf');
    await visit(
      fileExtractPath(url, {
        fileExtract: true,
        fileDefCodeRef: threeMfDefCodeRef(),
      }),
    );

    let result = await captureFileExtractResult('ready');
    assert.strictEqual(result.status, 'ready');
    assert.true(result.mismatch, 'marks mismatch when content is not a ZIP');
    assert.strictEqual(result.searchDoc?.name, 'not-a-3mf.3mf');
  });

  test('falls back when the ZIP has no model part', async function (assert) {
    let url = makeFileURL('no-model.3mf');
    await visit(
      fileExtractPath(url, {
        fileExtract: true,
        fileDefCodeRef: threeMfDefCodeRef(),
      }),
    );

    let result = await captureFileExtractResult('ready');
    assert.strictEqual(result.status, 'ready');
    assert.true(result.mismatch, 'marks mismatch when there is no model part');
    assert.strictEqual(result.searchDoc?.name, 'no-model.3mf');
  });

  test('isolated template renders the title and designer', async function (assert) {
    let url = makeFileURL('model.3mf');

    await visit(
      fileExtractPath(url, {
        fileExtract: true,
        fileDefCodeRef: threeMfDefCodeRef(),
      }),
    );
    let result = await captureFileExtractResult('ready');
    assert.ok(result.resource, 'extraction produced a resource');

    (globalThis as any).__boxelFileRenderData = {
      resource: result.resource,
      fileDefCodeRef: threeMfDefCodeRef(),
    };

    await visit(
      fileRenderPath(url, {
        fileRender: true,
        fileDefCodeRef: threeMfDefCodeRef(),
      }),
    );

    let { status } = await capturePrerenderResult('innerHTML');
    assert.strictEqual(status, 'ready', 'render completed');

    let title = document.querySelector(
      '[data-prerender] .threemf-isolated__title',
    );
    assert.strictEqual(
      title?.textContent?.trim(),
      'Benchy Boat',
      'renders the extracted title',
    );
    let designer = document.querySelector(
      '[data-prerender] .threemf-isolated__designer',
    );
    assert.strictEqual(
      designer?.textContent?.trim(),
      'by Creative Tools & Co',
      'renders the designer',
    );
  });

  test('indexing stores 3mf metadata and file meta uses it', async function (assert) {
    let fileURL = new URL('model.3mf', testRealmURL);
    let fileEntry = await realm.realmIndexQueryEngine.file(fileURL);

    assert.ok(fileEntry, 'file entry exists');
    assert.strictEqual(
      fileEntry?.searchDoc?.title,
      'Benchy Boat',
      'index stores 3mf title',
    );
    assert.strictEqual(
      fileEntry?.searchDoc?.designer,
      'Creative Tools & Co',
      'index stores 3mf designer',
    );

    let network = getService('network') as NetworkService;
    let response = await network.virtualNetwork.fetch(fileURL, {
      headers: { Accept: SupportedMimeType.FileMeta },
    });

    assert.true(response.ok, 'file meta request succeeds');

    let body = await response.json();
    assert.strictEqual(body?.data?.type, 'file-meta');
    assert.strictEqual(
      body?.data?.attributes?.contentType,
      'model/3mf',
      'file meta uses 3mf content type',
    );
    assert.strictEqual(
      body?.data?.attributes?.title,
      'Benchy Boat',
      'file meta includes 3mf title',
    );
    assert.strictEqual(
      body?.data?.attributes?.designer,
      'Creative Tools & Co',
      'file meta includes 3mf designer',
    );
    assert.deepEqual(
      body?.data?.meta?.adoptsFrom,
      threeMfDefCodeRef(),
      'file meta uses 3mf def',
    );
  });
});
