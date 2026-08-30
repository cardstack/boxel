import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { classicEmberSupport, ember, extensions } from '@embroider/vite';
import { babel } from '@rollup/plugin-babel';
import { defineConfig } from 'vite';

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
    classicEmberSupport(),
    ember(),
    // extra plugins here
    babel({
      babelHelpers: 'runtime',
      extensions,
    }),
  ],
}));
