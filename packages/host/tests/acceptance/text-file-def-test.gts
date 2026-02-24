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

module('Acceptance | text file def', function (hooks) {
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

  const textFileDefCodeRef = (): ResolvedCodeRef => ({
    module: `${baseRealm.url}text-file-def`,
    name: 'TextFileDef',
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
          'hello.txt': `Hello, world!
This is a plain text file.
It has multiple lines.

And a blank line too.`,
          'empty.text': '',
          'readme.md': '# A markdown file\n\nSome content here.',
        },
      }),
    ));
  });

  hooks.afterEach(function () {
    delete (globalThis as any).__renderModel;
  });

  test('extracts title, excerpt, and content from .txt file', async function (assert) {
    let url = makeFileURL('hello.txt');
    await visit(
      renderPath(url, {
        fileExtract: true,
        fileDefCodeRef: textFileDefCodeRef(),
      }),
    );

    let result = await captureFileExtractResult('ready');
    assert.strictEqual(result.status, 'ready');
    assert.strictEqual(result.searchDoc?.title, 'hello');
    assert.ok(
      String(result.searchDoc?.excerpt).includes('Hello, world!'),
      'excerpt includes beginning of text',
    );
    assert.ok(
      String(result.searchDoc?.content).includes('plain text file'),
      'content includes full text',
    );
    assert.strictEqual(result.searchDoc?.name, 'hello.txt');
  });

  test('falls back when TextFileDef is used for non-text extensions', async function (assert) {
    let url = makeFileURL('readme.md');
    await visit(
      renderPath(url, {
        fileExtract: true,
        fileDefCodeRef: textFileDefCodeRef(),
      }),
    );

    let result = await captureFileExtractResult('ready');
    assert.strictEqual(result.status, 'ready');
    assert.true(
      result.mismatch,
      'marks mismatch when extension is not .txt or .text',
    );
    assert.strictEqual(result.searchDoc?.name, 'readme.md');
  });

  test('indexing stores text search data and file meta uses it', async function (assert) {
    let fileURL = new URL('hello.txt', testRealmURL);
    let fileEntry = await realm.realmIndexQueryEngine.file(fileURL);

    assert.ok(fileEntry, 'file entry exists');
    assert.strictEqual(
      fileEntry?.searchDoc?.title,
      'hello',
      'index stores text title',
    );
    assert.ok(
      String(fileEntry?.searchDoc?.excerpt).includes('Hello, world!'),
      'index stores text excerpt',
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
      'text/plain',
      'file meta uses text/plain content type',
    );
    assert.strictEqual(
      body?.data?.attributes?.title,
      'hello',
      'file meta includes text title',
    );
    assert.ok(
      String(body?.data?.attributes?.excerpt).includes('Hello, world!'),
      'file meta includes text excerpt',
    );
    assert.ok(
      String(body?.data?.attributes?.content).includes('plain text file'),
      'file meta includes text content',
    );
    assert.deepEqual(
      body?.data?.meta?.adoptsFrom,
      textFileDefCodeRef(),
      'file meta uses text file def',
    );
  });
});
