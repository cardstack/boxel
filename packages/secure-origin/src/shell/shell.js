/* eslint-env browser */
// The only script the secure origin's shell serves. It loads no card, realm or
// host app code. A page takes only plain values from its own URL, such as a
// username to fill in, and never hands anything to the page that opened it.
//
// Each page is at its own path beneath the shell's address (`pages.js`), and
// the shell's router (`app.gts`) renders it. An address naming a page by the
// `mode` query parameter, as earlier CLI releases and emails already sent do,
// is first rewritten to that page's path, keeping the rest of its query and
// its fragment. A `mode` that names no page leaves the page empty.
import '../styles/layers.css';

import { startShell } from './app.gts';
import { LEGACY_MODES } from './pages.js';
import { startTelemetry } from './telemetry.ts';
import { pageURL } from './urls.js';

// Moves an address's `mode` into its path: true when there is a page to
// start, false when the `mode` names none. The key page's add-a-key
// address, `enter-key` with `then=keys`, is `keys/add`.
function fromLegacyMode() {
  let url = new URL(window.location.href);
  let mode = url.searchParams.get('mode');
  if (mode === null) {
    return true;
  }
  if (!LEGACY_MODES.includes(mode)) {
    return false;
  }
  url.searchParams.delete('mode');
  let page = mode;
  if (mode === 'enter-key' && url.searchParams.get('then') === 'keys') {
    page = 'keys/add';
    url.searchParams.delete('then');
  }
  window.history.replaceState(
    null,
    '',
    `${pageURL(page, Object.fromEntries(url.searchParams))}${url.hash}`,
  );
  return true;
}

let root = document.getElementById('secure-shell');
if (root && fromLegacyMode()) {
  startTelemetry();
  startShell(root);
}
