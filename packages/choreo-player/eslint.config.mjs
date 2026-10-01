/**
 * Lint rules for choreo-player: the shared Choreo config, plus what differs
 * for this package.
 */
import base from '@cardstack/choreo-eslint-config';
import { defineConfig } from 'eslint/config';

export default defineConfig([
  base,
  {
    // The unit tests exercise the built package: they import from dist/,
    // which the `test` script builds first and which lint runs without.
    // Running the tests is what checks those imports resolve.
    files: ['test/**/*.mjs'],
    rules: { 'n/no-missing-import': 'off' },
  },
]);
