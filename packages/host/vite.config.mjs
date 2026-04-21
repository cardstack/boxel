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
// "browser" field for fs that Rolldown doesn't honor. postcss requires
// 'url' for optional fileURLToPath/pathToFileURL helpers and guards
// their usage with truthy checks, so an empty module is safe.
const emptyFsPath = require.resolve('./lib/empty-fs.js');
const nodeBuiltinStubResolver = {
  name: 'node-builtin-stub-resolver',
  resolveId(id) {
    if (
      id === 'fs' ||
      id === 'node:fs' ||
      id === 'url' ||
      id === 'node:url'
    ) {
      return emptyFsPath;
    }
    return null;
  },
};

// pnpm keeps source-map-js nested under postcss's own node_modules, so
// bare `require('source-map-js')` from postcss can't resolve from the
// host package root during optimizeDeps pre-bundling. Point rolldown at
// the actual install so it inlines the module instead of emitting a
// runtime __require that throws in the browser.
const sourceMapJsPath = require.resolve('source-map-js', {
  paths: [require.resolve('postcss/package.json')],
});
const sourceMapJsResolver = {
  name: 'source-map-js-resolver',
  resolveId(id) {
    if (id === 'source-map-js') {
      return sourceMapJsPath;
    }
    return null;
  },
};

export default defineConfig({
  // Preserve function/class names. Boxel's card runtime introspects
  // `Class.name` in user-visible places — validation errors ("references
  // unknown path X on Person"), displayName fallbacks, the
  // query-field-schema checks — so mangled names break both tests and
  // production error messages. The esbuild option covers dep-optimizer
  // transforms; the rolldown output option is what actually preserves
  // names through Vite 8's production minifier (oxc-minifier), including
  // classes declared inside function bodies.
  esbuild: {
    keepNames: true,
  },
  build: {
    rolldownOptions: {
      output: {
        keepNames: true,
      },
    },
  },
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
      plugins: [
        postcssTerminalHighlightResolver,
        nodeBuiltinStubResolver,
        sourceMapJsResolver,
      ],
    },
  },
  preview: {
    cors: true,
    headers: {
      'Cache-Control': 'no-store',
    },
  },
});
