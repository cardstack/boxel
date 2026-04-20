import { defineConfig } from 'vite';
import {
  extensions as _extensions,
  classicEmberSupport,
  ember,
} from '@embroider/vite';
import { babel } from '@rollup/plugin-babel';
import { createRequire } from 'node:module';
import { scopedCSS } from 'glimmer-scoped-css/rollup';

const require = createRequire(import.meta.url);

// TODO: working around possible upstream problem. The app blueprint uses this
// for guiding babel, but it includes '.json' which doesn't work in babel.
const extensions = _extensions.filter((e) => e !== '.json');

// Workaround for embroider-build/embroider#2703: the embroider resolver that
// @embroider/vite pushes into optimizeDeps.rolldownOptions.plugins does not
// do extension resolution for relative requires, so postcss's
// `require('./terminal-highlight')` fails to load during dep optimization.
// This plugin runs first and adds the `.js` extension for that specific case.
const postcssTerminalHighlightResolver = {
  name: 'postcss-terminal-highlight-resolver',
  resolveId(id, importer) {
    if (
      id === './terminal-highlight' &&
      importer &&
      importer.includes('/postcss/lib/')
    ) {
      return importer.replace(/[^/]+$/, 'terminal-highlight.js');
    }
    return null;
  },
};

// resolve.alias does not apply during optimizeDeps pre-bundling, so we
// stub out Node built-ins here too. recast eagerly requires 'fs' (for a
// CLI helper we never call) and ast-types-browser's package.json has a
// "browser" field for fs that Rolldown doesn't honor.
const emptyFsPath = require.resolve('./lib/empty-fs.js');
const nodeBuiltinStubResolver = {
  name: 'node-builtin-stub-resolver',
  resolveId(id) {
    if (id === 'fs' || id === 'node:fs') {
      return emptyFsPath;
    }
    return null;
  },
};

export default defineConfig({
  resolve: {
    alias: {
      path: require.resolve('path-browserify'),
      crypto: require.resolve('crypto-browserify'),
      stream: require.resolve('stream-browserify'),
      // recast's main.js eagerly requires 'fs'; we stub it for the browser.
      fs: require.resolve('./lib/empty-fs.js'),
    },
  },
  plugins: [
    scopedCSS(),
    classicEmberSupport(),
    ember(),
    // extra plugins here
    babel({
      babelHelpers: 'runtime',
      extensions,
    }),
  ],
  optimizeDeps: {
    exclude: ['@sqlite.org/sqlite-wasm', 'content-tag'],
    rolldownOptions: {
      plugins: [postcssTerminalHighlightResolver, nodeBuiltinStubResolver],
    },
  },
});
