// A capture URL (`{realm}_screenshot/…?type=pdf`) cannot be saved through a
// plain download link: `download` is ignored cross-origin and a navigation
// carries no realm token. The helper fetches the bytes (the auth service
// worker supplies the header) and saves them through a same-origin blob URL,
// and the modifier wires that onto an existing link; the tests pin the
// filename the save uses, how a refusal is reported, and which clicks the
// modifier leaves to the browser.

// @ts-ignore no public types for `precompileTemplate`
import { precompileTemplate } from '@ember/template-compilation';
import { click, render, waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type { Loader } from '@cardstack/runtime-common';

import { setupBaseRealm } from '../helpers/base-realm';
import { setupRenderingTest } from '../helpers/setup';

import type * as DownloadCaptureModule from '@cardstack/base/helpers/download-capture';
import type * as DownloadCaptureModifierModule from '@cardstack/base/modifiers/download-capture';

const PDF_URL = 'https://my.realm/_screenshot/Invoice/2026-0042?type=pdf';

module('Integration | download capture', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  let loader: Loader;
  let downloadCapture: typeof DownloadCaptureModule.downloadCapture;
  let openCapture: typeof DownloadCaptureModule.openCapture;
  let originalOpen: typeof window.open;
  let openedTabs: { href: string; closed: boolean }[];
  let captureFilenameFor: typeof DownloadCaptureModule.captureFilenameFor;
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
    ({ downloadCapture, openCapture, captureFilenameFor } = await loader.import<
      typeof DownloadCaptureModule
    >('@cardstack/base/helpers/download-capture'));
    openedTabs = [];
    originalOpen = window.open;
    window.open = () => {
      let tab = { href: '', closed: false };
      openedTabs.push(tab);
      return {
        location: {
          set href(value: string) {
            tab.href = value;
          },
        },
        close: () => {
          tab.closed = true;
        },
      } as unknown as Window;
    };
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
    window.open = originalOpen;
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

  module('openCapture', function () {
    test('opens the tab before fetching and points it at the blob', async function (assert) {
      let order: string[] = [];
      let filename = await openCapture(PDF_URL, {
        fetch: async (input) => {
          order.push('fetch');
          requests.push(input.toString());
          return respondWith();
        },
        open: () => {
          order.push('open');
          return window.open('', '_blank');
        },
      });
      assert.deepEqual(order, ['open', 'fetch']);
      assert.strictEqual(filename, '2026-0042.pdf');
      assert.deepEqual(openedTabs, [
        { href: 'blob:https://app.test/fake-object-url', closed: false },
      ]);
    });

    test('a refusal closes the tab it opened', async function (assert) {
      respondWith = () =>
        new Response('Missing Authorization header', { status: 401 });
      try {
        await openCapture(PDF_URL);
        assert.ok(false, 'expected a throw');
      } catch (e: any) {
        assert.strictEqual(e.message, 'Missing Authorization header');
      }
      assert.deepEqual(openedTabs, [{ href: '', closed: true }]);
    });

    test('a blocked pop-up is reported without fetching', async function (assert) {
      window.open = () => null;
      try {
        await openCapture(PDF_URL);
        assert.ok(false, 'expected a throw');
      } catch (e: any) {
        assert.true(e.message.startsWith('The browser blocked the new tab'));
      }
      assert.deepEqual(requests, []);
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

    test('a target=_blank link opens the capture in a tab instead of saving', async function (assert) {
      let url = PDF_URL;
      let downloadCapture = downloadCaptureModifier;
      await render(
        precompileTemplate(
          `<a href={{url}} target="_blank" {{downloadCapture}} data-test-pdf-link>Open PDF</a>`,
          { strictMode: true, scope: () => ({ url, downloadCapture }) },
        ),
      );
      await click('[data-test-pdf-link]');
      await waitUntil(() => openedTabs[0]?.href);
      assert.deepEqual(linkClicks, [{ prevented: true }]);
      assert.deepEqual(requests, [PDF_URL]);
      assert.deepEqual(openedTabs, [
        { href: 'blob:https://app.test/fake-object-url', closed: false },
      ]);
      assert.deepEqual(downloads, [], 'nothing was saved to disk');
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
