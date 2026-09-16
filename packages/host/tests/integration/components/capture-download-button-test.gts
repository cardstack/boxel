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
import type * as DownloadCaptureModifierModule from '@cardstack/base/modifiers/download-capture';

const PDF_URL = 'https://my.realm/_screenshot/Invoice/2026-0042?type=pdf';

module('Integration | capture download button', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  let loader: Loader;
  let CaptureDownloadButton: typeof CaptureDownloadModule.CaptureDownloadButton;
  let downloadCapture: typeof CaptureDownloadModule.downloadCapture;
  let captureFilenameFor: typeof CaptureDownloadModule.captureFilenameFor;
  let downloadCaptureModifier: typeof DownloadCaptureModifierModule.default;
  let linkClicks: { prevented: boolean }[];
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

  // A modified link's click bubbles here after the modifier has decided
  // whether to intercept it; record that, then stop the navigation the test
  // browser would otherwise perform.
  function recordLinkClick(event: Event) {
    let target = event.target;
    if (target instanceof HTMLAnchorElement && !target.download) {
      linkClicks.push({ prevented: event.defaultPrevented });
      event.preventDefault();
    }
  }

  hooks.beforeEach(async function () {
    loader = getService('loader-service').loader;
    ({ CaptureDownloadButton, downloadCapture, captureFilenameFor } =
      await loader.import<typeof CaptureDownloadModule>(
        '@cardstack/base/components/capture-download-button',
      ));
    downloadCaptureModifier = (
      await loader.import<typeof DownloadCaptureModifierModule>(
        '@cardstack/base/modifiers/download-capture',
      )
    ).default;
    requests = [];
    downloads = [];
    linkClicks = [];
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
    document.addEventListener('click', recordLinkClick);
  });

  hooks.afterEach(function () {
    globalThis.fetch = originalFetch;
    URL.createObjectURL = originalCreateObjectURL;
    document.removeEventListener('click', captureAnchorClick, true);
    document.removeEventListener('click', recordLinkClick);
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
      respondWith = () =>
        new Response('Missing Authorization header', { status: 401 });
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
        .hasText('Missing Authorization header');
      assert.dom('[data-test-capture-download]').isEnabled();
    });
  });

  module('downloadCapture modifier', function () {
    test('a plain click on the link fetches and saves instead of navigating', async function (assert) {
      let url = PDF_URL;
      let downloadCapture = downloadCaptureModifier;
      await render(
        precompileTemplate(
          `<a href={{url}} {{downloadCapture}} data-test-pdf-link>Download PDF</a>`,
          { strictMode: true, scope: () => ({ url, downloadCapture }) },
        ),
      );
      await click('[data-test-pdf-link]');
      await waitUntil(() => downloads.length > 0);
      assert.deepEqual(linkClicks, [{ prevented: true }]);
      assert.deepEqual(requests, [PDF_URL]);
      assert.deepEqual(downloads, [
        {
          href: 'blob:https://app.test/fake-object-url',
          download: '2026-0042.pdf',
        },
      ]);
      assert
        .dom('[data-test-pdf-link]')
        .doesNotHaveAttribute('aria-busy')
        .doesNotHaveAttribute('data-download-state');
    });

    test('a modified click is left to the browser', async function (assert) {
      let url = PDF_URL;
      let downloadCapture = downloadCaptureModifier;
      await render(
        precompileTemplate(
          `<a href={{url}} {{downloadCapture}} data-test-pdf-link>Download PDF</a>`,
          { strictMode: true, scope: () => ({ url, downloadCapture }) },
        ),
      );
      await click('[data-test-pdf-link]', { metaKey: true });
      assert.deepEqual(linkClicks, [{ prevented: false }]);
      assert.deepEqual(requests, [], 'nothing was fetched');
    });

    test('a refusal is recorded on the link and reported to onError', async function (assert) {
      respondWith = () =>
        new Response('Missing Authorization header', { status: 401 });
      let url = PDF_URL;
      let downloadCapture = downloadCaptureModifier;
      let reported: string[] = [];
      let onError = (message: string) => reported.push(message);
      await render(
        precompileTemplate(
          `<a href={{url}} {{downloadCapture onError=onError}} data-test-pdf-link>Download PDF</a>`,
          {
            strictMode: true,
            scope: () => ({ url, downloadCapture, onError }),
          },
        ),
      );
      await click('[data-test-pdf-link]');
      await waitUntil(() => reported.length > 0);
      assert.deepEqual(reported, ['Missing Authorization header']);
      assert.deepEqual(downloads, [], 'nothing was saved');
      assert
        .dom('[data-test-pdf-link]')
        .hasAttribute('data-download-state', 'error')
        .hasAttribute('data-download-error', 'Missing Authorization header');
    });
  });
});
