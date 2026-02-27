import { visit, waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import {
  baseRealmPrefix,
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

module('Acceptance | ts file def', function (hooks) {
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

  const tsDefCodeRef = (): ResolvedCodeRef => ({
    module: `${baseRealmPrefix}ts-file-def`,
    name: 'TsFileDef',
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
          'utils.ts': `export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}

export const MAX_RETRIES = 3;`,
          'notes.txt': 'Plain text file contents.',
        },
      }),
    ));
  });

  hooks.afterEach(function () {
    delete (globalThis as any).__renderModel;
  });

  test('extracts title, excerpt, and content from .ts file', async function (assert) {
    let url = makeFileURL('utils.ts');
    await visit(
      renderPath(url, {
        fileExtract: true,
        fileDefCodeRef: tsDefCodeRef(),
      }),
    );

    let result = await captureFileExtractResult('ready');
    assert.strictEqual(result.status, 'ready');
    assert.strictEqual(
      result.searchDoc?.title,
      'utils',
      'title is filename without extension',
    );
    assert.ok(
      String(result.searchDoc?.excerpt).includes('export'),
      'excerpt contains source code',
    );
    assert.ok(
      String(result.searchDoc?.content).includes('greet'),
      'content includes full source',
    );
    assert.strictEqual(result.searchDoc?.name, 'utils.ts');
  });

  test('falls back when ts def is used for non-.ts files', async function (assert) {
    let url = makeFileURL('notes.txt');
    await visit(
      renderPath(url, {
        fileExtract: true,
        fileDefCodeRef: tsDefCodeRef(),
      }),
    );

    let result = await captureFileExtractResult('ready');
    assert.strictEqual(result.status, 'ready');
    assert.true(result.mismatch, 'marks mismatch when extension is not .ts');
    assert.strictEqual(result.searchDoc?.name, 'notes.txt');
  });

  test('indexing stores TS search data and file meta uses TsFileDef', async function (assert) {
    let fileURL = new URL('utils.ts', testRealmURL);
    let fileEntry = await realm.realmIndexQueryEngine.file(fileURL);

    assert.ok(fileEntry, 'file entry exists');
    assert.strictEqual(
      fileEntry?.searchDoc?.title,
      'utils',
      'index stores TS title',
    );
    assert.ok(
      String(fileEntry?.searchDoc?.excerpt).includes('export'),
      'index stores TS excerpt',
    );

    let network = getService('network') as NetworkService;
    let response = await network.virtualNetwork.fetch(fileURL, {
      headers: { Accept: SupportedMimeType.FileMeta },
    });

    assert.true(response.ok, 'file meta request succeeds');

    let body = await response.json();
    assert.strictEqual(body?.data?.type, 'file-meta');
    assert.strictEqual(
      body?.data?.attributes?.title,
      'utils',
      'file meta includes TS title',
    );
    assert.ok(
      String(body?.data?.attributes?.content).includes('greet'),
      'file meta includes TS content',
    );
    assert.deepEqual(
      body?.data?.meta?.adoptsFrom,
      tsDefCodeRef(),
      'file meta uses TsFileDef',
    );
  });
});
