import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { classicEmberSupport, ember, extensions } from '@embroider/vite';
import { babel } from '@rollup/plugin-babel';
import { defaultClientConditions, defineConfig } from 'vite';

import { glimmerMotionSource } from '../glimmer-motion/scripts/source-resolution.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Keeps the machine that built the app out of the build. The template
 * compiler names each template by its absolute path on disk, which would
 * publish that path in the realm and make the build differ from one checkout
 * to the next; a production build names it from the repository root instead.
 */
function repoRelativePaths() {
  return {
    name: 'repo-relative-paths',
    apply: 'build',
    renderChunk(code) {
      return code.includes(repoRoot)
        ? { code: code.replaceAll(repoRoot, ''), map: null }
        : null;
    },
  };
}

// Like choreo-test-app: the test suite is built in development mode into
// dist-tests, with tests/index.html as an extra entry, and NODE_ENV follows the
// mode so Motion's dev-only code survives the test build.
export default defineConfig(({ mode }) => ({
  // Relative in a production build, so it runs from whatever directory serves
  // it: the gallery realm mounts it at film-app/. The test build is served
  // from the root, with its page in tests/.
  base: mode === 'production' ? './' : '/',
  // The dev server serves the gallery realm as its public directory, so the
  // films find their media at ../asset/ exactly as they do in the realm (see
  // app/lib/assets.ts). A build never copies it: the realm already has it.
  publicDir: '../choreo-gallery/realm',
  define: {
    'process.env.NODE_ENV': JSON.stringify(mode),
  },
  // glimmer-motion and @cardstack/choreo compile from their source through the
  // `developing:choreo` export condition, so neither needs building first.
  resolve: {
    conditions: ['developing:choreo', ...defaultClientConditions],
  },
  build: {
    copyPublicDir: false,
    rollupOptions: {
      input:
        mode === 'development'
          ? { app: 'index.html', tests: 'tests/index.html' }
          : { app: 'index.html' },
    },
  },
  plugins: [
    repoRelativePaths(),
    glimmerMotionSource(),
    classicEmberSupport(),
    ember(),
    babel({
      babelHelpers: 'runtime',
      extensions,
    }),
  ],
}));
