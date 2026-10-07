/**
 * Lint rules for the film app: the shared Choreo config, plus what differs
 * for this package.
 */
import base, { commonjs } from '@cardstack/choreo-eslint-config';
import { defineConfig } from 'eslint/config';

export default defineConfig([
  base,
  // ember-cli loads these through `require`
  commonjs([
    'testem.js',
    'ember-cli-build.js',
    '.template-lintrc.js',
    'config/**/*.js',
  ]),
]);
