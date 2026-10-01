/**
 * Lint rules for choreo-gallery: the shared Choreo config, plus what differs
 * for this package.
 */
import base from '@cardstack/choreo-eslint-config';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';

export default defineConfig([
  globalIgnores([
    // Boxel copies are generated from the already-linted gallery sources.
    'public/**',
    'src/components/**/*',
    '!src/components/{gallery-site,site-frame,demo-stage,special-stages,host-link,raw-document-frame}.gts',
    'src/lib/**/*',
    '!src/lib/{theme,host-navigation}.ts',
    // the film-graph sketches are proposals written in a syntax that does
    // not exist yet (f.Spine, f.Attach, f.picture.*): read them, don't lint them
    'docs/film-graph/**/*.gts',
    'docs/film-graph/**/*.mjs',
    'out/**',
  ]),
  base,
  {
    // Node browser checks contain functions evaluated in the page.
    files: ['tools/*widget*.mjs', 'tools/sagrada-model-review.mjs'],
    languageOptions: { globals: { ...globals.browser } },
    settings: { node: { version: '>=22.16.0' } },
  },
]);
