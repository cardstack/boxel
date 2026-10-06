/**
 * Lint rules for the Choreo test app (the gallery and test suite): the shared
 * Choreo config, plus what differs for this package.
 */
import base, {
  commonjs,
  erasableSyntax,
} from '@cardstack/choreo-eslint-config';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  globalIgnores([
    // third-party decoder binaries served as static assets
    'public/draco/',
    'public/asset/towers/three-149.js',
    'public/asset/sagrada/three-149.js',
    'public/asset/sagrada/r185/**',
  ]),
  base,
  {
    /**
     * The app is served from a sub-path in production and from `/` in every
     * dev server and every test, so a root-absolute path to a public asset is
     * correct everywhere it is ever exercised and a 404 on the only place it
     * ships. Nothing rewrites these: Vite rewrites the tags it emits into
     * index.html and it rewrites `?url` imports, but a hand-written string
     * handed to a loader is just a string.
     *
     * The failure is silent, which is the reason for a rule rather than a
     * note: a Draco decoder that 404s leaves the GLTF load hanging, so the
     * canvas is never sized and the scene renders as a blank default with no
     * exception raised.
     *
     * Build these from `config.rootURL`, which is the same `APP_BASE` that
     * sets Vite's `base`.
     */
    files: ['app/**/*.{ts,gts}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...erasableSyntax,
        {
          selector:
            'Literal[value=/^\\/(draco|models|still|og\\.png|robots\\.txt|xstress-loop\\.mp4)/]',
          message:
            'Public assets must be addressed from config.rootURL: a root-absolute path 404s wherever the app is not served from /. Use `${config.rootURL}models/thing.glb`.',
        },
      ],
    },
  },
  // ember-cli loads these through `require`
  commonjs([
    'testem.js',
    'ember-cli-build.js',
    '.template-lintrc.js',
    'config/**/*.js',
  ]),
]);
