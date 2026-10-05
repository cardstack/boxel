import { existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { Addon } from '@embroider/addon-dev/rollup';
import { babel } from '@rollup/plugin-babel';

const addon = new Addon({
  srcDir: 'src',
  destDir: 'dist',
});

export default {
  output: addon.output(),

  plugins: [
    // Every module is importable: the root, `film`, `test-support`, and the
    // deep imports (`@cardstack/choreo/compile`, …) that package.json#exports
    // maps through `./*`.
    addon.publicEntrypoints(['**/*.js', 'index.js']),

    // Follow the V2 Addon rules about dependencies: glimmer-motion, motion-dom
    // and the Ember packages stay external, so the page shares one engine and
    // one participant-host registry with glimmer-motion.
    addon.dependencies(),

    // Resolve a relative import to its source file, trying the source
    // extensions when the specifier leaves one off.
    {
      name: 'resolve-source-extensions',
      resolveId(id, importer) {
        if (!importer || !id.startsWith('.')) {
          return null;
        }
        const base = resolve(dirname(importer), id);
        for (const ext of ['', '.ts', '.gts', '.gjs', '.js']) {
          const f = base + ext;
          if (existsSync(f) && !statSync(f).isDirectory()) {
            return f;
          }
        }
        return null;
      },
    },

    // Development niceties only (template colocation, decorators); it does
    // not compile away ES modules. The config is babel.config.json.
    babel({
      extensions: ['.js', '.gjs', '.ts', '.gts'],
      babelHelpers: 'bundled',
    }),

    // Ensure that .gjs/.gts files are properly integrated as Javascript
    addon.gjs(),

    // Emit .d.ts declaration files
    addon.declarations(
      'declarations',
      'pnpm ember-tsc --declaration --project tsconfig.declarations.json',
    ),

    // Remove leftover build artifacts when starting a new build.
    addon.clean(),
  ],
};
