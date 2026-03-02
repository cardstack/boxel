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
  setupRealmCacheTeardown,
  testRealmURL,
  setupAcceptanceTestRealm,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  withCachedRealmSetup,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

module('Acceptance | json file def', function (hooks) {
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

  const jsonFileDefCodeRef = (): ResolvedCodeRef => ({
    module: `${baseRealm.url}json-file-def`,
    name: 'JsonFileDef',
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
          'config.json': JSON.stringify(
            {
              name: 'my-app',
              version: '1.0.0',
              dependencies: {
                lodash: '^4.17.21',
              },
            },
            null,
            2,
          ),
          'readme.md': '# A markdown file\n\nSome content here.',
        },
      }),
    ));
  });

  hooks.afterEach(function () {
    delete (globalThis as any).__renderModel;
  });

  test('extracts title, excerpt, and content from .json file', async function (assert) {
    let url = makeFileURL('config.json');
    await visit(
      renderPath(url, {
        fileExtract: true,
        fileDefCodeRef: jsonFileDefCodeRef(),
      }),
    );

    let result = await captureFileExtractResult('ready');
    assert.strictEqual(result.status, 'ready');
    assert.strictEqual(result.searchDoc?.title, 'config');
    assert.ok(
      String(result.searchDoc?.excerpt).includes('my-app'),
      'excerpt includes beginning of JSON content',
    );
    assert.ok(
      String(result.searchDoc?.content).includes('lodash'),
      'content includes full JSON',
    );
    assert.strictEqual(result.searchDoc?.name, 'config.json');
  });

  test('falls back when JsonFileDef is used for non-json extensions', async function (assert) {
    let url = makeFileURL('readme.md');
    await visit(
      renderPath(url, {
        fileExtract: true,
        fileDefCodeRef: jsonFileDefCodeRef(),
      }),
    );

    let result = await captureFileExtractResult('ready');
    assert.strictEqual(result.status, 'ready');
    assert.true(result.mismatch, 'marks mismatch when extension is not .json');
    assert.strictEqual(result.searchDoc?.name, 'readme.md');
  });

  test('indexing stores json search data and file meta uses it', async function (assert) {
    let fileURL = new URL('config.json', testRealmURL);
    let fileEntry = await realm.realmIndexQueryEngine.file(fileURL);

    assert.ok(fileEntry, 'file entry exists');
    assert.strictEqual(
      fileEntry?.searchDoc?.title,
      'config',
      'index stores json title',
    );
    assert.ok(
      String(fileEntry?.searchDoc?.excerpt).includes('my-app'),
      'index stores json excerpt',
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
      'application/json',
      'file meta uses application/json content type',
    );
    assert.strictEqual(
      body?.data?.attributes?.title,
      'config',
      'file meta includes json title',
    );
    assert.ok(
      String(body?.data?.attributes?.excerpt).includes('my-app'),
      'file meta includes json excerpt',
    );
    assert.ok(
      String(body?.data?.attributes?.content).includes('lodash'),
      'file meta includes json content',
    );
    assert.deepEqual(
      body?.data?.meta?.adoptsFrom,
      jsonFileDefCodeRef(),
      'file meta uses json file def',
    );
  });
});
