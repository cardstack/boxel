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
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

module('Acceptance | markdown file def', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);

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

  const fileURL = (path: string) => new URL(path, testRealmURL).href;

  const markdownDefCodeRef = (): ResolvedCodeRef => ({
    module: `${baseRealm.url}markdown-file-def`,
    name: 'MarkdownDef',
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
        'readme.md': `# Project Overview

This is the first paragraph.

Another paragraph follows.`,
        'notes.txt': 'Plain text file contents.',
      },
    }));
  });

  hooks.afterEach(function () {
    delete (globalThis as any).__renderModel;
  });

  test('extracts title and excerpt from markdown', async function (assert) {
    let url = fileURL('readme.md');
    await visit(
      renderPath(url, {
        fileExtract: true,
        fileDefCodeRef: markdownDefCodeRef(),
      }),
    );

    let result = await captureFileExtractResult('ready');
    assert.strictEqual(result.status, 'ready');
    assert.strictEqual(result.searchDoc?.title, 'Project Overview');
    assert.strictEqual(
      result.searchDoc?.excerpt,
      'This is the first paragraph.',
    );
    assert.ok(
      String(result.searchDoc?.content).includes(
        'This is the first paragraph.',
      ),
      'includes full markdown content',
    );
    assert.strictEqual(result.searchDoc?.name, 'readme.md');
    assert.ok(
      String(result.searchDoc?.contentType).includes('markdown'),
      'sets markdown content type',
    );
  });

  test('falls back when markdown def is used for non-markdown files', async function (assert) {
    let url = fileURL('notes.txt');
    await visit(
      renderPath(url, {
        fileExtract: true,
        fileDefCodeRef: markdownDefCodeRef(),
      }),
    );

    let result = await captureFileExtractResult('ready');
    assert.strictEqual(result.status, 'ready');
    assert.true(
      result.mismatch,
      'marks mismatch when extension is not markdown',
    );
    assert.strictEqual(result.searchDoc?.name, 'notes.txt');
  });

  test('indexing stores markdown search data and file meta uses it', async function (assert) {
    let fileURL = new URL('readme.md', testRealmURL);
    let fileEntry = await realm.realmIndexQueryEngine.file(fileURL);

    assert.ok(fileEntry, 'file entry exists');
    assert.strictEqual(
      fileEntry?.searchDoc?.title,
      'Project Overview',
      'index stores markdown title',
    );
    assert.strictEqual(
      fileEntry?.searchDoc?.excerpt,
      'This is the first paragraph.',
      'index stores markdown excerpt',
    );

    let network = getService('network') as NetworkService;
    let response = await network.virtualNetwork.fetch(fileURL, {
      headers: { Accept: SupportedMimeType.FileMeta },
    });

    assert.true(response.ok, 'file meta request succeeds');

    let body = await response.json();
    assert.strictEqual(body?.data?.type, 'file-meta');
    assert.ok(
      String(body?.data?.attributes?.contentType).includes('markdown'),
      'file meta uses markdown content type',
    );
    assert.strictEqual(
      body?.data?.attributes?.title,
      'Project Overview',
      'file meta includes markdown title',
    );
    assert.strictEqual(
      body?.data?.attributes?.excerpt,
      'This is the first paragraph.',
      'file meta includes markdown excerpt',
    );
    assert.ok(
      String(body?.data?.attributes?.content).includes(
        'This is the first paragraph.',
      ),
      'file meta includes markdown content',
    );
    assert.deepEqual(
      body?.data?.meta?.adoptsFrom,
      markdownDefCodeRef(),
      'file meta uses markdown def',
    );
  });
});
