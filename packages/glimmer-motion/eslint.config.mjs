/**
 * Lint rules for glimmer-motion: the shared Choreo config, plus what differs
 * for this package.
 */
import base from '@cardstack/choreo-eslint-config';
import { defineConfig } from 'eslint/config';

export default defineConfig([
  base,
  {
    // verbatim copies of Motion's source (see VENDORED.md): type-checked upstream
    files: [
      'src/gestures/**',
      'src/reorder/{check-reorder,detect-axis,auto-scroll}.ts',
    ],
    rules: {
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
      'no-unused-vars': 'off',
      'prefer-rest-params': 'off',
    },
  },
]);
