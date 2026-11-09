import { ember, extensions } from '@embroider/vite';
import { buildMacros } from '@embroider/macros/babel';
import { babel } from '@rollup/plugin-babel';
import { scopedCSS } from 'glimmer-scoped-css/rollup';
import { fileURLToPath } from 'node:url';

import { defineConfig, type ViteBuilder } from 'vite';

import { buildInputs } from './build/build-inputs.ts';
import { buildRecord } from './build/build-record.ts';
import { importAllowlist } from './build/import-allowlist.ts';
import { layerOrderFirst } from './build/layer-order.ts';
import { modulePackage } from './build/module-package.ts';
import { probeOutDir } from './build/probe.ts';
import { relativeModuleNames } from './build/relative-module-names.ts';

const macros = buildMacros();

// The entry documents the origin serves. `session.js` is an entry of its own,
// so it is served whole, with its exports under their own names: the secure
// window's end-to-end tests import it from the origin and call it as the
// window does.
const PAGES = {
  shell: 'index.html',
  credentials: 'credentials.html',
  session: 'src/security/session.js',
};

// The secure origin's pages are only ever served from this build, read by the
// realm server at startup — never from a dev server, which injects styles
// inline where the origin's policy refuses them.
//
// The realm server serves the shell at a path that differs per environment
// (`/` deployed, `/secure` in development), so asset URLs are written under a
// placeholder base, named in the build's manifest, that the realm server
// replaces with that path. File names carry no hash: every response on the
// origin is `no-store`, and fixed names keep the build record readable.
//
// The component tests are built in development mode (`pnpm test:components`),
// into dist-tests, with tests/index.html as one more entry, served from the
// root. The script also sets NODE_ENV=development, since `vite build` sets
// NODE_ENV=production before this file loads, whatever `--mode` is. With it,
// `buildMacros` makes `isDevelopingApp()` true, which `@ember/test-waiters`
// needs for `settled()` to see the work a test waits on, and the bundle takes
// Ember's debug build, with its development-only assertions. That build is
// never served on the origin, so the import allowlist and the build record,
// which describe what the origin serves, see only a production build of the
// pages.
export default defineConfig(({ mode }) => ({
  base: mode === 'development' ? '/' : '/__SECURE_ORIGIN_BASE__/',
  plugins: [
    // A component's `<style scoped>` is compiled into a stylesheet of its own,
    // which the build emits as a file, never as inline style the policy would
    // refuse.
    scopedCSS(),
    ember(),
    babel({
      babelHelpers: 'runtime',
      extensions,
      babelrc: false,
      configFile: false,
      // Templates are compiled here, at build time, so the build never needs
      // Ember's runtime template compiler and the pages run under a policy
      // without `unsafe-eval`.
      plugins: [
        [
          '@babel/plugin-transform-typescript',
          {
            allExtensions: true,
            onlyRemoveTypeImports: true,
            allowDeclareFields: true,
          },
        ],
        // boxel-ui's tasks are written as `task(async () => …)`, which this
        // turns into what ember-concurrency runs, as boxel-ui's own build
        // and the host's do.
        'ember-concurrency/async-arrow-task-transform',
        [
          'babel-plugin-ember-template-compilation',
          {
            transforms: [
              ...macros.templateMacros,
              'glimmer-scoped-css/ast-transform',
            ],
          },
        ],
        [
          'module:decorator-transforms',
          {
            // A path, not a `file:` URL: Embroider's resolver reads a URL
            // imported from a dependency's module, such as boxel-ui's, as a
            // package named `file:`.
            runtime: {
              import: fileURLToPath(
                import.meta.resolve('decorator-transforms/runtime-esm'),
              ),
            },
          },
        ],
        [
          '@babel/plugin-transform-runtime',
          {
            absoluteRuntime: import.meta.dirname,
            useESModules: true,
            regenerator: false,
          },
        ],
        ...macros.babelMacros,
      ],
      generatorOpts: { compact: false },
    }),
    relativeModuleNames(),
    // The pages' build alone: the tests' development build loads modules
    // the pages never ship, and its page is not one of the origin's.
    ...(mode === 'development'
      ? []
      : [
          importAllowlist(),
          layerOrderFirst(),
          buildRecord({
            mode:
              process.env.SECURE_ORIGIN_BUILD_RECORD === 'check'
                ? 'check'
                : 'write',
          }),
          buildInputs(),
          probeOutDir(),
        ]),
  ],
  build: {
    modulePreload: { polyfill: false },
    rollupOptions: {
      input:
        mode === 'development'
          ? { ...PAGES, tests: 'tests/index.html' }
          : PAGES,
      preserveEntrySignatures: 'exports-only',
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name][extname]',
        // Chunks the pages share get fixed names, so the build record and the
        // files the realm server serves don't change name with whichever
        // module sorts first. `shared` holds Ember and the components the
        // pages are built from, where more than one entry keeps them, so the
        // credential frame loads none of the shell's own components, nor the
        // part of a dependency only the shell uses; `layers`
        // holds only the order of the pages' cascade layers
        // (`src/styles/layers.css`), which every entry imports and
        // `layerOrderFirst` links ahead of the page's other stylesheets.
        codeSplitting: {
          groups: [
            {
              name: 'layers',
              test: (id: string) =>
                id.split('?')[0].endsWith('/src/styles/layers.css'),
              priority: 2,
            },
            {
              name: 'shared',
              // Dependencies, Pret UI, boxel-ui and boxel-icons (this
              // repository's other packages) included, and this package's
              // components, helpers and modifiers.
              test: (id: string) => {
                let found = modulePackage(id);
                return (
                  id.includes('/node_modules/') ||
                  (found.virtual === undefined && found.workspace) ||
                  /\/src\/(components|helpers|modifiers)\//.test(id)
                );
              },
              // Counted on the modules each entry keeps once unused exports
              // are dropped, so a module the shell reaches through a barrel
              // the credential fields also import (boxel-ui's `components`)
              // stays in the shell's chunk.
              minShareCount: 2,
              priority: 1,
            },
          ],
        },
      },
    },
  },
  // The production build is two builds. `client` is the pages the origin
  // serves. `probe` is the build probe (`probe.html`), a page no user is sent
  // to and the realm server never serves, which draws on Pret UI, boxel-ui
  // and boxel-icons so that the allowlist, the build record and the policy
  // test cover what those packages ship. It is a build of its own, written to
  // `probe/` in the output, so the modules it shares with a page never move
  // that page's modules into another chunk: what it adds leaves every page's
  // files as they are. The build record covers both.
  ...(mode === 'development'
    ? {}
    : {
        environments: {
          client: {},
          probe: {
            consumer: 'client' as const,
            build: {
              // A single entry, named for its file. Given as a string, it
              // replaces the pages' entries rather than joining them.
              rollupOptions: { input: 'probe.html' },
            },
          },
        },
        builder: {
          async buildApp(builder: ViteBuilder) {
            await builder.build(builder.environments.client);
            await builder.build(builder.environments.probe);
          },
        },
      }),
}));
