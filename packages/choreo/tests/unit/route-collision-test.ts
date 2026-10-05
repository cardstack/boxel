/**
 * THE STATIC HOST GETS FIRST REFUSAL ON EVERY URL.
 *
 * The site is served by GitHub Pages, which resolves an extension-less
 * URL to a matching `.html` file, and a bare directory to a redirect —
 * both BEFORE the SPA fallback runs. So a route whose path matches
 * something in `public/` works when you click into it from the gallery
 * and breaks when you load it, which is the worst way for a page to be
 * broken: it looks fine to whoever built it. The film routes shipped
 * that way for one commit and served a 2 MB three.js harness at
 * `/towers` to anyone who opened the link.
 *
 * Both lists below are kept by hand. There is no filesystem in a browser
 * test and Ember does not hand back its route map in a form worth
 * walking, so this cannot introspect either side — it is a checklist
 * with a failure message attached. That is still worth having: adding a
 * route or a top-level public file is rare, and the cost of getting it
 * wrong is a dead URL nobody notices.
 */
import { module, test } from 'qunit';

/** every path declared in app/router.ts */
const ROUTE_PATHS = [
  '_feature-reel',
  '_mockup-glb',
  'crossing-stress',
  '_sylva',
  'towers',
  'sagrada',
];

/** every top-level entry the build puts at the site root */
const PUBLIC_ENTRIES = [
  'assets',
  'dialkit-theme.css',
  'draco',
  'asset',
  'models',
  'og.png',
  'robots.txt',
  'sagrada-poster.webp',
  'still',
  'sylva-poster.webp',
  'towers-poster.webp',
  'xstress-loop.mp4',
];

module('Unit | routes', function () {
  test('nothing in public/ shadows a route', function (assert) {
    const shadowed = ROUTE_PATHS.filter(
      (path) =>
        PUBLIC_ENTRIES.includes(path) ||
        PUBLIC_ENTRIES.includes(`${path}.html`),
    );

    assert.deepEqual(
      shadowed,
      [],
      'a route path that matches a file or folder at the site root is served by the host, not the app',
    );
  });
});
