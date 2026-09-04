import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

import { Addon } from '@embroider/addon-dev/rollup';
import { babel } from '@rollup/plugin-babel';
import { decodeScopedCSSRequest, isScopedCSSRequest } from 'glimmer-scoped-css';

const addon = new Addon({ srcDir: 'src', destDir: 'dist' });

// addon-dev 7's asset copier cannot preserve the virtual CSS modules emitted
// by glimmer-scoped-css. Materialize each one beside its owning component so
// downstream Vite and esbuild consumers receive ordinary relative CSS imports.
function scopedCSSAssets() {
  const assets = new Map();
  return {
    name: 'scoped-css-assets',
    resolveId(source, importer) {
      if (!importer || !isScopedCSSRequest(source)) {
        return null;
      }
      const { css } = decodeScopedCSSRequest(source);
      const hash = createHash('sha256').update(css).digest('hex').slice(0, 12);
      const fileName = `${hash}.css`;
      const assetPath = resolve(dirname(importer), fileName);
      const outputName = relative(resolve('src'), assetPath);
      assets.set(outputName, css);
      return { id: assetPath, external: 'relative' };
    },
    generateBundle() {
      for (const [fileName, source] of assets) {
        this.emitFile({ type: 'asset', fileName, source });
      }
    },
  };
}

export default {
  output: addon.output(),
  plugins: [
    addon.publicEntrypoints(['**/*.js', 'index.js']),
    {
      name: 'resolve-source-extensions',
      resolveId(id, importer) {
        let base;
        if (id.startsWith('choreo-gallery/')) {
          base = resolve('src', id.slice('choreo-gallery/'.length));
        } else if (importer && id.startsWith('.')) {
          base = resolve(dirname(importer), id);
        } else {
          return null;
        }
        for (const ext of ['', '.ts', '.gts', '.gjs', '.js']) {
          const candidate = base + ext;
          if (existsSync(candidate) && statSync(candidate).isFile()) {
            return candidate;
          }
        }
        return null;
      },
    },
    addon.dependencies(),
    babel({
      extensions: ['.js', '.gjs', '.ts', '.gts'],
      babelHelpers: 'bundled',
    }),
    addon.hbs(),
    addon.gjs(),
    scopedCSSAssets(),
    addon.keepAssets(['**/*.css']),
    addon.clean(),
  ],
};
