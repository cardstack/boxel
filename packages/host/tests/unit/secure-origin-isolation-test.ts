import { module, test } from 'qunit';

import ENV from '@cardstack/host/config/environment';

// The secure origin's page is where credentials are typed. What keeps card
// code — which runs in the app page — from reading it is the browser's
// same-origin policy, so the app page must not be able to reach into a window
// showing it.

const NAVIGATION_TIMEOUT_MS = 20000;
const POLL_INTERVAL_MS = 50;

// A window opened on another origin starts out on an `about:blank` document
// that shares the opener's origin, and becomes unreadable only once the
// navigation commits. Resolves with the error reading its document throws.
async function errorReadingDocument(win: Window): Promise<unknown> {
  let deadline = Date.now() + NAVIGATION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      void win.document.body;
    } catch (e) {
      return e;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return undefined;
}

module('Unit | secure origin isolation', function () {
  test('a page on the app origin cannot read the secure origin page', async function (assert) {
    let secureOrigin = new URL(ENV.secureOriginURL).origin;
    assert.notStrictEqual(
      secureOrigin,
      window.location.origin,
      'the secure origin is not the app origin',
    );

    // A window that fails to load lands on the browser's own error page,
    // which is unreadable too. The page can't check the shell loaded — its
    // Cross-Origin-Resource-Policy refuses this page even a no-cors fetch — so
    // the host test stack waits on the shell before any test runs.
    let win = window.open(ENV.secureOriginURL, '_blank');
    assert.ok(win, 'the secure origin page opened in a window');
    try {
      let error = await errorReadingDocument(win!);
      assert.ok(
        error instanceof DOMException,
        `reading the window's document throws a DOMException (got ${String(error)})`,
      );
      assert.strictEqual(
        (error as DOMException | undefined)?.name,
        'SecurityError',
        'the browser refuses cross-origin access',
      );
    } finally {
      win?.close();
    }
  });
});
