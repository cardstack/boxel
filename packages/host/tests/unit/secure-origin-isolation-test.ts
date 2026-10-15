import { module, test } from 'qunit';

import ENV from '@cardstack/host/config/environment';

// The secure origin's page is where credentials are typed. What keeps card
// code — which runs in the app page — away from it is the browser's
// same-origin policy, so the secure origin must be an origin of its own, and
// the app page must not be able to reach into a document loaded from it.
//
// The page is loaded in a frame here rather than the window the app opens:
// once the shell's Cross-Origin-Opener-Policy cuts a window's handle, nothing
// can close that window, and it would keep focus for every test after this
// one. The shell refuses to be framed, so the frame may show the browser's
// own error page instead; either way the app page can't read it. The headers
// that refuse framing and cut the opener's handle are asserted on the wire by
// the realm-server's secure-origin tests.

const LOAD_TIMEOUT_MS = 20000;

async function loadFrame(src: string): Promise<HTMLIFrameElement> {
  let frame = document.createElement('iframe');
  let loaded = new Promise<void>((resolve, reject) => {
    let timer = setTimeout(
      () => reject(new Error(`frame did not load ${src}`)),
      LOAD_TIMEOUT_MS,
    );
    frame.addEventListener('load', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  frame.src = src;
  document.body.appendChild(frame);
  await loaded;
  return frame;
}

module('Unit | secure origin isolation', function () {
  test('a page on the app origin cannot read a document from the secure origin', async function (assert) {
    let secureOrigin = new URL(ENV.secureOriginURL).origin;
    assert.notStrictEqual(
      secureOrigin,
      window.location.origin,
      'the secure origin is not the app origin',
    );
    assert.notStrictEqual(
      secureOrigin,
      new URL(ENV.resolvedBaseRealmURL).origin,
      'the secure origin is not the realm server origin',
    );

    let frame = await loadFrame(ENV.secureOriginURL);
    try {
      assert.strictEqual(
        frame.contentDocument,
        null,
        "the frame's document is not exposed to this page",
      );
      let error: unknown;
      try {
        void frame.contentWindow!.document;
      } catch (e) {
        error = e;
      }
      assert.ok(
        error instanceof DOMException,
        `reading the frame's document throws a DOMException (got ${String(error)})`,
      );
      assert.strictEqual(
        (error as DOMException | undefined)?.name,
        'SecurityError',
        'the browser refuses cross-origin access',
      );
    } finally {
      frame.remove();
    }
  });
});
