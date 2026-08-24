import { classicEmberSupport, ember, extensions } from '@embroider/vite';
import { babel } from '@rollup/plugin-babel';
import { defineConfig } from 'vite';

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
