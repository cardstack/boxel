import { module, test } from 'qunit';

import ENV from '@cardstack/host/config/environment';

// The secure origin's page is where credentials are typed. What keeps card
// code — which runs in the app page — away from it is the browser: the
// same-origin policy stops the app page reading a window on another origin,
// and the shell's Cross-Origin-Opener-Policy cuts the handle the app page
// keeps to the window it opened, so it can't navigate the window either.

const NAVIGATION_TIMEOUT_MS = 20000;
const POLL_INTERVAL_MS = 50;

// A window opened on another origin starts out on an `about:blank` document
// that shares the opener's origin. Resolves once that is no longer so: the
// handle was cut, or reading the document throws.
async function waitForNavigation(win: Window): Promise<void> {
  let deadline = Date.now() + NAVIGATION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (win.closed) {
      return;
    }
    try {
      void win.document.body;
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

function readShellRoot(win: Window): Element | null | undefined {
  try {
    return win.document.getElementById('secure-shell');
  } catch {
    return undefined;
  }
}

module('Unit | secure origin isolation', function () {
  test('a page on the app origin can neither read nor steer the secure origin window', async function (assert) {
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

    let win = window.open(ENV.secureOriginURL, '_blank');
    assert.ok(win, 'the secure origin page opened in a window');
    try {
      await waitForNavigation(win!);
      // Only a response carrying the shell's opener policy cuts the handle; a
      // window that failed to load would stay attached.
      assert.true(
        win!.closed,
        'the shell loaded and cut the handle the app page held to it',
      );
      assert.notOk(
        readShellRoot(win!),
        "the shell's document can't be reached through the handle",
      );
    } finally {
      win?.close();
    }
  });
});
