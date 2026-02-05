import type Transition from '@ember/routing/transition';
import { visit, waitUntil } from '@ember/test-helpers';

import { module, test } from 'qunit';

import {
  baseRealm,
  type FileExtractResponse,
  type RenderRouteOptions,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';

import type RenderFileExtractRoute from '@cardstack/host/routes/render/file-extract';
import type RenderStoreService from '@cardstack/host/services/render-store';

import {
  setupLocalIndexing,
  setupOnSave,
  testRealmURL,
  setupAcceptanceTestRealm,
  SYSTEM_CARD_FIXTURE_CONTENTS,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

module('Acceptance | prerender | file-extract', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
  });

  const renderPath = (
    url: string,
    renderOptions: RenderRouteOptions,
    nonce = 0,
  ) =>
    `/render/${encodeURIComponent(url)}/${nonce}/${encodeURIComponent(
      JSON.stringify(renderOptions),
    )}/file-extract`;

  const fileDefCodeRef = (
    moduleName: string,
    name: string,
  ): ResolvedCodeRef => ({
    module: new URL(moduleName, testRealmURL).href,
    name,
  });

  const fileURL = (path: string) => new URL(path, testRealmURL).href;

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
    await setupAcceptanceTestRealm({
      mockMatrixUtils,
      contents: {
        ...SYSTEM_CARD_FIXTURE_CONTENTS,
        'filedef-success.gts': `
          import { FileDef as BaseFileDef } from "${baseRealm.url}file-api";

          export class SuccessDef extends BaseFileDef {
            static async extractAttributes(url) {
              return {
                url,
                name: "custom-success",
                contentType: "text/plain",
                custom: true,
              };
            }
          }
        `,
        'filedef-mismatch.gts': `
          import {
            FileDef as BaseFileDef,
            FileContentMismatchError,
          } from "${baseRealm.url}file-api";

          export class MismatchDef extends BaseFileDef {
            static async extractAttributes() {
              throw new FileContentMismatchError("content mismatch");
            }
          }
        `,
        'filedef-throws.gts': `
          import { FileDef as BaseFileDef } from "${baseRealm.url}file-api";

          export class ThrowingDef extends BaseFileDef {
            static async extractAttributes() {
              throw new Error("boom");
            }
          }
        `,
        'filedef-missing.gts': `
          export const NotFileDef = {};
        `,
        'sample.txt': 'hello world',
        'mismatch.txt': 'mismatch content',
      },
    });
  });

  hooks.afterEach(function () {
    delete (globalThis as any).__renderModel;
  });

  test('returns an error when the render model is missing', async function (assert) {
    let route = this.owner.lookup(
      'route:render/file-extract',
    ) as RenderFileExtractRoute;
    (route as any).modelFor = () => undefined;
    delete (globalThis as any).__renderModel;

    let result = await route.model({}, {} as Transition);
    assert.strictEqual(result.status, 'error');
    assert.ok(result.error, 'includes a render error');
  });

  test('returns an error when fileExtract is not enabled', async function (assert) {
    let route = this.owner.lookup(
      'route:render/file-extract',
    ) as RenderFileExtractRoute;
    let aborted = false;
    let transition = { abort: () => (aborted = true) } as unknown as Transition;
    (route as any).modelFor = () => undefined;
    (globalThis as any).__renderModel = {
      cardId: fileURL('sample.txt'),
      nonce: '0',
      renderOptions: { clearCache: true },
    };

    let result = await route.model({}, transition);
    assert.ok(aborted, 'aborts the transition');
    assert.strictEqual(result.status, 'error');
    assert.ok(result.error, 'includes a render error');
  });

  test('uses the provided FileDef to extract attributes', async function (assert) {
    let url = fileURL('sample.txt');
    await visit(
      renderPath(url, {
        fileExtract: true,
        fileDefCodeRef: fileDefCodeRef('filedef-success', 'SuccessDef'),
      }),
    );
    let result = await captureFileExtractResult('ready');
    assert.strictEqual(result.status, 'ready');
    assert.true(result.searchDoc?.custom, 'uses custom extractor');
    assert.ok(
      result.deps.includes(
        fileDefCodeRef('filedef-success', 'SuccessDef').module,
      ),
      'deps include custom file def module',
    );
  });

  test('falls back when the FileDef module is missing extractAttributes', async function (assert) {
    let url = fileURL('sample.txt');
    await visit(
      renderPath(url, {
        fileExtract: true,
        fileDefCodeRef: fileDefCodeRef('filedef-missing', 'MissingDef'),
      }),
    );
    let result = await captureFileExtractResult('ready');
    assert.strictEqual(result.status, 'ready');
    assert.strictEqual(result.searchDoc?.name, 'sample.txt');
    assert.ok(result.error, 'includes the original extraction error');
  });

  test('falls back and marks mismatch when the extractor signals a content mismatch', async function (assert) {
    let url = fileURL('mismatch.txt');
    await visit(
      renderPath(url, {
        fileExtract: true,
        fileDefCodeRef: fileDefCodeRef('filedef-mismatch', 'MismatchDef'),
      }),
    );
    let result = await captureFileExtractResult('ready');
    assert.strictEqual(result.status, 'ready');
    assert.true(result.mismatch, 'sets mismatch flag');
    assert.ok(result.error, 'includes the original extraction error');
  });

  test('returns an error when the file fetch fails', async function (assert) {
    let url = fileURL('missing.txt');
    await visit(renderPath(url, { fileExtract: true }));
    let result = await captureFileExtractResult('error');
    assert.strictEqual(result.status, 'error');
    assert.ok(result.error, 'includes a render error');
  });

  test('blocks saves while file-extract is active', async function (assert) {
    let renderStore = this.owner.lookup(
      'service:render-store',
    ) as RenderStoreService;
    let savedUrls: string[] = [];
    renderStore._onSave((url) => savedUrls.push(url.href));

    await visit(renderPath(fileURL('sample.txt'), { fileExtract: true }));

    let patchResult = await renderStore.patch(
      fileURL('ModelConfiguration/test-gpt'),
      {
        attributes: { modelId: 'openai/gpt-5' },
      },
    );

    assert.strictEqual(
      patchResult,
      undefined,
      'patch is ignored during file-extract render context',
    );
    assert.deepEqual(savedUrls, [], 'does not emit save events');

    renderStore._unregisterSaveSubscriber();
  });
});
