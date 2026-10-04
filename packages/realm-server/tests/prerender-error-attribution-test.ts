import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  captureFileExtract,
  captureModule,
  withTimeout,
  isRenderError,
} from '../prerender/utils.ts';
import type { RenderError } from '@cardstack/runtime-common';
import type { Page } from 'puppeteer';

// A pooled tab keeps showing the previous job's address until the next job's
// route transition completes. Every error a render produces must still name
// the job it was produced for — the index row it is written to — and never the
// render the tab happens to be showing.
const previousRender = 'https://test.example/realm/previous-render.html';
const requested = 'https://test.example/realm/requested-file.md';

function tabStillShowing(
  address: string,
  overrides: Partial<Record<keyof Page, unknown>> = {},
): Page {
  return {
    url: () => address,
    // Every page read on the timeout path is gated on `!page.isClosed()`.
    isClosed: () => true,
    ...overrides,
  } as unknown as Page;
}

module(basename(import.meta.filename), function () {
  test('a timeout names the requested render, not the one the tab still shows', async function (assert) {
    let page = tabStillShowing(
      `https://app.test.example/render/${encodeURIComponent(previousRender)}/1/%7B%7D/html/isolated/0`,
    );
    let result = await withTimeout(
      page,
      requested,
      () => new Promise<never>(() => {}),
      20,
    );
    assert.true(isRenderError(result), 'the stalled render times out');
    let error = (result as RenderError).error;
    assert.strictEqual(error.title, 'Render timeout');
    assert.strictEqual(error.id, requested);
  });

  test('a timeout on a tab at a non-render address names the requested render', async function (assert) {
    let page = tabStillShowing(
      `https://app.test.example/module/${encodeURIComponent(previousRender)}/1/%7B%7D`,
    );
    let result = await withTimeout(
      page,
      requested,
      () => new Promise<never>(() => {}),
      20,
    );
    assert.strictEqual((result as RenderError).error.id, requested);
  });

  test("a file extract that captures the previous render's output names the requested file", async function (assert) {
    let page = tabStillShowing(
      `https://app.test.example/render/${encodeURIComponent(previousRender)}/7/%7B%7D/file-extract`,
      {
        waitForFunction: async () => undefined,
        evaluate: async () => ({
          status: 'ready',
          value: '{}',
          id: previousRender,
          nonce: '7',
        }),
      },
    );
    let result = await captureFileExtract(page, {
      expectedId: requested,
      expectedNonce: '8',
    });
    assert.true(isRenderError(result), 'stale output is refused');
    let error = (result as RenderError).error;
    assert.strictEqual(error.title, 'Stale file extract response');
    assert.strictEqual(error.id, requested);
  });

  test('a file extract that never produces output names the requested file', async function (assert) {
    let page = tabStillShowing(
      `https://app.test.example/render/${encodeURIComponent(previousRender)}/7/%7B%7D/file-extract`,
      {
        waitForFunction: async () => {
          throw new Error('Waiting failed: timeout exceeded');
        },
      },
    );
    let result = await captureFileExtract(page, {
      expectedId: requested,
      expectedNonce: '8',
    });
    let error = (result as RenderError).error;
    assert.strictEqual(error.title, 'File extract capture timeout');
    assert.strictEqual(error.id, requested);
  });

  test('a module capture that never produces output names the requested module', async function (assert) {
    let page = tabStillShowing(
      `https://app.test.example/module/${encodeURIComponent(previousRender)}/7/%7B%7D`,
      {
        waitForFunction: async () => {
          throw new Error('Waiting failed: timeout exceeded');
        },
      },
    );
    let result = await captureModule(page, {
      expectedId: requested,
      expectedNonce: '8',
    });
    assert.true(isRenderError(result), 'the capture fails');
    assert.strictEqual((result as RenderError).error.id, requested);
  });
});
