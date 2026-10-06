import { click, render, waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { SignedCaptureLink } from '@cardstack/host/lib/signed-capture';

import { setupRenderingTest } from '../../helpers/setup';

const CAPTURE_URL =
  'http://test-realm/test/_capture/Statement/1?name=statement';
const PDF_BYTES = new TextEncoder().encode('%PDF-stub');

module('Integration | Component | SignedCaptureLink', function (hooks) {
  setupRenderingTest(hooks);

  let signed: string[];
  let fetched: string[];
  let saved: { href: string; download: string }[];
  let respond: (url: URL) => Response;
  let originalClick: typeof HTMLAnchorElement.prototype.click;

  hooks.beforeEach(function () {
    signed = [];
    fetched = [];
    saved = [];
    respond = () =>
      new Response(PDF_BYTES, {
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': `attachment; filename="Releve Q3.pdf"; filename*=UTF-8''Relev%C3%A9%20Q3.pdf`,
        },
      });

    let signer = getService('capture-url-signer');
    signer.getSignedUrl = async (url: string) => {
      signed.push(url);
      return `${url}&token=signed`;
    };

    getService('network').virtualNetwork.mount(
      async (request: Request) => {
        let url = new URL(request.url);
        if (!url.pathname.includes('/_capture/')) {
          return null;
        }
        fetched.push(request.url);
        return respond(url);
      },
      { prepend: true },
    );

    // The download hands its bytes to the browser through a click on a
    // detached object-URL anchor; record it instead of saving a file.
    originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      if (this.href.startsWith('blob:')) {
        saved.push({ href: this.href, download: this.download });
        return;
      }
      return originalClick.call(this);
    };
  });

  hooks.afterEach(function () {
    HTMLAnchorElement.prototype.click = originalClick;
  });

  test('a download link carries the disposition params and saves under the served name', async function (assert) {
    await render(
      <template>
        <SignedCaptureLink
          @url={{CAPTURE_URL}}
          @download={{true}}
          @filename='Relevé Q3'
        >Download</SignedCaptureLink>
      </template>,
    );

    let expected = `${CAPTURE_URL}&download=1&filename=Relev%C3%A9+Q3`;
    assert
      .dom('[data-signed-capture-link]')
      .hasAttribute('href', expected, 'the href carries the params too')
      .doesNotHaveAttribute('target', 'a download stays on this page');

    await click('[data-signed-capture-link]');
    await waitUntil(() => saved.length > 0);

    assert.deepEqual(signed, [expected], 'the URL with its params is signed');
    assert.deepEqual(fetched, [`${expected}&token=signed`]);
    assert.strictEqual(saved.length, 1);
    assert.strictEqual(
      saved[0].download,
      'Relevé Q3.pdf',
      'the file is saved under the name the response declares',
    );
  });

  test('a failed download shows an error beside the link and saves nothing', async function (assert) {
    respond = () => new Response('not found', { status: 404 });
    await render(
      <template>
        <SignedCaptureLink
          @url={{CAPTURE_URL}}
          @download={{true}}
        >Download</SignedCaptureLink>
      </template>,
    );

    await click('[data-signed-capture-link]');
    await waitUntil(() => document.querySelector('[role="alert"]'));

    assert.dom('[role="alert"]').hasText('This capture is not available yet.');
    assert.strictEqual(saved.length, 0, 'nothing was saved');
  });

  test('without @download the link opens in a new tab, carrying only a requested filename', async function (assert) {
    await render(
      <template>
        <SignedCaptureLink @url={{CAPTURE_URL}} @filename='Q3'>
          Open
        </SignedCaptureLink>
      </template>,
    );
    assert
      .dom('[data-signed-capture-link]')
      .hasAttribute('href', `${CAPTURE_URL}&filename=Q3`)
      .hasAttribute('target', '_blank');

    await render(
      <template>
        <SignedCaptureLink @url={{CAPTURE_URL}}>Open</SignedCaptureLink>
      </template>,
    );
    assert
      .dom('[data-signed-capture-link]')
      .hasAttribute('href', CAPTURE_URL, 'a bare link keeps the durable URL');
  });
});
