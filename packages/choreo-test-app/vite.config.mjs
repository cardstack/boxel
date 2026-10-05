import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { classicEmberSupport, ember, extensions } from '@embroider/vite';
import { babel } from '@rollup/plugin-babel';
import { defaultClientConditions, defineConfig } from 'vite';

import { boxelIframe } from '../choreo-gallery/scripts/iframe-plugin.mjs';
import { glimmerMotionSource } from '../glimmer-motion/scripts/source-resolution.mjs';

/**
 * THE DRACO DECODER COMES FROM THREE, not from the repository.
 *
 * `DRACOLoader.setDecoderPath()` takes a directory PREFIX and builds
 * `${path}draco_wasm_wrapper.js` itself, so the decoder cannot be a
 * hashed `?url` import — it has to exist at a stable, servable path. The
 * usual answer is to check the files into `public/`, which means carrying
 * ~190KB of someone else's build artefact in the tree and letting it
 * drift from the `three` we actually resolve.
 *
 * Instead they are copied out of the installed package at config time, so
 * they are always the decoder that matches this three, and the copy is
 * gitignored. Config time rather than a build hook because `public/` is
 * read by the dev server too, and this way one mechanism serves both.
 */
const require = createRequire(import.meta.url);
function vendorDraco() {
  // resolved through an EXPORTED subpath: three's package.json is not
  // itself exported, so the loader is the way in and the decoder sits
  // beside it
  const from = join(
    dirname(require.resolve('three/examples/jsm/loaders/DRACOLoader.js')),
    '../libs/draco',
  );
  const to = join(dirname(new URL(import.meta.url).pathname), 'public/draco');
  mkdirSync(to, { recursive: true });
  for (const file of [
    'draco_decoder.js',
    'draco_decoder.wasm',
    'draco_wasm_wrapper.js',
  ]) {
    copyFileSync(join(from, file), join(to, file));
  }
}
vendorDraco();

/**
 * DIALKIT'S STYLESHEET COMES FROM THE PACKAGE, not from the repository.
 *
 * The dial spike (docs/dialkit.md) leans on the fact that all four of
 * dialkit's UI ports render the same `dialkit-*` class names against one
 * shared `theme.css` — so an Ember port that emits the same markup inherits
 * the whole visual design. That only pays off if the stylesheet stays the
 * package's, and is not a copy in the tree drifting from the version we
 * resolve.
 *
 * It cannot be reached by `@import` at all. Embroider rewrites EVERY import
 * in app.css into its own virtual-module scheme — a bare `dialkit/styles.css`
 * throws "unexpected @embroider/virtual specifier", and even a sibling
 * relative path is captured and answered with a 300-byte stub. So it goes to
 * `public/` and is linked from index.html, exactly as the Draco decoder is
 * served. The copy is gitignored.
 */
function vendorDialkit() {
  const from = join(dirname(require.resolve('dialkit/vanilla')), 'styles.css');
  const dir = join(dirname(new URL(import.meta.url).pathname), 'public');
  mkdirSync(dir, { recursive: true });
  copyFileSync(from, join(dir, 'dialkit-theme.css'));
}
vendorDialkit();

// Like cardstack/boxel: the test suite is built in development mode (engine warnings and dev
// assertions stay live) into dist-tests, with tests/index.html as an explicit entry.
// Vite 6 does not derive process.env.NODE_ENV from --mode for builds (Vite 8 does), so it is
// defined from the mode here: Motion's dev-only code (warnOnce, invariants) must survive the
// test build.
// Where the built app will be served from. GitHub Pages serves a project repo
// under /<repo>/, not the domain root, so every asset URL and the router's own
// rootURL have to agree on that prefix — set APP_BASE=/choreo/ for a Pages
// build. Empty (the default) keeps a root-served build, which is what the dev
// server, the test build, and Vercel/Cloudflare all want.
/**
 * REGENERATING THE LAPTOP STILL (dev server only).
 *
 * The Long Take demo's 2D mode is a WebP of the WebGL laptop at its rest
 * pose, not a CSS drawing of one — so the 2D/3D switch changes what is
 * animating rather than what the machine looks like. The still has to be
 * remade whenever the model, the lighting rig or the rest pose changes,
 * and a still that can only be remade by hand is a still that goes stale.
 *
 * So the browser can post one back. In the demo, with 3D up:
 *
 *     await window.__take.capture()
 *
 * renders one frame at the rest pose, reads the canvas — alpha and all,
 * so the hole where the screen goes is transparent in the file exactly as
 * it is in the live canvas — and posts it here. The response carries the
 * frozen `perspective` and `matrix3d` strings to paste into
 * `examples/long-take.gts`, because the image and those matrices are one
 * measurement and must be replaced together.
 *
 * `apply: 'serve'` and a single hard-coded destination: this writes one
 * file and can write nothing else.
 */
function captureStill() {
  const dest = join(
    dirname(fileURLToPath(import.meta.url)),
    'public/still/macbook.webp',
  );
  return {
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__capture-still', (req, res, next) => {
        if (req.method !== 'POST') {
          next();
          return;
        }
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          const b64 = body.slice(body.indexOf(',') + 1);
          mkdirSync(dirname(dest), { recursive: true });
          const bytes = Buffer.from(b64, 'base64');
          writeFileSync(dest, bytes);
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ bytes: bytes.length, wrote: dest }));
        });
      });
    },
    name: 'capture-still',
  };
}

const base = process.env.APP_BASE || '/';

export default defineConfig(({ mode }) => ({
  base,
  define: {
    'process.env.NODE_ENV': JSON.stringify(mode),
  },
  // ember-cli-deprecation-workflow is a CLASSIC addon: its `main` is the
  // Node-side build hook and its browser half is an AMD file that
  // `classicEmberSupport()` wires up — `vendor/…/main.js`, which calls
  // `window.require` at module scope. Let Vite pre-bundle that and the
  // optimised copy can run before `@embroider/virtual/vendor.js` has defined
  // `window.require`, and the app boots into a blank page with no error
  // anywhere except one console line. It happened on the first load after
  // any edit that made the optimiser re-run, which made it look like the
  // dev server randomly dying; the only recovery was `vite --force`.
  //
  // `ember()` excludes `@embroider/macros` for exactly this reason. This is
  // the same fix for the same shape of dependency. Anything else classic and
  // AMD-flavoured belongs on this list too.
  optimizeDeps: {
    exclude: ['ember-cli-deprecation-workflow'],
  },
  // glimmer-motion and @cardstack/choreo compile from their source through the
  // `developing:choreo` export condition, so neither needs building first.
  resolve: {
    conditions: ['developing:choreo', ...defaultClientConditions],
  },
  build: {
    rollupOptions: {
      // The tests entry only exists for the development build (see `test` in
      // package.json). Embroider writes one content-for manifest per build and
      // a production one has no /tests/index.html in it, so leaving the entry
      // in unconditionally made `vite build` die in the content-for plugin
      // with "Cannot convert undefined or null to object" — the app has simply
      // never been built for production until now.
      input:
        mode === 'development'
          ? { app: 'index.html', tests: 'tests/index.html' }
          : { app: 'index.html' },
    },
  },
  plugins: [
    glimmerMotionSource(),
    boxelIframe(),
    captureStill(),
    classicEmberSupport(),
    ember(),
    // extra plugins here
    babel({
      babelHelpers: 'runtime',
      extensions,
    }),
  ],
}));
