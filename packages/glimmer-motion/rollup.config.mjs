import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Addon } from '@embroider/addon-dev/rollup';
import { babel } from '@rollup/plugin-babel';

import {
  framerMotionDir,
  framerMotionInternalPath,
  isFramerMotionModule,
  isReact,
} from './scripts/source-resolution.mjs';

const addon = new Addon({
  srcDir: 'src',
  destDir: 'dist',
});

// framer-motion is MIT-licensed: the chunk carrying its inlined modules
// carries its copyright and permission notice, as a legal comment that
// minifiers and bundlers keep.
const framerMotionNotice = () => {
  const { version, repository } = JSON.parse(
    readFileSync(join(framerMotionDir, 'package.json'), 'utf8'),
  );
  const license = readFileSync(join(framerMotionDir, 'LICENSE.md'), 'utf8');
  return `/*!\n * Contains modules of framer-motion@${version} (${repository}):\n *\n${license
    .trim()
    .split('\n')
    .map((line) => ` * ${line}`.trimEnd())
    .join('\n')}\n */`;
};

/**
 * src/framer-motion-internals.ts imports modules from framer-motion's
 * `dist/es` that its exports map doesn't expose. Resolve them on disk, past
 * the exports map, and keep them (and every relative import they make) in
 * glimmer-motion's own output instead of letting addon.dependencies() mark
 * them external. motion-dom and motion-utils stay external, so the inlined
 * code shares the one engine instance with the rest of the page.
 *
 * framer-motion declares `sideEffects: false`, and its modules are marked
 * that way here, so rollup keeps only what glimmer-motion uses: the React
 * hook that shares a module with `DragControls` drops out with its `react`
 * import.
 */
function inlineFramerMotionInternals() {
  return {
    name: 'inline-framer-motion-internals',
    resolveId(id, importer) {
      const internal = framerMotionInternalPath(id);
      if (internal) {
        return { id: internal, moduleSideEffects: false };
      }
      if (!isFramerMotionModule(importer)) {
        return null;
      }
      if (id.startsWith('.')) {
        return {
          id: resolve(dirname(importer), id),
          moduleSideEffects: false,
        };
      }
      if (isReact(id)) {
        return { id, external: true, moduleSideEffects: false };
      }
      return null;
    },
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') {
          continue;
        }
        const stray = chunk.imports.filter(
          (spec) =>
            !(spec in bundle) &&
            (isReact(spec) ||
              (spec.startsWith('framer-motion') &&
                spec !== 'framer-motion/dom')),
        );
        if (stray.length) {
          this.error(
            `${chunk.fileName} imports ${stray.join(', ')}; framer-motion's internals must be inlined and React-free`,
          );
        }
      }
    },
  };
}

export default {
  // This provides defaults that work well alongside `publicEntrypoints` below.
  // You can augment this if you need to.
  output: {
    ...addon.output(),
    banner: (chunk) =>
      chunk.fileName === 'framer-motion-internals.js'
        ? framerMotionNotice()
        : '',
  },

  // framer-motion's React hooks carry a "use client" directive. The one module
  // glimmer-motion reaches that has it (the hook beside DragControls) is
  // tree-shaken out, so the warning rollup raises while parsing it is noise.
  onwarn(warning, warn) {
    if (
      warning.code === 'MODULE_LEVEL_DIRECTIVE' &&
      isFramerMotionModule(warning.id)
    ) {
      return;
    }
    warn(warning);
  },

  plugins: [
    // These are the modules that users should be able to import from your
    // addon. Anything not listed here may get optimized away.
    // By default all your JavaScript modules (**/*.js) will be importable.
    // But you are encouraged to tweak this to only cover the modules that make
    // up your addon's public API. Also make sure your package.json#exports
    // is aligned to the config here.
    // See https://github.com/embroider-build/embroider/blob/main/docs/v2-faq.md#how-can-i-define-the-public-exports-of-my-addon
    addon.publicEntrypoints(['**/*.js', 'index.js', 'template-registry.js']),

    // These are the modules that should get reexported into the traditional
    // "app" tree. Things in here should also be in publicEntrypoints above, but
    // not everything in publicEntrypoints necessarily needs to go here.
    addon.appReexports([
      'components/**/*.js',
      'helpers/**/*.js',
      'modifiers/**/*.js',
      'services/**/*.js',
    ]),

    inlineFramerMotionInternals(),

    // Follow the V2 Addon rules about dependencies. Your code can import from
    // `dependencies` and `peerDependencies` as well as standard Ember-provided
    // package names.
    addon.dependencies(),

    // Relative imports between .ts/.gts modules are extensionless; try the source extensions for those
    // (bare package imports stay external through addon.dependencies() above).
    {
      name: 'resolve-source-extensions',
      resolveId(id, importer) {
        if (!importer || !id.startsWith('.')) {
          return null;
        }
        const base = resolve(dirname(importer), id);
        for (const ext of ['', '.ts', '.gts', '.gjs', '.js']) {
          if (existsSync(base + ext) && !ext.endsWith('/')) {
            const f = base + ext;
            if (!existsSync(f) || statSync(f).isDirectory()) {
              continue;
            }
            return f;
          }
        }
        return null;
      },
    },

    // This babel config should *not* apply presets or compile away ES modules.
    // It exists only to provide development niceties for you, like automatic
    // template colocation.
    //
    // It loads babel.publish.config.json; babel.config.mjs is the vite
    // test harness's config.
    babel({
      extensions: ['.js', '.gjs', '.ts', '.gts'],
      babelHelpers: 'bundled',
      configFile: fileURLToPath(
        new URL('./babel.publish.config.json', import.meta.url),
      ),
    }),

    // Ensure that standalone .hbs files are properly integrated as Javascript.
    addon.hbs(),

    // Ensure that .gjs files are properly integrated as Javascript
    addon.gjs(),

    // Emit .d.ts declaration files
    addon.declarations(
      'declarations',
      'pnpm ember-tsc --declaration --project tsconfig.declarations.json',
    ),

    // addons are allowed to contain imports of .css files, which we want rollup
    // to leave alone and keep in the published output.
    addon.keepAssets(['**/*.css']),

    // Remove leftover build artifacts when starting a new build.
    addon.clean(),
  ],
};
