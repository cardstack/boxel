import { fileURLToPath } from 'node:url';

import { ember, extensions } from '@embroider/vite';
import { babel } from '@rollup/plugin-babel';
import { defaultClientConditions, defineConfig } from 'vite';

import {
  glimmerMotionSource,
  selfReferenceSource,
} from './scripts/source-resolution.mjs';

const fromSource = process.env.CHOREO_LIBS !== 'dist';

// This vite pipeline serves and builds the test suite (see tests/index.html
// and the `test` script). Publishing is a separate rollup build; see
// rollup.config.mjs.
//
// The suite is built in development mode, and Vite 6 does not derive
// process.env.NODE_ENV from --mode for builds, so it is defined from the
// mode here: Motion's dev-only code (warnOnce, invariants) must stay live
// in the test build.
export default defineConfig(({ mode }) => ({
  define: {
    'process.env.NODE_ENV': JSON.stringify(mode),
  },
  resolve: {
    // The suite imports glimmer-motion by its public specifiers
    // (`glimmer-motion/motion`, `glimmer-motion/test-support`…), which the
    // `developing:choreo` export condition resolves to the source, so the
    // harness runs with no rollup build first. CHOREO_LIBS=dist leaves the
    // condition out and runs the suite against the built output instead, the
    // code npm consumers get; the package must be built.
    conditions: fromSource
      ? ['developing:choreo', ...defaultClientConditions]
      : defaultClientConditions,
    alias: [
      // glimmer-motion declares the npm `@glimmer/tracking` and
      // `@glimmer/validator` for their types, and those real packages would
      // win over ember-source's renamed modules. Each is a validator of its
      // own, so a tracked property or a consumed VOLATILE_TAG read through
      // them never invalidates ember-source's templates: point them at
      // ember-source's copies, as an app's build does.
      {
        find: /^@glimmer\/tracking$/,
        replacement: 'ember-source/@glimmer/tracking/index.js',
      },
      {
        find: /^@glimmer\/validator$/,
        replacement: 'ember-source/@glimmer/validator/index.js',
      },
    ],
  },
  plugins: [
    // the suite's own `glimmer-motion/*` imports, which Embroider would
    // otherwise answer from dist/ whenever glimmer-motion is built
    ...(fromSource
      ? [selfReferenceSource(fileURLToPath(new URL('.', import.meta.url)))]
      : []),
    glimmerMotionSource(),
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
}));
