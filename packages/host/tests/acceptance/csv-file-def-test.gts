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

module('Acceptance | csv file def', function (hooks) {
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

  const csvDefCodeRef = (): ResolvedCodeRef => ({
    module: `${baseRealmPrefix}csv-file-def`,
    name: 'CsvFileDef',
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
          'data.csv': `name,age,city
Alice,30,New York
Bob,25,San Francisco
Charlie,35,Chicago`,
          'readme.md': `# Not a CSV file

This is markdown content.`,
        },
      }),
    ));
  });

  hooks.afterEach(function () {
    delete (globalThis as any).__renderModel;
  });

  test('extracts title, excerpt, and content from csv file', async function (assert) {
    let url = makeFileURL('data.csv');
    await visit(
      renderPath(url, {
        fileExtract: true,
        fileDefCodeRef: csvDefCodeRef(),
      }),
    );

    let result = await captureFileExtractResult('ready');
    assert.strictEqual(result.status, 'ready');
    assert.strictEqual(result.searchDoc?.title, 'data');
    assert.ok(
      String(result.searchDoc?.excerpt).includes('name,age,city'),
      'excerpt includes csv content',
    );
    assert.ok(
      String(result.searchDoc?.content).includes('Alice,30,New York'),
      'content includes full csv data',
    );
    assert.strictEqual(result.searchDoc?.name, 'data.csv');
    assert.deepEqual(
      result.searchDoc?.columns,
      ['name', 'age', 'city'],
      'extracts column names',
    );
    assert.strictEqual(
      result.searchDoc?.columnCount,
      3,
      'extracts column count',
    );
    assert.strictEqual(
      result.searchDoc?.rowCount,
      3,
      'extracts row count (excluding header)',
    );
    assert.ok(
      String(result.searchDoc?.contentType).includes('csv'),
      'sets csv content type',
    );
  });

  test('falls back when csv def is used for non-csv files', async function (assert) {
    let url = makeFileURL('readme.md');
    await visit(
      renderPath(url, {
        fileExtract: true,
        fileDefCodeRef: csvDefCodeRef(),
      }),
    );

    let result = await captureFileExtractResult('ready');
    assert.strictEqual(result.status, 'ready');
    assert.true(result.mismatch, 'marks mismatch when extension is not csv');
    assert.strictEqual(result.searchDoc?.name, 'readme.md');
  });

  test('indexing stores csv search data and file-meta uses it', async function (assert) {
    let fileURL = new URL('data.csv', testRealmURL);
    let fileEntry = await realm.realmIndexQueryEngine.file(fileURL);

    assert.ok(fileEntry, 'file entry exists');
    assert.strictEqual(
      fileEntry?.searchDoc?.title,
      'data',
      'index stores csv title',
    );
    assert.ok(
      String(fileEntry?.searchDoc?.excerpt).includes('name,age,city'),
      'index stores csv excerpt',
    );

    let network = getService('network') as NetworkService;
    let response = await network.virtualNetwork.fetch(fileURL, {
      headers: { Accept: SupportedMimeType.FileMeta },
    });

    assert.true(response.ok, 'file meta request succeeds');

    let body = await response.json();
    assert.strictEqual(body?.data?.type, 'file-meta');
    assert.ok(
      String(body?.data?.attributes?.contentType).includes('csv'),
      'file meta uses csv content type',
    );
    assert.strictEqual(
      body?.data?.attributes?.title,
      'data',
      'file meta includes csv title',
    );
    assert.ok(
      String(body?.data?.attributes?.excerpt).includes('name,age,city'),
      'file meta includes csv excerpt',
    );
    assert.ok(
      String(body?.data?.attributes?.content).includes('Alice,30,New York'),
      'file meta includes csv content',
    );
    assert.deepEqual(
      body?.data?.meta?.adoptsFrom,
      csvDefCodeRef(),
      'file meta uses csv def',
    );
  });
});
