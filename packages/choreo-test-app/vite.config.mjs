import { classicEmberSupport, ember, extensions } from '@embroider/vite';
import { babel } from '@rollup/plugin-babel';
import { defineConfig } from 'vite';

// Like cardstack/boxel: the test suite is built in development mode (engine warnings and dev
// assertions stay live) into dist-tests, with tests/index.html as an explicit entry.
// Vite 6 does not derive process.env.NODE_ENV from --mode for builds (Vite 8 does), so it is
// defined from the mode here: Motion's dev-only code (warnOnce, invariants) must survive the
// test build.
export default defineConfig(({ mode }) => ({
  define: {
    'process.env.NODE_ENV': JSON.stringify(mode),
  },
  build: {
    rollupOptions: {
      input: {
        app: 'index.html',
        tests: 'tests/index.html',
      },
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
