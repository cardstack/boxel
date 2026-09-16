// A capture URL (`{realm}_screenshot/…?type=pdf`) cannot be saved through a
// plain download link: `download` is ignored cross-origin and a navigation
// carries no realm token. The component fetches the bytes (the auth service
// worker supplies the header) and saves them through a same-origin blob URL,
// so the tests pin the filename the save uses and how a refusal is reported.

// @ts-ignore no public types for `precompileTemplate`
import { precompileTemplate } from '@ember/template-compilation';
import { click, render, waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type { Loader } from '@cardstack/runtime-common';

import { setupBaseRealm } from '../../helpers/base-realm';
import { setupRenderingTest } from '../../helpers/setup';

import type * as CaptureDownloadModule from '@cardstack/base/components/capture-download-button';

const PDF_URL = 'https://my.realm/_screenshot/Invoice/2026-0042?type=pdf';

module('Integration | capture download button', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  let loader: Loader;
  let CaptureDownloadButton: typeof CaptureDownloadModule.CaptureDownloadButton;
  let downloadCapture: typeof CaptureDownloadModule.downloadCapture;
  let captureFilenameFor: typeof CaptureDownloadModule.captureFilenameFor;
  let originalFetch: typeof globalThis.fetch;
  let originalCreateObjectURL: typeof URL.createObjectURL;
  let requests: string[];
  let downloads: { href: string; download: string }[];
  let respondWith: () => Response;

  // The save clicks a temporary anchor on `document.body`; intercept the
  // click at the document so the test browser never starts a real download.
  function captureAnchorClick(event: Event) {
    let target = event.target;
    if (target instanceof HTMLAnchorElement && target.download) {
      event.preventDefault();
      downloads.push({ href: target.href, download: target.download });
    }
  }

  hooks.beforeEach(async function () {
    loader = getService('loader-service').loader;
    ({ CaptureDownloadButton, downloadCapture, captureFilenameFor } =
      await loader.import<typeof CaptureDownloadModule>(
        '@cardstack/base/components/capture-download-button',
      ));
    requests = [];
    downloads = [];
    respondWith = () =>
      new Response(new Blob(['%PDF-1.7'], { type: 'application/pdf' }), {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      });
    originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      requests.push(typeof input === 'string' ? input : input.toString());
      return respondWith();
    };
    originalCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = () => 'blob:https://app.test/fake-object-url';
    document.addEventListener('click', captureAnchorClick, true);
  });

  hooks.afterEach(function () {
    globalThis.fetch = originalFetch;
    URL.createObjectURL = originalCreateObjectURL;
    document.removeEventListener('click', captureAnchorClick, true);
  });

  module('captureFilenameFor', function () {
    test('names a pdf after the capture path with the pdf extension', function (assert) {
      assert.strictEqual(
        captureFilenameFor(PDF_URL, 'application/pdf'),
        '2026-0042.pdf',
      );
    });

    test('a Content-Disposition filename wins over the URL', function (assert) {
      assert.strictEqual(
        captureFilenameFor(
          PDF_URL,
          'application/pdf',
          'inline; filename="Invoice-42.pdf"',
        ),
        'Invoice-42.pdf',
      );
    });

    test('a named slot and an image type produce a distinct image name', function (assert) {
      assert.strictEqual(
        captureFilenameFor(
          'https://my.realm/_screenshot/Person/jane?name=poster',
          'image/png; charset=binary',
        ),
        'jane-poster.png',
      );
    });

    test('unsafe characters and an unknown type degrade to a bare safe name', function (assert) {
      assert.strictEqual(
        captureFilenameFor(
          'https://my.realm/_screenshot/Docs/a%20b%2Fc?type=pdf',
          null,
        ),
        'a-b-c',
      );
      assert.strictEqual(
        captureFilenameFor('not a url', 'application/pdf'),
        'capture.pdf',
      );
    });
  });

  module('downloadCapture', function () {
    test('fetches the capture and hands the blob to the saver under the derived name', async function (assert) {
      let saved: { type: string; filename: string }[] = [];
      let filename = await downloadCapture(PDF_URL, {
        save: (blob, name) => saved.push({ type: blob.type, filename: name }),
      });
      assert.deepEqual(requests, [PDF_URL]);
      assert.strictEqual(filename, '2026-0042.pdf');
      assert.deepEqual(saved, [
        { type: 'application/pdf', filename: '2026-0042.pdf' },
      ]);
    });

    test('an explicit filename overrides the derived one', async function (assert) {
      let saved: string[] = [];
      await downloadCapture(PDF_URL, {
        filename: 'statement.pdf',
        save: (_blob, name) => saved.push(name),
      });
      assert.deepEqual(saved, ['statement.pdf']);
    });

    test('a refusal throws with the status and a message the cap error doc carries', async function (assert) {
      respondWith = () =>
        new Response(
          JSON.stringify({
            errors: [{ status: 500, title: 'PDF capture too large' }],
          }),
          { status: 500, headers: { 'content-type': 'application/json' } },
        );
      try {
        await downloadCapture(PDF_URL, { save: () => assert.ok(false) });
        assert.ok(false, 'expected a throw');
      } catch (e: any) {
        assert.strictEqual(e.status, 500);
        assert.strictEqual(e.message, 'PDF capture too large');
      }
    });
  });

  module('CaptureDownloadButton', function () {
    test('is disabled until a URL is available', async function (assert) {
      await render(
        precompileTemplate(`<CaptureDownloadButton @url={{undefined}} />`, {
          strictMode: true,
          scope: () => ({ CaptureDownloadButton }),
        }),
      );
      assert.dom('[data-test-capture-download]').isDisabled();
      assert.dom('[data-test-capture-download]').hasText('Save');
    });

    test('a click fetches the capture and saves it through a blob download link', async function (assert) {
      let url = PDF_URL;
      await render(
        precompileTemplate(
          `<CaptureDownloadButton @url={{url}}>Save PDF</CaptureDownloadButton>`,
          { strictMode: true, scope: () => ({ CaptureDownloadButton, url }) },
        ),
      );
      assert
        .dom('[data-test-capture-download]')
        .isEnabled()
        .hasText('Save PDF');
      await click('[data-test-capture-download]');
      await waitUntil(() => downloads.length > 0);
      assert.deepEqual(requests, [PDF_URL]);
      assert.deepEqual(downloads, [
        {
          href: 'blob:https://app.test/fake-object-url',
          download: '2026-0042.pdf',
        },
      ]);
      assert.dom('[data-test-capture-download-error]').doesNotExist();
      assert.dom('[data-test-capture-download]').isEnabled();
    });

    test('a refused capture is reported inline and the button recovers', async function (assert) {
      respondWith = () => new Response('', { status: 401 });
      let url = PDF_URL;
      await render(
        precompileTemplate(`<CaptureDownloadButton @url={{url}} />`, {
          strictMode: true,
          scope: () => ({ CaptureDownloadButton, url }),
        }),
      );
      await click('[data-test-capture-download]');
      await waitUntil(() =>
        document.querySelector('[data-test-capture-download-error]'),
      );
      assert.deepEqual(downloads, [], 'nothing was saved');
      assert
        .dom('[data-test-capture-download-error]')
        .hasAttribute('role', 'alert')
        .hasText('You do not have access to this document.');
      assert.dom('[data-test-capture-download]').isEnabled();
    });
  });
});
