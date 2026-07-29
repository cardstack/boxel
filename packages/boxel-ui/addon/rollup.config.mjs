import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Addon } from '@embroider/addon-dev/rollup';
import { babel } from '@rollup/plugin-babel';
import { scopedCSS } from 'glimmer-scoped-css/rollup';

const addon = new Addon({
  srcDir: 'src',
  destDir: 'dist',
});

const rootDirectory = dirname(fileURLToPath(import.meta.url));
const babelConfig = resolve(rootDirectory, './babel.publish.config.cjs');
const tsConfig = resolve(rootDirectory, './tsconfig.publish.json');

function emitStyles() {
  const stylesDir = resolve(rootDirectory, 'src/styles');
  return {
    name: 'emit-styles',
    generateBundle() {
      for (const fileName of readdirSync(stylesDir)) {
        this.emitFile({
          type: 'asset',
          fileName: `styles/${fileName}`,
          source: readFileSync(join(stylesDir, fileName)),
        });
      }
    },
  };
}

export default {
  // This provides defaults that work well alongside `publicEntrypoints` below.
  output: addon.output(),

  // Some modules import their siblings through the package name (e.g.
  // `@cardstack/boxel-ui/helpers`); those resolve through our own
  // package.json#exports in every consumer, so leave them alone.
  external: [/^@cardstack\/boxel-ui\//],

  plugins: [
    // Everything under src/ is importable, matching the `./*` pattern in
    // package.json#exports.
    addon.publicEntrypoints(['**/*.js']),

    // No addon.appReexports(): this package is consumed via direct imports
    // only (ember-addon.app-js is intentionally empty).

    // Follow the V2 Addon rules about dependencies. Your code can import from
    // `dependencies` and `peerDependencies` as well as standard Ember-provided
    // package names.
    addon.dependencies(),

    // This babel config should *not* apply presets or compile away ES modules.
    // It exists only to provide development niceties for you, like automatic
    // template colocation.
    babel({
      extensions: ['.js', '.gjs', '.ts', '.gts'],
      babelHelpers: 'bundled',
      configFile: babelConfig,
    }),

    // Ensure that standalone .hbs files are properly integrated as Javascript.
    addon.hbs(),

    // Ensure that .gjs/.gts files are properly integrated as Javascript.
    addon.gjs(),

    // Turn the virtual stylesheet requests that <style scoped> blocks
    // compile into (see glimmer-scoped-css/ast-transform in
    // babel.publish.config.cjs) into real .css assets in dist/.
    scopedCSS(),

    // Emit .d.ts declaration files (includes rewriting the .gts import
    // specifiers the compiler leaves in them to resolvable .js ones).
    addon.declarations('declarations', `pnpm ember-tsc --project ${tsConfig}`),

    // Addons are allowed to contain imports of .css files, which we want
    // rollup to leave alone and keep in the published output.
    addon.keepAssets(['**/*.css']),

    // keepAssets only covers assets imported by the module graph. The
    // stylesheets under styles/ are consumed by apps through the `./*.css`
    // export (and fonts.css references the font binaries by relative URL),
    // so emit them all. Emitting as bundle assets — rather than copying —
    // keeps addon.clean() from treating them as stale files and deleting
    // them.
    emitStyles(),

    // Remove leftover build artifacts when starting a new build.
    addon.clean(),
  ],
};
