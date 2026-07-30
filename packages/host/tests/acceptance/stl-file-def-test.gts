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
  withCachedRealmSetup,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

// A size-consistent binary STL: 80-byte header, little-endian uint32 triangle
// count, then 50 bytes/triangle (payload left zeroed).
function binaryStl(triangleCount: number): Uint8Array {
  let bytes = new Uint8Array(84 + 50 * triangleCount);
  new DataView(bytes.buffer).setUint32(
    80,
    triangleCount,
    /* littleEndian */ true,
  );
  return bytes;
}

const ASCII_STL = `solid cube
facet normal 0 0 0
  outer loop
    vertex 0 0 0
    vertex 1 0 0
    vertex 0 1 0
  endloop
endfacet
endsolid cube
`;

module('Acceptance | stl file def', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);
  setupRealmCacheTeardown(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
  });
  let realm: Realm;

  const renderPath = (
    url: string,
    renderOptions: RenderRouteOptions,
    nonce = 0,
  ) =>
    `/render/${encodeURIComponent(url)}/${nonce}/${encodeURIComponent(
      JSON.stringify(renderOptions),
    )}/file-extract`;

  const makeFileURL = (path: string) => new URL(path, testRealmURL).href;

  const stlDefCodeRef = (): ResolvedCodeRef => ({
    module: `${baseRealmRRI}stl-file-def` as RealmResourceIdentifier,
    name: 'StlDef',
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
          'binary.stl': binaryStl(3),
          'ascii.stl': ASCII_STL,
          'readme.md': `# Not an STL file

This is markdown content.`,
        },
      }),
    ));
  });

  hooks.afterEach(function () {
    delete (globalThis as any).__renderModel;
  });

  test('extracts binary encoding from a binary stl file', async function (assert) {
    let url = makeFileURL('binary.stl');
    await visit(
      renderPath(url, {
        fileExtract: true,
        fileDefCodeRef: stlDefCodeRef(),
      }),
    );

    let result = await captureFileExtractResult('ready');
    assert.strictEqual(result.status, 'ready');
    assert.strictEqual(result.searchDoc?.format, 'binary', 'detects binary');
    assert.strictEqual(
      result.searchDoc?.triangleCount,
      3,
      'extracts binary triangle count',
    );
    assert.strictEqual(result.searchDoc?.name, 'binary.stl');
    assert.ok(
      String(result.searchDoc?.contentType).includes('stl'),
      'sets stl content type',
    );
  });

  test('extracts ascii encoding from an ascii stl file', async function (assert) {
    let url = makeFileURL('ascii.stl');
    await visit(
      renderPath(url, {
        fileExtract: true,
        fileDefCodeRef: stlDefCodeRef(),
      }),
    );

    let result = await captureFileExtractResult('ready');
    assert.strictEqual(result.status, 'ready');
    assert.strictEqual(result.searchDoc?.format, 'ascii', 'detects ascii');
    assert.strictEqual(
      result.searchDoc?.solidName,
      'cube',
      'extracts ascii solid name',
    );
    assert.strictEqual(result.searchDoc?.name, 'ascii.stl');
  });

  test('falls back when stl def is used for non-stl files', async function (assert) {
    let url = makeFileURL('readme.md');
    await visit(
      renderPath(url, {
        fileExtract: true,
        fileDefCodeRef: stlDefCodeRef(),
      }),
    );

    let result = await captureFileExtractResult('ready');
    assert.strictEqual(result.status, 'ready');
    assert.true(result.mismatch, 'marks mismatch when extension is not stl');
    assert.strictEqual(result.searchDoc?.name, 'readme.md');
  });

  test('indexing stores stl format and file-meta resolves to StlDef', async function (assert) {
    let fileURL = new URL('binary.stl', testRealmURL);
    let fileEntry = await realm.realmIndexQueryEngine.file(fileURL);

    assert.ok(fileEntry, 'file entry exists');
    assert.strictEqual(
      fileEntry?.searchDoc?.format,
      'binary',
      'index stores stl format',
    );

    let network = getService('network') as NetworkService;
    let response = await network.virtualNetwork.fetch(fileURL, {
      headers: { Accept: SupportedMimeType.FileMeta },
    });

    assert.true(response.ok, 'file meta request succeeds');

    let body = await response.json();
    assert.strictEqual(body?.data?.type, 'file-meta');
    assert.strictEqual(
      body?.data?.attributes?.format,
      'binary',
      'file meta includes stl format',
    );
    assert.strictEqual(
      body?.data?.attributes?.triangleCount,
      3,
      'file meta includes triangle count',
    );
    assert.deepEqual(
      body?.data?.meta?.adoptsFrom,
      stlDefCodeRef(),
      'file meta resolves to StlDef',
    );
  });
});
