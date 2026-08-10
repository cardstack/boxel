import { classicEmberSupport, ember, extensions } from '@embroider/vite';
import { babel } from '@rollup/plugin-babel';
import { scopedCSS } from 'glimmer-scoped-css/rollup';
import { defineConfig } from 'vite';

// This vite pipeline serves and builds the test suite (see tests/index.html
// and the `test` script). Publishing is a separate rollup build — see
// rollup.config.mjs.
export default defineConfig({
  plugins: [
    scopedCSS(),
    // Several dependencies still ship loose-mode templates (e.g.
    // ember-power-calendar); the compat pipeline resolves the virtual
    // imports their compilation produces.
    classicEmberSupport(),
    ember(),
    babel({
      babelHelpers: 'runtime',
      extensions,
    }),
  ],
  build: {
    rollupOptions: {
      input: {
        tests: 'tests/index.html',
      },
    },
  },
});
