import { existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ember, extensions } from '@embroider/vite';
import { babel } from '@rollup/plugin-babel';
import { defineConfig } from 'vite';

const choreoSrcDir = fileURLToPath(new URL('./src', import.meta.url));
const glimmerMotionDir = fileURLToPath(
  new URL('../glimmer-motion', import.meta.url),
);
const glimmerMotionSrcDir = join(glimmerMotionDir, 'src');

const framerMotionDir = dirname(
  createRequire(join(glimmerMotionDir, 'package.json')).resolve(
    'framer-motion/package.json',
  ),
);

/**
 * The suite imports choreo and glimmer-motion by their public specifiers
 * (`@cardstack/choreo/test-support`, `glimmer-motion/test-support`…). Both
 * resolve to their source, so the harness runs with no rollup build first,
 * and a glimmer-motion change is tested here as it stands in the tree.
 */
function fromSource(packageName, srcDir) {
  const candidates = (base) => [
    base,
    `${base}.ts`,
    `${base}.gts`,
    join(base, 'index.ts'),
    join(base, 'index.gts'),
  ];
  return {
    name: `${packageName}-from-source`,
    enforce: 'pre',
    resolveId(id) {
      if (id !== packageName && !id.startsWith(`${packageName}/`)) {
        return null;
      }
      const base = join(srcDir, id.slice(packageName.length));
      return (
        candidates(base).find((f) => existsSync(f) && statSync(f).isFile()) ??
        null
      );
    },
  };
}

/**
 * glimmer-motion's src/framer-motion-internals.ts imports modules from
 * framer-motion's `dist/es` that its exports map doesn't expose; its rollup
 * build inlines them into the published package. Here they're served from
 * framer-motion on disk. One of them imports React's `useRef` for a hook
 * glimmer-motion never calls, so React resolves to a stub that throws if it
 * ever is.
 */
function framerMotionInternals() {
  const internal = 'framer-motion/dist/es/';
  const reactStub = '\0choreo-react-stub';
  return {
    name: 'framer-motion-internals',
    enforce: 'pre',
    resolveId(id, importer) {
      if (id.startsWith(internal)) {
        return join(framerMotionDir, id.slice('framer-motion/'.length));
      }
      if (id === 'react' && importer?.startsWith(framerMotionDir + sep)) {
        return reactStub;
      }
      return null;
    },
    load(id) {
      if (id === reactStub) {
        return `export function useRef() {
  throw new Error('glimmer-motion reached a React hook in framer-motion');
}`;
      }
      return null;
    },
  };
}

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
    alias: [
      // choreo and glimmer-motion declare the npm `@glimmer/tracking` and
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
    fromSource('@cardstack/choreo', choreoSrcDir),
    fromSource('glimmer-motion', glimmerMotionSrcDir),
    framerMotionInternals(),
    ember(),
    babel({
      babelHelpers: 'runtime',
      extensions,
    }),
  ],
  // pages a test loads into an iframe, served from the root
  publicDir: 'tests/public',
  build: {
    rollupOptions: {
      input: {
        tests: 'tests/index.html',
      },
    },
  },
}));
