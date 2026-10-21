import { ember, extensions } from '@embroider/vite';
import { babel } from '@rollup/plugin-babel';
import { defineConfig } from 'vite';

import { buildRecord } from './build/build-record.mjs';
import { importAllowlist } from './build/import-allowlist.mjs';

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
    babel({ babelHelpers: 'runtime', extensions }),
    importAllowlist(),
    buildRecord({
      mode:
        process.env.SECURE_ORIGIN_BUILD_RECORD === 'check' ? 'check' : 'write',
    }),
  ],
  build: {
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: { shell: 'index.html', credentials: 'credentials.html' },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name][extname]',
      },
    },
  },
});
