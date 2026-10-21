import { ember, extensions } from '@embroider/vite';
import { buildMacros } from '@embroider/macros/babel';
import { babel } from '@rollup/plugin-babel';
import { defineConfig } from 'vite';

import { buildRecord } from './build/build-record.ts';
import { importAllowlist } from './build/import-allowlist.ts';

const macros = buildMacros();

// The secure origin's pages are only ever served from this build, read by the
// realm server at startup — never from a dev server, which injects styles
// inline where the origin's policy refuses them.
//
// The realm server serves the shell at a path that differs per environment
// (`/` deployed, `/secure` in development), so asset URLs are written under a
// placeholder base, named in the build's manifest, that the realm server
// replaces with that path. File names carry no hash: every response on the
// origin is `no-store`, and fixed names keep the build record readable.
export default defineConfig({
  base: '/__SECURE_ORIGIN_BASE__/',
  plugins: [
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
        [
          'babel-plugin-ember-template-compilation',
          { transforms: [...macros.templateMacros] },
        ],
        [
          'module:decorator-transforms',
          {
            runtime: {
              import: import.meta.resolve('decorator-transforms/runtime-esm'),
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
    importAllowlist(),
    buildRecord({
      mode:
        process.env.SECURE_ORIGIN_BUILD_RECORD === 'check' ? 'check' : 'write',
    }),
  ],
  build: {
    modulePreload: { polyfill: false },
    rollupOptions: {
      // `session.js` is an entry of its own, so it is served whole, with its
      // exports under their own names: the secure window's end-to-end tests
      // import it from the origin and call it as the window does.
      input: {
        shell: 'index.html',
        credentials: 'credentials.html',
        session: 'src/security/session.js',
      },
      preserveEntrySignatures: 'exports-only',
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name][extname]',
      },
    },
  },
});
