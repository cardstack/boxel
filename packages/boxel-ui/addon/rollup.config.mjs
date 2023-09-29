import { Addon } from '@embroider/addon-dev/rollup';
import { babel } from '@rollup/plugin-babel';
import { createHash } from 'crypto';
import { decodeScopedCSSRequest, isScopedCSSRequest } from 'glimmer-scoped-css';
import path from 'path';
import copy from 'rollup-plugin-copy';

const addon = new Addon({
  srcDir: 'src',
  destDir: 'dist',
});

export default {
  // This provides defaults that work well alongside `publicEntrypoints` below.
  // You can augment this if you need to.
  output: addon.output(),

  plugins: [
    // These are the modules that users should be able to import from your
    // addon. Anything not listed here may get optimized away.
    addon.publicEntrypoints([
      'helpers/cn.js',
      'helpers/css-var.js',
      'helpers/dayjs-format.js',
      'helpers/element.js',
      'helpers/menu-divider.js',
      'helpers/menu-item.js',
      'helpers/optional.js',
      'helpers/pick.js',
      'helpers/truth-helpers.js',
      'components/**/usage.gts',
      'index.js',
    ]),

    // These are the modules that should get reexported into the traditional
    // "app" tree. Things in here should also be in publicEntrypoints above, but
    // not everything in publicEntrypoints necessarily needs to go here.
    addon.appReexports([]),

    // Follow the V2 Addon rules about dependencies. Your code can import from
    // `dependencies` and `peerDependencies` as well as standard Ember-provided
    // package names.
    addon.dependencies(),

    // This babel config should *not* apply presets or compile away ES modules.
    // It exists only to provide development niceties for you, like automatic
    // template colocation.
    //
    // By default, this will load the actual babel config from the file
    // babel.config.json.
    babel({
      babelHelpers: 'bundled',
      extensions: ['.js', '.gjs', '.ts', '.gts'],
    }),

    // Ensure that standalone .hbs files are properly integrated as Javascript.
    addon.hbs(),

    // Ensure that .gjs files are properly integrated as Javascript
    addon.gjs(),

    // addons are allowed to contain imports of .css files, which we want rollup
    // to leave alone and keep in the published output.
    addon.keepAssets(['styles/*']),

    // Remove leftover build artifacts when starting a new build.
    addon.clean({ runOnce: true }),

    // Copy Readme and License into published package
    copy({
      targets: [
        { src: '../README.md', dest: '.' },
        { src: '../LICENSE.md', dest: '.' },
      ],
    }),
    scopedCSS('src'),
  ],
};

function scopedCSS(srcDir) {
  return {
    name: 'scoped-css',
    resolveId(source, importer) {
      if (!isScopedCSSRequest(source)) {
        return null;
      }
      let hash = createHash('md5');
      let fullSrcDir = path.resolve(srcDir);
      let localPath = path.relative(fullSrcDir, importer);
      hash.update(source);
      let cssFileName = hash.digest('hex').slice(0, 10) + '.css';
      let dir = path.dirname(localPath);
      let css = decodeScopedCSSRequest(source);
      return {
        id: path.resolve(path.dirname(importer), cssFileName),
        meta: { 'scoped-css': { css, fileName: path.join(dir, cssFileName) } },
        external: 'relative',
      };
    },
    generateBundle() {
      for (const moduleId of this.getModuleIds()) {
        let info = this.getModuleInfo(moduleId);
        if (info.meta['scoped-css']) {
          this.emitFile({
            type: 'asset',
            fileName: info.meta['scoped-css'].fileName,
            source: info.meta['scoped-css'].css,
          });
        }
      }
    },
  };
}
