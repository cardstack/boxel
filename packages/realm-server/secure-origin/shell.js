/* eslint-env browser */
// The only script the secure origin's shell serves. It loads no card, realm or
// host app code. A mode takes only plain values from its own URL, such as a
// username to fill in, and never hands anything to the page that opened it.
//
// Each mode the page can present is one entry in `modes`, keyed by the `mode`
// query parameter and given the page's root element to render into. A request
// naming no known mode leaves the page empty. The address Google returns to
// after a sign-in is a mode of its own.
import { cliSignInMode, googleCallbackMode, signInMode } from './sign-in.js';

import { oauthMode, oauthGrantsMode } from './oauth.js';

const modes = {
  'sign-in': signInMode,
  'connected-apps': oauthGrantsMode,
  'cli-sign-in': cliSignInMode,
};

let root = document.getElementById('secure-shell');
let url = new URL(window.location.href);
let mode = url.searchParams.get('mode');
if (root && /^\/oauth\/interaction\/[A-Za-z0-9_-]{1,128}$/.test(url.pathname)) {
  oauthMode(root);
} else if (root && url.pathname.endsWith('/google-callback')) {
  googleCallbackMode(root);
} else if (root && mode && Object.hasOwn(modes, mode)) {
  modes[mode](root);
}
