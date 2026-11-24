// The config for `migrations/` and `migrations-removal/`, each of which has
// an `eslint.config.mjs` that re-exports it. ESLint uses the nearest config
// to a file, so migrations get only this, not the package's config.
import { defineConfig } from 'eslint/config';

import { globals, n, ts } from '../../eslint/shared.mjs';

export default defineConfig([
  {
    files: ['**/*.js'],
    extends: [n.configs['flat/recommended-script']],
    languageOptions: {
      parser: ts.parser,
      sourceType: 'script',
      globals: globals.node,
    },
    rules: {
      camelcase: 'off',
      // As eslintrc's `plugin:n/recommended` configured it.
      'n/no-unsupported-features/es-syntax': [
        'error',
        { ignores: ['modules'] },
      ],
    },
  },
]);
