/* eslint-env browser */
// The only script the secure origin serves. It loads no card, realm or host
// app code, and nothing the page shows may come from the page that opened it.
//
// Each mode the page can present is one entry in `modes`, keyed by the `mode`
// query parameter and given the page's root element to render into. A request
// naming no known mode leaves the page empty.
const modes = {};

let root = document.getElementById('secure-shell');
let mode = new URL(window.location.href).searchParams.get('mode');
if (root && mode && Object.hasOwn(modes, mode)) {
  modes[mode](root);
}
